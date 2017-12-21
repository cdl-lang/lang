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

/// <reference path="watcherProducer.ts" />

class TestTimer {
    startTime: number;
    accum: number = 0;
    nr: number;

    constructor(nr: number) {
        this.nr = nr;
    }

    start(): void {
        this.startTime = Date.now();
    }

    stop(): void {
        if (typeof(this.startTime) === "undefined") {
            console.log("timer:", this.nr, "not started");
        } else {
            this.accum = Date.now() - this.startTime;
            this.startTime = undefined;
            console.log("timer:", this.nr, this.accum, "ms");
        }
    }

    pause(): void {
        this.accum = Date.now() - this.startTime;
        this.startTime = undefined;
    }

    resume(): void {
        this.startTime = Date.now();
    }

}

var testTimers: {[nr: number]: TestTimer} = {};

abstract class TestNode implements Watcher, Evaluator {

    dataSourceAware: boolean = false;
    scheduleStep: number;

    testRunner: TestRunner;

    constructor(scheduleStep: number) {
        this.scheduleStep = scheduleStep;
    }

    abstract performTest(): boolean;

    static convertArg(arg: any): any {
        return arg instanceof FNRef?
            getEvaluationNode(refFunctionNode(arg), undefined):
            arg;
    }

    toLogString(): string {
        return undefined;
    }

    /**
     * The assumption is that exactly one area should be referenced by 'area',
     * so that more/less areas actually referenced trigger a message and
     * an 'undefined' return.
     * 
     * @static
     * @param {string} msg the string prefix of warning messages
     * @param {*} area evaluation node or ElementReference which (should) return
     *            one area reference
     * @returns {CoreArea} the area-object referenced by 'area'
     */
    static getSingleArea(msg: string, elementReference: any): CoreArea {
        var areaStr: string;

        elementReference = getDeOSedValue(elementReference);
        if (elementReference instanceof ElementReference) {
            var areaObj: CoreArea =
                allAreaMonitor.getAreaById(elementReference.getElement());
            if (typeof(areaObj) === "undefined") {
                Utilities.warn(msg + ": no area for areaId '" +
                               elementReference.getElement() + "'");
            }
            return areaObj;
        } else if (elementReference instanceof Array &&
                   elementReference.length > 1) {
            areaStr = "";
            for (var i = 0; i < elementReference.length; i++) {
                areaStr += cdlify(elementReference[i]) + " ";
            }
            Utilities.warn(msg + ": multiple matches: " + areaStr);
        } else if (isFalse(elementReference)) {
            Utilities.warn(msg + ": no area matched");
        } else {
            Utilities.warn(msg + ": unexpected argument");
        }
        return undefined;
    }

    // return a string describing the area-reference, where exactly a single
    //  area is expected to be referenced by 'area', the evaluation-node
    //  associated with an 'area' test-ndoe argument
    static getSingleAreaStr(elementReference: any): string {    
        var elementStr: string;

        elementReference = getDeOSedValue(elementReference);
        if (elementReference instanceof ElementReference) {
            elementStr = elementReference.stringify();
        } else {
            elementStr = "??";
        }
        return elementStr;
    }

    // return the area-object of the html-element currently having focus,
    //  or undefined if it could not be identified
    static getFocusArea(): DisplayArea {
        var focusedElement: Element = document.activeElement;
        var focusedHElement: HTMLElement;

        if (focusedElement instanceof HTMLElement) {
            focusedHElement = focusedElement;
        } else {
            focusedElement = undefined;
        }

        var area: CoreArea = undefined;

        if (focusedHElement && focusedHElement.parentNode &&
            focusedHElement.parentNode.parentNode) {
            var frameNode: Node =
                focusedHElement.parentNode.parentNode;
            var frameDiv: HTMLElement;

            var areaId: string;
            if (frameNode instanceof HTMLElement) {
                frameDiv = <HTMLElement>frameNode;
                areaId = frameDiv.getAttribute("id");
            }
            if (typeof(areaId) === "string") {
                area = allAreaMonitor.getAreaById(areaId);
            }
        }

        return area instanceof DisplayArea? area: undefined;
    }

    reasonOfFailure(): string {
        return undefined;
    }

    /**
     * The inputs of the test node 
     * 
     * @type {{[tag: string]: any}}
     */
    inputs: {[tag: string]: any};

