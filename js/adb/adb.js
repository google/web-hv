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

const ADB_DEVICE_FILTER = {
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

class AdbDevice extends BaseAdbDevice {

    constructor(device, usb_interface) {
        super()
        this.device = device;
        this.state = STATE_DISCONNECTED;
        this.usb_interface = usb_interface;
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

        const eps = usb_interface.alternates[0].endpoints;
        for (let i = 0; i < eps.length; i++) {
            if (eps[i].direction == "out") {
                this.outEndPoint = eps[i].endpointNumber;
            } else if (eps[i].direction == "in") {
                this.inEndPoint = eps[i].endpointNumber;
            }
        }
    }

    #setState(state) {
        if (this.state == state) {
            return;
        }
        this.state = state;
        if (this.stateCallback) {
            this.stateCallback(this.state);
        }
    }

    async #sendSinglePacketMessage(command, arg0, arg1, data) {
        if (data && data.length > this.maxPayload) {
            throw new Error('Message too large for device.');
        }

        const headerData = serializeAdbMessageHeader(constructAdbHeader(command, arg0, arg1, data, this.version));
        await this.device.transferOut(this.outEndPoint, headerData);
        if (data && data.length > 0) {
            await this.device.transferOut(this.outEndPoint, data);
        }
    }

    async _sendMessage(command, arg0, arg1, data) {
        if (this.readyDeferred.length) {
            await Promise.resolve(this.readyDeferred[this.readyDeferred.length - 1]);
        }
        // Send packets serially, otherwise headers might get mixed up
        const sendLock = await this._sendMutex.lock();
        try {
            if (PROTOCOL_DEBUG) console.debug("Sending ", commandMap[command], arg0, arg1);
            if (!data) {
                await this.#sendSinglePacketMessage(command, arg0, arg1);
            } else {
                let sentByteCount = 0;
                // If `data` is large, send the message as small chunks of at most
                // `this.maxPayload` bytes each. Wait for an `OKAY` from the device before
                // sending the next chunk, and re-send a header with every chunk.
                while (sentByteCount !== data.byteLength) {
                    const length = Math.min(this.maxPayload, data.byteLength - sentByteCount);
                    const chunk = data.subarray(sentByteCount, sentByteCount + length);
                    sentByteCount += length;
                    await this.#sendSinglePacketMessage(command, arg0, arg1, chunk);
                }
            }
        } finally {
            sendLock();
        }
    }

    async #readData(length) {
        const result = await this.device.transferIn(this.inEndPoint, length);

        if (result.status === 'ok') {
            const view = result.data;
            return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        } else {
            throw new Error('Transfer failed: ' + result.status);
        }
    }

    async #doReadLoop() {
        try {
            const headerData = await this.#readData(ADB_MESSAGE_HEADER_LENGTH);
            const header = parseAndVerifyAdbMessageHeader(headerData);
            if (header.data_length > 0) {
                const data = await this.#readData(header.data_length);
                if (this.version != VERSION_SKIP_CHECKSUM) {
                    verifyAdbMessageData(header, data);
                }
                this.#handleMessage(header, data);
            } else {
                this.#handleMessage(header, EMPTY_DATA);
            }
            this.#doReadLoop(); // don't await
        } catch (e) {
            console.log("Error reading data", e);
        }
    }

    #resolveDeferred(localId, remoteId) {
        for (let i = 0; i < this.readyDeferred.length; i++) {
            if (this.readyDeferred[i].data == localId) {
                this.readyDeferred.splice(i, 1)[0].accept(remoteId);
                return true;
            }
        }
        return false;
    }

    #handleMessage(header, data) {
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
                    this.#setState(STATE_CONNECTED_DEVICE);
                    break;
                }
            case OPEN_COMMAND:
                throw new Error('open not implemented');
            case OKAY_COMMAND: {
                const localId = header.arg0;
                const remoteId = header.arg1;
                if (this.readyDeferred.length) {
                    this.#resolveDeferred(remoteId, localId);
                } else if (!this.#findStream(remoteId, localId)) {
                    this._sendMessage(CLSE_COMMAND, remoteId, localId);
                }
                break;
            }
            case CLSE_COMMAND: {
                // Resolve all pending OKAYs
                while (this.#resolveDeferred(header.arg1, header.arg0));

                const localId = header.arg0;
                const remoteId = header.arg1;
                const stream = this.#findStream(remoteId, localId);
                if (stream) {
                    stream.onReceiveClose();
                }
                break;
            }
            case WRTE_COMMAND: {

                const localId = header.arg0;
                const remoteId = header.arg1;
                const stream = this.#findStream(remoteId, localId);
                if (stream) {
                    stream.onReceiveWrite(data);
                } else {
                    console.log("Not found", localId, remoteId);
                }
                break;
            }
            case AUTH_COMMAND:
                const authType = header.arg0;
                switch (authType) {
                    case AUTH_TYPE_TOKEN:
                        this.#onReceiveAuthToken(data);
                        break;
                    case AUTH_TYPE_SIGNATURE:
                        throw new Error('auth signature not implemented');
                    case AUTH_TYPE_RSAPUBLICKEY:
                        throw new Error('auth rsapublickey not implemented');
                    default:
                        throw new Error(`Unknown auth command type: ${authType}`);
                }
                break;
            default:
                throw new Error(`Unknown command: ${header.command}`);
        }
    }

    #findStream(localId, remoteId) {
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

    async #onReceiveAuthToken(data) {
        if (this.state != STATE_CONNECTING && this.state != STATE_UNAUTHORIZED) {
            throw new Error(`Received auth message while in state: ${this.state}`);
        }
        this.#setState(STATE_UNAUTHORIZED);
        console.info('received adb auth token');

        if (this.key.fullKey) {
            const signature = await this.key.sign(data);
            // Clear the private key so that next time we generate a new public key
            this.key.fullKey = null;
            this._sendMessage(AUTH_COMMAND, AUTH_TYPE_SIGNATURE, 0, signature);
        } else {
            // Generate and save a new signature
            const pk = await this.key.publicKey();
            this._sendMessage(AUTH_COMMAND, AUTH_TYPE_RSAPUBLICKEY, 0, stringToByteArray(pk + "\0"));
        }
    }

    async connect() {
        this.#setState(STATE_CONNECTING);
        this.#doReadLoop();
        await this._sendMessage(CNXN_COMMAND, VERSION, MAX_DATA, stringToByteArray(SYSTEM_IDENTITY));
    }

    openStream(command) {
        const localId = this.nextLocalId++;
        const stream = new AdbStream(this, localId);
        if (PROTOCOL_DEBUG) console.debug("Opening stream", command, localId);
        this.streams[localId] = stream;
        this._sendMessage(OPEN_COMMAND, localId, 0, stringToByteArray(command + "\0"));
        this.readyDeferred.push(stream.remoteIdResolved);
        return stream;
    }

    closeAll() {
        console.log("Closing all");
        for (let i = 0; i < this.streams.length; i++) {
            if (this.streams[i]) {
                this.streams[i].onClose = null;
                this.streams[i].close();
            }
        }
    }

    disconnect() {
        try {
            this.device.releaseInterface(this.usb_interface.interfaceNumber);
            this.disconnectedDevice = true;
        } catch (e) {
            console.log(e);
        }
    }
}

