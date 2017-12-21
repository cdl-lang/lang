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

/// <reference path="utilities.ts" />

//
// This file implements compilation and code-generation for automatic tests.
//
// An automatic test ('script') is an o/s of test-elements.
// The test language is imperative: the test-elements are executed one after
//  the other. The test starts executing after a configuration has completed
//  loading; after each test-element, the system is given a chance to fully
//  stabilize, in case the test-element had changed somethin that affects the
//  system.
//
// Test-elements generally have a flat a/v form. The values attached to these
//  a/v's are usually cdl expression; however, the test-element itself must be
//  provided explicitly in the test script.
//  For example, given
//        ScreenArea: { context: { x: true } }
//    one may use this test-element:
//
//    var test = o(
//        ...
//        { assert: [{ x:_}, <screenArea>] },
//       ...
//    )
//
// However, given
//        ScreenArea: { context: { x: { assert: true } } }
//
//  one may **Not** use this:
//
//    var test = o(
//        ...
//        [{x:_}, <screenArea>],
//       ...
//    )
//
//
// The main vehicle for verifying the correct behavior of a test is the
//   'assert' test-element, which fails the test if the 'assert:' value is
//   falsey.
// Other test elements allow affecting the mouse (position and button-events)
//  key-events and textInput.
// The test environment has its own associative memory array, which can be
//  written to using the
//      { store: <cdl-expression>, into: <memory label string> }
//  test-element;
// Reading this memory is made possible using the *cdl* function '[testStore]',
//  which returns the complete associative array, and can be queried for
//  individual elements, e.g.
//
// var test = o(
//   { store: 5, into: "xxx" },
//   { assert: [equal, 5, [{xxx:_}, [testStore]]] }
// )
//
//
// More information is available in the gDoc 'Test Environment' (aka
//   'Testing Environment')
//
//
// Each Test-Element type has its own class, which derives 'TestElement'.
// The first task a test-element class serves is to identify test-element
//   instances that belong to it. This is usually done by testing for the
//   'required' attributes in the test-element.
// 'testElementTypeList' is a list of all the available test-element types,
//   and the static boolean method 'detect' is called for the different types
//   successively until one identifies the test-element instance as its own,
//   or otherwise an error is signalled.
//
// Next, the 'compile' method is called, which should draw from the test-element
//  instance any required information.
//
// The method 'cache' is called after all test-elements were compiled, and
//   replaces each test-element with an analogous test-element whose
//   function-nodes are properly pooled/cached.
//
// Finally, the method 'genTestStr' emits the code that would be used by the
//   test-runner to actually execute the test.
//
//
// Using the flow-control test-elements ('if/then/else', 'while' etc) introduces
//  a nested structure. For example, the 'then:' part of an 'if/then/else'
//  contains its own o/s of test-element instances.
//  Compilation/caching/code-gen are done recursively, and the generated code
//   instantiates the nested test-list elements within the call to the
//   constructor of the hierarchic element, e.g.
//
//  new IfThenElseTest(<if-cdl-expr (fnref)>,
//                 [
//                    new ThenElement1(...),
//                    new ThenElement2(...),
//                    ...
//                 ],
//                 [
//                    new ElseElement1(...),
//                    new ElseElement2(...),
//                    ...
//                 ]
//   )
//
//
//
// The code below is rather regular (i.e. low on information), and could
//   probably have been coded more frugally by describing the attributes, and
//   handling centrally those that are either a test-sequence (TestElement[])
//   or a FunctionNode.
//


//
// base class for test-elements;
//
class TestElement {

    // how much to increase indent on nesting
    static indentIncrement: string = "  ";

    /**
     * The scheduling step for the test node, which is 1 step after the latest
     * scheduled input (0 if all are constant).
     */
    scheduleStep: number;

    constructor() { }

    // compile/detect/genTestStr/cache - the abstract methods that must be
    //  implemented by each derived class

    // draw required information from the test-script into this
    //  test-element instance
    compile(test: any): void {
        Utilities.error("implement in a derived cass");
        return;
    }

    // is this test-element instance of my type?
    static detect(test: any): boolean {
        Utilities.error("implement in a derived class");
        return false;
    }

    // generate run-time code from this test-element
    genTestStr(indent: string, dumpMode: boolean): string {
        Utilities.error("implement in a derived class");
        return undefined;
    }

