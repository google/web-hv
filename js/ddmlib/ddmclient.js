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

const DISABLE_JDWP = false;

function DDMClient(device, callbacks) {
    this.callbacks = callbacks;
    this.device = device;
    this.processCache = {};
    this.reloadCount = 0;
    this.workingOnWindowList = true;
    this.processNameErrorCount = 0;
    this.processCount = 0;

    this.loadProp("density", "ro.sf.lcd_density");
    this.loadProp("sdk_version", "ro.build.version.sdk");
}

DDMClient.prototype.loadProp = async function (property, command) {
    this[property] = -1;
    var msg = await this.device.shellCommand("getprop " + command);
    if (msg != "") {
        this[property] = parseInt(msg);
    }
}

DDMClient.prototype.loadOldWindows = async function () {
    // Stop window service and start it again
    await this.device.shellCommand("service call window 2");
    await this.device.shellCommand("service call window 1 i32 4939");

    var stream = this.device.openStream("tcp:4939");
    stream.onReceiveWrite = function (result) {
        result = ab2str(result);
        stream.sendReady();
        if (result.indexOf("LIST UPDATE") > -1) {
            this._listOldWindows();
            this.reloadWindows();
        }
    }.bind(this);
    stream.write("AUTOLIST\n");
    this._listOldWindows();
}

DDMClient.prototype._listOldWindows = async function () {
    if (!this.workingOnWindowList) return;

    var stream = this.device.openStream("tcp:4939");
    stream.write("LIST\n");

    var list = await stream.readAll();
    list = list.trim().split("\n");

    var result = [];
    for (var i = 0; i < list.length - 1; i++) {
        var parts = list[i].split(" ");
        result.push({
            type: TYPE_OLD,
            name: parts[1].trim(),
            id: parts[0].trim(),
            density: this.density,
            sdk_version: this.sdk_version,
            device: this.device,
            use_new_api : false
        });
    };
    result.use_new_api = false;
    if (this.workingOnWindowList) {
        this.callbacks.windowsLoaded(result);
    }
}

DDMClient.prototype.readProcessList = function (socket) {
    var that = this;
    socket.read(4, function (data) {
        var len = parseInt(ab2str(data), 16);
        socket.read(len, function (data) {
            var list = ab2str(data).trim();
            that.parseProcessList(list.split("\n"));
            that.readProcessList(socket);
        });
    });
}

DDMClient.prototype.trackProcesses = function () {
    if (DISABLE_JDWP) {
        return;
    }
    var stream = this.device.openStream("track-jdwp");
    this.readProcessList(stream);
}

DDMClient.prototype.parseProcessList = function (list) {
    var oldCache = this.processCache;
    var newCache = {};
    this.processCache = newCache;
    this.processCount = list.length;
    for (var i = 0; i < list.length; i++) {
        var pid = list[i];
        if (oldCache[pid]) {
            // process already exists
            newCache[pid] = oldCache[pid];
            oldCache[pid] = null;
        } else {
            // Load process name
            this.loadProcessName(pid);
        }
    }

    for (var pid in oldCache) {
        if (oldCache[pid]) {
            if (oldCache[pid].jdwp) {
                oldCache[pid].jdwp.destroy();
            }
        }
    }
    this.reloadWindows();
}

DDMClient.prototype.loadProcessName = async function (pid) {
    var loader = new jdwp(pid, this.device);
    this.processCache[pid] = { jdwp: loader };

    try {
        var data = await loader.writeChunk("HELO", [0, 0, 0, 1]);
        data.readInt(); // server version
        data.readInt(); // process id

        var vmlen = data.readInt();
        var len = data.readInt();
        data.readStr(vmlen);    // VM description len

        var name = data.readStr(len);

        if (this.processCache[pid]) {
            this.processCache[pid].name = name;
        }
    } catch (e) {
        // Unable to load process name
        this.processNameErrorCount++;
        if (this.processNameErrorCount >= this.processCount) {
            this.callbacks.jdwpError();
        }
    }
}

DDMClient.prototype.reloadWindows = async function () {
    this.reloadCount++;
    var myCount = this.reloadCount;

    var windowToIdMap = {};

    for (var pid in this.processCache) {
        this._loadWindowsForPid(pid, myCount, windowToIdMap);
    }
}

DDMClient.prototype._newWindowLoaded = function (myCount, windowToIdMap) {
    if (myCount != this.reloadCount) {
        // This is called from some old call
        return;
    }
    var windowList = [];
    for (var pid in windowToIdMap) {
        windowList = windowList.concat(windowToIdMap[pid]);
    }
    if (windowList.length == 0) return;
    if (this.workingOnWindowList) {
        this.workingOnWindowList = false;
    }
    windowList.sort(function (a, b) {
        if (a.name > b.name) return 1;
        if (a.name < b.name) return -1;
        return 0;
    });

    windowList.use_new_api = this.sdk_version >= 23;
    this.callbacks.windowsLoaded(windowList);
}

