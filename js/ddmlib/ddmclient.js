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

class DDMClient {
    constructor(device, callbacks) {
        device.closeAll();

        this.callbacks = callbacks;
        this.device = device;
        this.processCache = {};
        this.iconCache = {};
        this.reloadCount = 0;
        this.usingOldWindowListAPI = true;

        this.iconLoader = device.sendFile("/data/local/tmp/processicon.jar", "commands/processicon.jar");
        this.#loadProp("density", "ro.sf.lcd_density");
        this.#loadProp("sdk_version", "ro.build.version.sdk");
    }

    async #loadProp(property, command) {
        this[property] = -1;
        const msg = await this.device.shellCommand("getprop " + command);
        if (msg != "") {
            this[property] = parseInt(msg);
        }
    }

    async loadOldWindows() {
        // Stop window service and start it again
        await this.device.shellCommand("service call window 2");
        await this.device.shellCommand("service call window 1 i32 4939");

        const stream = this.device.openStream("tcp:4939");
        stream.onReceiveWrite = function (result) {
            result = ab2str(result);
            stream.sendReady();
            if (result.indexOf("LIST UPDATE") > -1) {
                this.#listOldWindows();
                this.#reloadJdwpWindows();
            }
        }.bind(this);
        stream.write("AUTOLIST\n");
        this.#listOldWindows();
    }

    async #listOldWindows() {
        if (!this.usingOldWindowListAPI) return;

        const stream = this.device.openStream("tcp:4939");
        stream.write("LIST\n");
        let list = (await stream.readAll()).trim().split("\n");

        const windowPkgMap = {}
        try {
            let pkgList = (await this.device.shellCommand("pm list packages -U")).toLowerCase().split("\n");
            let uidMap = {}
            for (let i = 0; i < pkgList.length; i++) {
                const k = pkgList[i].match(/package:([^\s]+)\s+uid:(\d+)/);
                if (k) {
                    uidMap[k[2]] = k[1]
                }
            }

            let windowDump = await this.device.shellCommand("dumpsys window windows");
            windowDump = windowDump.toLowerCase().split(/window\s+#\d+\s+window\{([0-9a-f]+)/);
            for (let i = 1; i < windowDump.length; i+=2) {
                const k = (windowDump[i + 1] + " ").match(/mowneruid=(\d+)/);
                if (!k) continue;
                windowPkgMap[windowDump[i]] = uidMap[k[1]];
            }
        } catch (e) {
            // Ignore the extra work
        }

        const result = [];
        for (let i = 0; i < list.length - 1; i++) {
            const parts = list[i].split(" ");
            const windowId = parts[0].trim();

            const windowPkg = windowPkgMap[windowId];
            const iconId = windowPkg ? windowPkg.replaceAll(".", "-") : undefined;
            if (iconId) {
                this.#prefetchIconForPid(windowPkg, iconId);
            }
            result.push({
                type: TYPE_OLD,
                name: parts[1].trim(),
                id: windowId,
                density: this.density,
                sdk_version: this.sdk_version,
                device: this.device,
                use_new_api: false,
                iconId: iconId,
                pname: windowPkg,
                icon: this.iconCache[windowPkg]
            });
        }
        result.use_new_api = false;
        if (this.usingOldWindowListAPI) {
            this.callbacks.windowsLoaded(result);
        }
    }

    async trackProcesses() {
        if (DISABLE_JDWP) {
            return;
        }
        const socket = this.device.openStream("track-jdwp");
        while (true) {
            var data = await socket.read(4);
            const len = parseInt(ab2str(data), 16);

            data = await socket.read(len);
            const list = ab2str(data).trim();
            this.#parseProcessList(list.split("\n"));
        }
    }

    #parseProcessList(list) {
        const oldCache = this.processCache;
        this.processCache = {};
        for (let i = 0; i < list.length; i++) {
            const pid = list[i];
            if (oldCache[pid]) {
                // process already exists
                this.processCache[pid] = oldCache[pid];
                oldCache[pid] = null;
            } else {
                // Load process name
                this.#loadProcessName(pid);
            }
        }

        for (let pid in oldCache) {
            if (oldCache[pid]) {
                if (oldCache[pid].jdwp) {
                    oldCache[pid].jdwp.destroy();
                }
            }
        }
        this.#reloadJdwpWindows();
    }

    async #loadProcessName(pid) {
        const loader = new jdwp(pid, this.device);
        const result = {jdwp: loader, hasError: false};
        this.processCache[pid] = result;

        try {
            const data = await loader.writeChunk("HELO", [0, 0, 0, 1]);
            data.readInt(); // server version
            data.readInt(); // process id

            const vmlen = data.readInt();
            const len = data.readInt();
            data.readStr(vmlen); // VM description len
            result.name = data.readStr(len);
        } catch (e) {
            // Unable to load process name
            result.hasError = true;

            let allError = true;
            for (const mp in this.processCache) {
                allError = allError & this.processCache[mp].hasError;
            }
            if (allError) {
                this.callbacks.jdwpError();
            }
        }
    }

    async #reloadJdwpWindows() {
        this.reloadCount++;
        const myCount = this.reloadCount;

        const windowToIdMap = {};
        for (const pid in this.processCache) {
            this.#loadWindowsForPid(pid, myCount, windowToIdMap).catch(e => { });
        }
    }

    async #loadWindowsForPid(pid, myCount, windowToIdMap) {
        const jdwp = this.processCache[pid].jdwp;
        const data = await jdwp.writeChunk("VULW", [0, 0, 0, 1]);
        if (myCount != this.reloadCount) {
            return;
        }
        const count = data.readInt();
        windowToIdMap[pid] = [];

        for (let i = 0; i < count; i++) {
            const id = data.readStr();
            let name = id;
            this.#prefetchIconForPid(pid, pid);

            if (count == 1) {
                name = name.split("/")[0];
            } else {
                name = name.substr(0, name.lastIndexOf("/"));
            }
            windowToIdMap[pid].push({
                type: TYPE_JDWP,
                pid: pid,
                iconId: pid,
                device: this.device,
                id: id,
                density: this.density,
                sdk_version: this.sdk_version,
                name: name,
                use_new_api: this.sdk_version >= 23,
                pname: this.processCache[pid].name,
                icon: this.iconCache[pid]
            });
        }

        // Merge the list loaded so far
        let windowList = [];
        for (const pid in windowToIdMap) {
            windowList = windowList.concat(windowToIdMap[pid]);
        }
        if (windowList.length == 0) return;

        this.usingOldWindowListAPI = false;
        windowList.sort(function (a, b) {
            if (a.name > b.name) return 1;
            if (a.name < b.name) return -1;
            return 0;
        });

        windowList.use_new_api = this.sdk_version >= 23;
        this.callbacks.windowsLoaded(windowList);
    }

    #prefetchIconForPid(pid, iconId) {
        if (this.iconCache[pid] == undefined) {
            const iconGetter = this.#getIconForPid(pid);
            const that = this;
            iconGetter.then(v => {
                iconGetter.value = v;
                that.callbacks.iconLoaded(iconId, v);
            });
            this.iconCache[pid] = iconGetter;
        }
    }

    async #getIconForPid(pid) {
        await this.iconLoader;
        const response = (await this.device.shellCommand(
            "export CLASSPATH=/data/local/tmp/processicon.jar;exec app_process /system/bin ProcessIcon " + pid)).split("\n", 2);
        if ("OKAY" != response[0]) {
            throw "Unable to fetch icon";
        }
        return createBlobFromDataUrl(response[1], "image/png");
    }
}

