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

/// <reference path="../evaluationNode.ts" />

function makePrototype(scheduleStep: number): FunctionNode {
    var prototype0 = new FunctionNode(0, 0, false, undefined);

    prototype0.prio = 0;
    prototype0.scheduleStep = scheduleStep;
    return prototype0;
}

class EvaluationStub extends EvaluationNode {
    constant: boolean = false;

    constructor(init: any) {
        super(makePrototype(0));
        this.result = new Result(init);
        if (init !== undefined) {
            this.inputHasChanged = true;
        }
    }

    isConstant(): boolean {
        return this.constant;
    }

    eval(): boolean {
        this.inputHasChanged = false;
        return true;
    }

    set(val: any): void {
        if (!objectEqual(this.result.value, val)) {
            this.result.value = val;
            this.inputHasChanged = true;
            evaluationQueue.schedule(this);
        }
    }
}

class InputManager {
    inputs: EvaluationStub[] = [];

    newStub(init: any): EvaluationStub {
        var stub: EvaluationStub = new EvaluationStub(init);

        this.inputs.push(stub);
        stub.init();
        stub.isBeingInitialized = false;
        return stub;
    }
}

class ResultWatcher implements Watcher {
    watcherId: number;
    results: {[id: string]: any} = {};

    constructor() {
        this.watcherId = nextWatcherId++;
    }

    updateInput(id: any, result: Result): void {
        this.results[String(id)] = result;
    }

    isActive(): boolean {
        return true;
    }
}

class NoMessageQueue extends EvaluationMessageQueue {
    empty(): boolean {
        return true;
    }
};

class NoTaskQueue extends TaskQueue {
    scheduleTask(task: TaskQueueTask, priority: number, executeAtOnce: boolean = false): void {
    }
}

evaluationQueue = new EvaluationQueue();
evaluationQueue.init(0, 1);
evaluationQueue.setGlobalMessageQueue(new NoMessageQueue(<StorageNode>makePrototype(0)));

globalTaskQueue = new NoTaskQueue();

globalPosConstraintSynchronizer = <PosConstraintSynchronizer>{
    isEmpty: function(): boolean {
        return true;
    }
}

function verifyResult(en: EvaluationNode, expected: any): void {
    assert(objectEqual(en.result.value, expected), "test fail");
}

function verifyActive(en: EvaluationNode, active: boolean): void {
    assert((active && en.nrActiveWatchers === 1) ||
           (!active && en.nrActiveWatchers === 0), "test fail");
}

function newEV(n: number, matchValues: SimpleValue[][]): EvaluationVariant {
    var quals: SingleQualifier[][] = [];
    var funs: FunctionNode[] = [];
    var qfn: QualifierFunctionNode;

    for (var i: number = 0; i < matchValues.length; i++) {
        var q: SingleQualifier[] = [];
        for (var j: number = 0; j < matchValues[i].length; j++) {
            q.push(undefined);
        }
        quals.push(q);
    }
    funs.length = n;
    qfn = new QualifierFunctionNode(quals, funs, 0, 0, false, undefined);
    qfn.prio = 0;
    qfn.scheduleStep = 1;
    return new EvaluationVariant(qfn);
}

function initEV(matchValues: SimpleValue[][], qInits: SimpleValue[][][], fInits: any[][], inputManager: InputManager): EvaluationVariant {
    var ev: EvaluationVariant = newEV(matchValues.length, matchValues);

    for (var i: number = 0; i < matchValues.length; i++) {
        var qs: {value: EvaluationNode; match: any;}[] = [];
        for (var j: number = 0; j < matchValues[i].length; j++) {
            qs.push({
                value: inputManager.newStub(qInits[i][j]),
                match: matchValues[i][j]
            });
        }
        ev.addQualifier(i, qs, inputManager.newStub(fInits[i]));
    }
    ev.init();
    ev.isBeingInitialized = false;
    return ev;
}