    /**
     * The evaluationNodes this test watches
     * 
     * @type {EvaluationNode[]}
     */
    evaluationNodes: {[attr: string]: EvaluationNode} = {};

    /**
     * The values received in updateInput 
     * 
     * @type {{[tag: string]: any}}
     */
    inputValues: {[tag: string]: any} = {};

    registerInputs(): boolean {
        var ready: boolean = true;

        for (var attr in this.inputs) {
            var value = this.inputs[attr];
            if (value instanceof FNRef) {
                var en = getEvaluationNode(refFunctionNode(value), undefined);
                if (en.isConstant()) {
                    this.inputValues[attr] = getDeOSedValue(en.result.value);
                } else {
                    this.evaluationNodes[attr] = en;
                    en.addWatcher(this, attr, true, true, false);
                    ready = false;
                }
            } else {
                this.inputValues[attr] = value;
            }
        }
        return ready;
    }

    unregisterInputs(): void {
        for (var attr in this.evaluationNodes) {
            this.evaluationNodes[attr].removeWatcher(this, true, false);
        }
        this.evaluationNodes = undefined;
    }

    /**
     * Activates the test and its inputs, and runs it when it can. 
     * 
     * @param {TestRunner} testRunner
     * @returns {boolean} the result of the test or undefined it is queued
     */
    activate(testRunner: TestRunner): void {
        this.active = true;
        this.testRunner = testRunner;
        this.registerInputs();
    }

    deactivate(): void {
        this.testRunner = undefined;
        this.unregisterInputs();
        this.active = false;
    }

    // Watcher/Evaluator interface
    
    watcherId: number = getNextWatcherId();
    deferred: boolean = false;
    scheduledAtPosition: number = -1;

    attributedTime: number;
    totalUpdateInputTime: number;
    nrQueueResets: number;

    active: boolean = false;

    public isActive(): boolean {
        return this.active;
    }

    public updateInput(id: any, result: Result): void {
        this.inputValues[id] = getDeOSedValue(result.value);
        if (this.deferred) {
            this.undefer();
        }
        evaluationQueue.schedule(this, false);
    }

    public unlatch(): void {
    }

    public updateOutput(): void {
        if (this.test()) {
            if (!testSingleStep) {
                globalTestTask.schedule();
            }
        }
        this.deactivate();
    }

    /**
     * This function executes the test, and is called from the evaluation queue
     * as soon as its inputs are ready. 
     * 
     * @returns {boolean} the result of the test
     */
    test(): boolean {
        if (debugTest) {
            console.log("Executing TestNode: " + this.toLogString());
        }
        var rc: boolean = this.performTest();
        if (!rc) {
            var reason: string = this.reasonOfFailure();
            console.log("test failure: ", this.toLogString());
            if (reason !== undefined) {
                console.log("because:", reason);
            }
            endTest(1);
        } else if (debugTest) {
            console.log("test succeeded");
        }
        this.testRunner.failed = !rc;
        return rc;
    }

    public isScheduled(): boolean {
        return this.scheduledAtPosition !== -1;
    }

    public getScheduleStep(): number {
        return this.scheduleStep;
    }

    public getSchedulePriority(): number {
        return 0;
    }

    public defer(): void {
        this.deferred = true;
        evaluationQueue.defer(this);
        for (var attr in this.evaluationNodes) {
            var input: EvaluationNode = this.evaluationNodes[attr];
            if (input !== undefined && input.scheduledAtPosition !== -1) {
                input.addAwaitingThis(this.watcherId, this);
            }
        }
    }

    public undefer(): void {
        this.deferred = false;
        evaluationQueue.undefer(this);
        for (var attr in this.evaluationNodes) {
            var input: EvaluationNode = this.evaluationNodes[attr];
            if (input !== undefined && input.awaitingThis !== undefined &&
                  input.awaitingThis.has(this.watcherId)) {
                input.removeAwaitingThis(this.watcherId);
            }
        }
        evaluationQueue.schedule(this, false);
    }

    public isDeferred(): boolean {
        return this.deferred;
    }

    isReady(): boolean {
        for (var attr in this.evaluationNodes) {
            if (this.evaluationNodes[attr].deferred) {
                return false;
            }
        }
        return true;
    }

