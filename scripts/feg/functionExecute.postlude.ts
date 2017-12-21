// Copyright 2017 Theo Vosse.
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

/// <reference path="globals.ts" />
/// <reference path="externalTypes.ts" />
/// <reference path="functionExecute.ts" />
/// <reference path="appState.ts" />
/// <reference path="eventHandlers.ts" />
/// <reference path="debug.ts" />

// %%include%%: <scripts/remoting/remoteMgr.js>

function main(): void {

    if (fmtVersion !== gRunFmtVersion) {
        userAlert("wrong format version");
        return;
    }

    createGlobalObjects();

    // request app-state to be restored from the server (if applicable)
    gAppStateMgr.load();

    initialize();

    // window.addEventListener("beforeunload", function(e) {
    //     var msg = "Do you want to leave this page?";
    //     e.returnValue = msg;
    //     return msg;
    // });
}

function initialize(): void {

    // switch 'gInitPhase' to false when initial construction is completed
    globalConcludeInitPhaseTask.schedule();

    createAreas();

    startEventProcessing();

    if (!evaluationQueue.runQueue(0, undefined)) {
        globalContentTask.schedule();
    }

    // schedule re-calculation of display queries, to allow for delayed font
    // loading (web-fonts), that are initially rendered with a local font
    scheduleDisplayQueryRecalculation();
}

// TODO: fixed id of screen area
function createGlobalObjects(): void {
    initDebugObjMgr();

    gArgParser = getArgParser();
    initDefaultArgs();

    initTaskQueue();

    initPositioning();
    initAbsolutePosManager();
    initPosConstraintSynchronizer();

    initZIndex();

    // Pointer object is area 1:1
    gPointer = new MondriaPointer(
        labelBySuffix("1:1", leftSuffix(undefined, false, false)),
        labelBySuffix("1:1", topSuffix(undefined, false, false)));

    buildEvaluationNode(FunctionNode.globalFunctionNodes[globalMessageNodeIndex],
                        globalEvaluationEnv);
    evaluationQueue.setGlobalMessageQueue(
        globalEvaluationNodes[globalMessageNodeIndex]);

    createScreenArea();

    createRemoteMgr();
}

