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

var hViewAction;
var currentAppInfo;

$(function () {
    var KEY_DIVIDER = "divider";

    var currentRootNode = null;
    var selectedNode;
    var favoriteProperties = [];
    var viewController;
    var showHiddenNodes = false;
    var valueTypeMap = {};

    var closedSections = {};

    // Load favorite properties
    if (localStorage.favoriteProps) {
        try {
            var tmp = JSON.parse(localStorage.favoriteProps);
            if (tmp && tmp.constructor == Array) {
                favoriteProperties = tmp;
            }
        } catch(e) { }
    }

    // Load favorite properties
    if (localStorage.valueTypeMap) {
        try {
            var tmp = JSON.parse(localStorage.valueTypeMap);
            if (tmp && tmp.constructor == Object) {
                valueTypeMap = tmp;
            }
        } catch(e) { }
    }

    // Create dividers
    var shouldSaveResizeData = function() {
        return !$("#hviewtabs").is(":visible");
    }

    var createDaggerDownControl = function(divider) {
        var invalue1 = parseInt(divider.e1.css(divider.right));
        var invalue2 = parseInt(divider.e2.css(divider.width));
        var invalueDragger = parseInt(divider.dragger.css(divider.right));

        var v1 = divider.e1[divider.width]();
        var v2 = divider.e2[divider.width]();

        if (v1 == 0 || v2 == 0) {
            return function() {};
        }

        return function(delta) {
            if (v1 + delta < divider.l1) {
                delta = divider.l1 - v1;
            } else if (v2 - delta < divider.l2) {
                delta = v2 - divider.l2;
            }

            divider.e1.css(divider.right, invalue1 - delta);
            divider.e2.css(divider.width, invalue2 - delta);
            divider.dragger.css(divider.right, invalueDragger - delta);

            divider.e1.trigger("resizing");
            divider.e2.trigger("resizing");
        }
    }

    var handleMouseDown = function(e) {
        var divider = $(this).data(KEY_DIVIDER);
        var start = e[divider.pageX];
        var control = createDaggerDownControl(divider);

        var handleMouseMove = function(e) {
            control(e[divider.pageX] - start);
        }

        var handleMouseUp = function(e) {
            $(document).unbind();

            // Save settings.
            var data = {};
            $(".divider").each(function () {
                var obj = $(this).data(KEY_DIVIDER);
                data[$(this).attr("id")] = obj.dragger.css(obj.right);
            });
            if (shouldSaveResizeData()) {
                data = JSON.stringify(data);
                localStorage.resizeData = data;
            }
        }

        $(document).mousemove(handleMouseMove).mouseup(handleMouseUp).bind("touchmove", function(e) {
            handleMouseMove.apply(this, e.originalEvent.touches);
        }).bind("touchend", handleMouseUp);
    }

    var handleTouchStart = function(e) {
        e.preventDefault();
        handleMouseDown.apply(this, e.originalEvent.touches);
    }

    $(".divider").each(function () {
        var el = $(this);
        var controls = el.attr("control").split(",");

        var obj = {
            dragger: el,
            pageX: controls[0],
            right: controls[1],
            width: controls[2],
            e1: el.prev(),
            e2: el.next()
        }
        obj.l1 = obj.e1.attr("limit");
        obj.l2 = obj.e2.attr("limit");
        el.data(KEY_DIVIDER, obj);
    }).mousedown(handleMouseDown).bind("touchstart", handleTouchStart);

    // Apply resize data
    var applyResizeData = function() {
        if (localStorage.resizeData && shouldSaveResizeData()) {
            let data = JSON.parse(localStorage.resizeData);
            for (var id in data) {
                var divider = $("#" + id).data(KEY_DIVIDER);
                if (!divider || (typeof data[id]) != "string") {
                    continue;
                }
                var invalueDragger = parseInt(divider.dragger.css(divider.right));
                var val = parseInt(data[id]);
                createDaggerDownControl(divider)(invalueDragger - val);
            }
        }
    };

    // In case of properties box, its width can change with changes to right panel.
    (function () {
        var obj = $("#properties-divider").data(KEY_DIVIDER);
        $("#rcontent").on("resizing", function () {
            var w1 = obj.e1.width();
            if (w1 < obj.l1) {
                var delta = obj.l1 - w1;

                obj.e1.css("right", parseInt(obj.e1.css("right")) - delta);
                obj.e2.css("width", parseInt(obj.e2.css("width")) - delta);
                obj.dragger.css("right", parseInt(obj.dragger.css("right")) - delta);
            }
        });
    })();

    /********************************* Filter properties *********************************/
    var filterProperties = function () {
        var q = $("#pfilter").val().trim().toLocaleLowerCase();
        var sections = $(".pcontainer .expandable");
        var total = 0;

        if (q == "") {
            $(".pcontainer label").show();
            sections.each(function () {
                total++;
                var left = $(this).data("lbox").children();
                if (!$(this).hasClass(CLS_CLOSED)) {
                    total += left.length;
                }
                for (var i = 0; i < left.length; i++) {
                    // Remove any formatting.
                    var child = $(left[i]).children().eq(1);
                    child.text(child.text());
                }
            });
        } else {
            var re = new RegExp("(" + q.split(' ').join('|') + ")", "gi");
            sections.each(function () {
                var found = 0;
                var left = $(this).data("lbox").children();
                var right = $(this).data("rbox").children();
                for (var i = 0; i < left.length; i++) {
                    var child = $(left[i]).children().eq(1);
                    var itemText = child.text();
                    if (itemText.toLocaleLowerCase().indexOf(q) > -1) {
                        child.html(itemText.replace(re, "<b>$1</b>"));
                        found++;
                        $(left[i]).show();
                        $(right[i]).show();
                    } else {
                        $(left[i]).hide();
                        $(right[i]).hide();
                    }
                }
                if (found > 0) {
                    $(this).show().data("valspace").show();
                    total++;
                    if (!$(this).hasClass(CLS_CLOSED)) {
                        total += found;
                    }
                } else {
                    $(this).hide().data("valspace").hide();
                }
            });
        }

        $("#properties-divider").height(total * 20);
    }
    $("#pfilter").on("input", filterProperties);

    /** Loading image preview ****** */
    var loadImage = function (node) {
        node.imageUrl = URL_LOADING;
        viewController.captureView(node.name).then(imageData => {
            var blob = new Blob([imageData], { type: "image/png" });
            var url = createUrl(blob);
            node.imageUrl = url;
            if (node == currentRootNode) {
                $("#border-box").css('background-image', 'url("' + node.imageUrl + '")');
            }
            if (node.box.hasClass(CLS_SELECTED)) {
                node.box.css('background-image', 'url("' + node.imageUrl + '")');
                $("#image-preview").empty().css('background-image', 'url("' + node.imageUrl + '")');
            }
        }).catch(() => {
            node.imageUrl = null;
            if (node.box.hasClass(CLS_SELECTED)) {
                $("#image-preview").showError("Error loading image");
            }
        });
    }

    var toggleFavorite = function (e) {
        var name = $(this).data("pname");
        if ($(this).toggleClass(CLS_SELECTED).hasClass(CLS_SELECTED)) {
            favoriteProperties.push(name);
        } else {
            favoriteProperties = $.grep(favoriteProperties, function (value) {
                return value != name;
            });
        }
        localStorage.favoriteProps = JSON.stringify(favoriteProperties);
    }

    var propertySectionToggle = function (e) {
        var me = $(this).toggleClass(CLS_CLOSED);
        var left = me.data("lbox");
        var right = me.data("rbox");
        if (closedSections[me.text()] = me.hasClass(CLS_CLOSED)) {
            left.slideUp("fast");
            right.slideUp("fast");
        } else {
            left.slideDown("fast");
            right.slideDown("fast");
        }
        filterProperties();
    }

    /********************************* Selecting a node *********************************/
    var toHex = function(i, len) {
        var s = i.toString(16);
        if (s.length < len) {
            s = "0000000000000000".slice(0, len - s.length) + s;
        }
        return s;
    }

    var argb2rgba = function(i) {
        // ensure unsigned 32-bit int
        var ui32 = (0xFFFFFFFF & i) >>> 0;
        // take one down, pass it around
        return (((ui32 & 0xFFFFFF) << 8) | (ui32 >>> 24));
    }

    var selectNode = function () {
        if ($(this).hasClass(CLS_SELECTED)) return;
        $("#vlist_content .selected").removeClass(CLS_SELECTED);
        $(this).addClass(CLS_SELECTED);

        $("#border-box .selected, #image-preview").removeClass(CLS_SELECTED).css('background-image', 'none');
        var box = $(this).data("box").addClass(CLS_SELECTED);

        // Render properties;
        var node = $(this).data("node");
        var nHolder = $("#p_name").empty();
        var vHolder = $("#p_val").empty();

        var lastType = "";
        var nSubHolder = nHolder;
        var vSubHolder = vHolder;

        var addProp = function (p, type) {
            if (type != lastType) {
                lastType = type;

                // Add section
                var section = $("<label>").addClass(CLS_EXPANDABLE).addClass(CLS_WITH_ARROW).text(type).appendTo(nHolder).prepend("<span>");
                var valspace = $("<label>").html("&nbsp;").appendTo(vHolder);

                nSubHolder = $("<div>").appendTo(nHolder);
                vSubHolder = $("<div>").appendTo(vHolder);
                section.data({
                    lbox: nSubHolder,
                    rbox: vSubHolder,
                    valspace: valspace
                }).click(propertySectionToggle);

                if (closedSections[type]) {
                    nSubHolder.hide();
                    vSubHolder.hide();
                    section.addClass(CLS_CLOSED);
                }
            }

            var pName = $("<label>").append($("<span />").text(p.name)).appendTo(nSubHolder);
            var value = "" + p.value;

            var labelTag = $("<label>");

            if (value == "") {
                labelTag.html("&nbsp;");
            } else {
                var valueF = parseFloat(p.value);
                var valueI = parseInt(p.value);
                var colorWell = undefined;

                if (!isNaN(valueF)) {
                    // Numbers could mean any number (sorry) of things, so let's try to show 
                    // some relevant interpretations, switchable via <option> drop-down.
                    var selectTag = $(`<select name="${p.name}">`).append($("<option value='default'>").text(value));
                    if (viewController.density > 0) {
                        var dp = Math.round(valueF * 160 * 100 / viewController.density) / 100;
                        if (Math.abs(dp) < 10000) {
                            // probably a reasonable dimension
                            selectTag.append($("<option value='size-dp'>").text(dp + " dp"));
                        }
                    }
                    if (valueF == valueI) {
                        var valueU = valueI >>> 0;
                        var valueHex = "";
                        if (p.name.search(/color$/i) >= 0) {
                            valueHex = toHex(valueU, 8);
                            selectTag.append(
                                $("<option value='color-hex'>").text("#" + valueHex)
                            );
                        } else {
                            var valueHex = toHex(valueU);
                            selectTag.append($("<option value='falgs-hex'>").text("0x" + valueHex));
                        }
                        if (valueHex) {
                            colorWell = $("<div>").addClass(CLS_COLORWELL);
                            selectTag.change(() => {
                                var myVal = "" + selectTag.val();
                                if (myVal.startsWith("#")) {
                                    var webColor = '#' + toHex(argb2rgba(valueU), 8);
                                    colorWell.css('display', 'inline-block').css('background-color', webColor);
                                } else {
                                    colorWell.hide();
                                }
                            })
                        }
                        var valuePref = valueTypeMap[p.name];
                        if (valuePref != undefined && selectTag.children().map(function() { return this.value; }).get().indexOf(valuePref) >= 0) {
                            selectTag.val(valuePref);
                        }
                        selectTag.change(saveValueTypeSelect);
                    }
                    labelTag.addClass(CLS_MULTI_TOGGLE).append(selectTag);
                    if (colorWell) labelTag.append(colorWell);
                } else {
                    labelTag.text(value);
                }
            }

            labelTag.appendTo(vSubHolder);

            return $("<span>").addClass("star").data("pname", p.fullname).prependTo(pName).click(toggleFavorite);
        }

        // Selected properties
        for (var i = 0; i < favoriteProperties.length; i++) {
            var prop = node.namedProperties[favoriteProperties[i]];
            if (prop) {
                addProp(prop, "Favorites").addClass(CLS_SELECTED);
            }
        }

        for (var i = 0; i < node.properties.length; i++) {
            var p = node.properties[i];
            if (favoriteProperties.indexOf(p.fullname) < 0) {
                addProp(p, p.type);
            }
        }
        filterProperties();
        selectedNode = node;

        // Apply image
        if (node.imageUrl == URL_LOADING) {
            // Show a loading message
        } else if (node.imageUrl) {
            box.css('background-image', 'url("' + node.imageUrl + '")');
            $("#image-preview").empty().css('background-image', 'url("' + node.imageUrl + '")');
        } else {
            loadImage(node);
        }
    }

    var saveValueTypeSelect = function() {
        valueTypeMap[$(this).attr("name")] = $(this).val();
        var data = JSON.stringify(valueTypeMap);
        localStorage.valueTypeMap = data;
    }

    var profileInfoBox = $("#profile-info");
    var mouseOverNode = function () {
        $(this).data("box").addClass(CLS_HOVER);

        var node = $(this).data("node");
        if (node.profiled) {
            profileInfoBox.find("#profile-info-m").text(node.measureTime.toFixed(5));
            profileInfoBox.find("#profile-info-l").text(node.layoutTime.toFixed(5));
            profileInfoBox.find("#profile-info-d").text(node.drawTime.toFixed(5));
            profileInfoBox.show();            
        }
    }
    var mouseOutNode = function () {
        $(this).data("box").removeClass(CLS_HOVER);
        profileInfoBox.hide();
    }

    var setEnabled = function (el, isEnabled) {
        if (isEnabled) {
            el.removeClass(CLS_DISABLED);
        } else {
            el.addClass(CLS_DISABLED);
        }
    }

    var showNodeContext = function (e) {
        e.preventDefault();
        selectNode.call(this);

        var node = $(this).data("node");
        var menu = [
            {
                text: "Save PNG",
                icon: "ic_save",
                disabled: !(node.imageUrl && node.imageUrl != URL_LOADING),
                id: 0
            },
            {
                text: "Reload PNG",
                icon: "ic_refresh",
                disabled: node.imageUrl == URL_LOADING,
                id: 1
            }
        ];

        if (viewController.profileView) {
            menu.push({
                text: "Profile view",
                icon: "ic_layers",
                id: 2
            });
        }
        menu.push(null);

        if (!node.disablePreview) {
            menu.push({
                text: "Disable preview",
                icon: "ic_hide",
                id: 3
            });
        } else {
            menu.push({
                text: "Enable preview",
                icon: "ic_show",
                id: 4
            });
        }
        if ($(this).hasClass(CLS_EXPANDABLE)) {
            menu.push({
                text: "Collapse all",
                icon: "ic_collapse",
                id: 5
            });
        }
        showContext(menu, onNodeContextMenuSelected, e);
    }

    /********************************* Rendering code *********************************/
    var treeToggle = function (e) {
        $(this).next()[$(this).toggleClass(CLS_CLOSED).hasClass(CLS_CLOSED) ? "hide" : "show"]();
    }
    var treeToggleFromArrow = function (e) {
        $(this).parent().dblclick();
    }

    var renderNode = function (node, container, boxContainer, maxW, maxH, leftShift, topshift, scaleX, scaleY) {
        var newScaleX = scaleX * node.scaleX;
        var newScaleY = scaleY * node.scaleY;

        var l = leftShift + (node.left + node.translateX) * scaleX + node.width * (scaleX - newScaleX) / 2;
        var t = topshift + (node.top + node.translateY) * scaleY + node.height * (scaleY - newScaleY) / 2;
        var boxPos = {
            left: l,
            top: t,
            width: node.width * newScaleX,
            height: node.height * newScaleY,
        };

        var box = $("<div>").css({
            left: (boxPos.left * 100 / maxW) + "%",
            top: (boxPos.top * 100 / maxH) + "%",
            width: (boxPos.width * 100 / maxW) + "%",
            height: (boxPos.height * 100 / maxH) + "%",
        }).appendTo(boxContainer).data("node", node);

        var name = node.name.split(".");
        name = name[name.length - 1];

        var desc = node.contentDesc;
        if (desc != null) {
            name = name + " : " + desc;
        }
        node.desc = name;

        var elWrap = $("<x-line-wrap>").text(name).append($("<x-profile>"));
        var el = $("<label>").appendTo(container).addClass(CLS_WITH_ARROW)
            .data({
                node: node,
                box: box
            })
            .click(selectNode).hover(mouseOverNode, mouseOutNode).bind("contextmenu", showNodeContext)
            .append(elWrap);

        node.box = box;
        node.el = el;
        node.boxpos = boxPos;
        $("<span>").prependTo(elWrap).click(treeToggleFromArrow);

        if (node.children.length) {
            el.addClass(CLS_EXPANDABLE).dblclick(treeToggle);
            var container = $("<div>").addClass(CLS_TREENODE).appendTo(container);
            var shiftX = l - node.scrollX;
            var shiftY = t - node.scrollY;
            for (var i = 0; i < node.children.length; i++) {
                renderNode(node.children[i], container, boxContainer, maxW, maxH, shiftX, shiftY, newScaleX, newScaleY);
            }
        }
    }

    var renderList = function (root) {
        $("#hview").removeClass("hide").removeClass("hidden");
        $("#main-progress").hide();

        var boxContent = $("#border-box").empty();
        currentRootNode = root;

        // Clear all transform from the root, so that it matches the preview
        root.scaleX = root.scaleY = 1;
        root.translateX = root.translateY = 1;

        renderNode(root, $("#vlist_content").empty(), boxContent, root.width, root.height, 0, 0, 1, 1);
        resizeBoxView();
        $("#vlist_content label").first().click();
        showHiddenNodeOptionChanged();
    }

    /********************************* Refresh view *********************************/
    hViewAction = function (appInfo) {
        $("#main-progress").show();
        $("#device-list-content").empty().hide();
        $("#darkThemeSwitch").remove();
        $("#hview").removeClass("hide");

        viewController = createViewController(appInfo);
        viewController.loadViewList().then(v => {
            renderList(v);
            applyResizeData();
        })
            .catch(msg => {
            // Error loading list.
            $("#hview").removeClass("hide").removeClass("hidden");
            $("#vlist_content").showError(msg ? msg : "Error loading view hierarchy");
        });

        if (viewController.customCommand) {
            $("#btn-custom-command").show();
            loadSuggestions(viewController.device);
        } else {
            $("#btn-custom-command").hide();
        }

        let title = appInfo.name.split(".");
        title = title[title.length - 1];
        $("#windowTitle").text(document.title = title + " [" + appInfo.name + "]")
        currentAppInfo = appInfo;

        $("#btn-go-back")
            .show()
            .unbind("click")
            .click(function() {
                if (appInfo.goBack) {
                    $("#btn-go-back").unbind("click");
                    $("#hview").addClass("hide hidden")
                    $("#device-list-content")
                        .empty()
                        .show();
                    appInfo.goBack();
                } else {
                    window.location.reload()
                }
            })
    }

    /********************************* Preview Grid resize *********************************/
    var resizeBoxView = function () {
        if (!currentRootNode) return;
        var container = $("#box-border-container");
        var cW = container.width();
        var cH = container.height();

        var mW = currentRootNode.width;
        var mH = currentRootNode.height;
        var scale = Math.min(cW / mW, cH / mH);

        var w = scale * mW;
        var h = scale * mH;
        $("#border-box").css({
            width: w,
            height: h,
            left: (cW - w) / 2,
            top: (cH - h) / 2
        });
    }
    $("#rcontent, #sshot").on("resizing", resizeBoxView);

    /** ********************** Box hover handling ***************** */
    var scrollToNode = function (node) {
        // expand nodes recursively
        var parent = node.parent;
        while (parent) {
            if (parent.el.hasClass(CLS_EXPANDABLE) && parent.el.hasClass(CLS_CLOSED)) {
                parent.el.removeClass(CLS_CLOSED).next().show();
            }
            parent = parent.parent;
        }
        scrollToView(node.el, $("#vlist_content"));
    }

    $("#border-box").mouseover(function (e) {
        var offset = $(this).offset();

        var nodesHidden = !showHiddenNodes;
        var widthFactor = currentRootNode.width / $(this).width();
        var heightFactor = currentRootNode.height / $(this).height();

        var updateSelection = function (node, x, y, firstNoDrawChild, clipX1, clipY1, clipX2, clipY2) {
            if (node.disablePreview) {
                return null;
            }
            if (!node.nodeDrawn) {
                return null;
            }
            if (nodesHidden && !node.isVisible) {
                return null;
            }

            var wasFirstNoDrawChildNull = firstNoDrawChild[0] == null;
            var boxpos = node.boxpos;

            var boxRight = boxpos.width + boxpos.left;
            var boxBottom = boxpos.top + boxpos.height;
            if (node.clipChildren) {
                clipX1 = Math.max(clipX1, boxpos.left);
                clipY1 = Math.max(clipY1, boxpos.top);
                clipX2 = Math.min(clipX2, boxRight);
                clipY2 = Math.min(clipY2, boxBottom);
            }
            if (clipX1 < x && clipX2 > x && clipY1 < y && clipY2 > y) {
                for (var i = node.children.length - 1; i >= 0; i--) {
                    var child = node.children[i];
                    var ret = updateSelection(child, x, y, firstNoDrawChild, clipX1, clipY1, clipX2, clipY2);
                    if (ret != null) {
                        return ret;
                    }
                }
            }
            if (boxpos.left < x && boxRight > x && boxpos.top < y && boxBottom > y) {
                if (node.willNotDraw) {
                    if (firstNoDrawChild[0] == null) {
                        firstNoDrawChild[0] = node;
                    }
                    return null;
                } else {
                    if (wasFirstNoDrawChildNull && firstNoDrawChild[0] != null) {
                        return firstNoDrawChild[0];
                    }
                    return node;
                }
            }
            return null;
        }

        var lastMatch = $("#border-box div.hover").data("node");
        var findBox = function (e) {
            var x = (e.pageX - offset.left) * widthFactor;
            var y = (e.pageY - offset.top) * heightFactor;
            var firstNoDrawChild = [null];
            return updateSelection(currentRootNode, x, y, firstNoDrawChild, 0, 0, currentRootNode.width, currentRootNode.height);
        }
        var onMove = function (e) {
            var found = findBox(e);
            if (found != lastMatch) {
                if (lastMatch) {
                    lastMatch.el.removeClass(CLS_HOVER);
                    lastMatch.box.removeClass(CLS_HOVER);
                }

                if (found) {
                    found.el.addClass(CLS_HOVER);
                    found.box.addClass(CLS_HOVER);
                }
                lastMatch = found;
            }
        }

        $(this).unbind("mousemove").unbind("click").mousemove(onMove).click(function (e) {
            var found = findBox(e);
            if (found) {
                found.el.click();
                scrollToNode(found);
            }
        }).unbind("contextmenu").bind("contextmenu", function (e) {
            var found = findBox(e);
            if (found) {
                showNodeContext.call(found.el.get(0), e);
            }
        });

        onMove(e);
    }).mouseout(function (e) {
        $("#border-box div.hover, #vlist_content label.hover").removeClass(CLS_HOVER);
    });

    /** ********************** Context menu ********************** */
    var collapseAll = function (node) {
        if (node.el.hasClass(CLS_EXPANDABLE)) {
            node.el.addClass(CLS_CLOSED).next().hide();
            for (var i = 0; i < node.children.length; i++) {
                collapseAll(node.children[i]);
            }
        }
    }

    var onNodeContextMenuSelected = function () {
        switch (this.id) {
            case 0: // save png
                saveFile(selectedNode.name + ".png", selectedNode.imageUrl);
                break;
            case 1: // Reload png
                loadImage(selectedNode);
                break;
            case 2: // Profile view
                profileView(selectedNode);
                break;
            case 3: // Disable preview
                selectedNode.disablePreview = true;
                selectedNode.el.addClass("preview-disabled");
                break;
            case 4: // Enable preview
                selectedNode.disablePreview = false;
                selectedNode.el.removeClass("preview-disabled");
                break;
            case 5: // Collapse all
                collapseAll(selectedNode);
                break;
            case 6: // Custom command
                $("#custom-cmd-dialog h1").text(selectedNode.desc);
                $("#custom-cmd-dialog").show();
                $("#custom-cmd-dialog .close_btn div").remove();
                $("#cmd-selection").change();
                $("#cmd-cancel").click();
                break;
        }
    };

    /** ********************** Profile view ********************** */
    var profileView = async function(node) {
        var data = await viewController.profileView(node.name);
        data = data.split("\n");
        var index = 0;

        function loadProp(n) {
            var line = data[index];
            index++;            
            if (!line || line == "-1 -1 -1" || line.toLocaleLowerCase() == "done.") {
                return false;
            }

            var times = line.split(" ");
            n.measureTime = (parseInt(times[0]) / 1000.0) / 1000.0;
            n.layoutTime = (parseInt(times[1]) / 1000.0) / 1000.0;
            n.drawTime = (parseInt(times[2]) / 1000.0) / 1000.0;
            n.profiled = true;
            
            for (let i = 0; i < n.children.length; i++) {
                if (!loadProp(n.children[i])) {
                    return false;
                }
            }
            return true;
        }

        if (!loadProp(node)) {
            console.log("Unable to parse profile data");
            return;
        }

        const RED_THRESHOLD = 0.8;
        const YELLOW_THRESHOLD = 0.5;
        function addIndicator(el, name, value) {
            var e = $("<a>").text(name).appendTo(el);
            if (value >= RED_THRESHOLD) {
                e.addClass("red");
            } else if (value >= YELLOW_THRESHOLD) {
                e.addClass("yellow")
            } else {
                e.addClass("green");
            }
        }

        function setProfileRatings(n) {
            var N = n.children.length;
            if (N > 1) {
                var totalMeasure = 0;
                var totalLayout = 0;
                var totalDraw = 0;
                for (let i = 0; i < N; i++) {
                    var child = n.children[i];
                    totalMeasure += child.measureTime;
                    totalLayout += child.layoutTime;
                    totalDraw += child.drawTime;
                }
                for (let i = 0; i < N; i++) {
                    var child = n.children[i];
                    var el = child.el.find("x-profile").empty().show();

                    addIndicator(el, "M", child.measureTime / totalMeasure);
                    addIndicator(el, "L", child.layoutTime / totalLayout);
                    addIndicator(el, "D", child.drawTime / totalDraw);
                }
            } else if (N == 1) {
                var child = n.children[0];
                // Add default
                child.el.find("x-profile").empty().show()
                    .append($("<a>").text("M"))
                    .append($("<a>").text("L"))
                    .append($("<a>").text("D"));
            }
            for (let i = 0; i < N; i++) {
                setProfileRatings(n.children[i]);
            }
        }
        setProfileRatings(node);
    }


    /** ********************** Node search ********************** */
    var lastNodeSearchText = "";
    $("#btn-search-node").click(function(e) {
        var searchInput;
        var elementFactory = function(el, hideMenu) {
            searchInput = $("<input type=search placeholder='Search node'>").appendTo(el);

            // Use key up for enter, so that the user has time to press shift key
            searchInput.keyup(function (e) {
                if (e.keyCode == 13) {
                    nodeSearch(e.shiftKey ? -1 : 1);
                }
            });
            searchInput.keydown(function (e) {
                if (e.keyCode == 27) {
                    e.preventDefault();
                    hideMenu();
                }
            });
        }
        showPopup(e, elementFactory);
        searchInput.val(lastNodeSearchText).focus().select();

        var nodeSearch = function (dir) {
            var query = searchInput.val();
            if (query == "") return;
            lastNodeSearchText = query;
            query = query.toLocaleLowerCase();

            // Search through boxes, as nodes might be collapsed.
            var boxes = $("#border-box div");
            var nodes = boxes.filter(function() {
                return $(this).css("display") != "none";
            }).map(function () {
                return $(this).data("node").el.get(0);
            });

            var st = nodes.index(selectedNode.el);
            var count = nodes.length;

            for (var i = -1; i < count; i++) {
                st += dir;
                if (st < 0) {
                    st = count - 1;
                }
                if (st >= count) {
                    st = 0;
                }
                if ($(nodes.get(st)).text().toLocaleLowerCase().indexOf(query) > -1) {
                    // Found element.
                    selectNode.call(nodes.get(st));
                    scrollToNode(selectedNode);
                    return;
                }
            }
        }
    });

    /** ********************** Custom command ********************** */
    var ignoreNextKeyUp = false;

    $("#btn-custom-command").click(function (e) {
        var commandInput;
        var errorContainer;
        var elementFactory = function(el) {
            commandInput = $("<input type=search placeholder='Custom command'>").appendTo(el);
            errorContainer = $("<div class='custom-command-error-wrapper'>").appendTo(el);
        }
        var popup = showPopup(e, elementFactory);


        if (viewMethodList != null) {
            // Setup auto complete
            var methodAutoComplete = new autoComplete({
                selector: commandInput.get(0),
                minChars: 1,
                source: autoCompleteSource,
                renderItem: suggestionRenderer,
                onSelect: function () { ignoreNextKeyUp = true; }
            });
            popup.on("popup_closed", function(e) {
                console.log("Popup closed", e);
                methodAutoComplete.destroy();
            });
        }

        commandInput.focus().select();
        commandInput.keyup(function (e) {
            if (ignoreNextKeyUp) {
                ignoreNextKeyUp = false;
                return;
            }
            if (e.keyCode == 13) {
                executeCommand($(this).val(), errorContainer);
            }
        }).on("input", function () {
            errorContainer.empty();
        }).blur(function () {
            errorContainer.empty();
        });
    })

    var executeCommand = function (cmd, errorContainer) {
        cmd = cmd.trim();
        var m = cmd.match(/^([a-zA-Z_0-9]+)\s*\(([^\)]*)\)\;?$/);

        if (!m) {
            errorContainer.showError("Invalid method format: methodName(param1, param2...). eg: setEnabled(false), setVisibility(0), setAlpha(0.9f)");
            return;
        }

        var data = new DataOutputStream();
        data.writeStr(m[1]);

        if (m[2].trim() != "") {
            var params = m[2].split(",");
            data.writeInt(params.length);
            for (var i = 0; i < params.length; i++) {
                try {
                    var p = params[i].trim().toLocaleLowerCase();

                    if (p == "false" || p == "true") {
                        // boolean
                        data.writeStr("Z", true);
                        data.writeByte(p == "false" ? 0 : 1);
                    } else if (p.indexOf(".") > -1 || p.endsWith("f")) {
                        // float
                        p = parseFloat(p);
                        data.writeStr("F", true);
                        data.writeFloat(p);
                    } else if (p.match(/^[+-]?(0x)?[0-9a-fA-F]+$/)) {
                        p = parseInt(p);
                        data.writeStr("I", true);
                        data.writeInt(p);
                    } else {
                        throw "error"
                    }
                } catch (e) {
                    errorContainer.showError("Invalid paramater: [" + params[i].trim() + "]. eg: setEnabled(false), setVisibility(0), setAlpha(0.9f)");
                }
            }
        }
        viewController.customCommand(selectedNode.name, data.data).catch(errorContainer.showError.bind(errorContainer));
    }

    var viewMethodList = null;

    var autoCompleteSource = function (term, suggest) {
        term = term.toLowerCase().trim();
        var matches = [];
        for (var i = 0; i < viewMethodList.length; i++) {
            if (~viewMethodList[i][0].toLowerCase().indexOf(term)) matches.push(viewMethodList[i]);
        }
        suggest(matches);
    };

    var suggestionRenderer = function (item, search) {
        // escape special characters
        search = search.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        var re = new RegExp("(" + search.split(' ').join('|') + ")", "gi");
        return '<div class="autocomplete-suggestion" data-val="' + item[0] + '">' + item[0].replace(re, "<b>$1</b>") + "(" + item[1] + ")" + '</div>';
    }

    var loadSuggestions = async function (device) {
        await device.sendFile("/data/local/tmp/methods.jar", "commands/methods.jar");
        var response = await device.shellCommand("export CLASSPATH=/data/local/tmp/methods.jar;exec app_process /system/bin MethodList");
        response = JSON.parse(response.split("\n", 2)[1]);
        viewMethodList = response;
    };

    /** ********************** Main Menu ********************** */
    $("#btn-options").click(function() {
        var menu = [
            {
                text: "Show hidden node",
                icon: showHiddenNodes ? "ic_checked" : "ic_unchecked",
                id: 0
            },
            {
                text: "Dark theme",
                icon: isDarkTheme() ? "ic_checked" : "ic_unchecked",
                id: 5
            },
            null,
            {
                text: "Save hierarchy",
                icon: "ic_save",
                id: 1
            },
            {
                text: "Refresh",
                icon: "ic_refresh",
                id: 2
            }
        ];
        if (!$("#hviewtabs").is(":visible")) {
            // Only show the preview menu when tabs are not available
            menu.unshift({
                text: "Preview",
                icon: "ic_submenu",
                id: 6
            });
        }

        if (viewController.loadScreenshot) {
            menu.push(null, {
                text: "Load screenshot",
                icon: "ic_layers",
                id: 4
            })
        }

        if (adbDevice && !adbDevice.disconnectedDevice) {
            menu.push(null, {
                text: "Disconnect",
                icon: "ic_disconnect",
                id: 3
            })
        }

        var offset = $(this).offset();
        showContext(menu, function (el) {
            switch(this.id) {
                case 0:
                    showHiddenNodes = !showHiddenNodes;
                    showHiddenNodeOptionChanged();
                    break;
                case 1:
                    saveHierarchy();
                    break;
                case 2:
                    hViewAction(currentAppInfo);
                    break;
                case 3:
                    if (adbDevice) {
                        adbDevice.disconnect();
                    }
                    break;
                case 4:
                    viewController.loadScreenshot().then(url => {
                        currentRootNode.imageUrl = url;
                        $("#border-box").css('background-image', 'url("' + url + '")');
                        if (currentRootNode.box.hasClass(CLS_SELECTED)) {
                            currentRootNode.box.css('background-image', 'url("' + url + '")');
                            $("#image-preview").empty().css('background-image', 'url("' + url + '")');
                        }
                    });
                    break;
                case 5:
                    switchTheme();
                    break;
                case 6:
                    var submenuOffset = el.addClass(CLS_SELECTED).offset();
                    showPreviewContext({pageX: submenuOffset.left + el.width() / 2, pageY: submenuOffset.top + el.height() / 4})
                    return true;    // Dont ide te existing popup
            }
        },
        {pageX: offset.left, pageY: offset.top});
    });

    var currentPreviewMode = 3;
    var showPreviewContext = function(e) {
        var menu = [
            {
                text: "Grid",
                icon: currentPreviewMode == 0 ? "ic_checked" : "ic_unchecked",
                id: 0
            },
            {
                text: "Image",
                icon: currentPreviewMode == 1 ? "ic_checked" : "ic_unchecked",
                id: 1
            },
            {
                text: "Both",
                icon: currentPreviewMode == 2 ? "ic_checked" : "ic_unchecked",
                id: 2
            },
            {
                text: "App",
                icon: currentPreviewMode == 3 ? "ic_checked" : "ic_unchecked",
                id: 3
            }
        ];
        showContext(menu, function () {
            switch (this.id) {
                case 0:  // only grid
                    $("#border-box").addClass(CLS_FORCE_NO_BG).addClass(CLS_HIDE_MY_BG);
                    $("#image-preview").hide();
                    break;
                case 1: // Only image
                    $("#image-preview").show();
                    break;
                case 2: // both
                    $("#image-preview").hide();
                    $("#border-box").removeClass(CLS_FORCE_NO_BG).addClass(CLS_HIDE_MY_BG);
                    break;
                case 3: // App view
                    $("#image-preview").hide();
                    $("#border-box").addClass(CLS_FORCE_NO_BG).removeClass(CLS_HIDE_MY_BG);
                    break;
            }
            currentPreviewMode = this.id;
        }, e);
    };
    $("#sshot-tab").bind("contextmenu", showPreviewContext);

    /** ********************** Show/hide hidden nodes ********************** */
    // Hides the hode and all its children recursively.
    var hideNode = function (node, hide) {
        hide = hide || !node.isVisible;
        if (hide) {
            node.box.hide();
            node.el.hide();
        }
        if (node.children.length) {
            for (var i = 0; i < node.children.length; i++) {
                hideNode(node.children[i], hide);
            }
        }
    }

    var showHiddenNodeOptionChanged = function () {
        if (showHiddenNodes) {
            $("#vlist_content label, #border-box div").show();
        } else {
            hideNode(currentRootNode);
        }
    }

    /** ********************** Save hierarchy ********************** */
    var saveHierarchy = async function () {
        var zip = new JSZip();
        var config = {
            version: 1,
            title: currentAppInfo.name,
            density: viewController.density,
            sdk_version: viewController.sdk_version,
            use_new_api: viewController.use_new_api
        };
        zip.file("config.json", JSON.stringify(config));
        zip.file("hierarchy.txt", searializeNode(currentRootNode));

        var imgFolder = zip.folder("img");

        var loaders = {};
        function loadImagesRecur(node) {
            if (node.imageUrl) {
                loaders[node.name + ".png"] = doXhr(node.imageUrl, 'arraybuffer');
            }

            for (var i = 0; i < node.children.length; i++) {
                loadImagesRecur(node.children[i]);
            }
        }
        loadImagesRecur(currentRootNode);

        for (let name in loaders) {
            if (loaders[name]) {
                try {
                    imgFolder.file(name, await loaders[name], { binary: true });
                } catch (e) {
                    // Ignore
                }
            }
        }
        let title = currentAppInfo.name.split(".");
        title = title[title.length - 1];
        saveFile(title + "-hierarchy.zip", createUrl(zip.generate({ type: "blob" })));
    };

    /** ********************** Tabs ********************** */
    $("#hviewtabs div").click(function() {
        $("#hviewtabs div").removeClass("selected");
        $("#sshot, #vlist, #pList, #rcontent").removeClass("showAsTab");
        $($(this).addClass("selected").attr("target")).addClass("showAsTab");
        resizeBoxView();
    });

});
