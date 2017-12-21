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
/// <reference path="cdl.ts" />
/// <reference path="result.ts" />
/// <reference path="evaluationNode.ts" />
/// <reference path="evaluationQueue.ts" />
/// <reference path="predefinedFunctions.ts" />
/// <reference path="stringparser.ts" />

function makeElementReference(areaId: string): ElementReference {
    return new ElementReference(areaId);
}

// Operation on n arguments. The operation specific (derived) function compute()
// gets all arguments as an os per identity.
abstract class EFNSetOperator implements ExecutableFunction {

    destroy(): void {
    }

    /// This function performs the computation on n arguments, suppressing
    /// undefined values.
    abstract compute(args: any[][]): any[];

    /// This function performs the computation on n arguments, but includes
    /// undefined values in the result.
    abstract computeUndef(args: any[][]): any[];

    execute(args: Result[]): any[] {
        var r: any[] = this.compute(args.map((r) => {
            return r === undefined || r.value === undefined?
                   constEmptyOS: r.value;
        }));

        return r === undefined? constEmptyOS: r;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][][] = new Array<any[][]>(args.length); // [arg_i][id] -> o(...)
        var sids: any[] = [];
        var idsPtr: any[] = sids;
        var res: any[];

        for (var i: number = 0; i < args.length; i++) {
            if (setMode[i]) {
                values[i] = [];
                groupResultById(args[i], values[i], idsPtr);
                idsPtr = undefined;
            } else {
                // Note: this is needed, even though the length is set; map
                // doesn't iterate over unassigned elements in arrays. Really.
                values[i] = undefined;
            }
        }
        if (idsPtr === sids) {
            // None of the arguments is a set argument
            return this.execute(args);
        } else {
            res = [];
            for (var i: number = 0; i < sids.length; i++) {
                // Determine result by slicing all arguments per id; use the
                // full argument value when not in set mode
                var r = this.computeUndef(values.map((idArr: any[][], j: number): any[] => {
                    return idArr !== undefined? idArr[i]: args[j].value;
                }));
                if (r === undefined || r.length === 0 || (typeof(r[0]) === "number" && isNaN(r[0]))) {
                    res.push(undefined);
                    ids.push(sids[i]);
                } else {
                    Array.prototype.push.apply(res, r);
                    repeatId(ids, sids[i], r.length);
                }
            }
            return res;
        }
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}

// Element-wise operations on single values, e.g. [ln, a], using an inherited
// function op(a) to do the actual computation.
abstract class EFUnaryOperator extends EFNSetOperator {
    /// Function that implements the actual operation
    abstract op(a: any): any;

    compute(args: any[][]): any[] {
        if (args[0] !== undefined) {
            var arg: any = args[0];
            var res: any[] = [];
            for (var i: number = 0; i !== arg.length; i++) {
                var r: any = this.op(arg[i]);
                if (r !== undefined && (typeof(r) !== "number" || !isNaN(r))) {
                    res.push(r);
                }
            }
            return res;
        } else {
            return constEmptyOS;
        }
    }

    computeUndef(args: any[][]): any[] {
        if (args[0] !== undefined) {
            var arg: any = args[0];
            var res: any[] = [];
            for (var i: number = 0; i !== arg.length; i++) {
                res.push(this.op(arg[i]));
            }
            return res;
        } else {
            return constEmptyOS;
        }
    }
}

// Element-wise operations on value pairs, e.g. [plus, a, b], using an inherited
// function op(a, b) to do the actual computation.
abstract class EFBinaryOperator extends EFNSetOperator {
    /// Performs the actual computation
    abstract op(a: any, b: any): any;

    compute(args: any[][]): any[] {
        var arg1: any = args[0];
        var arg2: any = args[1];
        var res: any[];
        var i: number;

        if (arg1 === undefined || arg2 === undefined) {
            return undefined;
        }
        if (arg1.length === arg2.length) {
            res = [];
            for (i = 0; i !== arg1.length; i++) {
                var r: any = this.op(arg1[i], arg2[i]);
                if (r !== undefined && (typeof(r) !== "number" || !isNaN(r))) {
                    res.push(r);
                }
            }
        } else if (arg1.length === 1) {
            res = [];
            for (i = 0; i !== arg2.length; i++) {
                var r: any = this.op(arg1[0], arg2[i]);
                if (r !== undefined && (typeof(r) !== "number" || !isNaN(r))) {
                    res.push(r);
                }
            }
        } else if (arg2.length === 1) {
            res = [];
            for (i = 0; i !== arg1.length; i++) {
                var r: any = this.op(arg1[i], arg2[0]);
                if (r !== undefined && (typeof(r) !== "number" || !isNaN(r))) {
                    res.push(r);
                }
            }
        } else {
            res = [];
        }
        return res;
    }

    computeUndef(args: any[][]): any[] {
        var arg1: any = args[0];
        var arg2: any = args[1];
        var res: any[];
        var i: number;

        if (arg1 === undefined || arg2 === undefined) {
            return undefined;
        }
        if (arg1.length === arg2.length) {
            res = [];
            for (i = 0; i !== arg1.length; i++) {
                res.push(this.op(arg1[i], arg2[i]));
            }
        } else if (arg1.length === 1) {
            res = [];
            for (i = 0; i !== arg2.length; i++) {
                res.push(this.op(arg1[0], arg2[i]));
            }
        } else if (arg2.length === 1) {
            res = [];
            for (i = 0; i !== arg1.length; i++) {
                res.push(this.op(arg1[i], arg2[0]));
            }
        } else {
            res = [];
        }
        return res;
    }
}

class EFPlus extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFPlus();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFPlus.singleton;
    }

    op(a: any, b: any): number {
        return a === undefined || b === undefined? undefined:
               Number(a) + Number(b);
    }
}
plus.factory = EFPlus.make;

class EFMinus extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFMinus();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFMinus.singleton;
    }

    op(a: any, b: any): number {
        return a === undefined || b === undefined? undefined:
               a - b;
    }
}
minus.factory = EFMinus.make;

class EFMul extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFMul();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFMul.singleton;
    }

    op(a: any, b: any): number {
        return a === undefined || b === undefined? undefined:
               a * b;
    }
}
mul.factory = EFMul.make;

class EFDiv extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFDiv();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFDiv.singleton;
    }

    op(a: any, b: any): number {
        return a === undefined || b === undefined || b === 0? undefined:
               a / b;
    }
}
div.factory = EFDiv.make;

