// Copyright 2018 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const ADB_INTERFACE_CLASS = 255;
const ADB_INTERFACE_SUB_CLASS = 66;
const ADB_INTERFACE_PROTOCOL = 1;

var ADB_DEVICE_FILTER = {
    classCode: ADB_INTERFACE_CLASS,
    subclassCode: ADB_INTERFACE_SUB_CLASS,
    protocolCode: ADB_INTERFACE_PROTOCOL
};

const STATE_DISCONNECTED = 0;
const STATE_CONNECTING = 1;
const STATE_ERROR = 2;
const STATE_UNAUTHORIZED = 3;
const STATE_CONNECTED_DEVICE = 4;

const PROTOCOL_DEBUG = false;

/**
 * Maximum amount of data this client supports writing to a stream in one block.
 */
const MAX_DATA = 256 * 1024;

/**
 * System identity to send to the device.
 */
const SYSTEM_IDENTITY = 'host::web-hv'

const EMPTY_DATA = new Uint8Array(0);

function AdbDevice(device, interface) {
    this.device = device;
    this.state = STATE_DISCONNECTED;
    this.interface = interface;
    this.key = new AdbKey();

    // Maximum amount of data we can send in one transfer. We know its value once
    // we receive a 'CNXN' message from the device.
    this.maxPayload = 0x40000;

    this.inEndPoint = 0;
    this.outEndPoint = 0;
    this.streams = [];
    this.nextLocalId = 5;
    this.readyDeferred = [];
    this.closeDeferred = [];
    this.version = VERSION;
    this._sendMutex = new Mutex();

    var eps = interface.alternates[0].endpoints;
    for (var i = 0; i < eps.length; i++) {
        if (eps[i].direction == "out") {
            this.outEndPoint = eps[i].endpointNumber;
        } else if (eps[i].direction == "in") {
            this.inEndPoint = eps[i].endpointNumber;
        }
    }
}

AdbDevice.prototype._setState = function (state) {
    if (this.state == state) {
        return;
    }
    this.state = state;
    if (this.stateCallback) {
        this.stateCallback(this.state);
    }
}

/*
 * command: number
 * arg0: number
 * arg1: number
 * data: Uint8Array
 */
AdbDevice.prototype._sendSinglePacketMessage = async function (command, arg0, arg1, data) {
    if (data && data.length > this.maxPayload) {
        throw new Error('Message too large for device.');
    }

    const headerData = serializeAdbMessageHeader(constructAdbHeader(command, arg0, arg1, data, this.version));
    await this.device.transferOut(this.outEndPoint, headerData);
    if (data && data.length > 0) {
        await this.device.transferOut(this.outEndPoint, data);
    }
}

/*
 * command: number
 * arg0: number
 * arg1: number
 * data: Uint8Array
 */
AdbDevice.prototype._sendMessage = async function (command, arg0, arg1, data) {
    if (!!this.readyDeferred.length) {
        await Promise.resolve(this.readyDeferred[this.readyDeferred.length - 1]);
    }
    // Send packets serially, otherwise headers might get mixed up
    let sendLock = await this._sendMutex.lock();
    try {
        if (PROTOCOL_DEBUG) console.debug("Sending ", commandMap[command], arg0, arg1);
        if (!data) {
            await this._sendSinglePacketMessage(command, arg0, arg1);
        } else {
            let sentByteCount = 0;
            // If `data` is large, send the message as small chunks of at most
            // `this.maxPayload` bytes each. Wait for an `OKAY` from the device before
            // sending the next chunk, and re-send a header with every chunk.
            while (sentByteCount !== data.byteLength) {
                const length = Math.min(this.maxPayload, data.byteLength - sentByteCount);
                const chunk = data.subarray(sentByteCount, sentByteCount + length);
                sentByteCount += length;
                await this._sendSinglePacketMessage(command, arg0, arg1, chunk);
            }
        }
    } finally {
        sendLock();
    }
}

AdbDevice.prototype._readData = async function (length) {
    var result = await this.device.transferIn(this.inEndPoint, length);

    if (result.status === 'ok') {
        const view = result.data;
        return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    } else {
        throw new Error('Transfer failed: ' + result.status);
    }
}

AdbDevice.prototype._doReadLoop = async function () {
    try {
        var headerData = await this._readData(ADB_MESSAGE_HEADER_LENGTH);
        const header = parseAndVerifyAdbMessageHeader(headerData);
        if (header.data_length > 0) {
            var data = await this._readData(header.data_length);
            if (this.version != VERSION_SKIP_CHECKSUM) {
                verifyAdbMessageData(header, data);
            }
            this._handleMessage(header, data);
        } else {
            this._handleMessage(header, EMPTY_DATA);
        }
        this._doReadLoop(); // don't await
    } catch (e) {
        console.log("Error reading data", e);
    }
}

AdbDevice.prototype._resolveDeferred = function(localId, remoteId) {
    for (var i = 0; i < this.readyDeferred.length; i++) {
        if (this.readyDeferred[i].data == localId) {
            this.readyDeferred.splice(i, 1)[0].accept(remoteId);
            return true;
        }
    }
    return false;
}

