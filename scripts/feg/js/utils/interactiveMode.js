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


// %%include%%: "splashScreen.js"

var gProgressDiv = undefined;
var gProgressIndicator = undefined;
var gRunningDiv = undefined;
var gSpinnerElt = undefined;
var gTimeQueueStarted = undefined;
var gOpacitySet = false;
var gEventDiv = undefined;
var gEventDivStyleCursor = undefined;
var gRunIndicatorHidden1 = true;
var gRunIndicatorHidden2 = true;
var suppressRunningUntil = undefined;

function debugNoPendingTasksNotification() {
    if (mondriaOnLoadDate &&
        (! EvaluationDatasourceInfo.hasDataloadInProgress())) {

        var now = new Date();

        if (lastEventDescription !== undefined) {
            //console.log("Time for " + lastEventDescription + " = " + 
            //            (now.getTime() - mondriaOnLoadDate.getTime()) + 'ms');
            lastEventDescription = undefined;
            mondriaOnLoadDate = undefined;
            return;
        }

        mMessage('Time from onload to idle = ' + 
                 (now.getTime() - mondriaOnLoadDate.getTime()) + 'ms');
        if (typeof(nodeTimeKitModule) !== "undefined" && nodeTimeKitModule) {
            // Report CPU time if possible
            var cputime = nodeTimeKitModule.cputime();
            console.log("CPU time from onload = " +
                        Math.round((cputime - mondriaT0) / 1000.0) + " ms");
            mondriaT0 = cputime;
        }

        console.log("Executing '" + gArgParser.getAppName() + "'");

        testParamsDescStr = "parameters:";

        var argList = gArgParser.getArgList();
        for (var i = 0; i < argList.length; i++) {
            var arg = argList[i];
            if (arg === "") {
                continue;
            }
            var argVal = gArgParser.getArg(arg);
            testParamsDescStr += " " + arg + "=" + String(argVal);
        }
        console.log(testParamsDescStr);

        mondriaOnLoadDate = undefined;
        appStart = Date.now();

        if (runTests && !EvaluationDatasourceInfo.hasDataloadInProgress() &&
              !testSingleStep) {
            testDurationGuardTime = Date.now() + maxTestDuration;
            scheduleTestTask();
        }
    }
}

// Clears the running div and sets a new time-out for showing it
// This function can be called while the task queue is running, e.g. when a new
// event is going to be processed.
function clearProgressDiv() {
    // Hide running div
    if (gRunningDiv !== undefined && gRunningDiv !== null) {
        var change = false;
        if (gOpacitySet) {
            gRunningDiv.style.opacity = 0;
            gOpacitySet = false;
            change = true;
        }
        if (!gRunningDiv.hidden) {
            gRunningDiv.hidden = true;
            change = true;
        }
        gRunIndicatorHidden1 = true;
        gRunIndicatorHidden2 = true;
        if (gSpinnerElt !== undefined && gSpinnerElt !== null) {
            if (!gSpinnerElt.hidden) {
                gSpinnerElt.hidden = true;
                change = true;
            }
        } else {
            gRunningDiv.style.cursor = "default";
        }
        if (change) {
            gDomEvent.recordShowRunningDiv(0);
        }
    } else {
        if (gEventDivStyleCursor !== undefined) {
            gEventDiv.style.cursor = gEventDivStyleCursor;
            gEventDivStyleCursor = undefined;
        }
    }
    gTimeQueueStarted = Date.now();
}

// This function is called when the task queue is empty. It clears the time-out
// for showing the running div completely.
function taskQueueEmptyHook() {
    // Remove progress div if that hasn't been done already
    if (gProgressDiv === undefined) {
        gProgressDiv = document.getElementById("progress");
    }
    if (gProgressDiv !== null) {
        gProgressDiv.parentNode.removeChild(gProgressDiv);
        gProgressDiv = null;
    }
    clearProgressDiv();
    gTimeQueueStarted = undefined;
    suppressRunningUntil = undefined;
}

var lastProgressIndicator = 0;

function unsubcribeResourceHook() {
    globalConcludeInitPhaseTask.schedule(); // move concludeInitiPhaseTesk at the end of the queue
}

