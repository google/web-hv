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

self.onmessage = function(event) {
    protobuf.load("../../protos/view_capture.proto").then(async function(root) {
        const parsedProto = root
            .lookupType("com.android.launcher3.view.ExportedData")
            .decode(pako.inflate(event.data.tlHvDataAsBinaryArray));

        const rootNodes /* ViewNode[] */ = parsedProto.frameData.map(f => f.node)
        postMessage({ frameCount: rootNodes.length })

        for (let i = 0; i < rootNodes.length; i++) {
            formatProperties(rootNodes[i], parsedProto.classname)
            postMessage({ rootNode: rootNodes[i] })
        }
    })
}