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
/// <reference path="functionNode.ts" />
/// <reference path="evaluationNode.ts" />
/// <reference path="functionExecute.ts" />
/// <reference path="testNode.ts" />

//
// this file deals with the execution of automated tests. 'testNode.ts'
//  contains the specifics of the different test-elements, while this files
//  is responsible for the execution, and the interaction with the scheduler
//  and for dom-event injection.
// also, the bulk of the flow control elements are in the block-managers
//  defined in this file.
//
// an automatic test is a sequence of test-elements. The test starts
//  executing after an application has completed loading, and the system
//  gets a chance to fully accomodate any changes induced by the last
//  test-element before proceeding to the next one.
// Some test-elements may affect the behavior of the system, for example by
//  setting the mouse position, injecting mouse events (e.g. mouse-clicks),
//  injecting key-events or setting the value of a text-input element.
//  An 'assert' test-element usually compares an actual value of the application
//   with an expected value, and causes the test to immediately fail if they do
//   not match.
//
// A test-element can request e.g. a mouse-click as a single event; however,
//  this actually requires a series of events to be injected, e.g. a mouse-move
//  to the requested location, a mouse-down and a mouse-up. The system gets a
//  chance to respond to each event separately. In order to support that,
//  a TestRunner uses a TestDOMEventQueue, which may queue several dom-events
//  and inject them one by one, adding a new event only after the system has
//  fully stabilized following the previous one. The TestRunner execution
//  function first tests the DOM Event Injection Queue, and only when it is
//  empty would the TestRunner proceed to the next test-element.
//
// The flow-control test-elements (if/then/else, while) introduce a hierarchy
//  of test-element sequences. The TestRunner maintains a stack of
//  'block-managers', and requests the top manager to return its next element.
//  When a manager exhausts its elements, it returns an 'undefined', signalling
//  to the TestRunner that this block-manager has completed and should now be
//  popped. Then then new top-of-stack block-manager is requested to return
//  its next element.
//
// For example, an 'if/then/else' element pushd a block-manager with either
//  the 'then:' sequence or the 'else:' sequence - depending on the 'if' value.
//  If that sequence contains yet another, nested 'if/then/else', it would push
//   another block manager for the appropriate sequence.
//
// Loops (while, repeat) are each implemented using two block-managers:
//  The loop itself uses a loop-block-manager which advances along the
//   phases: Init -> Condition -> TestList -> AfterThought -> Condition ->
//            TestList -> ...
//   until the condition (evaluated at the 'Condition' phase) is 'false',
//    so that the loop-block-manager switches to the 'Exit' state and gets
//    popped up.
//  Within each of these states, with the exception of 'Condition', a 'Serial'
//   block-manager is used to execute the 'init'/'afterthough' / 'testList'
//   sequence.
//
//


// Imported from compiled cdl
declare function createTestList(): TestNode[];

var debugTest: boolean = false;

//
// DOM Event Injection Queue
//
class TestDOMEventQueue {
    domEventQueue: ImpersonatedDomEvent[] = [];

    isEmpty(): boolean {
        return (this.domEventQueue.length === 0);
    }

    enqueue(ev: ImpersonatedDomEvent) {
        this.domEventQueue.push(ev);
    }

    injectNextEvent(): void {
        var ev: ImpersonatedDomEvent = this.domEventQueue.shift();
        if (debugTest) {
            console.log("injecting dom event: " + JSON.stringify(ev));
        }
        TestDOMEventQueue.injectNextDomEventByType(ev);
    }

    // inject 'ev', a pseudo dom event, into the appropriate dom event handler
    static injectNextDomEventByType(ev: ImpersonatedDomEvent): void {
        switch (ev.type) {
          case "MouseUp":
          case "MouseDown":
            gDomEvent.mouseEventHandler(<ImpersonatedMouseDomEvent> ev, ev.type, []);
            break;
          case "MouseGestureExpired": 
            gDomEvent.mouseEventHandler(<ImpersonatedMouseGestureExpiredEvent> ev, ev.type, []);
            break;
          case "MouseMove":
            gDomEvent.mouseMoveHandler(<ImpersonatedMouseDomEvent> ev);
            break;
          case "KeyDown":
            gDomEvent.keyDownUpHandler(<ImpersonatedKeyDomEvent> ev, undefined, true);
            break;
          case "KeyUp":
            gDomEvent.keyDownUpHandler(<ImpersonatedKeyDomEvent> ev, undefined, false);
            break;
          case "KeyPress":
            gDomEvent.keyPressHandlerInt(<ImpersonatedKeyDomEvent> ev, undefined);
            break;
          case "FileChoice":
            var dropEvent = (<ImpersonatedDropEvent>ev);
            if (dropEvent.subType === "Pick") {
                if (dropEvent.area instanceof ElementReference) {
                    var inputArea = allAreaMonitor.getAreaById(dropEvent.area.getElement());
                    if (inputArea instanceof DisplayArea) {
                        gDomEvent.pickFile(dropEvent, inputArea, dropEvent.dataTransfer.files);
                    } else {
                        console.log("dropEvent:pick: no such area:", dropEvent.area.getElement());
                    }
                } else {
                    console.log("dropEvent:pick: not a (single) area:", dropEvent.area);
                }
            } else {
                gDomEvent.dropHandler(dropEvent);
            }
            break;
          default:
            Utilities.error("unknown event type: " + ev.type);
            break;
        }
    }

}

