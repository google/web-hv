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

const WEB_PROXY_VERSION = 1;
const STANDARD_ERROR_CODE = 4010;

class WebProxyDevice extends BaseAdbDevice {

    constructor(device) {
        super()
        this.device = device;
        this.streams = [];
        this.nextLocalId = 5;
    }

    openStream(command) {
        const stream = new WebSocketStream(new WebSocket("ws://localhost:8000/" + this.device.serial + "/" + command, [this.device.authKey]))
        const localId = this.nextLocalId++;
        this.streams[localId] = stream;
        stream.onReceiveCloseInternal = this.#clearStream.bind(this, localId)
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

    #clearStream(localId) {
        this.streams[localId] = undefined;
    }
}

class WebSocketStream extends BaseAdbStream {

    #isOpen = deferred()

    /**
     * @param {WebSocket} socket
     */
    constructor(socket) {
        super()
        this.socket = socket;

        socket.binaryType = "arraybuffer"
        socket.onmessage = this.#onMessage.bind(this);
        socket.onclose = this.onReceiveClose.bind(this);
        socket.onerror = this.onReceiveClose.bind(this);
        socket.onopen = this.#isOpen.accept.bind(this.#isOpen, true);
    }

    close() {
        this.socket.close();
    }

    async write(data) {
        await this.#isOpen;
        this.socket.send(data);
    }

    #onMessage(event) {
        // console.log("Data received:", event.data);
        // console.log(new TextDecoder("utf-8").decode(event.data));
        this.onReceiveWrite(new Uint8Array(event.data));
    }

    onReceiveClose() {
        this.onReceiveCloseInternal();
        super.onReceiveClose()
    }

    onReceiveCloseInternal() { }
}