    /**
     * Replace this instance with an identical one, except that all function
     * nodes are references to function nodes pooled in the appropriate cache.
     * A TestElement will always have priority 0.
     */
    cache(): TestElement {
        var cachedElement: TestElement = this.cacheFunctionNodes();

        cachedElement.scheduleStep = cachedElement.functionNodes().
            reduce(function(max: number, fn: FunctionNode): number {
                return !(fn instanceof FunctionNode) || fn.prio === 1 || fn.scheduleStep < max?
                       max: fn.scheduleStep;
            }, -1) + 1;
        return cachedElement;
    }

    cacheFunctionNodes(): TestElement {
        throw "Implement in derived class";
    }

    // returns list of function nodes used in this test element
    functionNodes(): FunctionNode[] {
        Utilities.error("implement in a derived class");
        return undefined;
    }

    // create and return a function node for a cdl-expression
    static getFN(cdlExp: any): any {
        var expr: Expression;
        var fn: FunctionNode;
        var type: string = typeof(cdlExp);

        if (type === "number" || type === "string") {
            return cdlExp;
        }
        expr = expressionStore.get(cdlExp, undefined);
        fn = buildSimpleFunctionNode(expr, undefined, undefined, 0, true,
                                    undefined, undefined, undefined, undefined);
        assert(typeof(fn) !== "undefined",
               "expression should not be undefined");
        assert(!fn.localToDefun,
               "expression '" + JSON.stringify(cdlExp) +
               "'must not be local to area");
        assert(!fn.localToDefun,
               "expression '" + JSON.stringify(cdlExp) +
               "' must not be local to defun");
        return fn;
    }

    // create and return a list of test-elements for the given o/s of
    //  test-elements
    static getSequence(testElemOS: any, seq: TestElement[] = undefined):
        TestElement[]
    {
        if (seq === undefined) {
            seq = [];
        }
        if (typeof(testElemOS) === "object" &&
              typeof(testElemOS.typeName) === "function" &&
              testElemOS.typeName() === "orderedSet") {
            for (var i = 0; i < testElemOS.os.length; i++) {
                var e: any = testElemOS.os[i];
                TestElement.getSequence(e, seq);
            }
        } else if (typeof(testElemOS) !== "undefined") {
            // only a single test-element here
            seq.push(buildTestElement(testElemOS));
        }

        return seq;
    }

    // return a cached variant of the given function-node
    static cacheFN(fn: any): FunctionNode {
        return fn instanceof FunctionNode? FunctionNode.cache(fn, {}, true): fn;
    }

    // return an equivalent sequence of the elements, except that the
    //  function-nodes in it are all from the cache
    static cacheSeq(seq: TestElement[]): TestElement[] {
        var cachedSeq: TestElement[] = [];

        for (var i = 0; i < seq.length; i++) {
            var e: TestElement = seq[i];
            cachedSeq.push(e.cache());
        }

        return cachedSeq;
    }

    static functionNodeSeq(... seq: TestElement[][]): FunctionNode[] {
        var functionNodes: FunctionNode[] = [];

        for (var i: number = 0; i < seq.length; i++) {
            for (var j: number = 0; j < seq[i].length; j++) {
                functionNodes = cconcat(functionNodes, seq[i][j].functionNodes());
            }
        }
        return functionNodes;
    }

    // generate a string with the run-time code to initialize the
    //  given test-element sequence
    static genTestSequenceStr(seq: TestElement[], indent: string, dumpMode: boolean): string {
        var strList: string[] = [];

        for (var i = 0; i < seq.length; i++) {
            var elemStr: string;
            elemStr = seq[i].genTestStr(indent, dumpMode);
            strList.push(i === 0? elemStr: indent + elemStr);
        }
        return strList.join(",\n");
    }

    // return the string representing the given function node
    //  (an fnRef)
    static getFNStr(fn: any, dumpMode: boolean): string {
        return !(fn instanceof FunctionNode)? JSON.stringify(fn):
               dumpMode? fn.idStr(): fn.idExpStr(undefined);
    }
}

//
// generate a log message
//
// { log: <string>
//
class LogTestElement extends TestElement {
    logArg: FunctionNode;

    compile(test: any): void {
        this.logArg = TestElement.getFN(test.log);
    }

    static detect(test: any): boolean {
        return ("log" in test);
    }

