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
var SIG_BOOLEAN = 'Z'.charCodeAt(0);
var SIG_BYTE = 'B'.charCodeAt(0);
var SIG_SHORT = 'S'.charCodeAt(0);
var SIG_INT = 'I'.charCodeAt(0);
var SIG_LONG = 'J'.charCodeAt(0);
var SIG_FLOAT = 'F'.charCodeAt(0);
var SIG_DOUBLE = 'D'.charCodeAt(0);

// Prefixes for some commonly used objects
var SIG_STRING = 'R'.charCodeAt(0);

var SIG_MAP = 'M'.charCodeAt(0); // a map with an short key
var SIG_END_MAP = 0;

var readMap = function(stream) {
    var map = [];
    while (true) {
        var key = readObject(stream);
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

var readObject = function(stream) {
    var sig = stream.read();
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

var nameIndex;
var hashIndex;
var childCountIndex;
var childIndex = [];
var pTable;

var parseNodeObj = function(nodeData) {
    var name = nodeData[nameIndex];
    var hash = parseInt(nodeData[hashIndex]).toString(16).toLowerCase();

    var node = new ViewNode(name + "@" + hash);
    for (var i = 0; i < nodeData.length; i++) {
        if (nodeData[i] == undefined || nodeData[i] == null || nodeData[i].constructor == Array) {
            continue;
        }
        if (pTable[i].indexOf("meta:") == 0) {
            continue;
        }
        var property = new VN_Property(pTable[i]);
        property.value = nodeData[i];

        node.properties.push(property);
        node.namedProperties[property.name] = property;
    }

    if (nodeData[childCountIndex]) {
        var total = nodeData[childCountIndex];
        for (var i = 0; i < total; i++) {
            var child = parseNodeObj(nodeData[childIndex[i]]);
            node.children.push(child);
        }
    }

    node.sortProperties();
    node.loadCommonProperties();

    return node;
}

var parseNode = function(bytes, bitShift) {
    var bytesLen = bytes.length;
    var stream = new DataInputStream(bytes);
    stream.pos = bitShift;

    var views = [];
    var globalProps = {};

    while (stream.pos < bytesLen) {
        var obj = readObject(stream);
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

    for (var i = 0; i < pTable.length; i++) {
        if (pTable[i] != undefined && pTable[i].indexOf("meta:__child__") == 0) {
            childIndex[parseInt(pTable[i].substr(14))] = i;
        }
    }

    var root = parseNodeObj(views[0]);
    root.updateNodeDrawn();

    var windowLeftIndex = pTable.indexOf("window:left");
    var windowTopIndex = pTable.indexOf("window:top");
    if (windowLeftIndex >= 0 && windowTopIndex >= 0) {
        root.windowX = globalProps[windowLeftIndex];
        root.windowY = globalProps[windowTopIndex];
    }
    return root;
}