const STREAM_OPEN = 0;
const STREAM_CLOSING = 1;
const STREAM_CLOSED = 2;

class AdbStream extends BaseAdbStream {

    constructor(device, localId) {
        super()
        this.device = device;
        this.localId = localId;
        this.remoteId = 0;
        this.remoteIdResolved = deferred(this.localId);
        this.state = STREAM_OPEN;
    }

    async write(data) {
        if (this.state != STREAM_OPEN) {
            throw "Stream no longer valid";
        }
        this.remoteId = await Promise.resolve(this.remoteIdResolved);
        if (data.constructor == String) {
            data = stringToByteArray(data);
        }
        this.device._sendMessage(WRTE_COMMAND, this.localId, this.remoteId, data);
        const ok = deferred(this.localId);
        this.device.readyDeferred.push(ok);
        return ok;
    }

    close() {
        this.device._sendMessage(CLSE_COMMAND, this.localId, this.remoteId);
        if (this.state == STREAM_OPEN) {
            this.state = STREAM_CLOSING;
        }
    }

    onReceiveClose() {
        this.device.streams[this.localId] = undefined;
        this.state = STREAM_CLOSED;
        super.onReceiveClose()
        if (PROTOCOL_DEBUG) console.debug("Stream closed " + this.localId);
    }

    sendReady() {
        this.device._sendMessage(OKAY_COMMAND, this.localId, this.remoteId);
    }
}