// return the modulus given two numbers
// the result has the sign of the divisor
// [mod, 4, -3] == -2, [mod, -4, 3] == 2
//
class EFMod extends EFBinaryOperator {
    static singleton: ExecutableFunction = new EFMod();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFMod.singleton;
    }

    op(a: any, b: any): number {
        // javascript's '%' is a remainder operation; the sign is the
        //  dividend's sign, e.g. (-1%7)==-1
        // 'mod' is expected to have the divisor's sign. so that
        //  [mod, -1, 7] == 6, and [mod, 6, -7] == -1
        return a === undefined || b === undefined || b === 0? undefined:
               (((a % b) + b) % b);
    }
}    
mod.factory = EFMod.make;

// the remainder of the division of the two arguments
// the result has the sign of the dividend
// [remainder, 4, -3] == 1, [reminder, -4, 3] == -1
//
class EFRemainder extends EFBinaryOperator {
    static singleton: ExecutableFunction = new EFRemainder();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFRemainder.singleton;
    }

    op(a: any, b: any): number {
        return a === undefined || b === undefined || b === 0? undefined:
               a % b;
    }
}    
remainder.factory = EFRemainder.make;
    
class EFPow extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFPow();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFPow.singleton;
    }

    op(a: any, b: any): number {
        return a === undefined || b === undefined? undefined:
               Math.pow(a, b);
    }
}
pow.factory = EFPow.make;

class EFLn extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFLn();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFLn.singleton;
    }

    op(a: any): number {
        return a === undefined? undefined: Math.log(a);
    }
}
ln.factory = EFLn.make;

class EFExp extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFExp();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFExp.singleton;
    }

    op(a: any): number {
        return a === undefined? undefined: Math.exp(a);
    }
}
exp.factory = EFExp.make;

class EFLog10 extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFLog10();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFLog10.singleton;
    }

    op(a: any): number {
        return a === undefined? undefined: Math.log(a) / Math.LN10;
    }
}
log10.factory = EFLog10.make;

// [logb, o(2, 4, 8), 2] = o(1,2,3)
class EFLogB extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFLogB();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFLogB.singleton;
    }

    op(a: any, b: any): number {
        return a === undefined || b === undefined? undefined:
               Math.log(a) / Math.log(b);
    }
}
logb.factory = EFLogB.make;

//
// a base class for round/ceil/floor
// the first argument is the number to be rounded/ceiled/floored
// the second argument is the number of digits to keep after the decimal
//  point. It defaults to 0, and may also be negative.
// [round, 345.678] == [round, 345.678, 0] == [346]
// [ceil, 345.678] == [ceil, 345,678, 0] == 346
// [floor, 345.678] == [floor, 345,678, 0] == 345
// [ceil, 345.678, -2] == 400; [ceil, 345.678, -1] == 350;
// [ceil, 345.678, 1] == 345.7; [ceil, 345.678, 2] == 345.68
class EFRounding implements ExecutableFunction {
    roundingFunc: (value: any, exp: any) => number;

    // generate a round/floor/ceil that takes a 2nd argument, which is the
    // number of digits to keep after the decimal point.
    // allow positive/negative 2nd argument
    // allow 'value' or 'exp' to be a string ('value' may be in exp notation)
    static genRounding(baseFunc: (n: number) => number) {
        return function (value: any, exp: any) {
            if (typeof exp === 'undefined' || +exp === 0) {
                return baseFunc(value);
            }

            value = +value;
            exp  = +exp;

            if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
                return NaN;
            }

            // Shift
            value = value.toString().split('e');
            value = baseFunc(+(value[0] +
                               'e' + (value[1] ? (+value[1] + exp) : exp)));

            // Shift back
            value = value.toString().split('e');
            return +(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp));
        }
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var value: any[] = args[0].value;
        var exp: any[] = (args.length > 1) ? args[1].value : [0];

        var res: any[];
        var i: number;

        if (value !== undefined) {
            assert(value instanceof Array, "'value' argument must be an os");
            if (typeof(exp) === "undefined") {
                exp = [0];
            }
            assert(exp instanceof Array,
                   "'exp' argument must be a (single-element) os");
            if (exp.length === 0) {
                exp = [0];
            }

            if (exp.length === 1) {
                var expVal: any = exp[0];
                res = new Array(value.length);
                for (var i: number = 0; i !== value.length; i++) {
                    res[i] = value[i] === undefined? undefined:
                             this.roundingFunc(value[i], expVal);
                }
            } else {
                res = value;
            }
        } else {
            res = constEmptyOS;
        }
        return res;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Array.prototype.push.apply(ids, args[0].identifiers);
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}

class EFRound extends EFRounding {
    static singleton: ExecutableFunction = new EFRound();
    static make(local: EvaluationEnvironment,
                en: EvaluationNode):
    ExecutableFunction {
        return EFRound.singleton;
    }

    constructor() {
        super();
        this.roundingFunc = EFRound.genRounding(Math.round);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
round.factory = EFRound.make;

class EFCeil extends EFRounding {
    static singleton: ExecutableFunction = new EFCeil();
    static make(local: EvaluationEnvironment,
                en: EvaluationNode):
    ExecutableFunction {
        return EFCeil.singleton;
    }

    constructor() {
        super();
        this.roundingFunc = EFRound.genRounding(Math.ceil);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
ceil.factory = EFCeil.make;

class EFFloor extends EFRounding {
    static singleton: ExecutableFunction = new EFFloor();
    static make(local: EvaluationEnvironment,
                en: EvaluationNode):
    ExecutableFunction {
        return EFFloor.singleton;
    }

    constructor() {
        super();
        this.roundingFunc = EFRound.genRounding(Math.floor);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
floor.factory = EFFloor.make;

class EFAbs extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFAbs();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFAbs.singleton;
    }

    op(a: any): number {
        return a === undefined? undefined: Math.abs(a);
    }
}
abs.factory = EFAbs.make;

class EFUMinus extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFUMinus();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFUMinus.singleton;
    }

    op(a: any): number {
        return a === undefined? undefined: -a;
    }
}
uminus.factory = EFUMinus.make;

class EFSqrt extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFSqrt();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSqrt.singleton;
    }

    op(a: any): number {
        return a === undefined? undefined: Math.sqrt(a);
    }
}
sqrt.factory = EFSqrt.make;

class EFSign extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFSign();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSign.singleton;
    }

    op(a: any): number {
        return a < 0? -1: a === 0? 0: a > 0? 1: undefined;
    }
}
sign.factory = EFSign.make;