DDMClient.prototype._loadWindowsForPid = async function (pid, myCount, windowToIdMap) {
    let jdwp = this.processCache[pid].jdwp;
    var data = await jdwp.writeChunk("VULW", [0, 0, 0, 1]);
    if (myCount != this.reloadCount) {
        return;
    }
    var count = data.readInt();
    var windowList = [];
    for (var i = 0; i < count; i++) {
        var id = data.readStr();
        var name = id;
        if (count == 1) {
            name = name.split("/")[0];
        } else {
            name = name.substr(0, name.lastIndexOf("/"));
        }
        windowList.push({
            type: TYPE_JDWP,
            pid: pid,
            device: this.device,
            id: id,
            density: this.density,
            sdk_version: this.sdk_version,
            name: name,
            use_new_api: this.sdk_version >= 23,
            pname: this.processCache[pid].name
        });
    }
    windowToIdMap[pid] = windowList;
    this._newWindowLoaded(myCount, windowToIdMap);
}

function createViewController(appInfo) {
    // Reset state
    for (var i = 0; i < ActiveState.length; i++) {
        ActiveState[i]();
    }
    ActiveState = [];
    if (adbDevice) {
        ActiveState.push(function () {
            adbDevice.closeAll();
        });
    }

    if (appInfo.type == TYPE_ZIP) {
        return new OfflineServiceController(appInfo)
    } else if (appInfo.type == TYPE_OLD) {
        return new ViewServiceController(appInfo);
    } else if (appInfo.type == TYPE_BUG_REPORT) {
        return new BugReportServiceController(appInfo);
    } else {
        return new JdwpController(appInfo);
    }
}

function parseViewData(data, cmd, callback) {
    var w = createWorker("js/ddmlib/worker.js");
    w.onerror = function () {
        callback.reject("Error parsing view data");
    }
    w.onmessage = function (e) {
        var root = e.data.root;
        var setParent = function (node) {
            for (var i = 0; i < node.children.length; i++) {
                node.children[i].parent = node;
                setParent(node.children[i]);
            }

            // Update named properties.
            node.namedProperties = {};
            for (var i = 0; i < node.properties.length; i++) {
                node.namedProperties[node.properties[i].fullname] = node.properties[i];
            }
        }
        setParent(root);
        callback.accept(root);
    }
    w.postMessage({ cmd: cmd, data: data });
}

/**
 * Controller based on offline data
 */
function OfflineServiceController(appInfo) {
    this.zip = appInfo.data;
    this.density = appInfo.config.density ? appInfo.config.density : -1;
    this.sdk_version = appInfo.config.sdk_version ? appInfo.config.sdk_version : -1;
    this.use_new_api = appInfo.config.use_new_api;
}
OfflineServiceController.prototype.loadViewList = function () {
    var result = deferred();
    var text = this.zip.file("hierarchy.txt").asText();
    if (!text) {
        result.reject("Unable to load data");
    } else {
        var cmd = CMD_PARSE_OLD_DATA;
        if (!this.use_new_api) {
            cmd = cmd | CMD_USE_PROPERTY_MAP;
        }
        parseViewData(text, cmd, result);
    }
    return result;
}

OfflineServiceController.prototype.captureView = async function (viewName) {
    var file = this.zip.file("img/" + viewName + ".png");
    if (!file) {
        throw "Image not found";
    }
    return file.asUint8Array();
}

function BugReportServiceController(appInfo) {
    this.data = appInfo.data;
    this.use_new_api = true;

    var display = appInfo.display;
    this.display = null;
    if (display.width != undefined && display.width > 0 && display.height != undefined && display.height > 0) {
        this.display = display;
        if (display.density > 0) {
            this.density = display.density;
        }
    }
}

var base64toBinary = function (base64) {
    var binary_string = atob(base64);
    var len = binary_string.length;
	var bytes = new Uint8Array( len );
    for (var i = 0; i < len; i++)        {
        var ascii = binary_string.charCodeAt(i);
		bytes[i] = ascii;
    }
    return bytes;
}

BugReportServiceController.prototype.loadViewList = function () {
    var result = deferred();
    parseViewData(base64toBinary(this.data), CMD_DEFLATE_STRING, result);

    if (this.display != null) {
        var that = this;
        result.then(node => {
            if (node.windowX != undefined && node.windowY != undefined) {
                var crop = [node.windowX, node.windowY, node.width, node.height];
                that.loadScreenshot = function() {
                   return pickPngAndCrop(that.display, crop);
                };
            }
        })
    }
    return result;
}

BugReportServiceController.prototype.captureView = async function (viewName) {
    throw "Image not found";
}

