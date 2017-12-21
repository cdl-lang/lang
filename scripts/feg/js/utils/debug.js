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

// Auxiliary variables and functions for debugging

var ConsoleLogAttributes = {
    __Explanation__: '<logging-level (-1 for none)>, <RegExp-Filter (if exists)>',
    constraints: [-1, '/area.[lr]/'],
    setLabel: [-1],
    classNameModifier: [-1],
    mouse: [0],
    eventsHandler: [-1],
    triggers: [-1],
    executePendingTasks: [-1],
    conditionMatcher: [-1]
};

var maxErrorReports = 200;
var maxAlertPopups = 3;
var debugPrintStackStrace = true;

// This file implements error management.

// This is a place-holder function for reporting errors. At present it
// simply dumps the arguments it receives to the console log function
// after converting all arguments into their string representation.

var errorsReported = 0;
function _mondriaErrorInternal()
{
    if (errorsReported >= maxErrorReports)
        return;
    errorsReported++;

    var newArgs = [];
    newArgs[0] = "unknown(): ";
    
    for(var i = 0, length = arguments.length ; i < length ; ++i) {
        // the depth of the conversion is bound at 10, to block infinite
        // loops (when two objects point at each other).
        newArgs.push(JSON.stringify(arguments[i]));
    }
    
    mMessage.apply(null, newArgs);

    if (console.trace && debugPrintStackStrace)
        console.trace();
}

var alertMessageCounter = 0;
// This function should be called to report authoring errors (mainly
// ill-formed configuration files).
// Currently this function simply dumps its argument to '_mondriaErrorInternal'.
function mondriaAuthorError()
{
    _mondriaErrorInternal.apply(this, arguments);

    if (alertMessageCounter >= maxAlertPopups)
        return;

    alertMessageCounter++;
    alert(Array.prototype.join.call(arguments, ""));
}

function mondriaAuthorHint()
{
    mMessage.apply(this, arguments);
}

// This function should be called to report internal errors (errors which
// should interest Mondria developers but not authors/users.
// Currently this function simply dumps its argument to '_mondriaErrorInternal'

var mondriaInternalErrorCounter = 0;
function mondriaInternalError()
{
    _mondriaErrorInternal.apply(this, arguments);
    if (mondriaInternalErrorCounter == 0) {
        debugger;
    }
    mondriaInternalErrorCounter++;
}

function mMessage()
{
    var msg;
    if (useConsoleLogApply) {
        console.log.apply(this, arguments);
    } else if (useConsoleLog) {

        // in google chrom console.log is native code, and (at least 
        // in linux chrome version 5.0.375.99 beta) cannot handle 'apply'
        // join()ing the arguments fails the sprintf like uses.
        var a1, a2, a3, a4, a5, a6, a7, a8, a9, a10;
        a1 = arguments[0];
        a2 = arguments[1];
        a3 = arguments[2];
        a4 = arguments[3];
        a5 = arguments[4];
        a6 = arguments[5];
        a7 = arguments[6];
        a8 = arguments[7];
        a9 = arguments[8];
        a10 = arguments[9];
        switch (arguments.length) {
        case 1:
            console.log(a1);
            break;
        case 2:
            console.log(a1, a2);
            break;
        case 3:
            console.log(a1, a2, a3);
            break;
        case 4:
            console.log(a1, a2, a3, a4);
            break;
        case 5:
            console.log(a1, a2, a3, a4, a5);
            break;
        case 6:
            console.log(a1, a2, a3, a4, a5, a6);
            break;
        case 7:
            console.log(a1, a2, a3, a4, a5, a6, a7);
            break;
        case 8:
            console.log(a1, a2, a3, a4, a5, a6, a7, a8);
            break;
        case 9:
            console.log(a1, a2, a3, a4, a5, a6, a7, a8, a9);
            break;
        case 10:
            console.log(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
            break;
        default:
            console.log(Array.prototype.join.call(arguments, ' '));
            break;
        }
    } else if (useOperaPostError) {
        // opera.postError does not do printf-formatting - TBC
        opera.postError.apply(this, arguments);
    }
}