class EFCoordinates implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFCoordinates();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFCoordinates.singleton;
    }

    destroy(): void {
    }

    execute(args: any[]): any[] {
        var arg1: any = args[0].value;
        var res: {x: number[]; y: number[];}[] = [];

        if (arg1 !== undefined) {
            assert(arg1 instanceof Array, "argument not os");
            for (var i: number = 0; i !== arg1.length; i++) {
                if (arg1[i] instanceof ElementReference) {
                    var area: CoreArea = allAreaMonitor.getAreaById(arg1[i].getElement());
                    var r: Rect = area.getPos();
                    res.push({x: [r.left], y: [r.top]});
                }
            }
        }
        return res;
    }

    executeOS(args: any[]): any[] {
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
coordinates.factory = EFCoordinates.make;

var actualArgumentValues: {[argName: string]: string} = {};

class EFArg implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFArg();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFArg.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        if (args.length !== 2 || args[0].value === undefined || args[1].value === undefined) {
            return constEmptyOS;
        }
        var cmdArg: any = gArgParser.getArg(args[0].value[0], undefined);
        actualArgumentValues[args[0].value[0]] =
            cmdArg? JSON.stringify(cmdArg): JSON.stringify(args[1].value);
        if (cmdArg === undefined) {
            return args[1].value;
        }
        if (cmdArg === false || cmdArg === "false") {
            return constEmptyOS;
        }
        if (cmdArg === true || cmdArg === "true") {
            return constTrueOS;
        }
        if (!isNaN(parseFloat(cmdArg)) && isFinite(cmdArg)) {
            return [Number(cmdArg)];
        }
        return normalizeObject(cmdArg);
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.runtimeWarning("no OS implementation for EFArg");
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
arg.factory = EFArg.make;

class EFPointer implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFPointer();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFPointer.singleton;
    }

    static res: ElementReference[] = [new ElementReference("p1")];

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        return EFPointer.res;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
pointer.factory = EFPointer.make;

class EFMe implements ExecutableFunction {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFMe(new ElementReference(local.getOwnId()));
    }

    me: ElementReference[];

    constructor(areaId: ElementReference) {
        this.me = [areaId];
    }

    destroy(): void {
        this.me = undefined;
    }

    execute(args: Result[]): any[] {
        return this.me;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.runtimeWarning("no OS implementation for [me]");
        return this.me;
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
me.factory = EFMe.make;

class EFAreaRelation implements ExecutableFunction, Watcher {
   
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        assert(false, "no derived implementation?");
        return undefined;
    }

    local: EvaluationEnvironment;
    owner: EvaluationNode;
    watcherId: number;
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    attributedTime: number;
    watchedAreas: {[areaId: string]: boolean} = {};

    constructor(local: EvaluationEnvironment, owner: EvaluationNode) {
        this.local = local;
        this.watcherId = getNextWatcherId();
        this.owner = owner;
        if (gProfile) {
            this.totalUpdateInputTime = 0;
            this.attributedTime = 0;
        }
    }

    destroy(): void {
        var rel: string = this.relation();

        for (var areaId in this.watchedAreas) {
            areaRelationMonitor.removeWatcher(areaId, rel, this);
        }
        this.watchedAreas = undefined;
    }

    relation(): string {
        assert(false, "no derived implementation?");
        return undefined;
    }

    getRelationAtPos(collection: any[], pos: number): any[] {
        assert(false, "no derived implementation?");
        return undefined;
    }

    getRelationElementAtPos(collection: any[], pos: number): any {
        assert(false, "no derived implementation?");
        return undefined;
    }

    onlyFirstTarget(): boolean {
        return false;
    }

    onlyLastTarget(): boolean {
        return false;
    }

    // usage: [areaRelation] === [areaRelation, [me]]
    execute(args: Result[]): any[] {
        var areaId: string;
        if (args.length === 2) {
            // This implementation is not really good: it does a linear search
            // for the requested object.
            var collection: any[] = args[0].value;
            var targets: any[] = args[1].value;
            if (collection !== undefined && targets !== undefined &&
                  collection.length > 0 && targets.length > 0) {
                if (this.onlyFirstTarget()) {
                    for (var i: number = 0; i < collection.length; i++) {
                        for (var j: number = 0; j < targets.length; j++) {
                            if (objectEqual(collection[i], targets[j])) {
                                return this.getRelationAtPos(collection, i);
                            }
                        }
                    }
                } else if (this.onlyLastTarget()) {
                    for (var i: number = collection.length - 1; i >= 0; i--) {
                        for (var j: number = 0; j < targets.length; j++) {
                            if (objectEqual(collection[i], targets[j])) {
                                return this.getRelationAtPos(collection, i);
                            }
                        }
                    }
                } else {
                    var res: any[] = [];
                    for (var i: number = 0; i < collection.length; i++) {
                        for (var j: number = 0; j < targets.length; j++) {
                            if (objectEqual(collection[i], targets[j])) {
                                var elt: any = this.getRelationElementAtPos(collection, i);
                                if (elt !== undefined) {
                                    res.push(elt);
                                }
                            }
                        }
                    }
                    return res;
                }
            }
            return constEmptyOS;
        } else if (args.length < 2) {
            // Implementation retrieves area relations again and again.
            // It could update the result in updateInput instead, and only run
            // this part when the input changes.
            var areaSet: {[areaId: string]: boolean} = {};
            var rel: string = this.relation();
            var value: ElementReference[] = [];

            // Identify areas in current input
            if (args.length === 0) {
                areaId = this.local.getOwnId();
                if (areaId === undefined) {
                    // We assume that this can only happen for constant
                    // relations, such as [embedding]. Hence, we can return
                    // a constant value, and do not need to register on the
                    // area relation monitor.
                    return this.local.getRelation(rel);
                } else if (allAreaMonitor.exists(areaId)) {
                    areaSet[areaId] = true;
                }
            } else {
                var areaList: ElementReference[] = args[0].value;
                if (areaList !== undefined) {
                    for (var i: number = 0; i !== areaList.length; i++) {
                        areaId = areaList[i].element;
                        if (allAreaMonitor.exists(areaId)) {
                            areaSet[areaId] = true;
                        }
                    }
                }
            }
            for (areaId in areaSet) {
                if (!(areaId in this.watchedAreas)) {
                    this.watchedAreas[areaId] = true;
                    areaRelationMonitor.addWatcher(areaId, rel, this, undefined);
                }
                value = cconcat(value, areaRelationMonitor.getRelation(areaId, rel));
            }
            for (areaId in this.watchedAreas) {
                if (!(areaId in areaSet)) {
                    areaRelationMonitor.removeWatcher(areaId, rel, this);
                    delete this.watchedAreas[areaId];
                }
            }
            return value;
       } else {
           return constEmptyOS;
       }
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.error("should not be called in setMode");
        return this.execute(args);
    }

    updateInput(pos: any, result: Result): void {
        this.owner.markAsChanged();
    }

    isActive(): boolean {
        return this.owner.isActive();
    }

    isReady(): boolean {
        return true;
    }

    isDeferred(): boolean {
        return false;
    }

    defer(): void {
        throw "Should not be called";
    }

    undefer(): void {
        throw "Should not be called";
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }

    debugName(): string {
        return "areaRelation(" + this.owner.debugName() + ")";
    }

    getDebugOrigin(): string[] {
        return [this.debugName()];
    }
}

