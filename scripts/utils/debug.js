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

var doDebugging = false;
var debugCounter = 0;
var maxDebugCount = 4000; // set this to 0 to disable this bound
var gProfiling;

function mhelp() {
    var winRef = window.open(
            "https://docs0.google.com/a/agora-mobile.com/document/edit?id=1ZfgB-F0OeRwuNc-tDz3E8F1SF5gAdSzt1CWmuPlz0lg#",
            "Mondria Help");
    winRef.focus();
}

function initializeDebugging()
{
    initDebugObjMgr();
    initializeDebugTiming();
    initializeDebugTracingLog();
    if (gProfiling) {
        initProfiling();
    }
}

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

var compiledConsoleLogAttributesFilters = {};
var prevConsoleLogAttributeFilter = {};

function mLogger(type, level, logStr) {
    if (!isArray(ConsoleLogAttributes[type])) {
        mMessage('Cannot log type:' + type + ' - ' + objToString(ConsoleLogAttributes[type]));
        return;
    }
    var levelLimit = ConsoleLogAttributes[type][0];
    if (level > levelLimit) {
        return;
    }

    // Specific logic
    switch (type) {
        case 'constraints':
            if (levelLimit < 2 && logStr.indexOf('MondriaPointer_To_ScreenArea') >= 0) {
                return; // Do not log the pointer constraints in low log levels
            }
            break;
        default:
            break;
    }

    // See if the logFilter was changed, and compile it as needed
    var logFilter = ConsoleLogAttributes[type][1];
    if (logFilter != prevConsoleLogAttributeFilter[type]) {
        prevConsoleLogAttributeFilter[type] = logFilter;
        // Compile it
        if (typeof(logFilter) == 'string') {
            var len = logFilter.length;
            if (logFilter[0] == '/' && len >= 2 && logFilter[len - 1] == '/') {
                compiledConsoleLogAttributesFilters[type] = new RegExp();
                compiledConsoleLogAttributesFilters[type].compile(logFilter.substr(1, len - 2));
            }
        }
        else {
            delete(compiledConsoleLogAttributesFilters[type]);
        }
    }
    // Check whether the logStr passes the filter
    var compiledPattern = compiledConsoleLogAttributesFilters[type];
//    if (!compiledPattern || logStr.search(compiledPattern) >= 0) {
    if (!compiledPattern || compiledPattern.test(logStr)) {
        mMessage(logStr);
    }
}

////////////////////
// Debug Messages //
////////////////////

// This function is the same as console.log and should be called in exactly
// the same way. The only difference is that this function is conditional:
// 1. It only produces output if 'doDebugging' is set.
// 2. It counts how many times it produced output and stops producing
//    output once this counter reaches 'maxDebugCount' (this is in order
//    to avoid console overflow).

function mDebug()
{
    if(!doDebugging)
        return;

    if(maxDebugCount > 0 && debugCounter >= maxDebugCount)
        return;

    debugCounter++;
    
    mMessage.apply(null, arguments);

    if(debugCounter == maxDebugCount)
        mMessage("Stopping debug messages: limit reached");
}

// Taken from http://aymanh.com/9-javascript-tips-you-may-not-know
function AssertException(message) { this.message = message; }

AssertException.prototype.toString = function () {
    return 'AssertException: ' + this.message;
};
 
function assert(exp, message) {
    if (!exp) {
        mMessage(message);
        console.trace(message);
        debugger;
        throw new AssertException(message);
    }
}

function assertTrue(exp, message)
{
    assert(!!exp, message);
}

function assertFalse(exp, message)
{
    assert(!exp, message);
}

function debugCountPosVariables()
{
    var counter = 0;

    for(var variable in globalPos.posCalc.variables)
        counter++;

    return counter;
}

function debugCountPosEqVariables()
{
    return globalPos.posCalc.equations.equations.baseSet.componentIndex.size;
}

function debugCountPosPairIds()
{
    var counter = 0;
    var unmatchedAreas = {};
    var relativeVisibilityCount = 0;
    var watchedPairCount = 0;
    var normalPairCount = 0;
    var forestPairCount = 0;
    var failedToMatchCount = 0;
    var regexp = new RegExp("(" + areaBaseId + "\\d+)","g");
    var rvregexp = new RegExp(areaBaseId + "\\d+rv" + areaBaseId + "\\d+");

    
    var list = globalPos.posCalc.pairEquations.edgeById;
    
    for(var pairId in list) {
        counter++;

        if(rvregexp.test(pairId))
            relativeVisibilityCount++;
        
        // extract the area IDs used in the pairs.
        var areasInPair = 0;
        
        while(1) {
    
            var matches = regexp.exec(pairId);

            if(!regexp.lastIndex)
                break;

            areasInPair++;
            
            if(!debugAllAreas[matches[1]])
                unmatchedAreas[matches[1]] = true;
        }

        if(areasInPair < 2)
            failedToMatchCount++;
        

        if(list[pairId].inForest)
            forestPairCount++;
        if(list[pairId].isNormal)
            normalPairCount++;
        if(list[pairId].isWatched)
            watchedPairCount++;
    }

    var unmatchedAreaCount = 0;

    for(var unmatched in unmatchedAreas)
        unmatchedAreaCount++;

    var result = {
      pairNumber: counter,
      unknownAreasInPairs: unmatchedAreaCount,
      failedToMatch: failedToMatchCount,
      relativeVisibility: relativeVisibilityCount,
      inForest: forestPairCount,
      isNormal: normalPairCount,
      isWatched: watchedPairCount
    };
    
    return result;
}

// This equation returns an object containing the number of equations, 
// the average number of variables in the base set equations and in the
// combination set equations.

function debugPosEqCount()
{
    var result = {};
    
    var baseEq = globalPos.posCalc.equations.equations.baseSet.vectors;
    
    var eqVarsTotal = 0;
    result.equationCount = 0;
    
    for(var eqId in baseEq) {
        result.equationCount++;
        
        for(var v in baseEq[eqId])
            eqVarsTotal++;
    }
    
    if(result.equationCount)
        result.baseSetAverageVarsPerEq = eqVarsTotal / result.equationCount;
    else
        result.baseSetAverageVarsPerEq = 0;
    
    var combEq = globalPos.posCalc.equations.equations.combinationSet.vectors;
    
    eqVarsTotal = 0;
    
    for(var eqId in combEq) {
        
        for(var v in combEq[eqId])
            eqVarsTotal++;
    }
    
    if(result.equationCount)
        result.combSetAverageVarsPerEq = eqVarsTotal / result.equationCount;
    else
        result.combSetAverageVarsPerEq = 0;
    
    return result;
}


/******************************************************************************/
/**********************            The End             ************************/
/******************************************************************************/

