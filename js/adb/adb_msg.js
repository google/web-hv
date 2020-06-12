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

const ADB_MESSAGE_HEADER_LENGTH = 24;

const SYNC_COMMAND = 0x434e5953;
const CNXN_COMMAND = 0x4e584e43;
const OPEN_COMMAND = 0x4e45504f;
const OKAY_COMMAND = 0x59414b4f;
const CLSE_COMMAND = 0x45534c43;
const WRTE_COMMAND = 0x45545257;
const AUTH_COMMAND = 0x48545541;

const AUTH_TYPE_TOKEN = 1;
const AUTH_TYPE_SIGNATURE = 2;
const AUTH_TYPE_RSAPUBLICKEY = 3;

var commandMap = [];
commandMap[SYNC_COMMAND] = "SYNC_COMMAND";
commandMap[CNXN_COMMAND] = "CNXN_COMMAND";
commandMap[OPEN_COMMAND] = "OPEN_COMMAND";
commandMap[OKAY_COMMAND] = "OKAY_COMMAND";
commandMap[CLSE_COMMAND] = "CLSE_COMMAND";
commandMap[WRTE_COMMAND] = "WRTE_COMMAND";
commandMap[AUTH_COMMAND] = "AUTH_COMMAND";

/**
 * ADB protocol version.
 */
const VERSION_SKIP_CHECKSUM = 0x01000001;
const VERSION = VERSION_SKIP_CHECKSUM;

/**
 * Compute the expected header magic value
 * command: number
 */
function computeAdbMessageHeaderMagic(command) {
    // >>> 0 forces to unsigned int
    return (command ^ 0xffffffff) >>> 0;
}

/**
 * data: Uint8Array
 */
function computeAdbMessageDataCrc32(data) {
    return data.reduce((sum, byte) => sum + byte, 0);
}


/**
 * Construct a header from the given properties for the given data.
 * command: number
 * arg0: number
 * arg1: number
 * data?: Uint8Array
 * @return AdbMessageHeader object
 */
function constructAdbHeader(command, arg0, arg1, data, version) {
    var checksum;
    if (version >= VERSION_SKIP_CHECKSUM && command != AUTH_COMMAND && command != CNXN_COMMAND) {
        checksum = 0;
    } else if (data) {
        checksum = computeAdbMessageDataCrc32(data);
    } else {
        checksum = 0;
    }
    return {
        command: command,
        arg0: arg0,
        arg1: arg1,
        data_length: data ? data.byteLength : 0,
        data_crc32: checksum,
        magic: computeAdbMessageHeaderMagic(command),
    };
}

/**
 * Serialize a message header into bytes that should be sent to the device.
 * header: AdbMessageHeader
 * @see #constructAdbHeader
 */
function serializeAdbMessageHeader(header) {
    const buffer = new ArrayBuffer(ADB_MESSAGE_HEADER_LENGTH);
    const dataView = new DataView(buffer);
    dataView.setUint32(0, header.command, true);
    dataView.setUint32(4, header.arg0, true);
    dataView.setUint32(8, header.arg1, true);
    dataView.setUint32(12, header.data_length, true);
    dataView.setUint32(16, header.data_crc32, true);
    dataView.setUint32(20, header.magic, true);
    return new Uint8Array(buffer);
}

/**
 * Convert an ascii string to a byte array.
 */
function stringToByteArray(str) {
    const data = new Uint8Array(str.length);
    for (let i = 0; i < str.length; ++i) {
        data[i] = str.charCodeAt(i);
    }
    return data;
}

/**
 * Parse a message header from the buffer. Will throw if the header is
 * malformed.
 * data: Uint8Array
 */
function parseAndVerifyAdbMessageHeader(data) {
    if (data.byteLength !== ADB_MESSAGE_HEADER_LENGTH) {
        throw new Error(`Incorrect header size, ${data.byteLength}`);
    }
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const header = {
        command: dataView.getUint32(0, true),
        arg0: dataView.getUint32(4, true),
        arg1: dataView.getUint32(8, true),
        data_length: dataView.getUint32(12, true),
        data_crc32: dataView.getUint32(16, true),
        magic: dataView.getUint32(20, true),
    };
    if (header.magic !== computeAdbMessageHeaderMagic(header.command)) {
        throw new Error('Header magic value mismatch');
    }
    return header;
}

/**
 * Verify that the supplied data matches the header crc.
 * header: AdbMessageHeader
 * data: Uint8Array
 */
function verifyAdbMessageData(header, data) {
    if (header.data_crc32 !== computeAdbMessageDataCrc32(data)) {
        throw new Error('Data crc32 does not match header ' + header.data_crc32);
    }
}

/**
 * Appends to array bufferes
 */
function appendBuffer(first, last) {
    var result = new Uint8Array(first.byteLength + last.byteLength);
    result.set(first, 0);
    result.set(last, first.byteLength);
    return result;
}


/**
 * Converts array buffer to string
 */
function ab2str(buf) {
    return String.fromCharCode.apply(null, buf);
}
