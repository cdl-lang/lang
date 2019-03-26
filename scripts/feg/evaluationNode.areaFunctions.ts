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

// Note: class membership does not need to be activated; it already is active.
class EvaluationClassRegisteringFunction extends EvaluationFunctionApplication {

    // Indication of registration change per area id; true means register, false unregister
    registrationChanges: {[areaId: string]: boolean} = undefined;

    // Current name change
    className: string = undefined;

    // Next class name
    newClassName: string = undefined;

    // Has the result (possibly) changed?
    resultChanged: boolean = false;

    // Added area ids
    added: {[areaId: string]: ElementReference} = undefined;

    // Removed area ids
    removed: {[areaId: string]: ElementReference} = undefined;

    // Area ids and ElementReferences; every area that was in the last input, is
    // in here.
    elementRefs: {[areaId: string]: ElementReference} = {};

    // Potential position of an areaId in the next result
    areaIdToPos: {[areaId: string]: number} = {};

    // areaIds in the result
    areaIdInResult: {[areaId: string]: ElementReference} = {};

    // Watched membership expressions per area; only contains ids of areas that
    // can possibly have the requested class.
    watchedExpressions: {[areaId: string]: EvaluationNode} = {};

    // List of direct inputs and class membership functions; needs to be
    // recomputed when it is undefined.
    combinedInputs: EvaluationNode[];

    // Flag that indicates new expressions that are not ready have been added
    inputNotReady: boolean = false;

    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);
        this.constant = false;
        // Prepare for incremental updates
        this.result.incremental = false;
        this.result.added = [];
        this.result.removed = [];
        this.result.value = [];
    }

    destroy(): void {
        this.unregisterAllMembership();
        super.destroy();
    }

    setNewClassName(className: string): void {
        this.newClassName = className;
        if (!(typeof(this.newClassName) in {string: true, number: true, boolean: true})) {
            this.newClassName = undefined;
        }
        if (this.className !== this.newClassName) {
            this.markAsChanged();
        }
    }

    // Note: assuming it only gets called on a true/false change...
    // Also: if result is undefined, the expression has been removed
    updateAreaInput(pos: any, result: Result): void {
        if (result === undefined) { // i.e., class membership was destroyed
            this.removeAreaFromResult(pos);
            this.unregisterMembership(pos);
        } else if (isTrueValue(result.value)) {
            this.addAreaToResult(pos);
        } else {
            this.removeAreaFromResult(pos);
        }
        this.markAsChanged();
    }

    // Note that this function is (currently) being called with an os of
    // strings rather than an os of ElementReferences.
    incrementalAreaSetUpdate(result: Result): void {
        var change: boolean = false;
        var areaId: string;

        if (this.registrationChanges === undefined) {
            this.registrationChanges = {};
        }
        // Keep track of registrationChanges until execute
        for (var i: number = 0; i < result.removed.length; i++) {
            areaId = result.removed[i];
            if (!(areaId in this.registrationChanges)) {
                if (areaId in this.elementRefs) {
                    if (this.nrActiveWatchers > 0) {
                        // When active, just mark as changed
                        this.registrationChanges[areaId] = false;
                    } else {
                        // When inactive, remove immediately, since it can take
                        // some time before we will release the class membership
                        // expression.
                        this.removeAreaFromResult(areaId);
                        this.unregisterMembership(areaId);
                    }
                    change = true;
                }
            } else if (this.registrationChanges[areaId]) {
                delete this.registrationChanges[areaId];
            }
        }
        for (var i: number = 0; i < result.added.length; i++) {
            areaId = result.added[i];
            if (!(areaId in this.registrationChanges)) {
                if (!(areaId in this.elementRefs)) {
                    this.registrationChanges[areaId] = true;
                    change = true;
                }
            } else if (!this.registrationChanges[areaId]) {
                delete this.registrationChanges[areaId];
            }
        }
        if (change) {
            this.markAsChanged();
        }
    }
    
    // Here, result is an os of ElementReferences.
    // O = this.elementRefs, the previous set of areaIds, and N = newSet,
    // the new set of areaIds. At the moment of evaluation, want this.changes to
    // be such that N = O - {a | this.changes[a] === false} + {a |
    // this.changes[a] === true}. Note that this function can be called multiple
    // times before eval(), so areas can be removed and added and vice versa.
    nonincrementalAreaSetUpdate(result: Result): void {
        var change: boolean = false;
        var areaId: string;
        var newSet: {[areaId: string]: boolean} = {};

        if (this.registrationChanges === undefined) {
            this.registrationChanges = {};
        }
        // Keep track of changes until execute
        if (result !== undefined && result.value !== undefined) {
            for (var i: number = 0; i < result.value.length; i++) {
                var v_i: any = result.value[i];
                if (v_i instanceof ElementReference) {
                    newSet[v_i.element] = true;
                }
            }
        }
        for (areaId in this.elementRefs) {
            if (!(areaId in newSet)) {
                // areaId in O, not in N, so mark for removal
                if (this.nrActiveWatchers > 0) {
                    // When active, just mark as changed
                    this.registrationChanges[areaId] = false;
                } else {
                    // When inactive, remove immediately, since it can take
                    // some time before we will release the class membership
                    // expression.
                    this.removeAreaFromResult(areaId);
                    this.unregisterMembership(areaId);
                }
                change = true;
            }
        }
        for (areaId in newSet) {
            if (!(areaId in this.elementRefs)) {
                // areaId in N, not in O, so mark for addition
                this.registrationChanges[areaId] = true;
                change = true;
            }
        }
        if (this.orderChange(result)) {
            change = true;
        }
        if (change) {
            this.markAsChanged();
        }
    }

    orderChange(result: Result): boolean {
        var change: boolean = false;

        if (result !== undefined && result.value !== undefined) {
            for (var i: number = 0; i < result.value.length; i++) {
                var v_i: any = result.value[i];
                if (v_i instanceof ElementReference) {
                    if (this.areaIdToPos[v_i.element] !== i) {
                        this.areaIdToPos[v_i.element] = i;
                        this.resultChanged = true;
                        change = true;
                    }
                }
            }
        }
        return change;
    }
    
    eval(): boolean {

        // Complete evaluation
        this.inputNotReady = false;
        this.handleRegistrationChanges();
        if (this.inputNotReady) {
            return undefined;
        }
        // Determine incremental update
        var added: {[areaId: string]: ElementReference} = this.added;
        var removed: {[areaId: string]: ElementReference} = this.removed;
        this.added = undefined;
        this.removed = undefined;
        this.result.incremental = true;
        this.result.added.length = 0;
        this.result.removed.length = 0;
        if (this.resultChanged) {
            var nextResult: ElementReference[] = this.getResult();
            this.resultChanged = false;
            if (!objectEqual(this.result.value, nextResult)) {
                this.result.value = nextResult;
                for (var areaId in added) {
                    this.result.added.push(added[areaId]);
                }
                for (var areaId in removed) {
                    this.result.removed.push(removed[areaId]);
                }
                return true;
            }
        }
        return false;
    }

    handleRegistrationChanges(): void {
        if (this.className !== this.newClassName) {
            this.unregisterAllMembership();
            this.className = this.newClassName;
            this.registerAllMembership();
        } else if (this.registrationChanges !== undefined) {
            for (var areaId in this.registrationChanges) {
                if (this.registrationChanges[areaId]) {
                    assert(!(areaId in this.elementRefs), "admin error?");
                    this.registerArea(areaId);
                } else {
                    if (areaId in this.elementRefs) {
                        this.removeAreaFromResult(areaId);
                        this.unregisterMembership(areaId);
                    }
                }
            }
        }
        this.registrationChanges = undefined;
    }

    deactivateInputs(): void {
        super.deactivateInputs();
        // Remove expressions marked for removal (see note at
        // incrementalAreaSetUpdate).
        for (var areaId in this.registrationChanges) {
            if (this.registrationChanges[areaId] === false &&
                  areaId in this.watchedExpressions) {
                this.removeAreaFromResult(areaId);
                this.unregisterMembership(areaId);
                delete this.registrationChanges[areaId];
            }
        }
    }

    registerArea(areaId: string): void {
        var area: CoreArea = this.registerMembership(areaId);

        if (area !== undefined) {
            this.addAreaToResult(areaId);
        }
    }

    getResult(): ElementReference[] {
        var nextResult: ElementReference[] = [];

        for (var areaId in this.areaIdInResult) {
            nextResult.push(this.areaIdInResult[areaId]);
        }
        return nextResult.sort((e1: ElementReference, e2: ElementReference): number => {
            return this.areaIdToPos[e1.element] - this.areaIdToPos[e2.element];
        });
    }

    addAreaToResult(areaId: string): void {
        if (!(areaId in this.areaIdInResult)) {
            this.areaIdInResult[areaId] = this.elementRefs[areaId];
            if (this.added === undefined) {
                this.added = {};
            }
            this.added[areaId] = this.elementRefs[areaId];
            if (this.removed !== undefined && areaId in this.removed) {
                delete this.removed[areaId];
                if (this.registrationChanges !== undefined) {
                    delete this.registrationChanges[areaId];
                }
            }
            this.resultChanged = true;
        }
    }

    // Call before unregistering (it removes the id from elementRefs)
    removeAreaFromResult(areaId: string): void {
        if (areaId in this.areaIdInResult) {
            delete this.areaIdInResult[areaId];
            if (this.removed === undefined) {
                this.removed = {};
            }
            this.removed[areaId] = this.elementRefs[areaId];
            if (this.added !== undefined && areaId in this.added) {
                delete this.added[areaId];
                if (this.registrationChanges !== undefined) {
                    delete this.registrationChanges[areaId];
                }
            }
            this.resultChanged = true;
        }
    }

    registerMembership(areaId: string): CoreArea {
        var area: CoreArea = allAreaMonitor.getAreaById(areaId);

        if (area !== undefined) {
            this.elementRefs[area.areaId] = area.areaReference;
            if (area.exports !== undefined) {
                var classAV = <EvaluationAV> area.getExport(0);
                if (classAV !== undefined) {
                    var classMembership = classAV.inputByAttr[this.className];
                    if (classMembership !== undefined) {
                        classMembership.addWatcher(this, areaId, false, false, false);
                        classMembership.activate(this, false);
                        this.watchedExpressions[areaId] = classMembership;
                        if (classMembership.isScheduled()) {
                            this.inputNotReady = true;
                        }
                        if (this.combinedInputs !== undefined) {
                            this.combinedInputs.push(classMembership);
                        }
                        return isTrueValue(classMembership.result.value)? area: undefined;
                    }
                }
            }
        }
        return undefined;
    }

    unregisterMembership(areaId: string): void {
        delete this.elementRefs[areaId];
        delete this.areaIdToPos[areaId];
        if (areaId in this.watchedExpressions) {
            var classMembership = this.watchedExpressions[areaId];
            classMembership.removeWatcherForPos(this, areaId, false, false);
            classMembership.deactivate(this, false);
            delete this.watchedExpressions[areaId];
            if (this.combinedInputs !== undefined) {
                this.combinedInputs = undefined;
            }
        }
    }

    registerAllMembership(): void {
        assert(false, "implement in derived class 9");
    }

    unregisterAllMembership(): void {
        for (var areaId in this.watchedExpressions) {
            this.unregisterMembership(areaId);
        }
    }

    allInputs(): EvaluationNode[] {
        if (this.combinedInputs === undefined) {
            var ci: EvaluationNode[] = this.inputs.slice(0);
            for (var areaId in this.watchedExpressions) {
                ci.push(this.watchedExpressions[areaId]);
            }
            this.combinedInputs = ci;
        }
        return this.combinedInputs;
    }
}

