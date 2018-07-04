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
/// <reference path="valueType.ts" />
/// <reference path="areaTemplate.ts" />
/// <reference path="evaluationNode.ts" />
/// <reference path="evaluationNode.constructions.ts" />
/// <reference path="evaluationNode.functions.ts" />
/// <reference path="evaluationNode.apply.ts" />
/// <reference path="evaluationNode.values.ts" />
/// <reference path="evaluationNode.areaFunctions.ts" />
/// <reference path="appState.ts" />

enum FunctionNodeType {
    none,
    av,
    boolGate,
    boolMatch,
    qualifiers,
    variant,
    functionApplication,
    compiledFunctionApplication,
    query,
    const,
    orderedSet,
    range,
    subStringQuery,
    comparisonFunction,
    storage,
    pointerStorage,
    messageQueue,
    debugBreak,
    paramStorage,
    write,
    project,
    select,
    cond,
    childAreas,
    stub,
    queryCycle,
    defun,
    negation,
    classOfArea,
    verificationFunction
}

// Set to true whenever the output (type) of a function node changes
var gOutputChanged: boolean;

/**
 * Defines strategy for eliminating variant nodes/qualifiers. E.g., consider
 * the following definitions
 * 
 * qualifier: {q: true},
 * context: {
 *   x: 1,
 *   y: [f, x]
 * },
 * qualifier: {q: false},
 * context: {
 *   x: 2,
 *   y: [g, x]
 * }
 * 
 * We can generate x to be a variant in both expressions for y, or resolve x
 * immediately.
 * 
 * @enum {number}
 */
enum PickQualifiedExpressionStrategy {
    /**
     * Variant nodes are not eliminated.
     */
    dont,
    /**
     * When checking expressions, only eliminate it when it is a variant node
     * and only one variant applies; don't go deeper.
     */
    pickOnlyTopVariant,
    /**
     * When checking expressions, only eliminate it when it is a variant, and
     * create smaller variant nodes if multiple variants apply.
     */
    pickOnlyVariantAndEliminate,
    /**
     * Try to eliminate variants from all expressions inside a defun, as defuns
     * cannot contain variant nodes.
     */
    alwaysPickDefun,
    /**
     * Try to eliminate variants from all expressions.
     */
    alwaysPick
}

var pickQualifiedExpressionStrategy: PickQualifiedExpressionStrategy =
    PickQualifiedExpressionStrategy.pickOnlyTopVariant;

interface ValueTypeChange {
    type: "valueTypeChange";
    origType: ValueType;
    newType: ValueType;
}

interface NrOutputAreasChange {
    type: "nrOutputAreas";
    from: number;
    to: number;
}

type OutputChangeReason = ValueTypeChange | NrOutputAreasChange;

var logTypeChanges: boolean = false;

function signalOutputChange(id: number, reason?: OutputChangeReason): void {
    gOutputChanged = true;
    if (logTypeChanges && reason !== undefined) {
        switch (reason.type) {
          case "valueTypeChange":
            console.log("change: valueType",
                (reason.origType === undefined? "undefined": reason.origType.toString()),
                (reason.newType === undefined? "undefined": reason.newType.toString()));
            break;
          case "nrOutputAreas":
            console.log("change: nrOutputAreas", reason.from, reason.to);
            break;
        }
    }
}

var gCycleNr: number = 0;
var maxNrCycles: number = undefined;
var exportLevel: number = 0;

interface EvaluationNodeFactory {
    // Creates an evaluation node
    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode;
}

var gBuildSeqBreak: {[nr: number]: boolean} = {};

/// Maps qualifiers onto their known value
type QualValue = {[qualifier:string]: any};
/// Maps qualifiers onto their known value per level of embedding
type QualPerTemplate = {[templateId: number]: QualValue};

// Maps areaId, defun and path to a writable node
var gWritableMap: {[areaId: number]: {[defun: number]: {[path: string]: StorageNode}}} = {};

function getWritableNode(localToArea: number, localToDefun: number, path: string[]): StorageNode {
    if (!(localToArea in gWritableMap)) {
        return undefined;
    }
    var areaMap = gWritableMap[localToArea];
    if (!(localToDefun in areaMap)) {
        return undefined;
    }
    var pathStr = path.join(".");
    var node: StorageNode = areaMap[localToDefun][pathStr];
    if (node !== undefined) {
        node.cycleNr = gCycleNr;
    }
    return node;
}

function storeWritableNode(localToArea: number, localToDefun: number, path: string[], node: StorageNode): void {
    var areaMap: {[defun: number]: {[path: string]: StorageNode}} = gWritableMap[localToArea];
    var pathStr: string = path.join(".");

    if (areaMap === undefined) {
        gWritableMap[localToArea] = areaMap = {};
    }
    var defunMap: {[path: string]: StorageNode} = areaMap[localToDefun];
    if (defunMap === undefined) {
        areaMap[localToDefun] = defunMap = {};
    }
    assert(!(pathStr in defunMap), "each writable node should be stored once");
    defunMap[pathStr] = node;
}

function qEqual(q1: SingleQualifier[], q2: SingleQualifier[]): boolean {
    if (q1.length !== q2.length) {
        return false;
    }
    for (var i: number = 0; i < q1.length; i++) {
        var j: number = 0;
        while (j < q1.length &&
               !(q1[i].functionNode === q2[j].functionNode &&
                 q1[i].value === q2[j].value)) {
            j++;
        }
        if (j === q1.length) {
            return false;
        }
    }
    return true;
}

// True when q1 => q2, i.e. is equal or more specific, or q2 is a subset of q1
function qImply(q1: SingleQualifier[], q2: SingleQualifier[]): boolean {
    if (q1.length < q2.length) {
        return false;
    }
    for (var i: number = 0; i < q2.length; i++) {
        var j: number = 0;
        while (j < q1.length &&
               !(q1[j].functionNode === q2[i].functionNode &&
                 q1[j].value === q2[i].value)) {
            j++;
        }
        if (j === q1.length) {
            return false;
        }
    }
    return true;
}

// Adds a single qualifier list if it isn't present yet
// Keeps list of function nodes dependent on the qualifiers
function qOr(qs: SingleQualifier[][], q: SingleQualifier[], functionNodes: FunctionNode[][], functionNode: FunctionNode): void {
    if (q === undefined || q.length === 0) {
        return;
    }
    for (var i: number = 0; i < qs.length; i++) {
        if (qEqual(qs[i], q)) {
            if (functionNodes !== undefined) {
                functionNodes[i].push(functionNode);
            }
            return;
        }
    }
    qs.push(q);
    if (functionNodes !== undefined) {
        functionNodes.push([functionNode]);
    }
}

function qsEqual(qs1: SingleQualifier[][], qs2: SingleQualifier[][]): boolean {
    if (qs1.length !== qs2.length) {
        return false;
    }
    for (var i: number = 0; i < qs1.length; i++) {
        for (var j: number = 0; j < qs2.length; j++) {
            if (qEqual(qs1[i], qs2[j])) {
                break;
            }
        }
        if (j === qs2.length) {
            return false;
        }
    }
    return true;
}

// Combines two qualifiers lists; returns undefined on contradiction
function qAnd(q1: SingleQualifier[], q2: SingleQualifier[]): SingleQualifier[] {
    var q: SingleQualifier[] = [];

    for (var i1: number = 0; i1 < q1.length; i1++) {
        var qi1: SingleQualifier = q1[i1];
        for (var i2: number = 0; i2 < q2.length; i2++) {
            var qi2: SingleQualifier = q2[i2];
            if (qi1.functionNode === qi2.functionNode) {
                if (qi1.value === qi2.value) {
                    q.push(qi1);
                    break;
                } else if (typeof(qi1.value) === "boolean" &&
                           typeof(qi2.value) !== "boolean") {
                    if (qi1.value !== true) {
                        return undefined; // cannot match in same qualifier
                    }
                    q.push(qi2);
                    break;
                } else if (typeof(qi1.value) !== "boolean" &&
                           typeof(qi2.value) === "boolean") {
                    if (qi2.value !== true) {
                        return undefined; // cannot match in same qualifier
                    }
                    q.push(qi1);
                    break;
                } else {
                    return undefined;
                }
            }
        }
        if (i2 === q2.length) {
            q.push(qi1);
        }
    }
    for (var i2: number = 0; i2 < q2.length; i2++) {
        var qi2: SingleQualifier = q2[i2];
        for (var i1: number = 0; i1 < q1.length; i1++) {
            var qi1: SingleQualifier = q1[i1];
            if (qi2.functionNode === qi1.functionNode) {
                // already handled
                break;
            }
        }
        if (i1 === q1.length) {
            q.push(qi2);
        }
    }
    return q;
}

function subSetOf<T>(s1: T[], s2: T[]): boolean {
    return s1.every((e) => {
        return s2.indexOf(e) !== -1;
    });
}

function equalSets<T>(s1: T[], s2: T[]): boolean {
    return subSetOf(s1, s2) && subSetOf(s2, s1);
}

// Rewrites {q1: true, Q} => v, ..., {q1: false, Q} => v to {Q} => v, since the
// function node apparently does not depend on the value of q1.
function qSimplify(qs: SingleQualifier[][], functionNodes: FunctionNode[][]): SingleQualifier[][] {
    var change: boolean = true;
    //var cycle: number = 0;

    // Find a qualifier that is true in one and false in the other
    function findPartQual(q1: SingleQualifier[], q2: SingleQualifier[]): number {
        for (var i: number = 0; i < q1.length; i++) {
            if (typeof(q1[i].value) === "boolean") {
                for (var j: number = 0; j < q2.length; j++) {
                    if (q1[i].functionNode === q2[j].functionNode &&
                          typeof(q2[j].value) === "boolean" &&
                          q1[i].value !== q2[j].value) {
                        return i;
                    }
                }
            }
        }
        return -1;
    }

    while (change) {
        change = false;
        //cycle++;
        for (var i: number = 0; !change && i < qs.length; i++) {
            for (var j: number = i + 1; !change && j < qs.length; j++) {
                if (functionNodes === undefined || equalSets(functionNodes[i], functionNodes[j])) {
                    var partQual: number = findPartQual(qs[i], qs[j]);
                    if (partQual !== -1) {
                        // Qualifier minus identified one
                        var nq: SingleQualifier[] = qs[i].slice(0, partQual).concat(qs[i].slice(partQual + 1));
                        // Remove i and j from qs,
                        qs = qs.slice(0, i).concat(qs.slice(i+1, j)).concat(qs.slice(j+1));
                        if (nq.length > 0) {
                            // append qs[i] minus the identified qualifier
                            qOr(qs, nq, undefined, undefined);
                        }
                        // and restart
                        change = true;
                    }
                }
            }
        }
    }
    return qs;
    // Sorting fails: at some point, it leads to a stack overflow in sort,
    // even though the array size seems to be 0. Comparison is just a bit
    // more work without it.
    // return qs.sort(compareQualifierTermArrays);
}

abstract class FunctionNode implements EqualityTest, EvaluationNodeFactory {

    // The cache stores function nodes per area template id, but also per
    // defun, in order to avoid overlap between expressions in different
    // defuns.
    static globalFunctionNodes: FunctionNode[] = [];
    static globalDefunFunctionNodes: {[defunNr: number]: FunctionNode[]} = {};

    static seqNr: number = 1;
    seqNr: number;

    // The position in the cache, which will be used as the id at runtime.
    // Negative numbers are not supposed to be output for use at runtime, and
    // have the following value (only useful for debugging):
    // -1: not in cache
    // -2: removed from cache during compaction
    // -3: a stub node
    // -4: a replaced stub node
    // -5: a query cycle node
    // -6: id set during variant cycle check
    id: number;

    // If this number is not the current cycleNr, this should be recomputed.
    cycleNr: number;

    // initialid: number; // only for debugging purposes

    // priority; nodes in write triggers get their priority set to 1
    prio: number = Priority.normalPriority;
    // maximum distance to bottom of tree; cannot be lower than the existence
    // and data expressions of its area
    scheduleStep: number;
    // When true, this node is possibly scheduled before its inputs have
    // completed.
    schedulingError?: boolean;

    // if undefined or 0, this node is global; otherwise it's local to the
    // template with the same id
    localToArea: number;
    // if non zero, this node belongs to a defun body. Defun body expressions go
    // in the cache of their area, but are treated differently.
    localToDefun: number;
    // If true, the value is constant
    isConstant?: boolean;

    // The type of the value of this function node
    valueType: ValueType;

    // if true, do not convert to array at runtime
    suppressSet: boolean;

    // When true, this function node can be reached from a write:to: and is
    // writable or leads to a writable path
    writable: boolean = false;
    // Checking writability is queued to avoid cycles. This member indicates
    // if this node is in the queue, or possibly already out (true) or not
    // (undefined/false).
    writeCheckStatus: boolean;
    // Indicates if there is a StorageNode reachable from this node. E.g., a
    // variant or query on a StorageNode set this to true, while functions
    // like [plus] don't, because they don't allow write-through.
    hasWritableReference: boolean = false;

    origExpr: Expression; // Pointer to the original expression; debugging only
    rewrite: Expression; // storage for rewritten expressions

    constructor(localToArea: number, localToDefun: number, valueType: ValueType, origExpr: Expression) {
        this.id = -1;
        this.localToArea = localToArea;
        this.localToDefun = localToDefun;
        this.valueType = valueType;
        this.origExpr = origExpr;
        this.cycleNr = gCycleNr;
        this.seqNr = FunctionNode.seqNr++;
        if (this.seqNr in gBuildSeqBreak) {
            debugger;
        }
    }

    toString(): string {
        return "unknown FunctionNode";
    }

    toErrorString(): string {
        return this.origExpr !== undefined? this.origExpr.toCdlString(): this.toString();
    }

    toFullString(): string {
        return this.toString();
    }

    abstract toCDLString(indent: string): string;

    formatList(args: (string|FunctionNode)[], firstArgInline: boolean, indent: string, parentheses: string): string {
        if (args.length === 0) {
            return parentheses;
        }
        var firstArg: string = typeof(args[0]) === "string"? <string>args[0]: (<FunctionNode>args[0]).toCDLString(undefined); 
        var nIndent: string = indent !== undefined? indent + "    ": undefined;
        var str: string = indent === undefined || firstArgInline?
            parentheses[0] + firstArg: parentheses[0] + "\n" + nIndent + firstArg;

        for (var i = 1; i < args.length; i++) {
            if (indent === undefined) {
                str += ", ";
            } else {
                str += ",\n" + nIndent;
            }
            str += typeof(args[i]) === "string"? args[i]: (<FunctionNode>args[i]).toCDLString(nIndent);
        }
        return indent === undefined || (args.length === 1 && firstArgInline)?
               str + parentheses[1]: str + "\n" + indent + parentheses[1];
    }

    formatArray(args: (string|FunctionNode)[], firstArgInline: boolean, indent: string): string {
        return this.formatList(args, firstArgInline, indent, "[]");
    }

    formatCDLFunctionCall(functionName: string, args: FunctionNode[], indent: string): string {
        return this.formatArray([<string|FunctionNode>functionName].concat(args), true, indent);
    }

    formatCDLConstructor(functionName: string, args: FunctionNode[], indent: string): string {
        return functionName + this.formatList(args, false, indent, "()");
    }

    abstract toExportString(origin: number): string;

    constructPrototypeFunctionCall(origin: number): string {
        var str: string = this.toExportString(origin);

        if (this.writable && this.isWritableAware()) {
            str += "\n_owp(" + this.localityString() + ")";
        }
        if (this.prio !== Priority.normalPriority &&
              !(this instanceof ConstNode)) {
            str += "\n_sp(" +
                (this.localToDefun? String(this.localToDefun): "0") + ", " +
                this.prio + ")";
        }
        if ("schedulingError" in this) {
            str += "\n_se(" + this.localityString() + ")";
        }
        return str;
    }

    type(): FunctionNodeType {
        return FunctionNodeType.none;
    }

    // When two expressions are part of an area, or part of the same defun,
    // they have the same "variant locality". The goal of this function is to
    // limit the number of expressions created by pickQualifiedExpression.
    hasSameVariantLocalityAs(fn: FunctionNode): boolean {
        return (this.localToDefun === 0 && fn.localToDefun === 0) ||
               (this.localToArea === fn.localToArea &&
                this.localToDefun === fn.localToDefun);
    }

    isEqual(fn: FunctionNode): boolean {
        return this === fn ||
            (this.type() === fn.type() &&
             this.localToArea === fn.localToArea &&
             this.localToDefun === fn.localToDefun &&
             ((this.id >= 0 && fn.id >= 0 && this.id === fn.id) ||
              (!(this.id >= 0 && fn.id >= 0) && this.specificEqual(fn))));
    }

    // To be filled in by the derived class
    specificEqual(fn: FunctionNode): boolean {
        return false;
    }
    
    // maximum id in cache of the inputs
    abstract getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number;

    // Returns the maximum schedule step for this and fn
    maxScheduleStep(prio: number, scheduleStep: number): number {
        assert(this.prio >= prio, "inputs should not have lower priority");
        return this.prio > prio? scheduleStep:
            this.scheduleStep > scheduleStep? this.scheduleStep:
            scheduleStep;
    }

    isScheduledBefore(fn: FunctionNode): boolean {
        return this.prio > fn.prio ||
               (this.prio === fn.prio && this.scheduleStep < fn.scheduleStep);
    }

    isScheduledProperly(): boolean {
        return this.allInputs().every((fn: FunctionNode): boolean => {
            return !("schedulingError" in fn) && fn.isScheduledBefore(this);
        });
    }
    
    // Set the flag schedulingError for all inputs, down to the bottom.
    setSchedulingError(): void {
        if (!this.schedulingError) {
            this.schedulingError = true;
            this.allInputs().forEach(function (fn: FunctionNode): void {
                fn.setSchedulingError();
            });
        }
    }
    
    isEmptyOS(): boolean {
        return false;
    }

    isAlwaysTrue(): boolean {
        return false;
    }

    isAlwaysFalse(): boolean {
        return false;
    }

    isUnmergeable(): boolean {
        return false;
    }

    isNull(): boolean {
        return false;
    }

    isAlwaysUndefined(): boolean {
        return false;
    }

    // Returns the template id of the single area that this expression can
    // (conditionally) yield, and undefined otherwise. So if this expression is
    // if x then [me]; if y then [me], then the template id for [me] should be
    // returned.
    conditionalSingleArea(): number {
        return undefined;
    }

    // If conditionalSingleArea() returns a template id, this function replaces
    // the results with a new result. The goal is to replace [{x: _}, [f, a1,
    // ...]]  with [f, [{x: _}, area], [{x: _}, area], ...]. The reason is that
    // it avoid areas importing their own values, which helps efficiency a bit.
    replaceConditionalResult(fn: FunctionNode, origin: number): FunctionNode {
        return this;
    }

    // Should be implemented by derived classes. At the moment, only the
    // QualifierFunctionNode overrides it; deeper dependencies are overlooked.
    dependsOn(contextLabel: string, level: number): boolean {
        return false;
    }

    /// Stack of recursively cached function nodes for debugging cycles in caching
    static cacheDbg: any[] = [];
    /// Triggers cycle analysis. Can be changed via the command line
    static maxCacheDepth: number = 2500;

    static cache2str(): string {
        return FunctionNode.cacheDbg.map(function(v: any, i: number): string {
            var info: string;

            if (v instanceof FunctionNode) {
                info = String(i) + ". " + v.idStr() + " " + v.toString();
            } else if (v instanceof AreaTemplate) {
                info = String(i) + ". template " + v.id + " " +
                    getShortChildPath(v.areaNode.getPath()) + " stage: " +
                    v.cacheStage[i];
            } else {
                info = "<unknown>";
            }
            return info;
        }).reverse().join("\n");
    }

    static printCycleError(cycleLength: number): void {
        for (var i = FunctionNode.cacheDbg.length - cycleLength; i < FunctionNode.cacheDbg.length; i++) {
            var v = FunctionNode.cacheDbg[i];
            var info: string;
            if (v instanceof FunctionNode) {
                info = String(i) + ". " + v.idStr() + " " + v.toErrorString();
            } else if (v instanceof AreaTemplate) {
                info = String(i) + ". template " + v.id + " " +
                    getShortChildPath(v.areaNode.getPath()) + " stage: " +
                    v.cacheStage[i];
            } else {
                info = "<unknown>";
            }
            console.log("// loop:", info);
        }
    }

    static cycleAnalysis(): boolean {
        var arr = FunctionNode.cacheDbg;
        var cacheLen: number = arr.length;

        // Compare arr[cacheLen - 2*cycleLength..cacheLen - cycleLength] with
        // arr[cacheLen - cycleLength..cacheLen] for all possible values of
        // cycleLength. If the two consecutive segments match, there is a loop.
        for (var cycleLength = 1; cycleLength < cacheLen / 2; cycleLength++) {
            var segmentsEqual: boolean = true;
            var segment1Offset: number = cacheLen - cycleLength;
            var segment2Offset: number = cacheLen - 2 * cycleLength;
            for (var i = 0; segmentsEqual && i < cycleLength; i++) {
                segmentsEqual = arr[segment1Offset + i] ===
                                arr[segment2Offset + i];
            }
            if (segmentsEqual) {
                Utilities.syntaxError("Cycle error");
                FunctionNode.printCycleError(cycleLength);
                return true;
            }
        }
        return false;
    }

    /// Returns index in cacheDbg (from top); top node is ignored, since it
    /// probably contains fn.
    static findInCacheStack(fn: FunctionNode, start: number): number {
        for (var i = FunctionNode.cacheDbg.length - start - 1; i >= 0; i--) {
            if (FunctionNode.cacheDbg[i] === fn) {
                return FunctionNode.cacheDbg.length - i;
            }
        }
        return -1;
    }

    static variantCycleCheck(fn: FunctionNode, stack: NumberSet, isEndNode: boolean): FunctionNode {
        assert(fn === undefined || fn.cycleNr === gCycleNr, "debugging");
        if (fn === undefined || fn.id === -6 || fn.id >= 0) {
            return fn;
        }
        if (FunctionNode.cacheDbg !== undefined) {
            FunctionNode.cacheDbg.push(fn);
            if (FunctionNode.cacheDbg.length >= FunctionNode.maxCacheDepth) {
                if (FunctionNode.cycleAnalysis()) {
                    return fn;
                }
            }
        }
        if (fn instanceof StubFunctionNode) {
            return FunctionNode.variantCycleCheck(fn.resolution, stack, isEndNode);
        }
        try {
            fn.getMaximumInputId(stack, FunctionNode.variantCycleCheck, false); // result not needed
        } catch (e) {
            if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
            throw e;            
        }
        fn.id = -6;
        fn.postCache(stack, FunctionNode.variantCycleCheck);
        if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
        return fn;
    }

    static cache(fn: FunctionNode, stack: NumberSet, isEndNode: boolean): FunctionNode {
        assert(fn === undefined || fn.cycleNr === gCycleNr, "debugging");
        if (fn === undefined || fn.id >= 0) {
            return fn;
        }
        if (FunctionNode.cacheDbg !== undefined) {
            FunctionNode.cacheDbg.push(fn);
            if (FunctionNode.cacheDbg.length >= FunctionNode.maxCacheDepth) {
                if (FunctionNode.cycleAnalysis()) {
                    return fn;
                }
            }
        }
        if (fn instanceof StubFunctionNode) {
            return FunctionNode.cache(fn.resolution, stack, isEndNode);
        }
        var cache: FunctionNode[];
        if (!fn.localToArea) {
            if (!fn.localToDefun) {
                cache = FunctionNode.globalFunctionNodes;
            } else {
                if (fn.localToDefun in FunctionNode.globalDefunFunctionNodes) {
                    cache = FunctionNode.globalDefunFunctionNodes[fn.localToDefun];
                } else {
                    FunctionNode.globalDefunFunctionNodes[fn.localToDefun] = cache = [];
                }
            } 
        } else {
            var template: AreaTemplate = areaTemplates[fn.localToArea];
            assert(template.doesExist, "no cache for non-existing templates");
            if (!fn.localToDefun) {
                cache = template.functionNodes;
            } else {
                if (fn.localToDefun in template.defunFunctionNodes) {
                    cache = template.defunFunctionNodes[fn.localToDefun];
                } else {
                    cache = [];
                    template.defunFunctionNodes[fn.localToDefun] = cache;
                }
            }
        }
        var mid: number = fn.getMaximumInputId(stack, FunctionNode.cache, true);
        for (var i = mid + 1; i < cache.length; i++) {
            var n: FunctionNode = cache[i];
            if (fn.isEqual(n)) {
                // Note: empty os's are allowed to have different types
                if (!isEndNode && !fn.valueType.isEqualOrUnknown(n.valueType) &&
                      !(fn.isEmptyOS() && n.isEmptyOS())) {
                    Utilities.error("different valueType in cache for #" +
                                    fn.seqNr + " and #" + n.seqNr + ": " +
                                    n.toString());
                }
                if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
                return n;
            }
        }
        fn.id = cache.length;
        cache.push(fn);
        if (!fn.isScheduledProperly()) {
            // Note that this flag can also be set by setSchedulingError()
            fn.schedulingError = true;
        }
        fn.postCache(stack, FunctionNode.cache);
        if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
        return fn;
    }

    /**
     * Executed after procssing this node. Meant for defun nodes to allow
     * caching their body while having access to the cached defun itself.
     * Does not allow for mutual recursion.
     */ 
    postCache(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): void {
    }

    static cacheDirectly(fn: FunctionNode): FunctionNode {
        var cache = !fn.localToArea? FunctionNode.globalFunctionNodes:
            areaTemplates[fn.localToArea].functionNodes;

        for (var i = 0; i < cache.length; i++) {
            var n: FunctionNode = cache[i];
            if (fn.isEqual(n)) {
                if (!fn.valueType.isEqualOrUnknown(n.valueType)) {
                    Utilities.error("different valueType in cache");
                }
                return n;
            }
        }
        fn.id = cache.length;
        cache.push(fn);
        return fn;
    }

    idStr(): string {
        return (this.id !== -1? "%" + this.id: "#" + this.seqNr) +
            (this.localToArea? "L" + this.localToArea: "G") +
            (this.localToDefun? "D" + this.localToDefun: "") +
            (this.writable? "<W>": "");
    }

    localityString(): string {
        return String(this.scheduleStep) + ", " +
            (this.localToDefun? String(this.localToDefun): "0");
    }

    // Returns string representation matching FNRef. Function calls differ
    // for passing on parameters regarding suppressSet and localToDefun
    idExpStr(origin: number, suppressSet: boolean = undefined): string {
        var funName: string = "_n";

        switch (suppressSet) {
          case false: funName += "f"; break;
          case true: funName += "t"; break;
        }
        if (this.localToDefun) {
            funName += "d";
        }
        assert(this.id >= 0, "should be cached by now");
        return funName + "(" + String(this.getEmbeddingLevel(origin)) +
            (this.localToDefun? "," + String(this.localToDefun) + ",": ",") + 
            this.id + ")";
    }

    // Returns the number of embedding levels that the expression differs from
    // the current area
    getEmbeddingLevel(areaId: number): number {
        if (this.localToArea === undefined) {
            return undefined;
        } else {
            var nr: number = 0;
            while (areaId !== this.localToArea) {
                areaId = areaTemplates[areaId].parent.id;
                nr++;
            }
            return nr;
        }
    }

    outputStr(): string {
        return this.valueType === undefined? "<UNDEFINED>":
            this.valueType.toString();
    }

    isSingleString(): boolean {
        return false;
    }

    updateOutput(o: ValueType): void {
        if (this.valueType === undefined || !this.valueType.isEqual(o)) {
            signalOutputChange(undefined, {
                type: "valueTypeChange",
                origType: this.valueType,
                newType: o
            });
            this.valueType = o;
        }
    }

    mergeOutput(o: ValueType): void {
        if (this.valueType === undefined) {
            signalOutputChange(undefined, {
                type: "valueTypeChange",
                origType: undefined,
                newType: o
            });
            this.valueType = o;
        } else if (!this.valueType.subsumes(o)) {
            var mergeType = this.valueType.merge(o);
            signalOutputChange(undefined, {
                type: "valueTypeChange",
                origType: this.valueType,
                newType: mergeType
            });
            this.valueType = mergeType;
        }
    }

    outdated(): boolean {
        return this.cycleNr !== gCycleNr;
    }

    updateCycle(): void {
        if (this.cycleNr !== gCycleNr) {
            this.cycleNr = gCycleNr;
            this.writable = false;
        }
    }

    // Puts the nodes that it might write through in a queue for checking
    abstract markWritablePath(): void;

    // Called when all nodes that were put in the queue have been processed.
    // Should determine if this node is writable or not.
    abstract checkWritability(): void;

    // Returns true when the out file has to mark the node as "on writable path"
    isWritableAware(): boolean {
        return false;
    }

    // A queue of function nodes that want their writability checked. A node
    // appears after the nodes it depends upon.
    static writabilityQueue: FunctionNode[] = [];

    writabilityUndetermined(): boolean {
        if (this.writeCheckStatus) {
            return false;
        }
        this.writeCheckStatus = true;
        return true;
    }