function pickPngAndCrop(display, crop) {
    var result = deferred();
    var el = $("<input type='file' accept='.png' />");
    el.on("change", function () {
		if (!this.files || this.files.length < 1) {
			return;
		}
        var file = this.files[0];
		var reader = new FileReader();
		reader.onload = function () {
            var img = createImageBitmap(new Blob([new Uint8Array(reader.result)]));
            img.then(d => {
                var canvas = document.createElement('canvas');
                canvas.width = crop[2]; canvas.height = crop[3];
                var ctx = canvas.getContext('2d');
                var sx = d.width / display.width;
                var sy = d.height / display.height;
                ctx.drawImage(d, crop[0] * sx, crop[1] * sy, crop[2] * sx, crop[3] * sy, 0, 0, crop[2], crop[3]);

                var dataurl = canvas.toDataURL();
                var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
                bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
                while(n--){
                    u8arr[n] = bstr.charCodeAt(n);
                }
                result.accept(createUrl(new Blob([u8arr], {type:mime})));
            });
		}
		reader.readAsArrayBuffer(file);
    });
    el.click();
    return result;
}

function searializeNode(root) {
    var result = "";

    var printNode = function (node, shift) {
        var line = shift + node.name + " ";
        for (var i = 0; i < node.properties.length; i++) {
            var p = node.properties[i];
            var value = p.value + "";
            if (value == "") value = "null";
            value = value.replace(/(\r|\n)/g, ' ');

            line += p.fullname + "=" + value.length + "," + value + " ";
        }
        result += line + "\n";
        for (var i = 0; i < node.children.length; i++) {
            printNode(node.children[i], shift + " ");
        }
    }
    printNode(root, "");
    result += "DONE.\n";
    return result;
}

/**
 * Controller based on view service
 */
function ViewServiceController(appInfo) {
    this.id = appInfo.id;
    this.port = appInfo.port;
    this.density = appInfo.density;
    this.sdk_version = appInfo.sdk_version;
    this.use_new_api = false;
    this.device = appInfo.device;
}

ViewServiceController.prototype.loadViewList = async function () {
    var stream = this.device.openStream("tcp:4939");
    stream.write("DUMP " + this.id + "\n");
    var text = await stream.readAll();
    var result = deferred();    
    parseViewData(text, CMD_PARSE_OLD_DATA | CMD_USE_PROPERTY_MAP, result);
    return await result;
}

ViewServiceController.prototype.captureView = function (viewName) {
    var stream = this.device.openStream("tcp:4939");
    stream.write("CAPTURE " + this.id + " " + viewName + "\n");
    return stream.readAll(new ByteResponseMerger());
}

ViewServiceController.prototype.profileView = function (viewName) {
    var stream = this.device.openStream("tcp:4939");
    stream.write("PROFILE " + this.id + " " + viewName + "\n");
    return stream.readAll();
}

/**
 * Controller based on jdwp protocol
 */
function JdwpController(appInfo) {
    this.windowId = appInfo.id;
    this.pid = appInfo.pid;
    this.device = appInfo.device;
    this.density = appInfo.density;
    this.sdk_version = appInfo.sdk_version;
    this.jdwp = new jdwp(this.pid, this.device);
    this.use_new_api = appInfo.use_new_api;
}

JdwpController.prototype.loadViewList = async function () {
    var req = new DataOutputStream();
    req.writeInt(1);                // VURT_DUMP_HIERARCHY
    req.writeStr(this.windowId);    // root view
    req.writeInt(0);                // Do not skip children
    req.writeInt(1);                // Include properties

    var cmd = CMD_CONVERT_TO_STRING | CMD_PARSE_OLD_DATA | CMD_USE_PROPERTY_MAP;
    if (this.use_new_api) {
        req.writeInt(1);                // Use v2
        cmd = 0;
    }
    var reader = await this.jdwp.writeChunk("VURT", req);
    throwIfFail(reader);    

    var result = deferred();
    parseViewData(reader.data, cmd, result);
    return await result;
}

JdwpController.prototype.captureView = async function (viewName) {
    var req = new DataOutputStream();
    req.writeInt(1);                // VUOP_CAPTURE_VIEW
    req.writeStr(this.windowId);    // root view
    req.writeStr(viewName);         // target view

    var reader = await this.jdwp.writeChunk("VUOP", req)
    throwIfFail(reader);
    return new Uint8Array(reader.data.buffer, 8);
}

JdwpController.prototype.profileView = async function(viewName) {
    var req = new DataOutputStream();
    req.writeInt(3);                // VUOP_PROFILE_VIEW
    req.writeStr(this.windowId);    // root view
    req.writeStr(viewName);         // target view

    var reader = await this.jdwp.writeChunk("VUOP", req);
    throwIfFail(reader);
    return new TextDecoder().decode(new Uint8Array(reader.data.buffer, 8));
}

JdwpController.prototype.customCommand = async function (viewName, commandData) {
    var req = new DataOutputStream();
    req.writeInt(4);                // VUOP_INVOKE_VIEW_METHOD
    req.writeStr(this.windowId);    // root view
    req.writeStr(viewName);         // target view
    req.writeBytes(commandData);

    var reader = await this.jdwp.writeChunk("VUOP", req);
    throwIfFail(reader);
}

function throwIfFail(reader) {
    if (reader.chunkType == getChunkType("FAIL")) {
        reader.readInt();   // Error code
        throw reader.readStr();
    }
}