    cacheFunctionNodes(): LogTestElement {
        var cachedElem: LogTestElement = new LogTestElement();

        cachedElem.logArg = TestElement.cacheFN(this.logArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.logArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var logStr: string = TestElement.getFNStr(this.logArg, dumpMode);

        return "new LogTest(" + this.scheduleStep + ", " + logStr + ")";
    }
}

//
// start/stop/suspend/resume a timer
//
// { timer: <timer-id>, action: "start/stop/suspend/resume" }
//
class TimerTestElement extends TestElement {
    timerArg: FunctionNode;
    actionArg: FunctionNode;

    compile(test: any): void {
        this.timerArg = TestElement.getFN(test.timer);
        this.actionArg = TestElement.getFN(test.action);
    }

    static detect(test: any): boolean {
        return ("timer" in test);
    }

    cacheFunctionNodes(): TimerTestElement {
        var cachedElem: TimerTestElement = new TimerTestElement();

        cachedElem.timerArg = TestElement.cacheFN(this.timerArg);
        cachedElem.actionArg = TestElement.cacheFN(this.actionArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.timerArg, this.actionArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var timerStr = TestElement.getFNStr(this.timerArg, dumpMode);
        var actionStr = TestElement.getFNStr(this.actionArg, dumpMode);

        return "new TimerTest(" + this.scheduleStep + ", " + timerStr + ", " + actionStr + ")";
    }
}

/**
 * 
 * 
 * @class LogInternalActionsElement
 * @extends {TestElement}
 */
class LogInternalActionsElement extends TestElement {
    logInternalActionsArg: FunctionNode;

    compile(test: any): void {
        this.logInternalActionsArg = TestElement.getFN(test.logInternalActions);
    }

    static detect(test: any): boolean {
        return typeof(test) === "object" && "logInternalActions" in test;
    }

    cacheFunctionNodes(): LogInternalActionsElement {
        var cachedElem: LogInternalActionsElement = new LogInternalActionsElement();

        cachedElem.logInternalActionsArg = TestElement.cacheFN(this.logInternalActionsArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.logInternalActionsArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var logInternalActionsArg = TestElement.getFNStr(this.logInternalActionsArg, dumpMode);

        return "new LogInternalActions(" + this.scheduleStep + ", " + logInternalActionsArg + ")";
    }
}

//
// pause the application in real time
//
// { sleep: <time in ms> }
//
class SleepTestElement extends TestElement {
    sleepArg: FunctionNode;

    compile(test: any): void {
        this.sleepArg = TestElement.getFN(test.sleep);
    }

    static detect(test: any): boolean {
        return typeof(test) === "object" && "sleep" in test;
    }

    cacheFunctionNodes(): SleepTestElement {
        var cachedElem: SleepTestElement = new SleepTestElement();

        cachedElem.sleepArg = TestElement.cacheFN(this.sleepArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.sleepArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var sleepStr = TestElement.getFNStr(this.sleepArg, dumpMode);

        return "new SleepTest(" + this.scheduleStep + ", " + sleepStr + ")";
    }
}

//
// assert
//
// { assert: <boolean expression>, comment: <message> }
//
class AssertTestElement extends TestElement {
    assertArg: FunctionNode;
    commentArg: FunctionNode;

    compile(test: any): void {
        this.assertArg = TestElement.getFN(test.assert);
        this.commentArg = TestElement.getFN(test.comment);
    }

    static detect(test: any): boolean {
        return ("assert" in test);
    }

    cacheFunctionNodes(): AssertTestElement {
        var cachedElem: AssertTestElement = new AssertTestElement();

        cachedElem.assertArg = TestElement.cacheFN(this.assertArg);
        cachedElem.commentArg = TestElement.cacheFN(this.commentArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.assertArg, this.commentArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var assertStr = TestElement.getFNStr(this.assertArg, dumpMode);
        var commentStr = TestElement.getFNStr(this.commentArg, dumpMode);

        return "new AssertTest(" + this.scheduleStep + ", " + assertStr + ", " + commentStr + ")";
    }
}

//
// store into test memory
//
// { store: <value>, into: <memory label> }
//
class StoreTestElement extends TestElement {
    storeArg: FunctionNode;
    intoArg: FunctionNode;

    compile(test: any): any {
        this.storeArg = TestElement.getFN(test.store);
        this.intoArg = TestElement.getFN(test.into);
    }

