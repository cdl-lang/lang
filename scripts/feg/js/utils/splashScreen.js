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


var splashScreenRefreshRateCheck = 750;
var splashScreenRefreshRateAnimation = 750;

function SplashScreenController()
{
    this.showing = true; // cleared once splash screen is hidden
    this.timeoutId = undefined;
    this.showText = true;
    this.currentAnimationIndex = 0;
    this.initializationTime = Date.now();
    this.lastSplashUpdate = Date.now();
    this.firstSplash = this.lastSplashUpdate;
    this.timeoutId = setTimeout(refreshSplashScreen, splashScreenRefreshRateCheck);
}

SplashScreenController.prototype.refresh = splashScreenControllerRefresh;
function splashScreenControllerRefresh() {
    this.timeoutId = setTimeout(refreshSplashScreen, splashScreenRefreshRateCheck);

    var currentTime = Date.now();    
    var removeText = this.showText && currentTime - this.initializationTime > 3000;

    if (removeText) {
        this.showText = false;
        var gSplashTxt = document.getElementById("mondriaSplashScreenText");
        if (gSplashTxt !== null) {
            gSplashTxt.hidden = true;
        }
    }

    var ellapsedSinceLastUpdate = currentTime - this.lastSplashUpdate;
    nextAnimationFrame = !this.showText &&
                    ellapsedSinceLastUpdate >= splashScreenRefreshRateAnimation;

    if (nextAnimationFrame) {    
        this.lastSplashUpdate = currentTime;
        var gSplashImg = document.getElementById("mondriaSplashScreenDots");
        if (gSplashImg !== null) {
            src = gSplashImg.src;
            dir_name = src.substring(0, src.lastIndexOf('/') + 1);        
            frameIndexStr = this.currentAnimationIndex.toString();
            gSplashImg.src = dir_name + 'three_dots_' + frameIndexStr + '.svg';
        }
        this.currentAnimationIndex += 1;
        if (this.currentAnimationIndex == 4) {
            this.currentAnimationIndex = 1;
        }
    }    
    
}

SplashScreenController.prototype.hide = splashScreenControllerHide;
function splashScreenControllerHide() {
    if(this.timeoutId !== undefined) {
        clearTimeout(this.timeoutId);
        this.timeoutId = undefined;
    }

    if(!this.showing)
        return; // nothing showing, so nothing to hide
    
    var currentTime = Date.now();
    console.log("splash screen hidden after",
                currentTime - this.firstSplash, "ms");

    this.showing = false;
}

/**
 * Replaces the animation with a static text, which can be used to give feedback
 * to the user. When txt is "", the text is removed and animation resumes.
 * 
 * @param {any} txt 
 * @memberof {SplashScreenController}
 */
SplashScreenController.prototype.feedback = splashScreenControllerFeedback;
function splashScreenControllerFeedback(txt) {
    var gSplashTxt = document.getElementById("mondriaSplashScreenText");
    var gSplashImg = document.getElementById("mondriaSplashScreenDots");

    if (gSplashTxt !== null) {
        gSplashTxt.innerText = txt;
        gSplashTxt.hidden = txt === undefined;
        this.showText = txt === undefined;
    }
    if (gSplashImg !== null) {
        gSplashImg.hidden = txt !== undefined;
    }
}

function refreshSplashScreen() {
    gSplashScreenController.refresh();
}

function hideSplashScreen() {
    var gSplashDiv = document.getElementById("mondriaSplashScreenBackground");

    if (gSplashDiv !== null) {
        gSplashDiv.remove();
        unhideMondriaRootDiv();
        gSplashScreenController.hide();
        gDomEvent.updateFocus();
    }
}

var gSplashScreenController = new SplashScreenController();

globalSystemEvents.addHandler("connection error", function() {
    gSplashScreenController.feedback("Connection error");
});

globalSystemEvents.addHandler("connection error cleared", function() {
    gSplashScreenController.feedback(undefined);
});