    debugName(): string {
        return "testNode";
    }

    getDebugOrigin(): string[] {
        return ["test node "];
    }
}

class LogTest extends TestNode {
    inputs: {
        log: any;
    };
    inputValues: {
        log: any;
    };

    constructor(scheduleStep: number, log: any) {
        super(scheduleStep);
        this.inputs = { log: log };
    }

    performTest(): boolean {
        console.log(this.toLogString());
        return true;
    }

    toLogString(): string {
        var msg: any = this.inputValues.log;
        var msgStr: string = typeof(msg) === "string"? msg: vstringify(msg);

        if (testLogBreak !== undefined && testLogBreak.test(msgStr)) {
            testSingleStep = true;
            testDurationGuardTime = undefined;
            console.log("testLogBreak matched output of log");
        }
        return "log: " + msgStr;
    }
}

class SleepTest extends TestNode {
    inputs: {
        sleep: any;
    };
    inputValues: {
        sleep: any;
    };

    constructor(scheduleStep: number, sleep: any) {
        super(scheduleStep);
        this.inputs = { sleep: sleep };
    }

    performTest(): boolean {
        var sleepTime: any = getDeOSedValue(this.inputValues.sleep);

        if (sleepTime > 0) {
            suspendScheduledTasks();
            setTimeout(function() {
                resumeScheduledTasks();
            }, sleepTime);
        } else if (sleepTime !== 0) {
            return false;
        }
        return true;
    }

    toLogString(): string {
        var msg: any = this.inputValues.sleep;

        return "sleep: " + (typeof(msg) === "string"? msg: vstringify(msg));
    }

    reasonOfFailure(): string {
        return "sleep time is not a positive number";
    }
}

class AssertTest extends TestNode {
    inputs: {
        assert: any;
        comment: any;
    };
    inputValues: {
        assert: any;
        comment: any;
    };

    constructor(scheduleStep: number, assert: any, comment: any) {
        super(scheduleStep);
        this.inputs = { assert: assert, comment: comment };
    }

    performTest(): boolean {
        return isTrue(this.inputValues.assert);
    }

    toLogString(): string {
        var msg: any = this.inputValues.comment;

        return "assert: " + (typeof(msg) === "string"? msg: vstringify(msg));
    }
}

class TimerTest extends TestNode {
    inputs: {
        timerIndex: any;
        action: any;
    };
    inputValues: {
        timerIndex: any;
        action: any;
     };

    constructor(scheduleStep: number, timerIndex: any, action: any) {
        super(scheduleStep);
        this.inputs = {
            timerIndex: timerIndex,
            action: action
        };
    }

    performTest(): boolean {
        var timerIndex: any = this.inputValues.timerIndex;
        var action: any = this.inputValues.action;

        if (!(timerIndex in testTimers)) {
            testTimers[timerIndex] = new TestTimer(timerIndex);
        }
        switch (action) {
          case "start":
            testTimers[timerIndex].start();
            break;
          case "stop":
            testTimers[timerIndex].stop();
            break;
          case "pause":
            testTimers[timerIndex].pause();
            break;
          case "resume":
            testTimers[timerIndex].resume();
            break;
          default:
            console.log("timer", timerIndex, "wrong action:", action);
            break;
        }
        return true;
    }

    toLogString(): string {
        var timerIndex: any = this.inputValues.timerIndex;
        var action: any = this.inputValues.action;

        return "timer #" + timerIndex + ": " + action;
    }
}

class LogInternalActions extends TestNode {
    inputs: {
        logInternalActionsArg: any;
    };
    inputValues: {
        logInternalActionsArg: any;
     };

    constructor(scheduleStep: number, logInternalActionsArg: any) {
        super(scheduleStep);
        this.inputs = {
            logInternalActionsArg: logInternalActionsArg
        };
    }