    static detect(test: any): boolean {
        return (("store" in test) && ("into" in test));
    }

    cacheFunctionNodes(): StoreTestElement {
        var cachedElem: StoreTestElement = new StoreTestElement();

        cachedElem.storeArg = TestElement.cacheFN(this.storeArg);
        cachedElem.intoArg = TestElement.cacheFN(this.intoArg);

        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.storeArg, this.intoArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var storeStr: string = TestElement.getFNStr(this.storeArg, dumpMode);
        var intoStr: string = TestElement.getFNStr(this.intoArg, dumpMode);

        return "new TestStoreRecord(" + this.scheduleStep + ", " + intoStr + ", " + storeStr + ")";
    }
}

//
// debugger - enter debugger if the argument evaluates to true
//
// { debugger: <boolean expression> }
//
class DebuggerTestElement extends TestElement {
    debuggerArg: FunctionNode;

    compile(test: any): void {
        this.debuggerArg = TestElement.getFN(test["debugger"]);
    }

    static detect(test: any) {
        return ("debugger" in test);
    }

    cacheFunctionNodes(): DebuggerTestElement {
        var cachedElem: DebuggerTestElement = new DebuggerTestElement();

        cachedElem.debuggerArg = TestElement.cacheFN(this.debuggerArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.debuggerArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var debuggerStr: string = TestElement.getFNStr(this.debuggerArg, dumpMode);

        return "new TestDebugger(" + this.scheduleStep + ", " + debuggerStr + ")";
    }
}

//
// mouse event
//
// {
//        MouseUp/MouseDown/MouseMove/MouseClick/MouseDoubleClick: <mouse-button>,
//        area: <area exp>,
//        x: <0 is area.left, 1 is area.right>,
//        y: <0 is area.top, 1 is area.bottom>,
//        modifier: <o/s of keyboard modifiers, e.g. 'shift'>
// }
//
class MouseTestElement extends TestElement {
    mouseOp: string;
    mouseButton: FunctionNode;
    areaArg: FunctionNode;
    xArg: FunctionNode;
    yArg: FunctionNode;
    modifierArg: FunctionNode;

    compile(test: any): void {
        var typeList = ["MouseDown", "MouseUp", "MouseMove", "MouseClick",
                        "MouseDoubleClick", "MouseClickExpired",
                        "MouseDoubleClickExpired"];
        for (var i = 0; i < typeList.length; i++) {
            if (typeList[i] in test) {
                this.mouseOp = typeList[i];
                this.mouseButton = TestElement.getFN(test[typeList[i]]);
                break;
            }
        }

        this.areaArg = TestElement.getFN(test.area);
        this.xArg = TestElement.getFN(test.x);
        this.yArg = TestElement.getFN(test.y);
        this.modifierArg = TestElement.getFN(test.modifier);
    }

    static detect(test: any): boolean {
        return ("MouseDown" in test || "MouseUp" in test ||
                "MouseMove" in test || "MouseClick" in test ||
                "MouseClickExpired" in test || "MouseDoubleClick" in test ||
                "MouseDoubleClickExpired" in test) &&
               "area" in test;
    }

    cacheFunctionNodes(): MouseTestElement {
        var cachedElem: MouseTestElement = new MouseTestElement();

        cachedElem.mouseOp = this.mouseOp;
        cachedElem.mouseButton = TestElement.cacheFN(this.mouseButton);
        cachedElem.areaArg = TestElement.cacheFN(this.areaArg);
        cachedElem.xArg = TestElement.cacheFN(this.xArg);
        cachedElem.yArg = TestElement.cacheFN(this.yArg);
        cachedElem.modifierArg = TestElement.cacheFN(this.modifierArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.mouseButton, this.areaArg, this.xArg, this.yArg, this.modifierArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var mouseButtonStr: string = TestElement.getFNStr(this.mouseButton, dumpMode);
        var areaStr: string = TestElement.getFNStr(this.areaArg, dumpMode);
        var xStr: string = TestElement.getFNStr(this.xArg, dumpMode);
        var yStr: string = TestElement.getFNStr(this.yArg, dumpMode);
        var modifierStr = TestElement.getFNStr(this.modifierArg, dumpMode);

        return "new AreaRelativeMouseEventTest(" + this.scheduleStep +
               ', "' + this.mouseOp + '"' + ", " +
               mouseButtonStr + ", " +
               areaStr+ ", " +
               xStr + ", " +
               yStr + ", " +
               modifierStr + ")";
    }
}

//
// key event
//
// {
//   KeyUp/KeyDown/KeyPress: <key/char>,
//   modifier: <o/s of keyboard modifiers>
// }
//
// note that these events do not affect text-input element (at least not in
//   node.js environment), use textInput test-element for that
//
class KeyTestElement extends TestElement {
    keyOpType: string;
    keyArg: FunctionNode;
    modifierArg: FunctionNode;
    charArg: FunctionNode;

