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

class EvaluationConst extends EvaluationNode {
    watchers: WatcherMap = undefined;

    constructor(prototype: ConstNode) {
        super(prototype, undefined);
        this.result.copyConst(prototype);
    }

    eval(): boolean {
        return false;
    }

    updateInput(): void {
    }

    updateOutput(): void {
    }

    activate(src: Watcher): void {
    }

    deactivate(src: Watcher): void {
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
    }

    activeWatcherBecomesDataSourceAware(watcher: Watcher): void {
    }

    activeWatcherNoLongerIsDataSourceAware(watcher: Watcher): void {
    }

    isConstant(): boolean {
        return true;
    }

    debugName(): string {
        return "constant";
    }

    toFullString(): string {
        return cdlifyLim(this.result.value, 80);
    }

    addForcedUpdate(watcher: Watcher): void {
    }
    
    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        function unwrapDebugInfo(debugInfo: AreaTemplateDebugInfo): any {
            var di: any;
            if (debugInfo.values !== undefined) {
                di = stripArray(debugInfo.values.map(getClassPath));
            } else if ("next" in debugInfo) {
                di = {};
                for (var attr in debugInfo.next) {
                    di[attr] = unwrapDebugInfo(debugInfo.next[attr]);
                }
            }
            return di;
        }
        super.specificExplanation(explanation, classDebugInfo, true);
        if (classDebugInfo !== undefined && !("values" in classDebugInfo)) {
            // Unwrap the inherit info here; some of the info might be available
            explanation._definedIn = unwrapDebugInfo(classDebugInfo);
        }
    }
}

class EvaluationOrderedSet extends EvaluationNode {
    constant: boolean = true;
    elements: Result[]; // When undefined, consider node destroyed

    constructor(prototype: OrderedSetNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.inputs = new Array(prototype.values.length);
        this.elements = new Array(prototype.values.length);
        this.result.value = constEmptyOS;
    }

