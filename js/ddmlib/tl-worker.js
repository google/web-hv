// Copyright 2022 Google LLC
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

importScripts("property_formatter.js")
importScripts("../../third_party/protobuf.min.js")
importScripts("../../third_party/pako/pako_inflate.min.js")
importScripts("viewnode.js")
importScripts("../constants.js")

let rootNodes /* ViewNode[] */
let formattingIndex = 0
let classNames /* string[] */

self.onmessage = function(event) {
    if (rootNodes == null) {
        let protoData = event.data.tlHvDataAsBinaryArray;
        let protoFile;
        if (event.data.type == TYPE_TIME_LAPSE_BUG_REPORT) {
            protoFile =  "../../protos/view_capture.proto";
            protoData = pako.inflate(protoData);
        } else {
            protoFile = "../../protos/view_capture_deprecated.proto";
        }
        protobuf.load(protoFile).then(function(root) {
            let parsedProto = root
                .lookupType("com.android.launcher3.view.ExportedData")
                .decode(protoData);

            rootNodes = parsedProto.frameData.map(f => f.node)
            classNames = parsedProto.classname;
            postMessage({ frameCount: rootNodes.length })
            formatNextNode()
        })
    } else {
        sendNodeToUiThread(event.data.processedIndex)
    }
}

/* If the Ui thread processes nodes faster than the worker thread can format them,
   wait for the next node to be formatted before sending it. */
function sendNodeToUiThread(processedIndex) {
    if (processedIndex < formattingIndex && processedIndex < rootNodes.length) {
        postMessage({ rootNode: rootNodes[processedIndex] })
    } else {
        setTimeout(sendNodeToUiThread, 1, processedIndex)
    }
}

/* Pause processing for 1 ms so that the worker thread can respond to messages
   sent from the main thread request an additional formatted node to process. */
function formatNextNode() {
    if (formattingIndex < rootNodes.length) {
        formatProperties(rootNodes[formattingIndex], classNames)
        setTimeout(formatNextNode, 1, ++formattingIndex)    
    }
}