//
// TestBlockMgr is requested by the TestRunner to return the next TestNode, when
//  that TestBlockMgr is the top-of-stack mgr. If the TestBlockMgr returns
//  'undefined' then it is popped from the stack
//
interface TestBlockMgr {
    getNextTest(): TestNode;

    // called just before the mgr is popped from the stack
    destroy(): void;

    // Returns a string with the index of the test that will be executed next
    getTestIndex(): string;
}

//
// SerialTestBlockMgr
//
// constructed with an array of test-elements, executing them serially
//
class SerialTestBlockMgr implements TestBlockMgr {
    testList: TestNode[];
    nextIndex: number;

    constructor(testList: TestNode[]) {

        if (typeof(testList) === "undefined") {
            testList = [];
        }

        this.testList = testList;
        this.nextIndex = 0;
    }

    getNextTest(): TestNode {
        var nextTest: TestNode;
        if (this.nextIndex < this.testList.length) {
            nextTest = this.testList[this.nextIndex];
            this.nextIndex++;
        } else {
            nextTest = undefined;
        }

        return nextTest;
    }

    destroy(): void {
        this.testList = undefined;
        this.nextIndex = undefined;
    }

    getTestIndex(): string {
        return String(this.nextIndex);
    }
}

//
// TestRunner
//
class TestRunner {

    failed: boolean = false;

    // the stack of block-managers
    //
    // on construction, the base-level test-element sequence making up the
    //  test script is pushed as the first element of this stack;
    // execution of a test is completed when popping the last manager from this
    //  stack
    blockMgrStack: TestBlockMgr[] = [];

    domEventQueue: TestDOMEventQueue = new TestDOMEventQueue();

    constructor(testList: TestNode[]) {
        var baseBlockMgr = new SerialTestBlockMgr(testList);

        this.pushBlockMgr(baseBlockMgr);
    }

    // Gets the next test and starts its execution. When it returns false, the
    // next task is scheduled immediately, so it only does that when the test
    // was directly available for execution. Otherwise, the test schedules
    // the test runner once it has finished.
    execute(): boolean {

        if (this.failed) {
            return true;
        }

        // first, handle the dom event queue
        if (! this.domEventQueue.isEmpty()) {
            this.domEventQueue.injectNextEvent();
            return testSingleStep;
        }

        // find next test element:
        var curTest: TestNode;
        while (this.blockMgrStack.length > 0) {
            // get the next test from the current top-of-stack block-mgr
            //  returns 'undefined' if the old top-of-stack mgr was just popped
            if (debugTest) {
                console.log("test step", this.getTestStepIndex());
            }
            curTest = this.getNextTest();
            if (curTest !== undefined) {
                // found the current test
                break;
            }
        }
        if (curTest === undefined) {
            // completed the test
            console.log("test succeeded");
            endTest(0);
            return true;
        }

        printTiming();

        // Activate and schedule next test 
        curTest.activate(this);
        evaluationQueue.schedule(curTest, true);
        return true; // Unschedule this task
    }

    pushBlockMgr(blockMgr: TestBlockMgr): void {
        this.blockMgrStack.push(blockMgr);
    }

    popBlockMgr(): void {
        var blockMgr: TestBlockMgr;

        blockMgr = this.blockMgrStack.pop();
        blockMgr.destroy();
    }

    getTestStepIndex(): string {
        return this.blockMgrStack.map(block => block.getTestIndex()).join(".");
    }

