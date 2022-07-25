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

let hViewAction;
let tlHvAction;

$(function () {
    let currentAppInfo;
    const KEY_DIVIDER = "divider";

    let currentRootNode = null;
    let selectedNode;
    let favoriteProperties = [];
    let viewController;
    let showHiddenNodes = false;
    let valueTypeMap = {};

    const closedSections = {};

    /* When showing time lapse view hierarchies, cloning these prototypes to build
       the UX rather than constructing them every time saves ~1.25ms per iteration. */
    const divProtoType = document.createElement("div")
    const xlinewrapProtoType = document.createElement("x-line-wrap")
    const xprofileProtoType = document.createElement("x-profile")
    const labelProtoType = document.createElement("label")
    labelProtoType.classList.add(CLS_WITH_ARROW)
    const spanProtoType = document.createElement("span")
    const newContainerProtoType = divProtoType.cloneNode()
    newContainerProtoType.classList.add(CLS_TREENODE)

    const PROCESSING_MS = 10;
    const FRAME_MS = 16;

    // Load favorite properties
    if (localStorage.favoriteProps) {
        try {
            const tmp = JSON.parse(localStorage.favoriteProps);
            if (tmp && tmp.constructor == Array) {
                favoriteProperties = tmp;
            }
        } catch(e) { }
    }

    // Load favorite properties
    if (localStorage.valueTypeMap) {
        try {
            const tmp = JSON.parse(localStorage.valueTypeMap);
            if (tmp && tmp.constructor == Object) {
                valueTypeMap = tmp;
            }
        } catch(e) { }
    }

    // Create dividers
    const shouldSaveResizeData = function() {
        return !$("#hviewtabs").is(":visible");
    }

    const createDaggerDownControl = function(divider) {
        const invalue1 = parseInt(divider.e1.css(divider.right));
        const invalue2 = parseInt(divider.e2.css(divider.width));
        const invalueDragger = parseInt(divider.dragger.css(divider.right));

        const v1 = divider.e1[divider.width]();
        const v2 = divider.e2[divider.width]();

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

    const handleMouseDown = function(e) {
        const divider = $(this).data(KEY_DIVIDER);
        const start = e[divider.pageX];
        const control = createDaggerDownControl(divider);

        const handleMouseMove = function(e) {
            control(e[divider.pageX] - start);
        }

        const handleMouseUp = function(e) {
            $(document).unbind();

            // Save settings.
            let data = {};
            $(".divider").each(function () {
                const obj = $(this).data(KEY_DIVIDER);
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

    const handleTouchStart = function(e) {
        e.preventDefault();
        handleMouseDown.apply(this, e.originalEvent.touches);
    }

    $(".divider").each(function () {
        const el = $(this);
        const controls = el.attr("control").split(",");

        const obj = {
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
    const applyResizeData = function() {
        if (localStorage.resizeData && shouldSaveResizeData()) {
            const data = JSON.parse(localStorage.resizeData);
            for (const id in data) {
                const divider = $("#" + id).data(KEY_DIVIDER);
                if (!divider || (typeof data[id]) != "string") {
                    continue;
                }
                const invalueDragger = parseInt(divider.dragger.css(divider.right));
                const val = parseInt(data[id]);
                createDaggerDownControl(divider)(invalueDragger - val);
            }
        }
    };

    // In case of properties box, its width can change with changes to right panel.
    (function () {
        const obj = $("#properties-divider").data(KEY_DIVIDER);
        $("#rcontent").on("resizing", function () {
            const w1 = obj.e1.width();
            if (w1 < obj.l1) {
                const delta = obj.l1 - w1;

                obj.e1.css("right", parseInt(obj.e1.css("right")) - delta);
                obj.e2.css("width", parseInt(obj.e2.css("width")) - delta);
                obj.dragger.css("right", parseInt(obj.dragger.css("right")) - delta);
            }
        });
    })();

    /********************************* Filter properties *********************************/
    const filterProperties = function () {
        const q = $("#pfilter").val().trim().toLocaleLowerCase();
        const sections = $(".pcontainer .expandable");
        let total = 0;

        if (q == "") {
            $(".pcontainer label").show();
            sections.each(function () {
                total++;
                const left = $(this).data("lbox").children();
                if (!$(this).hasClass(CLS_CLOSED)) {
                    total += left.length;
                }
                for (let i = 0; i < left.length; i++) {
                    // Remove any formatting.
                    const child = $(left[i]).children().eq(1);
                    child.text(child.text());
                }
            });
        } else {
            const re = new RegExp("(" + q.split(' ').join('|') + ")", "gi");
            sections.each(function () {
                let found = 0;
                const left = $(this).data("lbox").children();
                const right = $(this).data("rbox").children();
                for (let i = 0; i < left.length; i++) {
                    const child = $(left[i]).children().eq(1);
                    const itemText = child.text();
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
    const loadImage = function (node) {
        node.imageUrl = URL_LOADING;
        viewController.captureView(node.name).then(imageData => {
            const blob = new Blob([imageData], { type: "image/png" });
            const url = createUrl(blob);
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
            if (node.box.classList.contains(CLS_SELECTED)) {
                $("#image-preview").showError("Error loading image");
            }
        });
    }

    const toggleFavorite = function (e) {
        const name = $(this).data("pname");
        if ($(this).toggleClass(CLS_SELECTED).hasClass(CLS_SELECTED)) {
            favoriteProperties.push(name);
        } else {
            favoriteProperties = $.grep(favoriteProperties, function (value) {
                return value != name;
            });
        }
        localStorage.favoriteProps = JSON.stringify(favoriteProperties);
    }

    const propertySectionToggle = function (e) {
        const me = $(this).toggleClass(CLS_CLOSED);
        const left = me.data("lbox");
        const right = me.data("rbox");
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
    const toHex = function(i, len) {
        let s = i.toString(16);
        if (s.length < len) {
            s = "0000000000000000".slice(0, len - s.length) + s;
        }
        return s;
    }

    const argb2rgba = function(i) {
        // ensure unsigned 32-bit int
        const ui32 = (0xFFFFFFFF & i) >>> 0;
        // take one down, pass it around
        return (((ui32 & 0xFFFFFF) << 8) | (ui32 >>> 24));
    }

    const selectNode = function () {
        if (this.classList.contains(CLS_SELECTED)) return;
        document.querySelectorAll(".last_selected").forEach((it) => {
            it.classList.remove(CLS_LAST_SELECTED);
        })
        document.querySelectorAll(".selected").forEach((it) => {
            it.classList.remove(CLS_SELECTED)
            it.classList.add(CLS_LAST_SELECTED);
        })
        this.classList.add(CLS_SELECTED);
        this.box.classList.add(CLS_SELECTED);

        $("#border-box .selected, #image-preview").css('background-image', 'none')

        // Render properties;
        const nHolder = $("#p_name").empty();
        const vHolder = $("#p_val").empty();

        let lastType = "";
        let nSubHolder = nHolder;
        let vSubHolder = vHolder;

        const addProp = function (p, type) {
            if (type != lastType) {
                lastType = type;

                // Add section
                const section = $("<label>").addClass(CLS_EXPANDABLE).addClass(CLS_WITH_ARROW).text(type).appendTo(nHolder).prepend("<span>");
                const valspace = $("<label>").html("&nbsp;").appendTo(vHolder);

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

            const pName = $("<label>").append($("<span />").text(p.name)).appendTo(nSubHolder);
            const value = "" + p.value;

            const labelTag = $("<label>");

            if (value == "") {
                labelTag.html("&nbsp;");
            } else {
                const valueF = parseFloat(p.value);
                const valueI = parseInt(p.value);
                let colorWell = undefined;

                if (!isNaN(valueF)) {
                    // Numbers could mean any number (sorry) of things, so let's try to show 
                    // some relevant interpretations, switchable via <option> drop-down.
                    const selectTag = $(`<select name="${p.name}">`).append($("<option value='default'>").text(value));
                    if (viewController.density > 0) {
                        const dp = Math.round(valueF * 160 * 100 / viewController.density) / 100;
                        if (Math.abs(dp) < 10000) {
                            // probably a reasonable dimension
                            selectTag.append($("<option value='size-dp'>").text(dp + " dp"));
                        }
                    }
                    if (valueF == valueI) {
                        const valueU = valueI >>> 0;
                        let valueHex = "";
                        if (p.name.search(/color$/i) >= 0) {
                            valueHex = toHex(valueU, 8);
                            selectTag.append(
                                $("<option value='color-hex'>").text("#" + valueHex)
                            );
                        } else {
                            valueHex = toHex(valueU);
                            selectTag.append($("<option value='falgs-hex'>").text("0x" + valueHex));
                        }
                        if (valueHex) {
                            colorWell = $("<div>").addClass(CLS_COLORWELL);
                            selectTag.change(() => {
                                const myVal = "" + selectTag.val();
                                if (myVal.startsWith("#")) {
                                    const webColor = '#' + toHex(argb2rgba(valueU), 8);
                                    colorWell.css('display', 'inline-block').css('background-color', webColor);
                                } else {
                                    colorWell.hide();
                                }
                            })
                        }
                        const valuePref = valueTypeMap[p.name];
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
        for (let i = 0; i < favoriteProperties.length; i++) {
            const prop = this.node.namedProperties[favoriteProperties[i]];
            if (prop) {
                addProp(prop, "Favorites").addClass(CLS_SELECTED);
            }
        }

        if (this.node.properties != undefined) {
            for (let i = 0; i < this.node.properties.length; i++) {
                const p = this.node.properties[i];
                if (favoriteProperties.indexOf(p.fullname) < 0) {
                    addProp(p, p.type);
                }
            }
        }
        filterProperties();
        selectedNode = this.node;

        // Apply image
        if (this.node.imageUrl == URL_LOADING) {
            // Show a loading message
        } else if (this.node.imageUrl) {
            box.css('background-image', 'url("' + this.node.imageUrl + '")');
            $("#image-preview").empty().css('background-image', 'url("' + this.node.imageUrl + '")');
        } else {
            loadImage(this.node);
        }
    }

    const saveValueTypeSelect = function() {
        valueTypeMap[$(this).attr("name")] = $(this).val();
        const data = JSON.stringify(valueTypeMap);
        localStorage.valueTypeMap = data;
    }

    const profileInfoBox = $("#profile-info");
    const mouseOverNode = function () {
        this.box.classList.add(CLS_HOVER)

        if (this.node.profiled) {
            profileInfoBox.find("#profile-info-m").text(this.node.measureTime.toFixed(5));
            profileInfoBox.find("#profile-info-l").text(this.node.layoutTime.toFixed(5));
            profileInfoBox.find("#profile-info-d").text(this.node.drawTime.toFixed(5));
            profileInfoBox.show();            
        }
    }
    const mouseOutNode = function () {
        this.box.classList.remove(CLS_HOVER)
        profileInfoBox.hide();
    }

    const showNodeContext = function (e) {
        e.preventDefault();
        selectNode.call(this);

        const menu = [
            {
                text: "Save PNG",
                icon: "ic_save",
                disabled: !(this.node.imageUrl && this.node.imageUrl != URL_LOADING),
                id: 0
            },
            {
                text: "Reload PNG",
                icon: "ic_refresh",
                disabled: this.node.imageUrl == URL_LOADING,
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

        if (!this.node.disablePreview) {
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
    const treeToggle = function (e) {
        $(this).next()[$(this).toggleClass(CLS_CLOSED).hasClass(CLS_CLOSED) ? "hide" : "show"]();
    }
    const treeToggleFromArrow = function (e) {
        $(this).parent().dblclick();
    }

    const renderNode = function (node, container, boxContainer, maxW, maxH, leftShift, topShift, scaleX, scaleY) {
        const newScaleX = scaleX * node.scaleX;
        const newScaleY = scaleY * node.scaleY;

        const l = leftShift + (node.left + node.translationX) * scaleX + node.width * (scaleX - newScaleX) / 2;
        const t = topShift + (node.top + node.translationY) * scaleY + node.height * (scaleY - newScaleY) / 2;
        const boxPos = {
            left: l,
            top: t,
            width: node.width * newScaleX,
            height: node.height * newScaleY,
        };

        const box = divProtoType.cloneNode()
        box.style.left = (boxPos.left * 100 / maxW) + "%"
        box.style.top = (boxPos.top * 100 / maxH) + "%"
        box.style.width = (boxPos.width * 100 / maxW) + "%"
        box.style.height = (boxPos.height * 100 / maxH) + "%"
        boxContainer.appendChild(box)
        box.node = node

        if (node.name == undefined)
            node.name = node.classname
        let name = node.name.split(".");
        name = name[name.length - 1];

        const desc = node.contentDesc;
        if (desc != null) {
            name = name + " : " + desc;
        }
        node.desc = name;

        const elWrap = xlinewrapProtoType.cloneNode()
        elWrap.appendChild(document.createTextNode(name))
        elWrap.appendChild(xprofileProtoType.cloneNode())
    
        const el = labelProtoType.cloneNode()
        container.appendChild(el)
        el.onclick = selectNode
        el.onmouseover = mouseOverNode
        el.onmouseout = mouseOutNode
        el.oncontextmenu = showNodeContext
        el.appendChild(elWrap)
        el.node = node
        el.box = box
        box.el = el

        node.box = box
        node.el = el
        node.boxpos = boxPos;

        const span = spanProtoType.cloneNode()
        elWrap.insertBefore(span, null)
        span.onclick = treeToggleFromArrow

        if (node.children.length) {
            el.classList.add(CLS_EXPANDABLE)
            el.ondblclick = treeToggle
            const newContainer = newContainerProtoType.cloneNode()
            container.appendChild(newContainer)
            const shiftX = l - node.scrollX;
            const shiftY = t - node.scrollY;
            for (let i = 0; i < node.children.length; i++) {
                renderNode(node.children[i], newContainer, boxContainer, maxW, maxH, shiftX, shiftY, newScaleX, newScaleY);
            }
        }
    }

    const renderList = function (root, vListContent, boxContent) {
        // Remove any existing child nodes from both containers
        vListContent.replaceChildren();
        boxContent.replaceChildren();

        // Clear all transform from the root, so that it matches the preview
        root.scaleX = root.scaleY = 1;
        root.translationX = root.translationY = 1;

        renderNode(root, vListContent, boxContent, root.width, root.height, 0, 0, 1, 1)
    }

    /********************************* Refresh view *********************************/
    hViewAction = function (appInfo) {
        showViewHierarchyUX()

        viewController = createViewController(appInfo);
        viewController.loadViewList().then(v => {
            currentRootNode = v;
            renderList(v, document.getElementById("vlist_content"), document.getElementById("border-box"));
            onFirstViewHierarchyRendered()
            $("#main-progress").hide();    
        }).catch(msg => { handleLoadingListError(msg) });

        setupCustomCommandButton(viewController)
        setupWindowTitle(appInfo)
        currentAppInfo = appInfo;
        setupBackButton(appInfo)
    }

    function setupBackButton(appInfo) {
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

    function showViewHierarchyUX() {
        $("#vlist_content, #border-box").empty()
        $("#main-progress").show()
        $("#device-list-content").hide()
        $("#darkThemeSwitch").hide()
        $("#hview").removeClass("hide").removeClass("hidden");
    }

    function onFirstViewHierarchyRendered() {
        resizeBoxView();
        showHiddenNodeOptionChanged();    
        applyResizeData();
        $("#vlist_content label").first().click();
    }

    tlHvAction = function(appInfo) {
        currentAppInfo = appInfo
        viewController = new TimeLapseBugReportServiceController(appInfo)

        showViewHierarchyUX()
        setupCustomCommandButton(viewController)
        setupWindowTitle(currentAppInfo)
        setupBackButton(appInfo)

        if ($(".slider-group").hasClass("hidden")) {
            $(".slider-group").toggleClass("visible hidden")
            $("#vlist, #border-box").addClass("multi-page")
        }

        const vListJQueries /* jQuery[] */  = []
        const boxJQueries /* jQuery[] */ = []
        let rootNodes /* ViewNode[] */ = []
        let nodeMap /* Map<String, ViewNode[]> | null */ = new Map()

        viewController.loadViewList().then(function(nodes) {
            rootNodes = nodes
            currentRootNode = rootNodes[0]
            document.getElementById("tl-range").max = (rootNodes.length-1).toString()

            function addToNodeMap(node /* ViewNode */, rootNodeIndex /* Integer */) {
                let mapValue /* ViewNode[] | null */ = nodeMap.get(node.name)
                if (mapValue == null) {
                    mapValue = Array(rootNodes.length)
                    nodeMap.set(node.name, mapValue)
                }
                mapValue[rootNodeIndex] = node
                for (let i = 0; i < node.children.length; i++) {
                    addToNodeMap(node.children[i], rootNodeIndex)
                }
            }

            let processingStartTime;

            /* processRootNodes processes as many root nodes as it can within ~10ms. Then it pauses for a
               few milliseconds before hogging the main thread again so that the user can interact with a
               working and non-janky UI while the entire collection of time lapse data is being processed.

               If you are wondering why web workers were not used instead, that is because they do not 
               work well for this use case due to the following: 1) JQuery/DOM manipulation needs a DOM in
               order to work properly. I tried using a fake DOM, and JQuery's append/after/before methods
               didn't work. 2) Functions cannot be passed to and from WebWorkers, so the hover / click / etc.
               methods can't be prepared off the main thread. Also, aside from WebWorkers, Javascript in the
               browser doesn't provide any alternative methods of multi-threaded programming. */
            function processRootNodes(processedIndex /* Integer */, isNewRoundOfProcessing /* Boolean */) {
                if (isNewRoundOfProcessing) {
                    processingStartTime = Date.now()
                }

                const tBox = divProtoType.cloneNode()
                const tVList = divProtoType.cloneNode()

                renderList(rootNodes[processedIndex], tVList, tBox)
                vListJQueries.push(tVList)
                boxJQueries.push(tBox)
                addToNodeMap(rootNodes[processedIndex], processedIndex)

                if (processedIndex == 0) {
                    document.getElementById("vlist_content").replaceChildren(...tVList.childNodes)
                    document.getElementById("border-box").replaceChildren(...tBox.childNodes)
                    onFirstViewHierarchyRendered()
                }

                if (processedIndex < rootNodes.length-1) {
                    if ((Date.now() - processingStartTime) < PROCESSING_MS) {
                        processRootNodes(processedIndex+1, false)
                    } else {
                        setTimeout(
                            processRootNodes,
                            Math.max(FRAME_MS + processingStartTime - Date.now(), 1),
                            processedIndex+1,
                            true)
                    }
                } else {
                    $("#main-progress").hide();    
                }
            }
            processRootNodes(0, true);
        })

        function migrateSelectedState(index /* Integer */) {
            function migrateOneClassOnOneComponent(clazz /* String */, containerId /* String */, elementAccessor /* String */) {
                $("#" + containerId + " ." + clazz).each(function (_) {
                    this.classList.remove(clazz)
                    const mapValue /* ViewNode | null */ = nodeMap.get(this.node.name)[index]
                    mapValue[elementAccessor].classList.add(clazz)
                })
            }
            migrateOneClassOnOneComponent(CLS_SELECTED, "vlist", "el")
            migrateOneClassOnOneComponent(CLS_LAST_SELECTED, "vlist", "el")
            migrateOneClassOnOneComponent(CLS_SELECTED, "border-box", "box")
            migrateOneClassOnOneComponent(CLS_LAST_SELECTED, "border-box", "box")
        }

        function switchViewHierarchy(newIndex /* Integer */, oldIndex /* Integer */) {
            const vListContent = document.getElementById("vlist_content")
            const borderBox = document.getElementById("border-box")

            vListJQueries[oldIndex].replaceChildren(...vListContent.childNodes)
            vListContent.replaceChildren(...vListJQueries[newIndex].childNodes)

            boxJQueries[oldIndex].replaceChildren(...borderBox.childNodes)
            borderBox.replaceChildren(...boxJQueries[newIndex].childNodes)
        }

        let previousIndex = 0

        $("#tl-range")
            .val("0")
            .unbind("input change")
            .on("input change", (jQueryEvent) => {
                /* vListJQueries.length - 1 represents the number of root nodes that have already been processed
                   and are available to be shown as a view hierarchy to the user. */
                const index = Math.min(jQueryEvent.target.value, vListJQueries.length - 1)
                if (previousIndex != index) {
                    // Ordering of methods within 'if statement' matters for correct behavior
                    migrateSelectedState(index)
                    switchViewHierarchy(index, previousIndex)

                    currentRootNode = rootNodes[index]
                    showHiddenNodeOptionChanged()

                    previousIndex = index
                    $("#tl-range").val(index)
                }
            })
    }

    function setupCustomCommandButton(viewController) {
        if (viewController.customCommand) {
            $("#btn-custom-command").show();
            loadSuggestions(viewController.device);
        } else {
            $("#btn-custom-command").hide();
        }
    }

    function setupWindowTitle(appInfo) {
        let title = appInfo.name.split(".");
        title = title[title.length - 1];
        $("#windowTitle").text(document.title = title + " [" + appInfo.name + "]")
    }

    function handleLoadingListError (msg) {
        $("#hview").removeClass("hide").removeClass("hidden")
        $("#vlist_content").showError(msg ? msg : "Error loading view hierarchy")
    }

    /********************************* Preview Grid resize *********************************/
    const resizeBoxView = function () {
        if (!currentRootNode) return;
        const container = $("#box-border-container");
        const cW = container.width();
        const cH = container.height();

        const mW = currentRootNode.width;
        const mH = currentRootNode.height;
        const scale = Math.min(cW / mW, cH / mH);

        const w = scale * mW;
        const h = scale * mH;
        $("#border-box").css({
            width: w,
            height: h,
            left: (cW - w) / 2,
            top: (cH - h) / 2
        });
    }
    $("#rcontent, #sshot").on("resizing", resizeBoxView);

    /** ********************** Box hover handling ***************** */
    const scrollToNode = function (node) {
        // expand nodes recursively
        let parent = node.parent;
        while (parent) {
            if (parent.el.hasClass(CLS_EXPANDABLE) && parent.el.hasClass(CLS_CLOSED)) {
                parent.el.removeClass(CLS_CLOSED).next().show();
            }
            parent = parent.parent;
        }
        scrollToView(node.el, $("#vlist_content"));
    }

    /* TODO: When selecting UX element, select the top-most element. Currently, clicking on anything 
       within the border-box usually highlights the ScrimView as opposed to the actual target element. */
    $("#border-box").mouseover(function (e) {
        const offset = $(this).offset();

        const nodesHidden = !showHiddenNodes;
        const widthFactor = currentRootNode.width / $(this).width();
        const heightFactor = currentRootNode.height / $(this).height();

        const updateSelection = function (node, x, y, firstNoDrawChild, clipX1, clipY1, clipX2, clipY2) {
            if (node.disablePreview) {
                return null;
            }
            if (!node.nodeDrawn) {
                return null;
            }
            if (nodesHidden && !node.isVisible) {
                return null;
            }

            const wasFirstNoDrawChildNull = firstNoDrawChild[0] == null;
            const boxpos = node.boxpos;

            const boxRight = boxpos.width + boxpos.left;
            const boxBottom = boxpos.top + boxpos.height;
            if (node.clipChildren) {
                clipX1 = Math.max(clipX1, boxpos.left);
                clipY1 = Math.max(clipY1, boxpos.top);
                clipX2 = Math.min(clipX2, boxRight);
                clipY2 = Math.min(clipY2, boxBottom);
            }
            if (clipX1 < x && clipX2 > x && clipY1 < y && clipY2 > y) {
                for (let i = node.children.length - 1; i >= 0; i--) {
                    const child = node.children[i];
                    const ret = updateSelection(child, x, y, firstNoDrawChild, clipX1, clipY1, clipX2, clipY2);
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

        let lastMatch = document.querySelector("#border-box div.hover")
        if (lastMatch) {
            lastMatch = lastMatch.node
        }
        const findBox = function (e) {
            const x = (e.pageX - offset.left) * widthFactor;
            const y = (e.pageY - offset.top) * heightFactor;
            const firstNoDrawChild = [null];
            return updateSelection(currentRootNode, x, y, firstNoDrawChild, 0, 0, currentRootNode.width, currentRootNode.height);
        }
        const onMove = function (e) {
            const found = findBox(e);
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
            const found = findBox(e);
            if (found) {
                found.el.click();
                scrollToNode(found);
            }
        }).unbind("contextmenu").bind("contextmenu", function (e) {
            const found = findBox(e);
            if (found) {
                showNodeContext.call(found.el.get(0), e);
            }
        });

        onMove(e);
    }).mouseout(function (e) {
        $("#border-box div.hover, #vlist_content label.hover").removeClass(CLS_HOVER);
    });

    /** ********************** Context menu ********************** */
    const collapseAll = function (node) {
        if (node.el.hasClass(CLS_EXPANDABLE)) {
            node.el.addClass(CLS_CLOSED).next().hide();
            for (let i = 0; i < node.children.length; i++) {
                collapseAll(node.children[i]);
            }
        }
    }

    const onNodeContextMenuSelected = function () {
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
    const profileView = async function(node) {
        let data = await viewController.profileView(node.name);
        data = data.split("\n");
        let index = 0;

        function loadProp(n) {
            const line = data[index];
            index++;            
            if (!line || line == "-1 -1 -1" || line.toLocaleLowerCase() == "done.") {
                return false;
            }

            const times = line.split(" ");
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
            const e = $("<a>").text(name).appendTo(el);
            if (value >= RED_THRESHOLD) {
                e.addClass("red");
            } else if (value >= YELLOW_THRESHOLD) {
                e.addClass("yellow")
            } else {
                e.addClass("green");
            }
        }

        function setProfileRatings(n) {
            const N = n.children.length;
            if (N > 1) {
                let totalMeasure = 0;
                let totalLayout = 0;
                let totalDraw = 0;
                for (let i = 0; i < N; i++) {
                    const child = n.children[i];
                    totalMeasure += child.measureTime;
                    totalLayout += child.layoutTime;
                    totalDraw += child.drawTime;
                }
                for (let i = 0; i < N; i++) {
                    const child = n.children[i];
                    const el = child.el.find("x-profile").empty().show();

                    addIndicator(el, "M", child.measureTime / totalMeasure);
                    addIndicator(el, "L", child.layoutTime / totalLayout);
                    addIndicator(el, "D", child.drawTime / totalDraw);
                }
            } else if (N == 1) {
                const child = n.children[0];
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
    let lastNodeSearchText = "";
    $("#btn-search-node").click(function(e) {
        let searchInput;
        const elementFactory = function(el, hideMenu) {
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

        const nodeSearch = function (dir) {
            let query = searchInput.val();
            if (query == "") return;
            lastNodeSearchText = query;
            query = query.toLocaleLowerCase();

            // Search through boxes, as nodes might be collapsed.
            const boxes = $("#border-box div");
            const nodes = boxes.filter(function() {
                return $(this).css("display") != "none";
            }).map(function () {
                return this.node.el.get(0);
            });

            let st = nodes.index(selectedNode.el);
            const count = nodes.length;

            for (let i = -1; i < count; i++) {
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
    let ignoreNextKeyUp = false;

    $("#btn-custom-command").click(function (e) {
        let commandInput;
        let errorContainer;
        const elementFactory = function(el) {
            commandInput = $("<input type=search placeholder='Custom command'>").appendTo(el);
            errorContainer = $("<div class='custom-command-error-wrapper'>").appendTo(el);
        }
        const popup = showPopup(e, elementFactory);


        if (viewMethodList != null) {
            // Setup auto complete
            const methodAutoComplete = new autoComplete({
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

    const executeCommand = function (cmd, errorContainer) {
        cmd = cmd.trim();
        const m = cmd.match(/^([a-zA-Z_0-9]+)\s*\(([^)]*)\);?$/);

        if (!m) {
            errorContainer.showError("Invalid method format: methodName(param1, param2...). eg: setEnabled(false), setVisibility(0), setAlpha(0.9f)");
            return;
        }

        const data = new DataOutputStream();
        data.writeStr(m[1]);

        if (m[2].trim() != "") {
            const params = m[2].split(",");
            data.writeInt(params.length);
            for (let i = 0; i < params.length; i++) {
                try {
                    let p = params[i].trim().toLocaleLowerCase();

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

    let viewMethodList = null;

    const autoCompleteSource = function (term, suggest) {
        term = term.toLowerCase().trim();
        const matches = [];
        for (let i = 0; i < viewMethodList.length; i++) {
            if (~viewMethodList[i][0].toLowerCase().indexOf(term)) matches.push(viewMethodList[i]);
        }
        suggest(matches);
    };

    const suggestionRenderer = function (item, search) {
        // escape special characters
        search = search.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const re = new RegExp("(" + search.split(' ').join('|') + ")", "gi");
        return '<div class="autocomplete-suggestion" data-val="' + item[0] + '">' + item[0].replace(re, "<b>$1</b>") + "(" + item[1] + ")" + '</div>';
    }

    const loadSuggestions = async function (device) {
        await device.sendFile("/data/local/tmp/methods.jar", "commands/methods.jar");
        let response = await device.shellCommand("export CLASSPATH=/data/local/tmp/methods.jar;exec app_process /system/bin MethodList");
        response = JSON.parse(response.split("\n", 2)[1]);
        viewMethodList = response;
    };

    /** ********************** Main Menu ********************** */
    $("#btn-options").click(function() {
        const menu = [
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

        const offset = $(this).offset();
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
                    const submenuOffset = el.addClass(CLS_SELECTED).offset();
                    showPreviewContext({pageX: submenuOffset.left + el.width() / 2, pageY: submenuOffset.top + el.height() / 4})
                    return true;    // Don't ide te existing popup
            }
        },
        {pageX: offset.left, pageY: offset.top});
    });

    let currentPreviewMode = 3;
    const showPreviewContext = function(e) {
        const menu = [
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
    // Hides the node and all its children recursively.
    const hideNode = function (node, hide) {
        hide = hide || !(node.isVisible || node.visibility == VIEW_VISIBLE);
        if (hide) {
            node.box.style.display = "none"
            node.el.style.display = "none"
        }
        if (node.children.length) {
            for (let i = 0; i < node.children.length; i++) {
                hideNode(node.children[i], hide);
            }
        }
    }

    const showHiddenNodeOptionChanged = function () {
        if (showHiddenNodes) {
            $("#vlist_content label, #border-box div").show();
        } else {
            hideNode(currentRootNode);
        }
    }

    /** ********************** Save hierarchy ********************** */
    const saveHierarchy = async function () {
        const zip = new JSZip();
        const config = {
            version: 1,
            title: currentAppInfo.name,
            density: viewController.density,
            sdk_version: viewController.sdk_version,
            use_new_api: viewController.use_new_api
        };
        zip.file("config.json", JSON.stringify(config));
        zip.file("hierarchy.txt", searializeNode(currentRootNode));

        const imgFolder = zip.folder("img");

        const loaders = {};
        function loadImagesRecur(node) {
            if (node.imageUrl) {
                loaders[node.name + ".png"] = doXhr(node.imageUrl, 'arraybuffer');
            }

            for (let i = 0; i < node.children.length; i++) {
                loadImagesRecur(node.children[i]);
            }
        }
        loadImagesRecur(currentRootNode);

        for (const name in loaders) {
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