// TODO: make more efficient by compiling a table of template ids and
// class names. That would avoid instantiating expressions in areas that cannot
// possibly have the required class name.
class EvaluationAreaOfClass extends EvaluationClassRegisteringFunction {

    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);
        allAreaMonitor.addWatcher(this, undefined);
        this.result.value = constEmptyOS;
    }

    destroy(): void {
        allAreaMonitor.removeWatcher(this, false);
        super.destroy();
    }

    updateInput(pos: any, result: Result): void {
        if (pos === 0) { // the function argument, aka the class name
            this.setNewClassName(singleton(result.value));
        } else if (pos === undefined) { // callback from the area monitor
            if (this.className !== undefined) {
                // If className is undefined, there is nothing to do
                this.incrementalAreaSetUpdate(result);
            }
        } else { // callback from registered class expression for area with id pos
            this.updateAreaInput(pos, result);
        }
    }

    activateInputs(): void {
        super.activateInputs();
        if (this.inputs[0] !== undefined) {
            if (this.inputs[0].isScheduled()) {
                this.inputs[0].addForcedUpdate(this);
            } else if (!this.inputs[0].isConstant()) {
                this.updateInput(0, this.inputs[0].result);
            }
        }
    }

    debugName(): string {
        return "areaOfClass";
    }

    registerAllMembership(): void {
        for (var areaId in allAreaMonitor.allAreas) {
            this.registerArea(areaId);
        }
    }

    reasonForBeingEmpty(addDefaultReason: boolean = true): string {
        if (this.result.value !== undefined && this.result.value.length > 0) {
            return undefined;
        }
        return "there is no area of class " + this.className;
    }
}
areaOfClass.classConstructor = EvaluationAreaOfClass;

class EvaluationFilterAreaByClass extends EvaluationClassRegisteringFunction {

    updateInput(pos: any, result: Result): void {
        if (pos === 0) { // the function argument, aka the class name
            this.setNewClassName(singleton(result.value));
        } else if (pos === 1) { // callback from the area function
            this.nonincrementalAreaSetUpdate(result);
        } else { // callback from registered class expression for area with id pos
            this.updateAreaInput(pos, result);
        }
    }

    debugName(): string {
        return "internalFilterAreaByClass";
    }