class EFEmbedding extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFEmbedding(local, en);
    }

    relation(): string {
        return "embedding";
    }


    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
embedding.factory = EFEmbedding.make;

class EFEmbeddingStar extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFEmbeddingStar(local, en);
    }

    relation(): string {
        return "embeddingStar";
    }


    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
embeddingStar.factory = EFEmbeddingStar.make;

class EFEmbedded extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFEmbedded(local, en);
    }

    relation(): string {
        return "embedded";
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
embedded.factory = EFEmbedded.make;

class EFEmbeddedStar extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFEmbeddedStar(local, en);
    }

    relation(): string {
        return "embeddedStar";
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
embeddedStar.factory = EFEmbeddedStar.make;

class EFPrev extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFPrev(local, en);
    }

    relation(): string {
        return "prev";
    }

    getRelationAtPos(collection: any[], pos: number): any[] {
        return pos > 0? [collection[pos - 1]]: constEmptyOS;
    }

    getRelationElementAtPos(collection: any[], pos: number): any {
        return collection[pos - 1];
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
prev.factory = EFPrev.make;

class EFPrevStar extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFPrevStar(local, en);
    }

    relation(): string {
        return "prevStar";
    }

    getRelationAtPos(collection: any[], pos: number): any[] {
        return collection.slice(0, pos + 1);
    }

    onlyLastTarget(): boolean {
        return true;
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
prevStar.factory = EFPrevStar.make;

class EFPrevPlus extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFPrevPlus(local, en);
    }

    relation(): string {
        return "prevPlus";
    }

    getRelationAtPos(collection: any[], pos: number): any[] {
        return collection.slice(0, pos);
    }

    onlyLastTarget(): boolean {
        return true;
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
prevPlus.factory = EFPrevPlus.make;

class EFNext extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFNext(local, en);
    }

    relation(): string {
        return "next";
    }

    getRelationAtPos(collection: any[], pos: number): any[] {
        return pos < collection.length - 1? [collection[pos + 1]]: constEmptyOS;
    }

    getRelationElementAtPos(collection: any[], pos: number): any {
        return collection[pos + 1];
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
next.factory = EFNext.make;

class EFNextStar extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFNextStar(local, en);
    }

    relation(): string {
        return "nextStar";
    }

    getRelationAtPos(collection: any[], pos: number): any[] {
        return collection.slice(pos);
    }

    onlyFirstTarget(): boolean {
        return true;
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
nextStar.factory = EFNextStar.make;

class EFNextPlus extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFNextPlus(local, en);
    }

    relation(): string {
        return "nextPlus";
    }

    getRelationAtPos(collection: any[], pos: number): any[] {
        return collection.slice(pos + 1);
    }

    onlyFirstTarget(): boolean {
        return true;
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
nextPlus.factory = EFNextPlus.make;

class EFExpressionOf extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFExpressionOf(local, en);
    }

    relation(): string {
        return "expressionOf";
    }


    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
expressionOf.factory = EFExpressionOf.make;

class EFReferredOf extends EFAreaRelation {

    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return new EFReferredOf(local, en);
    }

    relation(): string {
        return "referredOf";
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
referredOf.factory = EFReferredOf.make;

class EFNot implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFNot();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFNot.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        assert(args[0].value === undefined || args[0].value instanceof Array,
               "argument not os");
        return boolValue(isFalseValue(args[0].value));
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map(isFalseValue);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
not.factory = EFNot.make;

class EFDebugNodeToStr extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFDebugNodeToStr();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFDebugNodeToStr.singleton;
    }

    // Never called
    op(a: any): any {
        return undefined;
    }

    execute(args: Result[]): any[] {
        return [cdlify(args[0].value)];
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map(function(a: any[]): string {
            return cdlify(a);
        });
    }
}
debugNodeToStr.factory = EFDebugNodeToStr.make;

// There is only one instance of allAreas, since the result the same for
// everyone.
class EFAllAreas implements ExecutableFunction, Watcher {

    allAreas: ElementReference[] = [];
    watcherId: number;
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    attributedTime: number;
    owner: EvaluationNode;
    input: Result; // this is the input coming from the areaMonitor

    constructor() {
        this.watcherId = getNextWatcherId();
        if (gProfile) {
            this.totalUpdateInputTime = 0;
            this.attributedTime = 0;
        }
    }

    destroy(): void {
        EFAllAreas.singleton.input = undefined;
        EFAllAreas.singleton.allAreas = undefined;
        EFAllAreas.singleton.owner = undefined;
        allAreaMonitor.removeWatcher(EFAllAreas.singleton, false);
    }

    static singleton: EFAllAreas = new EFAllAreas();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        allAreaMonitor.addWatcher(EFAllAreas.singleton, undefined);
        if (EFAllAreas.singleton.input === undefined) {
            EFAllAreas.singleton.input = allAreaMonitor.result;
            EFAllAreas.singleton.allAreas = allAreaMonitor.result.value.map(makeElementReference);
            EFAllAreas.singleton.owner = en;
        }
        return EFAllAreas.singleton;
    }

    // This is called by areaMonitor.
    updateInput(pos: any, result: Result): void {
        this.input = result;
        this.owner.markAsChanged();
    }

    isActive(): boolean {
        return true;
    }

    isReady(): boolean {
        return true;
    }

    // Only can get called after a call to updateInput
    // Further optimizations:
    // - make areaMonitor pass around ElementReferences instead of strings
    // - accumulate changes and return undefined when they cancel out
    execute(args: Result[]): any[] {
        this.allAreas = this.input.value.map(makeElementReference); 
        return args.length === 0? this.allAreas: constEmptyOS;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.error("should not be called in setMode");
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return true;
    }

    isDeferred(): boolean {
        return false;
    }

    defer(): void {
        throw "Should not be called";
    }

    undefer(): void {
        throw "Should not be called";
    }

    debugName(): string {
        return "allAreas";
    }


    getDebugOrigin(): string[] {
        return ["allAreas"];
    }
}
allAreas.factory = EFAllAreas.make;

