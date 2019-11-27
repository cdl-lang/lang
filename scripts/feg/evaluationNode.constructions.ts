// Copyright 2019 Yoav Seginer.
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

/// <reference path="evaluationNode.ts" />

// Let value pass when condition is true
// Note: since b is instantiated later, it's possible that the result of the
// evaluation is constant, but only after a watcher has been added. Since there
// is no way to make the watchers unwatch, constant stays false (unwatching
// could be implemented, but seems more trouble than it's worth).
class EvaluationBoolGate extends EvaluationNode
    implements CleanUpUnusedEvaluationNodes
{
    prototype: BoolGateNode;
    open: boolean = undefined;
    bActive: boolean = false;
    a: EvaluationNode = undefined;
    b: EvaluationNode = undefined;
    constant: boolean = false;

    constructor(prototype: BoolGateNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constEmptyOS;
    }

    setA(a: EvaluationNode): void {
        this.a = a;
        if (!a.isConstant()) {
            a.addWatcher(this, 0, false, true, false);
            this.inputs = [a];
        } else {
            this.inputs = [];
        }
    }

    instantiateB(): void {
        this.b = getEvaluationNode(this.prototype.b, this.local);
        if (!this.b.isConstant()) {
            this.b.addWatcher(this, 1, false, true, true);
        } else if (this.nrActiveWatchers === 0 &&
                   (this.watchers === undefined || this.watchers.size === 0)) {
            this.watchers = undefined;
            this.constant = true;
        }
    }

    removeAsWatcher(): void {
        if (this.a !== undefined) {
            this.a.removeWatcher(this, true, false);
            this.a = undefined;
        }
        if (this.b !== undefined) {
            this.b.removeWatcher(this, true, true);
            this.b = undefined;
        }
    }

    isConstant(): boolean {
        return this.constant;
    }

    updateInput(pos: any, result: Result): void {
        if (pos === 0) {
            this.markAsChanged();
        } else if (pos === 1) {
            if (this.open) {
                // Changes only when a is true (set mode changes are handled all
                // at once, i.e. each element from b is added to the result
                // depending on the corresponding value in a, and we don't know
                // the state, so any change in a marks the result as changed).
                this.markAsChanged();
            }
        }
    }

    eval(): boolean {
        var oldValue = this.result.value;

        this.inputHasChanged = false;
        this.open = isTrue(this.a.result.value);
        if (!this.open) {
            if (this.bActive) {
                this.bActive = false;
                this.b.deactivate(this, true);
                if (!this.b.isConstant() && "schedulingError" in this.prototype) {
                    this.inputs.pop();
                }
            }
            this.result.set(constEmptyOS);
        } else {
            if (this.b === undefined) {
                this.instantiateB();
            }
            if (!this.b.isConstant()) {
                this.b.activate(this, true);
                this.bActive = true;
                if ("schedulingError" in this.prototype) {
                    this.inputs.push(this.b);
                }
                if (this.b.isScheduled()) {
                    this.b.forceUpdate(this, true);
                    return undefined; // leave scheduled
                }
            }
            this.result.copy(this.b.result);
        }
        return !valueEqual(oldValue, this.result.value);
    }

    isDeferableInput(pos: any, input: EvaluationNode): boolean {
        return pos === 0 || this.open;
    }

    activateInputs(): void {
        this.a.activate(this, false);
        this.inputHasChanged = true;
    }

    deactivateInputs(): void {
        if (this.a !== undefined) {
            this.a.deactivate(this, false);
        }
        if (this.b !== undefined) {
            if (this.open && !this.b.isConstant()) {
                this.b.deactivate(this, true);
                this.bActive = false;
                if ("schedulingError" in this.prototype) {
                    this.inputs.pop();
                }
            }
            // Signal that no use expression is active
            this.open = false;
        }
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (!this.open || this.b === undefined) {
            this.reportDeadEndWrite(reportDeadEnd,
                                    "writing to closed bool gate");
            return false;
        }
        return this.b.write(result, mode, positions, reportDeadEnd);
    }

    debugName(): string {
        return "boolGate";
    }

    // querySourceId(): number {
    //     return this.open? this.inputs[1].querySourceId(): this.watcherId;
    // }

    multiQuerySourceIds(): number[] {
        return this.open? this.inputs[1].multiQuerySourceIds(): [];
    }

    removeWatcherFromInactiveNodes(): void {
        if (!this.open && this.b !== undefined && !this.b.isConstant()) {
            this.b.removeWatcherForPos(this, 1, false, true);
            this.b = undefined;
            this.bActive = false;
        }
    }
}

// Not data source aware
class EvaluationBoolMatch extends EvaluationNode {
    constant: boolean = true;
    open: boolean = false;
    simpleQuery: SimpleQuery = undefined;

    constructor(prototype: BoolMatchNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constEmptyOS;
    }

    setArguments(a: EvaluationNode, b: EvaluationNode, c: EvaluationNode): void {
        this.inputs = [a, b, c];
        if (!a.isConstant()) {
            this.constant = false;
            a.addWatcher(this, 0, false, true, false);
        }
        if (!b.isConstant()) {
            this.constant = false;
            b.addWatcher(this, 1, false, true, false);
        }
        if (!c.isConstant()) {
            this.constant = false;
            c.addWatcher(this, 1, false, true, false);
        }
    }

    isConstant(): boolean {
        return this.constant;
    }

    updateInput(pos: any, result: Result): void {
        if (pos === 1) {
            this.simpleQuery = undefined; // triggers making it again
        }
        this.markAsChanged();
    }

    eval(): boolean {
        var oldValue = this.result.value;

        if (this.simpleQuery === undefined && this.inputs[1] !== undefined) {
            this.simpleQuery = makeSimpleQueryWithId(
                this.inputs[1].result.value, this.inputs[1].result.identifiers);
        }
        this.open =
            this.inputs[0] !== undefined && this.simpleQuery !== undefined &&
            this.simpleQuery.testOS(this.inputs[0].result.value);
        this.result.value = this.open?
            this.inputs[2].result.value: constEmptyOS;
        return !valueEqual(oldValue, this.result.value);
    }

    debugName(): string {
        return "boolMatch";
    }

    // querySourceId(): number {
    //     return this.open? this.inputs[2].querySourceId(this): this.watcherId;
    // }

    multiQuerySourceIds(): number[] {
        return this.open? this.inputs[2].multiQuerySourceIds(): [];
    }
}

// Note that EvaluationAV modifies its value, so that result.value
// when it calls updateInput is always the same.
class EvaluationAV extends EvaluationNode {
    constant: boolean = true;
    inputByAttr: {[attr: string]: EvaluationNode} = {};

    constructor(prototype: AVFunctionNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constEmptyOS;
        if ("schedulingError" in prototype) {
            this.inputs = [];
        }
    }

    removeAsWatcher(): void {
        for (var attr in this.inputByAttr) {
            this.inputByAttr[attr].removeWatcher(this, true, false);
        }
        this.inputByAttr = undefined;
    }