AdbDevice.prototype._handleMessage = function (header, data) {
    if (PROTOCOL_DEBUG) console.debug("Received", header, commandMap[header.command], this.readyDeferred.length);
    switch (header.command) {
        case SYNC_COMMAND:
            throw new Error('sync not implemented');
        case CNXN_COMMAND:
            {
                if (this.state == STATE_CONNECTED_DEVICE) {
                    throw new Error('Received connect message after already connected');
                }
                if (header.arg0 != VERSION && header.arg0 != VERSION_SKIP_CHECKSUM) {
                    throw new Error(`Unexpected ADB version: ${header.arg0}`);
                }
                this.version = header.arg0;                
                this.maxPayload = header.arg1;
                this._setState(STATE_CONNECTED_DEVICE);
                break;
            }
        case OPEN_COMMAND:
            throw new Error('open not implemented');
        case OKAY_COMMAND: {
            const localId = header.arg0;
            const remoteId = header.arg1;
            if (!!this.readyDeferred.length) {
                this._resolveDeferred(remoteId, localId);
            } else if (!this._findStream(remoteId, localId)) {
                this._sendMessage(CLSE_COMMAND, remoteId, localId);
            }
            break;
        }
        case CLSE_COMMAND: {
            // Resolve all pending OKAYs
            while(this._resolveDeferred(header.arg1, header.arg0));

            const localId = header.arg0;
            const remoteId = header.arg1;
            const stream = this._findStream(remoteId, localId);
            if (stream) {
                stream.onReceiveClose();
            }
            break;
        }
        case WRTE_COMMAND: {

            const localId = header.arg0;
            const remoteId = header.arg1;
            const stream = this._findStream(remoteId, localId);
            if (stream) {
                stream.onReceiveWrite(data)
            } else {
                console.log("Not found" , localId, remoteId);
            }
            break;
        }
        case AUTH_COMMAND:
            const authType = header.arg0;
            switch (authType) {
                case AUTH_TYPE_TOKEN:
                    this._onReceiveAuthToken(data);
                    break;
                case AUTH_TYPE_SIGNATURE:
                    throw new Error('auth signature not implemented');
                    break;
                case AUTH_TYPE_RSAPUBLICKEY:
                    throw new Error('auth rsapublickey not implemented');
                    break;
                default:
                    throw new Error(`Unknown auth command type: ${authType}`);
            }
            break;
        default:
            throw new Error(`Unknown command: ${header.command}`);
    }
}

AdbDevice.prototype._findStream = function (localId, remoteId) {
    const stream = this.streams[localId];
    if (stream && (stream.remoteId === 0 || remoteId === stream.remoteId || remoteId === 0)) {
        if (remoteId != 0) {
            stream.remoteId = remoteId;
        }
        return stream;
    } else {
        return undefined;
    }
}


/**
 * data: Uint8Array
 */
AdbDevice.prototype._onReceiveAuthToken = async function (data) {
    if (this.state != STATE_CONNECTING && this.state != STATE_UNAUTHORIZED) {
        throw new Error(`Received auth message while in state: ${this.state}`);
    }
    this._setState(STATE_UNAUTHORIZED);
    console.info('received adb auth token');

    if (!!this.key.fullKey) {
        const signature = await this.key.sign(data);
        // Clear the private key so that next time we generate a new public key
        this.key.fullKey = null;
        this._sendMessage(AUTH_COMMAND, AUTH_TYPE_SIGNATURE, 0, signature);
    } else {
        // Generate and save a new signature
        var pk = await this.key.publicKey();
        this._sendMessage(AUTH_COMMAND, AUTH_TYPE_RSAPUBLICKEY, 0, stringToByteArray(pk + "\0"));
    }
}

AdbDevice.prototype.connect = async function () {
    this._setState(STATE_CONNECTING);
    this._doReadLoop();
    await this._sendMessage(CNXN_COMMAND, VERSION, MAX_DATA, stringToByteArray(SYSTEM_IDENTITY));
}

const STREAM_OPEN = 0;
const STREAM_CLOSING = 1;
const STREAM_CLOSED = 2;

function AdbStream(device, localId) {
    this.device = device;
    this.localId = localId;
    this.remoteId = 0;
    this.pending = [];
    this.remoteIdResolved = deferred(this.localId);
    this.keepOpen = false;
    this.state = STREAM_OPEN;
}

AdbStream.prototype.write = async function (data) {
    if (this.state != STREAM_OPEN) {
        throw "Stream no longer valid";
    }
    this.remoteId = await Promise.resolve(this.remoteIdResolved);
    if (data.constructor == String) {
        data = stringToByteArray(data);
    }
    this.device._sendMessage(WRTE_COMMAND, this.localId, this.remoteId, data);
    var ok = deferred(this.localId);
    this.device.readyDeferred.push(ok);
    return ok;
}

AdbStream.prototype.close = function () {
    this.device._sendMessage(CLSE_COMMAND, this.localId, this.remoteId);
    if (this.state == STREAM_OPEN) {
        this.state = STREAM_CLOSING;
    }
}