class EFEqual extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFEqual();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFEqual.singleton;
    }

    compute(args: any[][]): any[] {
        var arg1: any = args[0];
        var arg2: any = args[1];

        if (arg1 !== undefined && arg2 !== undefined) {
            if (arg1.length !== arg2.length) {
                return constFalseOS;
            }
            for (var i: number = 0; i !== arg1.length; i++) {
                if (!objectEqual(arg1[i], arg2[i])) {
                    return constFalseOS;
                }
            }
            return constTrueOS;
        }
        return (arg1 === undefined || arg1.length === 0) &&
               (arg2 === undefined || arg2.length === 0)?
               constTrueOS: constFalseOS;
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
equal.factory = EFEqual.make;

class EFNotEqual extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFNotEqual();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFNotEqual.singleton;
    }

    // Never called
    op(a: any, b: any): any {
        return undefined;
    }

    compute(args: any[][]): any[] {
        var arg1: any = args[0];
        var arg2: any = args[1];

        if (arg1 !== undefined && arg2 !== undefined) {
            if (arg1.length !== arg2.length) {
                return constTrueOS;
            }
            for (var i: number = 0; i !== arg1.length; i++) {
                if (!objectEqual(arg1[i], arg2[i])) {
                    return constTrueOS;
                }
            }
            return constFalseOS;
        }
        return (arg1 === undefined || arg1.length === 0) &&
               (arg2 === undefined || arg2.length === 0)?
               constFalseOS: constTrueOS;
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
notEqual.factory = EFNotEqual.make;

class EFBool implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFBool();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFBool.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        return isTrueValue(args[0].value)? constTrueOS: constEmptyOS;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map(isTrue);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
bool.factory = EFBool.make;

class EFSequence implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFSequence();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSequence.singleton;
    }

    destroy(): void {
    }

    compute1(arg: any[], op: (a: any, b: any) => any): any[] {
        var res: number[] = [];

        if (arg !== undefined && arg.length === 1 && arg[0] instanceof RangeValue) {
            var min: any = arg[0].min;
            var max: any = arg[0].max;
            if (typeof(min) !== "number" && typeof(max) !== "number") {
                Utilities.runtimeWarning("sequence on other than numeric values");
            } else if (isNaN(min) || min === -Infinity || isNaN(max) || max === Infinity) {
                Utilities.runtimeWarning("ill-defined sequence: r(" + safeJSONStringify(min) + ", " + safeJSONStringify(max) + ")");
            } else {
                var cmin: number = Math.ceil(min);
                var cmax: number = Math.floor(max);
                if (!arg[0].closedLower && min === cmin) {
                    cmin += 1;
                }
                if (!arg[0].closedUpper && max === cmax) {
                    cmax -= 1;
                }
                for (var i: number = cmin; i <= cmax; i++) {
                    res.push(i);
                }
            }
        }
        return res;
    }

    execute(args: any[]): any[] {
        return this.compute1(args[0].value, undefined);
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map((v: any[]): any[] => {
            return this.compute1(v, undefined);
        });
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
sequence.factory = EFSequence.make;

class EFOr extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFOr();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFOr.singleton;
    }

    compute(args: any[][]): any[] {
        return boolValue(args.some(isTrueValue));
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
or.factory = EFOr.make;

class EFAnd extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFAnd();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFAnd.singleton;
    }

    compute(args: any[][]): any[] {
        return boolValue(args.every(isTrueValue));
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
and.factory = EFAnd.make;

class EFNCompareAreasQuery implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFNCompareAreasQuery();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFNCompareAreasQuery.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var query: any[] = args[0].value,
            data: any[] = args[1].value;
        var res: any[];

        if (query === undefined) {
            res = data;
        } else if (data !== undefined) {
            assert(query instanceof Array && data instanceof Array, "argument not os");
            var areaIds: {[areaId: string]: boolean} = {};
            res = [];
            for (var i: number = 0; i !== query.length; i++) {
                var m: any = query[i];
                if (m instanceof ElementReference) {
                    areaIds[m.getElement()] = true;
                }
            }
            for (var i: number = 0; i !== data.length; i++) {
                var m: any = data[i];
                if (m instanceof ElementReference && !(m.getElement() in areaIds)) {
                    res.push(m);
                }
            }
        }
        return res;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.error("should not be called in setMode");
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
nCompareAreasQuery.factory = EFNCompareAreasQuery.make;

class EFEmpty implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFEmpty();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFEmpty.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var arg1: any[] = args[0].value;

        return arg1 !== undefined && arg1.length === 0? constTrueOS: constEmptyOS;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map(function(f: any[]): any {
            return f === undefined || f.length === 0;
        });
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
empty.factory = EFEmpty.make;

class EFNotEmpty implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFNotEmpty();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFNotEmpty.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var arg1: any[] = args[0].value;

        return arg1 !== undefined &&
            (!(arg1 instanceof Array) || arg1.length !== 0)? constTrueOS: constEmptyOS;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map(function(f: any[]): any {
            return f !== undefined && f.length !== 0;
        });
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
notEmpty.factory = EFNotEmpty.make;

class EFSize implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFSize();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSize.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var arg1: any[] = args[0].value;

        return arg1 !== undefined? [arg1.length]: [0];
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map(function(f: any[]): any {
            return f === undefined? 0: f.length;
        });
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
size.factory = EFSize.make;

class EFGreaterThan extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFGreaterThan();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFGreaterThan.singleton;
    }

    op(a: any, b: any): boolean {
        return a === undefined || b === undefined? undefined:
               a > b;
    }
}
greaterThan.factory = EFGreaterThan.make;

class EFGreaterThanOrEqual extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFGreaterThanOrEqual();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFGreaterThanOrEqual.singleton;
    }

    op(a: any, b: any): boolean {
        return a === undefined || b === undefined? undefined:
               a >= b;
    }
}
greaterThanOrEqual.factory = EFGreaterThanOrEqual.make;

class EFLessThan extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFLessThan();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFLessThan.singleton;
    }

    op(a: any, b: any): boolean {
        return a === undefined || b === undefined? undefined:
               a < b;
    }
}
lessThan.factory = EFLessThan.make;

class EFLessThanOrEqual extends EFBinaryOperator {

    static singleton: ExecutableFunction = new EFLessThanOrEqual();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFLessThanOrEqual.singleton;
    }

    op(a: any, b: any): boolean {
        return a === undefined || b === undefined? undefined:
               a <= b;
    }
}
lessThanOrEqual.factory = EFLessThanOrEqual.make;

