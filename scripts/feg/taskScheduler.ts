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

/// <reference path="externalTypes.ts" />
/// <reference path="evaluationQueue.ts" />
/// <reference path="testRunner.ts" />
/// <reference path="taskQueue.ts" />
/// <reference path="eventQueue.ts" />
/// <reference path="posConstraintSynchronizer.ts" />

var gContentPositionCycleCount: number = 0;
var gMaxContentPositionCycleCount: number = 0;

//
//  display query initial polling
//
// if web-fonts are used, there may be some time where the web-font has not been
//  loaded yet, and while it is being loaded  a different font is used. Later,
//  when the web font has completed loading it replaces that stop-gap font.
// the two fonts may well have different display sizes, and thus the initial
//  value reported may later be made incorrect.
// the solution here is to poll all display-query values during start-up.
// the assumption here is that web-fonts are loaded immediately, rather than
//  dynamically/lazily/upon-demand, and that after a while a web font that did
//  not successfully load is forever ignored. the 'giving up' duration is
//  apparently browser dependent, rumored to range 3-30 seconds.
// we use a series of timeouts of successively larger duration, so that the
//  usual cases are handled relatively fast, and extreme cases handled
//  eventually
// 
var nDisplayQueryRecalc = 0;
var maxDisplayQueryRecalc = 11;
var displayQueryRecalcTime = 500; //ms
// each successive timeout is multiplied by this factor
// Total waiting time is displayQueryRecalcTime * (displayQueryRecalcTimeFactor^(maxDisplayQueryRecalc+1) - 1) / (displayQueryRecalcTimeFactor - 1)
// which is 37s with the current settings.
var displayQueryRecalcTimeFactor = 1.3;

function scheduleDisplayQueryRecalculation(): void {
    if (nDisplayQueryRecalc > 0) {
        DisplayOffsetSurveyor.pollAllSurveyor(nDisplayQueryRecalc >= maxDisplayQueryRecalc);
    }
    if (nDisplayQueryRecalc < maxDisplayQueryRecalc) {
        nDisplayQueryRecalc++;
        setTimeout(scheduleDisplayQueryRecalculation, displayQueryRecalcTime);
        displayQueryRecalcTime *= displayQueryRecalcTimeFactor;
    }
}

class ScheduledTask implements TaskQueueTask {
    isScheduled: boolean = false;
    inTask: boolean = false;

    constructor(public name: string,
                public priority: number,
                public checkBlockTaskLoop: boolean,
                public task: (taskQueue: TaskQueue) => boolean) {
    }

    public executeTask(taskQueue: TaskQueue): boolean {
        this.inTask = true;
        var r: boolean = this.task(taskQueue); // Returns true when complete; will then be removed from task queue
        this.inTask = false;
        this.isScheduled = !r;
        return r;
    }

    schedule(): void {
        if (!this.isScheduled && !(this.checkBlockTaskLoop && blockTaskLoop && !forcedSchedule)) {
            this.isScheduled = true;
            globalTaskQueue.scheduleTask(this, this.priority);
        }
    }
}

/// When true, content and positioning are not scheduled and can only execute
/// once more (if already scheduled).
var blockTaskLoop: boolean = false;
var forcedSchedule: boolean = false;

/// This forces the scheduling of the content and positioning tasks (and the
/// tasks that they trigger), but just once.
function forceTaskExecution(): void {
    // globalContentTask.isScheduled = false;
    // globalGeometryTask.isScheduled = false;
    // globalPreWriteNotificationTask.isScheduled = false;
    // globalCommitWritesTask.isScheduled = false;
    // globalContentTask.isScheduled = false;
    forcedSchedule = true;
    globalContentTask.schedule();
    globalGeometryTask.schedule();
    globalPreWriteNotificationTask.schedule();
    globalCommitWritesTask.schedule();
    globalDebuggerTask.schedule();
    forcedSchedule = false;
}