AdbStream.prototype.onReceiveClose = function () {
    this.device.streams[this.localId] = undefined;
    this.state = STREAM_CLOSED;
    if (this.onClose) {
        this.onClose();
    }
    if (PROTOCOL_DEBUG) console.debug("Stream closed " + this.localId);
}

AdbStream.prototype.onReceiveWrite = function (data) {
    if (this.keepOpen) {
        this.sendReady();
    }
    if (data && data.length) {
        this.pending.push(data);
    }
    if (!this.pending.length) return;
    if (this.pendingCallback) {
        var callback = this.pendingCallback;
        this.pendingCallback = null;
        this.read(this.pendingLength, callback);
    }
}

AdbStream.prototype.read = function (length, callback) {
    this.pendingLength = length;
    var result = null;
    var totalRead = 0;
    while (this.pending.length) {
        var entry = this.pending.shift();
        if (!this.pendingLength) {
            result = entry;
            break
        }
        var remaining = this.pendingLength - totalRead;
        if (entry.byteLength > remaining) {
            // Add back extra bytes
            var tmp = entry.subarray(0, remaining);
            var extra = entry.subarray(remaining);
            this.pending.unshift(extra);
            entry = tmp;
        }
        totalRead += entry.byteLength;
        result = result ? appendBuffer(result, entry) : entry;
        if (totalRead == this.pendingLength) break;
    }
    if (result != null && this.pendingLength != 0 && result.byteLength != this.pendingLength && result.byteLength != 0) {
        this.pending.unshift(result);
        result = null;
    }
    if (result) {
        this.pendingCallback = null;
        callback(result)
    } else {
        if (this.pendingCallback) throw new Error("double callback");
        this.pendingCallback = callback;
    }
}

AdbStream.prototype.sendReady = function () {
    this.device._sendMessage(OKAY_COMMAND, this.localId, this.remoteId);
}

AdbStream.prototype.readAll = function (responseMerger) {
    var result = deferred();

    if (!responseMerger) {
        responseMerger = new TextResponseMerger();
    }

    this.onReceiveWrite = function (data) {
        responseMerger.merge(data);
    }
    this.pending.forEach(this.onReceiveWrite);
    this.onClose = function () {
        result.accept(responseMerger.result);
    }
    return result;
}

/**
 * Merger to read all data as text
 */
function TextResponseMerger() {
    this.result = "";
    this.decoder = new TextDecoder();
}
TextResponseMerger.prototype.merge = function (data) {
    this.result += this.decoder.decode(data);
}

/**
 * Merger to read all data as byte array
 */
function ByteResponseMerger() {
    this.result = null;
}
ByteResponseMerger.prototype.merge = function (data) {
    this.result = this.result ? appendBuffer(this.result, data) : data;
}

AdbDevice.prototype.openStream = function (command) {
    var localId = this.nextLocalId++;
    var stream = new AdbStream(this, localId);
    if (PROTOCOL_DEBUG) console.debug("Opening stream", command, localId);
    this.streams[localId] = stream;
    this._sendMessage(OPEN_COMMAND, localId, 0, stringToByteArray(command + "\0"));
    this.readyDeferred.push(stream.remoteIdResolved);
    return stream;
}

AdbDevice.prototype.shellCommand = function (command) {
    return this.openStream("shell:" + command).readAll();
}

AdbDevice.prototype.closeAll = function () {
    console.log("Closing all");
    for (var i = 0; i < this.streams.length; i++) {
        if (this.streams[i]) {
            this.streams[i].onClose = null;
            this.streams[i].close();
        }
    }
}

AdbDevice.prototype.disconnect = function() {
    try {
        this.device.releaseInterface(this.interface.interfaceNumber);
        this.disconnectedDevice = true;
    } catch (e) {
        console.log(e);
    }
}

AdbDevice.prototype.sendFile = async function (targetPath, sourcePath) {
    var data = await doXhr(sourcePath, "arraybuffer");
    var stream = this.openStream("sync:");

    // Send request
    var out = new DataOutputStream();
    out.highFirst = false;
    var path = new Uint8Array(stringToByteArray(targetPath + ",0755"));
    out.writeBytes(new Uint8Array(stringToByteArray("SEND")));
    out.writeInt(path.length);
    out.writeBytes(path);
    stream.write(new Uint8Array(out.data));

    // File data
    // TODO: Handle large files in 64k chunks
    var data = new Uint8Array(data);
    out = new DataOutputStream();
    out.highFirst = false;
    out.writeBytes(new Uint8Array(stringToByteArray("DATA")));
    out.writeInt(data.length);
    out.writeBytes(data);
    stream.write(new Uint8Array(out.data));

    // End of Data
    out = new DataOutputStream();
    out.highFirst = false;
    out.writeBytes(new Uint8Array(stringToByteArray("DONE")));
    out.writeInt(0);
    stream.write(new Uint8Array(out.data));

    var response = deferred();
    stream.read(4, function (data) {
        response.accept(ab2str(data));
    });

    var okay = await response;
    stream.close();
    if ("OKAY" != okay) {
        throw "Transfer failer";
    }
}