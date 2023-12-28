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

    const renderActivities = function(container, list) {

        const buttonbar = $("<div class='button-bar'>").css({display: "flex"}).appendTo(container);
        if (list.use_new_api) {
            newApiChk = $('<input type="checkbox" />');
            $("<label class='old-api'>").appendTo(buttonbar).append(newApiChk).append($("<span class='slider'>")).append($("<span class='text'>").text("Load custom properties"));
        } else {
            newApiChk = null;
        }
        if (adbDevice) {
            $("<div>").css({flexGrow: 1}).appendTo(buttonbar);
            $("<button>").text("Mirror Display").appendTo(buttonbar).click(deviceMirrorAction);
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
