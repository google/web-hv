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

/* Action to refresh activity list */
var activityListAction = function (initializer, skipPush) {
    if (!skipPush) {
        backStack.add("?activity_list", () => activityListAction(initializer, true));
    }
    progress.show();
    var content = $("#device-list-content").empty().show();
    $("#hview, #dmirrorview").addClass("hide").addClass("hidden");

    let jdwpErrorContainer;
    let windowLoaded;
    const mainContent = $("<div>").appendTo(content);

    let newApiChk = null;

    const startHView = function () {
        const info = $(this).data("appInfo");
        if (newApiChk != null && newApiChk.is(':checked')) {
            info.use_new_api = false;
        }

        if (info.isTimeLapse) {
            tlHvAction(info)
        } else {
            hViewAction(info);
        }
    }

    const showExtendDisplay = function() {
        const defaulValue = new ExtendedDisplay(2560, 1600, 320);
        let favorites = []

        if (localStorage.favoriteDisplays) {
            try {
                const tmp = JSON.parse(localStorage.favoriteDisplays);
                if (tmp && tmp.constructor == Array) {
                    for (var i = 0; i < tmp.length; i++) {
                        if (tmp[i].width > 0 && tmp[i].height > 0 && tmp[i].dpi > 0) {
                            let thisDisplay = new ExtendedDisplay(tmp[i].width, tmp[i].height, tmp[i].dpi);
                            if (!defaulValue.isSameAs(thisDisplay) && favorites.length < 3 && !favorites.find(e => thisDisplay.isSameAs(e))) {
                                favorites.push(thisDisplay);
                            }
                        }
                    }
                }
            } catch(e) { }
        }

        const menu = [
            { text: "Secondary Display", disabled: true },
            defaulValue.toMenuItem(),
            ...favorites.map(e => e.toMenuItem()),
            null,
            { text: "Custom size", id: 1 }
        ];
        const offset = $(this).offset();
        const popupEvent = {pageX: offset.left, pageY: offset.top + $(this).height()};

        showContext(menu, function (el) {
                if (this.id == 1) {
                    showInputPopup(popupEvent, "1280 x 720 @ 240 dpi", "<width> x <height> @<density> dpi")
                        .on("value_input", function(e, val) {
                            let parsed = val.match(/^\s*(\d+)\s*x\s*(\d+)\s*\@\s*(\d+)\s*dpi\s*$/)
                            if (!parsed) {
                                this.showError("Invalid display description")
                                return;
                            }
                            extendDisplay(new ExtendedDisplay(parseInt(parsed[1]), parseInt(parsed[2]), parseInt(parsed[3])))
                            this.hideMenu();
                        })
                } else if (this.display) {
                    extendDisplay(this.display)
                }
            },
            popupEvent);

        const extendDisplay = function(thisDisplay) {
            if (!defaulValue.isSameAs(thisDisplay)) {
                favorites = favorites.filter(e => !defaulValue.isSameAs(e))
                favorites.unshift(thisDisplay)
                localStorage.favoriteDisplays = JSON.stringify(favorites)
            }

            deviceMirrorAction(thisDisplay);
        }
    }

    const renderActivities = function(container, list) {
        const buttonbar = $("<div class='button-bar'>").appendTo(container);
        if (list.use_new_api) {
            newApiChk = $('<input type="checkbox" />');
            $("<label class='old-api'>").appendTo(buttonbar).append(newApiChk).append($("<span class='slider'>")).append($("<span class='text'>").text("Load custom properties"));
        } else {
            newApiChk = null;
        }
        if (adbDevice) {
            $("<div>").css({flexGrow: 1}).appendTo(buttonbar);
            $("<div>").addClass("button-group").appendTo(buttonbar)
                .append($("<button>").text("Mirror Display").click(e => deviceMirrorAction()))
                .append($("<button>").html("&#58821;")
                    .css({
                        fontFamily: "Icon-Font",
                        float: "right",
                        padding: "0 6px",
                        fontSize: "20px"
                    }).click(showExtendDisplay));
        }

        container = $("<div>").appendTo(container).addClass("activity-list");
        const setupOneListItem = function(l) {
            const entry = $("<div>").data("appInfo", l).appendTo(container).click(startHView).addClass("entry");

            const icon = $('<div class="icon">').appendTo(entry).attr("icon-id", l.iconId);
            if (l.isTimeLapse) {
                icon.addClass("time-lapse")
            }
            if (l.icon && l.icon.value) {
                icon.css("background-image", `url(${l.icon.value})`);
            }

            if (l.name == "") {
                l.name = "---";
            }
            $('<div class="title">').text(l.name).appendTo(entry);
            let subText;
            if (l.pid != undefined && l.pname != undefined) {
                subText = `${l.pname} (${l.pid})`;
            } else if (l.pname != undefined) {
                subText = l.pname;
            } else if (l.pid != undefined) {
                subText = `Process id: ${l.pid}`;
            } else {
                subText = null;
            }
            if (subText != null) {
                $('<div class="subtext">').appendTo(entry).text(subText);
            }
        }

        for (let i = 0; i < list.length; i++) {
            if (list[i].type == TYPE_TIME_LAPSE_BUG_REPORT) {
                const w = createWorker("js/ddmlib/tl-worker.js")
                w.onerror = function () {
                    throw "Error parsing view data"
                }
                w.onmessage = function (e) {
                    setupOneListItem({ name: e.data.title, isTimeLapse: true, display: { }, worker: w, windowIndex: e.data.index,
                        data: { /* All data is already unwrapped in the worker, no need to store it here. */ } })
                }
                w.postMessage({ action: TL_ACTION_UNWRAP, data: list[i].data })
            } else {
                setupOneListItem(list[i])
            }
        }
    }

    const callbacks = {
        jdwpError: function () {
            if (!jdwpErrorContainer) {
                jdwpErrorContainer = $("<div>").prependTo(content)
                    .showError("Using old API. Something bad might have happened. You should probably take a break.");
            }
        },

        windowsError: function (msg) {
            if (!windowLoaded) {
                progress.hide();
                mainContent.showError(msg);
            }
        },

        windowsLoaded: function (list) {
            windowLoaded = true;
            progress.hide();
            renderActivities(mainContent.empty(), list);
        },

        iconLoaded: function(id, value) {
            $(`div[icon-id=${id}]`).css("background-image", `url(${value})`);
        }
    };

    initializer(callbacks);
};