    compile(test: any): void {
        if (("KeyDown" in test) || ("KeyUp" in test)) {
            this.keyOpType = ("KeyDown" in test) ? "KeyDown" : "KeyUp";
            this.keyArg = TestElement.getFN(test[this.keyOpType]);
        } else {
            assert("KeyPress" in test, "internal error in KeyTestElement");
            this.keyOpType = "KeyPress";
            this.charArg = TestElement.getFN(test["KeyPress"]);
        }
        this.modifierArg = TestElement.getFN(test.modifier);
    }

    static detect(test: any): boolean {
        return (
            ("KeyDown" in test) ||
                ("KeyUp" in test) ||
                ("KeyPress" in test)
        );
    }

    cacheFunctionNodes(): KeyTestElement {
        var cachedElem: KeyTestElement = new KeyTestElement();

        cachedElem.keyOpType = this.keyOpType;
        cachedElem.keyArg = TestElement.cacheFN(this.keyArg);
        cachedElem.charArg = TestElement.cacheFN(this.charArg);
        cachedElem.modifierArg = TestElement.cacheFN(this.modifierArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.keyArg, this.charArg, this.modifierArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var keyStr: string;
        var charStr: string;
        if (this.keyOpType === "KeyPress") {
            keyStr = charStr = TestElement.getFNStr(this.charArg, dumpMode);
        } else {
            charStr = "undefined";
            keyStr = TestElement.getFNStr(this.keyArg, dumpMode);
        }

        var modifierStr: string = TestElement.getFNStr(this.modifierArg, dumpMode);

        return "new KeyEventTest(" + this.scheduleStep + ", " +
               '"' + this.keyOpType + '"' + ", " +
               keyStr + ", " +
               charStr + ", " +
               modifierStr + ")";
    }
}

//
// file choice event
//
// {
//   FileChoice: filename,
//   area: x: y: as in mouse events
// }
//
class FileChoiceTestElement extends TestElement {
    fileNameArg: FunctionNode;
    subTypeArg: FunctionNode;
    areaArg: FunctionNode;
    xArg: FunctionNode;
    yArg: FunctionNode;

    compile(test: any): void {
        this.fileNameArg = TestElement.getFN(test.FileChoice);
        this.subTypeArg = TestElement.getFN(test.subType);
        this.areaArg = TestElement.getFN(test.area);
        this.xArg = TestElement.getFN(test.x);
        this.yArg = TestElement.getFN(test.y);
    }

    static detect(test: any): boolean {
        return "FileChoice" in test;
    }

    cacheFunctionNodes(): FileChoiceTestElement {
        var cachedElem: FileChoiceTestElement = new FileChoiceTestElement();

        cachedElem.fileNameArg = TestElement.cacheFN(this.fileNameArg);
        cachedElem.subTypeArg = TestElement.cacheFN(this.subTypeArg);
        cachedElem.areaArg = TestElement.cacheFN(this.areaArg);
        cachedElem.xArg = TestElement.cacheFN(this.xArg);
        cachedElem.yArg = TestElement.cacheFN(this.yArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.fileNameArg, this.subTypeArg, this.areaArg, this.xArg, this.yArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        return "new FileChoiceEventTest(" + this.scheduleStep + ", " +
               TestElement.getFNStr(this.fileNameArg, dumpMode) + ", " +
               TestElement.getFNStr(this.subTypeArg, dumpMode) + ", " +
               TestElement.getFNStr(this.areaArg, dumpMode) + ", " +
               TestElement.getFNStr(this.xArg, dumpMode) + ", " + 
               TestElement.getFNStr(this.yArg, dumpMode) + ")";
    }
}

//
// textInput - set the value of the text-input element in the focus area
//
// {
//   textInput: {
//     value: <string>,
//     selectionStart: <offset>,
//     selectionEnd: <offset>,
//     selectionDirection: "forward"/"backward"
//   }
// }
//
class TextInputTestElement extends TestElement {
    textInputArg: FunctionNode;
    selectionStartArg: FunctionNode;
    selectionEndArg: FunctionNode;
    selectionDirectionArg: FunctionNode;