    activateInputs(): void {
        super.activateInputs();
        if (this.inputs[0] !== undefined) {
            if (this.inputs[0].isScheduled()) {
                this.inputs[0].addForcedUpdate(this);
            } else if (!this.inputs[0].isConstant()) {
                this.updateAreaInput(0, this.inputs[0].result);
            }
        }
        if (this.inputs[1] !== undefined) {
            if (this.inputs[1].isScheduled()) {
                this.inputs[1].addForcedUpdate(this);
            } else if (!this.inputs[1].isConstant()) {
                this.updateInput(1, this.inputs[1].result);
            }
        }
    }

    registerAllMembership(): void {
        var v: any[] = this.inputs[1].result.value;

        if (v !== undefined) {
            for (var i: number = 0; i < v.length; i++) {
                var v_i: any = v[i];
                if (v_i instanceof ElementReference) {
                    this.registerArea(v_i.element);
                }
            }
        }
    }

    reasonForBeingEmpty(addDefaultReason: boolean = true): string {
        if (this.result.value !== undefined && this.result.value.length > 0) {
            return undefined;
        }
        return "there is no area of class " + this.className;
    }
};
internalFilterAreaByClass.classConstructor = EvaluationFilterAreaByClass;

class EvaluationFilterAreaByClassName extends EvaluationFilterAreaByClass {

    debugName(): string {
        return "internalFilterAreaByClassName";
    }

    orderChange(result: Result): boolean {
        // No need for ordering; this function only returns a single class name
        return false;
    }

    // Only needs to output the class name
    eval(): boolean {
        this.handleRegistrationChanges();
        if (this.resultChanged) {
            this.resultChanged = false;
            var newValue: any = Utilities.isEmptyObj(this.areaIdInResult)?
                                constEmptyOS: [this.className];
            if (!objectEqual(this.result.value, newValue)) {
                this.result.value = newValue;
                return true;
            }
        }
        return false;
    }

};
internalFilterAreaByClassName.classConstructor = EvaluationFilterAreaByClassName;

class EvaluationAreaProjection extends EvaluationNode {
    exportId: number;
    watchedProducers: {[areaProducerId: string]: CoreArea|EvaluationNode} = {};
    activeProducers: {[areaProducerId: string]: string} = {};
    producerPos: {[areaProducerId: string]: number} = {};
    values: Result[] = [];
    // List of all inputs; when undefined, it is rebuilt by allInputs().
    // This seems efficient, since not all EvaluationAreaProjection need it.
    combinedInputs: EvaluationNode[];
    inputAreas: any[] = constEmptyOS;
    // Maps areas that were destroyed to their position in the output; when there
    // are elements in it, and this node is active, this node registers on
    // allAreaMonitor to be kept up to date about area creation.
    destroyedAreas = new Map<string, number>();

    constructor(prototype: FunctionNode, exportId: number, local: EvaluationEnvironment) {
        super(prototype, local);
        this.exportId = exportId;
        this.result.value = constEmptyOS;
        // like variants, an area projection is data source aware when it has
        // one input.
        // TODO: switch when there is more than one non empty value
        this.dataSourceAware = true;
        this.dataSourceResultMode = true;
    }

    destroy(): void {
        if (this.isActive() && this.destroyedAreas.size !== 0) {
            allAreaMonitor.removeWatcher(this, false);
        }
        super.destroy();
    }

    setData(data: EvaluationNode): void {
        this.inputs = [data];
        if (data.isConstant()) {
            this.setAreas(data.result.value);
        } else {
            data.addWatcher(this, undefined, true, true, false);
        }
    }

    removeAsWatcher(): void {
        var dataNode: EvaluationNode = this.inputs[0];

        for (var areaProducerId in this.watchedProducers) {
            var producer: Producer = this.watchedProducers[areaProducerId];
            producer.removeWatcher(this, false, this.dataSourceResultMode);
            if (producer instanceof EvaluationNode) {
                if (areaProducerId in this.activeProducers) {
                    if (producer !== dataNode) {
                        producer.deactivate(this, this.dataSourceResultMode);
                    }
                }
            }
        }
        dataNode.removeWatcher(this, false, false);
        if (this.isActive()) {
            dataNode.deactivate(this, false);
        }
        this.activeProducers = undefined;
        this.watchedProducers = undefined;
        this.producerPos = undefined;
        this.values = undefined;
        this.inputs = undefined;
    }

    // tag === undefined is for area data, which is an array of element
    // references; otherwise, it is the areaProducerId.
    updateInput(tag: any, result: Result): void {
        if (tag === undefined) {
            if (result === undefined) {
                this.setAreas(constEmptyOS);
                this.inputs[0].removeWatcherForPos(this, tag, true, false);
                this.inputs[0] = undefined;
            } else if (this.nrActiveWatchers > 0) {
                if (this.setAreas(result.value)) {
                    this.markAsChanged();
                }
            }
        } else if (tag === "") {
            if (result.added !== undefined) {
                // Check if one of the added areas has been destroyed
                for (var i = 0; i < result.added.length; i++) {
                    var areaId: string = result.added[i];
                    if (this.destroyedAreas.has(areaId)) {
                        // When we get here, the area has been destroyed and
                        // recreated without the input having been updated, so
                        // we have to register this single expression.
                        this.registerArea(areaId, this.destroyedAreas.get(areaId));
                        this.destroyedAreas.delete(areaId);
                        if (this.destroyedAreas.size === 0) {
                            allAreaMonitor.removeWatcher(this, false);
                        }
                    }
                }
            }
        } else if (this.producerPos !== undefined) {
            var pos: number = this.producerPos[tag];
            if (result === undefined) {
                var producer = this.watchedProducers[tag];
                if (this.nrActiveWatchers > 0) {
                    if (this.destroyedAreas.size === 0) {
                        allAreaMonitor.addWatcher(this, "", false);
                    }
                    var areaId: string = producer instanceof EvaluationNode?
                                     this.activeProducers[tag]: producer.areaId;
                    this.destroyedAreas.set(areaId, this.producerPos[tag]);
                }
                if (tag in this.activeProducers) {
                    delete this.activeProducers[tag];
                    if (producer instanceof EvaluationNode) {
                        producer.deactivate(this, this.dataSourceResultMode);
                    }
                }
                producer.removeWatcherForPos(this, tag, false, this.dataSourceResultMode);
                delete this.watchedProducers[tag];
                delete this.producerPos[tag];
            }
            this.values[pos] = result;
            this.markAsChanged();
        }
    }

    isConstant(): boolean {
        return false;
    }