/// When execution is blocked as a result of a loop detection, this function
/// resets the variables that stop the loop. Since the counter is also reset,
/// a cycle of 100 content/position alterations will trigger the loop detection
/// again. Note that possibleLoopDetected is not set to false, so the area
/// cycle mechanism will keep printing messages.
function resetBlockTaskLoop(): void {
    blockTaskLoop = false;
    gContentPositionCycleCount = 0;
    forceTaskExecution();
}

function resumeTaskProcessing(): void {
    possibleLoopDetected = false;
    clearAreaCreationState();
    resetBlockTaskLoop();
}

class ContentTask extends ScheduledTask {
    constructor() {
        super("content", TaskQueue.contentPriority, true, undefined);
    }

    schedule(): void {
        if (this.isScheduled) {
            return;
        }
        if (globalGeometryTask.isScheduled || globalCommitWritesTask.isScheduled) {
            if (blockTaskLoop && !forcedSchedule) {
                return;
            }
            gContentPositionCycleCount++;
            if (gContentPositionCycleCount > gMaxContentPositionCycleCount) {
                gMaxContentPositionCycleCount = gContentPositionCycleCount;
            }
            if (gContentPositionCycleCount === 100) {
                possibleLoopDetected = true;
                console.log("possible content/position cycle");
                breakIntoDebugger();
            }
            blockTaskLoop = gContentPositionCycleCount >= 100;
        } else if (!possibleLoopDetected) {
            gContentPositionCycleCount = 0;
            possibleLoopDetected = blockTaskLoop;
        }
        globalTaskQueue.scheduleTask(this, this.priority);
        this.isScheduled = true;
        globalDebuggerTask.schedule();
    }

    executeTask(taskQueue: TaskQueue): boolean {
        this.inTask = true;

        if (logValues) gSimpleLog.log("run content");
        var r = evaluationQueue.runQueue(0, taskQueue);

        if (!globalPosConstraintSynchronizer.isEmpty() ||
              globalPos.needToRefresh()) {
            globalGeometryTask.schedule();
        }
        if (possibleLoopDetected) {
            checkAreaCreationCycle();
        } else {
            clearAreaCreationState();
        }
        globalContentLoopWarningTask.schedule();
        this.inTask = false;
        this.isScheduled = !r;
        return r;
    }
}

var globalContentTask: ContentTask = new ContentTask();

function scheduleContentTask(): void {
    globalContentTask.schedule();
}

function runGeometry(): void {
    globalPosConstraintSynchronizer.flushBuffer();

    globalPos.reposition(undefined);

    // Reposition all areas on the screen. This is done whether the
    // calculation was completed or not
    globalAbsolutePosManager.refreshPos();

    // clear lists of changes
    globalPos.clearSolutionChanges();
}

class GeometryTask extends ScheduledTask {
    constructor() {
        super("geometry", TaskQueue.geometryPriority, true, undefined);
    }

    schedule(): void {
        if (this.isScheduled) {
            return;
        }
        if (globalContentTask.isScheduled || globalCommitWritesTask.isScheduled) {
            if (blockTaskLoop && !forcedSchedule) {
                return;
            }
            gContentPositionCycleCount++;
            if (gContentPositionCycleCount > gMaxContentPositionCycleCount) {
                gMaxContentPositionCycleCount = gContentPositionCycleCount;
            }
            if (gContentPositionCycleCount === 100) {
                possibleLoopDetected = true;
                console.log("possible content/position cycle");
                breakIntoDebugger();
            }
            blockTaskLoop = gContentPositionCycleCount >= 100;
        } else if (!possibleLoopDetected) {
            gContentPositionCycleCount = 0;
            possibleLoopDetected = blockTaskLoop;
        }
        globalTaskQueue.scheduleTask(this, this.priority);
        this.isScheduled = true;
        globalDebuggerTask.schedule();
    }

    executeTask(taskQueue: TaskQueue): boolean {
        if (logValues) gSimpleLog.log("run positioning", globalPosConstraintSynchronizer.buffer.length);
        this.inTask = true;

        runGeometry();

        if (gZIndex.changes) {
            gZIndex.updateZ();
        }

        globalReupdatePointerInAreaTask.schedule();

        var needToRefresh: boolean = globalPos.needToRefresh();
        this.inTask = false;
        this.isScheduled = needToRefresh;
        if (!needToRefresh) {
            globalPositioningDependency.undefer();
        }
        return !needToRefresh;
    }
}

