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

importScripts("../third_party/jszip.min.js");
importScripts("constants.js");
importScripts("utils.js")

self.onmessage = function(e) {
    const reader = new FileReader();
    reader.onload = function () {
        handleLoadFile(reader).catch(function(e) {
            postMessage({type: TYPE_ERROR, message: e + ""});
        });
    }
    reader.readAsArrayBuffer(e.data);
}

async function handleLoadFile(reader) {
    const zip = new JSZip(reader.result);

    // Try loading as bug report
    {
        const list = [];
        const display_size = { };

        // Check for visible_windows.zip
        const viewDump = zip.file("visible_windows.zip");
        if (viewDump != null) {
            try {
                const viewDumpZip = new JSZip(viewDump.asArrayBuffer());
                for (x in viewDumpZip.files) {
                    list.push({
                        name: x,
                        data: viewDumpZip.files[x].asUint8Array(),
                        type: TYPE_BUG_REPORT_V2,
                        display: display_size
                    })
                }
            } catch (e) {
                console.log("Error", e);
            }
        }

        const bugFile = zip.file(/^bugreport/);
        if (bugFile != null && bugFile.length == 1) {
            return loadBugFile(bugFile[0], list);
        }
    }

    const config = JSON.parse(zip.file("config.json").asText());
    const appInfo = { type: TYPE_ZIP, data: reader.result, config: config, name: config.title };

    if (config.version != 1 || !config.title || zip.file("hierarchy.txt") == null) {
        throw "Missing data"
    }

    postMessage(appInfo);
}

async function loadBugFile(bugFile, list) {
    if (list.length == 0) {
        throw "No hierarchy found";
    }
    const liner = newLiner(bugFile.asArrayBuffer());
    const PARSING_DATA = [
        {
            key: "windows",
            header: "WINDOW MANAGER WINDOWS (dumpsys window windows)",
            titleRegX: /^(\s+)Window #\d+ Window\{([a-zA-Z\d]+) [a-zA-Z\d]+ ([^}\s]+)\}:/,
            titleGroups: {
                hashCode: 2,
                name: 3,
            },

            entries: {
                ownerUid: / mOwnerUid=(\d+) /,
                display: / containing=\[\d+,\d+\]\[(\d+,\d+)\]/,
                dpi: / mFullConfiguration=\{[^}]*\b(\d+)dpi\b/
            }
        },
        {
            key: "packages",
            header: "Packages:",
            titleRegX: /^(\s+)Package \[([a-z_A-Z\d./]+)\] \(([a-zA-Z\d]+)\):/,
            titleGroups: {
                hashCode: 3,
                name: 2,
            },

            entries: {
                userId: / userId=(\d+)\b/
            }
        },
        {
            key: "timelapse",
            header: "ContinuousViewCapture:",
            titleRegX: /^\s+window ([^\:\s]+):/,
            titleGroups: {
                hashCode: 2,
                name: 1,
            },

            entries: {
                pname: /\s+pkg:([a-zA-Z\d\.]+)\b/,
                data: /\s+data:(.+)$/
            }
        }
    ]

    // Parses a list of sections
    function parseSectionList(parsingEntry, spacesLength) {
        let match;
        const result = [];

        let spaces = " ";
        for (let i = 1; i < spacesLength; i++) {
            spaces += " ";
        }


        let lastSection = null;
        while(liner.peek() != null && liner.peek().startsWith(spaces)) {
            const line = liner.next();
            if (match = parsingEntry.titleRegX.exec(line)) {
                if (lastSection != null) {
                    result.push(lastSection);
                }

                lastSection = {hashCode: match[parsingEntry.titleGroups.hashCode], name: match[parsingEntry.titleGroups.name]};
            } else if (lastSection != null) {
                for (const [key, value] of Object.entries(parsingEntry.entries)) {
                    if (match = value.exec(line)) {
                        lastSection[key] = match[1];
                    }
                }
            }
        }

        if (lastSection != null) {
            result.push(lastSection);
        }
        return result;
    }

    const parseData = { };

    let line;
    while ((line = liner.next()) != null) {
        if (VIEW_CAPTURE_REGEX.test(line)) {
            const tlHvDataAsBase64String = line.replace(VIEW_CAPTURE_REGEX, "")
            const tlHvDataAsBinaryArray = base64ToUint8Array(tlHvDataAsBase64String)

            list.push({
                name: "Launcher's View Capture",
                data: tlHvDataAsBinaryArray,
                type: TYPE_TIME_LAPSE_BUG_REPORT_DEPRECATED,
                isTimeLapse: true,
                display: { }
            })
        } else {
            PARSING_DATA.forEach(p => {
                if (p.header == line.trim()) {
                    const r = parseSectionList(p, line.indexOf(p.header));
                    if (!parseData[p.key]) {
                        parseData[p.key] = [];
                    }
                    r.forEach(e => parseData[p.key].push(e));
                }
            })
        }
    }

    if (parseData.timelapse) {
        parseData.timelapse.forEach(e => {
            if (!e.data) {
                return;
            }
            try {
                let data = base64ToUint8Array(e.data);
                list.push({
                    name: `ViewCapture: ${e.name}`,
                    data: data,
                    type: TYPE_TIME_LAPSE_BUG_REPORT,
                    isTimeLapse: true,
                    pname: e.pname,
                    display: { }
                })
            } catch(e) { }

        });
    }

    if (parseData.windows) {
        list.forEach(entry => {
            parseData.windows.forEach(window => {
                if (`${window.hashCode} ${window.name}` == entry.name) {
                    entry.pid = window.ownerUid;
                    entry.name = window.name;
                    if (window.display) {
                        const parts = window.display.split(",");
                        entry.display = {
                            width: parseInt(parts[0]),
                            height: parseInt(parts[1])
                        }
                    }
                    if (window.dpi) {
                        if (!entry.display) {
                            entry.display = { };
                        }
                        entry.display.density = parseInt(window.dpi)
                    }
                }
            })

            if (parseData.packages) {
                parseData.packages.forEach(pkg => {
                    if (pkg.userId && pkg.userId == entry.pid) {
                        entry.pname = pkg.name;
                    }
                })
            }

            if (entry.pname && !entry.pname.startsWith("com.android")) {
                entry.icon = {
                    value: `http://cdn.apk-cloud.com/detail/image/${entry.pname}-w250.png`
                }
            }
        });
    }

    list.use_new_api = false;
    postMessage({type: TYPE_BUG_REPORT, list: list});
}

function newLiner(data /* array buffer */) {
    const decoder = new TextDecoder();
    let remaining = data.byteLength;
    const chuckSize = 1 << 22;

    let byteStart = 0;

    let lines = [""];
    let linesIndex = 0;
    let nextLine;

    function parseNextChunk() {
        const length = Math.min(remaining, chuckSize);
        const dataView = new DataView(data, byteStart, length);
        remaining -= length;
        byteStart += chuckSize;
        return decoder.decode(dataView).split("\n");
    }

    function consumeNextLine() {
        const result = nextLine;

        // Initialize the next line
        while (linesIndex >= lines.length - 1 && remaining > 0) {
            const lastRow = lines[lines.length - 1];
            lines = parseNextChunk();
            // Merge the very last line with the first line of next chuck
            lines[0] = lastRow + lines[0];
            linesIndex = 0;
        }

        if (linesIndex >= lines.length) {
            nextLine = null;
        } else {
            nextLine = lines[linesIndex];
            linesIndex++;
        }
        return result;
    }

    // Initialize first chuck
    consumeNextLine();

    return {
        peek: function() {
            return nextLine;
        },
        next: consumeNextLine
    }
}
