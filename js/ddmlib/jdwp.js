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

function jdwp(pid, device) {
    this.device = device;
    this.pid = pid;
    this.seq = 1;

    this.callbacks = [];

    this.status = this.STATUS_DISCONNECTED;
    this.pendingCalls = [];
}

jdwp.prototype.STATUS_DISCONNECTED = 0;
jdwp.prototype.STATUS_CONNECTING = 1;
jdwp.prototype.STATUS_CONNECTED = 2;

jdwp.prototype._onDisconnect = function () {
    this.status = this.STATUS_DISCONNECTED;
    for (let i = 0; i < this.callbacks.length; i++) {
        if (this.callbacks[i]) {
            this.callbacks[i].reject();
        }
    }
    this.callbacks = [];
    this.pendingCalls = [];
    this.socket = null;
    if (this.onClose) {
        this.onClose();
    }
}

jdwp.prototype._connect = function () {
    const that = this;
    this.status = this.STATUS_CONNECTING;

    const socket = this.device.openStream("jdwp:" + this.pid);
    socket.onClose = this._onDisconnect.bind(this);
    socket.keepOpen = true;

    const cmd = "JDWP-Handshake";
    socket.read(cmd.length, function (data) {
        data = ab2str(data);
        if (data == cmd) {
            that._onConnect();
        } else {
            socket.close();
        }
    });
    socket.write(cmd);
    this.socket = socket;
}

jdwp.prototype._onConnect = function () {
    this.status = this.STATUS_CONNECTED;
    const calls = this.pendingCalls;
    this.pendingCalls = [];

    for (let i = 0; i < calls.length; i++) {
        this.socket.write(calls[i]);
    }
    this._readNextChunk();
}

jdwp.prototype._readNextChunk = function () {
    const that = this;
    this.socket.read(11, function (data) {
        const header = new DataInputStream(new Uint8Array(data));
        const len = header.readInt();
        const seq = header.readInt();
        const flags = header.read();
        const isCommand = flags != 128;

        that.socket.read(len - 11, function (data) {
            const reader = new DataInputStream(new Uint8Array(data));
            const type = reader.readInt();   // chunk type
            reader.readInt();   // result length;

            if (isCommand) {
                console.log("Command received", type, getChunkType("APNM"));
            } else {
                reader.chunkType = type;
                that.callbacks[seq].accept(reader);
                that.callbacks[seq] = null;
            }
            that._readNextChunk();
        });
    });
}

jdwp.prototype.destroy = function () {
    this.pendingCalls = [];
    if (this.socket) {
        this.socket.close();
    }
}

/**
 * @param type String or int chunk type
 * @param data byte array or DataOutputStream
 * @returns a promise for the result
 */
jdwp.prototype.writeChunk = function (type, data) {
    const result = deferred();
    if (data.constructor == DataOutputStream) {
        data = data.data;
    }

    let packet = new DataOutputStream();
    packet.writeInt(11 + 8 + data.length); // package length

    const seq = this.seq++;
    packet.writeInt(seq);

    packet.writeByte(0);    // flags
    packet.writeByte(0xc7); // 'G' + 128
    packet.writeByte(0x01); // DDMS command

    packet.writeInt(getChunkType(type));
    packet.writeInt(data.length);
    packet.writeBytes(data);
    packet = new Uint8Array(packet.data);

    this.callbacks[seq] = result;

    if (this.status != this.STATUS_CONNECTED) {
        this.pendingCalls.push(packet);
        if (this.status == this.STATUS_DISCONNECTED) {
            this._connect();
        }
    } else {
        this.socket.write(packet);
    }
    return result;
}

const CHUNK_TYPES = {};
const getChunkType = function (type) {
    if (type.constructor == String) {
        if (CHUNK_TYPES[type] == undefined) {
            const buf = new ArrayBuffer(4);
            const arr = new Uint8Array(buf);
            for (let i = 0; i < 4; i++) {
                arr[3 - i] = type.charCodeAt(i);
            }
            CHUNK_TYPES[type] = new Int32Array(buf)[0];
        }
        return CHUNK_TYPES[type];
    } else {
        return type;
    }
}
