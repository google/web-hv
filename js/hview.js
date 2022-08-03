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
    let lastSelectedNode;
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
    const selectProtoType = document.createElement("select")
    const optionProtoType = document.createElement("option")

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
                const left = this.lbox.children;
                if (!this.classList.contains(CLS_CLOSED)) {
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
                const left = this.lbox.children;
                const right = this.rbox.children;
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
                    this.style.display = "inline-block"
                    this.valspace.style.display = "inline-block"

                    total++;
                    if (!this.classList.contains(CLS_CLOSED)) {
                        total += found;
                    }
                } else {
                    this.style.display = "none"
                    this.valspace.style.display = "none"
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
            if (node.box.classList.contains(CLS_SELECTED)) {
                node.box.style.backgroundImage = 'url("' + node.imageUrl + '")'
                $("#image-preview").empty().css('background-image', 'url("' + node.imageUrl + '")');
            }
        }).catch((e) => {
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
        this.classList.toggle(CLS_CLOSED)
        if (closedSections[$(this).text()] = this.classList.contains(CLS_CLOSED)) {
            $(this.lbox).slideUp("fast")
            $(this.rbox).slideUp("fast")
        } else {
            $(this.lbox).slideDown("fast")
            $(this.rbox).slideDown("fast")
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
        lastSelectedNode = selectedNode
        selectedNode = this.node;

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
        renderProperties(this.node)

        // Apply image
        if (this.node.imageUrl == URL_LOADING) {
            // Show a loading message
        } else if (this.node.imageUrl) {
            this.box.style.backgroundImage = 'url("' + this.node.imageUrl + '")'
            $("#image-preview").empty().css('background-image', 'url("' + this.node.imageUrl + '")');
        } else {
            loadImage(this.node);
        }
    }

    function renderProperties(node /* ViewNode */) {
        const nameContainer = document.getElementById("p_name")
        nameContainer.replaceChildren()

        const valContainer = document.getElementById("p_val")
        valContainer.replaceChildren()

        let lastType = "";
        let nameSubContainer = nameContainer
        let valSubContainer = valContainer

        const addProp = function (p, type) {
            if (type != lastType) {
                lastType = type;

                const typeSection = labelProtoType.cloneNode()
                typeSection.classList.add(CLS_EXPANDABLE, CLS_WITH_ARROW)
                typeSection.appendChild(document.createTextNode(type))
                nameContainer.appendChild(typeSection)
                typeSection.insertBefore(spanProtoType.cloneNode(), null)

                const valSpace = labelProtoType.cloneNode()
                valSpace.innerHTML = "&nbsp;"
                valContainer.appendChild(valSpace)

                nameSubContainer = divProtoType.cloneNode()
                nameContainer.appendChild(nameSubContainer)
                valSubContainer = divProtoType.cloneNode()
                valContainer.appendChild(valSubContainer)

                typeSection.lbox = nameSubContainer
                typeSection.rbox = valSubContainer
                typeSection.valspace = valSpace
                typeSection.onclick = propertySectionToggle

                if (closedSections[type]) {
                    nameSubContainer.style.display = "none"
                    valSubContainer.style.display = "none"
                    typeSection.classList.add(CLS_CLOSED)
                }
            }

            const nameLabel = labelProtoType.cloneNode()
            nameLabel.appendChild(spanProtoType.cloneNode())
            nameLabel.appendChild(document.createTextNode(p.name))
            nameSubContainer.appendChild(nameLabel)

            const value = "" + p.value;
            const labelTag = labelProtoType.cloneNode()

            if (value == "") {
                labelTag.innerHTML = "&nbsp;"
            } else {
                const valueF = parseFloat(p.value);
                const valueI = parseInt(p.value);
                let colorWellDiv = undefined;

                if (!isNaN(valueF)) {
                    // Numbers could mean any number (sorry) of things, so let's try to show 
                    // some relevant interpretations, switchable via <option> drop-down.
                    const selectTag = selectProtoType.cloneNode()
                    selectTag.name = p.name
                    const optionTag = optionProtoType.cloneNode()
                    optionTag.value = 'default'
                    optionTag.innerHTML = value
                    selectTag.appendChild(optionTag)

                    if (viewController.density > 0) {
                        const dp = Math.round(valueF * 160 * 100 / viewController.density) / 100;
                        if (Math.abs(dp) < 10000) {
                            // probably a reasonable dimension
                            const sizeDpOption = optionProtoType.cloneNode()
                            sizeDpOption.value = 'size-dp'
                            sizeDpOption.innerHTML = dp + " dp"
                            selectTag.appendChild(sizeDpOption)
                        }
                    }
                    if (valueF == valueI) {
                        const valueU = valueI >>> 0;
                        let valueHex = "";
                        if (p.name.search(/color$/i) >= 0) {
                            valueHex = toHex(valueU, 8);
                            const colorHexOption = optionProtoType.cloneNode()
                            colorHexOption.value = 'color-hex'
                            colorHexOption.innerHTML = "#" + valueHex
                            selectTag.appendChild(colorHexOption)
                        } else {
                            valueHex = toHex(valueU);
                            const falgsHexOption = optionProtoType.cloneNode()
                            falgsHexOption.value = 'falgs-hex'
                            falgsHexOption.innerHTML = "0x" + valueHex
                            selectTag.appendChild(falgsHexOption)
                        }
                        if (valueHex) {
                            colorWellDiv = divProtoType.cloneNode()
                            colorWellDiv.classList.add(CLS_COLORWELL)

                            selectTag.onchange = () => {
                                const myVal = "" + selectTag.val();
                                if (myVal.startsWith("#")) {
                                    const webColor = '#' + toHex(argb2rgba(valueU), 8);
                                    colorWellDiv.style.display = 'inline-block'
                                    colorWellDiv.style.backgroundColor = webColor
                                } else {
                                    colorWellDiv.style.display = "none"
                                }
                            }
                        }
                        const valuePref = valueTypeMap[p.name];
                        if (valuePref != undefined) {
                            const valueArray = Array.from(selectTag.children, function() { return this.value; })
                            if (valueArray.indexOf(valuePref) >= 0) {
                                selectTag.val(valuePref);
                            }
                        }
                        selectTag.onchange = saveValueTypeSelect;
                    }
                    labelTag.classList.add(CLS_MULTI_TOGGLE)
                    labelTag.appendChild(selectTag);
                    if (colorWellDiv) labelTag.appendChild(colorWellDiv);
                } else {
                    labelTag.appendChild(document.createTextNode(value))
                }
            }

            valSubContainer.appendChild(labelTag)

            const starSpan = spanProtoType.cloneNode()
            starSpan.classList.add("star")
            starSpan.pName = p.fullname
            nameLabel.insertBefore(starSpan, null)
            starSpan.onclick = toggleFavorite
            return starSpan
        }

        // Selected properties
        for (let i = 0; i < favoriteProperties.length; i++) {
            const prop = node.namedProperties[favoriteProperties[i]];
            if (prop) {
                const starSpan = addProp(prop, "Favorites")
                starSpan.classList.add(CLS_SELECTED);
            }
        }

        for (let i = 0; i < node.properties.length; i++) {
            const p = node.properties[i];
            if (favoriteProperties.indexOf(p.fullname) < 0) {
                addProp(p, p.type);
            }
        }
        filterProperties();
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

    const renderNode = function (node, container, boxContainer) {
        const box = divProtoType.cloneNode()
        box.style.left = node.boxStylePos.left;
        box.style.top = node.boxStylePos.top;
        box.style.width = node.boxStylePos.width;
        box.style.height = node.boxStylePos.height;
        box.node = node
        boxContainer.appendChild(box)

        const span = spanProtoType.cloneNode()
        span.onclick = treeToggleFromArrow

        const elWrap = xlinewrapProtoType.cloneNode()
        elWrap.appendChild(span)
        elWrap.appendChild(document.createTextNode(node.simpleName))
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

        if (node.children.length) {
            el.classList.add(CLS_EXPANDABLE)
            el.ondblclick = treeToggle
            const newContainer = newContainerProtoType.cloneNode()
            container.appendChild(newContainer)
            for (let i = 0; i < node.children.length; i++) {
                renderNode(node.children[i], newContainer, boxContainer);
            }
        }
    }

    /********************************* Refresh view *********************************/
    hViewAction = function (appInfo) {
        showViewHierarchyUX()

        viewController = createViewController(appInfo);
        viewController.loadViewList().then(rootNode => {
            currentRootNode = rootNode;

            const vListContent = document.getElementById("vlist_content")
            vListContent.replaceChildren()
            const borderBox = document.getElementById("border-box")
            borderBox.replaceChildren()
            renderNode(rootNode, vListContent, borderBox)

            onFirstViewHierarchyRendered()
            $("#main-progress").hide();
        }).catch(msg => { handleLoadingListError(msg) });

        if (viewController.customCommand) {
            $("#btn-custom-command").show();
            loadSuggestions(viewController.device);
        } else {
            $("#btn-custom-command").hide();
        }

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
                    $(".slider-group").addClass("hidden").removeClass("visible")
                    $("#vlist, #border-box").removeClass("multi-page")
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
        /* Set this to avoid null pointer exceptions. */
        viewController = new NoOpServiceController()

        showViewHierarchyUX()
        $("#btn-custom-command").hide();
        setupWindowTitle(currentAppInfo)
        setupBackButton(appInfo)
        $(".slider-group").removeClass("hidden").addClass("visible")
        $("#vlist, #border-box").addClass("multi-page")

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

        const vListDivs /* <div>[] */  = []
        const boxDivs /* <div>[] */ = []
        const rootNodes /* ViewNode[] */ = []
        const nodeMap /* Map<String, ViewNode[]> | null */ = new Map()

        let frameCount;
        let processedIndex /* Integer */ = 0

        /* If you are wondering why this work is not completely done in the web worker, its because JQuery/DOM
           manipulation needs a DOM in order to work properly. I tried using a fake DOM, and JQuery's
           append/after/before methods didn't work. Also, functions cannot be passed to and from WebWorkers,
           so the hover / click / etc. methods can't be prepared off the main thread. Aside from WebWorkers,
           browser Javascript doesn't provide any alternative methods of multi-threaded programming. */
        function processRootNode(event) {
            const rootNode = event.data.rootNode
            const tBox = divProtoType.cloneNode()
            const tVList = divProtoType.cloneNode()

            renderNode(rootNode, tVList, tBox)
            rootNodes.push(rootNode)
            vListDivs.push(tVList)
            boxDivs.push(tBox)
            addToNodeMap(rootNode, processedIndex)

            if (processedIndex == 0) {
                currentRootNode = event.data.rootNode
                document.getElementById("vlist_content").replaceChildren(...tVList.childNodes)
                document.getElementById("border-box").replaceChildren(...tBox.childNodes)
                onFirstViewHierarchyRendered()
            }
            processedIndex++

            if (processedIndex < frameCount) {
                w.postMessage({ processedIndex: processedIndex })
            } else {
                $("#main-progress").hide()
            }
        }

        /* It takes > 500ms to format 170 frames of launcher view hierarchy data,
           and then copy that data over from the worker thread to the main thread.
           In order to compensate for that, nodes are being continually formatted
           until completion on the background thread, and then copied over as needed
           1 at a time (copying an already formatted node takes ~1-2ms).

           The natural pauses that come from requesting and receiving nodes from the
           worker thread allow for a responsive and jank free UI while the entire collection
           of view hierarchies are processed. */
        const w = createWorker("js/ddmlib/tl-worker.js");
        w.onerror = function () {
            throw "Error parsing view data"
        }
        // Handle the first message, then delegate the rest of the responses to processRootNode
        w.onmessage = function (e) {
            frameCount = e.data.frameCount
            document.getElementById("tl-range").max = frameCount
            w.onmessage = processRootNode
            w.postMessage({ processedIndex: processedIndex })
        }
        w.postMessage({ tlHvDataAsBinaryArray: appInfo.data });

        function hasDifferentProperties(node /* ViewNode!! */, other /* ViewNode!! */) {
            return node.id != other.id
                || node.left != other.left
                || node.top != other.top
                || node.width != other.width
                || node.height != other.height
                || node.translationX != other.translationX
                || node.translationY != other.translationY
                || node.scaleX != other.scaleX
                || node.scaleY != other.scaleY
                || node.alpha != other.alpha
                || node.willNotDraw != other.willNotDraw
                || node.clipChildren != other.clipChildren
                || node.visibility != other.visibility
                || node.scrollX != other.scrollX
                || node.scrollY != other.scrollY
        }

        function migrateSelectedState(index /* Integer */) {
            function migrateOne(node /* ViewNode? */, clazz /* String */) {
                if (node == null) return

                function toggle() {
                    if (node == null) return
                    ["el", "box"].forEach((it) => node[it].classList.toggle(clazz))
                }

                toggle()
                node = nodeMap.get(node.name)[index]
                toggle()
                return node
            }

            const lastFramesSelectedNode = selectedNode
            selectedNode = migrateOne(selectedNode, CLS_SELECTED)

            if (selectedNode != null && hasDifferentProperties(lastFramesSelectedNode, selectedNode)) {
                renderProperties(selectedNode)
            }

            lastSelectedNode = migrateOne(lastSelectedNode, CLS_LAST_SELECTED)
        }

        function switchViewHierarchy(newIndex /* Integer */, oldIndex /* Integer */) {
            const vListContent = document.getElementById("vlist_content")
            const borderBox = document.getElementById("border-box")

            vListDivs[oldIndex].replaceChildren(...vListContent.childNodes)
            vListContent.replaceChildren(...vListDivs[newIndex].childNodes)

            boxDivs[oldIndex].replaceChildren(...borderBox.childNodes)
            borderBox.replaceChildren(...boxDivs[newIndex].childNodes)
        }

        let previousIndex = 0

        $("#tl-range")
            .val("0")
            .unbind("input change")
            .on("input change", (jQueryEvent) => {
                /* vListJQueries.length - 1 represents the number of root nodes that have already been processed
                   and are available to be shown as a view hierarchy to the user. */
                const index = Math.min(jQueryEvent.target.value, vListDivs.length - 1)
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
            if (parent.el.classList.contains(CLS_EXPANDABLE) && parent.el.classList.contains(CLS_CLOSED)) {
                $(parent.el).removeClass(CLS_CLOSED).next().show();
            }
            parent = parent.parent;
        }
        scrollToView($(node.el), $("#vlist_content"));
    }

    /* TODO: When selecting UX element, select the top-most element. Currently, clicking on anything 
       within the border-box usually highlights the ScrimView as opposed to the actual target element. */
    $("#border-box").mouseover(function (e) {
        const offset = $(this).offset();

        const nodesHidden = !showHiddenNodes;
        const widthFactor = currentRootNode.width / $(this).width();
        const heightFactor = currentRootNode.height / $(this).height();

        const updateSelection = function (node, x, y, firstNoDrawChild, clipX1, clipY1, clipX2, clipY2) {
            if (node.disablePreview || !node.nodeDrawn || (nodesHidden && !node.isVisible)) {
                return null;
            }

            const wasFirstNoDrawChildNull = firstNoDrawChild[0] == null;

            const boxRight = node.boxPos.width + node.boxPos.left;
            const boxBottom = node.boxPos.top + node.boxPos.height;
            if (node.clipChildren) {
                clipX1 = Math.max(clipX1, node.boxPos.left);
                clipY1 = Math.max(clipY1, node.boxPos.top);
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
            if (node.boxPos.left < x && boxRight > x && node.boxPos.top < y && boxBottom > y) {
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
                    lastMatch.el.classList.remove(CLS_HOVER);
                    lastMatch.box.classList.remove(CLS_HOVER);
                }

                if (found) {
                    found.el.classList.add(CLS_HOVER);
                    found.box.classList.add(CLS_HOVER);
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
        if (node.el.classList.contains(CLS_EXPANDABLE)) {
            $(node.el).addClass(CLS_CLOSED).next().hide();
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
                selectedNode.el.classList.add("preview-disabled");
                break;
            case 4: // Enable preview
                selectedNode.disablePreview = false;
                selectedNode.el.classList.remove("preview-disabled");
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
            const elList = boxes.filter((_, element) => element.style.display != "none")
                                .map((_, element) => element.node.el)

            let st = elList.index(selectedNode.el);
            const count = elList.length;

            for (let i = -1; i < count; i++) {
                st += dir;
                if (st < 0) {
                    st = count - 1;
                }
                if (st >= count) {
                    st = 0;
                }
                if ($(elList.get(st)).text().toLocaleLowerCase().indexOf(query) > -1) {
                    // Found element.
                    selectNode.call(elList.get(st));
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
            null,
            {
                text: "Dark theme",
                icon: isDarkTheme() ? "ic_checked" : "ic_unchecked",
                id: 5
            }
        ];

        if (!$("#hviewtabs").is(":visible")) {
            // Only show the preview menu when tabs are not available
            menu.unshift({
                text: "Preview",
                icon: "ic_submenu",
                id: 6
            },
            null);
        }

        if (viewController.loadScreenshot) {
            menu.push(null, {
                text: "Load screenshot",
                icon: "ic_layers",
                id: 4
            })
        }

        if (adbDevice && !adbDevice.disconnectedDevice) {
            menu.push(null,
                {
                    text: "Save hierarchy",
                    icon: "ic_save",
                    id: 1
                },
                {
                    text: "Refresh",
                    icon: "ic_refresh",
                    id: 2
                },
                {
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
                    const submenuOffset = $(el).addClass(CLS_SELECTED).offset();
                    showPreviewContext({pageX: submenuOffset.left + el.width() / 2, pageY: submenuOffset.top + el.height() / 4})
                    return true;    // Don't ide te existing popup
            }
        },
        {pageX: offset.left, pageY: offset.top});
    });

    function buildPreviewMenuItem(id, text) {
        return {
            text: text,
            icon: currentPreviewMode == id ? "ic_checked" : "ic_unchecked",
            id: id
        }
    }

    let currentPreviewMode = 3;
    const showPreviewContext = function(e) {
        const menu = [ buildPreviewMenuItem(0, "Grid") ]
        if (!viewController.hasNoImage) {
            menu.push(null, buildPreviewMenuItem(1, "Image"), null, buildPreviewMenuItem(2, "Both"))
        }
        menu.push(null, buildPreviewMenuItem(3, "App"))

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
        hide = hide || !node.isVisible
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