    // Marks current node and all its inputs with the given priority.  Should
    // check if priority doesn't get lowered, or is equal to new priority, since
    // there are cycles: an expression may be dependent on an area projection of
    // an template that is higher or dependent on this node's template.
    abstract setPriority(prio: number): void;

    // Creates an evaluation node from this as the prototype. When derived
    // classes don't override it, a large switch statement in
    // buildEvaluationNode() takes over.
    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        return undefined;
    }

    // Returns all inputs to this node. Note that this includes all static
    // relations. Area projections returns all the matching templates'
    // expressions.
    abstract allInputs(): FunctionNode[];

    // Returns all inputs local to this node, so excludes nodes exported by
    // other areas.
    allLocalInputs(): FunctionNode[] {
        return this.allInputs();
    }

    // Can return three values:
    // true: this expression always returns the same value for the same
    //       inputs
    // false: this expression can change
    // undefined: locally constant, globally not.
    // The latter is the case for area projections.
    functionIsConstant(): boolean {
        return true;
    }

    // Returns true when a function is compile-time constant
    getConstancy(): boolean {
        var c: boolean;

        if ("isConstant" in this) {
            return this.isConstant;
        }
        this.isConstant = false;
        c = this.functionIsConstant();
        var allInputs: FunctionNode[] = this.allInputs();
        for (var i: number = 0; i !== allInputs.length; i++) {
            if (allInputs[i] !== undefined) {
                switch (allInputs[i].getConstancy()) {
                  case undefined:
                    if (c === true) {
                        c = undefined;
                    }
                    break;
                  case false:
                    c = false;
                    break;
                }
            }
        }
        this.isConstant = c;
        return c;
    }

    // Returns true if the this and fn can be merged given they have subsequent
    // priorities and identical qualifiers. This is false for most function
    // nodes.
    canMergeUnderQualifier(fn: FunctionNode): boolean {
        return false;
    }

    // Performs a merge between this and fn, such that the outcome of 
    // this will be identical to [merge, this, fn] at runtime.
    mergeUnderQualifier(fn: FunctionNode): FunctionNode {
        Utilities.error("implement in derived class when canMergeUnderQualifier returns true");
        return undefined;
    }

    // Returns a hopefully smaller function node that evaluates to the same
    // value when q is true.
    // TODO: see if pushing it further down to function arguments etc has
    // any benefit.
    valueUnderQualifier(q: SingleQualifier[], nq: SingleQualifier[][]): FunctionNode {
        return this;
    }

    // Return the function with known qualifiers removed. Not just for
    // optimization, but needed to avoid cycles where two attributes depend on
    // each other but not for the same qualifier, e.g.
    // qualifier: {x: 1},
    //   context: { a: [..., [{b: _}, [me]], ...], b: 10 }
    // qualifier: {x: 2},
    //   context: { a: 20, b: [..., [{a: _}, [me]], ...] }
    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        return this;
    }

    containsQualifiedExpression: boolean = true;

    checkForQualifiedExpressions(): void {
        if (doCompileTimeChecks) {
            var localInputs: FunctionNode[] = this.allLocalInputs();
            for (var i: number = 0; i < localInputs.length; i++) {
                var input: FunctionNode = localInputs[i];
                if (input.containsQualifiedExpression) {
                    this.containsQualifiedExpression = true;
                    return;
                }
            }
            this.containsQualifiedExpression = false;
        }
    }

    isQualifiedFor(knownTrueQualifiers: SingleQualifier[]): boolean {
        return knownTrueQualifiers !== undefined && this.containsQualifiedExpression;
    }

    // Returns the list of attribute paths that make up a sort key. This
    // function works for constant, os and av nodes. Dynamic sortkeys (paths
    // that change during runtime) are not supported.
    getSortKeys(): string[][] {
        Utilities.syntaxError("area sorting only supported with known paths");
        return [];
    }

    // Returns a function node that yields the same bool interpretation as this
    getBoolInterpretation(): FunctionNode {
        return "dataSource" in this.valueType?
            FunctionApplicationNode.buildFunctionApplication(
                bool, [this], this.localToArea, this.localToDefun,
                undefined, undefined):
            this;
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
    }

    removePairPointElementMe(origin: number, stage: number): FunctionNode {
        return this;
    }

    // Returns the set of all qualifiers that determine the value of this.
    // For non-local function nodes, it returns the empty set. Note that for
    // simplification, this function node just depends on eh ...
    // TODO: defuns
    getFullQualifierList(origin: number, cache: SingleQualifier[][][]): SingleQualifier[][] {
        if (this.localToArea !== origin) {
            return [];
        }
        if (cache[this.id] !== undefined) {
            return cache[this.id];
        }
        assert(cache.length === this.id, "debug");
        cache.push([]);
        var qs: SingleQualifier[][] = [];
        var inputs: FunctionNode[] = this.allLocalInputs();
        for (var i: number = 0; i < inputs.length; i++) {
            var qsi: SingleQualifier[][] = inputs[i].getFullQualifierList(origin, cache);
            if (qsi.length !== 0) {
                if (qs.length === 0) {
                    qs = qsi;
                } else {
                    var qprod: SingleQualifier[][] = [];
                    for (var j: number = 0; j < qsi.length; j++) {
                        for (var k: number = 0; k < qs.length; k++) {
                            qOr(qprod, qAnd(qsi[j], qs[k]), undefined, undefined);
                        }
                    }
                    qs = qprod;
                }
            }
        }
        cache.pop();
        assert(cache.length === this.id, "debug");
        return qSimplify(qs, undefined);
    }

    traceDataSource(seen: {[seqNr: number]: boolean}): void {
        var dsInputs: FunctionNode[] = this.getDataSourceInputs();
        var v: {[seqNr: number]: boolean} = {};

        if (!(this.seqNr in seen)) {
            var fn: any = this;
            seen[this.seqNr] = true;
            console.log(this.seqNr + ' [label="' + this.idStr() + '"];');
            for (var i: number = 0; i < dsInputs.length; i++) {
                var input: FunctionNode = dsInputs[i];
                if (!(input.seqNr in v)) {
                    var label: string = undefined;
                    v[input.seqNr] = true;
                    if (fn instanceof VariantFunctionNode) {
                        label = fn.qualifiers.qualifiersToCDLString(i);
                    }
                    console.log(this.seqNr + ' -> ' + input.seqNr + 
                                (label === undefined? '': ' [label="' + label + '"]') +
                                ';');
                    input.traceDataSource(seen);
                }
            }
        }
    }

    abstract getDataSourceInputs(): FunctionNode[];

    // Tells the node it has been put in a stub. The default is ignoring, but
    // see QualifierFunctionNode.
    markAsResolution(stub: StubFunctionNode): FunctionNode {
        return this;
    }

    // Returns the function that evaluates the condition for the presence of
    // the template in the result of this.
    getExistenceConditionForTemplate(template: AreaTemplate): FunctionNode {
        return undefined;
    }

    isStrictSelection(): boolean {
        return this.valueType.isStrictSelection();
    }

    // Returns the list of StorageNodes that are (potentially) at the end of a
    // write to this node in order to update their valueType.
    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        return [];
    }

    localityCompatibleWith(fn: FunctionNode): boolean {
        return testMergeLocality(this.localToArea, fn.localToArea) &&
               testMergeDefunLocality(this.localToDefun, fn.localToDefun);
    }

    // Returns a FunctionNode with wontChangeValue cleared
    mightChange(): FunctionNode {
        return this;
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
        this.setExpressionPathTag(path);
    }

    setExpressionPathTag(path: string): void {
        var templateId: number = this.localToArea === undefined? 0: this.localToArea;
        var defunId: number = this.localToDefun;
        var nodeId: number = this.id;
        var templateTags = functionNodeToExpressionPaths[templateId];
        var templateDefunTags: number[][] = templateTags[defunId];

        if (templateDefunTags === undefined) {
            templateDefunTags = templateTags[defunId] = [];
        }
        var templateDefunNodeTags: number[]= templateDefunTags[nodeId];
        if (templateDefunNodeTags === undefined) {
            templateDefunNodeTags = templateDefunTags[nodeId] = []
        }
        for (var i = 0; i < templateDefunNodeTags.length; i += 2) {
            if (templateDefunNodeTags[i] === templateId &&
                  functionNodeToExpressionPathsStringCache[templateDefunNodeTags[i + 1]] === path) {
                return;
            }
        }
        templateDefunNodeTags.push(templateId);
        templateDefunNodeTags.push(this.getFunctionNodeStringCacheId(path));
    }

    static functionNodeStringCacheMap: {[path: string]: number} = {};

    getFunctionNodeStringCacheId(path: string): number {
        var nr: number = FunctionNode.functionNodeStringCacheMap[path];

        if (nr === undefined) {
            nr = functionNodeToExpressionPathsStringCache.length;
            FunctionNode.functionNodeStringCacheMap[path] = nr;
            functionNodeToExpressionPathsStringCache.push(path);
        }
        return nr;
    }
}

// Combined local area of dep1 and dep2; error if not compatible.
// If dep1 is an ancestor of dep2 (or vice versa), the result is the
// dep2 (dep1).
function mergeLocality(dep1: number, dep2: number): number {
    if (dep1 === undefined) {
        return dep2;
    } else if (dep2 === undefined) {
        return dep1;
    }
    if (dep1 !== dep2) {
        var lowId: number = Math.min(dep1, dep2);
        var highId: number = Math.max(dep1, dep2);
        var templateId: number = highId;
        // assuming a child id is higher than its parent's id
        while (templateId > lowId) {
            templateId = areaTemplates[templateId].parent.id;
        }
        if (templateId !== lowId) {
            Utilities.error("incompatible locality");
        }
        return highId;
    }
    return dep1;
}

// Returns false when the two localities cannot be merged
function testMergeLocality(dep1: number, dep2: number): boolean {
    if (dep1 !== undefined && dep2 !== undefined && dep1 !== dep2) {
        var lowId: number = Math.min(dep1, dep2);
        var highId: number = Math.max(dep1, dep2);
        var templateId: number = highId;
        // assuming a child id is higher than its parent's id
        while (templateId > lowId) {
            templateId = areaTemplates[templateId].parent.id;
        }
        if (templateId !== lowId) {
            return false;
        }
    }
    return true;
}

// If dep1 is nested in dep2 or vice versa, return the deepest level defun
function mergeDefunLocality(dep1: number, dep2: number): number {
    if (dep1 === 0) {
        return dep2;
    } else if (dep2 === 0) {
        return dep1;
    }
    var depthDep1: number = gDefunStack.lastIndexOf(dep1);
    var depthDep2: number = gDefunStack.lastIndexOf(dep2);
    assert(depthDep1 >= 0 && depthDep2 >= 0, "not on defun stack");
    return depthDep1 > depthDep2? dep1: dep2;
}

// Returns false when defuns cannot be merged
function testMergeDefunLocality(dep1: number, dep2: number): boolean {
    if (dep1 === 0 || dep2 === 0) {
        return true;
    }
    var depthDep1: number = gDefunStack.lastIndexOf(dep1);
    var depthDep2: number = gDefunStack.lastIndexOf(dep2);
    return depthDep1 >= 0 && depthDep2 >= 0;
}

class AVFunctionNode extends FunctionNode {

    attributes: {[attribute: string]: FunctionNode};
    suppressSetAttr: {[attr: string]: boolean};

    constructor(attributes: {[attribute: string]: FunctionNode},
                locality: number, defun: number, valueType: ValueType,
                origExpr: Expression, suppressSet: boolean,
                suppressSetAttr: {[attr: string]: boolean}) {
        super(locality, defun, valueType, origExpr);
        this.attributes = attributes;
        this.suppressSet = suppressSet;
        this.suppressSetAttr = suppressSetAttr;
        this.checkForQualifiedExpressions();
    }

    type(): FunctionNodeType {
        return FunctionNodeType.av;
    }

    specificEqual(fn: AVFunctionNode): boolean {
        if (!!this.suppressSet !== !!fn.suppressSet) {
            return false;
        }
        for (var attr in fn.attributes) {
            if (!(attr in this.attributes)) {
                return false;
            }
        }
        for (var attr in this.attributes) {
            if (!(attr in fn.attributes) ||
                !(this.attributes[attr].isEqual(fn.attributes[attr]))) {
                return false;
            }
        }
        return true;
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        for (var attr in this.attributes) {
            this.attributes[attr] = process(this.attributes[attr], stack, false);
            if (this.attributes[attr].localToArea === this.localToArea &&
                  this.attributes[attr].id > mid) {
                mid = this.attributes[attr].id;
            }
            scheduleStep =
                this.attributes[attr].maxScheduleStep(this.prio, scheduleStep);
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        var str = "{";

        for (var attr in this.attributes) {
            if (str.length !== 1) str += ", ";
            str += attr + ":" + this.attributes[attr].idStr();
        }
        return str + "}";
    }

    toFullString(): string {
        var str = "{";

        for (var attr in this.attributes) {
            if (str.length !== 1) str += ", ";
            str += attr + ":" + this.attributes[attr].toFullString();
        }
        return str + "}";
    }

    toCDLString(indent: string = undefined): string {
        var str = "{";
        var nIndent: string = indent !== undefined? indent + "  ": undefined;
        var nIndent2: string = indent !== undefined? indent + "    ": undefined;

        for (var attr in this.attributes) {
            if (nIndent !== undefined) {
                if (str.length !== 1) str += ",";
                str += "\n" + nIndent;
            } else {
                if (str.length !== 1) str += ", ";
            }
            str += attr + ": " + this.attributes[attr].toCDLString(nIndent2);
        }
        return indent === undefined? str + "}":
               str + "\n" + indent + "}";
    }

    toExportString(origin: number): string {
        var str: string = "_a(" + this.localityString() + ", {";
        var first: boolean = true;

        for (var attr in this.attributes) {
            var attrStr: string =
                jsIdentifierRegExp.test(attr) && attr !== "class"?
                attr: JSON.stringify(attr);
            if (!first) str += ", "; else first = false;
            str += attrStr + ":" +
                this.attributes[attr].idExpStr(origin, this.suppressSetAttr[attr]);
        }
        return str + "}, " + String(this.suppressSet) + ")";
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            for (var attr in this.attributes) {
                this.attributes[attr].markWritablePath();
            }
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        for (var attr in this.attributes) {
            if (this.attributes[attr].writable) {
                this.writable = true;
                return;
            }
        }
    }

    setPriority(prio: number): void {
        this.prio = prio;
        for (var attr in this.attributes) {
            this.attributes[attr].setPriority(prio);
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationAV(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var attr in this.attributes) {
            evalNode.addAttribute(attr, getEvaluationNode(this.attributes[attr], local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return objValues(this.attributes);
    }

    canMergeUnderQualifier(fn: FunctionNode): boolean {
        if (!(fn instanceof AVFunctionNode) ||
              this.localToArea !== fn.localToArea ||
              this.localToDefun !== fn.localToDefun ||
              this.isConstant !== fn.isConstant ||
              this.suppressSet !== fn.suppressSet) {
            return false;
        }
        var an = <AVFunctionNode> fn;
        var attr: string;

        // Note that only common attributes matter
        for (attr in this.suppressSetAttr) {
            if (attr in an.suppressSetAttr &&
                  this.suppressSetAttr[attr] !== an.suppressSetAttr[attr]) {
                return false;
            }
        }
        for (attr in this.attributes) {
            if (attr in an.attributes &&
                  !this.attributes[attr].
                      canMergeUnderQualifier(an.attributes[attr])) {
                return false;
            }
        }
        return true;
    }

    // Performs a merge between this and fn, such that the outcome of 
    // this will be identical to [merge, this, fn] at runtime.
    mergeUnderQualifier(fn: FunctionNode): AVFunctionNode {
        var attributes: {[attribute: string]: FunctionNode} = {};
        var locality: number = this.localToArea;
        var defun: number = this.localToDefun;
        var valueType: ValueType = this.valueType.merge(fn.valueType);
        var suppressSet: boolean = this.suppressSet;
        var suppressSetAttr: {[attr: string]: boolean} = {};
        var an = <AVFunctionNode> fn;
        var attr: string;

        for (attr in this.suppressSetAttr) {
            suppressSetAttr[attr] = this.suppressSetAttr[attr];
        }
        for (attr in an.suppressSetAttr) {
            suppressSetAttr[attr] = an.suppressSetAttr[attr];
        }
        for (attr in this.attributes) {
            if (attr in an.attributes) {
                attributes[attr] = this.attributes[attr].mergeUnderQualifier(an.attributes[attr]);
            } else {
                attributes[attr] = this.attributes[attr];
            }
        }
        for (attr in an.attributes) {
            if (!(attr in this.attributes)) {
                attributes[attr] = an.attributes[attr];
            }
        }
        return new AVFunctionNode(attributes, locality, defun, valueType,
                                  fn.origExpr, suppressSet, suppressSetAttr);
    }

    static build(attributes: {[attribute: string]: FunctionNode}, suppressSet: boolean, suppressSetAttr: {[attr: string]: boolean}, origExpr: Expression): FunctionNode {
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var dataType: {[attribute: string]: ValueType} = {};
        var isConstant: boolean = true;
        var wontChangeValue: boolean = true;

        for (var attr in attributes) {
            var fun = attributes[attr];
            if (fun instanceof ConstNode) {
                wontChangeValue = wontChangeValue && fun.wontChangeValue;
            } else {
                isConstant = false;
                if (fun.valueType.dataSource && (suppressSet || suppressSetAttr[attr])) {
                    attributes[attr] = new FunctionApplicationNode(
                        singleValue, [fun], fun.localToArea, fun.localToDefun,
                        fun.valueType.copy().removeDataSource(),
                        fun.origExpr, undefined);
                }
            }
            dataType[attr] = fun.valueType;
            localToArea = mergeLocality(localToArea, fun.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
        }
        if (isConstant) {
            var val: any = {};
            for (var attr in attributes) {
                var fun = attributes[attr];
                val[attr] = (<ConstNode> fun).value;
            }
            return buildConstNode(val, wontChangeValue, suppressSet, 0, origExpr);
        }
        return new AVFunctionNode(attributes, localToArea, localToDefun,
                                 new ValueType().addObject(dataType).addSize(1),
                                 origExpr, suppressSet, suppressSetAttr);
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        var attributes: {[attribute: string]: FunctionNode} = {};
        var change: boolean = false;

        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }
        for (var attr in this.attributes) {
            var fun = this.attributes[attr].containsQualifiedExpression &&
                      this.attributes[attr].hasSameVariantLocalityAs(this)?
                this.attributes[attr].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.attributes[attr];
            if (this.attributes[attr] !== fun) {
                change = true;
            }
            if (fun !== undefined && !fun.isAlwaysUndefined()) {
                attributes[attr] = fun;
            }
        }
        return !change? this: AVFunctionNode.build(attributes, this.suppressSet,
                                           this.suppressSetAttr, this.origExpr);
    }

    isAlwaysTrue(): boolean {
        return true;
    }

    getSortKeys(): string[][] {
        var paths: string[][] = [];

        for (var attr in this.attributes) {
            var subExpr: FunctionNode = this.attributes[attr];
            if ("object" in subExpr.valueType) {
                var subPaths: string[][] = this.attributes[attr].getSortKeys();
                paths = paths.concat(subPaths.map(function(p: string[]): string[] {
                    return [attr].concat(p);
                }));
            } else {
                paths.push([attr]);
            }
        }
        return paths;
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    isStrictSelection(): boolean {
        for (var attr in this.attributes) {
            if (!this.attributes[attr].isStrictSelection()) {
                return false;
            }
        }
        return true;
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        if (path.length > 0 && path[0] in this.attributes) {
            visited[this.seqNr] = true;
            wrNodes = this.attributes[path[0]].
                extractWritableDestinations(path.slice(1), visited);
            delete visited[this.seqNr];
        } else {
            wrNodes = [];
        }
        return wrNodes;
    }

    static buildAV(attributes: {[attribute: string]: FunctionNode},
                   localToArea: number, defun: number, makeConstant: boolean,
                   wontChangeValue: boolean, suppressSet: boolean,
                   suppressSetAttr: {[attr: string]: boolean},
                   origExpr: Expression): FunctionNode {
        if (makeConstant) {
            var av: any = {};
            for (var attr in attributes) {
                if (attr === "class") {
                    continue;
                }
                var c = <ConstNode> attributes[attr];
                if (c.value !== undefined) {
                    av[attr] = c.value;
                }
            }
            return new ConstNode(av, getValueTypeFromConstant(av), origExpr,
                                suppressSet, wontChangeValue);
        } else {
            var dataType: {[attribute: string]: ValueType} = {};
            for (var attr in attributes) {
                if (attr === "class") {
                    continue;
                }
                var fun = attributes[attr];
                dataType[attr] = fun.valueType;
                if (fun.valueType.dataSource && (suppressSet || suppressSetAttr[attr])) {
                    attributes[attr] = new FunctionApplicationNode(
                        singleValue, [fun], fun.localToArea, fun.localToDefun,
                        fun.valueType.copy().removeDataSource(),
                        fun.origExpr, undefined);
                }
            }
            return new AVFunctionNode(attributes, localToArea, defun,
                                 new ValueType().addObject(dataType).addSize(1),
                                 origExpr, suppressSet, suppressSetAttr);
        }
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
        super.tagExpressionPath(templateId, defunId, path);
        for (var attr in this.attributes) {
            this.attributes[attr].tagExpressionPath(templateId, defunId, path + "." + attr);
        }
    }
}

// Builds a function node that computes: if a then b else false.
// Not directly available to the author, but used in optimizations.
class BoolGateNode extends FunctionNode {
    a: FunctionNode;
    b: FunctionNode;

    constructor(a: FunctionNode, b: FunctionNode, locality: number, defun: number, origExpr: Expression) {
        super(locality, defun, b.valueType, origExpr);
        this.a = a;
        this.b = b;
        if (doCompileTimeChecks) {
            this.checkForQualifiedExpressions();
            this.hasWritableReference = b.hasWritableReference;
        }
    }

    type(): FunctionNodeType {
        return FunctionNodeType.boolGate;
    }

    specificEqual(fn: BoolGateNode): boolean {
        return this.a.isEqual(fn.a) && this.b.isEqual(fn.b);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        this.a = process(this.a, stack, false);
        if (this.a.localToArea === this.localToArea && this.a.id > mid) {
            mid = this.a.id;
        }
        scheduleStep = this.a.maxScheduleStep(this.prio, scheduleStep);
        this.b = process(this.b, stack, false);
        if (this.b.localToArea === this.localToArea && this.b.id > mid) {
            mid = this.b.id;
        }
        if (setId) {
            scheduleStep = this.b.maxScheduleStep(this.prio, scheduleStep);
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        return this.a.idStr() + " => " + this.b.idStr();
    }

    toFullString(): string {
        return this.a.toFullString() + " => " + this.b.toFullString();
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLFunctionCall("gate", [this.a, this.b], indent);
    }

    toExportString(origin: number): string {
        return "_bg(" + this.localityString() + ", " +
            this.a.idExpStr(origin) + ", " + this.b.idExpStr(origin) + ")";
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            this.b.markWritablePath();
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        if (this.b.writable) {
            this.writable = true;
        }
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        this.a.setPriority(prio);
        this.b.setPriority(prio);
    }

    // The result is o() or b; o() is unmergeable
    isUnmergeable(): boolean {
        return this.b.isUnmergeable();
    }

    conditionalSingleArea(): number {
        var l: RangeValue = levelOfEmbeddingFun(this.b, this.b.localToArea);

        return l === undefined || l.min !== l.max? undefined:
               areaTemplates[this.b.localToArea].getEmbedding(l.min).id;
    }

    replaceConditionalResult(fn: FunctionNode, origin: number): FunctionNode {
        return BoolGateNode.build(this.a, fn, this.origExpr);
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationBoolGate = new EvaluationBoolGate(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setA(getEvaluationNode(this.a, local));
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return [this.a, this.b];
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }
        var a: FunctionNode =
            this.a.containsQualifiedExpression && this.a.hasSameVariantLocalityAs(this)?
            this.a.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin).getBoolInterpretation():
            this.a;
        var b: FunctionNode = this.b.containsQualifiedExpression && this.b.hasSameVariantLocalityAs(this)?
            this.b.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin): this.b;

        return a === this.a && b === this.b? this: BoolGateNode.build(a, b, this.origExpr);
    }

    static build(a: FunctionNode, b: FunctionNode, origExpr: Expression): FunctionNode {
        if (a.isAlwaysTrue()) {
            return b;
        } else if (a.isAlwaysFalse() || b.isAlwaysFalse()) {
            return buildConstNode([], inputsWontChangeValue([a, b]), undefined, 0, origExpr);
        } else if (a instanceof VariantFunctionNode) {
            // If a is cond => true, and only cond can be true, then the gate
            // can be replaced by cond => b; if b is unmergeable, we can
            // substitute multiple cond1 => true | cond2 => true | ... by
            // cond1 => b | cond2 => b | ...
            var trueExpressions: number[] = [];
            var onlyTrueOrFalse: boolean = true;
            var avn = <VariantFunctionNode> a; // TSC bug
            for (var i: number = 0; onlyTrueOrFalse && i < avn.functionNodes.length; i++) {
                if (avn.functionNodes[i].isAlwaysTrue()) {
                    trueExpressions.push(i);
                } else if (!avn.functionNodes[i].isAlwaysFalse()) {
                    onlyTrueOrFalse = false;
                }
            }
            if (onlyTrueOrFalse &&
                (trueExpressions.length === 1 ||
                 (trueExpressions.length > 1 && b.isUnmergeable()))) {
                var qualifiers: SingleQualifier[][] = [];
                var functionNodes: FunctionNode[] = [];
                for (var i: number = 0; i < trueExpressions.length; i++) {
                    qualifiers.push(avn.qualifiers.qualifiers[trueExpressions[i]]);
                    functionNodes.push(b);
                }
                return VariantFunctionNode.build(qualifiers, functionNodes,
                                                0, undefined, false, undefined);
            }
        } else if (a instanceof BoolGateNode && b.isAlwaysTrue()) {
            // We have something like if (if a.a then true else false) then b,
            // so we can rewrite it to if a.a then b.
            a = (<BoolGateNode>a).a;
        }
        var localToArea: number = mergeLocality(a.localToArea, b.localToArea);
        var localToDefun: number = mergeDefunLocality(a.localToDefun, b.localToDefun);
        return new BoolGateNode(a.getBoolInterpretation(), b, localToArea, localToDefun, origExpr);
    }

    getBoolInterpretation(): FunctionNode {
        if (this.b.isAlwaysTrue()) {
            return this.a;
        } else if (this.b.isAlwaysFalse()) {
            return this.b.getBoolInterpretation();
        } else {
            return this;
        }
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        this.b.setDefunArgTypes(args, stack);
        delete stack[this.seqNr];
    }

    getDataSourceInputs(): FunctionNode[] {
        return [this.b];
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        wrNodes = this.b.extractWritableDestinations(path, visited);
        delete visited[this.seqNr];
        return wrNodes;
    }
}

class BoolMatchNode extends FunctionNode {
    a: FunctionNode;
    b: FunctionNode;
    c: FunctionNode;

    constructor(a: FunctionNode, b: FunctionNode, c: FunctionNode, locality: number, defun: number, valueType: ValueType, origExpr: Expression) {
        super(locality, defun, valueType, origExpr);
        this.a = a;
        this.b = b;
        this.c = c;
        if (doCompileTimeChecks) {
            this.hasWritableReference = c.hasWritableReference;
            this.checkForQualifiedExpressions();
        }
    }

    type(): FunctionNodeType {
        return FunctionNodeType.boolMatch;
    }

    specificEqual(fn: BoolMatchNode): boolean {
        return this.a.isEqual(fn.a) && this.b.isEqual(fn.b) &&
            this.c.isEqual(fn.c);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        this.a = process(this.a, stack, false);
        if (this.a.localToArea === this.localToArea && this.a.id > mid) {
            mid = this.a.id;
        }
        this.b = process(this.b, stack, false);
        if (this.b.localToArea === this.localToArea && this.b.id > mid) {
            mid = this.b.id;
        }
        this.c = process(this.c, stack, false);
        if (this.c.localToArea === this.localToArea && this.c.id > mid) {
            mid = this.c.id;
        }
        if (setId) {
            this.scheduleStep =
                Math.max(scheduleStep,
                        Math.max(this.a.scheduleStep,
                                Math.max(this.b.scheduleStep,
                                        this.c.scheduleStep))) +
                1;
        }
        return mid;
    }
    
    toString(): string {
        return this.a.idStr() + " ~= " + this.b.idStr() + " -> " + this.c.idStr();
    }

    toFullString(): string {
        return this.a.toFullString() + " ~= " + this.b.toFullString() + " -> " + this.c.toFullString();
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLFunctionCall("match", [this.a, this.b, this], indent);
    }

    toExportString(origin: number): string {
        return "_bm(" + this.localityString() + ", " +
            this.a.idExpStr(origin) + ", " + this.b.idExpStr(origin) + ", " +
            this.c.idExpStr(origin) + ")";
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through bool match");
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        this.a.setPriority(prio);
        this.b.setPriority(prio);
        this.c.setPriority(prio);
    }

    // The result is o() or c; o() is unmergeable
    isUnmergeable(): boolean {
        return this.c.isUnmergeable();
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationBoolMatch = new EvaluationBoolMatch(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setArguments(getEvaluationNode(this.a, local),
                              getEvaluationNode(this.b, local),
                              getEvaluationNode(this.c, local));
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return [this.a, this.b, this.c];
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }
        var a: FunctionNode = this.a.containsQualifiedExpression && this.a.hasSameVariantLocalityAs(this)?
            this.a.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin): this.a;
        var b: FunctionNode = this.b.containsQualifiedExpression && this.b.hasSameVariantLocalityAs(this)?
            this.b.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin): this.b;
        var c: FunctionNode = this.c.containsQualifiedExpression && this.c.hasSameVariantLocalityAs(this)?
            this.c.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin): this.c;
        var localToArea: number = mergeLocality(a.localToArea, mergeLocality(b.localToArea, c.localToArea));
        var localToDefun: number = mergeDefunLocality(a.localToDefun, mergeDefunLocality(b.localToDefun, c.localToDefun));

        return a === this.a && b === this.b && c === this.c? this:
               new BoolMatchNode(a, b, c, localToArea, localToDefun, c.valueType, this.origExpr);
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        this.c.setDefunArgTypes(args, stack);
        delete stack[this.seqNr];
    }

    getDataSourceInputs(): FunctionNode[] {
        return [this.c];
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        wrNodes = this.c.extractWritableDestinations(path, visited);
        delete visited[this.seqNr];
        return wrNodes;
    }

    checkWritability(): void {
        if (this.c.writable) {
            this.writable = true;
        }
    }
}

// Represents a match of a single attribute. In general, a set of single
// qualifiers (q: SingleQualifier[]) corresponds to one qualifier in cdl. The
// value guarded by that qualifier is in effect when all single qualifiers q[j]
// are true. A set of sets of single qualifier (qs: SingleQualifier[][]) is true
// when one of qs[i] is true.
// Note that a SingleQualifier only accepts a constant simple value, an ordered
// sets with simple values or a constant range.
class SingleQualifier {
    // The id of the area template of this qualifier
    localToArea: number;

    // The FunctionNode for the expression that evaluates this qualifier part
    functionNode: FunctionNode;

    // The name of the context attribute of this qualifier part
    attribute: string;

    // The value against which the context attribute must match. It can be a
    // simple type, a constant range, or an os of simple types. Any change
    // requires adapting the functions that check matches with constants.
    value: any;

    // When the qualifier has been replaced by a query ({attr: <Q>} =>
    // [<Q>, [{attr: _}, [me]]]: true), the original attribute and value are
    // stored here.
    originalAttribute: string;
    originalValue: any;

    constructor(functionNode: FunctionNode, attribute: string, value: any,
                localToArea: number, originalAttr?: string, originalVal?: any) {
        this.functionNode = doCompileTimeChecks && typeof(value) === "boolean"?
            functionNode.getBoolInterpretation(): functionNode;
        this.attribute = attribute;
        this.value = value;
        if (typeof(value) === "object") {
            if (value instanceof MoonOrderedSet) {
                if (!value.os.every(function(elem: any): boolean {
                    return typeof(elem) in simpleTypes;
                })) {
                    Utilities.syntaxError("only constant, simple values in qualifier os");
                }
            } else if (value instanceof MoonRange) {
                if (!value.os.every(function(elem: any): boolean {
                    return typeof(elem) in simpleTypes;
                })) {
                    Utilities.syntaxError("only const, simple values in qualifier range");
                }
            } else {
                Utilities.syntaxError("only simple value queries in qualifiers");
            }
        }
        if (originalAttr === undefined) {
            this.originalAttribute = attribute;
            this.originalValue = value;
        } else {
            this.originalAttribute = originalAttr;
            this.originalValue = originalVal;
        }
        this.localToArea = localToArea;
    }

    isEqualSym(g: SingleQualifier): boolean {
        return this.attribute === g.attribute &&
               SingleQualifier.equalValue(this.value, g.value) &&
               this.localToArea === g.localToArea;
    }

    // Returns true when this cannot be true when g is true
    mismatch(g: SingleQualifier): boolean {
        return this.originalAttribute === g.originalAttribute &&
               SingleQualifier.match(this.originalValue, g.originalValue) === false &&
               this.localToArea === g.localToArea;
    }

    getOriginatingAreaTemplate(): AreaTemplate {
        return areaTemplates[this.localToArea];
    }

    isEqual(g: SingleQualifier): boolean {
        return this.attribute === g.attribute &&
               SingleQualifier.equalValue(this.value, g.value) &&
               this.localToArea === g.localToArea &&
               this.functionNode.isEqual(g.functionNode);
    }

    toString(): string {
        return this.functionNode.idStr() + ":" + String(this.value);
    }

    toSymString(): string {
        return this.originalAttribute + "@" +
            (this.localToArea > 0? String(this.localToArea): "global") +
            ":" + cdlify(this.originalValue);
    }

    toFullString(): string {
        return this.functionNode.toFullString() + ":" + String(this.value);
    }

    toCDLString(indent: string = undefined): string {
        return this.originalAttribute + ":" + cdlify(this.originalValue);
    }

    static sToSymString(sq: SingleQualifier): string {
        return sq.toSymString();
    }

    toExportString(origin: number): string {
        var value: string =
            this.value instanceof MoonRange? this.value.toString():
            this.value instanceof MoonOrderedSet? this.value.toString():
            safeJSONStringify(this.value);

        return addDebugInformation > 0?
            "_gx(" + this.functionNode.idExpStr(origin) + ", " +
                     JSON.stringify(this.attribute) + ", " + this.localToArea +
                     ", " + value + ")":
            "_g(" + this.functionNode.idExpStr(origin) + ", " + value + ")";
    }

    copy(): SingleQualifier {
        return new SingleQualifier(this.functionNode, this.attribute,
                                   this.value, this.localToArea,
                                   this.originalAttribute, this.originalValue);
    }

    setPriority(prio: number): void {
        this.functionNode.setPriority(prio);
    }

    static isGlobal(sq: SingleQualifier): boolean {
        return sq.functionNode.localToArea === undefined;
    }

    static locality(sq: SingleQualifier[]): number {
        var localToArea: number = undefined;

        for (var i: number = 0; i < sq.length; i++) {
            localToArea = mergeLocality(localToArea, sq[i].functionNode.localToArea);
        }
        return localToArea;
    }

    static getQualifierValue(q: SingleQualifier[], attr: string, origin: number): any {
        if (q !== undefined) {
            for (var i: number = 0; i < q.length; i++) {
                if (q[i].originalAttribute === attr &&
                      q[i].localToArea === origin) {
                    return q[i].originalValue;
                }
            }
        }
        return undefined;
    }

    // Returns true when value is guaranteed to match all values in match, and
    // false when it is guaranteed to not match any; otherwise returns
    // undefined; knownValue is a value from another qualifier and has the
    // same structure as value.
    static match(value: any, knownValue: any): boolean {
        if (value instanceof MoonOrderedSet) {
            // If value is an os, any correspondence with knownValue guarantees
            // a match; if there is none, match is guaranteed to be false; if
            // there is some overlap, match is possible but not guaranteed.
            if (knownValue instanceof MoonOrderedSet) {
                var intersection = knownValue.os.filter(function(v_i: any): boolean {
                    return value.os.indexOf(v_i) >= 0;
                });
                return intersection.length === knownValue.os.length? true:
                       intersection.length === 0? false:
                       undefined;
            } else if (knownValue instanceof MoonRange) {
                return value.os.some(function(v_i: any): boolean {
                    return knownValue.containsSimpleValue(v_i);
                });
            } else {
                return value.os.indexOf(knownValue) >= 0;
            }
        } else if (value === true) {
            return isCDLTrue(knownValue)? true: isCDLFalse(knownValue)? false: undefined;
        } else if (value === false) {
            return isCDLTrue(knownValue)? false: isCDLFalse(knownValue)? true: undefined;
        } else if (knownValue instanceof MoonOrderedSet) {
            // there is a match if 'knownValue' consists of just 'value';
            // otherwise it is unknown.
            return knownValue.os.length > 0 &&
                   knownValue.os.every(function(kv_i: any): boolean {
                       return kv_i === value;
                   })? true: undefined;
        } else if (value instanceof MoonRange && knownValue instanceof MoonRange) {
            return value.rangesOverlap(knownValue);
        } else if (knownValue instanceof MoonRange && isSimpleType(value)) {
            // Can be any value
            return undefined;
        } else if (value instanceof MoonRange && isSimpleType(knownValue)) {
            return value.containsSimpleValue(knownValue);
        } else {
            assert(isSimpleType(value) && isSimpleType(knownValue), "expecting simple values");
            return value === knownValue;
        }
    }

    // Returns false when a known qualifier doesn't knownValue, true when it
    // knownValues, and undefined when it is unknown.
    matchAgainst(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][]): boolean {
        var knownValue: any = SingleQualifier.getQualifierValue(
            knownTrueQualifiers, this.originalAttribute, this.localToArea);

        if (knownValue !== undefined) {
            var m: boolean =
                SingleQualifier.match(this.originalValue, knownValue);
            if (m !== undefined) {
                return m;
            }
        }
        if (knownFalseQualifiers !== undefined) {
            for (var i: number = 0; i < knownFalseQualifiers.length; i++) {
                if (knownFalseQualifiers[i].length === 1 &&
                      this.isEqualSym(knownFalseQualifiers[i][0])) {
                    return false;
                }
            }
        }
        return undefined;
    }

    static equalValue(a: any, b: any): boolean {
        if (a instanceof MoonOrderedSet && b instanceof MoonOrderedSet) {
            return b.os.every(function(b_i: any): boolean {
                   return a.os.some(function(a_i: any): boolean {
                       return a_i === b_i;
                   });
            }) && a.os.every(function(a_i: any): boolean {
                  return b.os.some(function(b_i: any): boolean {
                      return a_i === b_i;
                  });
            });
        } else if (a instanceof MoonOrderedSet) {
            return a.os.length > 0 &&
                   a.os.every(function(a_i: any): boolean {
                       return a_i === b;
                   });
        } else if (b instanceof MoonOrderedSet) {
            return b.os.length > 0 &&
                   b.os.every(function(b_i: any): boolean {
                       return a === b_i;
                   });
        } else if (a instanceof MoonRange && b instanceof MoonRange) {
            return a.isEqual(b);
        } else if (isSimpleType(a) && isSimpleType(b)) {
            return a === b;
        } else {
            return false;
        }
    }

    static notAlwaysTrue(sq: SingleQualifier): boolean {
        var fn: FunctionNode = sq.functionNode;

        if (fn instanceof ConstNode) {
            return !interpretedQualifierMatch(sq.value, fn.value);
        } else if (sq.value === true) {
            return !fn.isAlwaysTrue();
        } else if (sq.value === false) {
            return !fn.isAlwaysFalse();
        } else {
            return true;
        }
    }

    static alwaysFalse(sq: SingleQualifier): boolean {
        var fn: FunctionNode = sq.functionNode;

        if (fn instanceof ConstNode) {
            return !interpretedQualifierMatch(sq.value, fn.value);
        } else if (sq.value === true) {
            return fn.isAlwaysFalse();
        } else if (sq.value === false) {
            return fn.isAlwaysTrue();
        } else {
            return false;
        }
    }

    // When a qualifier is {q1: v1, q2: v2, ...} => true, it is reduced to
    // q1: v1, q2: v2, ...
    simplifyBooleanVariant(): SingleQualifier[] {
        if (this.value === true &&
              this.functionNode instanceof VariantFunctionNode &&
              this.functionNode.functionNodes.length === 1 && 
              this.functionNode.functionNodes[0].isAlwaysTrue()) {
            return this.functionNode.qualifiers.qualifiers[0];
        }
        return [this];
    }
}

function sqInSQs(sq1: SingleQualifier, sqs: SingleQualifier[]): boolean {
    return sqs.some(function(sq2: SingleQualifier): boolean {
        return sq1.isEqualSym(sq2);
    });
}

// Returns true when a implies b (i.e. a's truth implies b's truth, which
// means that b's qualifiers are a subset of a's)
function sqsImplies(a: SingleQualifier[], b: SingleQualifier[]): boolean {
    return b.every(function(sq: SingleQualifier): boolean {
        return sqInSQs(sq, a);
    });
}

function sqsEqual(a: SingleQualifier[], b: SingleQualifier[]): boolean {
    return sqsImplies(a, b) && sqsImplies(b, a);
}

// Returns true when a cannot be true iff b is true, i.e. when a has a qualifier
// that is in b but with a different value.
function sqsMismatch(a: SingleQualifier[], b: SingleQualifier[]): boolean {
    return a.some(function(a_i: SingleQualifier): boolean {
        return b.some(function(b_j: SingleQualifier): boolean {
            return a_i.mismatch(b_j);
        });
    });
}

class QualifiersFunctionNode extends FunctionNode {