    performTest(): boolean {
        var logInternalActions: any = stripArray(this.inputValues.logInternalActionsArg);

        if (logInternalActions !== undefined && typeof(logInternalActions) === "object") {
            if (logInternalActions.expressions !== undefined) {
                if (isTrue(logInternalActions.expressions)) {
                    logValues = true;
                    logPrototypes = undefined;
                } else {
                    logValues = false;
                    logPrototypes = {};
                }
            }
            if (logInternalActions.writes !== undefined) {
                debugWrites = isTrue(logInternalActions.writes);
            }
            if (logInternalActions.test !== undefined) {
                debugTest = isTrue(logInternalActions.test);
            }
            if (logInternalActions.areas !== undefined) {
                debugAreaConstruction = isTrue(logInternalActions.areas);
            }
            if (isTrue(logInternalActions.printAreaHierarchy)) {
                console.log(printObjAsTree(areaHierarchy()));
            }
            if (isTrue(logInternalActions.printAllDataSourceApplicationTrees)) {
                console.log(printObjAsTree(printAllDataSourceApplicationTrees(false)));
            }
        }
        return true;
    }

    toLogString(): string {
        var logInternalActions: any = this.inputValues.logInternalActionsArg;

        return "logInternalActions " + logInternalActions;
    }
}

//
// this class deals with a test-node that injects a mouse-event, such that
//  the location of the mouse-event is relative to some area.
// the test-node must specify a single area (elementReference).
// the coordinates of the event start at the top,left corner of the specified
// area, such that the x,y specified in the event are taken to be a displacement
// from the top,left corner with the units being the height/width (respectively)
//
// The default x,y are 0.5/0.5 - the center of the area.
// a 'y == 0' means the top border of the area's frame, while 'x==1' indicates
// the right border of the area's frame. An x,y of (x=-0.1, y=1.1) is just
// outside the top-right corner of the area's frame
//
// the code below must convert the position returned by area.getPos(), where
//  the top/left are relative to the embedding, to absolute coordinates as
//  expected by enqueueImpersonatedMouseEvent(). I'm not certain this is done
//  correctly when the content (embedding) div is not identical to the frame.
//
class AreaRelativeMouseEventTest extends TestNode {
    inputs: {
        eType: any;
        btn: any;
        area: any;
        x: any;
        y: any;
        modifier: any;
    };
    inputValues: {
        eType: any;
        btn: any;
        area: any;
        x: any;
        y: any;
        modifier: any;
    };

    constructor(scheduleStep: number, eType: any, btn: any, area: any,
                x: any, y: any, modifier: any) {
        super(scheduleStep);
        this.inputs = {
            eType: eType,
            btn: btn,
            area: area,
            x: x,
            y: y,
            modifier: modifier
        };
    }

    performTest(): boolean {
        var eType = this.inputValues.eType;
        var btn = this.inputValues.btn;
        if (typeof(btn) === "string") {
            var btnStr: string = btn;
            var btnNames : { [index:string]: number } = {
                left: 0,
                middle: 1,
                right: 2
            };

            btn = btnNames[btnStr];
        }
        var area = TestNode.getSingleArea("AreaRelativeMouseEventTest",
                                          this.inputValues.area);
        var x = getDeOSedValue(this.inputValues.x);
        var y = getDeOSedValue(this.inputValues.y);
        var modifier = this.inputValues.modifier;

        if (typeof(area) === "undefined") {
            return false;
        }

        var absPos = AreaRelativeMouseEventTest.getAbsPos(area);

        if (x === undefined || x === false) {
            x = 0.5;
        }
        if (y === undefined || y === false) {
            y = 0.5;
        }

        var left = absPos.left + absPos.width * x;
        var top = absPos.top + absPos.height * y;

        if (modifier === undefined) {
            modifier = [];
        }
        if (typeof(modifier) === "string") {
            modifier = [modifier];
        }

        this.postEvent(eType, btn, left, top, modifier);

        return true;
    }

    postEvent(eType: any, btn: any, left: any, top: any, modifier: any): void {
        enqueueImpersonatedMouseEvent(eType, btn, left, top, modifier);
    }

    toLogString(): string {
        var eType = this.inputValues.eType;
        var btn = this.inputValues.btn;
        var areaStr = TestNode.getSingleAreaStr(this.inputValues.area);
        var x = this.inputValues.x;
        var y = this.inputValues.y;
        var modifier = this.inputValues.modifier;

        return "AreaRelativeMouseEvent " + eType + ":" + btn +
            "<" + areaStr +
            ">(" + x + "," + y + ") mod:" + String(modifier);
    }

