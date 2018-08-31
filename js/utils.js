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

function deferred() {
	var a, r;
	var p = new Promise(function(accept, reject) {
		a = accept;
		r = reject;
    });
    p.accept = a;
    p.reject = r;
    return p;
}


var ActiveState = [];

function createWorker(url) {
    var worker = new Worker(url);
    ActiveState.push(function() {
        worker.terminate();
    });
    return worker;
}

function createUrl(data) {
    var url = URL.createObjectURL(data);
    ActiveState.push(function() {
        URL.revokeObjectURL(url);
    });
    return url;
}

function doXhr(url, responseType) {
    var result = deferred();
    var xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
        if (this.readyState == 4) {
            if (this.status == 200) {
                result.accept(this.response);
            } else {
                result.reject();
            }
        }
    }
    xhr.open('GET', url);
    xhr.responseType = responseType;
    xhr.send()
    return result;
}

async function saveFile(fileName, url) {
    var a = $("<a>").attr({href:url, download:fileName}).appendTo(document.body);
    a.get(0).click();
    setTimeout(function() {
        a.remove();
    }, 0);
}

/**
 * Adds a node displaying the error message in the continer
 */
$.fn.showError = function(msg) {
  $("#main-progress").hide();
  return this.empty().removeClass("hide").removeClass("hidden").append($("<span>").text(msg).addClass("error"));
}

function showContext(menu, callback, e) {
  if (e.preventDefault) {
      e.preventDefault();
  }
  var menuClickHandler = function() {
      if (!$(this).hasClass(CLS_DISABLED)) {
          callback.call($(this).data("info"));
          hideMenu();
      }
  };

  var wrapper = $("<div class='context-wrapper'>").appendTo(document.body);
  var el = $("<div class='contextmenu'>").appendTo(wrapper);
  var addSeparator = false;
  for (var i = 0; i < menu.length; i++) {
      var m = menu[i];
      if (!m) {
          addSeparator = true;
          continue;
      }
      var item = $("<a class=icon_btn>").text(m.text).addClass(m.icon).appendTo(el).data("info", m).click(menuClickHandler);
      if (addSeparator) {
          item.addClass("separator");
      }
      if (m.disabled) {
          item.addClass(CLS_DISABLED);
      }
      addSeparator = false;
  }

  el.show().css({
      left: Math.min(e.pageX, $(document).width() - el.width() - 10),
      top: Math.min(e.pageY, $(document).height() - el.height() - 10)});

  var documentMouseDown = function(e) {
      if (!el.has(e.toElement).length) {
          hideMenu();
      }
  };
  $(document).mousedown(documentMouseDown);
  var hideMenu = function() {
      wrapper.remove();
      $(document).unbind("mousedown", documentMouseDown);
  }
}

function toast(msg) {
    var el = $("<div class=toast>").text(msg).appendTo($("#content")).animate({top: 10, opacity:1}).delay(5000).fadeOut(300, function() { $(this).remove(); });
}

function attachOptions(menu, callback) {
    var optionsBtn = $("#btn-options").unbind("click");
    if (!menu) {
        optionsBtn.hide();
        return;
    }

    optionsBtn.show().click(function() {
        var offset = $(this).offset();
        showContext(menu, callback, {pageX: offset.left, pageY: offset.top});
    });
}

/**
 * scrolls the parent such that the child is in view
 */
function scrollToView(child, parent) {
    // scroll To View
    var pTop = parent.stop().offset().top;
    var elTop = child.stop().offset().top;
    var delta = 0;
    if (elTop < pTop) {
        delta = elTop - pTop - 20;
    } else if ((elTop + child.height()) > pTop + parent.height()) {
        delta = elTop + child.height() - pTop - parent.height() + 20;
    }
    if (delta != 0) {
        parent.animate({scrollTop: parent.scrollTop() + delta}, 300);
    }
}
