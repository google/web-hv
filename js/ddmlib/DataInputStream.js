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

var swapAltElements = function(arr) {
    for (var i = 0; i < arr.length; i += 2) {
        var tmp = arr[i];
        arr[i] = arr[i + 1];
        arr[i + 1] = tmp;
    }
}

function DataInputStream(data) {
    this.data = data;
    this.highFirst = true;
    this.pos = 0;

    this._view = new DataView(data.buffer);
}

DataInputStream.prototype.intMax = Math.pow(2, 32);
DataInputStream.prototype.shortMax = Math.pow(2, 16);
DataInputStream.prototype.intSignedMax = Math.pow(2, 31);

DataInputStream.prototype.read = function() {
    return this.data[this.pos++];
}

DataInputStream.prototype.readInt = function() {
    var pos = this.pos;
    this.pos += 4;
    return this._view.getInt32(pos, !this.highFirst);
}

DataInputStream.prototype.readShort = function() {
    var pos = this.pos;
    this.pos += 2;
    return this._view.getInt16(pos, !this.highFirst);
}

DataInputStream.prototype.readFloat = function() {
    var pos = this.pos;
    this.pos += 4;
    return this._view.getFloat32(pos, !this.highFirst);
}

DataInputStream.prototype.readDouble = function() {
    var pos = this.pos;
    this.pos += 8;
    return this._view.getFloat64(pos, !this.highFirst);
};

DataInputStream.prototype.readLong = function() {
    return this.readDouble(8);
}


DataInputStream.prototype.readStr = function(len) {
    if (len == undefined) {
        len = this.readInt();
    }
    var slice = this.data.subarray(this.pos, this.pos += 2 * len);
    if (this.highFirst) {
        swapAltElements(slice);
    }
    slice = new Uint16Array(slice.buffer, slice.byteOffset, len);
    return String.fromCharCode.apply(null, slice);
}

DataInputStream.prototype.readStrSmall = function() {
    var len = this.readShort();
    var slice = this.data.subarray(this.pos, this.pos += len);
    slice = new Uint8Array(slice.buffer, slice.byteOffset, len);
    return String.fromCharCode.apply(null, slice);
}