    qualifiers: SingleQualifier[][];

    constructor(qualifiers: SingleQualifier[][], locality: number, defun: number) {
        super(locality, defun, boolValueType, undefined);
        this.qualifiers = qualifiers;
        if (doCompileTimeChecks) {
            this.containsQualifiedExpression = qualifiers.length > 1 ||
                (qualifiers.length === 1 && qualifiers[0].length > 0);
        }
    }

    add(qualifier: SingleQualifier[]): void {
        this.qualifiers.push(qualifier);
    }

    type(): FunctionNodeType {
        return FunctionNodeType.qualifiers;
    }

    // This function does not look at identical qualifiers in different positions,
    // although they can be considered identical. However, since all qualifiers in
    // the same variant have the same position, it's not such a problem.
    identicalQualifiers(fn: QualifiersFunctionNode): boolean {
        if (this.qualifiers.length !== fn.qualifiers.length) {
            return false;
        }
        for (var i = 0; i !== this.qualifiers.length; i++) {
            if (this.qualifiers[i].length !== fn.qualifiers[i].length) {
                return false;
            }
            for (var j: number = 0; j < this.qualifiers[i].length; j++) {
                if (!this.qualifiers[i][j].isEqual(fn.qualifiers[i][j])) {
                    return false;
                }
            }
        }
        return true;
    }

