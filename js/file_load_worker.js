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
    var reader = new FileReader();
    reader.onload = function () {
        handleLoadFile(reader).catch(function(e) {
            postMessage({type: TYPE_ERROR, message: e + ""});
        });
    }
    reader.readAsArrayBuffer(e.data);
}

async function handleLoadFile(reader) {
    var zip = new JSZip(reader.result);
    var bugFile = zip.file(/^bugreport/);
    if (bugFile != null && bugFile.length == 1) {
        return loadBugFile(bugFile[0]);
    }

    var config = JSON.parse(zip.file("config.json").asText());
    if (config.version != 1 || !config.title || zip.file("hierarchy.txt") == null) {
        throw "Missing data"
    }

    var appInfo = { type: TYPE_ZIP, data: reader.result, config: config, name: config.title };
    postMessage(appInfo);
}

async function loadBugFile(bugFile) {
	var data = bugFile.asText();
	var lines = data.split('\n');

	var list = [];
	var count = lines.length - 1;
	var display_size = { };

	for (var i = 1; i < count; i++) {
		var l = lines[i].trim();
		if (l.startsWith("--encoded-view-dump-v0--")) {
			list.push({
				name: lines[i -1].trim(),
				data: lines[i + 1],
				type: TYPE_BUG_REPORT,
				display: display_size
			})
		} else if (l.startsWith("Display:")) {
			var match = / cur=(\d+)x(\d+) /.exec(lines[i + 1]);
			if (match) {
				display_size.width = parseInt(match[1]);
				display_size.height = parseInt(match[2]);
            }
            match = / (\d+)dpi /.exec(lines[i + 1]);
            if (match) {
                display_size.density = parseInt(match[1]);
            }
		}
    }
    
    if (list.length == 0) {
        throw "No hierarchy found";
    }

    list.use_new_api = false;
    postMessage({type: TYPE_BUG_REPORT, list: list});
}
