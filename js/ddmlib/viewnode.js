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


var INT_MIN_VALUE = -2147483648;

function VN_Property(fullname) {
    this.name = fullname;
    this.value = "";
    this.type = "Uncategorized";
    this.fullname = fullname;

    var colonIndex = fullname.indexOf(':');
    if (colonIndex > 0) {
        var type = fullname.substring(0, colonIndex);
        this.type = type.charAt(0).toUpperCase() + type.slice(1);
        this.name = fullname.substring(colonIndex + 1);
    }
}

function ViewNode(name) {
    this.name = name;

    // List of VN_Property
    this.properties = [];

    // Map of name: VN_Property
    this.namedProperties = {};

    // List of ViewNode
    this.children = [];
}

ViewNode.prototype.getBoolean = function(name, dValue) {
    var p = this.getProp(name);
    if (p) {
        return p.value == 'true';
    }
    return dValue;
}


ViewNode.prototype.getInt  = function(name, dValue) {
    var p = this.getProp(name);
    if (p) {
        try {
            return parseInt(p.value);
        } catch(e) {}
    }
    return dValue;
}

ViewNode.prototype.getFloat  = function(name, dValue) {
    var p = this.getProp(name);
    if (p) {
        try {
            return parseFloat(p.value);
        } catch(e) {}
    }
    return dValue;
}

ViewNode.prototype.updateNodeDrawn = function() {
    this.nodeDrawn = !this.willNotDraw;
    for (var i = 0; i < this.children.length; i++) {
        this.children[i].updateNodeDrawn();
        this.nodeDrawn |= (this.children[i].nodeDrawn && this.children[i].isVisible);
    }
}

ViewNode.prototype.sortProperties = function() {
    this.properties.sort(function (a, b) {
        if (a.type > b.type) {
            return 1;
        } else if (a.type < b.type) {
            return -1
        } else if (a.name > b.name) {
            return 1;
        } else if (a.name < b.name) {
            return -1;
        } else {
            return 0;
        }
    });
}

ViewNode.prototype.loadCommonProperties = function(map) {
    this.getProp = function(name) {
        return map ? this.namedProperties[map[name]] : this.namedProperties[name];
    }

    this.id = this.getProp("id").value;
    this.left = this.getInt("left", 0);
    this.top = this.getInt("top", 0);
    this.width = this.getInt("width", 0);
    this.height = this.getInt("height", 0);
    this.scrollX = this.getInt("scrollX", 0);
    this.scrollY = this.getInt("scrollY", 0);
    this.willNotDraw = this.getBoolean("willNotDraw", false);

    this.clipChildren = this.getBoolean("clipChildren", true);
    this.translateX = this.getFloat("translationX", 0);
    this.translateY = this.getFloat("translationY", 0);
    this.scaleX = this.getFloat("scaleX", 1);
    this.scaleY = this.getFloat("scaleY", 1);

    var descProp = this.getProp("contentDescription");
    this.contentDesc = descProp != null && descProp.value && descProp.value != "null"
        ? descProp.value : null;

    if (this.contentDesc == null) {
        descProp = this.getProp("text");
        this.contentDesc = descProp != null && descProp.value && descProp.value != "null"
            ? descProp.value : null;
    }

    var visibility = this.getProp("visibility");
    this.isVisible = !visibility || visibility.value == 0 || visibility.value == "VISIBLE";

    delete this.getProp;
}