class EFConcatStr implements ExecutableFunction {
    static singleton: ExecutableFunction = new EFConcatStr();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFConcatStr.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var arr: any[] = args[0].value;
        var suffixes: any = args.length > 1? getDeOSedValue(args[1].value): undefined;
        var prefix: string, infix: string, postfix: string;

        if (typeof(suffixes) === "string") {
            infix = suffixes;
        } else if (isAV(suffixes)) {
            prefix = getDeOSedValue(suffixes.prefix);
            infix = getDeOSedValue(suffixes.infix);
            postfix = getDeOSedValue(suffixes.postfix);
        }
        if (arr !== undefined) {
            assert(arr instanceof Array, "argument not os");
            var strs: string[] = [];
            for (var i = 0; i < arr.length; i++) {
                var e: any = arr[i];
                switch (typeof(e)) {
                  case "string":
                  case "number":
                  case "boolean":
                    strs[i] = String(e);
                    break;
                  case "object":
                    if (e instanceof Date) {
                        strs[i] = e.toString();
                    } else if (e !== null && "stringify" in e &&
                          typeof(e.stringify) === "function") {
                        strs[i] = e.stringify();
                    } else {
                        strs[i] = "";
                    }
                    break;
                }
            }
            return [(isSimpleType(prefix) && prefix !== undefined? prefix: "") +
                    strs.join(isSimpleType(infix) && infix !== undefined? infix: "") +
                    (isSimpleType(postfix) && postfix !== undefined? postfix: "")
                   ];
        }
        return constEmptyOS;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.error("should not be called in setMode");
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
concatStr.factory = EFConcatStr.make;

class EFNumberToString implements ExecutableFunction {
    static singleton: ExecutableFunction = new EFNumberToString();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFNumberToString.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var arr: any[] = args[0].value;
        var format: any = stripArray(args[1].value, true);
        var res: any[] = [];

        for (var i = 0; i < arr.length; i++) {
            res.push(EFNumberToString.convert(arr[i], format))
        }
        return res;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.error("should not be called in setMode");
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }

    static convert(v: any, format: any): any {
        var text: string;

        if (typeof(v) !== "number") {
            return v;
        }
        format = suppressSet(format);
        if (typeof (format) === "object" && format !== undefined &&
              ((0 <= format.numberOfDigits && format.numberOfDigits <= 20) ||
               format.numberOfDigits === undefined ||
               format.type === "intl")) {
            // Number formatting options
            switch (format.type) {
              case "fixed":
                text = v.toFixed(format.numberOfDigits);
                break;
              case "exponential":
                text = v.toExponential(format.numberOfDigits);
                break;
              case "precision":
                text = format.numberOfDigits === 0 ?
                    v.toPrecision() : // Otherwise it throws an exception
                    v.toPrecision(format.numberOfDigits);
                break;
              case "hexadecimal":
              case "HEXADECIMAL":
                text = v.toString(16);
                if (format.type === "HEXADECIMAL") {
                    text = text.toUpperCase();
                }
                while (text.length < format.numberOfDigits) {
                    text = "0" + text;
                }
                break;
              case "intl":
                try {
                    var locale = format.locale;
                    var formatter = new Intl.NumberFormat(locale, format);
                    text = formatter.format(v);
                } catch (e) {
                    text = String(v);
                }
                break;
              default:
                text = String(v);
                break;
            }
        } else if (format !== undefined) {
            var format = format;
            // Use default precision when numberOfDigits is missing or out of scope
            switch (format.type) {
              case "fixed":
                text = v.toFixed();
                break;
              case "exponential":
                text = v.toExponential();
                break;
              case "precision":
                text = v.toPrecision();
                break;
              case "hexadecimal":
              case "HEXADECIMAL":
                text = v.toString(16);
                if (format.type === "HEXADECIMAL") {
                    text = text.toUpperCase();
                }
                break;
              default:
                text = String(v);
                break;
            }
        } else {
            // Default conversion to string
            text = String(v);
        }
        return text;
    }
}
numberToString.factory = EFNumberToString.make;

class EFRange implements ExecutableFunction {
    static singleton: ExecutableFunction = new EFRange();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFRange.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        var arg1: any[] = args[0].value,
            arg2: any[] = args[1].value;
        var lowIndex: number;
        var highIndex: number;
 
