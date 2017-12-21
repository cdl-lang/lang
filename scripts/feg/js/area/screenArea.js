// Copyright 2017 Yoav Seginer, Theo Vosse, Gil Harari, and Uri Kolodny.
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
// 
//     http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

"use strict";

var globalScreenWidthConstraint;
var globalScreenHeightConstraint;

function createScreenArea()
{
    var areaId = "1:1";
    var mockScreenAreaObject = { areaId: areaId };

    globalScreenWidthConstraint =
          new PosConstraint(mockScreenAreaObject, undefined, "screenWidth");
    globalScreenHeightConstraint =
          new PosConstraint(mockScreenAreaObject, undefined, "screenHeight");
    if (!runTests) {
        handleScreenAreaResize();
    } else {
        document.body.style.setProperty("overflow", "scroll");
    }
}


function updateScreenAreaPosition() {
    var pos = determineScreenAreaSize();

    globalScreenWidthConstraint.newDescription({
        point1: { type: "left" },
        point2: { type: "right" },
        equals: pos.width,
        priority: 10000
    }, 10000);
    globalScreenHeightConstraint.newDescription({
        point1: { type: "top" },
        point2: { type: "bottom" },
        equals: pos.height,
        priority: 10000
    }, 10000);
    gDomEvent.resizeScreenArea(pos.width, pos.height);
}

function handleScreenAreaResize() {
    function screenAreaResizeCaller() {
       globalScreenResizeTask.schedule();
    }

    if (window.addEventListener) {
        window.addEventListener("resize", screenAreaResizeCaller, false);
    } else if (window.attachEvent) {
        window.attachEvent("onresize", screenAreaResizeCaller);
    }
}

//
// return an object with two attributes - 'width' and 'height' - which
// are the current width and height of the browser's 'body'
//
function determineScreenAreaSize()
{
    if (runTests) {
        return {
            width: 1517,
            height: 714
        };
    } if (window.innerWidth !== undefined) {
        return {
            width: window.innerWidth,
            height: window.innerHeight
        };
    } else if ((document.documentElement !== undefined) &&
               (document.documentElement.clientWidth !== undefined) &&
               (document.documentElement.clientWidth !== 0)) {
        return {
            width: document.documentElement.clientWidth,
            height: document.documentElement.clientHeight
        };
    } else {
        return {
            width: document.getElementsByTagName('body')[0].clientWidth,
            height: document.getElementsByTagName('body')[0].clientHeight
        };
    }
}
