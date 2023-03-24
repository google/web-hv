// Copyright 2022 Google LLC
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

const EXCLUSION_LIST = new Set([
    "toJSON",
    "$type",
    "constructor",
    "namedProperties",
    "properties",
    "children",
    "parent",
    "classname",
    "classnameIndex",
    "treeDisplayName",
    "hashcode",
    "name",
    "boxPos",
    "boxStylePos",
    "desc",
    "isVisible",
    "nodeDrawn"
])

const LAYOUT_TYPE = "Layout"
const DRAWING_TYPE = "Drawing"
const SCROLLING_TYPE = "Scrolling"
const MISC_TYPE = "Misc"
const DEFAULT_TYPE = "Unspecified"

const PROPERTY_TYPE_MAP = new Map()
PROPERTY_TYPE_MAP.set("left", LAYOUT_TYPE)
PROPERTY_TYPE_MAP.set("top", LAYOUT_TYPE)
PROPERTY_TYPE_MAP.set("width", LAYOUT_TYPE)
PROPERTY_TYPE_MAP.set("height", LAYOUT_TYPE)
PROPERTY_TYPE_MAP.set("elevation", LAYOUT_TYPE)
PROPERTY_TYPE_MAP.set("scrollX", SCROLLING_TYPE)
PROPERTY_TYPE_MAP.set("scrollY", SCROLLING_TYPE)
PROPERTY_TYPE_MAP.set("translationX", DRAWING_TYPE)
PROPERTY_TYPE_MAP.set("translationY", DRAWING_TYPE)
PROPERTY_TYPE_MAP.set("scaleX", DRAWING_TYPE)
PROPERTY_TYPE_MAP.set("scaleY", DRAWING_TYPE)
PROPERTY_TYPE_MAP.set("alpha", DRAWING_TYPE)
PROPERTY_TYPE_MAP.set("willNotDraw", DRAWING_TYPE)
PROPERTY_TYPE_MAP.set("clipChildren", DRAWING_TYPE)
PROPERTY_TYPE_MAP.set("visibility", MISC_TYPE)
PROPERTY_TYPE_MAP.set("id", DEFAULT_TYPE)

/* returns the root ViewNode that was passed in and altered */
const formatProperties = function(root /* ViewNode */, classNames /* string[] */) {
    function inner(node /* ViewNode */,
                   maxW /* Int */,
                   maxH /* Int */,
                   leftShift /* Int */,
                   topShift /* Int */,
                   scaleX /* Int */,
                   scaleY /* Int */) {
        const newScaleX = scaleX * node.scaleX
        const newScaleY = scaleY * node.scaleY

        const l = leftShift + (node.left + node.translationX) * scaleX + node.width * (scaleX - newScaleX) / 2
        const t = topShift + (node.top + node.translationY) * scaleY + node.height * (scaleY - newScaleY) / 2
        node.boxPos = {
            left: l,
            top: t,
            width: node.width * newScaleX,
            height: node.height * newScaleY,
        }

        node.boxStylePos = {
            left: (node.boxPos.left * 100 / maxW) + "%",
            top: (node.boxPos.top * 100 / maxH) + "%",
            width: (node.boxPos.width * 100 / maxW) + "%",
            height: (node.boxPos.height * 100 / maxH) + "%"
        }

        if (node.name == undefined) {
            node.name = node.classname
        }
        if (node.name == undefined && classNames) {
            node.name = classNames[node.classnameIndex] + "@" + node.hashcode;
        }

        node.treeDisplayName = node.name.split(".")
        node.treeDisplayName = node.treeDisplayName[node.treeDisplayName.length - 1];

        if (node.contentDesc != null) {
            node.treeDisplayName = node.treeDisplayName + " : " + node.contentDesc;
        }
        node.desc = node.treeDisplayName;
        node.isVisible = node.visibility == 0 || node.visibility == "VISIBLE" || node.visibility == undefined
        node.nodeDrawn = !node.willNotDraw;

        for (let i = 0; i < node.children.length; i++) {
            inner(node.children[i], maxW, maxH, l - node.scrollX, t - node.scrollY, newScaleX, newScaleY);
            node.children[i].parent = node;
            node.nodeDrawn |= (node.children[i].nodeDrawn && node.children[i].isVisible);
        }

        if (node.properties == undefined) {
            node.properties = []

            for (const propertyName in node) {
                if (!EXCLUSION_LIST.has(propertyName)) {
                    const property = new VN_Property(propertyName)
                    property.value = node[propertyName]
                    property.type = PROPERTY_TYPE_MAP.get(propertyName) || DEFAULT_TYPE
                    node.properties.push(property)
                }
            }

            node.properties.sort((a, b) => PROPERTY_TYPE_MAP.get(a.name)?.localeCompare(PROPERTY_TYPE_MAP.get(b.name)))
        }
        node.namedProperties = {};
        for (let i = 0; i < node.properties.length; i++) {
            node.namedProperties[node.properties[i].fullname] = node.properties[i];
        }
    }

    root.scaleX = root.scaleY = 1;
    root.translationX = root.translationY = 0;
    inner(root, root.width, root.height, 0, 0, 1, 1)
    return root
}