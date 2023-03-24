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

const CLS_EXPANDABLE = "expandable";
const CLS_CLOSED = "closed";
const CLS_TREENODE = "treenode";
const CLS_SELECTED = "selected";
const CLS_LAST_SELECTED = "last_selected";
const CLS_HOVER = "hover";
const CLS_FORCE_NO_BG = "force-no-bg";
const CLS_HIDE_MY_BG = "hide-my-bg";
const CLS_DISABLED = "disabled";
const CLS_WITH_ARROW = "with_arrow";
const CLS_MULTI_TOGGLE = "multi-toggle"
const CLS_COLORWELL = "colorwell";

const URL_LOADING = "_loading_";

const TYPE_ERROR = -1;
const TYPE_ZIP = 0;
const TYPE_OLD = 1;
const TYPE_JDWP = 2;
const TYPE_BUG_REPORT = 3;
const TYPE_BUG_REPORT_V2 = 4;  // Bug report with encoded view hierarchy
const TYPE_TIME_LAPSE_BUG_REPORT = 5;
const TYPE_TIME_LAPSE_BUG_REPORT_DEPRECATED = 6;

const CMD_CONVERT_TO_STRING = 1;
const CMD_PARSE_OLD_DATA = 2;
const CMD_USE_PROPERTY_MAP = 4;
const CMD_DEFLATE_STRING = 8;
const CMD_SKIP_8_BITS = 16;

const VIEW_VISIBLE = 0;
const VIEW_CAPTURE_REGEX = /^\s*mViewCapture:\s*/