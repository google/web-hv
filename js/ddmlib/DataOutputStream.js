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

function DataOutputStream() {
    this.data = [];
    this.highFirst = true;
}

DataOutputStream.prototype.intMax = Math.pow(2, 32);
DataOutputStream.prototype.shortMax = Math.pow(2, 16);
DataOutputStream.prototype.intSignedMax = Math.pow(2, 31);

/**
 * @param byte byte to write
 * @param pos optional position otherwise, data is written to the end.
 */
DataOutputStream.prototype.writeByte = function(byte, pos) {
    if (pos == undefined) pos = this.data.length;
    this.data[pos] = byte & 0x00FF;
}

DataOutputStream.prototype.writeBytes = function(bytes, pos) {
    if (pos == undefined) pos = this.data.length;
    var length = bytes.length;
    for (var i = 0; i < length; i++, pos++) {
        this.data[pos] = bytes[i];
    }
}

DataOutputStream.prototype.writeInt = function(number, pos) {
    if (this.highFirst) {
        this.writeBytes([((number & 0xFF000000) >> 24), ((number & 0x00FF0000) >> 16), ((number & 0xFF00) >> 8), (number & 0x00FF)], pos);
    } else {
        this.writeBytes([(number & 0x00FF), ((number & 0xFF00) >> 8), ((number & 0x00FF0000) >> 16), ((number & 0xFF000000) >> 24)], pos);
    }
}

DataOutputStream.prototype.writeFloat = function(number, pos) {
    var arr = new Float32Array(1);
    arr[0] = number;
    arr = new Int32Array(arr.buffer, arr.byteOffset);
    this.writeInt(arr[0]);
}

DataOutputStream.prototype.writeStr = function(str, doNotWriteLen) {
    var buf = new ArrayBuffer(str.length * 2); // 2 bytes for each char
    var bufView = new Uint16Array(buf);
    for (var i = 0; i < str.length; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    bufView = new Uint8Array(buf);
    if (this.highFirst) {
        swapAltElements(bufView);
    }
    if (!doNotWriteLen) {
        this.writeInt(str.length);
    }
    this.writeBytes(bufView);
}
