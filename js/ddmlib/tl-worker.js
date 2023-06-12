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

let classNames
let windowList
let packageName

self.onmessage = function(event) {
    if (event.data.action == TL_ACTION_UNWRAP) {
        const protoFileVersion = (hasMagicNumber(event.data.data))
            ? "magic_number"
            : "multi_window"
        protobuf.load(`../../protos/view_capture_${protoFileVersion}.proto`).then(async function(root) {
            const exportedData = root
                .lookupType("com.android.app.viewcapture.data.ExportedData")
                .decode(event.data.data)
            classNames = exportedData.classname
            windowList = exportedData.windowData
            packageName = exportedData.package

            for (let i = 0; i < windowList.length; i++) {
                postMessage({ title: packageName + windowList[i].title, index: i})
            }
        })
    } else if (event.data.action == TL_ACTION_LOAD_WINDOW) {
        processFrames(windowList[event.data.index], classNames)
    }
}

const processFrames = function (frameListContainer, classNameList) {
    const rootNodes /* ViewNode[] */ = frameListContainer.frameData.map(f => f.node)
    postMessage({ frameCount: rootNodes.length })

    for (let i = 0; i < rootNodes.length; i++) {
        formatProperties(rootNodes[i], classNameList)
        postMessage({ rootNode: rootNodes[i] })
    }
}

const hasMagicNumber = function(uInt8Array) {
    const MAGIC_NUMBER = [0x9, 0x78, 0x65, 0x90, 0x65, 0x73, 0x82, 0x65, 0x68]

    const arrayEquals = function(one, other) {
        if (one.length !== other.length) {
          return false;
        }

        for (let i = 0; i < one.length; i++) {
          if (one[i] !== other[i]) {
            return false;
          }
        }

        return true;
    }

    return arrayEquals(MAGIC_NUMBER, uInt8Array.slice(0, MAGIC_NUMBER.length))
}