    // TODO: use areaPos
    eval(): boolean {
        var oldValue = this.result.value;
        var resultLabels = this.result.getLabels();

        if (this.values.length === 0) {
            this.result.set([]);
        } else if (this.values.length === 1) {
            if (this.values[0] !== undefined && this.values[0].value !== undefined) {
                this.result.copy(this.values[0]);
            } else {
                this.result.set(constEmptyOS);
            }
        } else {
            var identifiers: any[] = undefined;
            var compiledQueries: {(v: any, args: any[]): any}[] = undefined;
            var queryArguments: SimpleQuery[][] = undefined;
            var nrQueryElements: number[] = undefined;
            var res: any[] = [];
            for (var i: number = 0; i !== this.values.length; i++) {
                if (this.values[i] !== undefined) {
                    var v: any[] = this.values[i].value;
                    if (v !== undefined && v.length !== 0 &&
                          !(v.length === 1 && v[0] === undefined)) {
                        if (this.values[i].compiledQuery !== undefined) {
                            if (compiledQueries === undefined) {
                                compiledQueries = new Array(res.length);
                                queryArguments = new Array(res.length);
                                nrQueryElements = new Array(res.length);
                            }
                            Array.prototype.push.apply(compiledQueries, this.values[i].compiledQuery);
                            Array.prototype.push.apply(queryArguments, this.values[i].queryArguments);
                            Array.prototype.push.apply(nrQueryElements, this.values[i].nrQueryElements);
                        } else if (compiledQueries !== undefined) {
                            var xtraLen: number = this.values[i].value.length;
                            compiledQueries.length += xtraLen;
                            queryArguments.length += xtraLen;
                            nrQueryElements.length += xtraLen;
                        }
                        if (this.values[i].identifiers !== undefined) {
                            if (identifiers === undefined) {
                                identifiers = [];
                                for (var j: number = 0; j !== i; j++) {
                                    Array.prototype.push.apply(identifiers, this.values[j].getIdentifiers());
                                }
                            }
                            Array.prototype.push.apply(identifiers, this.values[i].identifiers);
                        } else if (identifiers !== undefined) {
                            Array.prototype.push.apply(identifiers, this.values[i].getIdentifiers());
                        }
                        Array.prototype.push.apply(res, v);
                    }
                }
            }
            this.result.value = res;
            this.result.resetLabels();
            if (identifiers !== undefined) {
                this.result.identifiers = identifiers;
            }
            if (compiledQueries !== undefined) {
                this.result.compiledQuery = compiledQueries;
                this.result.queryArguments = queryArguments;
                this.result.nrQueryElements = nrQueryElements;
            }
        }
        return !this.result.equalLabels(resultLabels) ||
            !valueEqual(oldValue, this.result.value);
    }

    // Returns true if the set of observed expressions has changed
    setAreas(areaData: any): boolean {
        var change: boolean = false;
        var wait: boolean = false;
        var newAreaProducerIds: {[areaProducerId: string]: boolean} = {};

        if (areaData === undefined) {
            areaData = [];
        } else if (!(areaData instanceof Array)) {
            areaData = [areaData];
        }
        if (this.destroyedAreas.size !== 0) {
            allAreaMonitor.removeWatcher(this, false);
            this.destroyedAreas.clear();
        }
        this.inputAreas = areaData;
        this.values.length = areaData.length;
        this.internalSetDataSourceResultMode(this.externalDataSourceResultMode && areaData.length <= 1);
        for (var i: number = 0; i !== areaData.length; i++) {
            var elemRef = areaData[i];
            if (elemRef instanceof ElementReference) {
                var area: CoreArea = allAreaMonitor.getAreaById(elemRef.element);
                if (area !== undefined && area.exports !== undefined &&
                    this.exportId in area.exports) {
                    var expNode: EvaluationNode = area.getExport(this.exportId);
                    // If the node is constant, use the area instead for updates
                    // (which will then only be termination).
                    var producerId: string = area.areaId + "#" + expNode.watcherId;
                    newAreaProducerIds[producerId] = true;
                    if (this.producerPos[producerId] !== i) {
                        this.producerPos[producerId] = i;
                        change = true;
                    }
                    if (!(producerId in this.watchedProducers)) {
                        var producer = expNode.isConstant()? area: expNode;
                        this.watchedProducers[producerId] = producer;
                        producer.addWatcher(this, producerId, false, false, this.dataSourceResultMode);
                        change = true;
                    }
                    if (this.nrActiveWatchers > 0 && !expNode.isConstant() &&
                        !(producerId in this.activeProducers)) {
                        expNode.activate(this, this.dataSourceResultMode);
                        if (this.activeProducers === undefined)
                            return false;
                        this.activeProducers[producerId] = area.areaId; // info for debugging
                        if (expNode.isScheduled()) {
                            wait = true;
                            expNode.forceUpdate(this, false);
                        }
                        change = true;
                    }
                    this.values[i] = expNode.result;
                } else {
                    // Area has been destroyed
                    if (area === undefined && !this.destroyedAreas.has(elemRef.element)) {
                        if (this.nrActiveWatchers > 0 && this.destroyedAreas.size === 0) {
                            allAreaMonitor.addWatcher(this, "", false);
                        }
                        this.destroyedAreas.set(elemRef.element, i);
                    }
                    this.values[i] = undefined;
                }
            }
        }
        for (var areaProducerId in this.watchedProducers) {
            if (!(areaProducerId in newAreaProducerIds)) {
                var producer = this.watchedProducers[areaProducerId];
                delete this.watchedProducers[areaProducerId];
                delete this.producerPos[areaProducerId];
                producer.removeWatcherForPos(this, areaProducerId, false, this.dataSourceResultMode);
                if (areaProducerId in this.activeProducers) {
                    delete this.activeProducers[areaProducerId];
                    if (producer instanceof EvaluationNode) {
                        producer.deactivate(this, this.dataSourceResultMode);
                    }
                }
                change = true;
            }
        }
        if ((wait || change) && "combinedInputs" in this) {
            this.combinedInputs = undefined;
        }
        return change && !wait;
    }

    registerArea(areaId: string, pos: number): void {
        var area: CoreArea = allAreaMonitor.getAreaById(areaId);
        var change: boolean = false;

        if (area !== undefined && area.exports !== undefined && this.exportId in area.exports) {
            var expNode: EvaluationNode = area.getExport(this.exportId);
            // If the node is constant, use the area instead for updates
            // (which will then only be termination).
            var producerId: string = area.areaId + "#" + expNode.watcherId;
            if (this.producerPos[producerId] !== pos) {
                this.producerPos[producerId] = pos;
                change = true;
            }
            if (!(producerId in this.watchedProducers)) {
                var producer = expNode.isConstant()? area: expNode;
                this.watchedProducers[producerId] = producer;
                producer.addWatcher(this, producerId, false, false, this.dataSourceResultMode);
                change = true;
            }
            if (this.nrActiveWatchers > 0 && !expNode.isConstant() &&
                    !(producerId in this.activeProducers)) {
                expNode.activate(this, this.dataSourceResultMode);
                if (this.activeProducers === undefined)
                    return;
                this.activeProducers[producerId] = area.areaId; // info for debugging
                if (expNode.isScheduled()) {
                    expNode.forceUpdate(this, false);
                }
                change = true;
            }
            this.values[pos] = expNode.result;
        } else {
            this.values[pos] = undefined;
        }
        if (change) {
            this.markAsChanged();
        }
    }

    // When an 
    externalDataSourceResultMode: boolean = true;

