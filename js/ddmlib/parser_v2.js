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

// Prefixes for simple primitives. These match the JNI definitions.
const SIG_BOOLEAN = 'Z'.charCodeAt(0);
const SIG_BYTE = 'B'.charCodeAt(0);
const SIG_SHORT = 'S'.charCodeAt(0);
const SIG_INT = 'I'.charCodeAt(0);
const SIG_LONG = 'J'.charCodeAt(0);
const SIG_FLOAT = 'F'.charCodeAt(0);
const SIG_DOUBLE = 'D'.charCodeAt(0);

// Prefixes for some commonly used objects
const SIG_STRING = 'R'.charCodeAt(0);

const SIG_MAP = 'M'.charCodeAt(0); // a map with an short key
const SIG_END_MAP = 0;

const readMap = function(stream) {
    const map = [];
    while (true) {
        const key = readObject(stream);
        if (typeof(key) != "number") {
            throw "Invalid data";
        }
        if (key == SIG_END_MAP) {
            break;
        }
        map[key] = readObject(stream);
    }
    return map;
}

const readObject = function(stream) {
    const sig = stream.read();
    switch (sig) {
        case SIG_BOOLEAN:
            return stream.read() == 0 ? "false" : "true";
        case SIG_BYTE:
            return stream.read();
        case SIG_SHORT:
            return stream.readShort();
        case SIG_INT:
            return stream.readInt();
        case SIG_LONG:
            return stream.readLong();
        case SIG_FLOAT:
            return stream.readFloat();
        case SIG_DOUBLE:
            return stream.readDouble();
        case SIG_STRING:
            return stream.readStrSmall();
        case SIG_MAP:
            return readMap(stream);
        default:
            throw "Invalid data";
    }
}

let nameIndex;
let hashIndex;
let childCountIndex;
const childIndex = [];
let pTable;

const parseNodeObj = function(nodeData) {
    const name = nodeData[nameIndex];
    const hash = parseInt(nodeData[hashIndex]).toString(16).toLowerCase();

    const node = new ViewNode(name + "@" + hash);
    for (let i = 0; i < nodeData.length; i++) {
        if (nodeData[i] == undefined || nodeData[i] == null || nodeData[i].constructor == Array) {
            continue;
        }
        if (pTable[i].indexOf("meta:") == 0) {
            continue;
        }
        const property = new VN_Property(pTable[i]);
        property.value = nodeData[i];

        node.properties.push(property);
        node.namedProperties[property.name] = property;
    }

    if (nodeData[childCountIndex]) {
        const total = nodeData[childCountIndex];
        for (let i = 0; i < total; i++) {
            const child = parseNodeObj(nodeData[childIndex[i]]);
            node.children.push(child);
        }
    }

    node.sortProperties();
    node.loadCommonProperties();

    return node;
}

const parseNode = function(bytes, bitShift) {
    const bytesLen = bytes.length;
    const stream = new DataInputStream(bytes);
    stream.pos = bitShift;

    const views = [];
    const globalProps = {};

    while (stream.pos < bytesLen) {
        const obj = readObject(stream);
        if (obj.constructor == Array) {
            views.push(obj);
        } else {
            globalProps[obj] = readObject(stream);
        }
    }
    if (views.length < 2) {
        throw "Error reading data";
    }
    pTable = views[views.length - 1];

    // process table data
    nameIndex = pTable.indexOf("meta:__name__");
    hashIndex = pTable.indexOf("meta:__hash__");
    childCountIndex = pTable.indexOf("meta:__childCount__");

    for (let i = 0; i < pTable.length; i++) {
        if (pTable[i] != undefined && pTable[i].indexOf("meta:__child__") == 0) {
            childIndex[parseInt(pTable[i].substr(14))] = i;
        }
    }

    const root = parseNodeObj(views[0]);

    const windowLeftIndex = pTable.indexOf("window:left");
    const windowTopIndex = pTable.indexOf("window:top");
    if (windowLeftIndex >= 0 && windowTopIndex >= 0) {
        root.windowX = globalProps[windowLeftIndex];
        root.windowY = globalProps[windowTopIndex];
    }
    return root;
}