        if (arg1 !== undefined && arg2 !== undefined) {
            for (var i: number = 0; i < arg2.length; i++) {
                for (var j: number = 0; j < arg1.length; j++) {
                    if (objectEqual(arg1[j], arg2[i])) {
                        if (lowIndex === undefined) {
                            lowIndex = highIndex = i;
                        } else {
                            highIndex = i;
                        }
                        break;
                    }
                }
            }
            if (lowIndex !== undefined) {
                return arg2.slice(lowIndex, highIndex + 1);
            }
        }
        return constEmptyOS;
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        Utilities.error("should not be called in setMode");
        return this.execute(args);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
range.factory = EFRange.make;

class EFMax extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFMax();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFMax.singleton;
    }

    compute(args: any[][]): any[] {
        var max: any = undefined;

        for (var i: number = 0; i < args.length; i++) {
            var arg_i: any = args[i];
            if (arg_i !== undefined) {
                for (var j: number = 0; j < arg_i.length; j++) {
                    var v: any = arg_i[j] instanceof RangeValue?
                                 arg_i[j].max: arg_i[j];
                    if (max === undefined || max < v) {
                        max = v;
                    }
                }
            }
        }
        return max === undefined? constEmptyOS: [max];
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
max.factory = EFMax.make;

class EFMin extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFMin();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFMin.singleton;
    }

    compute(args: any[][]): any[] {
        var min: any = undefined;

        for (var i: number = 0; i < args.length; i++) {
            var arg_i: any = args[i];
            if (arg_i !== undefined) {
                for (var j: number = 0; j < arg_i.length; j++) {
                    var v: any = arg_i[j] instanceof RangeValue?
                                 arg_i[j].min: arg_i[j];
                    if (min === undefined || min > v) {
                        min = v;
                    }
                }
            }
        }
        return min === undefined? constEmptyOS: [min];
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
min.factory = EFMin.make;

class EFSum extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFSum();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSum.singleton;
    }

    compute(args: any[][]): any[] {
        var sum: number = 0, elt: any;

        for (var i: number = 0; i !== args.length; i++) {
            var os: any = args[i];
            if (os !== undefined) {
                for (var j: number = 0; j < os.length; j++) {
                    elt = os[j];
                    if (typeof(elt) === "number") {
                        sum += elt;
                    }
                }
            }
        }
        return [sum];
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
sum.factory = EFSum.make;

// [testStore] is to be used solely within automated test scripts
//
// it returns an a/v whose members are the values stored in the global
//  test-store by a previous test-element. The expected use is to query a single
//  element off of the a/v, e.g.
// test-script = o(
//     { log: "test start" },
//     ...
//     <test-element that stores a value at "myLabel">
//    ...
//    {
//         assert: [equls, <current value>, [{myLabel: _}, [testStore]]],
//         comment: "<current value> should equal value stored at myLabel"
//    },
//    ...
// );
//
// A test-node { store: <value>, into: <label> } calls
//   EFTestStore.updateLabel(label, value) (defined below).
//
// This calls 'markAsChanged()' on the owner evaluationNode, which should
//  cause execute() to be called again.
// execute() takes care to always return a new 'res' object, so that a disctict
//  'old' and 'new' values can be compared by the evaluationNode.
//
// the <value> argument to updateLabel must be a valid Result value, except that
//  the top level is made an array if it isn't already one
//

class EFTestStore implements ExecutableFunction {
    // a global a/v associating labels with test-values
    static testStore: {[label: string]: any} = {};
    owner: EvaluationNode = undefined;


    destroy(): void {
        EFAllAreas.singleton.owner = undefined;
    }

    static singleton: EFTestStore = new EFTestStore();
    static make(local: EvaluationEnvironment, en: EvaluationNode):
      ExecutableFunction
    {
        if (typeof(EFTestStore.singleton.owner) === "undefined") {
            EFTestStore.singleton.owner = en;
        }
        return EFTestStore.singleton;
    }

    execute(args: Result[]): any[] {
        var res: {[label: string]: any} = {};
        var tt = EFTestStore.testStore;
        for (var label in tt) {
            res[label] = tt[label];
        }
        return [res];
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        return this.execute(args);
    }

    static updateLabel(label: string, value: any): void {
        if (! (value instanceof Array)) {
            value = [value];
        }
        EFTestStore.testStore[label] = value;
        if (typeof(EFTestStore.singleton.owner) !== "undefined") {
            EFTestStore.singleton.owner.markAsChanged();
        }
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
testStore.factory = EFTestStore.make;

class EFReverse extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFReverse();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFReverse.singleton;
    }

    compute(args: any[][]): any[] {
        return args[0] !== undefined? args[0].slice(0).reverse(): constEmptyOS;
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
reverse.factory = EFReverse.make;

class EFDynamicAttribute extends EFNSetOperator {

    static singleton: ExecutableFunction = new EFDynamicAttribute();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFDynamicAttribute.singleton;
    }

    compute(args: any[][]): any[] {
        var arg1: any[] = args[0], arg2: any[] = args[1], arg3: any[] = args[2];
        var res: any = undefined;

        if (arg1 !== undefined && arg2 !== undefined && arg !== undefined) {
            var attr: any = getDeOSedValue(arg1);
            var base: any = getDeOSedValue(arg3);
            if (typeof(attr) !== "string") {
                // We're not even going to try
                return constEmptyOS;
            }
            if (base instanceof Array || !(base instanceof Object) ||
                  base instanceof NonAV) {
                // Cannot merge with an os, simple value or non av object
                return base instanceof Array? base: [base];
            }
            res = shallowCopyMinus(base, attr);
            if (attr in base) {
                res[attr] = mergeCopyValue(arg2, base[attr], undefined);
            } else {
                res[attr] = arg2;
            }
        }
        return res === undefined? constEmptyOS: [res];
    }

    computeUndef(args: any[][]): any[] {
        return this.compute(args);
    }
}
dynamicAttribute.factory = EFDynamicAttribute.make;

class EFDateToNum extends EFBinaryOperator {
    static singleton: ExecutableFunction = new EFDateToNum();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFDateToNum.singleton;
    }

    static sepSeq: RegExp = /[ :.,/-]+/;
    static currentYear: number = new Date().getFullYear();

    op(dateText: any, format: any): number {
        if (typeof(dateText) === "string" && typeof(format) === "string") {
            var date: Date = new Date(1, 0);
            var dateArr: any[] = dateText.split(EFDateToNum.sepSeq);
            var formatArr: string[] = format.split(EFDateToNum.sepSeq);
            if (dateArr.length === formatArr.length) {
                for (var i: number = 0; i < formatArr.length; i++) {
                    var date_i: number = Number(dateArr[i]);
                    switch (formatArr[i]) {
                      case "M": case "MM":
                        date.setMonth(date_i - 1);
                        break;
                      case "d": case "dd":
                        date.setDate(date_i);
                        break;
                      case "y": case "yyyy":
                        date.setFullYear(date_i);
                        break;
                      case "yy":
                        date.setFullYear(date_i >= 100? date_i:
                                         date_i + (EFDateToNum.currentYear - EFDateToNum.currentYear % 100) +
                                         (date_i % 100 > EFDateToNum.currentYear % 100 + 25? -100: 0));
                        break;
                      case "h": case "hh":
                        date.setHours(date_i);
                        break;
                      case "m": case "mm":
                        date.setMinutes(date_i);
                        break;
                      case "s": case "ss":
                        date.setSeconds(date_i);
                        break;
                      case "_":
                        // Ignore this part
                        break;
                      default:
                        console.log("error in date format", format);
                        return undefined;
                    }
                }
            }
            return date.getTime() / 1000;
        }
        return undefined;
    }
}    
dateToNum.factory = EFDateToNum.make;

class EFNumToDate extends EFBinaryOperator {
    static singleton: ExecutableFunction = new EFNumToDate();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFNumToDate.singleton;
    }

    static alphaSeq: RegExp = /[a-zA-Z]*/;

    op(dateValue: any, format: any): string {
        function twoDigits(n: number): string {
            return n < 10? "0" + n: String(n);
        }
        if (typeof(dateValue) === "number" && typeof(format) === "string") {
            var date: Date = new Date(dateValue * 1000);
            var formatPtr: string = format;
            var dateText: string = "";
            while (formatPtr !== "") {
                var match = formatPtr.match(EFNumToDate.alphaSeq)[0];
                if (match.length === 0) {
                    dateText += formatPtr.charAt(0);
                    formatPtr = formatPtr.substr(1);
                } else {
                    switch (match) {
                      case "M": case "MM":
                        dateText += (date.getMonth() + 1);
                        break;
                      case "d": case "dd":
                        dateText += date.getDate();
                        break;
                      case "y": case "yyyy":
                        dateText += date.getFullYear();
                        break;
                      case "yy":
                        dateText += twoDigits(date.getFullYear() % 100);
                        break;
                      case "h":
                        dateText += date.getHours();
                        break;
                      case "hh":
                        dateText += twoDigits(date.getHours());
                        break;
                      case "m":
                        dateText += date.getMinutes();
                        break;
                      case "mm":
                        dateText += twoDigits(date.getMinutes());
                        break;
                      case "s":
                        dateText += date.getSeconds();
                        break;
                      case "ss":
                        dateText += twoDigits(date.getSeconds());
                        break;
                      case "_":
                        // Ignore this part
                        break;
                      default:
                        console.log("error in date format", format);
                        return undefined;
                    }
                    formatPtr = formatPtr.substr(match.length);
                }
            }
            return dateText;
        }
        return undefined;
    }
}    
numToDate.factory = EFNumToDate.make;