    // TODO: switch between both modes when there is more than one
    //       result value.
    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        this.externalDataSourceResultMode = dataSourceResultMode;
        this.internalSetDataSourceResultMode(dataSourceResultMode && this.inputAreas.length <= 1);
    }

    internalSetDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (dataSourceResultMode && !this.dataSourceResultMode) {
            for (var areaProducerId in this.activeProducers) {
                var producer: Producer = this.watchedProducers[areaProducerId];
                if (producer instanceof EvaluationNode) {
                    producer.activeWatcherBecomesDataSourceAware(this);
                }
            }
            if (this.isActive()) {
                this.markAsChanged();
            }
        } else if (!dataSourceResultMode && this.dataSourceResultMode) {
            for (var areaProducerId in this.activeProducers) {
                var producer: Producer = this.watchedProducers[areaProducerId];
                if (producer instanceof EvaluationNode) {
                    producer.activeWatcherNoLongerIsDataSourceAware(this);
                }
            }
            if (this.isActive()) {
                this.markAsChanged();
            }
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    // Note: no need to update destroyedAreas or register on allAreaMonitor
    activateInputs(): void {
        if (this.inputs[0] !== undefined) {
            this.inputs[0].activate(this, false);
            if (this.inputs[0].isScheduled()) {
                this.inputs[0].forceUpdate(this, false);
            } else if (this.setAreas(this.inputs[0].result.value)) {
                this.markAsChanged();
            }
        }
    }

    deactivateInputs(): void {
        if (this.inputs !== undefined && this.inputs[0] !== undefined) {
            this.inputs[0].deactivate(this, false);
        }
        if (this.watchedProducers !== undefined) {
            for (var areaProducerId in this.activeProducers) {
                var producer: Producer = this.watchedProducers[areaProducerId];
                if (producer instanceof EvaluationNode) {
                    producer.deactivate(this, this.dataSourceResultMode);
                }
            }
            this.activeProducers = {};
        }
        if (this.destroyedAreas.size !== 0) {
            allAreaMonitor.removeWatcher(this, false);
            this.destroyedAreas.clear();
        }
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var areaData: any = this.inputs[0] !== undefined &&
            this.inputs[0].result.value;
        var pos: number = 0;
        var elemRef: ElementReference, area: CoreArea, exportNode: EvaluationNode,
            areaDataPosition: DataPosition[], i: number;

        if (areaData === undefined) {
            areaData = [];
        } else if (!(areaData instanceof Array)) {
            areaData = [areaData];
        }

        // true if write was successful, false if not
        var success: boolean = false;
        
        // Note: positions refer to concatenated contents of this.values,
        // so we need to count the length of the value returned from an area
        // in order to send the result to the right place.
        if (positions === undefined) {
            for (i = 0; i !== areaData.length; i++) {
                assert(areaData[i] instanceof ElementReference, "should be");
                elemRef = <ElementReference> areaData[i];
                area = allAreaMonitor.getAreaById(elemRef.element);
                exportNode = area.getExport(this.exportId);
                if (exportNode !== undefined) {
                    areaDataPosition = [
                        new DataPosition(0, this.values[i].size())
                    ];
                    if(exportNode.write(result, mode, attributes,
                                        areaDataPosition, reportDeadEnd))
                        success = true;
                }
            }
        } else {
            var accumLength: number = 0;
            i = 0;
            while (i < areaData.length && pos < positions.length) {
                var v: any[] = this.values[i].value;
                var vlen: number = v === undefined? 0: v.length;
                if (accumLength <= positions[pos].index &&
                    positions[pos].index < accumLength + vlen) {
                    // Next position(s) come(s) from area i
                    assert(areaData[i] instanceof ElementReference,
                           "areaData must be array of ElementReference");
                    elemRef = <ElementReference> areaData[i];
                    area = allAreaMonitor.getAreaById(elemRef.element);
                    exportNode = area.getExport(this.exportId);
                    assert(exportNode !== undefined,
                           "if result is defined, exportNode must be too");
                    areaDataPosition = [];
                    while (pos < positions.length &&
                           positions[pos].index < accumLength + vlen) {
                        var dp: DataPosition = positions[pos];
                        areaDataPosition.push(dp.copyWithOffset(accumLength));
                        pos++;
                    }
                    if(exportNode.write(result, mode, attributes,
                                        areaDataPosition, reportDeadEnd))
                       success = true;
                }
                if (!(vlen === 1 && v[0] === undefined)) {
                    accumLength += vlen;
                }
                i++;
            }
        }

        if(!success)
            this.reportDeadEndWrite(reportDeadEnd,
                                    "cannot write through any child area");
        return success;
    }

    allInputs(): EvaluationNode[] {
        if (this.combinedInputs === undefined) {
            var ci: EvaluationNode[] = this.inputs.slice(0);
            for (var watcherId in this.activeProducers) {
                var producer: Producer = this.watchedProducers[watcherId];
                if (producer instanceof EvaluationNode) {
                    // Areas are not the real input, so we ignore them;
                    // they exist and are active beyond our control.
                    ci.push(producer);
                }
            }
            this.combinedInputs = ci;
        }
        return this.combinedInputs;
    }

    allLogInputs(): EvaluationNode[] {
        var ci: EvaluationNode[] = this.inputs.slice(0);

        for (var watcherId in this.watchedProducers) {
            var producer: Producer = this.watchedProducers[watcherId];
            if (producer instanceof EvaluationNode) {
                // Areas are not the real input, so we ignore them;
                // they exist and are active beyond our control.
                ci.push(producer);
            }
        }
        return ci;
    }

    debugName(): string {
        return "areaProjection " +
               (this.exportId===0?"class":exportPaths[this.exportId].join("."));
    }

    static fuller: boolean = false;

    toFullString(): string {
        var str: string = "[proj, " + exportPaths[this.exportId].join(".") + ", " +
            this.inputs.map(function(en: EvaluationNode): string {
                 return en.toFullString();
            }).join(", ") + "]";

        if (EvaluationAreaProjection.fuller) {
            var res: string[] = [];
            for (var watcherId in this.producerPos) {
                var producer: Producer = this.watchedProducers[watcherId];
                if (producer instanceof EvaluationNode) {
                    res[this.producerPos[watcherId]] = "@" +
                        this.activeProducers[watcherId] + ":" +
                        producer.toFullString();
                } else {
                    res[this.producerPos[watcherId]] = "@" +
                        this.activeProducers[watcherId] + ":const";
                }
            }
            str += " = o(" + res.join(", ") + ")";
        }
        str += " = " + cdlifyLim(this.result.value, 80);
        return str;
    }

    // Pass on the id of the single projected EvaluationNode, or mark
    // self as the query source.
    // querySourceId(): number {
    //     var singleElement: Producer = undefined;

    //     for (var areaProducerId in this.producerPos) {
    //         var pos: number = this.producerPos[areaProducerId];
    //         if (this.values[pos].value !== undefined) {
    //             if (singleElement === undefined) {
    //                 singleElement = this.watchedProducers[areaProducerId];
    //             } else {
    //                 return this.watcherId;
    //             }
    //         }
    //     }
    //     return singleElement instanceof EvaluationNode?
    //            singleElement.querySourceId(this): this.watcherId;
    // }

    // An area projection can produce an os of queries
    multiQuerySourceIds(): number[] {
        var ids: number[][] = [];

        for (var areaProducerId in this.producerPos) {
            var pos: number = this.producerPos[areaProducerId];
            if (this.values[pos].value !== undefined &&
                  !(this.values[pos].value instanceof Array &&
                    this.values[pos].value.length === 0)) {
                var wp: Producer = this.watchedProducers[areaProducerId];
                if (wp instanceof EvaluationNode) {
                    ids[pos] = wp.multiQuerySourceIds();
                }
            }
        }
        return ids.reduce(function(curIds: number[], newIds: number[]): number[] {
                   return newIds === undefined? curIds: cconcat(curIds, newIds);
               }, []);
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        super.specificExplanation(explanation, classDebugInfo, true);
        explanation.watchedAreas = {};
        explanation["areas: " + this.inputs[0].debugName()] = this.inputs[0].explain(undefined);
        for (var areaProducerId in this.watchedProducers) {
            var producer: Producer = this.watchedProducers[areaProducerId];
            var areaId: string = areaProducerId.substr(0, areaProducerId.lastIndexOf("#"));
            if (producer instanceof EvaluationNode) {
                explanation.watchedAreas[areaId + ": " + producer.debugName()] =
                    producer.explain(undefined);
            } else {
                explanation.watchedAreas[areaId] = "<<unknown producer>>";
            }
        }
        return explanation;
    }
}