    addAttribute(attr: string, evalNode: EvaluationNode): void {
        this.inputByAttr[attr] = evalNode;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, attr, true, true, false);
            if ("schedulingError" in this.prototype) {
                this.inputs.push(evalNode);
            }
        }
    }

    updateInput(attr: any, result: Result): void {
        this.markAsChanged();
    }

    isConstant(): boolean {
        return this.constant;
    }

    activateInputs(): void {
        for (var attr in this.inputByAttr) {
            this.inputByAttr[attr].activate(this, false);
        }
    }

    deactivateInputs(): void {
        if (this.inputByAttr !== undefined) {
            for (var attr in this.inputByAttr) {
                this.inputByAttr[attr].deactivate(this, false);
            }
        }
    }

    eval(): boolean {
        var avFunctionNode = <AVFunctionNode> this.prototype;
        var res: any = {};

        if(this.result.mergeAttributes !== undefined)
            this.result.mergeAttributes = undefined;
        
        for (var attr in this.inputByAttr) {
            var attrRes: Result = this.inputByAttr[attr].result;
            var attrResValue: any = attrRes.value;
            if (attrResValue !== undefined) {
                if (this.prototype.suppressSet !== undefined &&
                      attr in avFunctionNode.suppressSetAttr) {
                    if (attrResValue instanceof Array &&
                        attrResValue.length === 0) {
                        // Some attributes need [] -> false, others don't
                        if (avFunctionNode.suppressSetAttr[attr]) {
                            res[attr] = false;
                        }
                    } else {
                        res[attr] = stripArray(attrResValue);
                    }
                } else {
                    res[attr] = attrResValue;
                }

                this.result.
                    setMergeAttributesUnderAttr(attr, attrRes.mergeAttributes);

                this.result.addSubIdentifiersUnderAttr(attr,
                                                       attrRes.identifiers,
                                                       attrRes.subIdentifiers);
            }
        }
        this.result.value = this.prototype.suppressSet !== undefined? res: [res];
        return true;
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (this.constant) {
            this.reportDeadEndWrite(reportDeadEnd, "writing to constant AV");
            return false;
        }
        if (positions !== undefined &&
              (positions.length !== 1 ||
               positions[0].index !== 0 || positions[0].length !== 1)) {
            this.reportDeadEndWrite(reportDeadEnd, "writing os to single AV");
            return false;
        }

        var success: boolean = true;
        
        if (positions === undefined || positions[0].path === undefined) {
            // Write an av over an av, attribute by attribute
            var repl: any = getDeOSedValue(result.value);
            if (!isAV(repl)) { // accept only o({a: ..., b: ...})
                this.reportDeadEndWrite(reportDeadEnd,
                                        "writing non-singleton or non AV over AV");
                return false;
            }
            for (var attr in repl) {
                if (!(attr in this.inputByAttr)) {
                    // An AV itself can never be a write destination, so writing
                    // to a non-existing attribute is not allowed.
                    this.reportDeadEndWrite(reportDeadEnd,
                                            "writing to non-existing attribute in non-writable AV");
                    success = false;
                    continue;
                }
                var attrResult: Result = result.popAttr(attr);
                if(!attrResult) {
                    success = false;
                    continue;
                }
                var idPositions: { matched: DataPosition[],
                                   noMatch: DataPosition[] } = undefined;
                var attrNode: EvaluationNode = this.inputByAttr[attr];
                if(positions !== undefined && positions[0].toSubIdentifiers) {
                    var toAttrSubIds: any =
                        positions[0].toSubIdentifiers[attr];
                    if(toAttrSubIds !== undefined) {
                        var toAttrResult = new Result(attrNode.result.value);
                        toAttrResult.setSubIdentifiers(toAttrSubIds);
                        idPositions = getIdentifiedWritePositions(attrResult,
                                                                  toAttrResult);
                    }
                }
                if(idPositions && (idPositions.matched || idPositions.noMatch)){
                    if(idPositions.matched) {
                        if(!attrNode.write(attrResult, mode,
                                           idPositions.matched, reportDeadEnd))
                            success = false;
                    }
                    if(idPositions.noMatch) {
                        if(!attrNode.write(attrResult, mode,
                                           idPositions.noMatch, reportDeadEnd))
                            success = false;
                    }
                } else if(!attrNode.write(attrResult, mode, undefined,
                                          reportDeadEnd))
                    success = false;
            }
        } else {
            // Write to attributes
            for (var i: number = 0; i < positions.length; i++) {
                if (positions[i].path === undefined || positions[i].path.length !== 1 ||
                    !(positions[i].path[i] in this.inputByAttr)) {
                    this.reportDeadEndWrite(reportDeadEnd,
                                            "writing to non existing attribute in AV");
                    success = false;
                } else {
                    this.inputByAttr[positions[i].path[i]].write(
                        result, mode, positions[i].sub, reportDeadEnd);
                }
            }
        }

        return success;
    }

    debugName(): string {
        return "attributeValue";
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        super.specificExplanation(explanation, classDebugInfo, true);
        for (var attr in this.inputByAttr) {
            explanation[attr + ": " + this.inputByAttr[attr].debugName()] =
                this.inputByAttr[attr].explain(getATDBIAttr(classDebugInfo, attr));
        }
        return explanation;
    }

    toString(): string {
        var str: string = "";

        for (var attr in this.inputByAttr) {
            if (str.length > 0) str += ", ";
            str += attr + ":" + cdlifyLim(this.inputByAttr[attr].result.value, 80);
        }
        return this.prototype.idStr() + "=" + "{" + str + "}";
    }

    toFullString(): string {
        var str: string = this.nrActiveWatchers === 0? "*{": "{";

        for (var attr in this.inputByAttr) {
            if (str.length > 2) str += ", ";
            str += attr + ": " + this.inputByAttr[attr].toFullString();
        }
        return str + "}";
    }
}

// This class can't be declared abstract (causes error on instantiating
// builtInFunction.classConstructor). 
class EvaluationNodeWithArguments extends EvaluationNode {
    constant: boolean;
    arguments: Result[];

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.arguments[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, true, true, this.dataSourceAware);
        } else {
            this.updateInput(i, evalNode.result);
        }
    }

    updateInput(pos: any, result: Result): void {
        throw "don't call";
    }

    eval(): boolean {
        throw "don't call";
    }
}