function resetActiveState() {
    for (let i = 0; i < ActiveState.length; i++) {
        ActiveState[i]();
    }
    ActiveState = [];
    if (adbDevice) {
        ActiveState.push(function () {
            adbDevice.closeAll();
        });
    }
}

function createViewController(appInfo) {
    resetActiveState();

    if (appInfo.type == TYPE_ZIP) {
        return new OfflineServiceController(appInfo)
    } else if (appInfo.type == TYPE_OLD) {
        return new ViewServiceController(appInfo);
    } else if (appInfo.type == TYPE_BUG_REPORT) {
        return new BugReportServiceControllerLegacy(appInfo);
    } else if (appInfo.type == TYPE_BUG_REPORT_V2) {
        return new BugReportServiceController(appInfo);
    } else {
        return new JdwpController(appInfo);
    }
}

function parseViewData(data, cmd, callback) {
    const w = createWorker("js/ddmlib/worker.js");
    w.onerror = function () {
        callback.reject("Error parsing view data");
    }
    w.onmessage = function (e) {
        callback.accept(e.data.viewHierarchyData);
    }
    w.postMessage({ cmd: cmd, data: data });
}

/**
 * Controller based on offline data
 */
class OfflineServiceController {
    constructor(appInfo) {
        this.zip = appInfo.data;
        this.density = appInfo.config.density ? appInfo.config.density : -1;
        this.sdk_version = appInfo.config.sdk_version ? appInfo.config.sdk_version : -1;
        this.use_new_api = appInfo.config.use_new_api;
    }
    loadViewList() {
        const result = deferred();
        const text = this.zip.file("hierarchy.txt").asText();
        if (!text) {
            result.reject("Unable to load data");
        }
        else {
            let cmd = CMD_PARSE_OLD_DATA;
            if (!this.use_new_api) {
                cmd = cmd | CMD_USE_PROPERTY_MAP;
            }
            parseViewData(text, cmd, result);
        }
        return result;
    }
    async captureView(viewName) {
        const file = this.zip.file("img/" + viewName + ".png");
        if (!file) {
            throw "Image not found";
        }
        return file.asUint8Array();
    }
}