    static getAbsPos(area: CoreArea) {
        var pos = area.getPos();

        var absTop = pos.top;
        var absLeft = pos.left;

        for (var em = area.getEmbedding(); em; em = em.getEmbedding()) {
            var offsets = em.getOffsets();
            if (typeof(offsets) === "object") {
                absTop += isNaN(offsets.top) ? 0 : offsets.top;
                absLeft += isNaN(offsets.left) ? 0 : offsets.left;
            }

            var emPos = em.getPos();
            absTop += emPos.top;
            absLeft += emPos.left;
        }


        return {
            top: absTop,
            left: absLeft,
            width: pos.width,
            height: pos.height
        };
    }

    reasonOfFailure(): string {
        var area: any = this.evaluationNodes["area"];

        return area !== undefined? area.reasonForBeingEmpty(): undefined;
    }
}

// Simulates dropping a file or opening a file via a input: type: "file" area.
class FileChoiceEventTest extends AreaRelativeMouseEventTest {
    inputs: {
        eType: any;
        btn: any;
        area: any;
        x: any;
        y: any;
        modifier: any;
        fileName: any;
        subType: any;
    };
    inputValues: {
        eType: any;
        btn: any;
        area: any;
        x: any;
        y: any;
        modifier: any;
        fileName: any;
        subType: any;
    };

    constructor(scheduleStep: number, fileName: any, subType: any, area: any, x: any, y: any) {
        super(scheduleStep, "", undefined, area, x, y, []);
        this.inputs.fileName = fileName;
        this.inputs.subType = subType;
    }

    postEvent(eType: any, btn: any, left: any, top: any, modifier: any): void {
        enqueueImpersonatedDropEvent(this.inputValues.area, left, top,
            this.inputValues.subType, ensureOS(this.inputValues.fileName));
    }

    toLogString(): string {
        return "FileChoiceEvent: " + cdlify(this.inputValues.fileName);
    }
}

//
// this class implements a test-ndoe that injects key events.
// KeyDown and KeyUp deal with keys, e.g. arrows, tab, escape, enter, backspace
// etc, while KeyPress takes a string (usually of length 1) of text that
// was supposedly keyed in by the end-user
// 
class KeyEventTest extends TestNode {
    inputs: {
        eType: any;
        key: any;
        eChar: any;
        modifier: any;
    };
    inputValues: {
        eType: any;
        key: any;
        eChar: any;
        modifier: any;
    };

    constructor(scheduleStep: number, eType: any, key: any, eChar: any, modifier: any) {
        super(scheduleStep);
        this.inputs = {
            eType: eType,
            key: key,
            eChar: eChar,
            modifier: modifier
        };
    }

    performTest(): boolean {
        var eType = this.inputValues.eType;
        var key = this.inputValues.key;
        var eChar = this.inputValues.eChar;
        var modifier = this.inputValues.modifier;

        if (typeof(modifier) === "undefined") {
            modifier = [];
        }
        if (typeof(modifier) === "string") {
            modifier = [modifier];
        }

        enqueueImpersonatedKeyEvent(eType, key, eChar, modifier);

        return true;
    }

    toLogString(): string {
        var eType = this.inputValues.eType;
        var key = this.inputValues.key;
        var eChar = this.inputValues.eChar;
        var modifier = this.inputValues.modifier;

        return "KeyEvent " + eType +
            ": key=" + key +
            ", char=" + eChar +
            ", mod:" + String(modifier);
    }
}

//
// this class records a value in an a/v ('gTestStore'), usually to allow
//  comparing it with some future value, verifying that two values from
//  different time-points abide by the expected relation (e.g. the first
//  area-reference should remain the same after toggling sort-direction twice)
//
class TestStoreRecord extends TestNode {
    inputs: {
        label: any;
        value: any;
    };
    inputValues: {
        label: any;
        value: any;
    };

    constructor(scheduleStep: number, label: any, value: any) {
        super(scheduleStep);
        this.inputs = {
            label: label,
            value: value
        };
    }

    performTest(): boolean {
        var label: any = this.inputValues.label;
        var value: any = this.inputValues.value;

        if (typeof(label) === "string") {
            EFTestStore.updateLabel(label, value);
            return true;
        } else {
            console.log("TestStoreRecord: label value is not a string");
            return false;
        }
    }

    toLogString(): string {
        var label: any = this.inputValues.label;
        var value: any = this.inputValues.value;

        return "TestStoreRecord label=" + label + " value=" + String(value);
    }
}

