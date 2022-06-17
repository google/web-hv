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

self.onmessage = function(e) {
    let reader = new FileReader();
    reader.onload = function () {
        handleLoadFile(reader).catch(function(e) {
            postMessage({type: TYPE_ERROR, message: e + ""});
        });
    }
    reader.readAsArrayBuffer(e.data);
}

async function handleLoadFile(reader) {
    let zip = new JSZip(reader.result);

    // Try loading as bug report
    {
        let list = [];
        let display_size = { };

        // Check for visible_windows.zip
        let viewDump = zip.file("visible_windows.zip");
        if (viewDump != null) {
            try {
                let viewDumpZip = new JSZip(viewDump.asArrayBuffer());
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

        let bugFile = zip.file(/^bugreport/);
        if (bugFile != null && bugFile.length == 1) {
            return loadBugFile(bugFile[0], list, display_size);
        }
    }

    let config = JSON.parse(zip.file("config.json").asText());
    let appInfo = { type: TYPE_ZIP, data: reader.result, config: config, name: config.title };

    if (config.version == 22) {
        // TODO: Investigate better forms of identifying multi-file zip format data.
        appInfo.type = TYPE_MULTI_FILE_ZIP;
    } else if (config.version != 1 || !config.title || zip.file("hierarchy.txt") == null) {
        throw "Missing data"
    }

    postMessage(appInfo);
}

async function loadBugFile(bugFile, list, display_size) {
    if (list.length == 0) {
        throw "No hierarchy found";
    }
    let liner = newLiner(bugFile.asArrayBuffer());
    const PARSING_DATA = [
        {
            key: "windows",
            header: "WINDOW MANAGER WINDOWS (dumpsys window windows)",
            titleRegX: /^(\s+)Window \#\d+ Window\{([a-zA-Z\d]+) [a-zA-Z\d]+ ([^\}\s]+)\}\:/,
            titleGroups: {
                spaces: 1,
                hashCode: 2,
                name: 3,
            },

            entries: {
                ownerUid: / mOwnerUid=(\d+) /,
                display: / containing=\[\d+,\d+\]\[(\d+,\d+)\]/,
                dpi: / mFullConfiguration=\{[^\}]*\b(\d+)dpi\b/
            }
        },
        {
            key: "packages",
            header: "Packages:",
            titleRegX: /^(\s+)Package \[([a-z\_A-Z\d\.\/]+)\] \(([a-zA-Z\d]+)\)\:/,
            titleGroups: {
                spaces: 1,
                hashCode: 3,
                name: 2,
            },

            entries: {
                userId: / userId=(\d+)\b/
            }
        }
    ]

    // Parses a list of sections
    function parseSectionList(parsingEntry) {
        let match;
        let result = [];
        while (match = parsingEntry.titleRegX.exec(liner.next())) {
            let section = {hashCode: match[parsingEntry.titleGroups.hashCode], name: match[parsingEntry.titleGroups.name]};

            parseSection(section, match[parsingEntry.titleGroups.spaces], parsingEntry);
            result.push(section);
        }
        return result;
    }

    function parseSection(output, spaces, parsingEntry) {
        while(liner.peek() != null && liner.peek().startsWith(spaces + " ")) {
            let line = liner.next();
            let match;
            for (let [key, value] of Object.entries(parsingEntry.entries)) {
                if (match = value.exec(line)) {
                    output[key] = match[1];
                }
            }
        }
    }

    let parseData = { };

    let line;
    while ((line = liner.next()) != null) {
        PARSING_DATA.forEach(p => {
            if (p.header == line) {
                let r = parseSectionList(p);
                if (!parseData[p.key] || parseData[p.key].length < r.length) {
                    parseData[p.key] = r;
                }
            }
        })
    }

    if (parseData.windows) {
        list.forEach(entry => {
            parseData.windows.forEach(window => {
                if (`${window.hashCode} ${window.name}` == entry.name) {
                    entry.pid = window.ownerUid;
                    entry.name = window.name;
                    if (window.display) {
                        let parts = window.display.split(",");
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
                list.hasIcons = true;
            }
        });
    }

    list.use_new_api = false;
    postMessage({type: TYPE_BUG_REPORT, list: list});
}

function newLiner(data /* array buffer */) {
    let decoder = new TextDecoder();
    let remaining = data.byteLength;
    let chuckSize = 1 << 22;

    let byteStart = 0;

    let lines = [""];
    let linesIndex = 0;
    let nextLine;

    function parseNextChunk() {
        let length = Math.min(remaining, chuckSize);
        let dataView = new DataView(data, byteStart, length);
        remaining -= length;
        byteStart += chuckSize;
        return decoder.decode(dataView).split("\n");
    }

    function consumeNextLine() {
        let result = nextLine;

        // Initialize the next line
        while (linesIndex >= lines.length - 1 && remaining > 0) {
            let lastRow = lines[lines.length - 1];
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