class EvaluationFunctionApplication extends EvaluationNodeWithArguments implements ReceiveDataSourceResult {
    bif: BuiltInFunction;
    executableFunction: ExecutableFunction;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.bif = prototype.builtInFunction;
        this.executableFunction = this.bif.factory(local, this);
        this.constant = !this.bif.dependingOnImplicitArguments;
        this.inputs = new Array(prototype.functionArguments.length);
        this.arguments = new Array(prototype.functionArguments.length);
        this.dataSourceAware = this.bif.name in DataSource.dataSourceFunctions;
        this.result.value = constEmptyOS;
    }

    destroy(): void {
        if (this.dataSourceInput !== undefined) {
            this.releaseDataSourceInput();
        }
        this.executableFunction.destroy();
        super.destroy();
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        // Most functions don't care about the result mode; their output
        // function is always a Javascript result value.
    }

    dataSourceInput: DataSourceComposable;
    dataSourceFunctionApplication: DataSourceFunctionApplication;

    // Get the application of the aggregate function on the data source,
    // and copy the possibly already existing result.
    setDataSourceInput(dataSource: DataSourceComposable): void {
        var res: any[];
        var newDataSource: boolean = false;

        if (this.dataSourceInput === dataSource) {
            return;
        }
        if (this.dataSourceInput !== undefined) {
            if (this.nrActiveWatchers > 0) {
                this.dataSourceFunctionApplication.deactivate();
            }
            this.dataSourceFunctionApplication.removeResultReceiver(this);
            newDataSource = true;
        }
        this.dataSourceInput = dataSource;
        this.dataSourceFunctionApplication =
            dataSource.applyAggregateFunction(this.bif.name, this);
        if (this.nrActiveWatchers > 0) {
            this.dataSourceFunctionApplication.activate();
        }
        res = this.dataSourceFunctionApplication.getResult();
        if (newDataSource || !valueEqual(this.result.value, res)) {
            this.result.value = res;
            this.markAsChanged();
        }
    }

    releaseDataSourceInput(): void {
        if (this.dataSourceFunctionApplication !== undefined) {
            if (this.nrActiveWatchers > 0) {
                this.dataSourceFunctionApplication.deactivate();
            }
            this.dataSourceFunctionApplication.removeResultReceiver(this);
            this.dataSourceFunctionApplication = undefined;
        }
        this.dataSourceInput = undefined;
    }

    activateInputs(): void {
        super.activateInputs();
        if (this.dataSourceFunctionApplication !== undefined) {
            this.dataSourceFunctionApplication.activate();
        }
    }

    deactivateInputs(): void {
        super.deactivateInputs();
        if (this.dataSourceFunctionApplication !== undefined) {
            this.dataSourceFunctionApplication.deactivate();
        }
    }

    updateInput(i: any, result: Result): void {
        if (i === 0 && this.dataSourceAware) {
            if (result !== undefined && "dataSource" in result) {
                if (this.inputs[0].isScheduled() || !this.inputs[0].isActive()) {
                    // Wait with changing datasources until input has been updated
                    this.inputs[0].addForcedUpdate(this);
                } else {
                    this.setDataSourceInput(result.dataSource);
                    // Do not call markAsChanged; that is up to the data source
                    // chain.
                }
                return;
            } else if (this.dataSourceInput !== undefined) {
                this.releaseDataSourceInput();
                this.dataSourceInput = undefined;
            }
        }
        if (result === undefined) {
            // Node will be removed soon; should not evaluate any more.
            this.inputs[i].removeWatcher(this, false, this.dataSourceAware);
            this.inputs[i] = undefined;
            this.arguments = undefined;
        } else {
            this.arguments[i] = result;
            this.markAsChanged();
        }
    }

    newDataSourceResult(v: any[]): void {
        if (!valueEqual(this.result.value, v)) {
            this.result.value = v;
            this.markAsChanged();
        }
    }

    reextractData(): void {
        assert(false, "should not be called");
    }

    isConstant(): boolean {
        return this.constant;
    }

    resultIsTransient(): boolean {
        return this.bif.transientResult;
    }

    eval(): boolean {
        var oldValue: any = this.result.value;
        var oldIdentifiers: any[] = this.result.identifiers;
        var oldSubIdentifiers: any[] = this.result.subIdentifiers;
        var newValue: any;

        this.inputHasChanged = this.bif.transientResult;
        if (this.dataSourceInput !== undefined) {
            // Update has been triggered by direct callback from
            // dataSourceFunctionApplication
            return true;
        }
        if (this.executableFunction instanceof EFNop)
            console.log("function", this.bif.name, "is nop");
        var outIds = new SubIdentifiers(undefined, undefined);
        newValue = this.executableFunction.execute(this.arguments, outIds);
        if (this.executableFunction.undefinedSignalsNoChange()) {
            if (newValue === undefined) {
                return false;
            } else {
                this.result.value = newValue;
                this.result.setSubIdentifiers(outIds);
                return true;
            }
        } else {
            this.result.value = newValue;
            this.result.setSubIdentifiers(outIds);
            return !valueEqual(oldValue, newValue) ||
                !valueEqual(oldIdentifiers, this.result.identifiers) ||
                !valueEqual(oldSubIdentifiers, this.result.subIdentifiers);
        }
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if(this.bif.writeThroughToWritableInputs) {
            // Since this function is assumed not to be an extracting function,
            // the positions of its results have nothing to do with the
            // positions of the inputs and, therefore, the 'positions'
            // array (if given) can be ignored.
            var success: boolean = false;
            for (var i: number = 0; i < this.inputs.length; i++) {
                if(this.inputs[i].write(result, mode, undefined, false))
                    success = true;
            }
            if(!success)
                this.reportDeadEndWrite(reportDeadEnd,
                                        "cannot write through any argument of "+
                                        this.bif.name);
            return success;
        } else {
            this.reportDeadEndWrite(reportDeadEnd,
                                    "cannot write through " + this.bif.name);
            return false;
        }
    }

    debugName(): string {
        return this.bif.name;
    }

}

// A crude but efficient implementation
interface QualifierState {
    value: any[];

    holds(): boolean;
    matchValue(): string;
}

// Optimized derived classes

class QualifierStateTrue implements QualifierState {
    value: any[];

    constructor(value: any) {
        this.value = value;
    }

    holds(): boolean {
        return this.value !== undefined && isTrueValue(this.value);
    }

    matchValue(): string {
        return "true";
    }
}

// {undefined: false} does not match in qualifiers
// false does match o() in qualifiers.
class QualifierStateFalse implements QualifierState {
    value: any[];

    constructor(value: any) {
        this.value = value;
    }

    holds(): boolean {
        return /*this.value !== undefined &&*/ isFalseValue(this.value);
    }

    matchValue(): string {
        return "false";
    }
}

class QualifierStateSimpleValue implements QualifierState {
    value: any[];
    match: any;

    constructor(value: any, match: any) {
        this.value = value;
        this.match = match;
    }

    holds(): boolean {
        return this.value !== undefined &&
            this.value.indexOf(this.match) !== -1;
    }

    matchValue(): string {
        return String(this.match);
    }
}

class QualifierStateMatchRange implements QualifierState {
    value: any[];
    match: RangeValue;

    constructor(value: any, match: MoonRange) {
        this.value = value;
        this.match = new RangeValue(match.os, match.closedLower, match.closedUpper);
    }

    holds(): boolean {
        return this.value !== undefined &&
               this.value.some((v: any): boolean => {
                   return this.match.match(v);
               });
    }

    matchValue(): string {
        return String(this.match);
    }
}

class QualifierStateMatchOS implements QualifierState {
    value: any[];
    match: any[];

    constructor(value: any, match: MoonOrderedSet) {
        this.value = value;
        this.match = match.os;
    }

    holds(): boolean {
        return this.value !== undefined &&
               this.value.some((v: any): boolean => {
                   return this.match.some((m: any): boolean => {
                       return m === v? true:
                              v instanceof RangeValue? v.match(m):
                              m instanceof RangeValue? m.match(v):
                              m === true? isTrue(v):
                              isFalse(v);
                   });
               });
    }

    matchValue(): string {
        return String(this.match);
    }
}

// When attempting to match a non-simple value, this is constructed.
// It always returns false.
class QualifierStateAlwaysFalse implements QualifierState {
    value: any[];

    constructor(value: any) {
        this.value = value;
    }

    holds(): boolean {
        return false;
    }

    matchValue(): string {
        return "<<NOMATCH>>";
    }
}