// Projects id 0 and converts true projecting attributes to strings
class EvaluationClassOfArea extends EvaluationAreaProjection {
    areaData: any[];

    constructor(prototype: ClassOfAreaNode, local: EvaluationEnvironment) {
        super(prototype, 0, local);
        this.result.value = constEmptyOS;
    }

    setAreas(areaData: any): boolean {
        this.areaData = areaData;
        return super.setAreas(areaData);
    }

    eval(): boolean {
        var oldValue = this.result.value;
        var classNames: {[className: string]: boolean} = {};
        var classNamePrio: {className: string; prio: number;}[] = [];

        for (var i: number = 0; i < this.values.length; i++) {
            if (this.values[i] !== undefined) {
                var classMemberShip: {[className: string]: boolean} =
                    getDeOSedValue(this.values[i].value);
                var area: CoreArea = allAreaMonitor.getAreaById(this.areaData[i].getElement());
                for (var className in classMemberShip) {
                    if (!(className in classNames) &&
                          isTrue(classMemberShip[className])) {
                        classNames[className] = true;
                        classNamePrio.push({
                            className: className,
                            prio: area.template.classNamePrio[className]
                        });
                    }
                }
            }
        }
        this.result.value = classNamePrio.sort(function(a: {className: string; prio: number;}, b: {className: string; prio: number;}): number {
            return a.prio - b.prio;
        }).map(function(a: {className: string; prio: number;}): string {
            return a.className;
        });
        return !valueEqual(oldValue, this.result.value);
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        this.reportDeadEndWrite(reportDeadEnd,
                                "cannot write through classOfArea");
        return false;
    }
}

// TODO: check carefully for changes
class EvaluationAreaSelection extends EvaluationNode {
    exportId: number;
    watchedProducers: {[areaProducerId: string]: CoreArea|EvaluationNode} = {};
    activeProducers: {[areaProducerId: string]: string} = {};
    producerPos: {[areaProducerId: string]: number} = {};
    values: any[][] = [];
    inputAreas: ElementReference[] = [];
    positive: boolean;
    selectionValue: any;
    selectionQuery: SimpleQuery;
    combinedInputs: EvaluationNode[];
    /**
     * Maps areas that were destroyed to their position in the output; when it
     * contains elements, and this node is active, this node registers on
     * allAreaMonitor to be kept up to date about area creation.
     */
    destroyedAreas:Map<string, number> = new Map();

    constructor(areaSelectionNode: AreaSelectionNode, local: EvaluationEnvironment) {
        super(areaSelectionNode, local);
        this.exportId = areaSelectionNode.exportId;
        this.positive = areaSelectionNode.select.positive;
        this.result.value = constEmptyOS;
    }

    destroy(): void {
        if (this.isActive() && this.destroyedAreas.size !== 0) {
            allAreaMonitor.removeWatcher(this, false);
        }
        super.destroy();
    }

    setSelectionAndData(selectEvaluationNode: EvaluationNode, data: EvaluationNode): void {
        this.inputs = [selectEvaluationNode, data];
        if (selectEvaluationNode !== undefined) {
            if (!selectEvaluationNode.isConstant()) {
                selectEvaluationNode.addWatcher(this, "selection", false, true, false);
            }
            this.setSelection(selectEvaluationNode.result.value,
                              selectEvaluationNode.result.identifiers);
        } else {
            this.setSelection(_, undefined);
        }
        if (data.isConstant()) {
            this.setAreas(data.result.value);
        } else {
            data.addWatcher(this, "data", true, true, false);
        }
    }

    removeAsWatcher(): void {
        var selNode: EvaluationNode = this.inputs[0];
        var dataNode: EvaluationNode = this.inputs[1];

        // Since the following call cleans up all dependencies on this.inputs,
        // we should not deactivate them again in case either of the watched
        // expressions is identical to one of the inputs.
        super.removeAsWatcher();
        for (var areaProducerId in this.watchedProducers) {
            var producer: Producer = this.watchedProducers[areaProducerId];
            producer.removeWatcher(this, false, false);
            if (producer instanceof EvaluationNode) {
                if (areaProducerId in this.activeProducers &&
                      producer !== selNode && producer !== dataNode) {
                    producer.deactivate(this, false);
                }
            }
        }
        this.activeProducers = undefined;
        this.watchedProducers = undefined;
        this.producerPos = undefined;
        this.values = undefined;
    }

    isConstant(): boolean {
        return false;
    }

    // tag === "data" is for area data, "selection" is for the selection value;
    // "" is from allAreaMonitor; otherwise, it is the areaProducerId.
    updateInput(tag: any, result: Result): void {
        if (tag === "data") {
            if (result === undefined) {
                this.setAreas(constEmptyOS);
                this.inputs[1].removeWatcherForPos(this, tag, true, false);
                this.inputs[1] = undefined;
            } else if (this.nrActiveWatchers > 0) {
                if (this.setAreas(result.value)) {
                    this.markAsChanged();
                }
            }
        } else if (tag === "selection") {
            if (result === undefined) {
                this.inputs[0].removeWatcherForPos(this, tag, true, false);
                this.inputs[0] = undefined;
            }
            this.setSelection(result.value, result.identifiers);
        } else if (tag === "") {
            if (result.added !== undefined) {
                // Check if one of the added areas has been destroyed
                for (var i = 0; i < result.added.length; i++) {
                    var areaId: string = result.added[i];
                    if (this.destroyedAreas.has(areaId)) {
                        // When we get here, the area has been destroyed and
                        // recreated without the input having been updated, so
                        // we have to register this single expression.
                        this.registerArea(areaId, this.destroyedAreas.get(areaId));
                        this.destroyedAreas.delete(areaId);
                        if (this.destroyedAreas.size === 0) {
                            allAreaMonitor.removeWatcher(this, false);
                        }
                    }
                }
            }
        } else {
            var pos: number = this.producerPos[tag];
            if (result === undefined) {
                this.markAreaDestroyed(tag, pos);
            } else {
                this.values[pos] = result.value;
            }
            // TODO: check if status changes; if not, update is not needed
            this.markAsChanged();
        }
    }