//
// this class enters the debugger if the debug-value evaluates to true
//
class TestDebugger extends TestNode {
    inputs: {
        debugVal: any;
    };
    inputValues: {
        debugVal: any;
    };

    constructor(scheduleStep: number, debugVal: any) {
        super(scheduleStep);
        this.inputs = {
            debugVal: debugVal
        };
    }

    performTest(): boolean {
        var debugVal: any = this.inputValues.debugVal;

        if ((!! debugVal) === true) {
            breakIntoDebugger();
        }

        // always succeeds
        return true;
    }

    toLogString(): string {
        var debugVal: any = this.inputValues.debugVal;

        return "TestDebugger debugVal=" + String(debugVal);
    }
}

//
// this test-node allows modifying the internal state of a text-input element.
// It can modify any of the 'value', 'selectionStart', 'selectionEnd' and
//  'selectionDirection'.
// The test-node operates on the text-input element  associated with the
//  area having focus; if the focus area does not have an active input-element,
//  the test-node returns failure.
// The mopdification is carried out by calling
//   'display.setInputState(<attr>, <value>)'
class TextInputTest extends TestNode {
    inputs: {
        textInputObj: any;
    };
    inputValues: {
        textInputObj: any;
    };

    constructor(scheduleStep: number, textInputObj: any) {
        super(scheduleStep);
        this.inputs = {
            textInputObj: textInputObj
        };
    }

    performTest(): boolean {
        var textInputObj = this.inputValues.textInputObj;
        var value = textInputObj.value;
        var selectionStart = textInputObj.selectionStart;
        var selectionEnd = textInputObj.selectionEnd;
        var selectionDirection = textInputObj.selectionDirection;

        var area: DisplayArea = TestNode.getFocusArea();

        if (typeof(area) === "undefined") {
            Utilities.warn("TextInputTest: could not identify focus area");
            return false;
        }

        if ((!area.display) || (! area.display.hasActiveInputElement) ||
            (! area.display.hasActiveInputElement())) {
            Utilities.warn("TextInputTest: " +
                           "focus area does not have an active input element");
            return false;
        }

        var display: Display = area.display;

        if (typeof(value) !== "undefined") {
            display.setInputState("value", value);
        }

        if (typeof(selectionStart) !== "undefined") {
            display.setInputState("selectionStart", selectionStart);
        }
        if (typeof(selectionEnd) !== "undefined") {
            display.setInputState("selectionEnd", selectionEnd);
        }
        if (typeof(selectionDirection) !== "undefined") {
            display.setInputState("selectionDirection", selectionDirection);
        }

        return true;
    }

    toLogString(): string {
        var textInputObj = this.inputValues.textInputObj;
        var value = textInputObj.value;
        var selectionStart = textInputObj.selectionStart;
        var selectionEnd = textInputObj.selectionEnd;
        var selectionDirection = textInputObj.selectionDirection;

        var logStr: string = "TextInput:";

        if (typeof(value) === "string") {
            logStr += (" value = '" + value + "'");
        }

        if ((typeof(selectionStart) === "string") ||
            (typeof(selectionStart) === "number")) {
            logStr += (" selectionStart = '" + selectionStart + "'");
        }

        if ((typeof(selectionEnd) === "string") ||
            (typeof(selectionEnd) === "number")) {
            logStr += (" selectionEnd = '" + selectionEnd + "'");
        }

        if (typeof(selectionDirection) === "string") {
            logStr += (" selectionDirection = '" + selectionDirection + "'");
        }

        return logStr;
    }
}

//
// This test-node allows focusing or blurring an area; if the 'area' argument
//  does not refer to exactly one area, the test fails.
// No verifications that the blurred area was previously focused, or that the
//  focused area actually received focus, are done.
class FocusTest extends TestNode {
    inputs: {
        area: any;
        focusBlur: any;
    };
    inputValues: {
        area: any;
        focusBlur: any;
    };

    constructor(scheduleStep: number, focusBlur: any, area: any) {
        super(scheduleStep);
        this.inputs = {
            focusBlur: focusBlur,
            area: area
        };
    }