function allQualifiersHold(qualifiers: QualifierState[]): boolean {
    for (var j: number = 0; j !== qualifiers.length; j++) {
        if (!qualifiers[j].holds()) {
            return false;
        }
    }
    return true;
}

// A qualifier node registers on the function nodes that determine the value of
// the qualifiers, compares their result to the values that determine the
// variants, and outputs a list of active variants as a list of boolean values
// (one per variant). This node behaves as a normal function but is not meant to
// be used as an author-accessible function. Its only watcher can be an
// EvaluationVariant, which should do the actual merging.
class EvaluationQualifiers extends EvaluationNode {
    /// When true, all inputs are constants, and this node needs to be evaluated
    /// only once.
    constant: boolean = true;
    prototype: QualifiersFunctionNode;

    /// The qualifiers
    qualifiers: QualifierState[][];
    /// The evaluation nodes that feed into the qualifiers
    qualifierInputs: EvaluationNode[][];

    /// Boolean per variant that indicates whether the qualifiers hold for that
    /// variant. A copy is the result of the evaluation.
    qualifiedVariants: boolean[];

    constructor(prototype: QualifiersFunctionNode, local: EvaluationEnvironment) {
        super(prototype, local);
        var n: number = prototype.qualifiers.length;

        this.qualifiers = new Array(n);
        this.qualifierInputs = new Array(n);
        this.qualifiedVariants = new Array(n);
        this.result.value = constEmptyOS;
        this.dataSourceResultMode = true;
        if ("schedulingError" in prototype) {
            this.inputs = [];
        }
    }

    removeAsWatcher(): void {
        var qualifierInputs: EvaluationNode[][] = this.qualifierInputs;

        if (this.nrActiveWatchers > 0) {
            this.deactivateInputs();
        }
        this.qualifiedVariants = undefined;
        this.qualifierInputs = undefined;
        this.qualifiers = undefined;
        for (var i: number = 0; i !== qualifierInputs.length; i++) {
            if (qualifierInputs[i] !== undefined) {
                for (var j: number = 0; j !== qualifierInputs[i].length; j++) {
                    qualifierInputs[i][j].removeWatcher(this, false, false);
                }
            }
        }
    }

    addQualifiers(pos: number, qualifiers: {value: EvaluationNode; match: any;}[]): void {
        this.qualifierInputs[pos] = [];
        this.qualifiers[pos] = [];
        for (var i: number = 0; i !== qualifiers.length; i++) {
            var n: EvaluationNode = qualifiers[i].value;
            this.qualifierInputs[pos][i] = n;
            switch (typeof(qualifiers[i].match)) {
              case "boolean":
                if (qualifiers[i].match === true) {
                    this.qualifiers[pos][i] = new QualifierStateTrue(n.result.value);
                } else {
                    this.qualifiers[pos][i] = new QualifierStateFalse(n.result.value);
                }
                break;
              case "number":
              case "string":
                this.qualifiers[pos][i] = new QualifierStateSimpleValue(n.result.value, qualifiers[i].match);
                break;
              default:
                if (qualifiers[i].match instanceof MoonRange) {
                    this.qualifiers[pos][i] =
                        new QualifierStateMatchRange(n.result.value, qualifiers[i].match);
                } else if (qualifiers[i].match instanceof MoonOrderedSet) {
                    this.qualifiers[pos][i] =
                        new QualifierStateMatchOS(n.result.value, qualifiers[i].match);
                } else {
                    assert(false, "no implementation");
                    this.qualifiers[pos][i] =
                        new QualifierStateAlwaysFalse(n.result.value);
                }
                break;
            }
            if (!n.isConstant()) {
                this.constant = false;
                n.addWatcher(this, [pos, i], false, true, false);
                if ("schedulingError" in this.prototype) {
                    this.inputs.push(n);
                }
            }
        }
        this.qualifiedVariants[pos] = allQualifiersHold(this.qualifiers[pos]);
        this.markAsChanged();
    }

    updateInput(i: any, result: Result): void {
        if (result !== undefined) {
            var pos: number = i[0];
            var qualifierNr: number = i[1];
            // Remember previous state
            var qualifierHeld: boolean = this.qualifiedVariants[pos];
            // Now set new state and check its new state
            this.qualifiers[pos][qualifierNr].value = result.value;
            var qualifierHolds: boolean = allQualifiersHold(this.qualifiers[pos]);
            if (qualifierHolds !== qualifierHeld) {
                this.qualifiedVariants[pos] = qualifierHolds;
                this.markAsChanged();
            }
        }
    }

    isConstant(): boolean {
        return this.constant;
    }

    eval(): boolean {
        for (var i: number = 0; i < this.qualifiedVariants.length; i++) {
            if (this.result.value[i] !== this.qualifiedVariants[i]) {
                this.result.value = this.qualifiedVariants.slice(0);
                return true;
            }
        }
        return false;
    }

    init(): void {
        if (this.constant) {
            for (var i: number = 0; i !== this.qualifierInputs.length; i++) {
                if (allQualifiersHold(this.qualifiers[i])) {
                    this.inputHasChanged = true;
                    this.qualifiedVariants[i] = true;
                } else {
                    this.qualifiedVariants[i] = false;
                }
            }
            this.eval();
        }
    }

    activateInputs(): void {
        for (var i: number = 0; i !== this.qualifierInputs.length; i++) {
            for (var j: number = 0; j < this.qualifierInputs[i].length; j++) {
                this.qualifierInputs[i][j].activate(this, false);
            }
        }
    }

    deactivateInputs(): void {
        for (var i: number = 0; i !== this.qualifierInputs.length; i++) {
            for (var j: number = 0; j < this.qualifierInputs[i].length; j++) {
                this.qualifierInputs[i][j].deactivate(this, false);
            }
        }
    }

    isQualified(): boolean {
        for (var i: number = 0; i < this.qualifiedVariants.length; i++) {
            if (this.qualifiedVariants[i]) {
                return true;
            }
        }
        return false;
    }

    isReady(): boolean { 
        for (var i: number = 0; i !== this.qualifierInputs.length; i++) {
            var inputs_i: EvaluationNode[] = this.qualifierInputs[i];
            for (var j: number = 0; j < inputs_i.length; j++) {
                if (inputs_i[j].scheduledAtPosition >= 0) {
                    // q[i][j] isn't ready, but that's not a problem if the
                    // qualifiers that are ready make this qualifier false,
                    // so check them first
                    var quals_i: QualifierState[] = this.qualifiers[i];
                    var qualifierState: boolean = true;
                    for (var k: number = 0; qualifierState && k < inputs_i.length; k++) {
                        if (inputs_i[k].scheduledAtPosition < 0) {
                            qualifierState = qualifierState &&
                                quals_i[k].holds();
                        }
                    }
                    if (qualifierState) {
                        // If all ready qualifiers are true, then the value of
                        // qualifier[i][j] needs to be known.
                        return false;
                    } else {
                        // qualifier[i] is known; no need to check further
                        break;
                    }
                }
            }
        }
        return true;
    }

    allInputs(): EvaluationNode[] {
        if (this.inputs === undefined) {
            var allInputs: EvaluationNode[] = [];
            for (var i: number = 0; i !== this.qualifierInputs.length; i++) {
                for (var j: number = 0; j < this.qualifierInputs[i].length; j++) {
                    allInputs.push(this.qualifierInputs[i][j]);
                }
            }
            return allInputs;
        } else {
            return this.inputs;
        }
    }

