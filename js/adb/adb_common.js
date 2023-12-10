/**
 * Merger to read all data as text
 */
class TextResponseMerger {
    result = "";
    decoder = new TextDecoder();

    merge(data) {
        this.result += this.decoder.decode(data);
    }
}

/**
 * Merger to read all data as byte array
 */
class ByteResponseMerger{
    result = null;

    merge(data) {
        this.result = this.result ? appendBuffer(this.result, data) : data;
    }
}

class BaseAdbDevice {

    openStream(command) {
        // TODO Implement
    }

    closeAll() {
        // TODO Implement
    }

    async connect() {
        return true;
    }

    disconnect() {
        closeAll()
    }

    shellCommand(command) {
        return this.openStream("shell:" + command).readAll();
    }


    async sendFile(targetPath, sourcePath) {
        let data = await doXhr(sourcePath, "arraybuffer");
        const stream = this.openStream("sync:");

        // Send request
        let out = new DataOutputStream();
        out.highFirst = false;
        const path = new Uint8Array(stringToByteArray(targetPath + ",0755"));
        out.writeBytes(new Uint8Array(stringToByteArray("SEND")));
        out.writeInt(path.length);
        out.writeBytes(path);
        stream.write(new Uint8Array(out.data));

        // File data
        // TODO: Handle large files in 64k chunks
        data = new Uint8Array(data);
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


        const response = await stream.read(4);
        const okay = ab2str(response);
        stream.close();
        if ("OKAY" != okay) {
            throw "Transfer failer";
        }
    }
}

class BaseAdbStream {

    onClose = null;
    keepOpen = false;

    #pending = [];
    #pendingRead = null;

    pendingCallback = null;
    pendingLength = 0;

    async write(data) {
        // TODO implement
        // return deferred
    }

    close() {
        // TODO implement
    }

    sendReady() {
        // TODO implement
    }

    onReceiveClose() {
        if (this.onClose) {
            this.onClose();
        }
    }

    onReceiveWrite(data) {
        if (this.keepOpen) {
            this.sendReady();
        }
        if (data && data.length) {
            this.#pending.push(data);
        }
        this.#doRead();
    }

    read(length) {
        if (this.#pendingRead) {
            throw new Error("double callback");
        }

        var result = deferred(length)
        this.#pendingRead = result;
        this.#doRead();
        return result;
    }

    #doRead() {
        if (!this.#pendingRead) {
            return;
        }

        var length = this.#pendingRead.data;
        let result = null;
        let totalRead = 0;
        while (this.#pending.length) {
            let entry = this.#pending.shift();
            if (!length) {
                result = entry;
                break
            }
            const remaining = length - totalRead;
            if (entry.byteLength > remaining) {
                // Add back extra bytes
                const tmp = entry.subarray(0, remaining);
                const extra = entry.subarray(remaining);
                this.#pending.unshift(extra);
                entry = tmp;
            }
            totalRead += entry.byteLength;
            result = result ? appendBuffer(result, entry) : entry;
            if (totalRead == length) break;
        }
        if (result != null && length != 0 && result.byteLength != length && result.byteLength != 0) {
            this.#pending.unshift(result);
            result = null;
        }
        if (result) {
            var callback = this.#pendingRead;
            this.#pendingRead = null;
            callback.accept(result);
        }
    }

    readAll(responseMerger) {
        const result = deferred();
        if (!responseMerger) {
            responseMerger = new TextResponseMerger();
        }

        this.onReceiveWrite = function (data) {
            responseMerger.merge(data);
        }

        this.#pending.forEach(this.onReceiveWrite);
        this.onClose = function () {
            result.accept(responseMerger.result);
        }
        return result;
    }
}
