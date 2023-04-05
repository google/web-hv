// Copyright 2023 Google LLC
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

importScripts("tl-worker.js")

let classNames
let windowList
let packageName

self.onmessage = function(event) {
    if (event.data.action == TL_ACTION_UNWRAP) {
        protobuf.load("../../protos/view_capture.proto").then(async function(root) {
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