    addElement(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.elements[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, false, true, false);
        }
    }

    updateInput(i: any, result: Result): void {
        if (this.elements !== undefined) {
            this.elements[i] = result;
            if (result === undefined) {
                this.elements = undefined;
                if (this.isActive()) {
                    super.deactivateInputs();
                }
            } else {
                this.markAsChanged();
            }
        }
    }

    isConstant(): boolean {
        return this.constant;
    }

    eval(): boolean {
        var oldValue: any[] = this.result.value;

        function isIdentified(r: Result): boolean {
            return r.identifiers !== undefined;
        }

        var singleNonEmpty: Result;
        
        if (this.elements === undefined) {
            this.result.value = constEmptyOS;
        } else if (singleNonEmpty = this.singleNonEmptyElement()) {
            var resultLabels: any = this.result.getLabels();
            this.result.copy(singleNonEmpty);
            if (this.result.value === undefined) {
                this.result.value = constEmptyOS;
            }
            return !this.result.equalLabels(resultLabels) ||
                   !valueEqual(oldValue, this.result.value);
        } else {
            var id: boolean = false;
            this.result.value = [];
            if (this.elements.some(isIdentified)) {
                this.result.identifiers = [];
                id = true;
            } else {
                delete this.result.identifiers;
            }
            if(this.result.mergeAttributes !== undefined)
                this.result.mergeAttributes = undefined;
            for (var i: number = 0; i !== this.elements.length; i++) {
                if (this.elements[i].value === undefined)
                    continue;
                var mergeAttributes: MergeAttributes[] =
                    this.elements[i].mergeAttributes;
                if(mergeAttributes && !this.result.mergeAttributes) {
                    this.result.mergeAttributes = [];
                    this.result.mergeAttributes.length =
                        this.result.value.length;
                }
                
                this.result.value = cconcat(this.result.value,
                                            this.elements[i].value);
                if (id) {
                    // add identifiers; fill up if there aren't;
                    this.result.identifiers = cconcat(
                        this.result.identifiers,
                        this.elements[i].getIdentifiers());
                }
                
                // since there are at least two non-empty elements in the
                // ordered set (see above), the merge attributes are per value
                // element (apply only when merging with identities)

                if(mergeAttributes) {
                    if(!(this.elements[i].value instanceof Array))
                        this.result.mergeAttributes.push(mergeAttributes[0]);
                    else {
                        var valueLen: number = this.elements[i].value.length;
                        if(mergeAttributes.length == 1) {
                            for(var j: number = 0 ; j < valueLen ; ++j)
                                this.result.mergeAttributes.push(mergeAttributes[0]);
                        } else
                            for(var j: number = 0 ; j < valueLen ; ++j)
                                this.result.mergeAttributes.push(mergeAttributes[j]);
                    }
                } else if(this.result.mergeAttributes)
                    this.result.mergeAttributes.length = this.result.value.length;
            }
        }
        return !valueEqual(oldValue, this.result.value);
    }

    // Returns the non-empty element if there is a single such element,
    // or the first element if all elements are empty. Returns undefined
    // if there is more than one non-empty element.
    singleNonEmptyElement(): Result {
        if(this.elements.length === 1)
            return this.elements[0];
        var singleNonEmpty: Result = undefined;
        for(var i = 0, l = this.elements.length ; i < l ; ++i) {
            if(this.elements[i].isEmpty())
                continue;
            if(singleNonEmpty === undefined)
                singleNonEmpty = this.elements[i];
            else
                return undefined;
        }
        if(singleNonEmpty === undefined) // all empty
            return this.elements[0];
        
        return singleNonEmpty;
    }
    
    activateInputs(): void {
        if (this.elements !== undefined) {
            super.activateInputs();
        }
    }

    deactivateInputs(): void {
        if (this.elements !== undefined) {
            super.deactivateInputs();
        }
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (this.constant) {
            Utilities.warn("dead ended write: writing to constant os at " + gWriteAction);
            return false;
        }
        var success: boolean = false;
        if (positions === undefined) {
            for (var i: number = 0; i < this.elements.length; i++) {
                if (this.inputs[i] !== undefined) {
                    if(this.inputs[i].write(result, mode, attributes, undefined,
                                            false))
                        success = true;
                }
            }
        } else if(positions.length == 1 && positions[0].index == 0 &&
                  positions[0].length == 0) {
            // this is a write through an unmatched query, so we append at
            // the end.
            for (var i: number = this.elements.length - 1; i >= 0 ; --i) {
                if (this.inputs[i] !== undefined &&
                    this.inputs[i].write(result, mode, attributes, positions,
                                         reportDeadEnd))
                    return true;
            }
            // fall through to dead-end message below
        } else {
            var accumLength: number = 0;
            var pos: number = 0;
            for (var i: number = 0;
                 i < this.elements.length && pos < positions.length;
                 i++) {
                var v: any[] = this.elements[i].value;
                var vlen: number = v === undefined? 0: v.length;
                if (accumLength <= positions[pos].index &&
                    positions[pos].index < accumLength + vlen) {
                    var elementDataPosition: DataPosition[] = [];
                    while (pos < positions.length  &&
                           positions[pos].index < accumLength + vlen) {
                        var dp: DataPosition = positions[pos];
                        elementDataPosition.push(dp.copyWithOffset(accumLength));
                        pos++;
                    }
                    if (this.inputs[i] !== undefined) {
                        if(this.inputs[i].write(result, mode, attributes, elementDataPosition, reportDeadEnd))
                            success = true;
                    }
                }
                accumLength += vlen;
            }
            if(pos < positions.length)
                this.reportDeadEndWrite(reportDeadEnd, "writing outside os");
        }

        if(!success)
            this.reportDeadEndWrite(reportDeadEnd,
                                    "cannot write through any os element");
        return success;
    }    

    debugName(): string {
        return "orderedSet";
    }

    // An ordered set is its own querySourceId, but its elements form the
    // multiQuerySourceIds.
    multiQuerySourceIds(): number[] {
        var ids: number[] = [];

        for (var i: number = 0; i < this.inputs.length; i++) {
            if (this.elements[i].value !== undefined &&
                  !(this.elements[i].value instanceof Array &&
                    this.elements[i].value.length === 0)) {
                ids = cconcat(ids, this.inputs[i].multiQuerySourceIds());
            }
        }
        return ids;
    }
}