    //
    // return the next test-element
    // returns 'undefined' if the top-of-stack block-mgr has just terminated,
    //  in which case it also pops it from the stack
    getNextTest(): TestNode {
        var stackLen: number = this.blockMgrStack.length;
        var topBlockMgr: TestBlockMgr = this.blockMgrStack[stackLen - 1];

        var curTest: TestNode = topBlockMgr.getNextTest();

        if (typeof(curTest) === "undefined") {
            this.popBlockMgr();
        }
        return curTest;
    }

    enqueueDOMEvent(ev: ImpersonatedDomEvent): void {
        this.domEventQueue.enqueue(ev);
    }
}

function printTiming(): void {
    if (gProfile) {
        console.log("\nExpression statistics per template");
        console.log(exprStatPerTemplate());
        console.log("\nExpression statistics per area");
        console.log(exprStatPerArea());
        console.log("\nExpression statistics per type");
        console.log(exprStatPerType());
        console.log("\nExpression statistics per prototype");
        console.log(exprStatPerPrototype());
        console.log("");
        resetExprStat();
    }
}

var gTestRunner: TestRunner;
var testSingleStep: boolean = false;

// called by the scheduler
function executeNextTestTask(): boolean {

    // initialize global testRunner, if required
    if (typeof(gTestRunner) === "undefined") {
        gTestRunner = new TestRunner(createTestList());
    }

    // call TestRunner
    return gTestRunner.execute();
}

function endTest(rc: number): void {
    if (typeof(rc) === "undefined") {
        rc = 1;
    }

    printTiming();
    if (typeof(process) !== "undefined") {
        process.exit(rc);
    } else {
        runTests = false;
        testDurationGuardTime = undefined;
    }
}

// enqueue a mouse event on the pseudo dom event queue;
// MouseClick is broken here to a MouseDown followed by a MouseUp
// non "MouseMove" events are preceded by "MouseMove" events to allow the
// system (positioning) to internalize the up-to-date co-ordinates, so that if
// there's an upon: that depends on both a 'mouse-down' and an offset, it would
// use the offset calculated based on the last mouse-move, and not the one
// from some previous event
function enqueueImpersonatedMouseEvent(type: string, btn: number,
                                x: number, y: number, modifier: string[]): void
{
    function doEnqueueImpersonatedMouseEvent(type: string, subType: string = undefined) {
        var ev: ImpersonatedMouseDomEvent =
            new ImpersonatedMouseDomEvent(type, subType, x, y, btn, modifier);

        gTestRunner.enqueueDOMEvent(ev);
    }

    doEnqueueImpersonatedMouseEvent("MouseMove");
    switch (type) {
      case "MouseMove":
        break;
      case "MouseDown":
        doEnqueueImpersonatedMouseEvent("MouseDown");
        doEnqueueImpersonatedMouseEvent("MouseGestureExpired", "Click");
        break;
      case "MouseUp":
        doEnqueueImpersonatedMouseEvent("MouseUp");
        break;
      case "MouseClick":
        doEnqueueImpersonatedMouseEvent("MouseDown");
        doEnqueueImpersonatedMouseEvent("MouseUp", "Click");
        doEnqueueImpersonatedMouseEvent("MouseGestureExpired", "DoubleClick");
        break;
      case "MouseClickPlusDown":
        doEnqueueImpersonatedMouseEvent("MouseDown");
        doEnqueueImpersonatedMouseEvent("MouseUp", "Click");
        doEnqueueImpersonatedMouseEvent("MouseDown");
        doEnqueueImpersonatedMouseEvent("MouseGestureExpired", "DoubleClick");
        break;
      case "MouseDoubleClick":
        doEnqueueImpersonatedMouseEvent("MouseDown");
        doEnqueueImpersonatedMouseEvent("MouseUp", "Click");
        doEnqueueImpersonatedMouseEvent("MouseDown");
        doEnqueueImpersonatedMouseEvent("MouseUp", "DoubleClick");
        break;
      default:
        Utilities.error("unsupported event: " + type);
        break;
    }
}

function enqueueImpersonatedDropEvent(area: any, x: number, y: number, subType: string, fileNames: string[]): void {
    var ev: ImpersonatedDropEvent = new ImpersonatedDropEvent(area, x, y, subType, fileNames);

    gTestRunner.enqueueDOMEvent(ev);
}

// enqueue a key event on the pseudo dom event queue
function enqueueImpersonatedKeyEvent(type: string, key: string,
                                     eChar: string, modifier: string[])
{
    var ev = new ImpersonatedKeyDomEvent(type, key, eChar, modifier);
    gTestRunner.enqueueDOMEvent(ev);
}