    performTest(): boolean {
        var focusBlur = this.inputValues.focusBlur;
        var area = TestNode.getSingleArea("FocusTest", this.inputValues.area);

        if (typeof(focusBlur) !== "boolean") {
            Utilities.warn("FocusTest: focus/blur is not a boolean");
            return false;
        }

        if (typeof(area) === "undefined") {
            return false;
        }

        if (focusBlur) {
            area.takeFocus();
        } else {
            area.releaseFocus();
        }

        return true;
    }

    toLogString(): string {
        var focusBlur = this.inputValues.focusBlur;
        var areaStr = TestNode.getSingleAreaStr(this.inputValues.area);
        var focusBlurStr: string = focusBlur === true? "focus": focusBlur === false? "blur": "???";

        return "FocusTest: " + focusBlurStr + " area=" + areaStr;
    }
}

//
// an if/then/else test-node
//
class IfThenElseTest extends TestNode {
    inputs: {
        ifClause: any;
    };
    inputValues: {
        ifClause: any;
    };
    thenBlock: TestNode[];
    elseBlock: TestNode[];

    constructor(scheduleStep: number, ifClause: any, thenBlock: any, elseBlock: any) {
        super(scheduleStep);
        this.inputs = {
            ifClause: ifClause
        };
        this.thenBlock = thenBlock;
        this.elseBlock = elseBlock;
    }

    //
    // performTest immediately evaluates 'ifClause', and pushes either
    //  the 'thenBlock' or the 'elseBlock' within a serial test-block-mgr
    //  accordingly
    performTest(): boolean {
        var testList: TestNode[];
        var blockMgr: TestBlockMgr;

        if (isTrue(this.inputValues.ifClause)) {
            testList = this.thenBlock;
        } else {
            testList = this.elseBlock;
        }

        blockMgr = new SerialTestBlockMgr(testList);
        this.testRunner.pushBlockMgr(blockMgr);

        return true;
    }

    toLogString(): string {
        var ifStr = String(this.inputValues.ifClause);

        return "IfThenElseTest: if (" + ifStr + ") ...";
    }
}

//
// an if/then/else test-node
//
class SwitchTest extends TestNode {
    inputs: {
        switchArg: any;
    };
    inputValues: {
        switchArg: any;
    };
    cases: {[tag: string]: TestNode[]};

    constructor(scheduleStep: number, switchArg: any, cases: {[tag: string]: TestNode[]}) {
        super(scheduleStep);
        this.inputs = {
            switchArg: switchArg
        };
        this.cases = cases;
    }

    //
    // performTest immediately evaluates 'ifClause', and pushes either
    //  the 'thenBlock' or the 'elseBlock' within a serial test-block-mgr
    //  accordingly
    performTest(): boolean {
        var switchValue: any = this.inputValues.switchArg;
        var testList: TestNode[];

        if (switchValue in this.cases) {
            testList = this.cases[switchValue];
        } else {
            testList = this.cases["default"];
        }
        if (testList !== undefined) {
            var blockMgr: TestBlockMgr = new SerialTestBlockMgr(testList);
            this.testRunner.pushBlockMgr(blockMgr);
        }
        return true;
    }

    toLogString(): string {
        var switchValue: string = String(this.inputValues.switchArg);

        return "switch (" + switchValue + ") ...";
    }
}

//
// a 'repeat' element - repeat a block of test-elements for a number of times
//  which is evaluated once at the entrance to the 'repeat' element
//
class RepeatTest extends TestNode {
    inputs: {
        repeatClause: any;
    };
    inputValues: {
        repeatClause: any;
    };
    doBlock: TestNode[];

    constructor(scheduleStep: number, repeatClause: any, doBlock: any) {
        super(scheduleStep);
        this.inputs = {
            repeatClause: repeatClause
        };
        this.doBlock = doBlock;
    }

    performTest(): boolean {
        var repeatCount: number = this.inputValues.repeatClause;
        var repeatedDoBlock: TestNode[] = [];

        assert(!isNaN(repeatCount), "repeat count is a number");
        for (var i = 0; i < repeatCount; i++) {
            repeatedDoBlock = cconcat(repeatedDoBlock, this.doBlock);
        }
        this.testRunner.pushBlockMgr(new SerialTestBlockMgr(repeatedDoBlock));
        return true;
    }

    toLogString(): string {
        var repeatStr = String(this.inputValues.repeatClause);
        return "RepeatTest: repeat=" + repeatStr + " do {...}";
    }
}
