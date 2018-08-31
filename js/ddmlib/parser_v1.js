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


var countFrontWhitespace = function(line) {
    var m = line.match(/^\s+/);
    return m ? m[0].length : 0
};

var loadProperties = function(node, data) {
    var start = 0;
    var stop;

    do {
        var index = data.indexOf('=', start);
        var property = new VN_Property(data.substring(start, index));

        var index2 = data.indexOf(',', index + 1);
        var length = parseInt(data.substring(index + 1, index2));
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
var parseNode = function(data) {
    var stack = [];
    var root = null;
    var lastNode = null;
    var lastWhitespaceCount = -INT_MIN_VALUE;
    data = data.split("\n");
    for (var l = 0; l < data.length - 1; l++) {
        var line = data[l];
        if (line.toUpperCase() == "DONE.") {
            break;
        }

        var whitespaceCount = countFrontWhitespace(line);
        if (lastWhitespaceCount < whitespaceCount) {
            stack.push(lastNode);
        } else if (stack.length) {
            var count = lastWhitespaceCount - whitespaceCount;
            for (var i = 0; i < count; i++) {
                stack.pop();
            }
        }

        lastWhitespaceCount = whitespaceCount;
        line = line.trim();
        var index = line.indexOf(' ');
        lastNode = new ViewNode(line.substring(0, index));

        line = line.substring(index + 1);
        loadProperties(lastNode, line);

        if (!root) {
            root = lastNode;
        }

        if (stack.length) {
            var parent = stack[stack.length - 1];
            parent.children.push(lastNode);
        }
    }

    root.updateNodeDrawn();
    return root;
}