    compile(test: any): void {
        this.textInputArg = TestElement.getFN(test.textInput);
    }

    static detect(test: any): boolean {
        return ("textInput" in test);
    }

    cacheFunctionNodes(): TextInputTestElement {
        var cachedElem: TextInputTestElement = new TextInputTestElement();

        cachedElem.textInputArg = TestElement.cacheFN(this.textInputArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.textInputArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var textInputStr: string = TestElement.getFNStr(this.textInputArg, dumpMode);

        return "new TextInputTest(" + this.scheduleStep + ", " + textInputStr + ")";
    }
}

//
// focus/blur
//
// request the named area to be given focus / request the focused area to
//  yield focus
//
// { focus/blue: <area> }
//
class FocusBlurTestElement extends TestElement {
    isFocus: boolean;
    areaArg: FunctionNode;

    compile(test: any): void {
        this.isFocus = ("focus" in test);
        this.areaArg = TestElement.getFN(this.isFocus ? test.focus : test.blur);
    }

    static detect(test: any): boolean {
        return (("blur" in test) || ("focus" in test));
    }

    cacheFunctionNodes(): FocusBlurTestElement {
        var cachedElem: FocusBlurTestElement = new FocusBlurTestElement();

        cachedElem.isFocus = this.isFocus;
        cachedElem.areaArg = TestElement.cacheFN(this.areaArg);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.areaArg];
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var isFocusStr = String(this.isFocus);
        var areaStr = TestElement.getFNStr(this.areaArg, dumpMode);

        return "new FocusTest(" + this.scheduleStep + ", " + isFocusStr + ", " + areaStr + ")";
    }
}

//
// if/then/else
//
// executes the o/s of test-elements specified in 'then:' iff the 'if:'
//  condition evaluates to true, otherwise execute the optional o/s of
//  test-elements at 'else:'
//
// {
//    "if": <boolean expression>,
//    "then": <o/s of test elements> [,
//    "else": <o/s of test elements ]
//  }
// 
class IfThenElseTestElement extends TestElement {
    ifArg: FunctionNode;
    thenSeq: TestElement[];
    elseSeq: TestElement[];

    compile(test: any): void {
        this.ifArg = TestElement.getFN(test["if"]);
        this.thenSeq = TestElement.getSequence(test["then"]);
        this.elseSeq = TestElement.getSequence(test["else"]);
    }

    static detect(test: any): boolean {
        return (("if" in test) && ("then" in test));
    }

    cacheFunctionNodes(): IfThenElseTestElement {
        var cachedElem: IfThenElseTestElement = new IfThenElseTestElement();

        cachedElem.ifArg = TestElement.cacheFN(this.ifArg);
        cachedElem.thenSeq = TestElement.cacheSeq(this.thenSeq);
        cachedElem.elseSeq = TestElement.cacheSeq(this.elseSeq);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return [this.ifArg].concat(
                   TestElement.functionNodeSeq(this.thenSeq, this.elseSeq));
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var nextIndent = indent + TestElement.indentIncrement;
        var ifStr: string = TestElement.getFNStr(this.ifArg, dumpMode);
        var thenStr: string =
            TestElement.genTestSequenceStr(this.thenSeq, nextIndent, dumpMode);
        var elseStr: string =
            TestElement.genTestSequenceStr(this.elseSeq, nextIndent, dumpMode);

        var testStr =
            "new IfThenElseTest(" + this.scheduleStep + ", " + ifStr + ", [\n" +
                nextIndent + thenStr + "\n" +
            indent + "]";
        if (elseStr) {
            testStr += ", [\n" +
                    nextIndent + elseStr + "\n" +
                indent + "]";
        }
        testStr += ")";

        return testStr;
    }
}

//
// switch (expr) { case a: ..., case b: ... }
//
// executes the o/s of test-elements specified by the tag indicated by expr
//
// {
//    "switch": <string expression>,
//    "a": <o/s of test elements>,
//    "b": <o/s of test elements>,
//    ...
//    ["default": <o/s of test elements>]
//  }
// 
class SwitchTestElement extends TestElement {
    switchArg: FunctionNode;
    cases: {[tag: string]: TestElement[]} = {};