class EvaluationRange extends EvaluationOrderedSet {
    prototype: RangeNode;

    eval(): boolean {
        var oldValue: any[] = this.result.value;
        var rangeElts: any[] = [];

        for (var i: number = 0; i !== this.elements.length; i++) {
            var v: any[] = this.elements[i].value;
            if (v !== undefined) {
                if (!(v instanceof Array)) {
                    rangeElts.push(v);
                } else if (v.length === 1) {
                    rangeElts.push(v[0]);
                } else if (v.length > 1) {
                    Array.prototype.push.apply(rangeElts, v);
                }
            }
        }
        this.result.value = [
            new RangeValue(rangeElts, this.prototype.closedLower, this.prototype.closedUpper)
        ];
        return !valueEqual(oldValue, this.result.value);
    }

    debugName(): string {
        return "range";
    }
}

class EvaluationNegation extends EvaluationNode {
    constant: boolean = true;
    queries: Result[];

    constructor(prototype: NegationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.inputs = new Array(prototype.queries.length);
        this.queries = new Array(prototype.queries.length);
        this.result.value = constEmptyOS;
        this.dataSourceAware = false;
    }

    addElement(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.queries[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, false, true, false);
        }
    }

    updateInput(i: any, result: Result): void {
        this.queries[i] = result;
        this.markAsChanged();
    }

    isConstant(): boolean {
        return this.constant;
    }

    eval(): boolean {
        var oldValue: any = this.result.value;
        var queries: any[] = [];
        var res: any;
        
        for (var i: number = 0; i !== this.queries.length; i++) {
            if (this.queries[i].value !== undefined) {
                queries = cconcat(queries, this.queries[i].value);
            }
        }
        res = [new Negation(queries)];
        if (!valueEqual(oldValue, res)) {
            this.result.value = res;
            return true;
        }
        return false;
    }

    debugName(): string {
        return "negation";
    }
}

class EvaluationSubStringQuery extends EvaluationOrderedSet {
    eval(): boolean {
        var oldValue: any[] = this.result.value;
        var elts: any[] = [];

        for (var i: number = 0; i !== this.elements.length; i++) {
            if (this.elements[i].value !== undefined) {
                Array.prototype.push.apply(elts, this.elements[i].value);
            }
        }
        this.result.value = [new SubStringQuery(elts)];
        return !valueEqual(oldValue, this.result.value);
    }

    debugName(): string {
        return "subStringQuery";
    }
}

class EvaluationComparisonFunction extends EvaluationOrderedSet {
    eval(): boolean {
        var oldValue: any[] = this.result.value;
        var elts: any[] = [];

        for (var i: number = 0; i !== this.elements.length; i++) {
            if (this.elements[i].value !== undefined) {
                elts.push(this.elements[i].value);
            }
        }
        this.result.value = [new ComparisonFunctionValue(elts)];
        return !valueEqual(oldValue, this.result.value);
    }

    debugName(): string {
        return "comparisonFunction";
    }

    // An comparison function is a single multi query source id
    multiQuerySourceIds(): number[] {
        return [this.watcherId];
    }
}

class EvaluationCompiledFunction extends EvaluationNode {
    constant: boolean;
    compiledFunction: (v: any, args: any[]) => any;
    arguments: SimpleQuery[][] = [];
    dataRepresentation: EvaluationNode;

    constructor(prototype: CompiledFunctionNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.compiledFunction = prototype.compiledFunction;
        this.result.compiledQuery = [prototype.compiledFunction];
        this.result.queryArguments = this.arguments;
        this.result.nrQueryElements = [0];
        if (prototype.writePaths !== undefined) {
            this.result.writePaths = prototype.writePaths;
        }
        this.constant = true;
    }

