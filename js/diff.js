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

class Diff {
    constructor() {
        this.withNewChildren = new Map()
        this.withRemovedChildren = new Map()
        this.withMovedBoxPos = []
        this.withReorderedChildren = []
    }

    markNewChild(parent, child) {
        let value = this.withNewChildren.get(parent)
        if (value == null) {
            value = []
            this.withNewChildren.set(parent, value)
        }
        value.push(child)
    }

    markRemovedChild(parent, child) {
        let value = this.withRemovedChildren.get(parent)
        if (value == null) {
            value = []
            this.withRemovedChildren.set(parent, value)
        }
        value.push(child)
    }
}

function compareNodes(newRootNode, oldRootNode) {
    const diff = new Diff()

    function inner(newNode, oldNode) {
        newNode.el = oldNode.el
        oldNode.el = null
        newNode.box = oldNode.box
        oldNode.box = null
        newNode.el.node = newNode
        newNode.box.node = newNode

        const finalOrderedChildren = []
        const newChildrenMap = new Map(newNode.children.map((it) => [it.treeDisplayName, it] ))

        for (let i = 0; i < oldNode.children.length; i++) {
            const child = oldNode.children[i]
            const match = newChildrenMap.get(child.treeDisplayName)

            if (match == null) {
                diff.markRemovedChild(newNode, child)
            } else {
                inner(match, child)
                newChildrenMap.delete(child.treeDisplayName)
                finalOrderedChildren.push(child)
            }
        }
        for (let child of newChildrenMap.values()) {
            diff.markNewChild(newNode, child)
            finalOrderedChildren.push(child)
        }
        for (let i = 0; i < finalOrderedChildren.length; i++) {
            if (finalOrderedChildren[i].treeDisplayName != newNode.children[i].treeDisplayName) {
                diff.withReorderedChildren.push(newNode)
                break;
            }
        }
        if (hasDifferentBoxPosition(newNode, oldNode)) {
            diff.withMovedBoxPos.push(newNode)
        }
    }

    inner(newRootNode, oldRootNode)
    return diff
}

function hasDifferentBoxPosition(viewNode, other) {
    return viewNode.boxStylePos.top != other.boxStylePos.top
        || viewNode.boxStylePos.left != other.boxStylePos.left
        || viewNode.boxStylePos.width != other.boxStylePos.width
        || viewNode.boxStylePos.height != other.boxStylePos.height
}

function findDescendantById(viewNode, targetId) {
    if (viewNode.treeDisplayName == targetId) {
        return viewNode
    }
    for (let i = 0; i < viewNode.children.length; i++) {
        const maybeFound = findDescendantById(viewNode.children[i], targetId)
        if (maybeFound != null) {
            return maybeFound
        }
    }
    return null
}

/* returns a list of different properties and the different values */
function compareProperties(viewNode, other) {
    const PROPERTY_LIST = [
        "classnameIndex",
        "id",
        "left",
        "top",
        "width",
        "height",
        "scrollX",
        "scrollY",
        "translationX",
        "translationY",
        "scaleX",
        "scaleY",
        "alpha",
        "willNotDraw",
        "clipChildren",
        "visibility",
        "elevation"
    ]

    const props = []
    for (let pName of PROPERTY_LIST) {
        if (viewNode[pName] != other[pName]) {
            props.push({ name: pName, value: viewNode[pName], previousValue: other[pName] })
        }
    }
    return props
}