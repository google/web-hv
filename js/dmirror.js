// Copyright 2021 Google LLC
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

function createJmuxPlayer(container) {
    console.log("Using jmuxplayer");
    var ret = {
        el: $("<video autoplay>").appendTo(container)
    };

    ret.onFirstFrame = () => { };
    ret.onMetadata = () => { };

    ret.el.on("loadedmetadata", () => {
        ret.onMetadata();
    });

    var jmuxer = new JMuxer({
        node: ret.el.get(0),
        mode: 'video',
        debug: false,
        flushingTime: 1,
        clearBuffer: true,
        fps: 120
    });

    ret.destroy = () => { };
    ret.videoWidth = () => ret.el.get(0).videoWidth;
    ret.videoHeight = () => ret.el.get(0).videoHeight;
    ret.resize = (w, h) => ret.el.css({width: w + "px", height: h + "px"});
    ret.resize(0, 0);

    ret.feed = function(data) {
        var firstFrame = jmuxer.kfCounter <= 0;
        jmuxer.feed({video: data});
        if (firstFrame && jmuxer.kfCounter > 0) {
            ret.onFirstFrame();
        }
    };
    return ret;
}

function createDecoderPlayer(container) {
    console.log("Using video decoder");
    const NDR = 1;
    const IDR = 5;
    const SPS = 7;
    const PPS = 8;

    var ret = {
        el: $("<canvas>").appendTo(container)
    };
    ret.onFirstFrame = () => { };
    ret.onMetadata = () => { };

    var canvas = ret.el.get(0);
    var ctx = canvas.getContext('2d');

    var lastFrame = null;

    async function onFrame(frame) {
        var isFirst = lastFrame == null;
        if (lastFrame != null) {
            lastFrame.close();
        }
        lastFrame = frame;
        if (isFirst) {
            ret.onMetadata();
            ret.onFirstFrame();
        }

        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    }
    let decoder = new VideoDecoder({
        output: onFrame,
        error: e => console.error(e),
    });

    ret.destroy = () => { };
    ret.videoWidth = () => lastFrame.displayWidth;
    ret.videoHeight = () => lastFrame.displayHeight;
    ret.resize = (w, h) => {
        canvas.width = w;
        canvas.height = h;
        if (lastFrame != null) {
            ctx.drawImage(lastFrame, 0, 0, canvas.width, canvas.height);
        }
    }
    ret.resize(0, 0);

    function naul(data) {
        this.data = data;
        this.type = data[0] & 0x1f;
    }

    var pendingFrames = [];
    var pendingBytes = null;
    var configPending = true;

    function createConfig(header) {
        // Create description:
        var sps = header.sps[0].data;
        var pps = header.pps[0].data;
        return {
            codec: 'avc1.' + new DataView(sps.buffer, sps.byteOffset).getUint32(0).toString(16).substr(-6),
            description: Uint8Array.from(
                [1, sps[1], sps[2], sps[3], 255, 0xE0 | 1, (sps.length >> 8) & 0xFF, sps.length & 0xFF]
                .concat(...sps)
                .concat([1, (pps.length >> 8) & 0xFF, pps.length & 0xFF])
                .concat(...pps)),
        }
    }

    function parseNALu(buffer) {
        if (pendingBytes != null) {
            buffer = appendBuffer(pendingBytes, buffer);
        }

        var dv = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        var len = buffer.byteLength - 4;
        let endPos, lastPos = 0;

        for (var i = 0; i < len; i++) {
            if ((dv.getUint32(i) >> 8) == 1) {
                endPos = i;
                if (i > 0 && buffer[i - 1] == 0) {
                    endPos = i - 1;
                }
                if (endPos > lastPos) {
                    pendingFrames.push(new naul(buffer.subarray(lastPos, endPos)))
                }
                lastPos = i + 3;
            }
        }

        pendingBytes = buffer.subarray(lastPos);
    }

    var frameeNo = 0;

    ret.feed = function(data) {
        parseNALu(data);

        if (configPending) {
            var header = {
                sps: [],
                pps: [],
                ready: false
            }
            for (var i = 0; i < pendingFrames.length; i++) {
                switch (pendingFrames[i].type) {
                    case SPS:
                        header.sps.push(pendingFrames[i]);
                        break;
                    case PPS:
                        header.pps.push(pendingFrames[i]);
                        break;
                    case IDR:
                    case NDR:
                        header.ready = true;
                        break;
                }
            }
            if (header.ready && header.pps.length && header.sps.length) {
                decoder.configure(createConfig(header));
                configPending = false;
            }
        }
        if (configPending) {
            return;
        }

        var pendingPayload = null;
        for (var i = 0; i < pendingFrames.length; i++) {
            var push = false;
            var isKey = false;
            switch (pendingFrames[i].type) {
                case IDR:
                case NDR:
                    push = true;
                case SPS:
                case PPS: {
                    var data = pendingFrames[i].data;
                    var load = new Uint8Array(4 + data.byteLength);
                    new DataView(load.buffer).setUint32(0, data.byteLength);
                    load.set(data, 4);

                    isKey = pendingPayload != null;

                    pendingPayload = pendingPayload == null ? load : appendBuffer(pendingPayload, load);
                }
            }
            if (push) {
                var chunk = new EncodedVideoChunk({
                    type: isKey ? "key" : "delta",
                    timestamp: (frameeNo++) * 16,
                    duration: 16,
                    data: pendingPayload
                  });
                  decoder.decode(chunk);
                  pendingPayload = null;
            }
        }
        pendingFrames = [];
    };
    return ret;
}