    debugName(): string {
        return "qualifiers";
    }

    toString(): string {
        return this.prototype.idStr() + "=o(" + this.qualifiedVariants.join(",") + ")";
    }

    toFullString(): string {
        var str: string = "";

        for (var i: number = 0; i !== this.qualifierInputs.length; i++) {
            if (i !== 0) str += " | ";
            var str2: string = "";
            for (var j: number = 0; j !== this.qualifierInputs[i].length; j++) {
                if (j !== 0) str2 += ", ";
                str2 += this.prototype.qualifiers[i][j].toSymString() + // this.qualifierInputs[i][j].toFullString() +
                    (this.qualifiers[i][j].holds()? " == ": " != ") +
                    this.qualifiers[i][j].matchValue();
            }
            str += "{" + str2 + "} => " + this.qualifierInputs[i];
        }
        return str;
    }
}

/* The logic 
   - qualifiedVariants is a copy of the output of the corresponding
     EvaluationQualifiers nodes, and represents the truth of the qualifiers.
   - qualifiedVariants, firstActive and lastActive define the variant nodes
     which are active: all qualified variants in the range [firstActive,
     lastActive[ are active, the rest isn't.
   - firstActive is the first qualified node, lastActive is the first
     unmergeable qualified node.
   - updateActiveVariantRange() performs the incremental update between two
     states.
   - eval() only merges the active nodes' values
   - only create active variant inputs. This halves the number
     of EvaluationNodes.
*/
class EvaluationVariant extends EvaluationNode
    implements CleanUpUnusedEvaluationNodes
{
    /// specialization
    prototype: VariantFunctionNode;

    /// The qualifiers
    qualifiers: EvaluationQualifiers = undefined;

    /// The evaluation nodes that are guarded by the qualifiers
    variantInputs: EvaluationNode[];
    /// The result per input. Note that this points directly at a Result object,
    /// which can change.
    variants: Result[];
    /// Mergeability status per variant
    isVariantUnmergeable: boolean[];
    /// When true, the qualifiers for that variant all match. Copied from
    /// the qualifiers input (which is guaranteed to change).
    qualifiedVariants: boolean[] = undefined;
    /// The position of the first qualified variant; until here, variants are
    /// unqualified and therefore inactive.
    firstActive: number = -1;
    /// The position just after the last variant that is qualified and to be
    /// merged; from here on, all variants are inactive; between firstActive
    /// and here, all qualified variants are active.
    lastActive: number = -1;
    /// Number of qualified variants
    nrQualifiedVariants: number = 0;

    /// List of variants that were merged the last time.
    prevMerged: number[] = [];
    /// Set of changes per variant input
    variantChange: {[watcherId: number]: boolean} = {};

    constructor(prototype: VariantFunctionNode, local: EvaluationEnvironment) {
        super(prototype, local);
        var n: number = prototype.functionNodes.length;

        this.variantInputs = new Array(n);
        this.qualifiedVariants = undefined;
        this.variants = new Array(n);
        this.isVariantUnmergeable = new Array(n);
        this.dataSourceResultMode = true;
        if ("schedulingError" in prototype) {
            this.inputs = new Array(n + 1);
        }
    }

    removeAsWatcher(): void {
        var variantInputs: EvaluationNode[] = this.variantInputs;

        this.qualifiers.removeWatcher(this, false, undefined);
        if (this.nrActiveWatchers > 0) {
            this.deactivateInputs();
        }
        this.qualifiedVariants = undefined;
        this.variantInputs = undefined;
        this.qualifiers = undefined;
        this.variants = undefined;
        for (var i: number = 0; i !== variantInputs.length; i++) {
            if (variantInputs[i] !== undefined) {
                variantInputs[i].removeWatcher(this, false, undefined);
            }
        }
    }

    addQualifiers(qualifiers: EvaluationQualifiers): void {
        this.qualifiers = qualifiers;
        this.qualifiedVariants = qualifiers.result.value;
        if (!qualifiers.isConstant()) {
            qualifiers.addWatcher(this, -1, false, false, false);
            if ("schedulingError" in this.prototype) {
                this.inputs[0] = qualifiers;
            }
        }
    }

    addVariant(pos: number, evalNode: EvaluationNode): void {
        this.variantInputs[pos] = evalNode;
        this.variants[pos] = evalNode.result;
        this.isVariantUnmergeable[pos] =
            (evalNode.result.anonymize || evalNode.result.identifiers === undefined) &&
            !evalNode.result.isPush() &&
            (evalNode.result.isAtomic() || isUnmergeable(evalNode.result.value));
        if (!evalNode.isConstant()) {
            evalNode.addWatcher(this, pos, false, false, this.dataSourceResultMode);
        }
    }

    // i == -1 means qualifier change, 0 .. n - 1 variant input change
    updateInput(i: any, result: Result): void {
        var checkDeferred: boolean = false;

        if (result === undefined) {
            return;
        }
        if (i >= 0) {
            var wasUnmergeable = this.isVariantUnmergeable[i];
            this.variants[i] = result;
            this.variantChange[this.variantInputs[i].watcherId] = true;
            this.isVariantUnmergeable[i] = result !== undefined &&
                ((result.isAtomic() && !result.isPush()) || isUnmergeable(result.value));
            if (this.qualifiedVariants[i]) {
                if (wasUnmergeable && !this.isVariantUnmergeable[i] &&
                      this.lastActive === i + 1) {
                    // Another variant might become the new lastActive
                    var lastActive: number = this.lastActive;
                    for (var pos: number = lastActive; pos < this.qualifiedVariants.length; pos++) {
                        if (this.qualifiedVariants[pos]) {
                            lastActive = pos + 1;
                            if (this.isVariantUnmergeable[pos]) {
                                break;
                            }
                        }
                    }
                    checkDeferred = this.updateActiveVariantRange(
                        this.qualifiedVariants, this.firstActive, lastActive);
                    this.markAsChanged();
                } else if (!wasUnmergeable && this.isVariantUnmergeable[i] &&
                           this.lastActive > i + 1) {
                    checkDeferred = this.updateActiveVariantRange(
                        this.qualifiedVariants, this.firstActive, i + 1);
                    this.markAsChanged();
                } else if (this.isActiveVariant(i)) {
                    this.markAsChanged();
                }
            }
        } else if (this.nrActiveWatchers > 0) {
            var qualifiedVariants: boolean [] = result.value;
            var firstActive: number = -1, lastActive: number = -1;
            for (var pos: number = 0; pos < qualifiedVariants.length; pos++) {
                if (qualifiedVariants[pos]) {
                    if (firstActive === -1) {
                        firstActive = pos;
                    }
                    lastActive = pos + 1;
                    if (this.isVariantUnmergeable[pos]) {
                        break;
                    }
                }
            }
            checkDeferred = this.updateActiveVariantRange(qualifiedVariants,
                                                       firstActive, lastActive);
        } else {
            this.qualifiedVariants = result.value;
            this.markAsChanged(); // note: in a few cases, the qualifier might revert back before this node is activated
        }
        // If any of the variant inputs has been de-qualified, we need to
        // check if it's time to get back on the queue, since nobody else
        // will do it for us.
        if (checkDeferred && this.deferred && this.isReady()) {
            this.undefer();
        }
    }

    isDeferableInput(pos: any, input: EvaluationNode): boolean {
        return pos === -1 || this.isActiveVariant(pos);
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.isActive()) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                for (var i: number = this.firstActive; i < this.lastActive; i++) {
                    if (this.qualifiedVariants[i]) {
                        this.variantInputs[i].
                            activeWatcherBecomesDataSourceAware(this);
                    }
                }
                this.markAsChanged();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                for (var i: number = this.firstActive; i < this.lastActive; i++) {
                    if (this.qualifiedVariants[i]) {
                        this.variantInputs[i].
                            activeWatcherNoLongerIsDataSourceAware(this);
                    }
                }
                this.markAsChanged();
            }
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    isActiveVariant(i: number): boolean {
        return this.qualifiedVariants[i] &&
               this.firstActive <= i && i < this.lastActive;
    }

    /// Sets all variants to inactive and marks the active range as empty
    clearActiveVariantRange(): void {
        for (var i: number = this.firstActive; i < this.lastActive; i++) {
            if (this.qualifiedVariants[i]) {
                this.deactivateVariant(i);
            }
        }
        this.firstActive = -1;
        this.lastActive = -1;
        this.nrQualifiedVariants = 0;
    }

    // Replaces the three members and (de)actives variants according to the
    // difference with the current state. Only call when active. Steps:
    // - deactivate old range minus new range using current qualifiedVariants
    // - activate new range minus old range using new qualifiedVariants
    // - switch variants in common range using different between old and new
    //   qualifiedVariants
    // - note: first activate, then deactivate helps in case there is an overlap
    updateActiveVariantRange(qualifiedVariants: boolean[], firstActive: number, lastActive: number): boolean {
        var firstCommon: number = Math.max(this.firstActive, firstActive);
        var lastCommon: number = Math.min(this.lastActive, lastActive);
        var deactivated: boolean = false;
        var activated: boolean = false;

        if (lastCommon <= firstCommon) {
            // this makes writing the loops a bit easier
            firstCommon = lastCommon = qualifiedVariants.length;
        }

        // new - old
        for (var i: number = firstActive; i < lastActive && i < firstCommon; i++) {
            if (qualifiedVariants[i]) {
                this.activateVariant(i);
                activated = true;
            }
        }
        for (var i: number = lastCommon; i < lastActive; i++) {
            if (qualifiedVariants[i]) {
                this.activateVariant(i);
                activated = true;
            }
        }

        // old * new
        for (var i: number = firstCommon; i < lastCommon; i++) {
            if (!this.qualifiedVariants[i] && qualifiedVariants[i]) {
                this.activateVariant(i);
                activated = true;
            }
        }
        // old - new
        for (var i: number = this.firstActive; i < this.lastActive && i < firstCommon; i++) {
            if (this.qualifiedVariants[i]) {
                this.deactivateVariant(i);
                deactivated = true;
            }
        }
        for (var i: number = lastCommon; i < this.lastActive; i++) {
            if (this.qualifiedVariants[i]) {
                this.deactivateVariant(i);
                deactivated = true;
            }
        }

        // old * new
        for (var i: number = firstCommon; i < lastCommon; i++) {
            if (this.qualifiedVariants[i] && !qualifiedVariants[i]) {
                this.deactivateVariant(i);
                deactivated = true;
            }
        }

        this.firstActive = firstActive;
        this.lastActive = lastActive;
        this.qualifiedVariants = qualifiedVariants;

        if (activated || deactivated) {
            this.markAsChanged();
        }

        return deactivated;
    }

    activateVariant(i: number): void {
        if (this.variantInputs[i] === undefined) {
            this.addVariant(i, getEvaluationNode(this.prototype.functionNodes[i], this.local));
        }
        if (!this.variantInputs[i].isConstant()) {
            this.variantInputs[i].activate(this, this.dataSourceResultMode);
            if ("schedulingError" in this.prototype) {
                this.inputs[i + 1] = this.variantInputs[i];
            }
        }
        this.nrQualifiedVariants++;
    }

    deactivateVariant(i: number): void {
        this.variantInputs[i].deactivate(this, this.dataSourceResultMode);
        if ("schedulingError" in this.prototype) {
            this.inputs[i + 1] = undefined;
        }
        this.nrQualifiedVariants--;
    }

    isConstant(): boolean {
        return false;
    }

    eval(): boolean {
        var oldValue: any[] = this.result.value;
        var oldDatasource: DataSourceComposable = this.result.dataSource;
        var mergeResult: any[] = undefined;
        var nrMerges: number = 0;
        var firstResult: Result = undefined;
        var variantsToMerge: number[] = [];
        var change: boolean = false;
        var resultIsDataSource: boolean = false;

        // First test if the input has really changed. We determine the sequence
        // of expressions to be merged. If that differs from the previous time,
        // or one of the input expression has changed since then, we declare it
        // a change.
        for (var i: number = this.firstActive; i < this.lastActive; i++) {
            if (this.qualifiedVariants[i] &&
                  this.variants[i].value !== undefined) {
                var vwid: number = this.variantInputs[i].watcherId;
                if (vwid in this.variantChange ||
                      this.prevMerged[variantsToMerge.length] !== vwid) {
                    change = true;
                }
                variantsToMerge.push(vwid);
                nrMerges++;
                if (nrMerges === 1) {
                    if ("dataSource" in this.variants[i]) {
                        resultIsDataSource = true;
                    }
                } else {
                    resultIsDataSource = false;
                }
                if (this.isVariantUnmergeable[i]) {
                    break;
                }
            }
        }
        if (variantsToMerge.length !== this.prevMerged.length) {
            change = true;
        }
        if (!change) {
            return false;
        }
        this.prevMerged = variantsToMerge;
        if (resultIsDataSource && this.dataSourceResultMode) {
            for (var i: number = this.firstActive; i < this.lastActive; i++) {
                if (this.qualifiedVariants[i] &&
                    this.variants[i].value !== undefined) {
                    if (firstResult === undefined) {
                        firstResult = this.variants[i];
                        break;
                    }
                }
            }
            if (!objectEqual(this.result.value, firstResult.value) ||
                  !this.result.equalLabels(firstResult)) {
                this.result.copy(firstResult);
                return true;
            }
            return false;
        } else {
            mergeVariants(this.variants, this.qualifiedVariants,
                          this.isVariantUnmergeable,
                          this.firstActive, this.lastActive, false,
                          this.result);
            this.variantChange = {};
            return this.result.dataSource !== oldDatasource ||
                   !objectEqual(oldValue, this.result.value);
        }
    }

    activateInputs(): void {
        this.qualifiers.activate(this, false);
        if (this.qualifiers.isScheduled()) {
            // Wait for (forced) update and delay activation of variants
            this.qualifiers.addForcedUpdate(this);
        } else {
            // Determine active range and activate variants
            this.updateInput(-1, this.qualifiers.result);
            if (!this.inputHasChanged) {
                this.markAsChanged();
            }
        }
    }

    deactivateInputs(): void {
        if (this.qualifiers !== undefined) {
            this.clearActiveVariantRange();
            this.qualifiers.deactivate(this, false);
            this.nrQualifiedVariants = 0;
        }
    }
    
    // Writes to the first matching qualifier, assuming it implements writing.
    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (0 <= this.firstActive && this.firstActive < this.variantInputs.length) {
            return this.variantInputs[this.firstActive].write(result, mode, positions, reportDeadEnd);
        } else {
            this.reportDeadEndWrite(reportDeadEnd, "no qualified variant");
            return false;
        }
    }

    isQualified(): boolean {
        return 0 <= this.firstActive &&
               this.firstActive < this.variantInputs.length;
    }

    getFirstActiveVariantInput(): EvaluationNode {
        for(var i = this.firstActive ; i < this.lastActive ; ++i) {
            if(this.qualifiedVariants[i] &&
               this.variantInputs[i])
                return this.variantInputs[i];
        }
        return undefined;
    }
    
    debugName(): string {
        return "variant";
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        var q: any;
        var prototype = <QualifiersFunctionNode> this.qualifiers.prototype;

        super.specificExplanation(explanation, classDebugInfo, true);
        for (var i: number = 0; i !== this.variants.length; i++) {
            var variantInd: string = String(i) + ": " + String(this.qualifiedVariants[i]);
            explanation[variantInd] = {};
            if (this.qualifiers.qualifierInputs[i].length === 0) {
                q = explanation[variantInd]["qualifier"] = "default";
            } else {
                q = explanation[variantInd]["qualifier"] = {};
                for (var j: number = 0; j !== this.qualifiers.qualifierInputs[i].length; j++) {
                    var qualInd: string;
                    if (prototype.qualifiers[i][j].attribute !== undefined) {
                        qualInd = prototype.qualifiers[i][j].attribute + "@" +
                            prototype.qualifiers[i][j].localToArea;
                    } else {
                        qualInd = String(j);
                    }
                    q[qualInd + (this.qualifiers.qualifiers[i][j].holds()? " == ": " != ") +
                      this.qualifiers.qualifiers[i][j].matchValue() + ": " +
                      this.qualifiers.qualifierInputs[i][j].debugName()] =
                        this.qualifiers.qualifierInputs[i][j].explain(undefined);
                }
            }
            if (this.variantInputs[i] !== undefined) {
                explanation[variantInd]["variant: " + this.variantInputs[i].debugName()] =
                    this.variantInputs[i].explain(undefined);
            }
            if (classDebugInfo !== undefined && "values" in classDebugInfo &&
                  this.variantInputs[i] !== undefined) {
                // There can only be one definition active; other classes might
                // have been deactivated, though.
                explanation[variantInd]["variant: " + this.variantInputs[i].debugName()]._definedIn =
                    getClassPath(classDebugInfo.values[0]);
            }
        }        
        return explanation;
    }

    toString(): string {
        var str: string = "";

        for (var i: number = 0; i !== this.variants.length; i++) {
            if (i !== 0) str += " | ";
            str += this.qualifiedVariants[i] + " => " +
                   (this.variantInputs[i] === undefined? "undefined" :
                    cdlifyLim(this.variantInputs[i].result.value, 80));
        }
        return this.prototype.idStr() + "=" + str;
    }

    toFullString(): string {
        var str: string = "";

        for (var i: number = 0; i !== this.variants.length; i++) {
            if (i !== 0) str += " | ";
            var str2: string = "";
            for (var j: number = 0; j !== this.qualifiers.qualifierInputs[i].length; j++) {
                if (j !== 0) str2 += ", ";
                str2 += (<QualifiersFunctionNode>this.qualifiers.prototype).qualifiers[i][j].toSymString() + // this.qualifierInputs[i][j].toFullString() +
                    (this.qualifiers.qualifiers[i][j].holds()? " == ": " != ") +
                    this.qualifiers.qualifiers[i][j].matchValue();
            }
            str += "{" + str2 + "} => " +
                   (this.variantInputs[i] === undefined? "undefined":
                    this.variantInputs[i].toFullString());
        }
        return str;
    }

    // querySourceId(): number {
    //     var firstMerge: EvaluationNode = undefined;

    //     for (var i: number = 0; i < this.variants.length; i++) {
    //         if (this.qualifiedVariants[i] &&
    //               this.variants[i].value !== undefined) {
    //             if (firstMerge === undefined) {
    //                 firstMerge = this.variantInputs[i];
    //                 if (this.isVariantUnmergeable[i]) {
    //                     break;
    //                 }
    //             } else {
    //                 return this.watcherId;
    //             }
    //         }
    //     }
    //     return firstMerge === undefined? this.watcherId:
    //            firstMerge.querySourceId(this);
    // }

    multiQuerySourceIds(): number[] {
        var firstMerge: EvaluationNode = undefined;

        for (var i: number = 0; i < this.variants.length; i++) {
            if (this.qualifiedVariants[i] &&
                  this.variants[i].value !== undefined) {
                if (firstMerge === undefined) {
                    firstMerge = this.variantInputs[i];
                    if (this.isVariantUnmergeable[i]) {
                        break;
                    }
                } else {
                    return [this.watcherId];
                }
            }
        }
        return firstMerge === undefined? []: firstMerge.multiQuerySourceIds();
    }

    removeWatcherFromInactiveNodes(): void {
        for (var i: number = 0; i !== this.variantInputs.length; i++) {
            if (this.variantInputs[i] !== undefined &&
                  !this.isActiveVariant(i) &&
                  !this.variantInputs[i].isConstant()) {
                this.variantInputs[i].removeWatcherForPos(this, i, false, undefined);
                this.variantInputs[i] = undefined;
                this.variants[i] = undefined;
            }
        }
    }
}