class EFTestFormula extends EFUnaryOperator {
    static singleton: ExecutableFunction = new EFTestFormula();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFTestFormula.singleton;
    }

    op(formula: any): boolean {
        if (typeof(formula) !== "string") {
            return false;
        }
        var formulaParser = new StringParseFormula();
        var res: ParseResult = formulaParser.parse(formula);
        return res.success === true;
    }
}
testFormula.factory = EFTestFormula.make;

class EFEvaluatateCDLValueString extends EFUnaryOperator {
    static singleton: ExecutableFunction = new EFEvaluatateCDLValueString();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFEvaluatateCDLValueString.singleton;
    }

    op(formula: any): any {
        if (typeof(formula) !== "string") {
            return undefined;
        }
        var formulaParser = new StringParseCDLValue();
        var res: ParseResult = formulaParser.parse(formula);
        return singleton(res.tree.result);
    }
}
evaluateCdlStringValue.factory = EFEvaluatateCDLValueString.make;

class EFTestCDLValueString extends EFUnaryOperator {
    static singleton: ExecutableFunction = new EFTestCDLValueString();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFTestCDLValueString.singleton;
    }

    op(formula: any): boolean {
        if (typeof(formula) !== "string") {
            return false;
        }
        var formulaParser = new StringParseCDLValue();
        var res: ParseResult = formulaParser.parse(formula);
        return res.success === true;
    }
}
testCdlValueString.factory = EFTestCDLValueString.make;

class EFSubString extends EFBinaryOperator {
    static singleton: ExecutableFunction = new EFSubString();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSubString.singleton;
    }

    op(range: any, str: any): string {
        if (typeof(str) === "string") {
            if (typeof(range) === "number") {
                return str.substr(range, 1);
            } else if (range instanceof RangeValue) {
                var l: number = range.min;
                var h: number = range.max;
                if (l < 0) l += str.length;
                if (h < 0) h += str.length;
                return l < h? str.substr(l, h - l + 1): str.substr(h, l - h + 1);
            }
        }
        return undefined;
    }
}
subStr.factory = EFSubString.make;

class EFStringToNumber extends EFUnaryOperator {
    static singleton: ExecutableFunction = new EFStringToNumber();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFStringToNumber.singleton;
    }

    op(str: any): string | number {
        if (typeof(str) === "string") {
            var num: number = Number(str);
            return isNaN(num)? str: num;
        } else {
            return str;
        }
    }
}
stringToNumber.factory = EFStringToNumber.make;

class EFSingleValue implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFSingleValue();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSingleValue.singleton;
    }

    destroy(): void {
    }

    private static getSingleValue(os: any[]): any[] {
        if (os !== undefined) {
            for (var i = 0; i < os.length; i++) {
                var v: any = os[i];
                if (isSimpleType(v) || v instanceof NonAV) {
                    return [v];
                }
            }
        }
        return constEmptyOS;
    }

    execute(args: Result[]): any[] {
        return EFSingleValue.getSingleValue(args[0].value);
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        var values: any[][] = [];

        groupResultById(args[0], values, ids);
        return values.map(EFSingleValue.getSingleValue);
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
singleValue.factory = EFSingleValue.make;

class EFTimeStamp implements ExecutableFunction {

    static singleton: ExecutableFunction = new EFTimeStamp();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFTimeStamp.singleton;
    }

    destroy(): void {
    }

    execute(args: Result[]): any[] {
        return [Date.now() / 1000];
    }

    executeOS(args: Result[], setMode: boolean[], ids: any[]): any[] {
        return [Date.now() / 1000];
    }

    undefinedSignalsNoChange(): boolean {
        return false;
    }
}
timestamp.factory = EFTimeStamp.make;

class EFEscapeQuotes extends EFUnaryOperator {
    static singleton: ExecutableFunction = new EFEscapeQuotes();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFEscapeQuotes.singleton;
    }

    op(str: any): string | number {
        if (typeof(str) === "string") {
            return str.replace(/(["'\\])/g, "\\$1");
        } else {
            return str;
        }
    }
}
escapeQuotes.factory = EFEscapeQuotes.make;

class EFSecond extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFSecond();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFSecond.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getSeconds();
            return isNaN(n)? undefined: n;
        }
        return undefined;
    }
}
second.factory = EFSecond.make;

class EFMinute extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFMinute();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFMinute.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getMinutes();
            return isNaN(n)? undefined: n;
        }
        return undefined;
    }
}
minute.factory = EFMinute.make;

class EFHour extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFHour();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFHour.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getHours();
            return isNaN(n)? undefined: n + 1;
        }
        return undefined;
    }
}
hour.factory = EFHour.make;

class EFDayOfWeek extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFDayOfWeek();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFDayOfWeek.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getDay();
            return isNaN(n)? undefined: n + 1;
        }
        return undefined;
    }
}
dayOfWeek.factory = EFDayOfWeek.make;

class EFDayOfMonth extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFDayOfMonth();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFDayOfMonth.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getDate();
            return isNaN(n)? undefined: n;
        }
        return undefined;
    }
}
dayOfMonth.factory = EFDayOfMonth.make;

class EFMonth extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFMonth();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFMonth.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getMonth();
            return isNaN(n)? undefined: n + 1;
        }
        return undefined;
    }
}
month.factory = EFMonth.make;

class EFQuarter extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFQuarter();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFQuarter.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getMonth();
            return isNaN(n)? undefined: Math.trunc(n / 3) + 1;
        }
        return undefined;
    }
}
quarter.factory = EFQuarter.make;

class EFYear extends EFUnaryOperator {

    static singleton: ExecutableFunction = new EFYear();
    static make(local: EvaluationEnvironment, en: EvaluationNode): ExecutableFunction {
        return EFYear.singleton;
    }

    op(a: any): number {
        if (typeof(a) === "number") {
            var n = new Date(a * 1000).getFullYear()
            return isNaN(n)? undefined: n;
        }
        return undefined;
    }
}
year.factory = EFYear.make;
