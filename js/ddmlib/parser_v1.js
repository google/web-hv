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


let countFrontWhitespace = function(line) {
    let m = line.match(/^\s+/);
    return m ? m[0].length : 0
};

let loadProperties = function(node, data) {
    let start = 0;
    let stop;

    do {
        let index = data.indexOf('=', start);
        let property = new VN_Property(data.substring(start, index));

        let index2 = data.indexOf(',', index + 1);
        let length = parseInt(data.substring(index + 1, index2));
        start = index2 + 1 + length;
        property.value = data.substring(index2 + 1, index2 + 1 + length);

        node.properties.push(property);
        node.namedProperties[property.name] = property;

        stop = start >= data.length;
        if (!stop) {
            start += 1;
        }
    } while (!stop);

    node.sortProperties();
    node.loadCommonProperties(commonProps);
}

/**
 * Parses the view node data and returns the root node
 */
let parseNode = function(data) {
    let stack = [];
    let root = null;
    let lastNode = null;
    let lastWhitespaceCount = -INT_MIN_VALUE;
    data = data.split("\n");
    for (let l = 0; l < data.length - 1; l++) {
        let line = data[l];
        if (line.toUpperCase() == "DONE.") {
            break;
        }

        let whitespaceCount = countFrontWhitespace(line);
        if (lastWhitespaceCount < whitespaceCount) {
            stack.push(lastNode);
        } else if (stack.length) {
            let count = lastWhitespaceCount - whitespaceCount;
            for (let i = 0; i < count; i++) {
                stack.pop();
            }
        }

        lastWhitespaceCount = whitespaceCount;
        line = line.trim();
        let index = line.indexOf(' ');
        lastNode = new ViewNode(line.substring(0, index));

        line = line.substring(index + 1);
        loadProperties(lastNode, line);

        if (!root) {
            root = lastNode;
        }

        if (stack.length) {
            let parent = stack[stack.length - 1];
            parent.children.push(lastNode);
        }
    }

    root.updateNodeDrawn();
    return root;
}