class OtioseServiceController {
    constructor() {
        this.hasNoImage = true;
    }
    loadViewList() {
        throw "loadViewList() is not implemented. You might be using the wrong ServiceController.";
    }

    async captureView(viewName) {
        throw "Image not found"
    }
}

class BugReportServiceController {
    constructor(appInfo) {
        this.data = appInfo.data;
        this.use_new_api = true;
        const display = appInfo.display;
        this.display = null;
        if (display.width != undefined && display.width > 0 && display.height != undefined && display.height > 0) {
            this.display = display;
            if (display.density > 0) {
                this.density = display.density;
            }
        }
        this.hasNoImage = true;
    }

    loadViewList_(result) {
        parseViewData(this.data, 0, result);
    }
    loadViewList() {
        const result = deferred();
        this.loadViewList_(result);

        if (this.display != null) {
            const that = this;
            result.then(node => {
                if (node.windowX != undefined && node.windowY != undefined) {
                    const crop = [node.windowX, node.windowY, node.width, node.height];
                    that.loadScreenshot = function () {
                        return pickPngAndCrop(that.display, crop);
                    };
                }
            });
        }
        return result;
    }

    async captureView(viewName) {
        throw "Image not found";
    }
}

class BugReportServiceControllerLegacy extends BugReportServiceController {
    constructor(appInfo) {
        super(appInfo);
    }

    loadViewList_(result) {
        const bytes = base64ToUint8Array(this.data)
        parseViewData(bytes, CMD_DEFLATE_STRING, result);
    }
}

function pickPngAndCrop(display, crop) {
    const result = deferred();
    const el = $("<input type='file' accept='.png' />");
    el.on("change", function () {
		if (!this.files || this.files.length < 1) {
			return;
		}
        const file = this.files[0];
		const reader = new FileReader();
		reader.onload = function () {
            const img = createImageBitmap(new Blob([new Uint8Array(reader.result)]));
            img.then(d => {
                const canvas = document.createElement('canvas');
                canvas.width = crop[2]; canvas.height = crop[3];
                const ctx = canvas.getContext('2d');
                const sx = d.width / display.width;
                const sy = d.height / display.height;
                ctx.drawImage(d, crop[0] * sx, crop[1] * sy, crop[2] * sx, crop[3] * sy, 0, 0, crop[2], crop[3]);

                const dataurl = canvas.toDataURL();
                const arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1];
                result.accept(createBlobFromDataUrl(arr[1], mime));
            });
		}
		reader.readAsArrayBuffer(file);
    });
    el.click();
    return result;
}

function createBlobFromDataUrl(dataUrl, mime) {
    const bstr = atob(dataUrl);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return createUrl(new Blob([u8arr], {type:mime}));
}

function searializeNode(root) {
    let result = "";

    const printNode = function (node, shift) {
        let line = shift + node.name + " ";
        for (let i = 0; i < node.properties.length; i++) {
            const p = node.properties[i];
            let value = p.value + "";
            if (value == "") value = "null";
            value = value.replace(/(\r|\n)/g, ' ');

            line += p.fullname + "=" + value.length + "," + value + " ";
        }
        result += line + "\n";
        for (let i = 0; i < node.children.length; i++) {
            printNode(node.children[i], shift + " ");
        }
    }
    printNode(root, "");
    result += "DONE.\n";
    return result;
}

/**
 * Merger to read all data as byte array.
 */
class ByteResponseMerger{
    result = null;

    #completed = false;
    #decoder = new TextDecoder();

    merge(data) {
        this.result = this.result ? appendBuffer(this.result, data) : data;
        this.#completed = this.#decoder.decode(data).endsWith("DONE\n");
    }

    isComplete() {
        return this.#completed;
    }
}

/**
 * Controller based on view service
 */