var deviceMirrorAction = async function() {
    $("#main-progress").show();
    $("#device-list-content").empty().hide();
    $("#darkThemeSwitch").remove();
    $("#dmirrorview").removeClass("hide").removeClass("hidden");

    var player = window.VideoDecoder ? createDecoderPlayer("#dmirrorview .frame") : createJmuxPlayer("#dmirrorview .frame");

    resetActiveState();
    var inputChannelRunning = true;
    var videoSizeFactor = 1;

    ActiveState.push(function () {
        inputChannelRunning = false;
        adbDevice.closeAll();
        player.destroy();
    });

    async function startInputChannel() {
        await adbDevice.sendFile("/data/local/tmp/inputserver.jar", "commands/inputserver.jar");
        var stream;
        function loopStream() {
            stream = adbDevice.openStream(`shell:export CLASSPATH=/data/local/tmp/inputserver.jar;exec app_process /system/bin InputServer`);
            stream.onReceiveWrite = r => stream.sendReady();
            stream.onClose = function() {
                if (inputChannelRunning) {
                    loopStream();
                }
            }
        }
        loopStream();

        player.el.mousedown(e => {
            const width = videoSizeFactor * player.videoWidth() / player.el.width();
            const height = videoSizeFactor * player.videoHeight() / player.el.height();

            const offsetX = player.el.offset().left;
            const offsetY = player.el.offset().top;

            var sendEvent = function(code, ev) {
              var x = Math.round((ev.pageX - offsetX) * width);
              var y = Math.round((ev.pageY - offsetY) * height);
              stream.write(`me:${code}:${x}:${y}:${Date.now()}\n`)
            }

            sendEvent("d", e);
            const doc = $(document);
            doc.mousemove(e1 => sendEvent("m", e1))
            doc.mouseup(e1 => {
              doc.unbind("mousemove");
              doc.unbind("mouseup");
              sendEvent("u", e1);
            });
        });

        // Map for javascript keycodes to android key codes
        var keyMap = {};
        var addKeyMap = function(jCode, aCode, length) {
            for (let i = 0; i < length; i++) {
                keyMap[jCode + i] = aCode + i;
            }
        }

        addKeyMap(48, 7, 10); // Num keys
        keyMap[38] = 19;
        keyMap[40] = 20;
        keyMap[37] = 21;
        keyMap[39] = 22;
        addKeyMap(65, 29, 26); // A - Z
        keyMap[188] = 55;  // ,
        keyMap[190] = 56;  // .
        keyMap[18] = [57, 58];  // alt
        keyMap[16] = [59, 60];  // shift
        keyMap[9] = 61;  // tab
        keyMap[32] = 62;  // space
        keyMap[13] = 66;  // enter
        keyMap[8] = 67;  // backspace
        keyMap[192] = 68;  // grave `
        keyMap[189] = 69;  // -
        keyMap[187] = 70;  // =
        keyMap[219] = 71;  // [
        keyMap[221] = 72;  // ]
        keyMap[220] = 73;  // \
        keyMap[186] = 74;  // ;
        keyMap[222] = 75;  // '
        keyMap[191] = 76;  // /
        keyMap[27] = 111;  // Escape
        keyMap[17] = [113, 114];  // Control
        keyMap[20] = 115;  // Caps lock
        keyMap[145] = 116;  // Scroll lock
        keyMap[91] = 117;  // Meta left
        keyMap[93] = 118;  // Meta right
        addKeyMap(112, 131, 12); // Funciton keys

        $(document).bind("keydown keyup", function(e) {
            if (!keyMap[e.which]) return;
            var code = keyMap[e.which];
            if (code.length) {
                if (e.originalEvent) {
                    code = code[e.originalEvent.location - 1];
                }
                if ((typeof(code) != "number")) {
                    code = keyMap[e.which][0];
                }
            }
            var response = `ke:${e.type == 'keydown' ? 'd' : 'u'}:${e.altKey ? 1 : 0}:${e.ctrlKey ? 1 : 0}:${e.metaKey ? 1 : 0}:${e.shiftKey ? 1 : 0}:${code}\n`;
            stream.write(response)
            e.preventDefault();
        });
    }

    player.onMetadata = function() {
        var maxW = $("#dmirrorview").width() - 40;
        var maxH = $("#dmirrorview").height() - 40;
        var s = Math.max(player.videoWidth() / maxW, player.videoHeight() / maxH);
        player.resize(player.videoWidth() / s, player.videoHeight() / s);
    }
    $(window).resize(player.onMetadata);

    player.onFirstFrame = function() {
        $("#main-progress").hide();
        $("#video-message").remove();
        startInputChannel();
    }

    // Get device size
    var sizeArg = "";
    var size = /\b(\d+)x(\d+)\b/.exec(await adbDevice.shellCommand("wm size"));
    if (size) {
        var w = Math.round(parseInt(size[1]) / 2);
        var h = Math.round(parseInt(size[2]) / 2);
        sizeArg = ` --size=${w}x${h}`;
        videoSizeFactor = 2;
    }

    function connectStream() {
        if (!inputChannelRunning) {
            return;
        }
        console.log("Connecting to device stream");
        var stream = adbDevice.openStream(`shell:screenrecord ${sizeArg} --output-format=h264 - `);
        stream.onReceiveWrite = function (result) {
            stream.sendReady();
            player.feed(result);
        };

        stream.onClose = connectStream;
        stream.sendReady();
    }
    connectStream();
}