    compile(test: any): void {
        for (var tag in test) {
            if (tag === "switch") {
                this.switchArg = TestElement.getFN(test["switch"]);
            } else {
                this.cases[tag] = TestElement.getSequence(test[tag]);
            }
        }
    }

    static detect(test: any): boolean {
        return typeof(test) === "object" && "switch" in test;
    }

    cacheFunctionNodes(): SwitchTestElement {
        var cachedElem: SwitchTestElement = new SwitchTestElement();

        cachedElem.switchArg = TestElement.cacheFN(this.switchArg);
        for (var tag in this.cases) {
            cachedElem.cases[tag] = TestElement.cacheSeq(this.cases[tag]);
        }
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        var fns: FunctionNode[] = [this.switchArg];

        for (var tag in this.cases) {
            fns = cconcat(fns, TestElement.functionNodeSeq(this.cases[tag]));
        }
        return fns;
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var nextIndent = indent + TestElement.indentIncrement;
        var nextNextIndent = nextIndent + TestElement.indentIncrement;
        var switchArgStr: string = TestElement.getFNStr(this.switchArg, dumpMode);
        var casesStr: string = "";

        for (var tag in this.cases) {
            if (casesStr !== "")
                casesStr += ",";
            casesStr += "\n" + nextIndent + safeJSONStringify(tag) + ": [\n" +
                nextNextIndent + TestElement.genTestSequenceStr(this.cases[tag], nextNextIndent, dumpMode) + "\n" +
                nextIndent + "]";
        }

        var testStr: string =
            "new SwitchTest(" + this.scheduleStep + ", " + switchArgStr + ", {" +
                casesStr + "\n" +
            indent + "})";
        return testStr;
    }
}

//
// repeat test-element
//
// loop for 'repeat:' times the o/s of test-elements at 'do:'
//
// { repeat: <numeric expression>, do: <o/s of test elements> }
//
class RepeatTestElement extends TestElement {
    repeatArg: FunctionNode;
    doSeq: TestElement[];

    compile(test: any): void {
        this.repeatArg = TestElement.getFN(test.repeat);
        this.doSeq = TestElement.getSequence(test["do"]);
    }

    static detect(test: any): boolean {
        return typeof(test) === "object" && "repeat" in test && "do" in test;
    }

    cacheFunctionNodes(): RepeatTestElement {
        var cachedElem: RepeatTestElement = new RepeatTestElement();

        cachedElem.repeatArg = TestElement.cacheFN(this.repeatArg);
        cachedElem.doSeq = TestElement.cacheSeq(this.doSeq);
        return cachedElem;
    }

    functionNodes(): FunctionNode[] {
        return TestElement.functionNodeSeq(this.doSeq);
    }

    genTestStr(indent: string, dumpMode: boolean): string {
        var nextIndent = indent + TestElement.indentIncrement;
        var repeatStr: string = TestElement.getFNStr(this.repeatArg, dumpMode);
        var doStr: string =
            TestElement.genTestSequenceStr(this.doSeq, nextIndent, dumpMode);

        var testStr =
            "new RepeatTest(" + this.scheduleStep + ", " + repeatStr + ", [\n" +
                nextIndent + doStr + "\n" +
            indent + " ])";

        return testStr;
    }
}

var testElementTypeList: (typeof TestElement)[] = [
    LogTestElement,
    TimerTestElement,
    AssertTestElement,
    StoreTestElement,
    DebuggerTestElement,
    MouseTestElement,
    KeyTestElement,
    TextInputTestElement,
    FocusBlurTestElement,
    IfThenElseTestElement,
    RepeatTestElement,
    FileChoiceTestElement,
    SwitchTestElement,
    SleepTestElement,
    LogInternalActionsElement
];

//
// create a test-element instance by its description:
//  iterate the test-element types, and look for the first matching type, then
//  use it to construct a test-element
//
function buildTestElement(test: any): TestElement {
    for (var i = 0; i < testElementTypeList.length; i++) {
        var TestElementType = testElementTypeList[i];
        if (TestElementType.detect(test)) {
            var elem: TestElement = new TestElementType();
            elem.compile(test);
            return elem;
        }
    }

    Utilities.error("Unknown test element '" +
                    JSON.stringify(test) + "'");
    return undefined;
}