var globalGeometryTask: GeometryTask = new GeometryTask();

function scheduleGeometryTask(): void {
    globalGeometryTask.schedule();
}

var globalPreWriteNotificationTask: ScheduledTask = new ScheduledTask(
    "preWrite", TaskQueue.preWritesPriority, true,
    function(taskQueue: TaskQueue): boolean {
        evaluationQueue.preWritesNotification();
        globalCommitWritesTask.schedule();
        return true;
    }
);

var globalCommitWritesTask: ScheduledTask = new ScheduledTask(
    "commitWrites", TaskQueue.commitWritesPriority, true,
    function(taskQueue: TaskQueue): boolean {
        evaluationQueue.commitWrites();
        globalEventQueue.clearMessage();
        return true;
    }
);

var globalNextMessageTask: ScheduledTask = new ScheduledTask(
    "nextMessage", TaskQueue.nextMessagePriority, true,
    function(taskQueue: TaskQueue): boolean {
        return evaluationQueue.globalMessageQueue.nextMessage();
    }
);

var globalExecutePathNodeQueue: ScheduledTask = new ScheduledTask(
    "executePathNodeQueue", TaskQueue.executePathNodeQueuePriority, true,
    function(taskQueue: TaskQueue): boolean {
        globalInternalQCM.executeScheduled();
        return true;
    }
);

var globalDebuggerTask: ScheduledTask = new ScheduledTask(
    "debugger", TaskQueue.debuggerPriority, false,
    function(taskQueue: TaskQueue): boolean {
        gDebuggerInfoMgr.update();
        return true;
    }    
);

// A PrintJob only has to implement doPrintTask(). It can be added to the
// print task queue, which is run after all visual updates have been performed.
interface PrintJob {
    getEmbeddingRect(): Rect;
    getRelative(): Relative;
    getHTMLRepr(): string;
}

// Queue for print tasks.
// Copies the areas' html into the window and calls the browser's print
// function. Closes the window when done. Copies the base URI of the document to
// the new window so it can find the resources, and the head elements so the
// fonts and stylesheets from the document are found and applied.
class PrintTask extends ScheduledTask{
    printJobs: PrintJob[] = [];
    printWindow: Window|undefined = undefined;

    addPrintTask(task: PrintJob): void {
        if (task !== undefined) {
            this.printJobs.push(task);
            // this.setWindow();
        }
        globalPrintTask.schedule();
    }

    setWindow(w: Window): void {
        this.printWindow = w;
    }

