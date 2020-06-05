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

importScripts("viewnode.js");

var CMD_CONVERT_TO_STRING = 1;
var CMD_PARSE_OLD_DATA = 2;
var CMD_USE_PROPERTY_MAP = 4;
var CMD_DEFLATE_STRING = 8;
var CMD_SKIP_8_BITS = 16;

var commonProps = null;

function convertToString(data) {
    var total = data.length;
    var result = "";
    for (var st = 8; st < total; st++) {
        result += String.fromCharCode(data[st]);
    }
    return result;
}

self.onmessage = function(e) {
    var msg = e.data;
    var cmd = msg.cmd;
    var data = msg.data;

    var bitShift = 0;

    if ((cmd & CMD_DEFLATE_STRING) != 0) {
        importScripts("../../third_party/pako/pako_inflate.min.js");
        data = pako.inflate(data);
    }

    if ((cmd & CMD_SKIP_8_BITS) != 0) {
        bitShift = 8;
    }

    if ((cmd & CMD_CONVERT_TO_STRING) != 0) {
        data = convertToString(data);
    }

    if ((cmd & CMD_USE_PROPERTY_MAP) != 0) {
        commonProps = {
            id : "mID",
            left: "mLeft",
            top: "mTop",
            width: "getWidth()",
            height: "getHeight()",
            scrollX: "mScrollX",
            scrollY: "mScrollY",
            willNotDraw: "willNotDraw()",
            clipChildren: "getClipChildren()",
            translationX: "getTranslationX()",
            translationY: "getTranslationY()",
            scaleX: "getScaleX()",
            scaleY: "getScaleY()",
            contentDescription: "getContentDescription()",
            text: "getText()",
            visibility: "getVisibility()"
        }
    }

    if ((cmd & CMD_PARSE_OLD_DATA) != 0) {
        importScripts("parser_v1.js");
    } else {
        importScripts("DataInputStream.js");
        importScripts("parser_v2.js");
    }

    var rootNode = parseNode(data, bitShift);
    postMessage({
        root: rootNode
    });
    close();
}