    setDataRepresentation(dataRepresentation: EvaluationNode): void {
        if (dataRepresentation !== undefined) {
            this.dataRepresentation = dataRepresentation;
            this.result.value = dataRepresentation.result.value;
            this.result.nrQueryElements = [dataRepresentation.result.size()];
            if (!dataRepresentation.isConstant()) {
                this.constant = false;
                dataRepresentation.addWatcher(this, undefined, false, true, false);
            }
        }
    }

    removeAsWatcher(): void {
        if (this.dataRepresentation !== undefined) {
            this.dataRepresentation.removeWatcher(this, true, false);
        }
        super.removeAsWatcher();
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        if (this.inputs === undefined) {
            this.inputs = [];
            this.arguments[0] = [];
        }
        this.inputs[i] = evalNode;
        this.arguments[0][i] = makeSimpleQueryWithId(evalNode.result.value,
                                                   evalNode.result.identifiers);
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, false, true, false);
        }
    }

    isConstant(): boolean {
        return this.constant;
    }

    updateInput(i: any, result: Result): void {
        if (i === undefined) {
            this.result.value = result.value;
            this.result.nrQueryElements = [result.size()];
        } else {
            this.arguments[0][i] = 
                makeSimpleQueryWithId(result.value, result.identifiers);
        }
        this.markAsChanged();
    }

    activateInputs(): void {
        if ("dataRepresentation" in this) {
            this.dataRepresentation.activate(this, false);
        }
        super.activateInputs();
    }

    deactivateInputs(): void {
        if ("dataRepresentation" in this) {
            this.dataRepresentation.deactivate(this, false);
        }
        super.deactivateInputs();
    }

    allInputs(): EvaluationNode[] {
        return this.dataRepresentation === undefined? this.inputs:
            this.inputs !== undefined? this.inputs.concat(this.dataRepresentation):
            [];
    }

    debugName(): string {
        var c = <CompiledFunctionNode> this.prototype;

        return c.name;
    }

    eval(): boolean {
        return true;
    }

    // Returns the compiled function's queryStr object as a runtime object
    // without the projections.
    getSelectionObject(): any {
        var q = (<any>this.compiledFunction).queryStr;
        var inputs = this.inputs;

        function filterSelection(q: any): any {
            if (typeof(q) !== "object") {
                return q;
            } else if (q instanceof RuntimeArgument) {
                return inputs[q.index].result.value;
            } else if (q === _ || q instanceof Array) {
                // there are not supposed to be arrays
                return undefined;
            } else if (q instanceof NonAV) {
                return q;
            } else if (q instanceof MoonOrderedSet) {
                return q.os.map(filterSelection);
            } else if (q instanceof MoonRange) {
                return new RangeValue(q.os.map(filterSelection), q.closedLower, q.closedUpper);
            } else if (q instanceof MoonComparisonFunction) {
                return new ComparisonFunctionValue(q.os.map(filterSelection));
            } else if (q instanceof Negation) {
                return new Negation(q.queries.map(filterSelection));
            } else if (q instanceof MoonSubstringQuery) {
                return new SubStringQuery(q.os.map(filterSelection));
            } else {
                var sel: any = undefined;
                for (var attr in q) {
                    var as = filterSelection(q[attr]);
                    if (as !== undefined) {
                        if (sel === undefined) {
                            sel = {};
                        }
                        sel[attr] = as;
                    }
                }
                return sel;
            }
        }

        return filterSelection(q);
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        super.specificExplanation(explanation, classDebugInfo, true);
        explanation._query = (<any>this.compiledFunction).queryStr;
        if (this.inputs !== undefined) {
            explanation._inputs = [];
            for (var i = 0; i < this.inputs.length; i++) {
                explanation._inputs[i + ": " + this.inputs[i].debugName()] =
                    this.inputs[i].explain(undefined);
            }
        }
    }
}