    printAll(): void {
        if (this.printJobs.length === 0) {
            print();
            var message: EventObject = {
                type: ["Print"],
                subType: ["end"],
                time: [Date.now()]
            };
            queueEvent(new ImpersonatedDomEvent("print"), message, undefined,
                       constEmptyOS, undefined, constEmptyOS, constEmptyOS,
                       undefined, undefined, undefined, undefined, undefined);
            return;
        }
        if (!this.printWindow) {
            return;
        }

        // Get coordinates for printing
        var minTopLeft: Point = this.printJobs[0].getEmbeddingRect();
        var allHTML: string = "";
        for (var i = 1; i < this.printJobs.length; i++) {
            var embeddingTopLeft = this.printJobs[i].getEmbeddingRect();
            minTopLeft.top = Math.min(minTopLeft.top, embeddingTopLeft.top);
            minTopLeft.left = Math.min(minTopLeft.left, embeddingTopLeft.left);
        }

        for (var i = 0; i < this.printJobs.length; i++) {
            var embeddingRect = this.printJobs[i].getEmbeddingRect();
            var areaHTML = this.printJobs[i].getHTMLRepr();
            if (areaHTML !== undefined) {
                allHTML += '<div style="position: absolute; top: ' + 
                                (embeddingRect.top - minTopLeft.top) +
                                'px; left: ' + 
                                (embeddingRect.left - minTopLeft.left) +
                                'px; width: ' + embeddingRect.width +
                                'px; height: ' + embeddingRect.height +
                                'px;">' +
                           areaHTML+
                           '</div>';
            }
        }
        this.printJobs = [];
        if (allHTML === "") {
            return;
        }

        var baseHRef = document.baseURI.slice(0, document.baseURI.lastIndexOf("/") + 1);
        // Collect certain children of head of current document; they are
        // needed for proper formatting
        var head: string = "";
        var docHead = document.getElementsByTagName("head");
        if (docHead.length === 1) {
            var headElements: HTMLCollection = docHead[0].children;
            for (var i = 0; i < headElements.length; i++) {
                var element: Element = headElements.item(i);
                if (element instanceof HTMLMetaElement ||
                      element instanceof HTMLStyleElement ||
                      element instanceof HTMLLinkElement) {
                    head += element.outerHTML;
                }
            }
        }

        // Put the selected head elements in the head of the window's html,
        // the area's inner html in the body of the window's html and add an
        // explicit base so that other URLs will resolve properly.
        var printWindow = this.printWindow;
        this.printWindow = undefined;
        printWindow.document.write(
            '<html><head><base href="' + baseHRef + '">' + head + '</head>' +
            '<body>' + allHTML + '</body></html>'
        );
        // Calling win.print() immediately loses the images, and there is no
        // way to set an event handler from here, so let's give it a second.
        setTimeout(function() {
            printWindow.print();
            printWindow.close();
        }, 1000);
    }
}

var globalPrintTask: PrintTask = new PrintTask(
    "print", TaskQueue.printPriority, false,
    function(taskQueue: TaskQueue): boolean {
        globalPrintTask.printAll();
        return true;
    }    
);

var globalTestTask: ScheduledTask = new ScheduledTask(
    "test", TaskQueue.testPriority, false,
    function(taskQueue: TaskQueue): boolean {
        return executeNextTestTask();
    }    
);

var globalScreenAreaSize: Rect;

var globalScreenResizeTask: ScheduledTask = new ScheduledTask(
    "resizeScreen", TaskQueue.screenResizePriority, false,
    function(taskQueue: TaskQueue): boolean {
        globalScreenAreaSize = determineScreenAreaSize();

        setTimeout(function() {
            if (suppressRunningUntil === undefined) {
                suppressRunningUntil = Date.now() + 100;
            }
            globalScreenWidthConstraint.newDescription({
                point1: { type: "left" },
                point2: { type: "right" },
                equals: globalScreenAreaSize.width,
                priority: 10000
            }, 10000);
            globalScreenHeightConstraint.newDescription({
                point1: { type: "top" },
                point2: { type: "bottom" },
                equals: globalScreenAreaSize.height,
                priority: 10000
            }, 10000);
            gDomEvent.resizeScreenArea(globalScreenAreaSize.width, globalScreenAreaSize.height);

            scheduleGeometryTask();

            // if this resize was really a zoom in/out, re-measure all display
            // queries
            scheduleDisplayQueryRecalculation();
        }, 20);

        return true;
    }    
);

function scheduleTestTask(): void {
    globalTestTask.schedule();
}

var globalRemotingTask: ScheduledTask = new ScheduledTask(
    "remoting", TaskQueue.remotingPriority, false,
    function(taskQueue: TaskQueue): boolean {
        gRemoteMgr.flush();
        return true;
    }    
);

function scheduleRemotingTask(): void {
    globalRemotingTask.schedule();
}

var globalIndexerGarbageCollectionTask: ScheduledTask = new ScheduledTask(
    "indexer garbage collection", TaskQueue.indexerGarbageCollectionPriority, false,
    function(taskQueue: TaskQueue): boolean {
        return globalInternalQCM.executeGarbageCollection(taskQueue);
    }    
);

function scheduleIndexerGarbageCollectionTask(): void {
    globalIndexerGarbageCollectionTask.schedule();
}