class ViewServiceController {
    constructor(appInfo) {
        this.id = appInfo.id;
        this.port = appInfo.port;
        this.density = appInfo.density;
        this.sdk_version = appInfo.sdk_version;
        this.use_new_api = false;
        this.device = appInfo.device;
        if (this.sdk_version < 34) {
            this.customCommand = null;
        }
    }
    async loadViewList() {
        const stream = this.device.openStream("tcp:4939");

        // Sometime the stream doesn't close, so close forcefully
        let responseMerger = new TextResponseMerger();
        responseMerger.isComplete = () => responseMerger.result.endsWith("\nDONE\n");
        stream.write("DUMP " + this.id + "\n");
        const text = await stream.readAll(responseMerger);
        const result = deferred();
        parseViewData(text, CMD_PARSE_OLD_DATA | CMD_USE_PROPERTY_MAP, result);
        return await result;
    }
    captureView(viewName) {
        const stream = this.device.openStream("tcp:4939");
        stream.write("CAPTURE " + this.id + " " + viewName + "\n");
        return stream.readAll(new ByteResponseMerger());
    }
    profileView(viewName) {
        const stream = this.device.openStream("tcp:4939");
        stream.write("PROFILE " + this.id + " " + viewName + "\n");

        // Sometime the stream doesn't close, so close forcefully
        let responseMerger = new TextResponseMerger();
        responseMerger.isComplete = () => responseMerger.result.endsWith("\nDONE\n");
        return stream.readAll(responseMerger);
    }
    customCommand(viewName, commandData) {
        // Separate the method name from rest of the data
        const inputStream = new DataInputStream(new Uint8Array(commandData));
        const methodName = inputStream.readStr();

        // Convert params to base64
        var params = '';
        for (var i = inputStream.pos; i < commandData.length; i++) {
            params += String.fromCharCode( commandData[ i ] );
        }
        params = window.btoa(params);

        const stream = this.device.openStream("tcp:4939");
        stream.write(`INVOKE_METHOD ${this.id} ${viewName} ${methodName} ${params} \n`);
        return stream.readAll(new ByteResponseMerger());
    }
}

/**
 * Controller based on jdwp protocol
 */
class JdwpController {
    constructor(appInfo) {
        this.windowId = appInfo.id;
        this.pid = appInfo.pid;
        this.device = appInfo.device;
        this.density = appInfo.density;
        this.sdk_version = appInfo.sdk_version;
        this.jdwp = new jdwp(this.pid, this.device);
        this.use_new_api = appInfo.use_new_api;
    }
    async loadViewList() {
        const req = new DataOutputStream();
        req.writeInt(1); // VURT_DUMP_HIERARCHY
        req.writeStr(this.windowId); // root view
        req.writeInt(0); // Do not skip children
        req.writeInt(1); // Include properties
        let cmd = CMD_CONVERT_TO_STRING | CMD_PARSE_OLD_DATA | CMD_USE_PROPERTY_MAP;
        if (this.use_new_api) {
            req.writeInt(1); // Use v2
            cmd = CMD_SKIP_8_BITS;
        }
        const reader = await this.jdwp.writeChunk("VURT", req);
        throwIfFail(reader);
        const result = deferred();
        parseViewData(reader.data, cmd, result);
        return await result;
    }
    async captureView(viewName) {
        const req = new DataOutputStream();
        req.writeInt(1); // VUOP_CAPTURE_VIEW
        req.writeStr(this.windowId); // root view
        req.writeStr(viewName); // target view
        const reader = await this.jdwp.writeChunk("VUOP", req);
        throwIfFail(reader);
        return new Uint8Array(reader.data.buffer, 8);
    }
    async profileView(viewName) {
        const req = new DataOutputStream();
        req.writeInt(3); // VUOP_PROFILE_VIEW
        req.writeStr(this.windowId); // root view
        req.writeStr(viewName); // target view
        const reader = await this.jdwp.writeChunk("VUOP", req);
        throwIfFail(reader);
        return new TextDecoder().decode(new Uint8Array(reader.data.buffer, 8));
    }
    async customCommand(viewName, commandData) {
        const req = new DataOutputStream();
        req.writeInt(4); // VUOP_INVOKE_VIEW_METHOD
        req.writeStr(this.windowId); // root view
        req.writeStr(viewName); // target view
        req.writeBytes(commandData);
        const reader = await this.jdwp.writeChunk("VUOP", req);
        throwIfFail(reader);
    }
}

function throwIfFail(reader) {
    if (reader.chunkType == getChunkType("FAIL")) {
        reader.readInt();   // Error code
        throw reader.readStr();
    }
}