    specificEqual(fn: QualifiersFunctionNode): boolean {
        return this.qualifiers.length === fn.qualifiers.length &&
               this.identicalQualifiers(fn);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        for (var i: number = 0; i !== this.qualifiers.length; i++) {
            for (var j: number = 0; j !== this.qualifiers[i].length; j++) {
                this.qualifiers[i][j].functionNode = process(this.qualifiers[i][j].functionNode, stack, false);
                if (this.qualifiers[i][j].functionNode.localToArea === this.localToArea &&
                    this.qualifiers[i][j].functionNode.id > mid) {
                    mid = this.qualifiers[i][j].functionNode.id;
                }
                scheduleStep = this.qualifiers[i][j].functionNode.maxScheduleStep(this.prio, scheduleStep);
            }
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    qualifiersToString(i: number): string {
        return "{" + this.qualifiers[i].map(function(o){return o.toString();}).join(", ") + "}";
    }

    qualifiersToFullString(i: number): string {
        return "{" + this.qualifiers[i].map(function(o){return o.toFullString();}).join(", ") + "}";
    }

    qualifiersToCDLString(i: number): string {
        return "{" + this.qualifiers[i].map(function(o){return o.toCDLString();}).join(", ") + "}";
    }

    exportQualifiersToString(origin: number, i: number): string {
        return "[" + this.qualifiers[i].map(function (sq: SingleQualifier): string {
            return sq.toExportString(origin);
        }).join(", ") + "]";
    }

    toString(): string {
        var str: string = "";

        for (var i = 0; i !== this.qualifiers.length; i++) {
            if (i !== 0) str += " ~ ";
            str += this.qualifiersToString(i);
        }
        return str;
    }

    toErrorString(): string {
        return "qualifierNode";
    }

    toFullString(): string {
        var str: string = "";

        for (var i = 0; i !== this.qualifiers.length; i++) {
            if (i !== 0) str += " ~ ";
            str += this.qualifiersToFullString(i);
        }
        return str;
    }

    toCDLString(indent: string = undefined): string {
        var str: string = "[qualifiers";

        for (var i = 0; i !== this.qualifiers.length; i++) {
            str += ", " + this.qualifiersToCDLString(i);
        }
        return str + "]";
    }

    allQualifiersTrue(): boolean {
        for (var i: number = 0; i !== this.qualifiers.length; i++) {
            if (this.qualifiers[i].length !== 0) {
                return false;
            }
        }
        return true;
    }

    toExportString(origin: number): string {
        var str: string;

        str = "_q(" + this.localityString() + ", [";
        for (var i: number = 0; i !== this.qualifiers.length; i++) {
            if (i !== 0) str += ", ";
            str += this.exportQualifiersToString(origin, i);
        }
        str += "])";
        return str;
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        for (var i: number = 0; i !== this.qualifiers.length; i++) {
            for (var j: number = 0; j !== this.qualifiers[i].length; j++) {
                this.qualifiers[i][j].setPriority(prio);
            }
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationQualifiers(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.qualifiers.length; i++) {
            evalNode.addQualifiers(i, buildQualifiers(this.qualifiers[i], local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        var allInputs: FunctionNode[] = [];

        for (var i: number = 0; i !== this.qualifiers.length; i++) {
            for (var j: number = 0; j !== this.qualifiers[i].length; j++) {
                allInputs.push(this.qualifiers[i][j].functionNode);
            }
        }
        return allInputs;
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    checkWritability(): void {
        Utilities.error("do not call");
    }
    
    markWritablePath(): void {
        Utilities.error("do not call");
    }
}

class VariantFunctionNode extends FunctionNode {

    qualifiers: QualifiersFunctionNode;
    functionNodes: FunctionNode[];
    visitedAtExportLevel: number = -1;
    node: PathTreeNode;

    constructor(qualifiers: QualifiersFunctionNode,
                functionNodes: FunctionNode[], locality: number, defun: number,
                valueType: ValueType, origExpr: Expression, node: PathTreeNode)
    {
        super(locality, defun, valueType, origExpr);
        this.qualifiers = qualifiers;
        this.functionNodes = functionNodes;
        this.node = node;
        if (doCompileTimeChecks) {
            this.containsQualifiedExpression =
                qualifiers.containsQualifiedExpression;
            this.hasWritableReference = functionNodes.some(fn => fn.hasWritableReference);
        }
    }

    add(functionNode: FunctionNode): void {
        this.functionNodes.push(functionNode);
        this.hasWritableReference =
            this.hasWritableReference || functionNode.hasWritableReference;
    }

    type(): FunctionNodeType {
        return FunctionNodeType.variant;
    }

    // This function does not look at identical qualifiers in different positions,
    // although they can be considered identical. However, since all qualifiers in
    // the same variant have the same position, it's not such a problem.
    identicalQualifiers(fn: VariantFunctionNode): boolean {
        return this.qualifiers.identicalQualifiers(fn.qualifiers);
    }

    specificEqual(fn: VariantFunctionNode): boolean {
        return this.functionNodes.length === fn.functionNodes.length &&
               this.qualifiers.isEqual(fn.qualifiers) &&
               arrayEqual(this.functionNodes, fn.functionNodes);
    }

    /**
     * When true, a cycle detected in a variant will throw an exception instead
     * of printing an error message. This allows the caller to do a repair
     * attempt when not all qualifiers have been eliminated. The exception
     * consists of just the id of the variant with the cycle.
     */
    static repairCycle: boolean = false;

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        if (this.visitedAtExportLevel === exportLevel) {
            if (VariantFunctionNode.repairCycle) {
                throw this.seqNr;
            }
            var msg: string = "cycle in VariantFunctionNode";
            if (this.node !== undefined) {
                gErrContext.enter(this.node, undefined);
            } else {
                msg += ": " + this.idStr() + "(consult your local FEG expert)";
            }
            Utilities.syntaxError(msg);
            if (this.node !== undefined) {
                gErrContext.leave();
            }
            var cycleLength = FunctionNode.findInCacheStack(this, 1);
            if (cycleLength > -1) {
                FunctionNode.printCycleError(cycleLength);
            } else {
                Utilities.error("no cycle length?");
            }
            return -1;
        }
        var prevExportLevel: number = this.visitedAtExportLevel;
        this.visitedAtExportLevel = exportLevel;
        try {
            this.qualifiers = <QualifiersFunctionNode> process(this.qualifiers, stack, false);
            if (this.qualifiers.localToArea === this.localToArea &&
                this.qualifiers.id > mid) {
                mid = this.qualifiers.id;
            }
            scheduleStep = this.qualifiers.maxScheduleStep(this.prio, scheduleStep);
            for (var i: number = 0; i !== this.functionNodes.length; i++) {
                this.functionNodes[i] = process(this.functionNodes[i], stack, false);
                if (this.functionNodes[i].localToArea === this.localToArea &&
                    this.functionNodes[i].id > mid) {
                    mid = this.functionNodes[i].id;
                }
                scheduleStep = this.functionNodes[i].maxScheduleStep(this.prio, scheduleStep);
            }
        } catch (exception) {
            if (exception === this.seqNr) {
                for (var i = 0; i < this.functionNodes.length; i++) {
                    this.functionNodes[i] = this.functionNodes[i].pickQualifiedExpression(
                        this.qualifiers.qualifiers[i],
                        this.qualifiers.qualifiers.slice(0, i),
                        this.localToArea);
                }
                VariantFunctionNode.repairCycle = false;
                // If there's an exception now, it cannot be repaired, and will
                // be caught in createAreaTemplates().
                this.visitedAtExportLevel = prevExportLevel;
                var mid = this.getMaximumInputId(stack, process, setId);
                VariantFunctionNode.repairCycle = true;
                return mid;
            }
            throw exception;
        }
        this.visitedAtExportLevel = prevExportLevel;
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        var str: string = this.qualifiers.idStr() + " => ";

        for (var i = 0; i !== this.functionNodes.length; i++) {
            if (i !== 0) str += " ~ ";
            str += this.functionNodes[i].idStr();
        }
        return str;
    }

    toErrorString(): string {
        return "variant " + this.qualifiers.toCDLString();
    }

    toFullString(): string {
        var str: string = this.qualifiers.toFullString() + " => ";

        for (var i = 0; i !== this.functionNodes.length; i++) {
            if (i !== 0) str += " ~ ";
            str += this.functionNodes[i].toFullString();
        }
        return str;
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLFunctionCall("variant",
            [<FunctionNode>this.qualifiers].concat(this.functionNodes), indent);
    }

    allFunctionNodesIdentical(): boolean {
        if (this.functionNodes.length > 0) {
            for (var i: number = 1; i !== this.functionNodes.length; i++) {
                if (this.functionNodes[i] !== this.functionNodes[0]) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    allQualifiersTrue(): boolean {
        return this.qualifiers.allQualifiersTrue();
    }

    alwaysFalse: boolean

    isAlwaysFalse(): boolean {
        if (this.alwaysFalse === undefined) {
            this.alwaysFalse = this.functionNodes.every(fn => fn.isAlwaysFalse());
        }
        return this.alwaysFalse;
    }

    toExportString(origin: number): string {
        var str: string;

        assert(this.functionNodes.length === this.qualifiers.qualifiers.length,
               "debugging");
        if (this.allFunctionNodesIdentical()) {
            return "_m1(" + this.localityString() + ", " +
                   this.qualifiers.idExpStr(origin) + ", " +
                   this.functionNodes[0].idExpStr(origin) + ")";
        }
        str = "_m(" + this.localityString() + ", " +
            this.qualifiers.idExpStr(origin) + ", [";
        for (var i: number = 0; i !== this.functionNodes.length; i++) {
            if (i !== 0) str += ", ";
            str += this.functionNodes[i].idExpStr(origin);
        }
        str += "])";
        return str;
    }

    conditionalSingleArea(): number {
        var lEmb: number;
        var localToArea: number;

        if (this.functionNodes.length === 0) {
            return undefined;
        }
        for (var i = 0; i !== this.functionNodes.length; i++) {
            if (this.functionNodes[i] instanceof WritableNode) {
                return undefined;
            }
            var l_i: RangeValue = levelOfEmbeddingFun(this.functionNodes[i], this.functionNodes[i].localToArea);
            if (l_i === undefined || l_i.min !== l_i.max) {
                return undefined;
            }
            if (i === 0) {
                lEmb = l_i.min;
                localToArea = this.functionNodes[i].localToArea;
            } else if (l_i.min !== lEmb || l_i.max !== lEmb ||
                       localToArea !== this.functionNodes[i].localToArea) {
                return undefined;
            }
        }
        return areaTemplates[localToArea].getEmbedding(lEmb).id;
    }

    // Replace all function nodes by one and the same
    replaceConditionalResult(fn: FunctionNode, origin: number): FunctionNode {
        var functionNodes: FunctionNode[] = new Array(this.functionNodes.length);

        for (var i: number = 0; i < functionNodes.length; i++) {
            functionNodes[i] = fn;
        }
        return VariantFunctionNode.build(this.qualifiers.qualifiers, functionNodes,
                                     0, undefined, this.suppressSet, this.node);
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            for (var i: number = 0; i !== this.functionNodes.length; i++) {
                this.functionNodes[i].markWritablePath();
            }
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        this.writable = this.functionNodes.some(function(fn: FunctionNode): boolean {
            return fn.writable;
        });
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        this.qualifiers.setPriority(prio);
        for (var i: number = 0; i !== this.functionNodes.length; i++) {
            this.functionNodes[i].setPriority(prio);
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = this.functionNodes.length === 1?
            new EvaluationVariant1(this, local):
            new EvaluationVariant(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.addQualifiers(<EvaluationQualifiers>getEvaluationNode(this.qualifiers, local));
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return this.functionNodes.concat(this.qualifiers);
    }

    // When the first qualifier that is equal to q, after qualifiers
    // that cannot be true under q, is non-mergeable, return its value.
    // Remove variants that have qualifiers implied by those known to
    // be false, and filter the qualifier list for known values.
    // NOTE: When the number of variants isn't reduced, the original node is
    // used, and the filtered qualifier list is ignored. It turns out that
    // using them increases the number of FunctionNodes and slows down
    // processing a bit, probably because there is less sharing. Uncomment the
    // code related to "change" in order to use the filtered qualifiers.
    valueUnderQualifier(q: SingleQualifier[], nq: SingleQualifier[][]): FunctionNode {
        var curQualifiers = this.qualifiers.qualifiers;
        var qualifiers: SingleQualifier[][] = [];
        var functionNodes: FunctionNode[] = [];

        for (var i: number = 0; i !== curQualifiers.length; i++) {
            if (sqsImplies(q, curQualifiers[i])) {
                qualifiers.push([]); // Qualifier is guaranteed
                functionNodes.push(this.functionNodes[i]);
                if (this.functionNodes[i].isUnmergeable() ||
                    !this.functionNodes[i].valueType.isPotentiallyMergeable()) {
                    // Since it's unmergeable and the qualifier is always true,
                    // we can stop. If this is the first potential qualifier,
                    // the result will be just this.functionNodes[i].
                    break;
                }
            } else if (nq.some((nq_j: SingleQualifier[]): boolean => {
                           return sqsImplies(curQualifiers[i], nq_j);
                       })) {
                // The qualifier is implied by one that is known to be false
                // so we skip it
            } else if (sqsMismatch(curQualifiers[i], q)) {
                // We can ignore this one because it is contradicted by q
            } else {
                // There is no mismatch with q, and neither is it implied by q
                // nor nq, so this qualifier can be true. Filter out attributes
                // that are guaranteed to match.
                qualifiers.push(curQualifiers[i].filter((q_ij: SingleQualifier): boolean => {
                    return !sqInSQs(q_ij, q);
                }));
                functionNodes.push(this.functionNodes[i]);
            }
        }
        return functionNodes.length === this.functionNodes.length? this:
               VariantFunctionNode.build(qualifiers, functionNodes, 0,
                                        undefined, this.suppressSet, this.node);
    }

    // Can probably be merged with valueUnderQualifier().
    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }
        var curQualifiers = this.qualifiers.qualifiers;
        var pick: FunctionNode = undefined;
        var pickMatch: boolean;

        // Returns true when all qualifiers are known to be true, false when one
        // qualifier is known to be false, and undefined otherwise.
        function qMatch(qualifiers: SingleQualifier[]): boolean {
            for (var i: number = 0; i !== qualifiers.length; i++) {
                var res: boolean = qualifiers[i].matchAgainst(knownTrueQualifiers, knownFalseQualifiers);
                if (!res) { // note: can be undefined or false
                    return res;
                }
            }
            return true;
        }

        // Check if all but one qualifier can be eliminated.
        for (var i: number = 0; i !== curQualifiers.length; i++) {
            var m: boolean = qMatch(curQualifiers[i]);
            if (m !== false) {
                if (pick !== undefined) {
                    // more than one qualifier is non-false, and the first one
                    // wasn't unmergeable.
                    pickMatch = false;
                    break;
                }
                pick = this.functionNodes[i];
                pickMatch = m;
                if (m === true &&
                    (pick.isUnmergeable() ||
                     !pick.valueType.isPotentiallyMergeable())) {
                    // Don't look beyond first guaranteed and unmergeable match.
                    // Otherwise, keep looking.
                    break;
                }
            }
        }
        // If all qualifiers are false, return []; otherwise, check if the
        // non-false one is always true. We could construct a smaller qualifier
        // node, but the net effect is not clear (because of sharing).
        if (pick === undefined) {
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        if (pickMatch === true) {
            return pick.containsQualifiedExpression?
                   pick.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                   pick;
        }
        if (pickQualifiedExpressionStrategy === PickQualifiedExpressionStrategy.pickOnlyTopVariant) {
            return this;
        }
        // Couldn't pick one, so remove as many qualifiers as possible
        return this.eliminateQualifiers(knownTrueQualifiers,
                                        knownFalseQualifiers, origin);
    }

    eliminateQualifiers(knownTrueQualifiers: SingleQualifier[],
                        knownFalseQualifiers: SingleQualifier[][],
                        origin: number): FunctionNode
    {
        var curQualifiers = this.qualifiers.qualifiers;
        var nq: SingleQualifier[][] = [];
        var nf: FunctionNode[] = [];
        var change: boolean = false;
        var localKnownFalseQualifiers: SingleQualifier[][] = [];

        for (var i: number = 0; i !== curQualifiers.length; i++) {
            var q_i: SingleQualifier[] = curQualifiers[i];
            var nq_i: SingleQualifier[] = [];
            var canMatch: boolean = true;
            for (var j: number = 0; canMatch && j !== q_i.length; j++) {
                switch (q_i[j].matchAgainst(knownTrueQualifiers, knownFalseQualifiers)) {
                  case true:
                    // always true, so ignore
                    change = true;
                    break;
                  case false:
                    canMatch = false;
                    change = true;
                    break;
                  case undefined:
                    nq_i.push(q_i[j]);
                    break;
                }
            }
            if (canMatch) {
                var kTQ = knownTrueQualifiers === undefined?
                    nq_i: nq_i.concat(knownTrueQualifiers);
                var kFQ = knownFalseQualifiers === undefined?
                    localKnownFalseQualifiers:
                    localKnownFalseQualifiers.concat(knownFalseQualifiers);
                for (var j: number = 0; j < nq_i.length; j++) {
                    var nQFN: FunctionNode;
                    if (nq_i[j].functionNode.containsQualifiedExpression &&
                          nq_i[j].functionNode.hasSameVariantLocalityAs(this) &&
                          (nQFN = nq_i[j].functionNode.pickQualifiedExpression(
                                knownTrueQualifiers, kFQ, origin)) != 
                          nq_i[j].functionNode) {
                        nq_i[j] = new SingleQualifier(nQFN, nq_i[j].attribute,
                              nq_i[j].value, nq_i[j].localToArea,
                              nq_i[j].originalAttribute, nq_i[j].originalValue);
                        change = true;
                    }
                }
                var nFN = this.functionNodes[i].containsQualifiedExpression &&
                          this.functionNodes[i].hasSameVariantLocalityAs(this)?
                    this.functionNodes[i].pickQualifiedExpression(kTQ, kFQ, origin):
                    this.functionNodes[i];
                if (this.functionNodes[i] !== nFN) {
                    change = true;
                }
                nq.push(nq_i);
                nf.push(nFN);
                if (i < curQualifiers.length - 1 &&
                      localKnownFalseQualifiers.length === nq.length &&
                      (nFN.isUnmergeable() || !nFN.valueType.isPotentiallyMergeable())) {
                    localKnownFalseQualifiers.push(curQualifiers[i]);
                }
            } else {
                localKnownFalseQualifiers.push(curQualifiers[i]);
            }
        }
        return !change? this: VariantFunctionNode.build(
                             nq, nf, 0, undefined, this.suppressSet, this.node);
    }

    static build(origQualifiers: SingleQualifier[][],
                 origFunctionNodes: FunctionNode[], nrWritables: number,
                 usedPathInfo: PathInfo[], suppressSet: boolean,
                 node: PathTreeNode
                ): FunctionNode
    {
        var valueType: ValueType = new ValueType().addSize(0); // A merge can return undefined/o().
        var allFunctionsIdentical: boolean = true;
        var allQualifiersTrue: boolean = true;
        var functionNodes: FunctionNode[] = [];
        var qualifiers: SingleQualifier[][] = [];

        // Returns true when there is at least one qualifier guaranteed to be
        // true. When that's the case, and all functions are identical, the
        // result will always be that function.
        // This implementation limits itself to checking if the qualifiers
        // are a boolean and partition the value space, or one of the qualifiers
        // is empty.
        function alwaysOneQualifierTrue(): boolean {
            if (qualifiers.some(function(q: SingleQualifier[]) { return q.length === 0; })) {
                // One of the qualifiers is empty, so always true
                return true;
            }
            // Check if all are {q_1:true/false, q_2:true/false, ...} and build
            // a list of attributes.
            // Note: we don't check for originalAttribute and originalValue,
            // since the rewrite to [query, [{attr: _}, [me]]] in buildQualifier
            // is more useful.
            var attributes: {[attr: string]: number} = {};
            var nrAttributes: number = 0;
            for (var i: number = 0; i < qualifiers.length; i++) {
                if (i > 0 && qualifiers[i].length !== qualifiers[0].length) {
                    return false;
                }
                for (var j: number = 0; j < qualifiers[i].length; j++) {
                    if (qualifiers[i][j].value !== true &&
                          qualifiers[i][j].value !== false) {
                        return false;
                    }
                    if (!(qualifiers[i][j].attribute in attributes)) {
                        attributes[qualifiers[i][j].attribute] = nrAttributes++;
                    }
                }
            }
            // Check if all true/false combinations occur by interpreting them
            // as binary numbers, which should then span 0..2^nrAttributes-1.
            var numReprs: number[] = 
                qualifiers.map(function(q: SingleQualifier[]): number {
                    return q.reduce(function(sum: number, sq: SingleQualifier): number {
                        return sq.value === false? sum:
                               sum + (1 << attributes[sq.attribute]);
                    }, 0);
                }).sort(function(a: number, b: number): number { return a - b;});
            var prevNr: number = -1;
            for (var i: number = 0; i < numReprs.length; i++) {
                if (numReprs[i] !== prevNr + 1) {
                    return false;
                }
                prevNr = numReprs[i];
            }
            return prevNr === (1 << nrAttributes) - 1;
        }

        assert(origQualifiers.length === origFunctionNodes.length, "error");
        for (var i: number = 0; i !== origFunctionNodes.length; i++) {
            var fun: FunctionNode = origFunctionNodes[i];
            var qualifiers_i: SingleQualifier[] = origQualifiers[i].filter(SingleQualifier.notAlwaysTrue);
            if (!qualifiers_i.some(SingleQualifier.alwaysFalse)) {
                qualifiers.push(qualifiers_i);
                functionNodes.push(fun);
                if (functionNodes.length > 0 && !fun.isEqual(functionNodes[0])) {
                    allFunctionsIdentical = false;
                }
                if (qualifiers_i.length !== 0) {
                    allQualifiersTrue = false;
                }
                valueType = valueType.merge(fun.valueType);
            }
        }

        if (nrWritables > 1) {
            mergeWritables(qualifiers, functionNodes, usedPathInfo, node);
        }

        // If all qualifiers are false, return the (untyped) empty os; if only a
        // single, empty qualifier remains, or all functions are identical, and
        // all are true, just return the function node
        if (qualifiers.length === 0) {
            return buildConstNode(undefined, false, suppressSet, 0, gUndefinedExpr);
        }
        if (allFunctionsIdentical && (allQualifiersTrue || alwaysOneQualifierTrue())) {
            return functionNodes[0].mightChange();
        }
        return VariantFunctionNode.build2(qualifiers, functionNodes, valueType, undefined, node);
    }

    static build2(qualifiers: SingleQualifier[][], functionNodes: FunctionNode[],
           valueType: ValueType, origExpr: Expression, node: PathTreeNode): FunctionNode
    {
        // Determine locality and ouput of the qualifiers and function
        // nodes separately
        var fnLocalToArea: number = undefined;
        var fnLocalToDefun: number = 0;
        var qsLocalToArea: number = undefined;
        var qsLocalToDefun: number = 0;

        for (var i: number = 0; i !== functionNodes.length; i++) {
            fnLocalToArea = mergeLocality(fnLocalToArea,
                                          functionNodes[i].localToArea);
            fnLocalToDefun = mergeDefunLocality(fnLocalToDefun,
                                                functionNodes[i].localToDefun);
            for (var j: number = 0; j < qualifiers[i].length; j++) {
                qsLocalToArea = mergeLocality(qsLocalToArea,
                                     qualifiers[i][j].functionNode.localToArea);
                qsLocalToDefun = mergeDefunLocality(qsLocalToDefun,
                                    qualifiers[i][j].functionNode.localToDefun);
            }
        }

        var qualifiersFunctionNode = new QualifiersFunctionNode(
            qualifiers, qsLocalToArea, qsLocalToDefun);

        return new VariantFunctionNode(qualifiersFunctionNode, functionNodes,
                             mergeLocality(fnLocalToArea, qsLocalToArea),
                             mergeDefunLocality(fnLocalToDefun, qsLocalToDefun),
                             valueType, origExpr, node);
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        for (var i: number = 0; i < this.functionNodes.length; i++) {
            this.functionNodes[i].setDefunArgTypes(args, stack);
        }
        delete stack[this.seqNr];
    }

    // Return list of qualifiers determining the value of this. If a qualifier
    // depends on other qualifiers, it is expanded. E.g., assume we have {Q1,
    // q1: c1} -> v1 | {Q2, q2: c2} -> v2, and q1 depends on other qualifiers,
    // e.g. {q3:c3} -> v3 | {q4: c4} -> v4. When we fill in the dependencies of
    // q1, the expression becomes {Q1, q3: c3, v3: c1} -> c1 | {Q1, q4: c4, v4:
    // c1} -> c1 | {Q2, q2: c2} -> v2, and the set of qualifiers becomes {Q1,
    // q3, v3}, {Q3, q4, v4}, {Q2, q2}. Similar for function nodes.
    getFullQualifierList(origin: number, cache: SingleQualifier[][][]): SingleQualifier[][] {
        var curQualifiers = this.qualifiers.qualifiers;

        if (this.localToArea !== origin) {
            return [];
        }
        if (cache[this.id] !== undefined) {
            return cache[this.id];
        }
        assert(cache.length === this.id, "debug");
        cache.push([]);
        var qs: SingleQualifier[][] = [];
        var functionNodes: FunctionNode[][] = [];
        for (var i: number = 0; i < curQualifiers.length; i++) {
            // qfq is the full set of qualifiers of which curQualifiers[i] depends
            var qfq: SingleQualifier[][] = [[]];
            for (var j: number = 0; j < curQualifiers[i].length; j++) {
                var qij: SingleQualifier = curQualifiers[i][j];
                var qfqij: SingleQualifier[][];
                if (qij.functionNode.localToArea === origin) {
                    qfqij = curQualifiers[i][j].functionNode.getFullQualifierList(origin, cache);
                    if (qfqij.length === 0) {
                        qfqij = [[qij]];
                    } else {
                        for (var l: number = 0; l < qfqij.length; l++) {
                            qfqij[l].push(qij);
                        }
                    }
                } else {
                    qfqij = [[qij]];
                }
                var qfq0: SingleQualifier[][] = qfq;
                qfq = [];
                for (var k: number = 0; k < qfq0.length; k++) {
                    for (var l: number = 0; l < qfqij.length; l++) {
                        qOr(qfq, qAnd(qfq0[k], qfqij[l]), undefined, undefined);
                    }
                }
            }
            var v: SingleQualifier[][] = this.functionNodes[i].getFullQualifierList(origin, cache);
            if (v.length === 0) {
                for (var k: number = 0; k < qfq.length; k++) {
                    qOr(qs, qfq[k], functionNodes, this.functionNodes[i]);
                }
            } else {
                for (var k: number = 0; k < qfq.length; k++) {
                    for (var l: number = 0; l < v.length; l++) {
                        qOr(qs, qAnd(qfq[k], v[l]), functionNodes, this.functionNodes[i]);
                    }
                }
            }
        }
        cache.pop();
        assert(cache.length === this.id, "debug");
        return qSimplify(qs, functionNodes);
    }

    getDataSourceInputs(): FunctionNode[] {
        return this.functionNodes;
    }

    getSortKeys(): string[][] {
        var allPaths: string[][] = [];

        for (var i: number = 0; i < this.functionNodes.length; i++) {
            var paths: string[][] = this.functionNodes[i].getSortKeys();
            for (var j: number = 0; j < paths.length; j++) {
                for (var k: number = 0; k < allPaths.length; k++) {
                    if (valueEqual(paths[j], allPaths[k])) {
                        break;
                    }
                }
                if (k === allPaths.length) {
                    allPaths.push(paths[j]);
                }
            }
        }
        return allPaths;
    }

    // TODO: it is possible to replace by logical expression when all function
    // nodes are always true or false, but it's not clear if that is beneficial,
    // since it could reduce sharing.
    // getBoolInterpretation(): FunctionNode {
    //     var boolFunctionNodes: FunctionNode[] = this.functionNodes.map(function(fn: FunctionNode): FunctionNode {
    //         return fn.getBoolInterpretation();
    //     });
    //
    //     return VariantFunctionNode.build(this.qualifiers.qualifiers, boolFunctionNodes,
    //                                  0, undefined, this.suppressSet, this.node);
    // }

    // Checks for meaningless cycles: if this is {q_1: v_1} => fn_1 | {q_2: v_2}
    // => fn_2 | ..., and stub is fn_i, variant i can be omitted, since merging
    // it with itself doesn't change the output.
    markAsResolution(stub: StubFunctionNode): FunctionNode {
        // logic for removal: copy the elements not equal to the stub node,
        // and only when there is at least one.
        var qualifiers: SingleQualifier[][] = undefined;
        var functionNodes: FunctionNode[] = undefined;

        for (var i: number = 0; i < this.functionNodes.length; i++) {
            if (this.functionNodes[i] === stub) {
                if (qualifiers === undefined) {
                    qualifiers = this.qualifiers.qualifiers.slice(0, i - 1);
                    functionNodes = this.functionNodes.slice(0, i - 1);
                }
            } else if (qualifiers !== undefined) {
                qualifiers.push(this.qualifiers.qualifiers[i]);
                functionNodes.push(this.functionNodes[i]);
            }
        }
        return qualifiers === undefined? this:
               VariantFunctionNode.build(qualifiers, functionNodes, 0,
                                         undefined, false, this.node);
    }

    isStrictSelection(): boolean {
        return this.functionNodes.every(function(fn) {
            return fn.isStrictSelection();
        });
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[] = [];
        var earlierQualifiers: SingleQualifier[][] = [];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        for (var i: number = 0; i < this.functionNodes.length; i++) {
            var curQualifiers: SingleQualifier[] = this.qualifiers.qualifiers[i];
            // Skip variants that are implied by earlier variants: since the
            // write goes to the first active variant, they cannot be true
            if (earlierQualifiers.some(eq_j => sqsImplies(eq_j, curQualifiers))) {
                continue;
            }
            var variantWrNodes =
                this.functionNodes[i].extractWritableDestinations(path, visited);
            if (variantWrNodes !== undefined && variantWrNodes.length > 0) {
                wrNodes = cconcat(wrNodes, variantWrNodes.map(wr => {
                    return {
                        functionNode: wr.functionNode,
                        path: wr.path,
                        qualifiers: wr.qualifiers.concat(curQualifiers)
                    }
                }));
            }
            earlierQualifiers.push(curQualifiers);
        }
        delete visited[this.seqNr];
        return wrNodes;
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
        super.tagExpressionPath(templateId, defunId, path);
        this.qualifiers.tagExpressionPath(templateId, defunId, path);
        for (var i: number = 0; i < this.functionNodes.length; i++) {
            this.functionNodes[i].tagExpressionPath(templateId, defunId, path);
        }
    }
}

class FunctionApplicationNode extends FunctionNode {

    builtInFunction: BuiltInFunction;
    functionArguments: FunctionNode[];
    defunCacheIndex: number;
    origin: number; // originating area template id for display queries

    constructor(builtInFunction: BuiltInFunction,
                functionArguments: FunctionNode[],
                locality: number, defun: number, valueType: ValueType,
                origExpr: Expression, origin?: number)
    {
        super(locality, defun, valueType, origExpr);
        this.builtInFunction = builtInFunction;
        this.functionArguments = functionArguments;
        if (origin !== undefined) {
            this.origin = origin;
        }
        if (doCompileTimeChecks) {
            this.checkForQualifiedExpressions();
            var writeDestination: FunctionNode = this.writeDestination();
            if (writeDestination !== undefined) {
                this.hasWritableReference = writeDestination.hasWritableReference;
            }
        }
    }

    type(): FunctionNodeType {
        return FunctionNodeType.functionApplication;
    }

    specificEqual(fn: FunctionApplicationNode): boolean {
        return this.builtInFunction === fn.builtInFunction &&
            arrayEqual(this.functionArguments, fn.functionArguments);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        for (var i = 0; i !== this.functionArguments.length; i++) {
            this.functionArguments[i] = process(this.functionArguments[i], stack, false);
            if (this.functionArguments[i].localToArea === this.localToArea &&
                  this.functionArguments[i].id > mid) {
                mid = this.functionArguments[i].id;
            }
            scheduleStep = this.functionArguments[i].maxScheduleStep(this.prio, scheduleStep);
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    isScheduledProperly(): boolean { // EXPERIMENTAL
        switch (this.builtInFunction.name) {
          case "offset":
            // The offset function (potentially) requires switching to the
            // positioning, so should always be considered out-of-order.
            return false;
        }
        return super.isScheduledProperly();
    }

    toString(): string {
        return this.builtInFunction.name + "(" +
            this.functionArguments.map(function(a){return a.idStr();}).join(", ") +
            ")";
    }

    toFullString(): string {
        return this.builtInFunction.name + "(" +
            this.functionArguments.map(function(a){return a.toFullString();}).join(", ") +
            ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLFunctionCall(this.builtInFunction.name, this.functionArguments, indent);
    }

    toExportString(origin: number): string {
        return "_f(" + this.localityString() + ", " +
            this.builtInFunction.name + ", [" +
            this.functionArguments.map(function(a){
                return a.idExpStr(origin);
            }).join(", ") + "])";
    }

    writeDestination(): FunctionNode {
        switch (this.builtInFunction.name) {
          case "databases":
          case "download":
          case "loginInfo":
            return this;
          case "first":
          case "last":
          case "makeDefined":
          case "mergeWrite":
            return this.functionArguments[0];
          case "prev":
          case "next":
          case "pos":
          case "identify":
          case "executeCompiledQuery":
          case "interpretQuery":
          case "internalApply":
          case "filter":
          case "multiQuery":
          case "sort":
            // They all write to the first argument
            return this.functionArguments[1];
          default:
            return undefined;
        }
    }

    markWritablePath(): void {
        var wrNode: FunctionNode = this.writeDestination();

        if (wrNode !== undefined) {
            if (this.writabilityUndetermined()) {
                this.writable = true;
                wrNode.markWritablePath();
                FunctionNode.writabilityQueue.push(this);
            }
        } else {
            Utilities.warnOnce("cannot write through " + this.builtInFunction.name);
        }
    }

    checkWritability(): void {
        this.writable = this.writeDestination().writable;
    }

    isWritableAware(): boolean {
        // Only functions that have to know they're on a writable path have to
        // return true. Currently, this is only for queries, which only
        // maintain selected positions when they're on a writable path, for
        // efficiency reasons.
        switch (this.builtInFunction.name) {
          case "executeCompiledQuery":
          case "internalApply":
            return true;
        }
        return false;
    }

    // Certain functions always return non-empty non-boolean ordered sets,
    // some depending on their arguments. This is not exhaustive.
    isAlwaysTrue(): boolean {
        switch (this.builtInFunction.name) {
          case "offset":
          case "me":
          case "size":
          case "sum":
          case "pointer":
          case "allAreas":
          case "time":
            return true;
          case "makeDefined":
            return this.functionArguments[0].isAlwaysTrue();
          case "embedding":
          case "embeddingStar":
            // True when no argument is given or the argument is strictly areas
            // and it's not the top level area
            return (this.functionArguments.length === 0 &&
                    this.localToArea !== 1) ||
                   (this.functionArguments[0].valueType.isStrictlyAreas() &&
                    !this.functionArguments[0].valueType.areas.has(1));
        }
        return false;
    }
    
    // Certain functions return a non-av results
    isUnmergeable(): boolean {
        switch (this.builtInFunction.name) {
          case "internalAtomic":
          case "offset":
          case "size":
          case "me": case "embedding": case "embeddingStar": case "embedded": case "embeddedStar":
          case "plus": case "minus": case "mul": case "div": case "pow": case "mod":
          case "ln": case "log10": case "logb": case "exp":
          case "and": case "or": case "not":
          case "lessThan": case "lessThanOrEqual": case "equal": case "notEqual": case "greaterThanOrEqual": case "greaterThan":
          case "index":
          case "concatStr":
          case "numberToString":
          case "bool":
          case "notEmpty": case "empty":
          case "sum": case "min": case "max":
          case "expressionOf": case "referredOf": case "intersectionParentOf":
          case "debugNodeToStr":
          case "pointer":
          case "allAreas": case "areaOfClass": case "classOfArea":
          case "time": case "changed":
          case "makeDefined":
          case "databases":
          case "database":
          case "download":
            return true;
          case "first":
          case "prev":
          case "next":
          case "last":
          case "prevStar":
          case "prevPlus":
          case "nextStar":
          case "nextPlus":
            return this.functionArguments.length === 0 ||
                   this.functionArguments[0].valueType.isStrictlyAreas();
        }
        return false;
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        for (var i = 0; i !== this.functionArguments.length; i++) {
            this.functionArguments[i].setPriority(prio);
        }
        if (this.builtInFunction.name === "areaOfClass") {
            var constStrArg = <ConstNode> this.functionArguments[0];
            var className: any = getDeOSedValue(constStrArg.value);
            // Set all referenced class membership functions to this priority,
            // since they form the implicit argument to this function.
            for (var areaTemplateId: number = 1; areaTemplateId !== areaTemplates.length; areaTemplateId++) {
                var template = areaTemplates[areaTemplateId];
                if (template.exports !== undefined && 0 in template.exports) {
                    var classMembership = <AVFunctionNode> template.exports[0];
                    if (className in classMembership.attributes) {
                        classMembership.attributes[className].setPriority(prio);
                    }
                }
            }
        }
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        switch (this.builtInFunction.name) {
          case "filter":
          case "map":
          case "multiQuery":
          case "internalApply":
            if (this.functionArguments.length === 2) {
                this.functionArguments[0].setDefunArgTypes(this.functionArguments.slice(1), stack);
            }
            break;
        }
        delete stack[this.seqNr];
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = this.builtInFunction.classConstructor === undefined?
            new EvaluationFunctionApplication(this, local):
            new this.builtInFunction.classConstructor(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.functionArguments.length; i++) {
            evalNode.addArgument(i,
                getEvaluationNode(this.functionArguments[i], local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return this.functionArguments;
    }

    static nonConstantFunctionNames: {[name: string]: boolean} = {
        arg: true,
        datasource: true,
        datatable: true,
        databases: true,
        database: true,
        overlap: true,
        time: true,
        changed: true,
        datasourceInfo: true,
        testStore: true,
        loginInfo: true,
        tempAppStateConnectionInfo: true
    };

    functionIsConstant(): boolean {
        var name: string = this.builtInFunction.name;

        return !this.builtInFunction.dependingOnImplicitArguments &&
               !this.builtInFunction.transientResult &&
               !(name in FunctionApplicationNode.nonConstantFunctionNames);
    }

    static buildFunctionApplication(funDef: BuiltInFunction, functionArguments: FunctionNode[], localToArea: number, localToDefun: number, origin: number, origExpr: Expression): FunctionNode {

        // Creates the normal function application
        function makeDefaultFunctionApplication(): FunctionNode {
            return substituteEmbeddingChain(
                new FunctionApplicationNode(
                    funDef, functionArguments, localToArea, localToDefun,
                    getValueType(funDef, functionArguments, localToArea),
                    origExpr, origin));
        }

        // Check if the two function arguments intersection at a known area,
        // e.g. [me] and [embeddingStar]
        function checkKnownIntersection(f1: FunctionNode, f2: FunctionNode): FunctionNode {
            var l1 = levelOfEmbeddingFun(f1, origin);
            var l2 = levelOfEmbeddingFun(f2, origin);

            if (l1 !== undefined && l2 !== undefined && l1.match(l2)) {
                var l12sup = Math.min(l1.intMax(), l2.intMax());
                var l12inf = Math.max(l1.intMin(), l2.intMin());
                if (l12sup === l12inf) {
                    // There is precisely one intersecting area
                    var refAreaId: number = getParent(origin, l12sup);
                    return new FunctionApplicationNode(me, [], refAreaId, localToDefun,
                                getValueType(me, [], refAreaId), origExpr, origin);
                }
            }
            return undefined;
        }

        if (localToDefun === undefined) {
            localToDefun = 0;
            for (var i = 0; i !== functionArguments.length; i++) {
                localToArea = mergeLocality(localToArea, functionArguments[i].localToArea);
                localToDefun = mergeDefunLocality(localToDefun, functionArguments[i].localToDefun);
            }
        }
        var wontChangeValue: boolean = inputsWontChangeValue(functionArguments);
        var fa = removeRedundantArguments(funDef, functionArguments, origExpr, wontChangeValue);
        if (fa !== undefined) {
            if (fa.repl !== undefined) {
                return fa.repl;
            }
            funDef = fa.funDef;
            functionArguments = fa.args;
        }
        var c = checkConstantResult(funDef, functionArguments, origExpr, wontChangeValue);
        if (c !== undefined) {
            return c;
        }
        switch (funDef.name) {
          case "areaOfClass":
            return AreaOfClassNode.build(functionArguments, localToArea,
                                         localToDefun, origin, origExpr);
          case "dynamicAttribute":
            return FunctionApplicationNode.buildDynamicAttribute(
                functionArguments, localToArea, localToDefun, origin, origExpr);
          case "displayWidth":
          case "displayHeight":
          case "baseLineHeight":
            return DisplayOffsetNode.build(funDef.name, functionArguments,
                                       localToArea, localToDefun, origin, origExpr);
          case "sort":
            return SortNode.build(functionArguments, localToArea,
                                  localToDefun, origExpr);
          case "internalApply":
            return FunctionApplicationNode.buildInternalApply(
                functionArguments,
                getValueType(funDef, functionArguments, localToArea),
                localToArea, localToDefun, origExpr);
          case "compareAreasQuery":
            c = checkKnownIntersection(functionArguments[0], functionArguments[1]);
            if (c !== undefined) {
                return c;
            }
            break;
          case "first":
            var firstArg = functionArguments[0];
            if (firstArg instanceof FunctionApplicationNode &&
                  firstArg.builtInFunction.name === "compareAreasQuery") {
                // Check [first, [<areaSet, [areaOfClass, "X"]]]
                var q1 = firstArg.functionArguments[0];
                var q2 = firstArg.functionArguments[1];
                c = buildAreaOfClassQuery("first", q1, q2, origin, origExpr);
                if (c !== undefined) {
                    return c;
                }
            } else if (firstArg instanceof FunctionApplicationNode &&
                       firstArg.builtInFunction === me) {
                return firstArg;
            }
            break;
          case "last":
            var lastArg = functionArguments[0];
            if (lastArg instanceof FunctionApplicationNode &&
                  lastArg.builtInFunction.name === "compareAreasQuery") {
                // Check [last, [<areaSet, [areaOfClass, "X"]]]
                var q1 = lastArg.functionArguments[0];
                var q2 = lastArg.functionArguments[1];
                c = buildAreaOfClassQuery("last", q1, q2, origin, origExpr);
                if (c !== undefined) {
                    return c;
                }
            } else if (lastArg instanceof FunctionApplicationNode &&
                       lastArg.builtInFunction === me) {
                return firstArg;
            }
            break;
          case "pos":
            var posArg = functionArguments[0];
            var posSetArg = functionArguments[1];
            if (posArg instanceof ConstNode &&
                  posSetArg instanceof FunctionApplicationNode &&
                  posSetArg.builtInFunction.name === "compareAreasQuery" &&
                  (sveq(posArg.value, 0) || sveq(posArg.value, 1))) {
                // Check [pos, 0/1, [<areaSet, [areaOfClass, "X"]]]
                var q1 = posSetArg.functionArguments[0];
                var q2 = posSetArg.functionArguments[1];
                c = buildAreaOfClassQuery(sveq(posArg.value, 0)? "first": "last",
                                          q1, q2, origin, origExpr);
                if (c !== undefined) {
                    return c;
                }
            }
            break;
        }
        return makeDefaultFunctionApplication();
    }

    static buildDynamicAttribute(functionArguments: FunctionNode[],
                             localToArea: number, localToDefun: number,
                             origin: number, origExpr: Expression): FunctionNode
    {
        var attrFun: FunctionNode = functionArguments[0];
        var baseAVFun: FunctionNode = functionArguments[2];
        var constantAttributeName: string = undefined;

        if (attrFun instanceof ConstNode && baseAVFun instanceof ConstNode) {
            if (attrFun.value instanceof Array &&
                attrFun.value.length === 1 &&
                typeof(attrFun.value[0]) === "string") {
                constantAttributeName = attrFun.value[0];
            } else if (typeof(attrFun.value) === "string") {
                constantAttributeName = attrFun.value;
            }
            if (!((baseAVFun.value instanceof Array &&
                   baseAVFun.value.length === 1 &&
                   typeof(baseAVFun.value[0]) === "object" &&
                   Utilities.isEmptyObj(baseAVFun.value[0])) ||
                  (typeof(attrFun.value) === "object" &&
                   Utilities.isEmptyObj(baseAVFun.value)))) {
                constantAttributeName = undefined;
            }
        }
        if (constantAttributeName === undefined) {
            return new FunctionApplicationNode(
                dynamicAttribute, functionArguments, localToArea, localToDefun,
                getValueType(dynamicAttribute, functionArguments, localToArea),
                origExpr, origin);
        } else {
            var attributes: {[attr: string]: FunctionNode} = {};
            attributes[constantAttributeName] = functionArguments[1];
            return AVFunctionNode.build(attributes, undefined, {}, origExpr);
        }
    }
    
    // Returns 0 when query === data, 1 when query <= data, 2 when data <= query,
    // undefined when neither or unknown.
    // TODO: Now only walks over application and filter expressions, but should at
    // least also look through dynamicAttribute, variants, area projections, and
    // probably defuns to be of any use.
    // NOTE: assumes multiQuery only performs selections.
    // function testForSubSet(query: FunctionNode, data: FunctionNode): number {
    //     if (query.isEqual(data)) {
    //         return 0;
    //     }
    //     if (query instanceof FunctionApplicationNode) {
    //         if (((query.builtInFunction === internalApply ||
    //                 query.builtInFunction === executeCompiledQuery) &&
    //                query.functionArguments[0].isStrictSelection()) ||
    //               query.builtInFunction === multiQuery ||
    //               query.builtInFunction === filter) {
    //             switch (testForSubSet(query.functionArguments[1], data)) {
    //               case 0:
    //               case 1:
    //                 return 1;
    //               default:
    //                 return undefined;
    //             }
    //         }
    //     }
    //     if (data instanceof FunctionApplicationNode) {
    //         if (((data.builtInFunction === internalApply ||
    //                 data.builtInFunction === executeCompiledQuery) &&
    //                data.functionArguments[0].isStrictSelection()) ||
    //               data.builtInFunction === multiQuery ||
    //               data.builtInFunction === filter) {
    //             switch (testForSubSet(query, data.functionArguments[1])) {
    //               case 0:
    //               case 2:
    //                 return 2;
    //               default:
    //                 return undefined;
    //             }
    //         }
    //     }
    //     return undefined;
    // }

    static buildInternalApply(functionArgs: FunctionNode[], valueType: ValueType,
                              localToArea: number, localToDefun: number,
                              origExpr: Expression): FunctionNode
    {
        // var query = functionArgs[0], data = functionArgs[1]; If query is
        // guaranteed to be a subset of data or vice versa, we can just return
        // the smallest set.  The test doesn't do anything useful at this
        // moment, and only takes time during compilation.
        // if (testForSubSet(query, data) !== undefined) { Utilities.warnOnce("strict subset detected"); }
        return new FunctionApplicationNode(
            internalApply, functionArgs, localToArea, localToDefun,
            valueType, origExpr);
    }

    // static buildExecuteCompiledQuery(compiledQuery: CompiledFunctionNode,
    //                                  data: FunctionNode, valueType: ValueType,
    //                                  origExpr: Expression): FunctionNode
    // {
    //     return new FunctionApplicationNode(
    //         executeCompiledQuery, [compiledQuery, data],
    //         mergeLocality(compiledQuery.localToArea, data.localToArea),
    //         mergeDefunLocality(compiledQuery.localToDefun, data.localToDefun),
    //         valueType, origExpr);
    // }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var funDef: BuiltInFunction = this.builtInFunction;
        var functionArguments: FunctionNode[] = new Array<FunctionNode>(this.functionArguments.length);
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var change: boolean = false;

        if (funDef.isLocalWithoutArguments && functionArguments.length === 0) {
            localToArea = this.localToArea;
        } else if (funDef.dependingOnImplicitArguments) {
            localToArea = getLocalToAreaOfBuiltInFunction(funDef, this.localToArea);
        }
        for (var i = 0; i !== this.functionArguments.length; i++) {
            var fun = this.functionArguments[i].containsQualifiedExpression &&
                      this.functionArguments[i].hasSameVariantLocalityAs(this)?
                this.functionArguments[i].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.functionArguments[i];
            localToArea = mergeLocality(localToArea, fun.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
            if (this.functionArguments[i] !== fun) {
                change = true;
            }
            functionArguments[i] = fun;
        }
        if (!change) {
            return this;
        // } else if (funDef === executeCompiledQuery) {
        //     var compiledQuery = <CompiledFunctionNode> this.functionArguments[0];
        //     var arg: FunctionNode = this.functionArguments[1];
        //     var newValueType: ValueType = compiledQuery.isProjection?
        //         determineQueryValueType(compiledQuery.query, arg): arg.valueType;
        //     return new FunctionApplicationNode(
        //         funDef, functionArguments, localToArea, localToDefun,
        //         newValueType, this.origExpr, origin);
        } else {
            return FunctionApplicationNode.buildFunctionApplication(
                funDef, functionArguments, localToArea, localToDefun,
                origin, this.origExpr);
        }
    }

    getDataSourceInputs(): FunctionNode[] {
        switch (this.builtInFunction.name) {
          case "multiQuery":
          case "executeCompiledQuery":
          case "sort":
          case "identify":
          case "internalApply":
            // Only when it has two arguments
            return this.functionArguments.length === 2?
                   [this.functionArguments[1]]: [];
          default:
            return [];
        }
    }

    getBoolInterpretation(): FunctionNode {
        switch (this.builtInFunction.name) {
          case "allAreas":
          case "pointer":
          case "me":
          case "sum":
          case "displayWidth":
          case "displayHeight":
          case "baseLineHeight":
          case "defun":
            return buildConstNode([true], true, undefined, 0, gTrueExpr);
          case "embedding":
          case "embeddingStar":
            // False for screen area, true for all others
            return this.localToArea === 1?
                buildConstNode([], true, undefined, 0, gEmptyOSExpr):
                buildConstNode([true], true, undefined, 0, gTrueExpr);
        }
        return super.getBoolInterpretation();
    }

    // Does not support all writes.
    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        // [EXECUTECOMPILEDQUERY]
        // if (this.builtInFunction === executeCompiledQuery) {
        //     var cfn = <CompiledFunctionNode> this.functionArguments[0];
        //     var writePaths = cfn.writePaths;
        //     wrNodes = extractWritableDestinations(this.functionArguments[1],
        //            writePaths === undefined? path: writePaths.concat(path));
        // } else
        if (this.builtInFunction === internalApply) {
            var writePath: string[] = this.functionArguments[0].valueType.
                                                             extractWritePath();
            if (writePath !== undefined) {
                wrNodes = this.functionArguments[1].
                    extractWritableDestinations(writePath.concat(path), visited);
            } else {
                wrNodes = [];
            }
        } else if (this.builtInFunction === identify ||
                   this.builtInFunction === sort ||
                   this.builtInFunction === pos) {
            wrNodes = this.functionArguments[1].extractWritableDestinations(path, visited);
        } else if (this.builtInFunction === last ||
                   this.builtInFunction === first) {
            wrNodes = this.functionArguments[0].extractWritableDestinations(path, visited);
        } else {
            wrNodes = [];
        }
        delete visited[this.seqNr];
        return wrNodes;
    }
}

// Special treatment of the implicit functional arguments
class AreaOfClassNode extends FunctionApplicationNode {

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = super.getMaximumInputId(stack, process, setId);
        var scheduleStep: number = this.scheduleStep - 1;
        var constStrArg = <ConstNode> this.functionArguments[0];
        var className: any = getDeOSedValue(constStrArg.value);

        stack[this.seqNr] = true;
        // Set all referenced class membership functions to this priority,
        // since they form the implicit argument to this function.
        for (var areaTemplateId: number = 1; areaTemplateId !== areaTemplates.length; areaTemplateId++) {
            var template = areaTemplates[areaTemplateId];
            if (template.exports !== undefined && 0 in template.exports) {
                var classes = <AVFunctionNode> template.exports[0];
                if (className in classes.attributes) {
                    var stNr: number = classes.attributes[className].seqNr;
                    var classMembership: FunctionNode;
                    if (stNr in stack) {
                        Utilities.warnOnce("class membership " + className +
                              " for @" + areaTemplateId + " depends on itself");
                        classMembership = classes.attributes[className];
                    } else {
                        stack[stNr] = true;
                        classMembership = process(
                                   classes.attributes[className], stack, false);
                        classes.attributes[className] = classMembership;
                        delete stack[stNr];
                    }
                    if (classMembership.localToArea === this.localToArea &&
                          classMembership.id > mid) {
                        mid = classMembership.id;
                    }
                    scheduleStep = classMembership.maxScheduleStep(this.prio, scheduleStep);
                }
            }
        }
        delete stack[this.seqNr];
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        super.setPriority(prio);

        var constStrArg = <ConstNode> this.functionArguments[0];
        var className: any = getDeOSedValue(constStrArg.value);

        // Set all referenced class membership functions to this priority,
        // since they form the implicit argument to this function.
        for (var areaTemplateId: number = 1; areaTemplateId !== areaTemplates.length; areaTemplateId++) {
            var template = areaTemplates[areaTemplateId];
            if (template.exports !== undefined && 0 in template.exports) {
                var classMembership = <AVFunctionNode> template.exports[0];
                if (className in classMembership.attributes) {
                    classMembership.attributes[className].setPriority(prio);
                }
            }
        }
    }

    // Show the arguments...
    toString(): string {
        return this.builtInFunction.name + "(" +
            this.functionArguments.map(function(a){return a.toString();}).join(", ") +
            ")";
    }

    allInputs(): FunctionNode[] {
        var all: FunctionNode[] = this.functionArguments.slice();
        var constStrArg = <ConstNode> this.functionArguments[0];
        var className: any = getDeOSedValue(constStrArg.value);

        for (var areaTemplateId: number = 1; areaTemplateId !== areaTemplates.length; areaTemplateId++) {
            var template = areaTemplates[areaTemplateId];
            if (template.exports !== undefined && 0 in template.exports) {
                var classes = <AVFunctionNode> template.exports[0];
                if (className in classes.attributes) {
                    all.push(classes.attributes[className]);
                    
                }
            }
        }
        return all;
    }

    static getValueType(args: FunctionNode[]): ValueType { 
        var valueType: ValueType = new ValueType();

        if (args.length === 1 && args[0].isSingleString()) {
            var c = <ConstNode> args[0];
            var className: string = c.value instanceof Array? c.value[0]: c.value;
            for (var areaTemplateId: number = 1; areaTemplateId !== areaTemplates.length; areaTemplateId++) {
                var template: AreaTemplate = areaTemplates[areaTemplateId];
                if (template.classes !== undefined && className in template.classes) {
                    var nrAreas = template.getNumberOfAreasRangeUnder(1);
                    var membership = <AVFunctionNode> template.exports[0];
                    if (membership === undefined ||
                          !(className in membership.attributes) ||
                          !membership.attributes[className].isAlwaysTrue()) {
                        nrAreas = ValueTypeSize.max(nrAreas);
                    }
                    valueType.addArea(template.id, nrAreas);
                }
            }
        } else {
            Utilities.syntaxError("wrong arguments for areaOfClass: " +
                    args.map(function(fn:FunctionNode){return fn.toString();}));
        }
        if (valueType.unknown) { // no such area found
            valueType.sizes = [_r(0, 0)];
        }
        return valueType;
    }

    // Replaces static children of the screen area by [me] at the template,
    // which is equivalent to [embedding, [embedding, ...]].
    // origin should be the template id in which the expression is evaluated in
    // order for this to work.
    // TODO: add size
    static build(args: FunctionNode[], locality: number, defun: number,
                 origin: number, origExpr: Expression): FunctionNode
    {
        var valueType: ValueType = AreaOfClassNode.getValueType(args);
        var template: AreaTemplate = undefined;

        if (valueType.unknown) {
            // No template matches the class
            valueType.checkConsistency();
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        for (var areaTemplateId of valueType.areas.keys()) {
            if (template !== undefined) {
                template = undefined;
                break;
            }
            template = areaTemplates[areaTemplateId];
        }
        if (origin !== undefined && template !== undefined &&
              template.getNrParentIndices() === 0 &&
              getLevelDifference(origin, template.id, false) !== undefined) {
            var m = buildSimpleFunctionNode(gMeExpr, undefined, template.id, 0,
                        undefined, undefined, undefined, origExpr, template.id);
            return m;
        }
        return new AreaOfClassNode(areaOfClass, args, locality, defun, valueType, origExpr);
    }

    // [areaOfClass, "X"] is always true when there is a static area which is
    // always of class X. It seems useless to add isAlwaysFalse().
    isAlwaysTrue(): boolean {
        var c = <ConstNode> this.functionArguments[0];
        var className: string = c.value instanceof Array? c.value[0]: c.value;

        assert(typeof(className) === "string", "error in assumption");
        for (var areaTemplateId: number = 1; areaTemplateId !== areaTemplates.length; areaTemplateId++) {
            var template: AreaTemplate = areaTemplates[areaTemplateId];
            if (template.getNrParentIndices() === 0 &&
                  template.exports !== undefined && 0 in template.exports) {
                var classes = <AVFunctionNode> template.exports[0];
                if (className in classes.attributes) {
                    if (classes.attributes[className].isAlwaysTrue()) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    isUnmergeable(): boolean {
        return true;
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    getExistenceConditionForTemplate(template: AreaTemplate): FunctionNode {
        var classMembership: AVFunctionNode;
        var c = <ConstNode> this.functionArguments[0];
        var className: string = c.value instanceof Array? c.value[0]: c.value;

        template.determineClassMembership();
        classMembership = <AVFunctionNode> template.exports[0];
        return className in classMembership.attributes?
               classMembership.attributes[className]:
               buildConstNode([], true, undefined, 0, gEmptyOSExpr);
    }
}

//
// displayWidth/displayHeightbaseLineHeight have an implicit functional argument - the
//  area's display-description
//
// the constructor realizes this argument from being an implicit argument to
//  being the very explicit first element in 'functionArguments' it is passing
//  to its FunctionApplicationNode superclass constructor.
//
// the static method 'build' deals with getting the display section of the
// context area, as indicated by 'origin', and converting it to a FunctionNode.
//
// the nodes created by 'build' always have exactly two arguments - the area's
//   display, and the 'optional' a/v argument; in case the optional argument
//   was ommitted, an empty o/s is used.
// as a consequence, if a function finds its way a second time into
//  DisplayOffsetNode.build, we know to avoid re-adding the area's display
//  the second time around, as it already has exactly two arguments
//
class DisplayOffsetNode extends FunctionApplicationNode {

    constructor(builtInFunction: BuiltInFunction,
                origFunctionArguments: FunctionNode[],
                locality: number, defun: number, valueType: ValueType,
                origExpr: Expression, displayFunction: FunctionNode)
    {
        
        var functionArguments: FunctionNode[];

        if (origFunctionArguments.length == 2) {
            functionArguments = origFunctionArguments;
        } else {
            functionArguments = [];
            functionArguments.push(displayFunction);

            assert((origFunctionArguments.length == 0) ||
                   (origFunctionArguments.length == 1),
                   "displayWidth/displayHeight/baseLineHeight must have 0 or 1 arguments");

            if (origFunctionArguments.length == 0) {
                var emptyOS: FunctionNode;
                emptyOS = buildConstNode([], true, undefined, 0, gEmptyOSExpr);
                functionArguments.push(emptyOS);
            } else {
                functionArguments.push(origFunctionArguments[0]);
            }
        }

        super(builtInFunction,  functionArguments, locality, defun, valueType, origExpr);
    }

    static build(dim: string, args: FunctionNode[], locality: number,
                 defun: number, origin: number, origExpr: Expression):
    FunctionNode {
        var valueType: ValueType = new ValueType();
        valueType.addNumber().addSize(1);

        var template: AreaTemplate = areaTemplates[origin];
        var displayDescription = template.areaNode.getNodeAtPath(["display"]);

        var dimOffFunc: BuiltInFunction;
        assert(dim === "displayWidth" || dim === "displayHeight" || dim === "baseLineHeight",
               "dim must be either 'displayWidth' or 'displayHeight'");
        dimOffFunc = dim === "displayWidth"? displayWidth:
                     dim === "displayHeight"? displayHeight:
                     baseLineHeight;

        var displayFunction = displayDescription !== undefined?
            buildFunctionNode(displayDescription, origin, defun, true):
            buildConstNode({}, false, true, 0, gEmptyAVExpr);
        return new DisplayOffsetNode(dimOffFunc, args, locality, defun,
                                     valueType, origExpr, displayFunction);
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    // The display offset functions depend on the whole display function (which
    // has to be computed without eliminating qualifiers anyway). If an
    // attribute is used in the display, but in turn depends on a display offset
    // function, the default pickQualifiedExpression() will create an infinite
    // recursion. 
    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        return this;
    }
}

class CompiledFunctionNode extends FunctionNode {
    name: string;
    compiledFunction: (v: any, args: any[]) => any;
    arguments: FunctionNode[];
    writePaths: any; // Only single write path permitted right now
    query: any;
    isSelection: boolean;
    isProjection: boolean;
    dataRepresentation: FunctionNode;

    constructor(name: string, compiledFunction: (v: any, args: any[]) => any,
                args: FunctionNode[], writePaths: any, query: any,
                isSelection: boolean, isProjection: boolean,
                dataRepresentation: FunctionNode,
                locality: number, defun: number, origExpr: Expression) {
        super(locality, defun, undefined, origExpr);
        this.name = name;
        this.compiledFunction = compiledFunction;
        this.arguments = args;
        this.writePaths = writePaths;
        this.query = query;
        this.isSelection = isSelection;
        this.isProjection = isProjection;
        this.dataRepresentation = dataRepresentation;
        if (doCompileTimeChecks) {
            this.valueType = new ValueType().addQuery();
            if (dataRepresentation !== undefined) {
                this.valueType = this.valueType.merge(dataRepresentation.valueType);
            }
            this.checkForQualifiedExpressions();
        }
    }

    type(): FunctionNodeType {
        return FunctionNodeType.compiledFunctionApplication;
    }

    specificEqual(fn: CompiledFunctionNode): boolean {
        return this.name === fn.name &&
            this.compiledFunction === fn.compiledFunction &&
            (this.dataRepresentation === fn.dataRepresentation ||
             (this.dataRepresentation !== undefined &&
              fn.dataRepresentation !== undefined &&
              this.dataRepresentation.isEqual(fn.dataRepresentation))) &&
            arrayEqual(this.arguments, fn.arguments);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        if (this.dataRepresentation !== undefined) {
            this.dataRepresentation = process(this.dataRepresentation, stack, false);
            if (this.dataRepresentation.localToArea === this.localToArea &&
                  this.dataRepresentation.id > mid) {
                mid = this.dataRepresentation.id;
            }
            scheduleStep = this.dataRepresentation.maxScheduleStep(this.prio, scheduleStep);
        }
        // The part below is only needed when dataRepresentation is undefined,
        // as the arguments are below dataRepresentation.
        for (var i = 0; i !== this.arguments.length; i++) {
            this.arguments[i] = process(this.arguments[i], stack, false);
            if (this.arguments[i].localToArea === this.localToArea &&
                  this.arguments[i].id > mid) {
                mid = this.arguments[i].id;
            }
            scheduleStep = this.arguments[i].maxScheduleStep(this.prio, scheduleStep);
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        var str: string = "function " + this.name + "(" +
            this.arguments.map(function(a){return a.idStr();}).
            concat(JSON.stringify(this.writePaths)).join(", ") + ")";

        return this.dataRepresentation === undefined? str:
            str + "/" + this.dataRepresentation.toString();
    }

    toFullString(): string {
        var str: string = "function " + this.name + "(" +
            this.arguments.map(function(a){return a.toFullString();}).join(", ") +
            ", " + JSON.stringify(this.writePaths) + ")";

        return this.dataRepresentation === undefined? str:
            str + "/" + this.dataRepresentation.toFullString();
    }

    toCDLString(indent: string = undefined): string {
        return this.dataRepresentation !== undefined?
            this.dataRepresentation.toCDLString(undefined):
            this.query !== undefined? this.query.toCdlString():
            (<any>this.compiledFunction).queryStr === undefined? "unknownquery":
            (<any>this.compiledFunction).queryStr;
    }

    toExportString(origin: number): string {
        var args: string = this.localityString() + ", " + this.name + ", [" +
            this.arguments.map(function(a){
                return a.idExpStr(origin);
            }).join(", ") + "], " + JSON.stringify(this.writePaths) + ", " +
            (this.dataRepresentation? this.dataRepresentation.idExpStr(origin): "undefined");

        return "_c(" + args + ")";
    }


    markWritablePath(): void {
        Utilities.warnOnce("cannot write through compiled function");
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        for (var i = 0; i !== this.arguments.length; i++) {
            this.arguments[i].setPriority(prio);
        }
        if (this.dataRepresentation !== undefined) {
            this.dataRepresentation.setPriority(prio);
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationCompiledFunction(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setDataRepresentation(getEvaluationNode(this.dataRepresentation, local));
        for (var i: number = 0; i !== this.arguments.length; i++) {
            evalNode.addArgument(i,
                       getEvaluationNode(this.arguments[i], local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return this.arguments;
    }

    isAlwaysTrue(): boolean {
        return true;
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    isStrictSelection(): boolean {
        return this.isSelection && !this.isProjection;
    }

    checkWritability(): void {
        Utilities.error("do not call");
    }
}

class SortNode extends FunctionApplicationNode {
    areaSort: boolean = false;
    sortKeyExportIds: number[];

    constructor(functionArguments: FunctionNode[], locality: number,
                defun: number, areaSort: boolean, valueType: ValueType,
                origExpr: Expression) {
        super(sort, functionArguments, locality, defun, valueType, origExpr);
        this.areaSort = areaSort;
    }

    toExportString(origin: number): string {
        return "_srt(" + this.localityString() + ", " + this.areaSort + ", [" +
            this.functionArguments.map(function(a){
                return a.idExpStr(origin);
            }).join(", ") + "])";
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        for (var i = 0; i !== this.functionArguments.length; i++) {
            this.functionArguments[i] = process(this.functionArguments[i], stack, false);
            if (this.functionArguments[i].localToArea === this.localToArea &&
                  this.functionArguments[i].id > mid) {
                mid = this.functionArguments[i].id;
            }
            scheduleStep = this.functionArguments[i].maxScheduleStep(this.prio, scheduleStep);
        }
        if (this.areaSort) {
            for (var areaTemplateId of this.functionArguments[0].valueType.areas.keys()) {
                var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
                ensureTemplateDependency(areaTemplate, stack, process);
                for (var i: number = 0; i < this.sortKeyExportIds.length; i++) {
                    var exportId = this.sortKeyExportIds[i];
                    var exportNode: FunctionNode = areaTemplate.exports[exportId];
                    if (exportNode !== undefined) {
                        if (!(exportNode.seqNr in stack)) {
                            var csi: number;
                            if (FunctionNode.cacheDbg !== undefined) {
                                csi = FunctionNode.cacheDbg.length;
                                areaTemplate.cacheStage[csi] = "export " + exportPaths[exportId];
                                FunctionNode.cacheDbg.push(areaTemplate);
                            }
                            stack[exportNode.seqNr] = true;
                            areaTemplate.exports[exportId] = exportNode =
                                process(exportNode, stack, false);
                            if (FunctionNode.cacheDbg !== undefined)
                                FunctionNode.cacheDbg.pop();
                            delete stack[exportNode.seqNr];
                        }
                        scheduleStep = exportNode.maxScheduleStep(this.prio, scheduleStep);
                    }
                }
            }
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationSort(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.functionArguments.length; i++) {
            evalNode.addArgument(i,
                           getEvaluationNode(this.functionArguments[i], local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        var allInputs: FunctionNode[] = super.allInputs().slice(0);

        if (this.areaSort) {
            for (var areaTemplateId of this.functionArguments[0].valueType.areas.keys()) {
                var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
                for (var i: number = 0; i < this.sortKeyExportIds.length; i++) {
                    var exportId = this.sortKeyExportIds[i];
                    var exportNode: FunctionNode = areaTemplate.exports[exportId];
                    if (exportNode !== undefined) {
                        allInputs.push(exportNode);
                    }
                }
            }
        }
        return allInputs;
    }

    allLocalInputs(): FunctionNode[] {
        return super.allLocalInputs();
    }

    static build(args: FunctionNode[], localToArea: number, localToDefun: number, origExpr: Expression): FunctionNode {
        var sn: SortNode = new SortNode(args, localToArea, localToDefun,
                                        false, args[0].valueType, origExpr);

        if (args[0].valueType.isStrictlyAreas()) {
            var paths: string[][] = args[1].getSortKeys();
            sn.areaSort = true;
            sn.sortKeyExportIds = [];
            for (var i: number = 0; i < paths.length; i++) {
                // Make sure all eligible areas export the requested paths and
                // store the ids for later use
                sn.sortKeyExportIds.push(getExportId(normalizePath(paths[i]),
                                                     args[0].valueType.areas));
            }
        }
        return sn;
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var functionArguments: FunctionNode[] = new Array<FunctionNode>(this.functionArguments.length);
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var change: boolean = false;

        for (var i = 0; i !== this.functionArguments.length; i++) {
            var fun = this.functionArguments[i].containsQualifiedExpression &&
                      this.functionArguments[i].hasSameVariantLocalityAs(this)?
                this.functionArguments[i].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.functionArguments[i];
            localToArea = mergeLocality(localToArea, fun.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, fun.localToDefun);
            if (this.functionArguments[i] !== fun) {
                change = true;
            }
            functionArguments[i] = fun;
        }
        if (!change) {
            return this;
        }
        return SortNode.build(functionArguments, localToArea, localToDefun, this.origExpr);
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        this.functionArguments[0].setDefunArgTypes(args, stack);
        delete stack[this.seqNr];
    }

    getDataSourceInputs(): FunctionNode[] {
        return [this.functionArguments[1]];
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        super.setPriority(prio);
        if (this.areaSort) {
            for (var areaTemplateId of this.functionArguments[0].valueType.areas.keys()) {
                var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
                for (var i: number = 0; i < this.sortKeyExportIds.length; i++) {
                    var exportId = this.sortKeyExportIds[i];
                    var exportNode: FunctionNode = areaTemplate.exports[exportId];
                    if (exportNode !== undefined) {
                        exportNode.setPriority(prio);
                    }
                }
            }
        }
    }
}

// For storing values. Used as a "writeable" node, and for param.areaSet*
class StorageNode extends FunctionNode {

    path: string[]; // path within the area
    pathInfo: PathInfo; // the specific value in the node

    constructor(path: string[], locality: number, defun: number,
               pathInfo: PathInfo, valueType: ValueType, origExpr: Expression) {
        super(locality, defun, valueType, origExpr);
        this.path = path;
        this.scheduleStep = 0;
        this.pathInfo = pathInfo;
        this.hasWritableReference = true;
        if (doCompileTimeChecks) {
            this.containsQualifiedExpression = false;
            storeWritableNode(locality, defun, path, this);
        }
    }

    type(): FunctionNodeType {
        return FunctionNodeType.storage;
    }

    specificEqual(fn: StorageNode): boolean {
        return objectEqual(this.path, fn.path);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        if (setId) {
            this.scheduleStep = !this.localToArea? 0:
                areaTemplates[this.localToArea].getScheduleStep(stack, process) + 1;
        }
        return -1;
    }
    
    toString(): string {
        return "store([" + (this.path? this.path.toString(): "<>") + "])";
    }

    toExportString(origin: number): string {
        return "_st(" + this.localityString() + ", " +
            JSON.stringify(this.path) + ")";
    }

    toCDLString(indent: string = undefined): string {
        return "[" + pathToQueryString(this.path, "_") + ", [storage]]";
    }

    // Ensures that the valueType of this is compatible with the parameter "valueType"
    // and merges it as well on the pathInfo's valueType, so that the next creation
    // of a writable node at this path can see the accumulated type.
    makeCompatible(valueType: ValueType): void {
        if (!this.valueType.subsumes(valueType)) {
            this.valueType.checkForSpellingErrors(valueType);
            var mergeType = this.valueType.merge(valueType);
            signalOutputChange(undefined, {
                type: "valueTypeChange",
                origType: this.valueType,
                newType: mergeType
            });
            this.valueType = mergeType;
        }
        if (this.pathInfo !== undefined &&
              (this.pathInfo.valueType === undefined ||
               !this.pathInfo.valueType.subsumes(valueType))) {
            var mergeType = this.pathInfo.valueType === undefined? valueType:
                            this.pathInfo.valueType.merge(valueType);
            signalOutputChange(undefined, {
                type: "valueTypeChange",
                origType: this.pathInfo.valueType,
                newType: mergeType
            });
            this.pathInfo.valueType = mergeType;
        }
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        this.writable = true;
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        if (this.path[0] === "param" && this.path[1] === "areaSetContent") {
            var template: AreaTemplate = areaTemplates[this.localToArea];
            if (template.parent.setFunctions[template.childName] !== undefined &&
                  template.parent.setFunctions[template.childName].data !== undefined) {
                template.parent.setFunctions[template.childName].data.setPriority(prio);
            }
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationStore = this.localToDefun === 0?
            new EvaluationStore(this, local):
            new EvaluationDefunParameter(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return [];
    }

    functionIsConstant(): boolean {
        return false;
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        return [{functionNode: this, path: path, qualifiers: []}];
    }
}

class MessageQueueNode extends StorageNode {

    constructor(path: string[], locality: number, defun: number,
                valueType: ValueType, origExpr: Expression) {
        super(path, locality, defun, undefined, valueType, origExpr);
    }

    type(): FunctionNodeType {
        return FunctionNodeType.messageQueue;
    }

    toString(): string {
        return "messageQueue()";
    }

    toExportString(origin: number): string {
        return "_mq(" + this.localityString() + ", " + JSON.stringify(this.path) + ")";
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationMessageQueue = new EvaluationMessageQueue(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        return evalNode;
    }
}

class PointerStorageNode extends StorageNode {

    constructor(path: string[], locality: number, defun: number,
                valueType: ValueType, origExpr: Expression) {
        super(path, locality, defun, undefined, valueType, origExpr);
    }

    type(): FunctionNodeType {
        return FunctionNodeType.pointerStorage;
    }

    toString(): string {
        return "pointer()";
    }

    toExportString(origin: number): string {
        return "_ptr(" + this.localityString() + ", " + JSON.stringify(this.path) + ")";
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationPointerStore = new EvaluationPointerStore(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        return evalNode;
    }
}

class DebugBreakNode extends StorageNode {

    constructor(path: string[]) {
        super(path, undefined, 0, undefined, new ValueType().addSize(1), undefined);
    }

    type(): FunctionNodeType {
        return FunctionNodeType.debugBreak;
    }

    toString(): string {
        return "debugBreak()";
    }

    toExportString(origin: number): string {
        return "_dB(" + this.localityString() + ", " + JSON.stringify(this.path) + ")";
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationDebugBreak = new EvaluationDebugBreak(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        return evalNode;
    }
}

class ParamStorageNode extends StorageNode {

    constructor(path: string[], locality: number, defun: number,
                valueType: ValueType, origExpr: Expression) {
        super(path, locality, defun, undefined, valueType, origExpr);
    }

    type(): FunctionNodeType {
        return FunctionNodeType.paramStorage;
    }

    toExportString(origin: number): string {
        return "_par(" + this.localityString() + ", " + JSON.stringify(this.path) + ")";
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            var template: AreaTemplate = areaTemplates[this.localToArea];
            var parent: AreaTemplate = template.parent;
            var setFun = parent !== undefined && parent.setFunctions !== undefined?
                         parent.setFunctions[template.childName]: undefined;
            this.writable = true;
            if (setFun !== undefined && setFun.data !== undefined) {
                // Every write to {param: ...} triggers marking the data fun
                setFun.data.markWritablePath();
            }
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        this.writable = true;
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationParam =
            new EvaluationParam(this, local.getOwnId(), local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        return evalNode;
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        if (this.path.length >= 1 && this.path[0] === "areaSetContent") {
            var template = areaTemplates[this.localToArea];
            template.determineSetContent();
            if (template.parent.setFunctions[template.childName].data !== undefined) {
                wrNodes = template.parent.setFunctions[template.childName].data.
                    extractWritableDestinations(path.slice(1), visited);
            } else {
                wrNodes = [];
            }
        } else {
            // No other param's type can be changed
            wrNodes = [];
        }
        delete visited[this.seqNr];
        return wrNodes;
    }
}

class WritableNode extends StorageNode {

    initialValue: FunctionNode;

    // should this writable node be synchronized remotely? (agent)
    remoteWritable: boolean;

    constructor(path: string[], initialValue: FunctionNode, locality: number,
                defun: number, pathInfo: PathInfo, valueType: ValueType,
                origExpr: Expression) {
        super(path, locality, defun, pathInfo, valueType, origExpr);
        this.initialValue = initialValue;
        if (doCompileTimeChecks && this.pathInfo.remoteWritable) {
            // Since remote writable attributes can have values that can not
            // be inferred from merge expressions in the cdl, we add the flag
            // remote and an unbounded size.
            // We do assume that external parties cannot generate area
            // references that have not been written to this attribute, so
            // the combination unknown/remote will be interpreted as data.
            this.valueType = new ValueType().addRemote().addSize(0, Infinity);
        }
    }

    type(): FunctionNodeType {
        return FunctionNodeType.write;
    }

    specificEqual(fn: WritableNode): boolean {
        return objectEqual(this.path, fn.path) &&
            (this.initialValue === fn.initialValue ||
             (this.initialValue !== undefined && fn.initialValue !== undefined &&
              this.initialValue.isEqual(fn.initialValue)));
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        this.initialValue = process(this.initialValue, stack, false);
        if (this.initialValue.localToArea === this.localToArea && this.initialValue.id > mid) {
            mid = this.initialValue.id;
        }
        scheduleStep = this.initialValue.maxScheduleStep(this.prio, scheduleStep);
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        return "write([" + (this.path? this.path.toString(): "<>") + "], " +
            (this.initialValue && this.initialValue.idStr()) + ")";
    }

    toFullString(): string {
        return "write([" + (this.path? this.path.toString(): "<>") + "], " +
            (this.initialValue && this.initialValue.toFullString()) + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLFunctionCall("writable(" + this.path.join(".") + ")",
                                          [this.initialValue], indent);
    }

    toExportString(origin: number): string {
        return "_w(" + this.localityString() + ", " +
            JSON.stringify(this.path) + ", " +
            (this.initialValue == undefined? "undefined": this.initialValue.idExpStr(origin)) + "," +
            JSON.stringify(!!this.pathInfo.remoteWritable) +
            ")";
    }

    markWritablePath(): void {
        this.writable = true;
    }

    // use the export string boolean, generated at compile
    //   from this.pathInfo.remoteWritable, to initialize the
    //   agent's "remoteWritable"
    setRemoteWritability(remoteWritable: boolean): void {
        this.remoteWritable = remoteWritable;
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        if (!(this.initialValue instanceof ConstNode)) {
            this.initialValue.setPriority(prio);
            this.initialValue.setSchedulingError();
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        // templateId, indexId and this.path are the identifiers of the appState
        //  to be used for remote synchronization.
        // for local-writable variables ("*var" rather than "^var"), these are
        // left undefined, indicating to the EvaluationWrite instannce not to
        // synchronize this variable with the remote server
        var templateId: number;
        var indexId: number;

        if (this.remoteWritable) {
            if (local instanceof CoreArea) {
                templateId = local.getPersistentTemplateId();
                indexId = local.getPersistentIndexId();
            } else {
                templateId = gPaidMgr.getGlobalPersistentTemplateId();
                indexId = gPaidMgr.getGlobalPersistentIndexId();
            }
        }

        var evalNode: EvaluationWrite = new EvaluationWrite(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;

        // evalNode has in fact completed its initialization;
        // an EvaluationWrite's 'init' method never does anythin.
        // setting 'isBeingInitialized' to undefined here silences a complaint
        //  'did not complete initialization before activation' in
        //  EvaluationNode.activate()
        evalNode.isBeingInitialized = undefined;
        evalNode.setInitialValue(this.initialValue, local,
                                 templateId, indexId, this.path);
        return evalNode;
    }


    allInputs(): FunctionNode[] {
        return [this.initialValue]; 
    }

    functionIsConstant(): boolean {
        return false;
    }

    updateInitialValue(fn: FunctionNode): void {
        this.initialValue = fn;
        this.makeCompatible(fn.valueType);
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        this.initialValue.setDefunArgTypes(args, stack);
        delete stack[this.seqNr];
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
        super.tagExpressionPath(templateId, defunId, path);
        this.initialValue.tagExpressionPath(templateId, defunId, path + ".initialValue");
    }
}

class QueryComponent {
    path: string[];

    constructor(path: string[]) {
        this.path = path;
    }

    isEqual(qc: QueryComponent): boolean {
        return false;
    }

    toString(): string {
        return "undefined";
    }

}

class QueryComponentProject extends QueryComponent {
    destination: string[] = [];

    constructor(path: string[]) {
        super(path);
    }

    isEqual(qc: QueryComponent): boolean {
        if (!(qc instanceof QueryComponentProject)) {
            return false;
        } else {
            var qcp = <QueryComponentProject> qc;
            return objectEqual(this.path, qcp.path) &&
                objectEqual(this.destination, qcp.destination);
        }
    }
}

class QueryComponentSelect extends QueryComponent {
    selectionExpression: Expression;
    selectionFunction: FunctionNode;
    positive: boolean; // when false, the selection is negated; not yet supported

    constructor(path: string[], selection: Expression, positive: boolean, selectionFunction: FunctionNode) {
        super(path);
        this.selectionExpression = selection;
        this.selectionFunction = selectionFunction;
        this.positive = positive;
    }

    toString(): string {
        return (this.positive? "": "!") +
            "qs([" + (this.path? this.path.toString(): "<>") + "], " + this.selectionFunction.idStr() + ")";
    }

    toFullString(): string {
        return (this.positive? "": "!") +
            "qs([" + (this.path? this.path.toString(): "<>") + "], " + this.selectionFunction.toFullString() + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.selectionFunction.toCDLString(indent);
    }

    toExportString(origin: number): string {
        return this.selectionFunction.idExpStr(origin) + ", " + this.positive;
    }

    isEqual(qc: QueryComponent): boolean {
        if (!(qc instanceof QueryComponentSelect)) {
            return false;
        } else {
            var qcs = <QueryComponentSelect> qc;
            return this.selectionFunction.isEqual(qcs.selectionFunction) &&
                this.positive === qcs.positive &&
                objectEqual(this.path, qcs.path);
        }
    }
}

function pathToQueryString(path: string[], match: string): string {
    var queryStr: string = match;

    for (var i: number = path.length - 1; i >= 0; i--) {
        queryStr = "{" + path[i] + ": " + queryStr + "}";
    }
    return queryStr;
}

function pathToQueryObject(path: string[], match: any): any {
    var queryObj: any = match;

    for (var i: number = path.length - 1; i >= 0; i--) {
        var obj: any = {};
        obj[path[i]] = queryObj;
        queryObj = obj;
    }
    return queryObj;
}

class AreaProjectionNode extends FunctionNode {

    exportId: number;
    path: string[];
    data: FunctionNode;
    allExportNodes: FunctionNode[];
    onAllAreasOfClass: boolean;

    constructor(exportId: number, path: string[], localToArea: number, defun: number,
                data: FunctionNode, onAllAreasOfClass: boolean, valueType: ValueType,
                origExpr: Expression, allExportNodes: FunctionNode[]) {
        super(localToArea, defun, valueType, origExpr);
        this.exportId = exportId;
        this.path = path;
        this.data = data;
        if (doCompileTimeChecks) {
            this.allExportNodes = allExportNodes;
            this.hasWritableReference = allExportNodes.some(fn => fn.hasWritableReference);
            this.checkForQualifiedExpressions();
        }
        this.onAllAreasOfClass = onAllAreasOfClass;
        this.checkForQualifiedExpressions();
    }

    type(): FunctionNodeType {
        return FunctionNodeType.project;
    }

    specificEqual(fn: AreaProjectionNode): boolean {
        return this.exportId === fn.exportId && this.data.isEqual(fn.data);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        exportLevel++;
        this.data = process(this.data, stack, false);
        if (this.data.localToArea === this.localToArea && this.data.id > mid) {
            mid = this.data.id;
        }
        scheduleStep = this.data.maxScheduleStep(this.prio, scheduleStep);
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            if (areaTemplate.doesExist) {
                ensureTemplateDependency(areaTemplate, stack, process);
                var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
                if (exportNode !== undefined) {
                    if (!(exportNode.seqNr in stack)) {
                        var csi: number;
                        if (FunctionNode.cacheDbg !== undefined) {
                            csi = FunctionNode.cacheDbg.length;
                            areaTemplate.cacheStage[csi] = "export " + exportPaths[this.exportId];
                            FunctionNode.cacheDbg.push(areaTemplate);
                        }
                        stack[exportNode.seqNr] = true;
                        areaTemplate.exports[this.exportId] = exportNode =
                            process(exportNode, stack, false);
                        if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
                        delete stack[exportNode.seqNr];
                    }
                    scheduleStep = exportNode.maxScheduleStep(this.prio, scheduleStep);
                }
            }
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        exportLevel--;
        return mid;
    }
    
    toString(): string {
        return "project(#" + this.exportId + "=" +
            exportPaths[this.exportId].toString() + ", " +
            this.data.idStr() + ")";
    }

    toFullString(): string {
        return "project(#" + this.exportId + "=" +
            exportPaths[this.exportId].toString() + ", " +
            this.data.toFullString() + ")";
    }

    toCDLString(indent: string = undefined): string {
        return indent === undefined?
               "[" + pathToQueryString(exportPaths[this.exportId], "_")  + ", " +
                  this.data.toCDLString(undefined) + "]":
               "[" + pathToQueryString(exportPaths[this.exportId], "_")  + ",\n" +
                  indent + "    " + this.data.toCDLString(undefined) + "\n" + indent + "]";
    }

    toExportString(origin: number): string {
        return "_p(" + this.localityString() + ", " + this.exportId +
            ", " + this.data.idExpStr(origin) + ")";
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            for (var areaTemplateId of this.data.valueType.areas.keys()) {
                var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
                var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
                if (exportNode !== undefined) {
                    exportNode.markWritablePath();
                }
            }
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode !== undefined) {
                if (exportNode.writable) {
                    this.writable = true;
                    return;
                }
            }
        }
    }

    isUnmergeable(): boolean {
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode === undefined && !exportNode.isUnmergeable()) {
                return false;
            }
        }
        return true;
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        this.data.setPriority(prio);
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode !== undefined) {
                exportNode.setPriority(prio);
            }
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationAreaProjection =
            new EvaluationAreaProjection(this, this.exportId, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setData(getEvaluationNode(this.data, local));
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        var allInputs: FunctionNode[] = [this.data];

        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode !== undefined) {
                allInputs.push(exportNode);
            }
        }
        return allInputs;
    }

    allLocalInputs(): FunctionNode[] {
        return [this.data];
    }

    functionIsConstant(): boolean {
        var c: boolean = true; // find "lowest" constancy of exported nodes

        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode !== undefined) {
                switch (exportNode.getConstancy()) {
                  case undefined:
                    if (c === true) {
                        c = undefined;
                    }
                    break;
                  case false:
                    c = false;
                    break;
                }
                if (c === false) {
                    break;
                }
            }
        }
        if (c === true) {
            return this.data.getConstancy();
        } else {
            return c;
        }
    }

    static build(exportId: number, path: string[], data: FunctionNode, onAllAreasOfClass: boolean, origin: number, origExpr: Expression): FunctionNode {
        var valueType: ValueType = new ValueType();
        var exists: boolean = false;
        var nrTemplates: number = 0;
        var constExp: ConstNode = undefined;
        var isStaticConst: boolean = false;
        var singleAreaReference: number = data.conditionalSingleArea();
        var allExportNodes: FunctionNode[] = [];
        // var allExportNodesEmpty: boolean = true; // !!!

        if (singleAreaReference !== undefined) {
            var query: Expression = pathToQuery(path);
            var directQuery: FunctionNode = undefined;
            if (path[0] === "param") {
                Utilities.syntaxError("cannot project parameter queries");
            } else if (path[0] === "class") {
                directQuery = buildClassQuery(query, singleAreaReference, data.localToDefun, origExpr);
            } else {
                directQuery = resolveLocalQuery(query, singleAreaReference, 0, singleAreaReference, origExpr);
            }
            return directQuery === undefined?
                   buildConstNode([], false, undefined, 0, gEmptyOSExpr):
                   data.replaceConditionalResult(directQuery, origin);
        }
        if (data.valueType.isDataAndAreas()) {
            Utilities.error("cannot project " + path.join(".") + " on areas and data");
        }
        if (data.valueType.areas !== undefined) {
            for (var [areaTemplateId, type] of data.valueType.areas) {
                var template: AreaTemplate = areaTemplates[areaTemplateId];
                var exportNode: FunctionNode = template.exports[exportId];
                if (exportNode !== undefined) {
                    if (exportNode.valueType === undefined &&
                        objectEqual(path, ["param", "areaSetContent"])) {
                        // Time to determine its type by getting the expression that
                        // determines the set.
                        template.determineSetContent();
                    }
                    gErrContext.enter(template.areaNode.getNodeAtPath(path), undefined);
                    if (!(exportNode instanceof QueryCycle)) {
                        valueType = valueType.merge(exportNode.valueType, false);
                        valueType.sizes = ValueTypeSize.sumSizes(valueType.sizes,
                            ValueTypeSize.multiplySizes(exportNode.valueType.sizes,
                                                        type.sizes));
                    } else {
                        // This happens when an area projection depends on the same
                        // projection in the same template. In that case, it isn't
                        // writable, so it can only be data.
                        valueType = valueType.addAnyData();
                    }
                    gErrContext.leave();
                    exists = true;
                    if (exportNode instanceof ConstNode) {
                        constExp = exportNode;
                        if (template.getNrParentIndices() === 0 &&
                            template.alwaysExists()) {
                            isStaticConst = true;
                        }
                    }
                    // if (!exportNode.valueType.isExactSize(0)) { // !!!
                    //     allExportNodesEmpty = false;
                    // }
                    allExportNodes.push(exportNode);
                }
                nrTemplates++;
            }
        }
        if (!exists) {
            Utilities.warnOnce("no projection: " + path.join(".") + " for " +
                               data.toString() + " @ " + data.valueType.toString());
            return new ConstNode([], new ValueType(), gEmptyOSExpr, undefined, false); // data doesn't export this path
        // } else if (data.valueType.isExactSize(0) || allExportNodesEmpty) { // !!!
        //     // No data or all projections are empty
        //     return new ConstNode([], new ValueType(), gEmptyOSExpr, undefined, false);
        } else if (nrTemplates === 1 && isStaticConst && onAllAreasOfClass) {
            return constExp;
        }
        return new AreaProjectionNode(exportId, path, data.localToArea,
                                     data.localToDefun, data, onAllAreasOfClass,
                                     valueType, origExpr, allExportNodes);
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var data: FunctionNode = this.data.containsQualifiedExpression && this.data.hasSameVariantLocalityAs(this)?
            this.data.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin): this.data;

        return data === this.data? this:
            AreaProjectionNode.build(this.exportId, this.path, data,
                                 this.onAllAreasOfClass, origin, this.origExpr);
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var exportNode: FunctionNode = areaTemplates[areaTemplateId].exports[this.exportId];
            if (exportNode !== undefined) {
                exportNode.setDefunArgTypes(args, stack);
            }
        }
        delete stack[this.seqNr];
    }

    getSortKeys(): string[][] {
        return [];
    }

    getDataSourceInputs(): FunctionNode[] {
        var dsInputs: FunctionNode[] = [];

        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var exportNode: FunctionNode = areaTemplates[areaTemplateId].exports[this.exportId];
            if (exportNode !== undefined) {
                dsInputs.push(exportNode);
            }
        }
        return dsInputs;
    }

    getBoolInterpretation(): FunctionNode {
        return FunctionApplicationNode.buildFunctionApplication(
            bool, [this], this.localToArea, this.localToDefun,
            undefined, undefined);
    }

    // check if the exports of all possible area templates are writeable
    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[] = [];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var template: AreaTemplate = areaTemplates[areaTemplateId];
            if (this.exportId in template.exports) {
                // Note: resets qualifiers, since there is no relation between
                // the write origin and destination
                var wrns: WritableNodePath[] = template.exports[this.exportId].
                    extractWritableDestinations(path, visited);
                if (wrns !== undefined) {
                    wrNodes = cconcat(wrNodes, wrns.map(wr => {
                        return {
                            functionNode: wr.functionNode,
                            path: wr.path,
                            qualifiers: []
                        }
                    }));
                }
            }
        }
        delete visited[this.seqNr];
        return wrNodes;
    }
}

class ClassOfAreaNode extends AreaProjectionNode {

    constructor(localToArea: number, defun: number, data: FunctionNode,
                valueType: ValueType, origExpr: Expression,
                allExportNodes: FunctionNode[]) {
        super(0, undefined, localToArea, defun, data, false, valueType, origExpr, allExportNodes);
    }

    type(): FunctionNodeType {
        return FunctionNodeType.classOfArea;
    }

    specificEqual(fn: ClassOfAreaNode): boolean {
        return this.data.isEqual(fn.data);
    }

    toString(): string {
        return "classOfArea(" + this.data.idStr() + ")";
    }

    toFullString(): string {
        return "classOfArea(" + this.data.toFullString() + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLFunctionCall("classOfArea", [this.data], indent);
    }

    toExportString(origin: number): string {
        return "_coa(" + this.localityString() + ", " +
            this.data.idExpStr(origin) + ")";
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through classOfArea");
    }

    isUnmergeable(): boolean {
        return true;
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationClassOfArea = new EvaluationClassOfArea(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setData(getEvaluationNode(this.data, local));
        return evalNode;
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var data: FunctionNode = this.data.containsQualifiedExpression && this.data.hasSameVariantLocalityAs(this)?
            this.data.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin): this.data;

        return data === this.data? this:
            ClassOfAreaNode.buildClassOfAreaNode(data, this.origExpr);
    }
    
    static buildClassOfAreaNode(areaOS: FunctionNode, origExpr: Expression): FunctionNode {
        var localToArea: number = areaOS.localToArea;
        var localToDefun: number = areaOS.localToDefun;
        var constClassNames: string[] = [];
        var classNames: {[className: string]: boolean} = {};
        var nrClasses: number = 0;
        var allExportNodes: FunctionNode[] = [];

        if (areaOS === undefined || !areaOS.valueType.isAreas()) {
            Utilities.syntaxError("classOfArea takes an area os");
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        } else if (areaOS.valueType.areas !== undefined) {
            for (var areaTemplateId of areaOS.valueType.areas.keys()) {
                var template = areaTemplates[areaTemplateId];
                template.determineClassMembership();
                var classMembershipFun = <AVFunctionNode> template.exports[0];
                allExportNodes.push(classMembershipFun);
                for (var className in template.classes) {
                    if (className in classMembershipFun.attributes) {
                        // If className is not in the membership fun, it's because
                        // it's always false
                        if (!(className in classNames)) {
                            classNames[className] = true;
                            nrClasses++;
                        }
                        if (classMembershipFun.attributes[className].isAlwaysTrue()) {
                            if (constClassNames !== undefined) {
                                constClassNames.push(className);
                            }
                        } else {
                            constClassNames = undefined;
                        }
                    }
                }
            }
            if (!("unknown" in areaOS.valueType) && constClassNames !== undefined) {
                return buildConstNode(constClassNames, false, undefined, 0, origExpr);
            }
            var valueType: ValueType = new ValueType().addString().addSize(0, nrClasses);
            return new ClassOfAreaNode(localToArea, localToDefun, areaOS, valueType, origExpr, allExportNodes);
        } else {
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }
}

class AreaSelectionNode extends FunctionNode {

    exportId: number;
    select: QueryComponentSelect;
    data: FunctionNode;

    constructor(exportId: number, select: QueryComponentSelect,
                localToArea: number, defun: number, data: FunctionNode,
                valueType: ValueType, origExpr: Expression) {
        // The valueType type is the same as that of data. This could be restricted
        // a bit by checking if area templates have a non-matching value for the
        // select node (undefined probably being the most important one).
        super(localToArea, defun, valueType, origExpr);
        this.exportId = exportId;
        this.select = select;
        this.data = data;
        this.checkForQualifiedExpressions();
    }

    type(): FunctionNodeType {
        return FunctionNodeType.select;
    }

    specificEqual(fn: AreaSelectionNode): boolean {
        return this.exportId === fn.exportId &&
            this.select.isEqual(fn.select) &&
            this.data.isEqual(fn.data)
    }
    
    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);
        var minAreaExistenceScheduleStep: number = undefined;

        exportLevel++;
        stack[this.seqNr] = true;
        this.data = process(this.data, stack, false);
        if (this.data.localToArea === this.localToArea && this.data.id > mid) {
            mid = this.data.id;
        }
        scheduleStep = this.data.maxScheduleStep(this.prio, scheduleStep);
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            if (areaTemplate.doesExist) {
                var areaTemplateScheduleStep: number;
                ensureTemplateDependency(areaTemplate, stack, process);
                if (minAreaExistenceScheduleStep === undefined ||
                    minAreaExistenceScheduleStep > (areaTemplateScheduleStep = areaTemplate.getScheduleStep(stack, process))) {
                    minAreaExistenceScheduleStep = areaTemplateScheduleStep;
                }
                var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
                if (exportNode !== undefined) {
                    if (!(exportNode.seqNr in stack)) {
                        var csi: number;
                        if (FunctionNode.cacheDbg !== undefined) {
                            csi = FunctionNode.cacheDbg.length;
                            areaTemplate.cacheStage[csi] = "export " + exportPaths[this.exportId];
                            FunctionNode.cacheDbg.push(areaTemplate);
                        }
                        stack[exportNode.seqNr] = true;
                        areaTemplate.exports[this.exportId] = exportNode =
                            process(exportNode, stack, false);
                        if (FunctionNode.cacheDbg !== undefined) FunctionNode.cacheDbg.pop();
                        delete stack[exportNode.seqNr];
                    }
                    scheduleStep = exportNode.maxScheduleStep(this.prio, scheduleStep);
                }
            }
        }
        if (this.prio === 0 && minAreaExistenceScheduleStep > scheduleStep) {
            // There is no point in scheduling earlier than the existence of
            // the earliest area
            scheduleStep = minAreaExistenceScheduleStep;
        } else if (this.prio > 0) {
            // areas are scheduled at prio 0, so this function comes too early
            Utilities.warnOnce("area scheduling late for " + this.idStr());
        }
        this.select.selectionFunction = process(this.select.selectionFunction, stack, false);
        if (this.select.selectionFunction.localToArea === this.localToArea &&
              this.select.selectionFunction.id > mid) {
            mid = this.select.selectionFunction.id;
        }
        scheduleStep = this.select.selectionFunction.maxScheduleStep(this.prio, scheduleStep);
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        delete stack[this.seqNr];
        exportLevel--;
        return mid;
    }
    
    toString(): string {
        return "select(#" + this.exportId +
            ", " + this.select.toString() + ", " + this.data.idStr() + ")";
    }

    toFullString(): string {
        return "select(#" + this.exportId +
            ", " + this.select.toFullString() + ", " + this.data.toFullString() + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatArray([pathToQueryString(exportPaths[this.exportId], this.select.toCDLString(undefined)), this.data], true, indent);
    }

    toExportString(origin: number): string {
        return "_s(" + this.localityString() + ", " + this.exportId +
            ", " + this.select.toExportString(origin) + ", " + this.data.idExpStr(origin) + ")";
    }


    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            this.data.markWritablePath();
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        this.writable = this.data.writable;
    }

    isUnmergeable(): boolean {
        return true;
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        this.data.setPriority(prio);
        this.select.selectionFunction.setPriority(prio);
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode !== undefined) {
                exportNode.setPriority(prio);
            }
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationAreaSelection = new EvaluationAreaSelection(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setSelectionAndData(
            getEvaluationNode(this.select.selectionFunction, local),
            getEvaluationNode(this.data, local));
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        var allInputs: FunctionNode[] = [this.data, this.select.selectionFunction];

        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode !== undefined) {
                allInputs.push(exportNode);
            }
        }
        return allInputs;
    }

    allLocalInputs(): FunctionNode[] {
        return [this.data, this.select.selectionFunction];
    }

    functionIsConstant(): boolean {
        var c: boolean = true; // find "lowest" constancy of exported nodes

        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var exportNode: FunctionNode = areaTemplate.exports[this.exportId];
            if (exportNode !== undefined) {
                switch (exportNode.getConstancy()) {
                  case undefined:
                    if (c === true) {
                        c = undefined;
                    }
                    break;
                  case false:
                    c = false;
                    break;
                }
                if (c === false) {
                    break;
                }
            }
        }
        switch (this.data.getConstancy()) {
          case undefined:
            if (c === true) {
                c = undefined;
            }
            break;
          case false:
            c = false;
            break;
        }
        switch (this.select.selectionFunction.getConstancy()) {
          case undefined:
            if (c === true) {
                c = undefined;
            }
            break;
          case false:
            c = false;
            break;
        }
        return c;
    }

    static build(selection: QueryComponentSelect, data: FunctionNode, origExpr: Expression): FunctionNode {
        var exportId: number;
        var valueType: ValueType = new ValueType();
        var localToArea: number;
        var localToDefun: number;

        // Check if there is a potential match, assuming the selection is not
        // negative. If there is no match, we can ignore the area from the
        // result type.
        function potentiallyMatches(exp: FunctionNode, sel: FunctionNode): boolean {
            return exp.valueType.canMatch(sel.valueType, true);
        }

        // This function has (as can be seen) not been implemented, since very
        // little benefit is expected.
        function surelyMatches(exp: FunctionNode, sel: FunctionNode): boolean {
            return false;
        }

        exportId = getExportId(selection.path, data.valueType.areas);
        localToArea = mergeLocality(selection.selectionFunction.localToArea, data.localToArea);
        localToDefun = mergeDefunLocality(selection.selectionFunction.localToDefun, data.localToDefun);
        if (data.valueType.isDataAndAreas()) {
            Utilities.error("cannot select " + selection.toString() + " on areas and data");
        }
        if (data.valueType.areas !== undefined) {
            for (var [areaTemplateId, type] of data.valueType.areas) {
                var template: AreaTemplate = areaTemplates[areaTemplateId];
                var exportNode: FunctionNode = template.exports[exportId];
                if ((selection.positive && exportNode !== undefined &&
                    potentiallyMatches(exportNode, selection.selectionFunction)) ||
                    (!selection.positive &&
                     (exportNode === undefined ||
                      !surelyMatches(exportNode, selection.selectionFunction)))) {
                    valueType.addArea(areaTemplateId, type.sizes);
                }
            }
        }
        if (valueType.unknown) { // no such area
            valueType.checkConsistency();
            return buildConstNode([], false, undefined, 0, gEmptyOSExpr);
        }
        return new AreaSelectionNode(exportId, selection, localToArea,
                                     localToDefun, data, valueType, origExpr);
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var selectionFunction = 
            this.select.selectionFunction.containsQualifiedExpression &&
            this.select.selectionFunction.hasSameVariantLocalityAs(this)?
            this.select.selectionFunction.pickQualifiedExpression(
                knownTrueQualifiers, knownFalseQualifiers, origin):
            this.select.selectionFunction;
        var data: FunctionNode = this.data.containsQualifiedExpression && this.data.hasSameVariantLocalityAs(this)?
            this.data.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin): this.data;

        return selectionFunction === this.select.selectionFunction &&
               data === this.data?
               this:
               AreaSelectionNode.build(
                   new QueryComponentSelect(
                       this.select.path, this.select.selectionExpression,
                       this.select.positive, selectionFunction),
                   data, this.origExpr);
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }
}

class ChildAreasNode extends FunctionNode {

    childName: string;
    data: FunctionNode;

    constructor(childName: string, data: FunctionNode,
                valueType: ValueType, origExpr: Expression) {
        super(data.localToArea, 0, valueType, origExpr);
        this.childName = childName;
        this.data = data;
        this.checkForQualifiedExpressions();
    }

    type(): FunctionNodeType {
        return FunctionNodeType.childAreas;
    }

    specificEqual(fn: ChildAreasNode): boolean {
        return this.childName === fn.childName &&
            this.data.isEqual(fn.data)
    }

    isUnmergeable(): boolean {
        return true;
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = -1;

        this.data = process(this.data, stack, false);
        if (this.data.localToArea === this.localToArea && this.data.id > mid) {
            mid = this.data.id;
        }
        scheduleStep = this.data.maxScheduleStep(this.prio, scheduleStep);
        if (this.prio === 0) {
            for (var areaTemplateId of this.data.valueType.areas.keys()) {
                var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
                var childTemplate: AreaTemplate = areaTemplate.children[this.childName];
                if (childTemplate !== undefined) {
                    ensureTemplateDependency(childTemplate, stack, process);
                    if (childTemplate.getScheduleStep(stack, process) > scheduleStep) {
                        scheduleStep = childTemplate.getScheduleStep(stack, process);
                    }
                }
            }
        } else {
            Utilities.warnOnce("area scheduling late for " + this.idStr());
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        return "child(" + this.childName + ", " + this.data.idStr() + ")";
    }

    toFullString(): string {
        return "child(" + this.childName + ", " + this.data.toFullString() + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatArray(["{children: {" + this.childName + ": _}}", this.data], true, indent);
    }

    toExportString(origin: number): string { // _d for descendant
        return "_d(" + this.localityString() + ", " +
            JSON.stringify(this.childName) + ", " + this.data.idExpStr(origin) + ")";
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through child queries");
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        this.data.setPriority(prio);
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationChildAreas = new EvaluationChildAreas(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setData(getEvaluationNode(this.data, local));
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return [this.data];
    }

    functionIsConstant(): boolean {
        for (var areaTemplateId of this.data.valueType.areas.keys()) {
            var areaTemplate: AreaTemplate = areaTemplates[areaTemplateId];
            var childTemplate: AreaTemplate = areaTemplate.children[this.childName];
            if (childTemplate !== undefined && childTemplate.getNrParentIndices() !== 0) {
                return false;
            }
        }
        return true;
    }


    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var data: FunctionNode = this.data.containsQualifiedExpression &&
                                 this.data.hasSameVariantLocalityAs(this)?
            this.data.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
            this.data;

        return data === this.data? this:
            new ChildAreasNode(this.childName, data, this.valueType, this.origExpr);
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    checkWritability(): void {
        Utilities.error("do not call");
    }
}

class OrderedSetNode extends FunctionNode {

    values: FunctionNode[];
    alwaysOS: boolean = false;

    constructor(values: FunctionNode[], locality: number, defun: number,
                valueType: ValueType, origExpr: Expression, alwaysOS: boolean) {
        super(locality, defun, valueType, origExpr);
        this.values = values;
        this.alwaysOS = alwaysOS;
        this.checkForQualifiedExpressions();
    }

    type(): FunctionNodeType {
        return FunctionNodeType.orderedSet;
    }

    specificEqual(fn: OrderedSetNode): boolean {
        return arrayEqual(this.values, fn.values);
    }

    isUnmergeable(): boolean {
        for (var i = 0; i !== this.values.length; i++) {
            if (this.values[i].isUnmergeable()) {
                return true;
            }
        }
        return false;
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        for (var i = 0; i !== this.values.length; i++) {
            this.values[i] = process(this.values[i], stack, false);
            if (this.values[i].localToArea === this.localToArea &&
                  this.values[i].id > mid) {
                mid = this.values[i].id;
            }
            scheduleStep = this.values[i].maxScheduleStep(this.prio, scheduleStep);
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        return "o(" + this.values.map(function(e){return e.idStr();}).join(", ") + ")";
    }

    toFullString(): string {
        return "o(" + this.values.map(function(e){return e.toFullString();}).join(", ") + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLConstructor("o", this.values, indent);
    }

    toExportString(origin: number): string {
        return "_o(" + this.localityString() + ", [" +
            this.values.map(function(e){return e.idExpStr(origin);}).join(", ") + "])";
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            for (var i: number = 0; i !== this.values.length; i++) {
                this.values[i].markWritablePath();
            }
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        for (var i: number = 0; i !== this.values.length; i++) {
            if (this.values[i].writable) {
                this.writable = true;
                return;
            }
        }
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        for (var i = 0; i !== this.values.length; i++) {
            this.values[i].setPriority(prio);
        }
    }
    
    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationOrderedSet(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.values.length; i++) {
            evalNode.addElement(i, getEvaluationNode(this.values[i], local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return this.values;
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var values: FunctionNode[] = new Array(this.values.length);
        var change: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            values[i] = this.values[i].containsQualifiedExpression &&
                        this.values[i].hasSameVariantLocalityAs(this)?
                this.values[i].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.values[i];
            if (values[i] !== this.values[i]) {
                change = true;
            }
        }
        return !change? this: OrderedSetNode.buildOrderedSet(values, origin, this.origExpr, this.alwaysOS);
    }

    static buildOrderedSet(os: FunctionNode[], origin: number, origExpr: Expression, alwaysOS: boolean): FunctionNode {
        var localToArea: number = undefined;
        var localToDefun: number = 0;
        var valueType: ValueType = new ValueType();
        var sizes: RangeValue[] = undefined;
        var isConstant: boolean = true;
        var wontChangeValue: boolean = true;

        if (os.length === 0) {
            return buildConstNode([], true, undefined, 0, origExpr);
        } else if (os.length === 1 && !alwaysOS) {
            return os[0];
        } else {
            for (var i: number = 0; i < os.length; i++) {
                valueType = valueType.merge(os[i].valueType /*, false */);
                if (os[i] instanceof ConstNode) {
                    wontChangeValue = wontChangeValue &&
                                      (<ConstNode>os[i]).wontChangeValue;
                } else {
                    isConstant = false;
                }
                sizes = i === 0? os[i].valueType.sizes:
                        ValueTypeSize.sumSizes(sizes, os[i].valueType.sizes);
                localToArea = mergeLocality(localToArea, os[i].localToArea);
                localToDefun = mergeDefunLocality(localToDefun, os[i].localToDefun);
            }
            valueType.sizes = sizes;
            if (isConstant) {
                var array: any[] = [];
                for (var i: number = 0; i !== os.length; i++) {
                    var c = <ConstNode> os[i];
                    array = array.concat(c.value);
                }
                return new ConstNode(array, getValueTypeFromConstant(array),
                                     origExpr, undefined, wontChangeValue);
            } else {
                return new OrderedSetNode(os, localToArea, localToDefun, valueType, origExpr, alwaysOS);
            }
        }
    }

    getSortKeys(): string[][] {
        var paths: string[][]= [];

        for (var i: number = 0; i < this.values.length; i++) {
            paths = paths.concat(this.values[i].getSortKeys());
        }
        return paths;
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        for (var i: number = 0; i < this.values.length; i++) {
            this.values[i].setDefunArgTypes(args, stack);
        }
        delete stack[this.seqNr];
    }

    getDataSourceInputs(): FunctionNode[] {
        return this.values;
    }

    isAlwaysTrue(): boolean {
        for (var i: number = 0; i < this.values.length; i++) {
            if (this.values[i].isAlwaysTrue()) {
                return true;
            }
        }
        return false;
    }

    isAlwaysFalse(): boolean {
        for (var i: number = 0; i < this.values.length; i++) {
            if (!this.values[i].isAlwaysFalse()) {
                return false;
            }
        }
        return true;
    }

    getBoolInterpretation(): FunctionNode {
        return FunctionApplicationNode.buildFunctionApplication(
            bool, [this], this.localToArea, this.localToDefun,
            undefined, undefined);
    }

    isOrderedSetNode(): boolean {
        return true;
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        wrNodes = this.values.map(function(elem: FunctionNode): WritableNodePath[] {
            return elem.extractWritableDestinations(path, visited);
        }).reduce(function(allWrNodes: WritableNodePath[], wrNodes: WritableNodePath[]) {
            return wrNodes.length > 0? allWrNodes.concat(wrNodes): allWrNodes;
        }, []);
        delete visited[this.seqNr];
        return wrNodes;
    }
}

// Slightly different than OrderedSetNode: the order of the arguments doesn't
// matter
class RangeNode extends OrderedSetNode {
    closedLower: boolean;
    closedUpper: boolean;

    constructor(values: FunctionNode[], closedLower: boolean,
                closedUpper: boolean, locality: number, defun: number,
                valueType: ValueType, origExpr: Expression) {
        super(values, locality, defun, valueType, origExpr, undefined);
        this.closedLower = closedLower;
        this.closedUpper = closedUpper;
    }

    type(): FunctionNodeType {
        return FunctionNodeType.range;
    }

    specificEqual(fn: RangeNode): boolean {
        var vals = this.values;
        if (this.closedLower !== fn.closedLower ||
              this.closedUpper !== fn.closedUpper) {
            return false;
        }
        for (var i: number = 0; i !== vals.length; i++) {
            if (!fn.values.some(function(v) { return v.isEqual(vals[i]); })) {
                return false;
            }
        }
        for (var i: number = 0; i !== fn.values.length; i++) {
            if (!vals.some(function(v) { return v.isEqual(fn.values[i]); })) {
                return false;
            }
        }
        return true;
    }

    isUnmergeable(): boolean {
        return true;
    }

    toString(): string {
        return "R" + (this.closedLower? "c": "o") + (this.closedUpper? "c": "o") + 
            "(" + this.values.map(function(e){return e.idStr();}).join(", ") + ")";
    }

    toFullString(): string {
        return "R" + (this.closedLower? "c": "o") + (this.closedUpper? "c": "o") +
            "(" + this.values.map(function(e){return e.toFullString();}).join(", ") + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLConstructor("R" + (this.closedLower? "c": "o") + (this.closedUpper? "c": "o"), this.values, indent);
    }

    toExportString(origin: number): string {
        return "_r" + (this.closedLower? "c": "o") + (this.closedUpper? "c": "o") +
            "(" + this.localityString() + ", [" +
            this.values.map(function(e){return e.idExpStr(origin);}).join(", ") + "])";
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through ranges");
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationRange(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.values.length; i++) {
            evalNode.addElement(i,
                  getEvaluationNode(this.values[i], local));
        }
        return evalNode;
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var values: FunctionNode[] = new Array(this.values.length);
        var change: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            values[i] = this.values[i].containsQualifiedExpression &&
                        this.values[i].hasSameVariantLocalityAs(this)?
                this.values[i].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.values[i];
            if (values[i] !== this.values[i]) {
                change = true;
            }
        }
        return !change? this: RangeNode.buildRange(values, this.closedLower,
                                       this.closedUpper, origin, this.origExpr);
    }

    static buildRange(os: FunctionNode[], closedLower: boolean, closedUpper: boolean, origin: number, origExpr: Expression): OrderedSetNode {
        var localToArea: number = undefined;
        var localToDefun: number = 0;

        for (var i: number = 0; i < os.length; i++) {
            localToArea = mergeLocality(localToArea, os[i].localToArea);
            localToDefun = mergeDefunLocality(localToDefun, os[i].localToDefun);
        }
        return new RangeNode(os, closedLower, closedUpper, localToArea,
                 localToDefun, new ValueType().addRange().addSize(1), origExpr);
    }


    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    isOrderedSetNode(): boolean {
        return false;
    }
}

class NegationNode extends FunctionNode {
    queries: FunctionNode[];

    constructor(queries: FunctionNode[], locality: number, defun: number,
                valueType: ValueType, origExpr: Expression) {
        super(locality, defun, valueType, origExpr);
        this.queries = queries;
        this.checkForQualifiedExpressions();
    }

    type(): FunctionNodeType {
        return FunctionNodeType.negation;
    }

    specificEqual(fn: NegationNode): boolean {
        return arrayEqual(this.queries, fn.queries);
    }

    isUnmergeable(): boolean {
        return true;
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        for (var i: number = 0; i < this.queries.length; i++) {
            this.queries[i] = process(this.queries[i], stack, false);
            if (this.queries[i].localToArea === this.localToArea && this.queries[i].id > mid) {
                mid = this.queries[i].id;
            }
            scheduleStep = this.queries[i].maxScheduleStep(this.prio, scheduleStep);
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        return "n(" + this.queries.map(function(e){return e.idStr();}).join(", ") + ")";
    }

    toFullString(): string {
        return "n(" + this.queries.map(function(e){return e.toFullString();}).join(", ") + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLConstructor("n", this.queries, indent);
    }

    toExportString(origin: number): string {
        return "_neg(" + this.localityString() + ", [" +
            this.queries.map(function(e){return e.idExpStr(origin);}).join(", ") + "])";
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through n()");
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        for (var i: number = 0; i < this.queries.length; i++) {
            this.queries[i].setPriority(prio);
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationNegation(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.queries.length; i++) {
            evalNode.addElement(i,
                          getEvaluationNode(this.queries[i], local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return this.queries;
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var queries: FunctionNode[] = new Array(this.queries.length);
        var change: boolean = false;

        for (var i: number = 0; i < this.queries.length; i++) {
            queries[i] = this.queries[i].containsQualifiedExpression &&
                         this.queries[i].hasSameVariantLocalityAs(this)?
                this.queries[i].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.queries[i];
            if (queries[i] !== this.queries[i]) {
                change = true;
            }
        }
        return !change? this: NegationNode.build(queries, origin, this.origExpr);
    }

    static build(queries: FunctionNode[], origin: number, origExpr: Expression): NegationNode {
        var localToArea: number = undefined;
        var localToDefun: number = 0;

        for (var i: number = 0; i < queries.length; i++) {
            localToArea = mergeLocality(localToArea, queries[i].localToArea);
            localToDefun = mergeDefunLocality(localToDefun, queries[i].localToDefun);
        }
        return new NegationNode(queries, localToArea, localToDefun,
                               new ValueType().addQuery().addSize(1), origExpr);
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    checkWritability(): void {
        Utilities.error("do not call");
    }
}

// Slightly different than OrderedSetNode and RangeNode: the order of the
// arguments doesn't matter, and there are no extra arguments
class SubStringQueryNode extends OrderedSetNode {
    type(): FunctionNodeType {
        return FunctionNodeType.subStringQuery;
    }

    specificEqual(fn: SubStringQueryNode): boolean {
        var vals = this.values;

        for (var i: number = 0; i !== vals.length; i++) {
            if (!fn.values.some(function(v) { return v.isEqual(vals[i]); })) {
                return false;
            }
        }
        for (var i: number = 0; i !== fn.values.length; i++) {
            if (!vals.some(function(v) { return v.isEqual(fn.values[i]); })) {
                return false;
            }
        }
        return true;
    }

    isUnmergeable(): boolean {
        return true;
    }

    toString(): string {
        return "s(" + this.values.map(function(e){return e.idStr();}).join(", ") + ")";
    }

    toFullString(): string {
        return "s(" + this.values.map(function(e){return e.toFullString();}).join(", ") + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLConstructor("s", this.values, indent);
    }

    toExportString(origin: number): string {
        return "_substr(" + this.localityString() + ", [" +
            this.values.map(function(e){return e.idExpStr(origin);}).join(", ") + "])";
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through substring query");
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationSubStringQuery(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.values.length; i++) {
            evalNode.addElement(i, getEvaluationNode(this.values[i], local));
        }
        return evalNode;
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var values: FunctionNode[] = new Array(this.values.length);
        var change: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            values[i] = this.values[i].containsQualifiedExpression &&
                        this.values[i].hasSameVariantLocalityAs(this)?
                this.values[i].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.values[i];
            if (values[i] !== this.values[i]) {
                change = true;
            }
        }
        return !change? this: SubStringQueryNode.buildSubStringQuery(values, origin, this.origExpr);
    }

    static buildSubStringQuery(os: FunctionNode[], origin: number, origExpr: Expression): SubStringQueryNode {
        var localToArea: number = undefined;
        var localToDefun: number = 0;

        for (var i: number = 0; i < os.length; i++) {
            localToArea = mergeLocality(localToArea, os[i].localToArea);
            localToDefun = mergeDefunLocality(localToDefun, os[i].localToDefun);
        }
        return new SubStringQueryNode(os, localToArea, localToDefun,
                    new ValueType().addQuery().addSize(1), origExpr, undefined);
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    isOrderedSetNode(): boolean {
        return false;
    }
}

// Yet another slightly different node: the order does matter.
class ComparisonFunctionNode extends OrderedSetNode {
    type(): FunctionNodeType {
        return FunctionNodeType.comparisonFunction;
    }

    specificEqual(fn: ComparisonFunctionNode): boolean {
        return arrayEqual(this.values, fn.values);
    }

    isUnmergeable(): boolean {
        return true;
    }

    toString(): string {
        return "c(" + this.values.map(function(e){return e.idStr();}).join(", ") + ")";
    }

    toFullString(): string {
        return "c(" + this.values.map(function(e){return e.toFullString();}).join(", ") + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatCDLConstructor("c", this.values, indent);
    }

    toExportString(origin: number): string {
        return "_cf(" + this.localityString() + ", [" +
            this.values.map(function(e){return e.idExpStr(origin);}).join(", ") + "])";
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through comparison function");
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode = new EvaluationComparisonFunction(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        for (var i: number = 0; i !== this.values.length; i++) {
            evalNode.addElement(i, getEvaluationNode(this.values[i], local));
        }
        return evalNode;
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var values: FunctionNode[] = new Array(this.values.length);
        var change: boolean = false;

        for (var i: number = 0; i < this.values.length; i++) {
            values[i] = this.values[i].containsQualifiedExpression &&
                        this.values[i].hasSameVariantLocalityAs(this)?
                this.values[i].pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.values[i];
            if (values[i] !== this.values[i]) {
                change = true;
            }
        }
        return !change? this: ComparisonFunctionNode.buildComparisonFunction(
                                                 values, origin, this.origExpr);
    }

    static buildComparisonFunction(os: FunctionNode[], origin: number, origExpr: Expression): SubStringQueryNode {
        var localToArea: number = undefined;
        var localToDefun: number = 0;

        for (var i: number = 0; i < os.length; i++) {
            localToArea = mergeLocality(localToArea, os[i].localToArea);
            localToDefun = mergeDefunLocality(localToDefun, os[i].localToDefun);
        }
        return new ComparisonFunctionNode(os, localToArea, localToDefun,
                    new ValueType().addQuery().addSize(1), origExpr, undefined);
    }

    isOrderedSetNode(): boolean {
        return false;
    }
}

function getValueTypeFromConstant(v: any): ValueType {
    var t: string = typeof(v);
    var valueType: ValueType = new ValueType();

    if (t !== "object") {
        switch (t) {
          case "undefined":
            valueType.addUndefined().addSize(0);
            break;
          case "string":
            valueType.addString().addSize(1);
            break;
          case "number":
            valueType.addNumber().addSize(1);
            break;
          case "boolean":
            valueType.addBoolean().addSize(1);
            break;
          default:
            assert(false, "unknown type");
        }
    } else if (v instanceof NonAV) {
        switch (v.typeName()) {
          case "range":
            valueType.addRange().addSize(1);
            break;
          case "orderedSet":
            for (var i: number = 0; i < (<MoonOrderedSet>v).os.length; i++) {
                valueType = valueType.merge(getValueTypeFromConstant((<MoonOrderedSet>v).os[i]));
            }
            valueType.addSize((<MoonOrderedSet>v).os.length);
            break;
          case "projector":
            valueType.addProjector().addSize(1);
            break;
          case "terminalSymbol":
            valueType.addTerminalSymbol().addSize(1);
            break;
          case "comparisonFunction":
            valueType.addComparisonFunction((<MoonComparisonFunction>v).os.map(getValueTypeFromConstant)).addSize(1);
            break;
          case "elementReference":
            if ((<ElementReference>v).element === "p1") {
                valueType.addArea(0, [_r(1, 1)]);
            } else {
                Utilities.error("cannot add areas as constant");
            }
            break;
          default:
            assert(false, "unknown type");
        }
    } else if (v instanceof Array) {
        for (var i: number = 0; i < v.length; i++) {
            var elem: ValueType = getValueTypeFromConstant(v[i]);
            valueType = valueType.merge(elem);
        }
        valueType.sizes = [_r(v.length, v.length)];
    } else {
        valueType.addObject({}).addSize(1);
        for (var attr in v) {
            valueType.addAttribute(attr, getValueTypeFromConstant(v[attr]));
        }
    }
    return valueType;
}

class ConstNode extends FunctionNode {

    value: any; // a simple javascript value in the agreed format
    compiledQuery: CompiledFunctionNode; // this const as a compiled query
    wontChangeValue: boolean; // false when intermediate compilation result

    constructor(val: any, valueType: ValueType, origExpr: Expression, suppressSet: boolean, wontChangeValue: boolean) {
        var normVal: any;

        if (suppressSet !== undefined) {
            if (val instanceof Array && val.length === 0) {
                if (suppressSet === true) {
                    normVal = false;
                } else {
                    normVal = [];
                }
            } else {
                normVal = val instanceof Array && val.length === 1? val[0]: val;
            }
            if (doCompileTimeChecks) {
                valueType.addSize(normVal instanceof Array? normVal.length: 1);
            }
        } else {
            normVal = val === undefined? undefined:
                      !(val instanceof Array)? [val]:
                      val;
            if (doCompileTimeChecks) {
                valueType.addSize(normVal !== undefined? normVal.length: 0);
            }
        }
        super(undefined, 0, valueType, origExpr);
        this.value = normVal;
        this.scheduleStep = -1;
        this.suppressSet = suppressSet;
        if (doCompileTimeChecks) {
            this.wontChangeValue = wontChangeValue;
            this.containsQualifiedExpression = false;
        }
        this.prio = Priority.maxPriority;
    }

    type(): FunctionNodeType {
        return FunctionNodeType.const;
    }

    isEmptyOS(): boolean {
        return this.value === undefined ||
            (this.value instanceof Array && this.value.length === 0);
    }

    isAlwaysTrue(): boolean {
        return isTrue(this.value);
    }

    isAlwaysFalse(): boolean {
        return isFalse(this.value);
    }

    isAlwaysUndefined(): boolean {
        return this.value === undefined;
    }

    // Simple values, but exclude undefined.
    isUnmergeable(): boolean {
        return isSimpleValue(this.value) && isUnmergeable(this.value);
    }

    isNull(): boolean {
        return this.value === null ||
               (this.value instanceof Array && this.value.length === 1 &&
                this.value[1] === null);
    }

    specificEqual(fn: ConstNode): boolean {
        if (this.suppressSet !== fn.suppressSet) {
            return false;
        }
        if (this.compiledQuery !== undefined || fn.compiledQuery !== undefined) {
            if (this.compiledQuery === undefined || fn.compiledQuery === undefined) {
                return false;
            }
            if (!this.compiledQuery.isEqual(fn.compiledQuery)) {
                return false;
            }
        }
        if (typeof(this.value) !== typeof(fn.value)) {
            return false;
        } else if (typeof(this.value) === "object") {
            return objectEqual(this.value, fn.value);
        } else {
            return this.value === fn.value;
        }
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;

        if (this.compiledQuery !== undefined) {
            var cached = <CompiledFunctionNode> process(this.compiledQuery, stack, false);
            this.compiledQuery = cached;
            if (this.compiledQuery.localToArea === this.localToArea &&
                  this.compiledQuery.id > mid) {
                mid = this.compiledQuery.id;
            }
        }
        return mid;
    }
    
    setSchedulingError(): void {
    }

    toString(): string {
        var str: string;

        if (this.suppressSet !== undefined) {
            var singleton = getDeOSedValue(this.value);
            str = vstringify(singleton);
        } else {
            var arrayVal = this.value instanceof Array? this.value: [this.value];
            str = "o(" + arrayVal.map(vstringify).join(",") + ")";
        }
        // if (str !== undefined && str.length > 256) {
        //     str = str.substr(0, 126) + "..." + str.substr(-126);
        // }
        return str;
    }

    toFullString(): string {
        var str: string;

        if (this.suppressSet !== undefined) {
            var singleton = getDeOSedValue(this.value);
            str = vstringify(singleton);
        } else {
            var arrayVal = this.value instanceof Array? this.value: [this.value];
            str = "o(" + arrayVal.map(vstringify).join(",") + ")";
        }
        return str;
    }

    toCDLString(indent: string = undefined): string {
        var v: any = getDeOSedValue(this.value);

        if (v instanceof Array) {
            return "o(" + v.map(vstringify).join(",") + ")";
        } else {
            return vstringify(v);
        }
    }

    toExportString(origin: number): string {
        var constStr: string;
        var suppress: string;

        if (this.suppressSet !== undefined) {
            var singleton = this.value instanceof Array && this.value.length === 1? this.value[0]: this.value;
            suppress = String(this.suppressSet);
            constStr = cstringify(singleton);
        } else if ((this.value instanceof Array && this.value.length === 0) ||
                   this.value === undefined) {
            constStr = "constEmptyOS";
            suppress = "undefined";
        } else {
            var arrayVal = this.value instanceof Array? this.value: [this.value];
            constStr = "[" + arrayVal.map(cstringify).join(",") + "]";
            suppress = "undefined";
        }
        return this.compiledQuery === undefined?
            "_v(" + constStr + ", " + suppress + ")":
            "_vcq(" + constStr + ", " + this.compiledQuery.idExpStr(origin) + ", " + suppress + ")";
    }

    setCompiledQuery(cq: CompiledFunctionNode): void {
        this.compiledQuery = cq;
    }

    isSingleString(): boolean {
        return typeof(this.value) === "string" ||
            (this.value instanceof Array && this.value.length === 1 &&
             typeof(this.value[0]) === "string");
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write to const");
    }

    setPriority(prio: number): void {
        // nothing to do here
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationConst = new EvaluationConst(this);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return [];
    }

    canMergeUnderQualifier(fn: FunctionNode): boolean {
        if (!(fn instanceof ConstNode)) {
            return false;
        }
        var cn = <ConstNode> fn;
        return this.compiledQuery === undefined &&
               cn.compiledQuery === undefined &&
               this.suppressSet === fn.suppressSet;
    }

    // Performs a merge between this and fn, such that the outcome of 
    // this will be identical to [merge, this, fn] at runtime.
    mergeUnderQualifier(fn: FunctionNode): ConstNode {
        var cn = <ConstNode> fn;
        var mergedValue: any = mergeConst(this.value, cn.value);
        var mergedType: ValueType = this.valueType.merge(fn.valueType);

        return new ConstNode(mergedValue, mergedType,
                  expressionStore.get(runtimeValueToCdlExpression(mergedValue), undefined),
                  this.suppressSet, this.wontChangeValue && cn.wontChangeValue);
    }

    getSortKeys(): string[][] {
        function getSortKeys(v: any, path: string[]): string[][] {
            var paths: string[][];

            if (v instanceof Array) {
                paths = [];
                for (var i: number = 0; i < v.length; i++) {
                    paths = paths.concat(getSortKeys(v[i], path));
                }
                return paths;
            } else if (isSimpleValue(v) || v instanceof NonAV) {
                paths = [path];
            } else {
                paths = [];
                for (var attr in v) {
                    paths = paths.concat(getSortKeys(v[attr], path.concat(attr)));
                }
            }
            return paths;
        }

        return getSortKeys(this.value, []);
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    getBoolInterpretation(): FunctionNode {
        return new ConstNode(isTrue(this.value),
                             new ValueType().addBoolean().addSize(1),
                             undefined, this.suppressSet, this.wontChangeValue);
    }

    isStrictSelection(): boolean {
        function strsel(q: any): boolean {
            if (q instanceof Array) {
                return q.every(strsel);
            } else if (q instanceof NonAV) {
                return !(q instanceof OrderedSetNode);
            } else if (isSimpleValue(q)) {
                return q !== undefined;
            } else if (typeof(q) === "object") {
                for (var attr in q) {
                    if (!strsel(q[attr])) {
                        return false;
                    }
                }
                return true;
            } else {
                return false;
            }
        }
        return strsel(this.value);
    }

    checkWritability(): void {
        Utilities.error("do not call");
    }

    mightChange(): ConstNode {
        return !this.wontChangeValue? this:
               new ConstNode(this.value, this.valueType, this.origExpr, this.suppressSet, false);
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
    }
}

class CondNode extends FunctionNode {

    condVar: FunctionNode;
    altList: {on: FunctionNode; use: FunctionNode}[];

    constructor(condVar: FunctionNode, altList: {on: FunctionNode; use: FunctionNode}[],
                locality: number, defun: number, valueType: ValueType, origExpr: Expression) {
        super(locality, defun, valueType, origExpr);
        this.condVar = condVar;
        this.altList = altList;
        if (doCompileTimeChecks) {
            this.hasWritableReference =
                altList.some(alt => alt.use !== undefined && alt.use.hasWritableReference);
            this.checkForQualifiedExpressions();
        }
    }

    type(): FunctionNodeType {
        return FunctionNodeType.cond;
    }

    specificEqual(fn: CondNode): boolean {
        if (this.altList.length !== fn.altList.length ||
              !this.condVar.isEqual(fn.condVar)) {
            return false;
        }
        for (var i: number = 0; i !== this.altList.length; i++) {
            if (!this.altList[i].on.isEqual(fn.altList[i].on) ||
                 !this.altList[i].use.isEqual(fn.altList[i].use)) {
                return false;
            }
        }
        return true;
    }

    isAlwaysTrue(): boolean {
        var hasCatchAll: boolean = false;

        for (var i: number = 0; i !== this.altList.length; i++) {
            if (this.altList[i].on.isNull()) {
                hasCatchAll = true;
            }
            if (!this.altList[i].use.isAlwaysTrue()) {
                return false;
            }
        }
        return hasCatchAll;
    }

    isUnmergeable(): boolean {
        for (var i: number = 0; i !== this.altList.length; i++) {
            if (!this.altList[i].use.isUnmergeable()) {
                return false;
            }
        }
        return true;
    }

    conditionalSingleArea(): number {
        var lEmb: number;
        var localToArea: number;

        if (this.altList.length === 0) {
            return undefined;
        }
        for (var i = 0; i !== this.altList.length; i++) {
            var l_i: RangeValue = levelOfEmbeddingFun(this.altList[i].use, this.altList[i].use.localToArea);
            if (l_i === undefined || l_i.min !== l_i.max) {
                return undefined;
            }
            if (i === 0) {
                lEmb = l_i.min;
                localToArea = this.altList[i].use.localToArea;
            } else if (l_i.min !== lEmb || l_i.max !== lEmb ||
                       localToArea !== this.altList[i].use.localToArea) {
                return undefined;
            }
        }
        return areaTemplates[localToArea].getEmbedding(lEmb).id;
    }

    replaceConditionalResult(fn: FunctionNode, origin: number): FunctionNode {
        return CondNode.build(this.condVar,
                              this.altList.map(function(alt) {
                                  return {on: alt.on, use: fn};
                              }),
                              origin, this.origExpr);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        this.condVar = process(this.condVar, stack, false);
        if (this.condVar.localToArea === this.localToArea && this.condVar.id > mid) {
            mid = this.condVar.id;
        }
        scheduleStep = this.condVar.maxScheduleStep(this.prio, scheduleStep);
        for (var i = 0; i !== this.altList.length; i++) {
            this.altList[i].on = process(this.altList[i].on, stack, false);
            if (this.altList[i].on.localToArea === this.localToArea &&
                  this.altList[i].on.id > mid) {
                mid = this.altList[i].on.id;
            }
            scheduleStep = this.altList[i].on.maxScheduleStep(this.prio, scheduleStep);
            this.altList[i].use = process(this.altList[i].use, stack, false);
            if (this.altList[i].use.localToArea === this.localToArea &&
                  this.altList[i].use.id > mid) {
                mid = this.altList[i].use.id;
            }
            scheduleStep = this.altList[i].use.maxScheduleStep(this.prio, scheduleStep);
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }
    
    toString(): string {
        return "[cond, " + this.condVar.idStr() + ", o(" +
            this.altList.map(function(a){
                return "{on:" + a.on.idStr() + ", use:" + a.use.idStr() + "}";
            }).join(", ") + ")]";
    }

    toFullString(): string {
        return "[cond, " + this.condVar.toFullString() + ", o(" +
            this.altList.map(function(a){
                return "{on:" + a.on.toFullString() + ", use:" + a.use.toFullString() + "}";
            }).join(", ") + ")]";
    }

    toCDLString(indent: string = undefined): string {
        var str = "[cond, " + this.condVar.toCDLString(undefined) + ", o(";
        var nIndent: string = indent !== undefined? indent + "    ": undefined;

        for (var i = 0; i < this.altList.length; i++) {
            var alt = this.altList[i];
            if (i > 0) str += ", ";
            str += "{";
            if (nIndent !== undefined) {
                str += "\n" + nIndent;
            }
            str += "on: " + alt.on.toCDLString(undefined) +
                   ", use:" + alt.use.toCDLString(undefined);
            if (indent !== undefined) {
                str += "\n" + indent;
            }
            str += "}";
        }
        return str + ")]";
    }

    toExportString(origin: number): string {
        return "_co(" + this.localityString() + ", " +
            this.condVar.idExpStr(origin) + ", [" +
            this.altList.map(function(a){
                return "{on:" + a.on.idExpStr(origin) + ", use:" + a.use.idExpStr(origin) + "}";
            }).join(", ") + "])";
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            for (var i: number = 0; i !== this.altList.length; i++) {
                this.altList[i].use.markWritablePath();
            }
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        for (var i: number = 0; i !== this.altList.length; i++) {
            if (this.altList[i].use.writable) {
                this.writable = true;
                return;
            }
        }
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        this.condVar.setPriority(prio);
        for (var i: number = 0; i !== this.altList.length; i++) {
            this.altList[i].on.setPriority(prio);
            this.altList[i].use.setPriority(prio);
        }
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationCond = new EvaluationCond(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        evalNode.setConditionVar(getEvaluationNode(this.condVar, local));
        for (var i: number = 0; i !== this.altList.length; i++) {
            evalNode.addAltOn(getEvaluationNode(this.altList[i].on, local));
        }
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        var allInputs: FunctionNode[] = [this.condVar];

        for (var i: number = 0; i !== this.altList.length; i++) {
            allInputs.push(this.altList[i].on);
            allInputs.push(this.altList[i].use);
        }
        return allInputs;
    }


    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }

        var condVar: FunctionNode = this.condVar.containsQualifiedExpression &&
                                    this.condVar.hasSameVariantLocalityAs(this)?
            this.condVar.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
            this.condVar;
        var altList: {on: FunctionNode; use: FunctionNode}[] = new Array(this.altList.length);
        var change: boolean = false;

        for (var i: number = 0; i < this.altList.length; i++) {
            var on: FunctionNode = this.altList[i].on.containsQualifiedExpression &&
                                   this.altList[i].on.hasSameVariantLocalityAs(this)?
                this.altList[i].on.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.altList[i].on;
            var use: FunctionNode = this.altList[i].use.containsQualifiedExpression &&
                                    this.altList[i].use.hasSameVariantLocalityAs(this)?
                this.altList[i].use.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
                this.altList[i].use;
            altList[i] = { on: on, use: use };
            if (on !== this.altList[i].on || use !== this.altList[i].use) {
                change = true;
            }
        };
        return !change? this: CondNode.build(condVar, altList, origin, this.origExpr);
    }

    // TODO: size
    static build(condVar: FunctionNode, altList: {on: FunctionNode; use: FunctionNode}[], origin: number, origExpr: Expression): FunctionNode {
        var valueType: ValueType = new ValueType();
        var localToArea: number = condVar.localToArea;
        var localToDefun: number = condVar.localToDefun;
        var wontChangeValue: boolean = true;

        if (condVar instanceof ConstNode) {
            var allOnConst: boolean = true;
            wontChangeValue = condVar.wontChangeValue;
            for (var i: number = 0; allOnConst && i !== altList.length; i++) {
                var on: FunctionNode = altList[i].on;
                if (on instanceof ConstNode) {
                    var onValue: any = getDeOSedValue(on.value);
                    wontChangeValue = wontChangeValue && on.wontChangeValue;
                    if (onValue === null ||
                          interpretedQualifierMatch(onValue, condVar.value)) {
                        return wontChangeValue? altList[i].use:
                               altList[i].use.mightChange();
                    }
                } else {
                    allOnConst = false;
                    break;
                }
            }
            if (allOnConst) {
                // If the cond var and all the on expressions are constant,
                // there is no match, so this always evaluated to o()
                return buildConstNode([], wontChangeValue, undefined, 0, gEmptyOSExpr);
            }
        }
        var precedingOnAreConstBool: boolean = true;
        for (var i: number = 0; i !== altList.length; i++) {
            var on: FunctionNode = altList[i].on;
            var use: FunctionNode = altList[i].use;
            if (precedingOnAreConstBool) {
                // If we only have boolean on: matches and the condVar always
                // matches true or false, we can reduce this expression to
                // the corresponding use:
                if (on instanceof ConstNode) {
                    if (on.value === true ||
                        (on.value instanceof Array && on.value[0] === true)) {
                        if (condVar.isAlwaysTrue()) {
                            return use;
                        }
                    } else if (on.value === false ||
                               (on.value instanceof Array &&
                                (on.value.length === 0 || on.value[0] === false))) {
                        if (condVar.isAlwaysFalse()) {
                            return use;
                        }
                    } else {
                        precedingOnAreConstBool = false;
                    }
                } else {
                    precedingOnAreConstBool = false;
                }
            }
            localToArea = mergeLocality(localToArea, on.localToArea);
            localToArea = mergeLocality(localToArea, use.localToArea);
            localToDefun = mergeDefunLocality(localToDefun, on.localToDefun);
            localToDefun = mergeDefunLocality(localToDefun, use.localToDefun);
            valueType = valueType.merge(use.valueType);
        }
        // Replace [cond, c, o({on: true, use: <e>}, {on: false, use: o()})]
        // with a BoolGateNode
        if (altList.length === 2 &&
            altList[0].on instanceof ConstNode &&
            ((<ConstNode>altList[0].on).value === true ||
             objectEqual((<ConstNode>altList[0].on).value, [true])) &&
            altList[1].on instanceof ConstNode &&
            ((<ConstNode>altList[1].on).value === false ||
             objectEqual((<ConstNode>altList[1].on).value, []) ||
             objectEqual((<ConstNode>altList[1].on).value, [false])) &&
            altList[1].use instanceof ConstNode &&
            objectEqual((<ConstNode>altList[1].use).value, [])) {
            return BoolGateNode.build(condVar, altList[0].use, origExpr);
        } else if (altList.length === 2 &&
            altList[1].on instanceof ConstNode &&
            ((<ConstNode>altList[1].on).value === true ||
             objectEqual((<ConstNode>altList[1].on).value, [true])) &&
            altList[0].on instanceof ConstNode &&
            ((<ConstNode>altList[0].on).value === false ||
             objectEqual((<ConstNode>altList[0].on).value, []) ||
             objectEqual((<ConstNode>altList[0].on).value, [false])) &&
            altList[0].use instanceof ConstNode &&
            objectEqual((<ConstNode>altList[0].use).value, [])) {
            return BoolGateNode.build(condVar, altList[1].use, origExpr);
        }
        if (precedingOnAreConstBool) {
            condVar = condVar.getBoolInterpretation();
        }
        return new CondNode(condVar, altList, localToArea, localToDefun, valueType, origExpr);
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        for (var i: number = 0; i < this.altList.length; i++) {
            this.altList[i].use.setDefunArgTypes(args, stack);
        }
        delete stack[this.seqNr];
    }

    getDataSourceInputs(): FunctionNode[] {
        return this.altList.map(function(alt) { return alt.use;});
    }

    isStrictSelection(): boolean {
        return this.altList.every(function(alt) {
            return alt.use.isStrictSelection();
        });
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        wrNodes = this.altList.map(function(alt): WritableNodePath[] {
            return alt.use.extractWritableDestinations(path, visited);
        }).reduce(function(allWrNodes: WritableNodePath[], wrNodes: WritableNodePath[]) {
            return wrNodes.length > 0? allWrNodes.concat(wrNodes): allWrNodes;
        }, []);
        delete visited[this.seqNr];
        return wrNodes;
    }
}

var dbgcnt: number = 0;

// This object temporarily takes the place of the function to be resolved
// Once resolved, it pretends to be its replacement in the valueType, and will
// not show up in the cache.
class StubFunctionNode extends FunctionNode {

    // The resolution of the query
    resolution: FunctionNode;

    stubCycleNr: number = gStubCycleNr;

    // Stopped means the same stub node was encountered, which means recursion
    stopped: boolean = false;

    constructor(localToArea: number, defun: number, valueType: ValueType) {
        super(localToArea, defun, valueType === undefined? new ValueType(): valueType, undefined);
        this.id = -3;
        this.checkForQualifiedExpressions();
    }

    type(): FunctionNodeType {
        return FunctionNodeType.stub;
    }

    // Assume stubs are not equal when their resolution is unknown.
    // True equality, i.e. this === fn, has already been tested.
    specificEqual(fn: FunctionNode): boolean {
        var sfn = <StubFunctionNode> fn;

        dbgcnt++;
        if (dbgcnt == 100) debugger;
        var r = this.resolution !== undefined && sfn.resolution !== undefined &&
            this.resolution.isEqual(sfn.resolution);
        dbgcnt--;
        return r;
    }

    isAlwaysTrue(): boolean {
        return this.resolution !== undefined && this.resolution.isAlwaysTrue();
    }

    isAlwaysFalse(): boolean {
        return this.resolution !== undefined && this.resolution.isAlwaysFalse();
    }

    isUnmergeable(): boolean {
        return this.resolution !== undefined && this.resolution.isUnmergeable();
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;

        if (!(this.seqNr in stack)) {
            stack[this.seqNr] = true;
            if (this.resolution === undefined) {
                mid = this.resolution.getMaximumInputId(stack, process, setId);
            }
            delete stack[this.seqNr];
        }
        return mid;
    }
    
    // Removes from cache and replace with new node. The effect is as if this
    // FunctionNode was replaced with another.
    resolve(fn: FunctionNode): void {
        assert(this !== fn, "resolve cycle");
        this.resolution = fn;
        this.id = -4;
        if (fn !== undefined) {
            this.valueType = fn.valueType;
            this.localToArea = fn.localToArea;
            this.localToDefun = fn.localToDefun;
            this.containsQualifiedExpression = fn.containsQualifiedExpression;
            fn.markAsResolution(this);
            this.hasWritableReference = fn.hasWritableReference;
        } else {
            this.valueType = new ValueType(); // .addUndefined();
            this.localToArea = undefined;
            this.localToDefun = 0;
            this.containsQualifiedExpression = false;
            this.hasWritableReference = false;
        }
    }

    resetResolution(): void {
        if (this.cycleNr !== gCycleNr) {
            this.cycleNr = gCycleNr;
            this.stopped = false;
            this.id = -3;
        }
    }

    // Anyone that got this object should at runtime use the resolution instead
    idStr(): string {
        return this.resolution? this.resolution.idStr(): "<UNDEFINED>";
    }

    toString(): string {
        return this.resolution === undefined?
            "Stub(<undefined>)": "Stub(" + this.resolution.idStr() + ")";
    }

    toFullString(): string {
        return this.resolution === undefined?
            "stub(<undefined>)": "stub(" + this.resolution.toFullString() + ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.resolution === undefined?
            "[stub]": this.formatCDLFunctionCall("stub", [this.resolution], indent);
    }

    toExportString(origin: number): string {
        return this.resolution.toExportString(origin);
    }

    markWritablePath(): void {
        if (this.writabilityUndetermined()) {
            this.writable = true;
            this.resolution.markWritablePath();
            FunctionNode.writabilityQueue.push(this);
        }
    }

    checkWritability(): void {
        this.writable = this.resolution.writable;
    }

    setPriority(prio: number): void {
        this.resolution.setPriority(prio);
    }

    allInputs(): FunctionNode[] {
        return this.resolution !== undefined? [this.resolution]: [];
    }

    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick &&
              (pickQualifiedExpressionStrategy !== PickQualifiedExpressionStrategy.alwaysPickDefun ||
               this.localToDefun === 0)) {
            return this;
        }
        return this.resolution === undefined? this:
            this.resolution.containsQualifiedExpression && this.resolution.hasSameVariantLocalityAs(this)?
            this.resolution.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin):
            this.resolution;
    }

    getDataSourceInputs(): FunctionNode[] {
        return this.resolution === undefined? []: [this.resolution];
    }

    extractWritableDestinations(path: string[], visited: {[seqNr: number]: boolean}): WritableNodePath[] {
        var wrNodes: WritableNodePath[];

        if (this.seqNr in visited) {
            return [];
        }
        visited[this.seqNr] = true;
        wrNodes = this.resolution.extractWritableDestinations(path, visited);
        delete visited[this.seqNr];
        return wrNodes;
    }

    getConstancy(): boolean {
        return this.resolution === undefined && this.resolution.getConstancy();
    }
}

// Represents a cyclical query, which will be replaced by an empty os.
class QueryCycle extends FunctionNode {

    path: string[];
    cycleInfo: string[];

    constructor(path: string[], localToArea: number, defun: number, cycleInfo: string[]) {
        super(localToArea, defun, new ValueType(), undefined);
        this.path = path;
        this.cycleInfo = cycleInfo;
        this.id = -5;
    }

    type(): FunctionNodeType {
        return FunctionNodeType.queryCycle;
    }

    // To be filled in by the derived class
    specificEqual(fn: FunctionNode): boolean {
        var qc = <QueryCycle> fn;

        return objectEqual(this.path, qc.path);
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        return -1;
    }
    
    toString(): string {
        return "QueryCycle(" + this.path.toString() + ")";
    }

    toFullString(): string {
        return "cycle(" + this.path.toString() + ")";
    }

    toCDLString(indent: string = undefined): string {
        return "[cycle]";
    }

    toExportString(origin: number): string {
        assert(false, "export not allowed");
        return undefined;
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    checkWritability(): void {
        Utilities.error("do not call");
    }

    allInputs(): FunctionNode[] {
        Utilities.error("do not call");
        return undefined;
    }

    markWritablePath(): void {
        Utilities.error("do not call");
    }

    setPriority(prio: number): void {
        Utilities.error("do not call");
    }
}

class DefunNode extends FunctionNode {
    parameters: {[name: string]: number};
    parameterNodes: StorageNode[];
    body: FunctionNode;
    defunNr: number;
    inUse: boolean = false;
    orig: ExpressionFunctionApplication;

    constructor(localToArea: number, localToDefun: number, defunNr: number,
                parameters: {[name: string]: number},
                parameterNodes: StorageNode[],
                body: FunctionNode, orig: ExpressionFunctionApplication)
    {
        super(localToArea, localToDefun, body === undefined? undefined:
              new ValueType().addDefun(body.valueType).addSize(1), orig);
        this.defunNr = defunNr;
        this.parameters = parameters;
        this.parameterNodes = parameterNodes;
        this.body = body;
        this.orig = orig;
        if (doCompileTimeChecks) {
            this.containsQualifiedExpression = this.body.containsQualifiedExpression;
        }
    }

    setBody(body: FunctionNode): void {
        this.body = body;
    }

    type(): FunctionNodeType {
        return FunctionNodeType.defun;
    }

    // To be filled in by the derived class
    specificEqual(fn: FunctionNode): boolean {
        var d = <DefunNode> fn;

        return this.defunNr === d.defunNr;
    }

    isAlwaysTrue(): boolean {
        return true;
    }

    isUnmergeable(): boolean {
        return true;
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        var mid: number = -1;
        var scheduleStep: number = !this.localToArea? -1:
            areaTemplates[this.localToArea].getScheduleStep(stack, process);

        if (this.body.localToDefun === 0) {
            // Not depending on any parameter, so scheduled as a normal
            // expression; that also means that the defun itself is not needed,
            // but since that case is probably rare, we're not going to optimize
            // it.
            this.body = process(this.body, stack, false);
            if (this.body.localToArea === this.localToArea &&
                  this.body.id > mid) {
                mid = this.body.id;
            }
            scheduleStep = this.body.maxScheduleStep(this.prio, scheduleStep);
        }
        for (var i = 0; i !== this.parameterNodes.length; i++) {
            this.parameterNodes[i] = <StorageNode> process(this.parameterNodes[i], stack, false);
            if (this.parameterNodes[i].localToArea === this.localToArea &&
                  this.parameterNodes[i].id > mid) {
                mid = this.parameterNodes[i].id;
            }
            scheduleStep = this.parameterNodes[i].maxScheduleStep(this.prio, scheduleStep);
        }
        if (setId) {
            this.scheduleStep = scheduleStep + 1;
        }
        return mid;
    }

    postCache(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode): void {
        if (this.body.localToDefun !== 0) {
            assert(!this.inUse, "cannot be called recursively");
            this.inUse = true;
            process(this.body, stack, false);
            this.scheduleStep = this.body.scheduleStep + 1;
            this.inUse = false;
        }
    }
    
    setSchedulingError(): void {
    }

    // Propagates scheduling errors in the defun's body to the defun; this is
    // unnecessary for handling the defun as a value, but is a flag for its
    // application.
    isScheduledProperly(): boolean {
        return this.body.isScheduledProperly();
    }

    toString(): string {
        return "defun(" + JSON.stringify(this.parameters) + ", " +
            this.body.idStr() + ")";
    }

    toFullString(): string {
        return "defun(" + JSON.stringify(this.parameters) + /* ", " +
            this.body.toFullString() + */ ")";
    }

    toCDLString(indent: string = undefined): string {
        return this.formatArray(["defun, o(" + Object.keys(this.parameters).join(",") + ")",
                                this.body], true, indent);
    }

    toExportString(origin: number): string {
        if (this.body.localToDefun === 0) {
            return "_def(" + this.localityString() + ", " + this.defunNr + ", [" +
                this.parameterNodes.map(function(pm: StorageNode) {
                    return pm.idExpStr(origin);
                }).join(", ") + "], " + this.body.idExpStr(origin) +
                ", function () {\n" +
                this.parameterNodes.map(function(fn: FunctionNode) {
                    return fn.constructPrototypeFunctionCall(origin);
                }).join("\n    ") + "\n    })";
        } else {
            var defunFunctionNodes = this.localToArea > 0?
                areaTemplates[this.localToArea].defunFunctionNodes[this.defunNr]:
                FunctionNode.globalDefunFunctionNodes[this.defunNr];
            if (defunFunctionNodes === undefined) {
                Utilities.warn("defun " + this.idStr() + " undefined");
                return "_v(constEmptyOS, undefined)";
            }
            return "_def(" + this.localityString() + ", " + this.defunNr + ", [" +
                this.parameterNodes.map(function(pm: StorageNode) {
                    return pm.idExpStr(origin);
                }).join(", ") + "], " + this.body.idExpStr(origin) +
                ", function () {\n" +
                defunFunctionNodes.map(function(fn: FunctionNode) {
                    return fn.constructPrototypeFunctionCall(origin);
                }).join("\n    ") + "\n    })";
        }
    }

    markWritablePath(): void {
        Utilities.warnOnce("cannot write through defun");
    }

    setPriority(prio: number): void {
        if (prio <= this.prio)
            return;
        this.prio = prio;
        for (var i: number = 0; i !== this.parameterNodes.length; i++) {
            this.parameterNodes[i].setPriority(prio);
        }
        this.body.setPriority(prio);
    }

    makeEvaluationNode(local: EvaluationEnvironment): EvaluationNode {
        var evalNode: EvaluationDefun = new EvaluationDefun(this, local);

        // EvaluationNode.register(local, evalNode);
        local.evaluationNodes[this.localToDefun][this.id] = evalNode;
        return evalNode;
    }

    allInputs(): FunctionNode[] {
        return [];
    }

    valueUnderQualifier(q: SingleQualifier[], nq: SingleQualifier[][]): FunctionNode {
        gDefunStack.push(this.defunNr);
        var body: FunctionNode = this.body.valueUnderQualifier(q, nq);
        gDefunStack.pop();
        return body === this.body? this:
            new DefunNode(this.localToArea, this.localToDefun, this.defunNr,
                          this.parameters, this.parameterNodes,
                          body, this.orig);
    }

    // A defun's body is not allowed to contain variants
    pickQualifiedExpression(knownTrueQualifiers: SingleQualifier[], knownFalseQualifiers: SingleQualifier[][], origin: number): FunctionNode {
        if (this.body.containsQualifiedExpression) {
            gDefunStack.push(this.defunNr);
            var oldPickStrategy = pickQualifiedExpressionStrategy;
            if (pickQualifiedExpressionStrategy < PickQualifiedExpressionStrategy.alwaysPick) {
                pickQualifiedExpressionStrategy = PickQualifiedExpressionStrategy.alwaysPickDefun;
            }
            var body: FunctionNode =
                this.body.pickQualifiedExpression(knownTrueQualifiers, knownFalseQualifiers, origin);
            pickQualifiedExpressionStrategy = oldPickStrategy;
            gDefunStack.pop();
            if (body !== this.body) {
                return new DefunNode(this.localToArea, this.localToDefun,
                                     this.defunNr, this.parameters,
                                     this.parameterNodes, body, this.orig);
            }
        }
        return this;
    }

    setDefunArgTypes(args: FunctionNode[], stack: {[seqNr: number]: boolean}): void {
        if (this.seqNr in stack) {
            return;
        }
        stack[this.seqNr] = true;
        if (args.length !== this.parameterNodes.length) {
            Utilities.syntaxError("mismatch nr parameters");
            return;
        }
        this.orig.setDefunArgTypes(args);
        delete stack[this.seqNr];
    }

    getDataSourceInputs(): FunctionNode[] {
        return [];
    }

    checkWritability(): void {
        Utilities.error("do not call");
    }

    tagExpressionPath(templateId: number, defunId: number, path: string): void {
        super.tagExpressionPath(templateId, defunId, path);
        for (var i = 0; i < this.parameterNodes.length; i++) {
            var parameterNode = this.parameterNodes[i];
            parameterNode.tagExpressionPath(templateId, this.defunNr, path + ".defun." + parameterNode.path[0]);
        }
        this.body.tagExpressionPath(templateId, this.defunNr, path + ".defun");
    }
}

// Verifies that a and b produce the same output
class VerificationFunctionNode extends FunctionApplicationNode {
    static getValueType(args: FunctionNode[]): ValueType { 
        return args[0].valueType;
    }

    static build(a: FunctionNode, b: FunctionNode): FunctionNode {
        var localToArea: number = mergeLocality(a.localToArea, b.localToArea);
        var localToDefun: number = mergeDefunLocality(a.localToDefun, b.localToDefun);

        return new VerificationFunctionNode(verificationFunction, [a, b],
                             localToArea, localToDefun, a.valueType, undefined);
    }

    isAlwaysTrue(): boolean {
        return this.functionArguments[0].isAlwaysTrue();
    }

    isUnmergeable(): boolean {
        return this.functionArguments[0].isUnmergeable();
    }
}