var globalReupdatePointerInAreaTask: ScheduledTask = new ScheduledTask(
    "reupdatePointerInArea", TaskQueue.reupdatePointerInAreaPriority, false,
    function(taskQueue: TaskQueue): boolean {
        globalEventQueue.reupdatePointerInArea();
        return true;
    }
);

var globalAreaDisplayUpdateTask: ScheduledTask = new ScheduledTask(
    "areaDisplayUpdate", TaskQueue.areaDisplayUpdatePriority, false,
    function(taskQueue: TaskQueue): boolean {
        return allAreaMonitor.areaDisplayUpdate();
    }    
);

var globalVisualFlushTask: ScheduledTask = new ScheduledTask(
    "visualFlush", TaskQueue.visualFlushPriority, false,
    function(taskQueue: TaskQueue): boolean {
        return allAreaMonitor.updateVisuals();
    }
);

var globalVisualWrapupTask: ScheduledTask = new ScheduledTask(
    "visualWrapup", TaskQueue.visualWrapupPriority, false,
    function(taskQueue: TaskQueue): boolean {
        if (!allAreaMonitor.wrapupUpdateVisuals()) {
            return false;
        }
        yieldToBrowser();
        return true;
    }    
);

/// When true, calls the progress hook; only used in initialization phase
var gInitPhase: boolean = true;

var globalConcludeInitPhaseTask: ScheduledTask = new ScheduledTask(
    "concludeInitPhase", TaskQueue.concludeInitPhasePriority, false,
    function(taskQueue: TaskQueue): boolean {
        gInitPhase = false;
        allAreaMonitor.cleanUpUnusedEvaluationNodes();
        if (!gRemoteMgr.hasPendingResources()) {
            hideSplashScreen();
            allAreaMonitor.allDisplayElementsVisible();
        }
        return true;
    }    
);


var globalSetFocusTask: ScheduledTask = new ScheduledTask(
    "setFocus", TaskQueue.setFocusPriority, false,
    function(taskQueue: TaskQueue): boolean {
        gDomEvent.updateFocus();
        return true;
    }    
);

var globalNextQueuedEvent: ScheduledTask = new ScheduledTask(
    "nextQueuedEvent", TaskQueue.queuedEventPriority, false,
    function(taskQueue: TaskQueue): boolean {
        return globalEventQueue.nextQueuedEvent();
    }    
);

function scheduleEventQueue(): void {
    globalNextQueuedEvent.schedule();
}

var globalContentLoopWarningTask: ScheduledTask = new ScheduledTask(
    "concludeLoopWarning", TaskQueue.concludeLoopWarningPriority, false,
    function(taskQueue: TaskQueue): boolean {
        if (!evaluationQueue.isDeferredEmpty(0)) {
            if (runTests) {
                assert(false, "deferred queue not empty: there is a loop");
            } else {
                console.warn("deferred queue not empty: there is a loop");
            }
        }
        return true;
    }    
);

var gNumberSuspends: number = 0;

// This suspends all activity. Currently only called during resource load.
// While tasks are suspended, they can still be scheduled, but won't be
// executed.
function suspendScheduledTasks(): void {
    if (gNumberSuspends === 0) {
        showRunningDivNow();
        globalTaskQueue.suspend();
        evaluationQueue.suspend();
    }
    gNumberSuspends++;
}

function resumeScheduledTasks(): void {
    gNumberSuspends--;
    if (gNumberSuspends === 0) {
        evaluationQueue.resume();
        globalTaskQueue.resume();
        if (!globalPosConstraintSynchronizer.isEmpty() ||
              globalPos.needToRefresh()) {
            globalGeometryTask.isScheduled = false; // force rescheduling
            globalGeometryTask.schedule();
        }
        if (!evaluationQueue.isEmpty(0)) {
            globalContentTask.isScheduled = false; // force rescheduling
            globalContentTask.schedule();
        }
    }
}

function breakIntoDebugger(): void {
    allAreaMonitor.forceTempUpdate();
    debugger;
}

function signalRuntimeException(errorMsg: string): void {
    console.log("exception:", errorMsg);
    if (runTests) {
        endTest(1);
    }
    allAreaMonitor.forceTempUpdate();
}