function updateAllInputs(ev: EvaluationVariant): void {
    for (var i: number = 0; i < ev.qualifierInputs.length; i++) {
        for (var j: number = 0; j < ev.qualifierInputs[i].length; j++) {
            ev.qualifierInputs[i][j].updateOutput();
        }
        ev.variantInputs[i].updateOutput();
    }
}

function setQ(ev: EvaluationVariant, i: number, j: number, val: any[]): void {
    (<EvaluationStub>ev.qualifierInputs[i][j]).set(val);
}

function setF(ev: EvaluationVariant, i: number, val: any[]): void {
    (<EvaluationStub>ev.variantInputs[i]).set(val);
}

// 1 qualifier/function node
function test1(): void {
    var inputManager: InputManager = new InputManager();
    var ev: EvaluationVariant = initEV([[1]], [[[0]]], [[{a:1}]], inputManager);
    var r: ResultWatcher = new ResultWatcher();

    ev.addWatcher(r, "test", false, true);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);

    setQ(ev, 0, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1}]);
    verifyActive(ev.variantInputs[0], true);

    setQ(ev, 0, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);
}

// 2 qualifiers/function nodes, both mergeable
function test2(): void {
    var inputManager: InputManager = new InputManager();
    var ev: EvaluationVariant = initEV([[1],[1]], [[[0]],[[0]]], [[{a:1}],[{b:2}]], inputManager);
    var r: ResultWatcher = new ResultWatcher();

    ev.addWatcher(r, "test", false, true);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);

    setQ(ev, 0, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1}]);
    verifyActive(ev.variantInputs[0], true);

    setQ(ev, 0, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);

    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{b:2}]);
    verifyActive(ev.variantInputs[1], true);

    setQ(ev, 1, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[1], false);

    setQ(ev, 0, 0, [1]);
    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1,b:2}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);

    setQ(ev, 0, 0, [0]);
    setQ(ev, 1, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.variantInputs[1], false);

    // Verify deactivation/reactivation
    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{b:2}]);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.variantInputs[1], true);
    ev.deactivate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyActive(ev.qualifierInputs[0][0], false);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.qualifierInputs[1][0], false);
    verifyActive(ev.variantInputs[1], false);
    ev.activate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{b:2}]);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.variantInputs[1], true);
}

// 2 variants, first qualifier always true
function test3(): void {
    var inputManager: InputManager = new InputManager();
    var ev: EvaluationVariant = initEV([[],[1]], [[],[[0]]], [[{a:1}],[{b:2}]], inputManager);
    var r: ResultWatcher = new ResultWatcher();

    ev.addWatcher(r, "test", false, true);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], false);

    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1,b:2}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);

    setQ(ev, 1, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], false);

    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1,b:2}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);

    setQ(ev, 1, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], false);

    // Verify deactivation/reactivation
    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1,b:2}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);
    ev.deactivate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.qualifierInputs[1][0], false);
    verifyActive(ev.variantInputs[1], false);
    ev.activate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a:1,b:2}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);
}

// 2 variants, first unmergeable
function test4(): void {
    var inputManager: InputManager = new InputManager();
    var ev: EvaluationVariant = initEV([[1],[1]], [[[0]],[[0]]], [[1],[{b:2}]], inputManager);
    var r: ResultWatcher = new ResultWatcher();

    ev.addWatcher(r, "test", false, true);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);

    setQ(ev, 0, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [1]);
    verifyActive(ev.variantInputs[0], true);

    setQ(ev, 0, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);

    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{b:2}]);
    verifyActive(ev.variantInputs[1], true);

    setQ(ev, 1, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[1], false);

    setQ(ev, 0, 0, [1]);
    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [1]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], false);

    setQ(ev, 0, 0, [0]);
    setQ(ev, 1, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.variantInputs[1], false);

    // Verify deactivation/reactivation
    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{b:2}]);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.variantInputs[1], true);
    ev.deactivate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyActive(ev.qualifierInputs[0][0], false);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.qualifierInputs[1][0], false);
    verifyActive(ev.variantInputs[1], false);
    ev.activate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{b:2}]);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.variantInputs[1], true);

    setQ(ev, 0, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [1]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], false);

    setF(ev, 1, [{b: 3}]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [1]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], false);

    // Make first result mergeable
    setQ(ev, 0, 0, [1]);
    setF(ev, 0, [{a: 1}]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a: 1, b: 3}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);
}