class EvaluationVariant1 extends EvaluationNode
    implements CleanUpUnusedEvaluationNodes
{
    /// specialization
    prototype: VariantFunctionNode;

    /// The qualifiers
    qualifiers: EvaluationQualifiers = undefined;

    /// The single evaluation node that is guarded by the qualifiers
    variantInput: EvaluationNode = undefined;
    /// The result of the variant input.
    variant: Result = undefined;
    /// When true, the qualifiers for one of the variants match.
    qualifiedVariant: boolean = undefined;
    /// Change of variant input
    variantChange: boolean = false;

    constructor(prototype: VariantFunctionNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.dataSourceResultMode = true;
        if ("schedulingError" in prototype) {
            this.inputs = [];
        }
    }

    removeAsWatcher(): void {
        this.qualifiers.removeWatcher(this, false, undefined);
        if (this.nrActiveWatchers > 0) {
            this.deactivateInputs();
        }
        if (this.variantInput !== undefined) {
            this.variantInput.removeWatcher(this, false, undefined);
            this.variantInput = undefined;
        }
        this.qualifiers = undefined;
        this.variant = undefined;
    }

    addQualifiers(qualifiers: EvaluationQualifiers): void {
        this.qualifiers = qualifiers;
        this.qualifiedVariant = false;
        if (!qualifiers.isConstant()) {
            qualifiers.addWatcher(this, -1, false, false, false);
            if ("schedulingError" in this.prototype) {
                this.inputs.push(qualifiers);
            }
        }
    }

    addVariant(evalNode: EvaluationNode): void {
        this.variantInput = evalNode;
        this.variant = evalNode.result;
        if (!evalNode.isConstant()) {
            evalNode.addWatcher(this, 0, false, false, true);
        }
    }

    // i == -1 means qualifier change, 0 variant input change
    updateInput(i: any, result: Result): void {
        var checkDeferred: boolean = false;

        if (result === undefined) {
            return;
        }
        if (i === 0) {
            this.variant = result;
            this.markAsChanged();
        } else {
            var isQualified: boolean = result.value.some(isTrue);
            checkDeferred = this.updateQualified(isQualified);
        }
        // If any of the variant inputs has been de-qualified, we need to
        // check if it's time to get back on the queue, since nobody else
        // will do it for us.
        if (checkDeferred && this.deferred && this.isReady()) {
            this.undefer();
        }
    }

    isDeferableInput(pos: any, input: EvaluationNode): boolean {
        return pos === -1 || this.qualifiedVariant;
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.isActive()) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                if (this.qualifiedVariant) {
                    this.variantInput.activeWatcherBecomesDataSourceAware(this);
                }
                this.markAsChanged();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                if (this.qualifiedVariant) {
                    this.variantInput.activeWatcherNoLongerIsDataSourceAware(this);
                }
                this.markAsChanged();
            }
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    updateQualified(isQualified: boolean): boolean {
        var deactivated: boolean = false;

        if (isQualified !== this.qualifiedVariant) {
            if (this.nrActiveWatchers > 0) {
                if (isQualified) {
                    this.activateVariant();
                } else if (this.qualifiedVariant !== undefined) {
                    this.deactivateVariant();
                    deactivated = true;
                }
                this.qualifiedVariant = isQualified;
            }
            this.markAsChanged();
        }
        return deactivated;
    }

    activateVariant(): void {
        if (this.variantInput === undefined) {
            this.addVariant(getEvaluationNode(this.prototype.functionNodes[0], this.local));
        }
        this.variantInput.activate(this, this.dataSourceResultMode);
        if (this.variantInput.isScheduled()) {
            this.variantInput.addForcedUpdate(this);
        }
        if ("schedulingError" in this.prototype && !this.variantInput.isConstant()) {
            this.inputs.push(this.variantInput);
        }
    }

    deactivateVariant(): void {
        this.variantInput.deactivate(this, this.dataSourceResultMode);
        if ("schedulingError" in this.prototype && !this.variantInput.isConstant()) {
            this.inputs.pop();
        }
    }

    isConstant(): boolean {
        return false;
    }

    eval(): boolean {
        if (this.qualifiedVariant) {
            if (!objectEqual(this.result.value, this.variant.value) ||
                !this.result.equalLabels(this.variant)) {
                this.result.copy(this.variant);
                return true;
            }
        } else {
            if (this.result.value !== undefined || this.result.hasLabels()) {
                this.result.set(undefined);
                return true;
            }
        }
        return false;
    }

    activateInputs(): void {
        this.qualifiers.activate(this, false);
        if (this.qualifiers.isScheduled()) {
            // Wait for (forced) update and delay activation of variants
            this.qualifiers.addForcedUpdate(this);
        } else {
            // Determine active range and activate variants
            this.updateInput(-1, this.qualifiers.result);
            if (!this.inputHasChanged) {
                this.markAsChanged();
            }
        }
    }

    deactivateInputs(): void {
        if (this.qualifiers !== undefined) {
            if (this.qualifiedVariant) {
                this.deactivateVariant();
                this.qualifiedVariant = undefined; // Note: behaves like false, but is not === equal in this.updateQualified()
            }
            this.qualifiers.deactivate(this, false);
        }
    }
    
    // Writes to the first matching qualifier, assuming it implements writing...
    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (this.qualifiedVariant) {
            return this.variantInput.write(result, mode, positions, reportDeadEnd);
        } else {
            this.reportDeadEndWrite(reportDeadEnd, "no qualified variant");
            return false;
        }
    }

    isQualified(): boolean {
        return this.qualifiedVariant;
    }

    getFirstActiveVariantInput(): EvaluationNode {
        if(!this.qualifiedVariant)
            return undefined;
        return this.variantInput;
    }
    
    debugName(): string {
        return "variant1";
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        var q: any;
        var prototype = <QualifiersFunctionNode> this.qualifiers.prototype;

        super.specificExplanation(explanation, classDebugInfo, true);
         for (var i: number = 0; i !== this.qualifiers.qualifiers.length; i++) {
            var variantInd: string = String(i) + ": " + String(this.qualifiers.qualifiedVariants[i]);
            explanation[variantInd] = {};
            if (this.qualifiers.qualifierInputs[i].length === 0) {
                q = explanation[variantInd]["qualifier"] = "default";
            } else {
                q = explanation[variantInd]["qualifier"] = {};
                for (var j: number = 0; j !== this.qualifiers.qualifierInputs[i].length; j++) {
                    var qualInd: string;
                    if (prototype.qualifiers[i][j].attribute !== undefined) {
                        qualInd = prototype.qualifiers[i][j].attribute + "@" +
                            prototype.qualifiers[i][j].localToArea;
                    } else {
                        qualInd = String(j);
                    }
                    q[qualInd + (this.qualifiers.qualifiers[i][j].holds()? " == ": " != ") +
                      this.qualifiers.qualifiers[i][j].matchValue() + ": " +
                      this.qualifiers.qualifierInputs[i][j].debugName()] =
                        this.qualifiers.qualifierInputs[i][j].explain(undefined);
                }
            }
            if (this.variantInput !== undefined) {
                explanation[variantInd]["variant: " + this.variantInput.debugName()] =
                    this.variantInput.explain(undefined);
            }
            if (classDebugInfo !== undefined && "values" in classDebugInfo &&
                  this.variantInput !== undefined) {
                // There can only be one definition active; other classes might
                // have been deactivated, though.
                explanation[variantInd]["variant: " + this.variantInput.debugName()]._definedIn =
                    getClassPath(classDebugInfo.values[0]);
            }
        }        
        return explanation;
    }

    toString(): string {
        var str: string = this.qualifiedVariant + " => " +
            (this.variantInput === undefined? "undefined":
             cdlifyLim(this.variantInput.result.value, 80));

        return this.prototype.idStr() + "=" + str;
    }

    toFullString(): string {
        var str: string = "";

        for (var i: number = 0; i !== this.qualifiers.qualifiers.length; i++) {
            if (i !== 0) str += " ~ ";
            var str2: string = "";
            for (var j: number = 0; j !== this.qualifiers.qualifierInputs[i].length; j++) {
                if (j !== 0) str2 += ", ";
                str2 += (<QualifiersFunctionNode>this.qualifiers.prototype).qualifiers[i][j].toSymString() + // this.qualifierInputs[i][j].toFullString() +
                    (this.qualifiers.qualifiers[i][j].holds()? " == ": " != ") +
                    this.qualifiers.qualifiers[i][j].matchValue();
            }
            str += "{" + str2 + "}";
        }
        return str + " => " + this.variantInput.toFullString();
    }

    removeWatcherFromInactiveNodes(): void {
        if (!this.qualifiedVariant && this.variantInput !== undefined &&
              !this.variantInput.isConstant()) {
            this.variantInput.removeWatcher(this, false, undefined);
            this.variantInput = undefined;
        }
    }

    allLogInputs(): EvaluationNode[] {
        return this.variantInput === undefined? [this.qualifiers]:
               [this.qualifiers, this.variantInput];
    }
}
