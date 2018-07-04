// Copyright 2018 Yoav Seginer, Theo Vosse
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

function SplashScreenController()
{
    this.showing = true; // cleared once splash screen is hidden
    this.showText = true;
    this.firstSplash = Date.now();
}

SplashScreenController.prototype.hide = splashScreenControllerHide;
function splashScreenControllerHide() {
    if(!this.showing)
        return; // nothing showing, so nothing to hide
    
    var currentTime = Date.now();
    console.log("splash screen hidden after",
                currentTime - this.firstSplash, "ms");

    this.showing = false;
}

/**
 * Place a static text on the splash screen, which can be used to give feedback
 * to the user (e.g., in case of error). When text is undefined, the text 
 * is removed.
 * This assumes that the splash screen contains a DIV with ID 
 * "cdlSystemMessage" which can display the text. If such a DIV 
 * does not exist, nothing is displayed. When the text is set on the DIV,
 * the class "cdlShowSystemMessage" is also set on the DIV. This allows 
 * the CSS of the splash screen to style the message when it is set.
 * 
 * @param {any} text 
 * @memberof {SplashScreenController}
 */
SplashScreenController.prototype.feedback = splashScreenControllerFeedback;
function splashScreenControllerFeedback(text) {
    // get the document object of the splash screen
    var splashIFrame = document.getElementById("cdlSplashScreenFrame");
    if(!splashIFrame || !splashIFrame.contentDocument)
        return;
    
    var splashText =
        splashIFrame.contentDocument.getElementById("cdlSystemMessage")

    if (splashText) {
        if(text) {
            splashText.innerText = text;
            splashText.classList.add("cdlShowSystemMessage");
        } else {
            splashText.innerText = "";
            splashText.classList.remove("cdlShowSystemMessage");
        }
        this.showText = text === undefined;
    }
}

function hideSplashScreen() {
    var gSplashDiv = document.getElementById("cdlSplashScreenBackground");

    if (gSplashDiv !== null) {
        gSplashDiv.remove();
        unhideCdlRootDiv();
        gSplashScreenController.hide();
        globalSetFocusTask.schedule();
    }
}

var gSplashScreenController = new SplashScreenController();

globalSystemEvents.addHandler("connection error", function() {
    gSplashScreenController.feedback("Connection error (reconnecting)");
});

globalSystemEvents.addHandler("connection error cleared", function() {
    gSplashScreenController.feedback(undefined);
});