    markAreaDestroyed(areaProducerId: string, pos: number): void {
        var producer = this.watchedProducers[areaProducerId];

        if (this.nrActiveWatchers > 0) {
            if (this.destroyedAreas.size === 0) {
                allAreaMonitor.addWatcher(this, "", false);
            }
            var areaId: string = producer instanceof EvaluationNode?
                          this.activeProducers[areaProducerId]: producer.areaId;
            this.destroyedAreas.set(areaId, this.producerPos[areaProducerId]);
        }
        if (areaProducerId in this.activeProducers) {
            delete this.activeProducers[areaProducerId];
            if (producer instanceof EvaluationNode) {
                producer.deactivate(this, false);
            }
        }
        producer.removeWatcherForPos(this, areaProducerId, false, false);
        delete this.watchedProducers[areaProducerId];
        delete this.producerPos[areaProducerId];
        this.values[pos] = undefined;
    }

    eval(): boolean {
        var oldValue: any[] = this.result.value;

        this.result.value = [];
        if (this.selectionQuery !== undefined) {
            for (var i: number = 0; i !== this.values.length; i++) {
                var v: any = this.values[i];
                if (this.matches(v)) {
                    this.result.value.push(this.inputAreas[i]);
                }
            }
        }
        return !valueEqual(oldValue, this.result.value);
    }

    setSelection(selectionValue: any, selectionIdentifiers: any[]): void {
        if (!objectEqual(this.selectionValue, selectionValue)) {
            this.selectionValue = selectionValue;
            this.selectionQuery =
                makeSimpleQueryDefault(selectionValue, selectionIdentifiers);
            this.markAsChanged();
        }
        // TODO: check all areas for changes
    }

    setAreas(areaData: any[]): boolean {
        var change: boolean = false;
        var wait: boolean = false;
        var newAreaProducerIds: {[areaProducerId: string]: boolean} = {};

        if (areaData === undefined) {
            areaData = [];
        }
        if (this.destroyedAreas.size !== 0) {
            allAreaMonitor.removeWatcher(this, false);
            this.destroyedAreas.clear();
        }
        this.values.length = areaData.length;
        this.inputAreas.length = areaData.length;
        for (var i: number = 0; i !== areaData.length; i++) {
            var elemRef = areaData[i];
            if (elemRef instanceof ElementReference) {
                var area: CoreArea = allAreaMonitor.getAreaById(elemRef.element);
                if (area !== undefined) {
                    this.inputAreas[i] = area.areaReference;
                    if (area.exports !== undefined && this.exportId in area.exports) {
                        var expNode: EvaluationNode = area.getExport(this.exportId);
                        var producerId: string = area.areaId + "#" + expNode.watcherId;
                        newAreaProducerIds[producerId] = true;
                        if (this.producerPos[producerId] !== i) {
                            this.producerPos[producerId] = i;
                            change = true;
                        }
                        if (!(producerId in this.watchedProducers)) {
                            var producer = expNode.isConstant()? area: expNode;
                            this.watchedProducers[producerId] = producer;
                            producer.addWatcher(this, producerId, false, false, false);
                            change = true;
                        }
                        if (this.nrActiveWatchers > 0 && !expNode.isConstant() &&
                            !(producerId in this.activeProducers)) {
                            expNode.activate(this, false);
                            if (this.activeProducers === undefined)
                                return false;
                            this.activeProducers[producerId] = area.areaId; // info for debuggin
                            if (expNode.isScheduled()) {
                                wait = true;
                                expNode.forceUpdate(this, false);
                            }
                            change = true;
                        }
                        this.values[i] = expNode.result.value;
                    } else {
                        // no such export, but value can still match false
                        this.values[i] = undefined;
                    }
                } else {
                    // Area has been destroyed
                    if (!this.destroyedAreas.has(elemRef.element)) {
                        if (this.nrActiveWatchers > 0 && this.destroyedAreas.size === 0) {
                            allAreaMonitor.addWatcher(this, "", false);
                        }
                        this.destroyedAreas.set(elemRef.element, i);
                    }
                }
            }
        }
        for (var areaProducerId in this.watchedProducers) {
            if (!(areaProducerId in newAreaProducerIds)) {
                var producer = this.watchedProducers[areaProducerId];
                delete this.watchedProducers[areaProducerId];
                delete this.producerPos[areaProducerId];
                producer.removeWatcherForPos(this, areaProducerId, false, false);
                if (areaProducerId in this.activeProducers) {
                    delete this.activeProducers[areaProducerId];
                    if (producer instanceof EvaluationNode) {
                        producer.deactivate(this, false);
                    }
                }
                change = true;
            }
        }
        if ((wait || change) && "combinedInputs" in this) {
            this.combinedInputs = undefined;
        }
        return change && !wait;
    }

    registerArea(areaId: string, pos: number): void {
        var area: CoreArea = allAreaMonitor.getAreaById(areaId);
        var change: boolean = false;

        if (area !== undefined) {
            this.inputAreas[pos] = area.areaReference;
            if (area.exports !== undefined && this.exportId in area.exports) {
                var expNode: EvaluationNode = area.getExport(this.exportId);
                var producerId: string = area.areaId + "#" + expNode.watcherId;
                if (this.producerPos[producerId] !== pos) {
                    this.producerPos[producerId] = pos;
                    change = true;
                }
                if (!(producerId in this.watchedProducers)) {
                    var producer = expNode.isConstant()? area: expNode;
                    this.watchedProducers[producerId] = producer;
                    producer.addWatcher(this, producerId, false, false, false);
                    change = true;
                }
                if (this.nrActiveWatchers > 0 && !expNode.isConstant() &&
                      !(producerId in this.activeProducers)) {
                    expNode.activate(this, false);
                    if (this.activeProducers === undefined)
                        return;
                    this.activeProducers[producerId] = area.areaId; // info for debuggin
                    if (expNode.isScheduled()) {
                        expNode.forceUpdate(this, false);
                    }
                    change = true;
                }
                this.values[pos] = expNode.result.value;
            } else {
                // no such export, but value can still match false
                this.values[pos] = undefined;
            }
        }
        if (change) {
            this.markAsChanged();
        }
    }
 
    activateInputs(): void {
        if (this.inputs[0] !== undefined && this.inputs[1] !== undefined) {
            super.activateInputs();
            this.setSelection(this.inputs[0].result.value,
                              this.inputs[0].result.identifiers);
            if (this.inputs[1].isScheduled()) {
                this.inputs[1].forceUpdate(this, false);
            } else if (this.setAreas(this.inputs[1].result.value)) {
                this.markAsChanged();
            }
        }
    }