// 3 variants, middle one unmergeable
function test5(): void {
    var inputManager: InputManager = new InputManager();
    var ev: EvaluationVariant = initEV([[1],[1],[1]], [[[0]],[[0]],[[0]]], [[{a:1}],[2],[{c:3}]], inputManager);
    var r: ResultWatcher = new ResultWatcher();
    var qState: boolean[] = [false, false, false];
    var result: any[] = undefined;

    function verify(): void {
        if (ev.nrActiveWatchers > 0) {
            verifyResult(ev, result);
        }
        verifyActive(ev.variantInputs[0], ev.nrActiveWatchers > 0 && qState[0]);
        verifyActive(ev.variantInputs[1], ev.nrActiveWatchers > 0 && qState[1]);
        verifyActive(ev.variantInputs[2], ev.nrActiveWatchers > 0 && qState[2] && !(!qState[0] && qState[1]));
    }

    ev.addWatcher(r, "test", false, true);
    evaluationQueue.runQueue(0, false, undefined);
    verify();

    var qSwitchSequence: number[][] = [
        [0], // 100
        [1], // 110
        [2], // 111
        [-1], // 011
        [-2, -3], // 000
        [1], // 010
        [2], // 011
        [0], // 111
        [-1, -2], // 001
        [1], // 011
        [0, -2], // 101
        [1], // 111
        [-1], // 011
        [-2], // 001
        [1] // 111
    ];

    for (var step: number = 0; step < qSwitchSequence.length; step++) {
        var qs: number[] = qSwitchSequence[step];
        for (var qi: number = 0; qi < qs.length; qi++) {
            var on: boolean = qs[qi] >= 0;
            var q: number = on? qs[qi]: -qs[qi] - 1;
            setQ(ev, q, 0, on? [1]: [0]);
            qState[q] = on;
        }
        if (qState[0]) {
            result = qState[2]? [{a: 1, c: 3}]: [{a: 1}];
        } else if (qState[1]) {
            result = [2];
        } else if (qState[2]) {
            result = [{c: 3}];
        } else {
            result = undefined;
        }
        evaluationQueue.runQueue(0, false, undefined);
        verify();
        ev.deactivate(r);
        evaluationQueue.runQueue(0, false, undefined);
        verify();
        ev.activate(r);
        evaluationQueue.runQueue(0, false, undefined);
        verify();
    }
}

// 2 variants, starting as undefined
function test6(): void {
    var inputManager: InputManager = new InputManager();
    var ev: EvaluationVariant = initEV([[1],[1]], [[[0]],[[0]]], [undefined, undefined], inputManager);
    var r: ResultWatcher = new ResultWatcher();

    ev.addWatcher(r, "test", false, true);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);

    setQ(ev, 0, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], true);

    setQ(ev, 0, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], false);

    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[1], true);

    setQ(ev, 1, 0, [0]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[1], false);

    setQ(ev, 0, 0, [1]);
    setQ(ev, 1, 0, [1]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);

    // Verify deactivation/reactivation
    ev.deactivate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyActive(ev.qualifierInputs[0][0], false);
    verifyActive(ev.variantInputs[0], false);
    verifyActive(ev.qualifierInputs[1][0], false);
    verifyActive(ev.variantInputs[1], false);
    ev.activate(r);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, undefined);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);

    setF(ev, 0, [{a: 1}]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a: 1}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);

    setF(ev, 1, [{b: 2}]);
    evaluationQueue.runQueue(0, false, undefined);
    verifyResult(ev, [{a: 1, b: 2}]);
    verifyActive(ev.variantInputs[0], true);
    verifyActive(ev.variantInputs[1], true);
}

debugger;
test1();
test2();
test3();
test4();
test5();
test6();