function unhideCdlRootDiv() {
    cdlRootDiv = document.getElementById("cdlRootDiv");
    if (cdlRootDiv !== null) {
        cdlRootDiv.hidden = false;
        cdlRootDiv.style.visibility = "visible";
        cdlRootDiv.style.animationName = "rootDivInitialAnimation";
        cdlRootDiv.style.animationDuration = "1s";
    }
}

function taskQueueInitProgressHook(p) {    
    if (gRunningDiv === undefined) {
        gRunningDiv = document.getElementById("cdlTaskRunningDiv");
        gSpinnerElt = document.getElementById("cdlTaskSpinnerElt");
        gRunIndicatorHidden1 = true;
        if (gRunningDiv !== null) {
            gDomEvent.addEventHandlers(gRunningDiv);
            if (!gRunningDiv.hidden) {
                gRunningDiv.hidden = true;
            }
        }
        gEventDiv = gDomEvent.eventDiv;
    }
    if (gProgressDiv === undefined) {
        // Gets removed by debugNoPendingTasksNotification()
        gProgressDiv = document.getElementById("progress");
        gProgressIndicator = document.getElementById("progressBar");
    }
    if (gProgressIndicator !== null) {
        if (p > lastProgressIndicator) {
            var sigm = 0.8 / (1 + Math.exp(-10 * ( p / 100 - 0.6))) + 0.1;
            gProgressIndicator.style.width = (sigm * 100) + "%";
            lastProgressIndicator = p;
        }
    }
}

function taskQueueRunningHook() {
    var gSplashDiv = document.getElementById("cdlSplashScreenBackground");
    if (gSplashDiv !== null) {
        // we are still in the initialization mode
        return
    }
    if (gProgressDiv !== undefined && gProgressDiv !== null) {
        return;
    }
    if (suppressRunningUntil !== undefined) {
        if (suppressRunningUntil > Date.now()) {
            return;
        }
        suppressRunningUntil = undefined;
    }
    if (gRunningDiv !== null) {
        if (gTimeQueueStarted === undefined) {
            gTimeQueueStarted = Date.now();
        } else if (gRunIndicatorHidden1) {
            if (Date.now() - gTimeQueueStarted >= 250) {
                if (gOpacitySet) {
                    gRunningDiv.style.opacity = 0;
                    gOpacitySet = false;
                }
                if (gRunningDiv.hidden) {
                    gRunningDiv.hidden = false;
                }
                gRunIndicatorHidden1 = false;
                gDomEvent.recordShowRunningDiv(1);
            }
        } else {
            if (!gOpacitySet) {
                gRunningDiv.style.opacity = 0.5;
                gOpacitySet = true;
            }
            if (gRunIndicatorHidden2 && Date.now() - gTimeQueueStarted >= 1000) {
                gRunIndicatorHidden2 = false;
                if (gSpinnerElt !== undefined && gSpinnerElt !== null) {
                    if (gSpinnerElt.hidden) {
                        gSpinnerElt.hidden = false;
                    }
                    gDomEvent.recordShowRunningDiv(2);
                } else {
                    gRunningDiv.style.cursor = "wait";
                }
            }
        }
    } else {
        if (gTimeQueueStarted === undefined) {
            gTimeQueueStarted = Date.now();
        } else if (gRunIndicatorHidden2 && Date.now() - gTimeQueueStarted >= 500) {
            gRunIndicatorHidden2 = false;
            if (gEventDivStyleCursor === undefined) {
                gEventDivStyleCursor = gEventDiv.style.cursor;
                gEventDiv.style.cursor = "wait";
            }
        }
    }
}

function showRunningDivNow() {
    if (gRunningDiv) {
        if (gRunIndicatorHidden1) {
            if (gOpacitySet) {
                gRunningDiv.style.opacity = 0;
                gOpacitySet = false;
            }
            if (gRunningDiv.hidden) {
                gRunningDiv.hidden = false;
            }
            gRunIndicatorHidden1 = false;
        }
        if (!gOpacitySet) {
            gRunningDiv.style.opacity = 0.5;
            gOpacitySet = true;
        }
        gRunIndicatorHidden2 = false;
        if (gSpinnerElt.hidden) {
            gSpinnerElt.hidden = false;
        }
        gDomEvent.recordShowRunningDiv(2);
    }
}

function userAlert(msg) {
    alert(msg);
}
