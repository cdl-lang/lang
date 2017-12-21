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

var gRunningDiv = undefined;
var suppressRunningDivOnce;

function debugNoPendingTasksNotification() {
    if (!mondriaOnLoadDate) {
        return;
    }

    var now = new Date();

    mMessage('Time from onload to idle = ' + 
             (now.getTime() - mondriaOnLoadDate.getTime()) + 'ms');
    if (typeof(nodeTimeKitModule) !== "undefined" && nodeTimeKitModule) {
        // Report CPU time if possible
        var cputime = nodeTimeKitModule.cputime();
        console.log("CPU time from onload = " +
                    Math.round((cputime - mondriaT0) / 1000.0) + " ms");
        mondriaT0 = cputime;
    }

    if (typeof(process) !== "undefined") {
        testParamsDescStr = "parameters:";
        for (var arg in actualArgumentValues) {
            testParamsDescStr += " " + arg + "=" + actualArgumentValues[arg];
        }
        console.log(testParamsDescStr);
    }

    mondriaOnLoadDate = undefined;

    testDurationGuardTime = Date.now() + maxTestDuration;
    scheduleTestTask();
}

function taskQueueEmptyHook() {
}

function taskQueueInitProgressHook(p) {
}

function taskQueueRunningHook() {
}

function confirm(msg) {
    console.log(msg);
    return false;
}

function clearProgressDiv() {
}

function userAlert(msg) {
    console.log(msg);
}

function unsubcribeResourceHook() {    
}

function hideSplashScreen() {
}

/*
function setSplashScreenText(text) {
}
*/

function unhideMondriaRootDiv() {
}

function showRunningDivNow() {
}