    deactivateInputs(): void {
        super.deactivateInputs();
        if (this.destroyedAreas.size !== 0) {
            allAreaMonitor.removeWatcher(this, false);
            this.destroyedAreas.clear();
        }
        if (this.watchedProducers !== undefined) {
            for (var watcherId in this.activeProducers) {
                var producer: Producer = this.watchedProducers[watcherId];
                if (producer instanceof EvaluationNode) {
                    producer.deactivate(this, false);
                }
            }
            this.activeProducers = {};
        }
    }

    matches(v: any[]): boolean {
        var posMatch: boolean = v !== undefined &&
                                this.selectionQuery.testOS(v);

        return this.positive? posMatch: !posMatch;
    }

    allInputs(): EvaluationNode[] {
        if (this.combinedInputs === undefined) {
            var ci: EvaluationNode[] = this.inputs.slice(0);
            for (var areaProducerId in this.activeProducers) {
                var producer: Producer = this.watchedProducers[areaProducerId];
                if (producer instanceof EvaluationNode) {
                    // Areas are not the real input, so we ignore them;
                    // they exist and are active beyond our control.
                    ci.push(producer);
                }
            }
            this.combinedInputs = ci;
        }
        return this.combinedInputs;
    }

    allLogInputs(): EvaluationNode[] {
        var ci: EvaluationNode[] = this.inputs.slice(0);

        for (var areaProducerId in this.watchedProducers) {
            var producer: Producer = this.watchedProducers[areaProducerId];
            if (producer instanceof EvaluationNode) {
                // Areas are not the real input, so we ignore them;
                // they exist and are active beyond our control.
                ci.push(producer);
            }
        }
        return ci;
    }

    debugName(): string {
        return "areaSelection " + exportPaths[this.exportId].join(".") +
            " = " + JSON.stringify(this.selectionValue);
    }

    reasonForBeingEmpty(addDefaultReason: boolean = true): string {
        if (this.result.value !== undefined && this.result.value.length > 0) {
            return undefined;
        }
        if (this.values.length === 0) {
            var osReason: string = this.inputs[1].reasonForBeingEmpty(true);
            return osReason === undefined?
                "the area os is empty": osReason;
        }
        return "no area in " + cdlify(this.inputs[1].result.value) +
               " matched {" + exportPaths[this.exportId].join(".") + ": " +
               cdlify(this.inputs[0].result.value) + "}";
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        super.specificExplanation(explanation, classDebugInfo, true);
        explanation.watchedAreas = {};
        explanation["selection: " + this.inputs[0].debugName()] = this.inputs[0].explain(undefined);
        explanation["areas: " + this.inputs[1].debugName()] = this.inputs[1].explain(undefined);
        for (var areaProducerId in this.watchedProducers) {
            var producer: Producer = this.watchedProducers[areaProducerId];
            var areaId: string = areaProducerId.substr(0, areaProducerId.lastIndexOf("#"));
            if (producer instanceof EvaluationNode) {
                explanation.watchedAreas[areaId + ": " + producer.debugName()] =
                    producer.explain(undefined);
            } else {
                explanation.watchedAreas[areaId] = "<<unknown producer>>";
            }
        }
        return explanation;
    }
}

// TODO: should this class add waiting for area creation (by extending
// allInputs() to the object responsible for creating the areas)?
class EvaluationChildAreas extends EvaluationNode implements Watcher {
    watcherId: number;
    childName: string;
    input: EvaluationNode;
    watchedAreas: {[areaId: string]: CoreArea} = {};
    areaPos: {[areaId: string]: number} = {};
    values: ElementReference[][] = [];
    inputAreas: string[] = [];

    constructor(prototype: ChildAreasNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.childName = prototype.childName;
        this.result.value = constEmptyOS;
    }

    setData(data: EvaluationNode): void {
        this.inputs = [data];
        if (data.isConstant()) {
            this.setAreas(data.result.value);
        } else {
            data.addWatcher(this, "data", true, true, false);
            this.result.value = [];
        }
    }

    destroy(): void {
        for (var areaId in this.watchedAreas) {
            this.watchedAreas[areaId].removeChildAreaWatcher(this.childName, this);
        }
        super.destroy();
    }

    updateInput(id: any, result: Result): void {
        if (id === "data") {
            if (!this.setAreas(result.value)) {
                return;
            }
        } else if (result !== undefined) {
            var pos: number = this.areaPos[id];
            this.values[pos] = result.value;
        } else {
            // The registered area was destroyed, so there's nothing to look
            // out for anymore
            var pos: number = this.areaPos[id];
            delete this.areaPos[id];
            this.values.splice(pos, 1);
            delete this.watchedAreas[id];
            removeFromPosList(pos, this.inputAreas, this.areaPos);
        }
        // TODO: check if status changes; if not, update is not needed
        this.markAsChanged();
    }

    eval(): boolean {
        var oldValue = this.result.value;
        var res: ElementReference[] = [];

        for (var i: number = 0; i !== this.values.length; i++) {
            var v: any = this.values[i];
            if (v !== undefined && v.length !== 0) {
                res = cconcat(res, v);
            }
        }
        this.result.value = res;
        return !valueEqual(oldValue, this.result.value);
    }

    activateInputs(): void {
        if (this.inputs[0] !== undefined) {
            this.inputs[0].activate(this, false);
            if (this.inputs[0].isScheduled()) {
                this.inputs[0].forceUpdate(this, false);
            } else if (this.setAreas(this.inputs[0].result.value)) {
                this.markAsChanged();
            }
        }
    }

    deactivateInputs(): void {
        super.deactivateInputs();
    }

    setAreas(areaData: any): boolean {
        var newAreaIds: {[areaId: string]: boolean} = {};
        var change: boolean = false;

        if (areaData === undefined) {
            areaData = constEmptyOS;
        }
        this.areaPos = {};
        if (this.values.length !== areaData.length) {
            change = true;
        }
        this.values.length = areaData.length;
        this.inputAreas.length = areaData.length;
        for (var i: number = 0; i !== areaData.length; i++) {
            assert(areaData[i] instanceof ElementReference, "should be");
            var elemRef = <ElementReference> areaData[i];
            var area: CoreArea = allAreaMonitor.getAreaById(elemRef.element);
            if (area !== undefined) {
                var newResult: Result = area.getChildAreas(this.childName);
                var newValues: ElementReference[] = newResult !== undefined? newResult.value: undefined;
                newAreaIds[area.areaId] = true;
                this.areaPos[area.areaId] = i;
                this.inputAreas[i] = area.areaId;
                if (!valueEqual(this.values[i], newValues)) {
                    this.values[i] = newValues;
                    change = true;
                }
                if (!(area.areaId in this.watchedAreas)) {
                    area.addChildAreaWatcher(this.childName, this, area.areaId, false);
                    this.watchedAreas[area.areaId] = area;
                }
            } else if (this.values[i] !== undefined) {
                this.values[i] = undefined;
                change = true;
            }
        }
        for (var areaId in this.watchedAreas) {
            if (!(areaId in newAreaIds)) {
                this.watchedAreas[areaId].removeChildAreaWatcher(this.childName, this);
                delete this.watchedAreas[areaId];
                change = true;
            }
        }
        return change;
    }

    debugName(): string {
        return "childAreas: " + this.childName;
    }
}