/// Initializes global variables from the URL/command line arguments
function initDefaultArgs(): void {
    logValues = gArgParser.getArg("logValues", false);
    if (logValues) {
        logPrototypes = undefined;
    }
    debugWrites = gArgParser.getArg("debugWrites", debugWrites);
    debugWritesEval = gArgParser.getArg("debugWritesEval", debugWritesEval);
    debugWritesString = gArgParser.getArg("debugWritesString", debugWritesString);
    debugEvents = gArgParser.getArg("debugEvents", debugEvents);
    gProfile = gArgParser.getArg("profile", gProfile);
    debugTest = gArgParser.getArg("debugTest", debugTest);
    logEventTimes = gArgParser.getArg("logEventTimes", false);
    useResultIndexers = gArgParser.getArg("useResultIndexers", useResultIndexers);
    dsDestroyTimeOut = gArgParser.getArg("destroyTimeOut", dsDestroyTimeOut);
    allowSetData = gArgParser.getArg("allowSetData", allowSetData);
    linearMultiQuery = gArgParser.getArg("linearMultiQuery", linearMultiQuery);
    runTests = gArgParser.getArg("test", runTests);
    testSingleStep = gArgParser.getArg("testSingleStep", testSingleStep);
    debugTasks = gArgParser.getArg("debugTasks", debugTasks);
    dataTableMaxNrRows = gArgParser.getArg("dataTableMaxNrRows", undefined);
    dataTableMaxNrColumns = gArgParser.getArg("dataTableMaxNrColumns", undefined);
    dataTableFacetRestriction = gArgParser.getArg("dataTableFacetRestriction", undefined);
    gDontSetPosition = gArgParser.getArg("gDontSetPosition", gDontSetPosition);
    if (!useResultIndexers) {
        console.warn("no result indexers");
    }
    if (testSingleStep && !gArgParser.getArg("maxTestDuration", undefined)) {
        // Set a very long time out. 32 years should be enough.
        maxTestDuration = 1e12;
    } else {
        maxTestDuration = gArgParser.getArg("maxTestDuration", maxTestDuration / 1000) * 1000;
    }
    if (runTests) {
        logEventHistory = false;
        g_noTryAndCatchUpdate = true;
    }
    g_noTryAndCatchUpdate = gArgParser.getArg("noTryAndCatch", g_noTryAndCatchUpdate);
    noTimeOut = gArgParser.getArg("noTimeOut", false);
    debugAreaConstruction = gArgParser.getArg("debugAreaConstruction", false);
    debugDelayLoad = gArgParser.getArg("debugDelayLoad", debugDelayLoad);
    gMaxMessageSize = gArgParser.getArg("gMaxMessageSize", gMaxMessageSize);
    baseDelay = gArgParser.getArg("baseDelay", baseDelay);
    sizeDependentDelay = gArgParser.getArg("sizeDependentDelay", sizeDependentDelay);

    var maxEPS = Number(gArgParser.getArg("maxEPS", maxEvaluationsPerSlice));
    if (maxEPS > 0) {
        maxEvaluationsPerSlice = maxEPS;
    }

    if (gArgParser.getArg("noProgressBar", false)) {
        gProgressValue = undefined;
        gProgressDiv = document.getElementById("progress");
        if (gProgressDiv !== undefined && gProgressDiv !== null) {
            gProgressDiv.parentNode.removeChild(gProgressDiv);
            gProgressDiv = null;
        }        
    }


    if (gProfile) {
        requirePerformanceNow();
    }
    var debugBreaks: string[][] = gArgParser.getArg("debugBreak", "").split(",").map(function(s: string): string[] {
        return s.split(":");
    });
    for (var i: number = 0; i < debugBreaks.length; i++) {
        if (debugBreaks[i].length === 3 && debugBreaks[i][0] === "_") {
            setDebugBreak(_, debugBreaks[i][1], debugBreaks[i][2]);
        } else if (debugBreaks[i].length === 4) {
            setDebugBreak(debugBreaks[i][0] + ":" + debugBreaks[i][1],
                          debugBreaks[i][2], debugBreaks[i][3]);
        }
    }
    var contextTraces: string[][] = gArgParser.getArg("contextTrace", "").split(",").map(function(s: string): string[] {
        return s.split(":");
    });
    for (var i: number = 0; i < contextTraces.length; i++) {
        if (contextTraces[i].length === 3) {
            contextTrace(contextTraces[i][0] + ":" + contextTraces[i][1], contextTraces[i][2]);
        }
    }

    var testLogBreakStr: string = gArgParser.getArg("testLogBreak", undefined);
    if (testLogBreakStr !== undefined) {
        testLogBreak = new RegExp(decodeURIComponent(testLogBreakStr));
    }

    if (typeof(globalDefaultsNodeIndex) !== "undefined") {
        // Modify the initial value for [globalDefaults]
        var globalDefaultInitValue = (<ConstNode>(<WritableNode>FunctionNode.globalFunctionNodes[globalDefaultsNodeIndex]).initialValue).value;
        var globDefChanges: {path: string[]; value: any[];}[] =
            gArgParser.getArg("globalDefaults", "").
                split(",").filter(function(s: string): boolean {
                    return s.includes(":");
                }).map(function(s: string) {
                    var args: string[] = s.split(":");
                    return { path: args[0].split("."), value: [argvConvertString(args[1])] };
                });
        for (var i = 0; i < globDefChanges.length; i++) {
            updateNormalizedValue(globalDefaultInitValue, globDefChanges[i].path, globDefChanges[i].value);
        }
    }

    let prodStatArg = gArgParser.getArg<ProductStatus|undefined>("productStatus", undefined);
    if (prodStatArg !== undefined) {
        productStatus = prodStatArg;
    } else if (typeof(process) !== "undefined") {
        productStatus = ProductStatus.testing; // running in node
    } else {
        productStatus = window.location.hostname === "testing.mondriatech.com"? ProductStatus.testing:
                        window.location.hostname === "www.mondriatech.com"? ProductStatus.production:
                        ProductStatus.development;
    }
}

function startEventProcessing(): void {
    var wrNode = <EvaluationStore> globalEvaluationNodes[pointerNodeIndex];

    // Set up event handling
    gDomEvent = new MondriaDomEvent(gPointer, "1:1");
    // Initialize pointer object
    wrNode.set(new Result([{
        position: { top: [0], left: [0] },
        display: [{
            image: ["default"]
        }],
        button: [],
        modifier: [],
        id: [1]
    }]));
    // Declare screen size
    updateScreenAreaPosition("1:1");
}

if (typeof(process) !== "undefined") {
    mondriaOnLoadDate = new Date();
    console.log('Time to onload=' + (mondriaOnLoadDate.getTime() - mondriaStartDate.getTime()) + 'ms');
    initializeModeDetection();

    main();
}
