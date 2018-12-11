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
/// <reference path="areaMonitor.ts" />
/// <reference path="evaluationNode.ts" />
/// <reference path="buildEvaluationNode.ts" />
/// <reference path="functionExecute.ts" />
/// <reference path="paidMgr.ts" />
/// <reference path="debug.ts" />

var logValues: boolean = false;

var dbgAreaSetRepr: {[areaId: string]: AreaSetStackable} = {};

// Class debug info
type AreaTemplateDebugInfo = {
    inherit?: {[className: string]: number[]};
    values?: number[];
    next?: {[attr: string]: AreaTemplateDebugInfo};
};
declare var gClassNameDebugStrings: string[];
declare var gClassQualifierDebugStrings: string[];
declare var gClassPathDebugStrings: string[];
declare var gClassPathTree: number[][];
declare var areaDebugInfo: AreaTemplateDebugInfo[];

function getClassPath(classPathTreeIndex: number): any {
    var classNames: string[] = [];
    var classPath: any = "screenArea";

    while (classPathTreeIndex !== 0) {
        var entry: number[] = gClassPathTree[classPathTreeIndex];
        var inheritInfo: string = gClassNameDebugStrings[entry[1]] +
            ":{" + gClassQualifierDebugStrings[entry[2]] + "}";
        if (gClassPathDebugStrings[entry[3]] !== "") {
            inheritInfo += "." + gClassPathDebugStrings[entry[3]];
        }
        classNames.push(inheritInfo);
        classPathTreeIndex = entry[0];
    }
    for (var i = classNames.length - 1; i >= 0; i--) {
        var tmp: any = {};
        tmp[classNames[i]] = classPath;
        classPath = tmp;
    }
    return classPath;
}

function getDeepestDefiningClass(classPathTreeIndex: number): string {
    if (classPathTreeIndex !== 0) {
        return gClassNameDebugStrings[gClassPathTree[classPathTreeIndex][1]];
    }
    return undefined;
}

// Takes the place of all members of an area set that have a certain constraint
// set. It is possible for a member of that set to have a different set of
// stacking constraints, but it's not possible to subscribe to one common
// constraint and not to another one, or an individual constraint. That will
// lead to an unpredictable zindex for the area.
// Note that embedding must be in parent.
class AreaSetStackable implements Stackable {
    controller: ChildController;
    areaId: string; // This is a bit ugly
    areaReference: ElementReference;
    zArea: ZArea;
    areaSet: {[areaId: string]: DisplayArea} = {};
    areaRefCount: {[areaId: string]: number} = {};
    frameZ: any = "";
    displayZ: any = "";

    constructor(controller: ChildController, areaId: string) {
        this.controller = controller;
        this.areaId = areaId;
        this.areaReference = new ElementReference(areaId);
        this.zArea = gZIndex.addArea(this, controller.parent);
        dbgAreaSetRepr[this.areaId] = this;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"AreaSetStackable",id:this.areaId});
    }

    destroy(): void {
        delete dbgAreaSetRepr[this.areaId];
        gZIndex.removeArea(this);
        this.zArea = undefined;
    }

    getZArea(): ZArea {
        return this.zArea;
    }

    getZAreaRep(): ZArea {
        return this.zArea;
    }

    addSetMember(child: DisplayArea, constraintName: string): void {
        if (!(child.areaId in this.areaSet)) {
            this.areaSet[child.areaId] = child;
            this.areaRefCount[child.areaId] = 1;
            child.zArea.setSetRepresentative(this.zArea, constraintName);
            gZIndex.newEmbedding(child, undefined, this);
            child.setZIndex(this.frameZ, this.displayZ);
        } else {
            this.areaRefCount[child.areaId]++;
        }
    }

    removeSetMember(child: DisplayArea): void {
        this.areaRefCount[child.areaId]--;
        if (this.areaRefCount[child.areaId] === 0) {
            delete this.areaSet[child.areaId];
            delete this.areaRefCount[child.areaId];
            if (child.zArea !== undefined) {
                child.zArea.removeSetRepresentative();
                gZIndex.newEmbedding(child, undefined, child.getEmbedding());
            }
        }
    }

    setMemberDestruction(child: DisplayArea): void {
        delete this.areaSet[child.areaId];
        delete this.areaRefCount[child.areaId];
        if (child.zArea !== undefined) {
            child.zArea.removeSetRepresentative();
        }
    }

    setZIndex(frameZ: any, displayZ: any): void {
        this.frameZ = frameZ;
        this.displayZ = displayZ;
        for (var areaId in this.areaSet) {
            this.areaSet[areaId].setZIndex(frameZ, displayZ);
        }
    }

    getEmbeddingDepth(): number {
        return this.controller.getEmbeddingDepth();
    }

    // Returns a div from an arbitrary child area. It should not lead to weird
    // behavior in the stacking.
    getFrameDiv(): HTMLDivElement {
        for (var areaId in this.areaSet) {
            return this.areaSet[areaId].getFrameDiv();
        }
        return undefined;
    }

}

abstract class ChildController implements Watcher, Producer, Evaluator {
    parent: CoreArea;
    name: string;
    template: AreaTemplate;
    setIndices: any[];
    children: CoreArea[]; // array of children
    result: Result;
    watchers: WatcherMap = undefined;
    qualifierInputs: EvaluationNode[][];
    qualifiers: QualifierState[][];
    isCurrentlyActive: boolean = false;
    willBeActive: boolean = false;
    watcherId: number;
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    attributedTime: number;
    areaSetStackable: AreaSetStackable;
    tAreaId: string;
    // parentsByTemplateId: {[templateId: number]: EvaluationEnvironment};

    scheduledAtPosition: number = -1;
    nrQueueResets: number = 0;

    getSchedulePriority(): number {
        return 0;
    }

    getScheduleStep(): number {
        return this.template.scheduleStep;
    }

    // True when awaiting execution on queue
    isScheduled(): boolean {
        return this.scheduledAtPosition !== -1;
    }

    isActive(): boolean {
        return true;
    }

    constructor(parent: CoreArea, name: string, template: AreaTemplate,
                setIndices: any[], existenceQualifiers: SingleQualifier[][]) {
        this.parent = parent;
        this.name = name;
        this.template = template;
        this.setIndices = setIndices;
        this.children = [];
        this.result = new Result([]);
        this.watcherId = getNextWatcherId();
        // var parentsByTemplateId: {[templateId: number]: EvaluationEnvironment} = {};
        // if (parent !== undefined) {
        //     var pcpBTId: {[templateId: number]: EvaluationEnvironment} = parent.parentsByTemplateId;
        //     for (var templateId in pcpBTId) {
        //         parentsByTemplateId[templateId] = pcpBTId[templateId];
        //     }
        // }
        // parentsByTemplateId[template.id] = this;
        // this.parentsByTemplateId = parentsByTemplateId;
        if (gProfile) {
            this.totalUpdateInputTime = 0;
            this.attributedTime = 0;
        }
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"ChildController",id:this.name});
    }

    destroy(): void {
        if (this.areaSetStackable !== undefined) {
            this.areaSetStackable.destroy();
            this.areaSetStackable = undefined;
        }
        if (this.qualifiers !== undefined) {
            for (var i: number = 0; i !== this.qualifiers.length; i++) {
                for (var j: number = 0; j !== this.qualifiers[i].length; j++) {
                    this.qualifierInputs[i][j].removeWatcher(this, true, false);
                }
            }
            this.qualifiers = this.qualifierInputs = undefined;
        }
        this.result = undefined;
        this.informWatchers();
        this.watchersToParent();
        if (this.isScheduled()) {
            evaluationQueue.unschedule(this);
        }
    }

    setupExistenceQualifiers(existenceQualifiers: SingleQualifier[][]): void {
        var existenceState: boolean = false;

        this.qualifiers = [];
        this.qualifierInputs = [];
        for (var i: number = 0; i !== existenceQualifiers.length; i++) {
            var qualifiers: {value: EvaluationNode; match: any;}[] =
                buildQualifiers(existenceQualifiers[i], this.parent);
            var allExprReady: boolean = true;
            this.qualifierInputs.push([]);
            this.qualifiers.push([]);
            for (var j: number = 0; j !== qualifiers.length; j++) {
                var n: EvaluationNode = qualifiers[j].value;
                this.qualifierInputs[i][j] = n;
                switch (typeof(qualifiers[j].match)) {
                  case "boolean":
                    if (qualifiers[j].match === true) {
                        this.qualifiers[i][j] = new QualifierStateTrue(n.result.value);
                    } else {
                        this.qualifiers[i][j] = new QualifierStateFalse(n.result.value);
                    }
                    break;
                  case "number":
                  case "string":
                    this.qualifiers[i][j] = new QualifierStateSimpleValue(n.result.value, qualifiers[j].match);
                    break;
                  default:
                    if (qualifiers[j].match instanceof MoonRange) {
                        this.qualifiers[i][j] =
                            new QualifierStateMatchRange(n.result.value, qualifiers[j].match);
                    } else if (qualifiers[j].match instanceof MoonOrderedSet) {
                        this.qualifiers[i][j] =
                            new QualifierStateMatchOS(n.result.value, qualifiers[j].match);
                    } else {
                        assert(false, "no implementation");
                        this.qualifiers[i][j] =
                            new QualifierStateAlwaysFalse(n.result.value);
                    }
                    break;
                }
                if (!n.isConstant()) {
                    n.addWatcher(this, [i, j], false, true, false);
                    if (n.isScheduled()) {
                        allExprReady = false;
                        n.addForcedUpdate(this);
                    }
                }
            }
            if (allExprReady && allQualifiersHold(this.qualifiers[i])) {
                existenceState = true;
            }
        }
        this.setNextExistenceState(existenceState);
    }

    updateInput(pos: any, result: Result): void {
        if (this.qualifiers !== undefined) {
            var i: number = pos[0];
            var j: number = pos[1];
            this.qualifiers[i][j].value = result.value;
            for (i = 0; i !== this.qualifiers.length; i++) {
                if (allQualifiersHold(this.qualifiers[i])) {
                    this.setNextExistenceState(true);
                    return;
                }
            }
            this.setNextExistenceState(false);
        }
    }

    setNextExistenceState(state: boolean): void {
        this.willBeActive = state;
        if (state !== this.isCurrentlyActive) {
            this.markAsChanged();
        }
    }

    updateOutput(): void {
        Utilities.error("to be overridden");
    }

    addElement(child: CoreArea): void {
        this.result.value = this.result.value.concat(child.areaReference);
        this.informWatchers();
    }

    removeElement(pos: number): void {
        var elements: any[] = this.result.value;

        this.result.value = elements.slice(0, pos).concat(elements.slice(pos + 1));
        this.informWatchers();
    }

    replaceElements(elements: ElementReference[]): void {
        if (!valueEqual(this.result.value, elements)) {
            this.result.value = elements;
            this.informWatchers();
        }
    }

    addWatcher(watcher: Watcher, pos: any, forceFirstUpdate: boolean = false): void {
        assert(!forceFirstUpdate, "debugging: not supported");
        if (this.watchers === undefined) {
            this.watchers = new Map<number, {watcher: Watcher; pos: any[];}>();
        }
        if (this.watchers.has(watcher.watcherId)) {
            this.watchers.get(watcher.watcherId).pos.push(pos);
        } else {
            this.watchers.set(watcher.watcherId, {
                watcher: watcher,
                pos: [pos]
            });
        }
    }

    removeWatcher(watcher: Watcher, conditionallyDeactivate: boolean): void {
        this.watchers.delete(watcher.watcherId);
    }

    removeWatcherForPos(watcher: Watcher, pos: any, conditionallyDeactivate: boolean, dataSourceAware: boolean): void {
        var w = this.watchers.get(watcher.watcherId);
        var posIndex = w.pos.indexOf(pos);

        if (posIndex >= 0) {
            if (w.pos.length === 1) {
                // If it's the only one, remove, update, etc. completely
                this.removeWatcher(watcher, conditionallyDeactivate);
            } else {
                // watcher is still interested in this node; only remove
                // the tag.
                w.pos.splice(posIndex, 1);
            }
        }
    }

    setWatchers(watchers: WatcherMap): void {
        this.watchers = watchers;
        this.informWatchers();
    }

    watchersToParent(): void {
        if (this.watchers !== undefined) {
            this.watchers.forEach((w, watcherId): void => {
                for (var i: number = 0; i !== w.pos.length; i++) {
                    this.parent.addChildAreaWatcher(this.name, w.watcher,
                                                    w.pos[i], true);
                }
            });
        }
    }

    markAsChanged(): void {
        evaluationQueue.schedule(this, false);
    }

    informWatchers(): void {
        if (this.watchers !== undefined) {
            this.watchers.forEach((w, watcherId): void => {
                for (var i: number = 0; i !== w.pos.length; i++) {
                    w.watcher.updateInput(w.pos[i], this.result);
                }
            });
        }
    }

    makeAreaSetRepr(constraintName: string): Stackable {
        return undefined;
    }

    removeAreaSetRepr(): void {
    }

    getAreaSetRepr(): Stackable {
        return this.areaSetStackable;
    }

    getEmbeddingDepth(): number {
        return this.parent.getEmbeddingDepth() + 1;
    }

    explain(): any {
        var explanation: any = {};

        explanation["exist === " + this.isCurrentlyActive] = this.getExistExplanation();
        return explanation;
    }

    getExistExplanation(): any {
        var explanation: any = {}, q: any;

        if (this.qualifiers === undefined) {
            return "true";
        }
        for (var i: number = 0; i !== this.qualifiers.length; i++) {
            var variantInd: string = String(i) + ": " + String(allQualifiersHold(this.qualifiers[i]));
            explanation[variantInd] = {};
            if (this.qualifierInputs[i].length === 0) {
                q = explanation[variantInd]["qualifier"] = "default";
            } else {
                q = explanation[variantInd]["qualifier"] = {};
                for (var j: number = 0; j !== this.qualifierInputs[i].length; j++) {
                    q[j + ": " + this.qualifierInputs[i][j].debugName() +
                      (this.qualifiers[i][j].holds() ? " == " : " != ") +
                      this.qualifiers[i][j].matchValue()] =
                        this.qualifierInputs[i][j].explain(undefined);
                }
            }
        }
        return explanation;
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

    isReady(): boolean {
        return true;
    }

    toString(): string {
        return "@" + this.parent.areaId + "." + this.name;
    }

    abstract copyTransitionsToReferredIntersections(transitions: any, transitionSource: ElementReference): void;

    abstract cleanUpUnusedEvaluationNodes(): number;

    abstract cleanUpRemovedExportNodes(): void;

    debugName(): string {
        return "childcontroller(" + this.name + ")";
    }

    getDebugOrigin(): string[] {
        return ["child controller " + this.name];
    }
}

class StaticChildController extends ChildController {

    constructor(parent: CoreArea, name: string, template: AreaTemplate,
                setIndices: any[], existenceQualifiers: SingleQualifier[][]) {
        super(parent, name, template, setIndices, existenceQualifiers);
        if (existenceQualifiers) {
            this.setupExistenceQualifiers(existenceQualifiers);
        } else {
            this.willBeActive = true;
            this.updateOutput();
        }
    }

    destroy(): void {
        if (this.children.length !== 0) {
            this.children[0].destroy();
            this.children = undefined;
        }
        super.destroy();
    }

    add(child: CoreArea): void {
        this.children[0] = child;
        this.addElement(child);
        child.setComment(this.parent.areaId + ":single:" + this.name);
    }

    remove(child: CoreArea): void {
        this.children.length = 0;
        this.removeElement(0);
    }

    updateOutput(): void {
        if (this.willBeActive && !this.isCurrentlyActive) {
            this.isCurrentlyActive = true;
            var child: CoreArea = CoreArea.instantiate(this.template, this, this.setIndices);
            this.add(child);
        } else if (!this.willBeActive && this.isCurrentlyActive) {
            this.isCurrentlyActive = false;
            var child: CoreArea = this.children[0];
            this.remove(child);
            child.destroy();
        }
    }

    copyTransitionsToReferredIntersections(transitions: any, transitionSource: ElementReference): void {
        if (this.children.length === 1) {
            var child = this.children[0];
            if (child instanceof DisplayArea &&
                  child.display.getTransitions() === undefined) {
                child.copyTransitionsToReferredIntersections(transitions, transitionSource);
            }
        }
    }

    cleanUpUnusedEvaluationNodes(): number {
        return this.children.length === 0? 0:
               this.children[0].cleanUpUnusedEvaluationNodes();
    }

    cleanUpRemovedExportNodes(): void {
        if (this.children.length !== 0) {
            this.children[0].cleanUpRemovedExportNodes();
        }
    }
}

// Creates intersections or area set members for display areas
class SetChildController extends ChildController 
    implements ReceiveDataSourceResult, OrderingResultWatcherInterface
{
    parent: DisplayArea;
    dataEval: EvaluationNode;
    partnerEval: EvaluationNode;
    partners: {[areaId: string]: DisplayArea};
    childPos: {[areaId: string]: number} = undefined; // note: undefined indicates that data/partner have not been instantiated
    intersectionPartners: {[areaId: string]: IntersectionPartner};
    identifier2area: Map<any, CoreArea> = new Map<any, CoreArea>();
    nextData: Result;
    nextPartners: Result;
    useIdentity: boolean = true;

    constructor(childName: string, template: AreaTemplate, parent: CoreArea,
                parentSetIndices: string[],
                existenceQualifiers: SingleQualifier[][])
    {
        super(parent, childName, template, parentSetIndices, existenceQualifiers);
        this.dataSourceAware = true;
        if (existenceQualifiers) {
            this.setupExistenceQualifiers(existenceQualifiers);
        } else {
            this.setNextExistenceState(true);
        }
    }

    // If we add clearing out unwatched evaluation nodes on a regular basis,
    // dataEval and partnerEval can unwatch on deactivation, and reinstantiate
    // on reactivation to save some more memory.
    instantiateSetFunctions(): void {
        var dataFunction = this.parent.template.setFunctions[this.name].data;
        var partnerFunction = this.parent.template.setFunctions[this.name].partner;

        if (dataFunction !== undefined) {
            this.dataEval = getEvaluationNode(dataFunction, this.parent);
            if (!this.dataEval.isConstant()) {
                this.dataEval.addWatcher(this, "data", false, false, true);
            }
        }
        if (partnerFunction !== undefined) {
            this.partnerEval = getEvaluationNode(partnerFunction, this.parent);
            if (!this.partnerEval.isConstant()) {
                this.partnerEval.addWatcher(this, "partner", false, false, false);
            }
            this.partners = {};
            this.intersectionPartners = {};
        }
        this.childPos = {};
        if ((dataFunction !== undefined && !this.dataEval.isScheduled()) ||
            (partnerFunction !== undefined && !this.partnerEval.isScheduled())) {
            this.updateOutput();
        }
    }

    destroy(): void {
        this.setNextExistenceState(false);
        if (this.dataEval !== undefined) {
            this.dataEval.removeWatcher(this, false, true);
            this.dataEval = undefined;
            this.setDataResult(new Result());
            this.nextData = undefined;
        }
        if (this.partnerEval !== undefined) {
            this.partnerEval.removeWatcher(this, false, false);
            this.setPartners(new Result());
            assert(Utilities.isEmptyObj(this.intersectionPartners), "must remove all first");
            this.partnerEval = undefined;
            this.nextPartners = undefined;
            this.partners = undefined;
            this.intersectionPartners = undefined;
        }
        this.children = undefined;
        this.childPos = undefined;
        if (this.indexerTracer !== undefined) {
            this.indexerTracer.destroy();
            this.indexerTracer = undefined;
        }
        super.destroy();
    }

    // Called for updated to children
    updateInput(pos: any, result: Result): void {
        if (pos === "data") {
            this.nextData = result;
            this.useIdentity = !result.anonymize;
            if (result === undefined) {
                if (this.isCurrentlyActive) {
                    this.dataEval.deactivate(this, true);
                }
                this.dataEval.removeWatcher(this, false, true);
                this.dataEval = undefined;
            } else {
                this.markAsChanged();
            }
        } else if (pos === "partner") {
            this.nextPartners = result;
            if (result === undefined) {
                if (this.isCurrentlyActive) {
                    this.partnerEval.deactivate(this, false);
                }
                this.partnerEval.removeWatcher(this, false, false);
                this.partnerEval = undefined;
            } else {
                this.markAsChanged();
            }
        } else {
            super.updateInput(pos, result);
        }
    }

    addIntersectionChild(child: CoreArea): void {
        this.childPos[child.areaId] = this.children.length;
        this.children.push(child);
        child.setComment(this.parent.areaId + ":set:" + this.name);
        this.addElement(child);
        this.informWatchers();
    }

    removeIntersectionChild(child: CoreArea): void {
        var pos: number = this.childPos[child.areaId];

        delete this.childPos[child.areaId];
        this.children.splice(pos, 1);
        for (var areaId in this.childPos) {
            if (this.childPos[areaId] > pos) {
                this.childPos[areaId]--;
            }
        }
        this.removeElement(pos);
        this.informWatchers();
    }

    setNextExistenceState(state: boolean): void {
        this.willBeActive = state;
        if (state !== this.isCurrentlyActive) {
            if (state) {
                this.isCurrentlyActive = true;
                if (this.childPos === undefined) {
                    this.instantiateSetFunctions();
                }
                if (this.dataEval !== undefined) {
                    this.dataEval.activate(this, true);
                    if (this.dataEval.scheduledAtPosition !== -1) {
                        this.dataEval.forceUpdate(this, true);
                    }
                    this.nextData = this.dataEval.result;
                } else {
                    this.nextData = undefined;
                }
                if (this.partnerEval !== undefined) {
                    this.partnerEval.activate(this, false);
                    if (this.partnerEval.scheduledAtPosition !== -1) {
                        this.partnerEval.forceUpdate(this, true);
                    }
                    this.nextPartners = this.partnerEval.result;
                } else {
                    this.nextPartners = undefined;
                }
            } else {
                this.isCurrentlyActive = false;
                if (this.dataEval !== undefined) {
                    this.dataEval.deactivate(this, true);
                    this.nextData = new Result();
                }
                if (this.partnerEval !== undefined) {
                    this.partnerEval.deactivate(this, false);
                    this.nextPartners = new Result();
                }
            }
            this.markAsChanged();
        }
    }

    updateOutput(): void {
        var nextData: Result = this.nextData;
        var nextPartners: Result = this.nextPartners;

        this.nextData = undefined;
        this.nextPartners = undefined;
        if (nextData !== undefined) {
            this.setDataResult(nextData);
            if (this.dataEval !== undefined && "dataSource" in this.dataEval.result) {
                this.updateDataSourceChanges();
            }
        } else if (this.dataSourceInput !== undefined) {
            this.updateDataSourceChanges();
        } else if (nextPartners !== undefined) {
            this.setPartners(nextPartners);
        }
    }

    // When > 0, someone is creating areas.
    static creatingAreas: number = 0;

    /** Creates children based on value */
    setDataResult(result: Result): void {
        var data: any[] = result.value === undefined? []: result.value;
        var dataIds: any[] = result.value === undefined? undefined: result.identifiers;
        var prev: CoreArea = undefined;
        var areaIds: {[id: string]: boolean} = {};
        var childArea: CoreArea = undefined;
        var elements: ElementReference[] = [];

        // Returns a unique string that does not contain certain characters
        // (anything outside alphabetic characters, decimal digits, - _ . ! ~ *
        // ' ( and )), so these characters (e.g. space, & or +) can be used to
        // construct area ids that should not match an area id from an area set.
        function escapeString(id: string): string {
            return id; // typeof(id) === "number"? id: "<" + encodeURIComponent(id) + ">";
        }

        if (logValues && logPrototypes === undefined) {
            var abbrev: string = JSON.stringify(result.value);
            if (abbrev !== undefined && abbrev.length >= 150) {
                abbrev = abbrev.substr(0, 72) + " ... " + abbrev.substr(-72, 72);
            }
        }
        if (result.dataSource !== undefined) {
            this.setDataSource(result.dataSource);
            return;
        } else if (this.dataSourceInput !== undefined) {
            this.releaseDataSource();
        }
        SetChildController.creatingAreas++;
        if (data.length > 200) {
            Utilities.warnMessage(String(data.length) + " children for @" +
                                  this.parent.areaId + "." + this.name);
        }
        try {
            for (var i: number = 0, j: number = 0; i !== data.length; i++) {
                var v: any = data[i];
                var areaIdentifier: any =
                    this.useIdentity && dataIds !== undefined? dataIds[i]: j;
                if (!(areaIdentifier in areaIds)) {
                    // Only create or update areas for identifiers not yet seen
                    var areaSetContent: Result = new Result([v]);
                    if (dataIds !== undefined) {
                        areaSetContent.identifiers = [areaIdentifier];
                    }
                    areaIds[areaIdentifier] = true;
                    if (!this.identifier2area.has(areaIdentifier)) {
                        var setIndices: any[] = this.setIndices.concat(
                            escapeString(areaIdentifier));
                        childArea = this.template.isDisplayArea !== false?
                            new DisplayArea(this.template, this, setIndices,
                                            areaIdentifier, new Result([areaIdentifier]),
                                            areaSetContent, this.dataEval, j):
                            new CalculationArea(this.template, this, setIndices,
                                                areaIdentifier, new Result([areaIdentifier]),
                                                areaSetContent, this.dataEval, j);
                        childArea.setComment(this.parent.areaId + ":set:" + this.name);
                        childArea.finishInstantiation();
                        this.identifier2area.set(areaIdentifier, childArea);
                    } else {
                        // Update only if the value differs
                        childArea = this.identifier2area.get(areaIdentifier);
                        var paramAttr = childArea.param !== undefined? childArea.param.attr:
                                        new Result([areaIdentifier]);
                        childArea.updateSetData(paramAttr, areaSetContent);
                        childArea.updateSetPosition(this.dataEval, j);
                        // globalEventQueue.clearPtrInArea(childArea);
                    }
                    areaRelationMonitor.addRelation(childArea.areaId, "index", [j]);
                    if (prev === undefined) {
                        areaRelationMonitor.addRelation(childArea.areaId, "prev", []);
                    } else {
                        areaRelationMonitor.addRelation(childArea.areaId, "prev", [prev.areaReference]);
                        areaRelationMonitor.addRelation(prev.areaId, "next", [childArea.areaReference]);
                    }
                    elements.push(childArea.areaReference);
                    prev = childArea;
                    j++;
                } else {
                    childArea = this.identifier2area.get(areaIdentifier);
                    childArea.addSetDataSameId(v);
                }
            }
        } finally {
            SetChildController.creatingAreas--;
        }
        if (prev !== undefined) {
            areaRelationMonitor.addRelation(prev.areaId, "next", []);
        } else if (childArea !== undefined) {
            areaRelationMonitor.removeRelation(childArea.areaId, "next");
        }
        // Delete children no longer in area set
        this.identifier2area.forEach((childArea: DisplayArea, areaIdentifier: any): void => {
            if (!(areaIdentifier in areaIds)) {
                this.destroyChildArea(childArea, areaIdentifier);
            }
        }, this);
        this.replaceElements(elements);
    }

    destroyChildArea(childArea: DisplayArea, areaIdentifier: any): void {
        childArea.releaseDataSourceInput(this);
        // Clean up relations set by this controller
        areaRelationMonitor.removeRelation(childArea.areaId, "prev");
        areaRelationMonitor.removeRelation(childArea.areaId, "next");
        areaRelationMonitor.removeRelation(childArea.areaId, "index");
        // and destroy the area
        childArea.destroy();
        this.identifier2area.delete(areaIdentifier);
    }

    setPartners(result: Result): void {
        var newPartners: {[areaId: string]: DisplayArea} = {};
        var areaId: string;

        SetChildController.creatingAreas++;
        try {
            if (result.value !== undefined) {
                for (var i: number = 0; i < result.value.length; i++) {
                    var v: any = result.value[i];
                    if (v instanceof ElementReference) {
                        var er = <ElementReference> v;
                        areaId = er.getElement();
                        newPartners[areaId] = <DisplayArea> allAreaMonitor.getAreaById(areaId);
                    }
                }
            }
            for (areaId in newPartners) {
                var partner: DisplayArea = newPartners[areaId];
                if (!(areaId in this.partners)) {
                    if (chainsAllowIntersection(partner, this.parent, this.name)) {
                        var setIndex: any = partner.areaId;
                        var setIndices = this.setIndices.concat(setIndex);
                        this.addIntersectionPartner(partner, setIndices);
                    }
                } else {
                    assert(this.partners[partner.areaId] === partner, "check");
                }
            }
            for (areaId in this.partners) {
                if (!(areaId in newPartners)) {
                    this.removeIntersectionPartner(this.partners[areaId]);
                }
            }
            this.partners = newPartners;
        } finally {
            SetChildController.creatingAreas--;
        }
    }

    addIntersectionPartner(partner: DisplayArea, setIndices: any[]): void {
        if (!(partner.areaId in this.intersectionPartners)) {
            this.intersectionPartners[partner.areaId] =
                new IntersectionPartner(this, partner, setIndices);
        }
    }

    removeIntersectionPartner(partner: DisplayArea): void {
        if (partner.areaId in this.intersectionPartners) {
            var ip: IntersectionPartner = this.intersectionPartners[partner.areaId];
            ip.destroy();
            delete this.intersectionPartners[partner.areaId];
            assert(this.partners[partner.areaId] === partner, "check");
            delete this.partners[partner.areaId];
        }
    }

    makeAreaSetRepr(constraintName: string): Stackable {
        if (this.areaSetStackable === undefined) {
            var templateId: number =
                gPaidMgr.getTemplateId(this.parent, "stacking", this.name);
            var indexId: number = this.parent.getPersistentIndexId();

            var areaSetId: string = gPaidMgr.getAreaId(templateId, indexId);
            this.areaSetStackable = new AreaSetStackable(this, areaSetId);
        }
        return this.areaSetStackable;
    }

    removeAreaSetRepr(): void {
        if (this.areaSetStackable !== undefined) {
            this.areaSetStackable.destroy();
            this.areaSetStackable = undefined;
        }
    }

    // Data element interface

    // Note: Data source uses data element ids as identifier. That means that
    // cleaning up data or changing between data elements and raw data will
    // still work in tandem with setDataResult() when there no longer are data
    // elements, unless there is an overlap between identifiers and data element
    // ids. So TODO: identities for data elements.

    // Input for creating areas: one per element id
    dataSourceInput: DataSourceComposable;
    // Watches the input and relays (position) updates
    orderingResultWatcher: OrderingResultWatcher;
    // The merge indexer that contains the param for all areas 
    areaDataSource: DataSourceMergeUnderIdentityWithPath;

    setDataSource(dataSource: DataSourceComposable): void {
        if (this.dataSourceInput !== dataSource) {
            if (this.orderingResultWatcher !== undefined) {
                this.orderingResultWatcher.destroy();
                this.areaDataSource.deactivate();
                this.dataSourceInput.removeMergeUnderIdentityWithPathApplication(this.areaDataSource);
                this.areaDataSource.removeResultReceiver(this);
            }
            this.orderingResultWatcher =
                  new OrderingResultWatcher(globalInternalQCM, this, undefined);
            this.orderingResultWatcher.activate();
            this.dataSourceInput = dataSource;
            this.initializeAreaDataSource(dataSource);
            this.orderingResultWatcher.init(this.areaDataSource); // can trigger immediate callback
        }
    }

    initializeAreaDataSource(dataSource: DataSourceComposable): void {
        var areaDataSource = dataSource.applyMergeUnderIdentityWithPath("areaSetContent", this); 
        var mergeIndexer = areaDataSource.funcResult.indexer;
        var paramPaths: string[] = ["pointerInArea", "dragInArea", "areaSetAttr", "input"];
        var rootPathId: number = mergeIndexer.qcm.getRootPathId();

        for (var i = 0; i < paramPaths.length; i++) {
            var paramPathId: number = mergeIndexer.qcm.allocatePathId(rootPathId, paramPaths[i]);
            mergeIndexer.addPath(paramPathId);
            mergeIndexer.qcm.releasePathId(paramPathId);
        }
        this.areaDataSource = areaDataSource;
        areaDataSource.activate();
    }

    eltIDRefCount: Map<number, number> = new Map<number, number>();

    // Updates the value at a path under the root path; releases previously
    // allocated element when prevEltID is defined. Note that this removes the
    // data element on all paths, and won't work when there is an os of values
    // at a path.
    // Could be turned into a batch function
    updateAreaDataSource(eltID: number, attr: string, value: string|number|boolean, prevEltID: number): void {
        var mergeIndexer = this.areaDataSource.funcResult.indexer;
        var rootPath: PathNode = mergeIndexer.paths;

        function removeNodeAtAllPathsUnder(pathNode: PathNode, eltID: number): void {
            for (var childPathAttr in pathNode.children) {
                if (childPathAttr !== "areaSetContent") {
                    // areaSetContent is managed by the merge indexer itself
                    var childPathNode: PathNode =
                        pathNode.children[childPathAttr];
                    removeNodeAtAllPathsUnder(childPathNode, eltID);
                    mergeIndexer.removeNode(childPathNode, prevEltID);
                }
            }
        }

        if (eltID !== undefined) {
            if (!this.eltIDRefCount.has(eltID)) {
                if (!rootPath.nodes.has(eltID)) {
                    mergeIndexer.addDataElementNode(rootPath, eltID, undefined,
                                                    eltID, 0, eltID);
                } 
                this.eltIDRefCount.set(eltID, 1);
            } else {
                this.eltIDRefCount.set(eltID, this.eltIDRefCount.get(eltID) + 1);
            }
            this.updateAreaDataSourcePathValue(eltID, attr, value);
        }
        if (prevEltID !== undefined) {
            var prevRefCount: number = this.eltIDRefCount.get(prevEltID);
            if (prevRefCount === 1) {
                removeNodeAtAllPathsUnder(rootPath, prevEltID);
                this.eltIDRefCount.delete(prevEltID);
            } else {
                assert(prevRefCount > 1, "shouldn't happen");
                this.eltIDRefCount.set(prevEltID, prevRefCount - 1);
            }
        }
    }

    updateAreaDataSourcePathValue(eltID: number, attr: string, value: string|number|boolean): void {
        var mergeIndexer = this.areaDataSource.funcResult.indexer;
        var rootPath: PathNode = mergeIndexer.paths;
        var paramPathId: number = mergeIndexer.qcm.allocatePathId(rootPath.pathId, attr);
        var attrPathNode: PathNode = mergeIndexer.addPath(paramPathId);

        if (!attrPathNode.nodes.has(eltID)) {
            mergeIndexer.addNonDataElementNode(attrPathNode, eltID);
        }
        mergeIndexer.setKeyValue(attrPathNode, eltID, typeof(value), value);
        mergeIndexer.qcm.releasePathId(paramPathId);
    }

    releaseDataSource(): void {
        this.identifier2area.forEach((childArea: DisplayArea, areaIdentifier: any): void => {
            var prevEltID: number = childArea.getDataElementId();
            childArea.releaseDataSourceInput(this);
            this.updateAreaDataSource(undefined, "areaSetAttr", areaIdentifier, prevEltID);
        }, this);
        this.areaDataSource.deactivate();
        this.dataSourceInput.removeMergeUnderIdentityWithPathApplication(this.areaDataSource);
        this.areaDataSource.removeResultReceiver(this);
        this.areaDataSource = undefined;
        this.orderingResultWatcher.destroy();
        this.dataSourceInput = undefined;
        this.orderingResultWatcher = undefined;
    }

    refreshIndexerAndPaths(tag: any, dataObj: FuncResult): void {
        // nothing to do
    }

    replaceIndexerAndPaths(tag: any, prevPrefixPathId: number,
                           prefixPathId: number, dataObj: FuncResult): void {
        // nothing to do 
    }

    newDataSourceResult(v: any[]): void {
        Utilities.error("not expected to be called");
    }

    reextractData(dataSource: DataSourceComposable): void {
        Utilities.error("not expected to be called");
    }

    // When the identity is not used, the elementIds are immediately pushed to
    // the 
    updateDataElementPosition(elementIds: number[], firstOffset: number,
                              lastOffset: number, setSize: number): void {
        if (this.useIdentity) {
            this.markAsChanged();
            return;
        }
        if (elementIds.length !== this.identifier2area.size) {
            this.markAsChanged();
        }
        for (var i: number = 0; i !== elementIds.length; i++) {
            var eltID: number = elementIds[i];
            var areaIndex: number = firstOffset + i;
            if (this.identifier2area.has(areaIndex)) {
                var childArea = this.identifier2area.get(areaIndex);
                var prevEltID: number = childArea.getDataElementId();
                if (eltID !== prevEltID) {
                    childArea.updateDataElementID(eltID);
                    this.updateAreaDataSource(eltID, "areaSetAttr", areaIndex, prevEltID);
                }
            } else {
                this.markAsChanged();
                break;
            }
        }
    }

    updateDataSourceChanges(): void {
        var areaIds: {[id: string]: boolean} = {};
        var newDataElementIdsInOrder: number[] = this.orderingResultWatcher !== undefined?
            this.orderingResultWatcher.dataElementIdsInOrder: [];
        var childArea: CoreArea;
        var elements: ElementReference[] = [];
        var prev: CoreArea = undefined;

        if (newDataElementIdsInOrder.length > 200) {
            Utilities.warnMessage(String(newDataElementIdsInOrder.length) +
                " children for @" + this.parent.areaId + "." + this.name);
        }
        if (this.useIdentity && this.indexerTracer === undefined) {
            this.indexerTracer =
                 new IndexerTracer(this.areaDataSource.combinedIndexer,
                                   globalInternalQCM.getRootPathId(), this);
        } else if (!this.useIdentity && this.indexerTracer !== undefined) {
            this.indexerTracer.destroy();
            this.indexerTracer = undefined;
        }
        try {
            SetChildController.creatingAreas++;
            for (var i: number = 0; i !== newDataElementIdsInOrder.length; i++) {
                var eltID: number = newDataElementIdsInOrder[i];
                var areaIdentifier: any = this.useIdentity? this.getIdentity(eltID): i;
                if (!(areaIdentifier in areaIds)) {
                    // Only create or update areas for identifiers not yet seen
                    var setIndices: any[] = this.setIndices.concat(areaIdentifier);
                    var areaParam: Result;
                    areaIds[areaIdentifier] = true;
                    // Create the param areaSetAttr and areaSetContent values
                    // when the area is new or must be updated; otherwise it's
                    // only necessary to update its prev/next/index
                    if (!this.identifier2area.has(areaIdentifier)) {
                        // Create new area
                        areaParam = new Result(emptyDataSourceResult);
                        areaParam.dataSource = this.areaDataSource.
                            applyElementIdQuery([eltID], this, getNextWatcherId());
                        childArea = this.template.isDisplayArea !== false?
                            new DisplayArea(this.template, this,
                                            setIndices, areaIdentifier):
                            new CalculationArea(this.template, this,
                                                setIndices, areaIdentifier);
                        childArea.setComment(this.parent.areaId + ":set:" + this.name);
                        childArea.finishInstantiation();
                        childArea.setAreaParam(areaParam, eltID);
                        this.updateAreaDataSource(eltID, "areaSetAttr", areaIdentifier, undefined);
                        this.identifier2area.set(areaIdentifier, childArea);
                    } else {
                        // Update only if the value differs
                        childArea = this.identifier2area.get(areaIdentifier);
                        var prevEltID: number = childArea.getDataElementId();
                        if (eltID !== prevEltID) {
                            childArea.updateDataElementID(eltID);
                            this.updateAreaDataSource(eltID, "areaSetAttr", areaIdentifier, prevEltID);
                        }
                        globalEventQueue.clearPtrInArea(childArea);
                    }

                    // Update index/prev/next relations
                    areaRelationMonitor.addRelation(childArea.areaId, "index", [i]);
                    if (prev === undefined) {
                        areaRelationMonitor.addRelation(childArea.areaId, "prev", []);
                    } else {
                        areaRelationMonitor.addRelation(childArea.areaId, "prev", [prev.areaReference]);
                        areaRelationMonitor.addRelation(prev.areaId, "next", [childArea.areaReference]);
                    }
                    // update result of children query
                    elements.push(childArea.areaReference);
                    prev = childArea;
                }
            }
        } finally {
            SetChildController.creatingAreas--;
        }
        if (prev !== undefined) {
            areaRelationMonitor.addRelation(prev.areaId, "next", []);
        } else if (childArea !== undefined) {
            areaRelationMonitor.removeRelation(childArea.areaId, "next");
        }

        // Clean up unused areas
        this.identifier2area.forEach((childArea: DisplayArea, areaIdentifier: any): void => {
            if (!(areaIdentifier in areaIds)) {
                var prevEltID: number = childArea.getDataElementId();
                this.destroyChildArea(childArea, areaIdentifier);
                this.updateAreaDataSource(undefined, "areaSetAttr", areaIdentifier, prevEltID);
            }
        });
        // Update result and store current elt ids
        this.replaceElements(elements);
    }

    // Interface for tracing changes to the identities of the top level data
    // element ids

    indexerTracer: IndexerTracer = undefined;

    indexerUpdateKeys(elementIds: number[], types: string[], keys: SimpleValue[],
                      prevTypes: string[], prevKeys: SimpleValue[]): void {
        this.markAsChanged();
    }

    removeAllIndexerMatches(): void {
        // No action required: the matches have been removed
    }

    getIdentity(eltId: number): any {
        if (this.areaDataSource === undefined ||
              this.areaDataSource.combinedIndexer === undefined) {
            return eltId;
        }
        var key = this.areaDataSource.combinedIndexer.paths.nodes.get(eltId);
        return key !== undefined && (key.type === "string" || key.type === "number")?
               key.key: eltId;
    }

    // Debug interface

    explain(): any {
        var explanation: any = super.explain();

        if (this.dataEval !== undefined) {
            explanation["data: " + this.dataEval.debugName()] =
                this.dataEval.explain(undefined);
        }
        if (this.partnerEval !== undefined) {
            explanation["partner: " + this.partnerEval.debugName()] =
                this.partnerEval.explain(undefined);
        }
        return explanation;
    }

    copyTransitionsToReferredIntersections(transitions: any, transitionSource: ElementReference): void {
        for (var areaId in this.identifier2area) {
            var child: CoreArea = this.identifier2area.get(areaId);
            if (child instanceof DisplayArea && child.display.getTransitions() === undefined) {
                child.copyTransitionsToReferredIntersections(transitions, transitionSource);
            }
        }
        for (var partnerAreaId in this.intersectionPartners) {
            var intersectionPartner = this.intersectionPartners[partnerAreaId];
            if (intersectionPartner.intersectionArea instanceof DisplayArea &&
                  intersectionPartner.intersectionArea.display.getTransitions() === undefined) {
                if (this.template.embeddingInReferred) {
                    if (!intersectionPartner.intersectionArea.initializing) {
                        intersectionPartner.intersectionArea.debugTransitionSource = transitionSource;
                        intersectionPartner.intersectionArea.display.applyTransitionProperties(transitions);
                    }
                } else {
                    intersectionPartner.intersectionArea.copyTransitionsToReferredIntersections(transitions, transitionSource);
                }
            }
        }
    }

    cleanUpUnusedEvaluationNodes(): number {
        var nrCleanedUp: number = 0;

        for (var i: number = 0; i < this.children.length; i++) {
            nrCleanedUp += this.children[i].cleanUpUnusedEvaluationNodes();
        }
        this.identifier2area.forEach((childArea: DisplayArea): void => {
            nrCleanedUp += childArea.cleanUpUnusedEvaluationNodes();
        });
        return nrCleanedUp;
    }

    cleanUpRemovedExportNodes(): void {
        for (var i: number = 0; i < this.children.length; i++) {
            this.children[i].cleanUpRemovedExportNodes();
        }
        this.identifier2area.forEach(function(childArea: DisplayArea): void {
            childArea.cleanUpRemovedExportNodes();
        });
    }
}

class AreaIntersectionTrigger {
    intersection: IntersectionPartner;
    subTriggerValue: boolean[] = [];
    // offset: number[] = [];
    pairOffset: LabelPairOffset[] = [];
    posPair: PosPair[] = [];
    triggerValue: boolean = false;

    constructor(intersection: IntersectionPartner) {
        var myId = intersection.controller.parent.areaReference;
        var partnerId = intersection.referredArea.areaReference;
        var lceId = intersection.lce.areaReference;
        var triggerConf = [{
            point1: { type: "left", visibilityOf: myId, relativeTo: lceId },
            point2: { type: "right", visibilityOf: partnerId, relativeTo: lceId }
        }, {
            point1: { type: "left", visibilityOf: partnerId, relativeTo: lceId },
            point2: { type: "right", visibilityOf: myId, relativeTo: lceId }
        }, {
            point1: { type: "top", visibilityOf: myId, relativeTo: lceId },
            point2: { type: "bottom", visibilityOf: partnerId, relativeTo: lceId }
        }, {
            point1: { type: "top", visibilityOf: partnerId, relativeTo: lceId },
            point2: { type: "bottom", visibilityOf: myId, relativeTo: lceId }
        }];

        this.intersection = intersection;

        var areaId = { areaId: intersection.controller.parent.areaId };
        for (var i: number = 0; i !== triggerConf.length; i++) {
            this.posPair[i] = new PosPair(areaId, undefined, undefined, i);
            this.posPair[i].registerHandler(this);
            this.posPair[i].newDescription(triggerConf[i]);
        }
        globalGeometryTask.schedule();
        if (dbgCreateList !== undefined)
            dbgCreateList.push({cls:"AreaIntersectionTrigger",id:areaId});
    }

    destroy(): void {
        for (var i: number = 0; i < this.posPair.length; i++) {
            if (this.pairOffset[i] !== undefined) {
                this.pairOffset[i].destroy();
            }
            this.posPair[i].removeHandler(this);
            this.posPair[i].destroyPair();
        }
        globalGeometryTask.schedule();
    }
    
    // Callback from PosPair
    call(unused: any, posPair: PosPair, pairId: any): void {
        var offset: number;
        var offsetUpdated = false;

        assert(typeof(this.posPair[pairId]) !== "undefined", "call.1");
        assert(this.posPair[pairId] === posPair, "call.2");
        for (var i = 0; i <= 1; i++) {
            for (var l1 in posPair.changes) {
                var changesL1 = posPair.changes[l1];
                for (var l2 in changesL1) {
                    if (i === 0 && changesL1[l2] === "removed") {
                        assert(typeof(this.pairOffset[pairId]) !== "undefined", "err");
                        this.pairOffset[pairId].destroy();
                        delete this.pairOffset[pairId];
                        offset = undefined;
                        offsetUpdated = true;
                    } else if (i === 1 && changesL1[l2] === "added") {
                        assert(typeof(this.pairOffset[pairId]) === "undefined", "err");
                        var labelPairOffset = new LabelPairOffset(this, pairId, l1, l2);
                        this.pairOffset[pairId] = labelPairOffset;
                        offset = labelPairOffset.get();
                        // delay trigger update when offset is undefined
                        offsetUpdated = offset !== undefined;
                    }
                }
            }
        }
        if (offsetUpdated) {
            this.updateTriggerOffset(pairId, offset);
        }
    }

    // Called from labelPairOffset
    updateOffset(pairId: any, label1: string, label2: string, offset: number): void {
        this.updateTriggerOffset(pairId, offset);
    }

    updateTriggerOffset(pairId: any, offset: number): void {
        var subTriggerValue = typeof(offset) === "number" && offset >= 1;

        // this.offset[pairId] = offset;
        if (subTriggerValue !== this.subTriggerValue[pairId]) {
            this.subTriggerValue[pairId] = subTriggerValue;
            // recalculate the 'and' of the four booleans after each change -
            //  could be optimized, but probably insignificant
            this.recalcTrigger();
        }
    }

    recalcTrigger(): void {
        var triggerValue = true;

        if (this.posPair.length == 4) {
            for (var i = 0; i < this.posPair.length; i++) {
                if (this.subTriggerValue[i] !== true) {
                    triggerValue = false;
                    break;
                }
            }
            if (this.triggerValue !== triggerValue) {
                var oldTriggerValue = this.triggerValue;
                this.triggerValue = triggerValue;
                this.intersection.triggerUpdate(triggerValue);
                assert(oldTriggerValue !== this.triggerValue, "can't happen, can it?");
            }
        }
    }
}

function getLCE(a1: CoreArea, a2: CoreArea): CoreArea {
    var d1: number = a1.getEmbeddingDepth();
    var d2: number = a2.getEmbeddingDepth();
    var ml: number = Math.min(d1, d2);

    while (d1 > ml) {
        a1 = a1.embedding;
        d1--;
    }
    while (d2 > ml) {
        a2 = a2.embedding;
        d2--;
    }
    while (ml > 0 && a1 !== a2) {
        a1 = a1.embedding;
        a2 = a2.embedding;
        ml--;
    }
    return a1;
}

class IntersectionPartner {
    referredArea: DisplayArea;
    controller: SetChildController;
    lce: CoreArea;
    trigger: AreaIntersectionTrigger;
    intersectionArea: CoreArea;
    setIndices: any[];

    constructor(controller: SetChildController,
        referredArea: DisplayArea, setIndices: any[]) {
        this.controller = controller;
        this.referredArea = referredArea;
        this.lce = getLCE(referredArea, controller.parent);
        this.setIndices = setIndices;
        this.intersectionArea = undefined;
        this.referredArea.addIsReferredOf(controller);
        this.trigger = new AreaIntersectionTrigger(this);
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"IntersectionPartner"});
    }

    destroy(): void {
        this.referredArea.removeIsReferredOf(this.controller);
        this.trigger.destroy();
        if (this.intersectionArea !== undefined) {
            this.controller.removeIntersectionChild(this.intersectionArea);
            this.intersectionArea.destroy();
        }
    }

    triggerUpdate(trigger: boolean): void {
        if (trigger) {
            this.addIntersection();
        } else {
            this.removeIntersection();
        }
    }

    addIntersection(): void {
        this.intersectionArea = this.controller.template.isDisplayArea !== false?
            new DisplayArea(this.controller.template,
                this.controller, this.setIndices, undefined, undefined, undefined,
                undefined, undefined, this.referredArea):
            new CalculationArea(this.controller.template, this.controller,
                                this.setIndices, undefined, undefined, undefined,
                                undefined, undefined, this.referredArea);

        this.controller.addIntersectionChild(this.intersectionArea);

        // TODO: prev/next in intersections?
        this.intersectionArea.finishInstantiation();
    }

    removeIntersection(): void {
        if (this.intersectionArea !== undefined) {
            this.controller.removeIntersectionChild(this.intersectionArea);
            this.intersectionArea.destroy();
            this.intersectionArea = undefined;
        }
    }
}

var debugWrites: boolean = false;
var debugWritesEval: boolean = false;
var debugWritesString: boolean = true;
var gWriteAction: string = undefined;

// The ToMergeEvaluationNode doesn't have to say it's a watcher, since it
// doesn't look at the inputs: it grabs them from the underlying expressions
// the moment it has to write.
class ToMergeEvaluationNode implements Watcher {
    toExpression: EvaluationNode = undefined;
    mergeExpression: EvaluationNode = undefined;
    active: boolean = false;
    scheduleStep: number;
    watcherId: number;
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    attributedTime: number;
    writeNode: WriteTriggerNode = undefined;
    triggerValue: boolean = undefined;
    caseName: string = undefined;
    deferred: boolean = false;

    constructor(public tmNode: ToMergeNode, public localEvaluationEnv: EvaluationEnvironment) {
        this.watcherId = getNextWatcherId();
        this.scheduleStep = tmNode.scheduleStep;
        if (gProfile) {
            this.totalUpdateInputTime = 0;
            this.attributedTime = 0;
        }
        if (dbgCreateList !== undefined)
            dbgCreateList.push({cls:"ToMergeEvaluationNode",id:this.watcherId});
    }

    destroy(): void {
        if (this.active) {
            this.toExpression.deactivate(this, false);
            this.mergeExpression.deactivate(this, false);
            evaluationQueue.unhold(this);
        }
        if (this.toExpression !== undefined) {
            this.toExpression.removeWatcher(this, false, false);
            this.mergeExpression.removeWatcher(this, false, false);
            this.toExpression = undefined;
            this.mergeExpression = undefined;
        }
        this.active = false;
    }
    
    toString(): string {
        return "to-merge(" + this.writeNode.name + ", " + this.caseName + ")";
    }

    toMsgString(): string {
        return this.writeNode.name + ":" + this.caseName;
    }

    markForWrite(writeNode: WriteTriggerNode, triggerValue: boolean, caseName: string): void {
        this.writeNode = writeNode;
        this.triggerValue = triggerValue;
        if (this.toExpression === undefined) {
            this.toExpression = getEvaluationNode(this.tmNode.to, this.localEvaluationEnv);
            this.mergeExpression = getEvaluationNode(this.tmNode.merge, this.localEvaluationEnv);
            this.toExpression.addWatcher(this, 0, false, false, false);
            this.mergeExpression.addWatcher(this, 1, false, false, false);
        }
        this.caseName = caseName;
        this.toExpression.activate(this, false);
        this.mergeExpression.activate(this, false);
        this.active = true;
        evaluationQueue.hold(this);
    }

    unmarkForWrite(): void {
        this.toExpression.deactivate(this, false);
        this.mergeExpression.deactivate(this, false);
        this.active = false;
        evaluationQueue.unhold(this);
    }

    updateInput(pos: any, result: Result): void {
        if (this.active && debugWrites && debugWritesEval) {
            var value = result === undefined? undefined: result.value;
            gSimpleLog.log("update", this.writeNode.name, this.caseName, pos, vstringify(value));
        }
    }

    isActive(): boolean {
        return this.active;
    }

    isReady(): boolean {
        return (this.toExpression === undefined || !this.toExpression.deferred) &&
               (this.mergeExpression === undefined || !this.mergeExpression.deferred);
    }

    // TODO: always merges. Get info for atomic and push from where?
    commit(): void {
        if (this.toExpression.deferred || this.mergeExpression.deferred) {
            Utilities.error("result of a loop?");
            return;
        }
        if (this.toExpression.isQualified() &&
              this.mergeExpression.isQualified()) {
            var shouldBreak: boolean = this.shouldDebugBreak();
            var mergeAttributes: MergeAttributes = new MergeAttributes(
                this.mergeExpression.result.push,
                this.mergeExpression.result.atomic,
                this.mergeExpression.result.erase
            );
            if (debugWrites || shouldBreak)
                gSimpleLog.log("write", this.writeNode.name, this.caseName,
                            vstringify(this.mergeExpression.result.value),
                            "to", this.toExpression.prototype.idStr());
            if (shouldBreak)
                breakIntoDebugger();
            gWriteAction = this.writeNode.name + ":" + this.caseName;
            this.toExpression.write(this.mergeExpression.result, // apply removeEmptyOSFromAV?
                                   WriteMode.merge, mergeAttributes, undefined);
            gWriteAction = undefined;
        }
        this.mergeExpression.deactivate(this, false);
        this.toExpression.deactivate(this, false);
        this.active = false;
    }

    shouldDebugBreak(): boolean {
        // This bit is ugly, but I don't see the need to add more information
        // to the objects just to make this code a bit prettier
        var match = this.writeNode.name.match(/^@([0-9]+:[0-9]+):(.*)/);
        return shouldDebugBreak(match[1], match[2], this.caseName);
    }

    explain(classDebugInfo: AreaTemplateDebugInfo): any {
        var explanation: any = {};

        if (this.toExpression !== undefined) {
            explanation["to: " + this.toExpression.debugName()] =
                this.toExpression.explain(getATDBIAttr(classDebugInfo, "to"));
        }
        if (this.mergeExpression !== undefined) {
            explanation["merge: " + this.mergeExpression.debugName()] =
                this.mergeExpression.explain(getATDBIAttr(classDebugInfo, "merge"));
        }
        return explanation;
    }

    public undefer(): void {
        throw 'Should not be called';
    }

    public defer(): void {
        throw 'Should not be called';
    }

    public isDeferred(): boolean {
        return false;
    }

    debugName(): string {
        return "toMerge(" + this.caseName + ")";
    }

    getDebugOrigin(): string[] {
        return ["to merge " + this.caseName];
    }
}

class WriteTriggerNode implements Watcher, TimeSensitive {
    name: string;
    watcherId: number;
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    attributedTime: number;
    currentConditionValue: boolean = undefined;
    nextConditionValue: boolean = undefined;
    upon: EvaluationNode;
    // 0 represents upon:true:continuePropagation, 1 upon:false:continuePropagation
    continuePropagation: EvaluationNode[] = [undefined, undefined];
    whenBecomesTrue: {[name: string]: ToMergeEvaluationNode} = undefined;
    whenBecomesFalse: {[name: string]: ToMergeEvaluationNode} = undefined;
    scheduleStep: number;
    currentInput: any = undefined;
    isOnTimeQueue: boolean = false;
    prototype: WriteNode;
    local: EvaluationEnvironment;

    // The condition of WriteTriggerNodes are always active; the value for
    // continuePropagation can stay disabled, just like the to and merge
    // expressions
    constructor(name: string, wrNode: WriteNode, local: EvaluationEnvironment) {
        this.name = name;
        this.prototype = wrNode;
        this.local = local;
        this.watcherId = getNextWatcherId();
        this.upon = getEvaluationNode(wrNode.upon, local);

        var cp = [
            wrNode.whenBecomesTrue !== undefined? wrNode.whenBecomesTrue.continuePropagation: undefined,
            wrNode.whenBecomesFalse !== undefined? wrNode.whenBecomesFalse.continuePropagation: undefined
        ];
        for (var i = 0; i < cp.length; i++) {
            if (cp[i] !== undefined) {
                this.continuePropagation[i] = getEvaluationNode(cp[i], local);
                // Note: continuePropagation is ignored in updateInput
                this.continuePropagation[i].addWatcher(this, "continuePropagation", false, false, false);
            }
        }
        this.scheduleStep = wrNode.scheduleStep;
        if (gProfile) {
            this.totalUpdateInputTime = 0;
            this.attributedTime = 0;
        }
        if (!this.upon.isConstant()) {
            this.upon.addWatcher(this, "upon", false, false, false);
        } else {
            this.currentInput = this.upon.result.value;
            evaluationQueue.addTimeSensitiveNode(this);
        }
        if (dbgCreateList !== undefined)
            dbgCreateList.push({cls:"WriteTriggerNode",id:this.watcherId});
    }

    destroy(): void {
        evaluationQueue.removeTimeSensitiveNode(this);
        this.upon.removeWatcher(this, true, false);
        for (var i: number = 0; i < this.continuePropagation.length; i++) {
            if (this.continuePropagation[i] !== undefined) {
                this.continuePropagation[i].removeWatcher(this, true, false);
            }
        }
        for (var caseName in this.whenBecomesTrue) {
            this.whenBecomesTrue[caseName].destroy();
        }
        for (var caseName in this.whenBecomesFalse) {
            this.whenBecomesFalse[caseName].destroy();
        }
        this.upon = undefined;
        this.whenBecomesFalse = undefined;
        this.whenBecomesTrue = undefined;
    }

    toString(): string {
        return "writenode(" + this.name + ")";
    }

    initialize(): void {
        if (this.upon.isConstant()) {
            this.updateInput("upon", this.upon.result);
        } else {
            this.upon.activate(this, false);
            this.upon.forceUpdate(this, true);
        }
        for (var i: number = 0; i < this.continuePropagation.length; i++) {
            if (this.continuePropagation[i] !== undefined) {
                this.continuePropagation[i].activate(this, false);
            }
        }
    }

    // We ignore "continuePropagation", since only its actual value is relevant
    // at the moment of the write.
    updateInput(pos: any, result: Result): void {
        if (pos === "upon") {
            this.currentInput = result === undefined? undefined: result.value;
            evaluationQueue.addTimeSensitiveNode(this);
            if (isTrue(this.currentInput)) {
                if (this.whenBecomesTrue === undefined &&
                      this.prototype.whenBecomesTrue !== undefined &&
                      this.prototype.whenBecomesTrue.actions !== undefined) {
                    this.whenBecomesTrue = {};
                    for (var name in this.prototype.whenBecomesTrue.actions) {
                        this.whenBecomesTrue[name] = new ToMergeEvaluationNode(this.prototype.whenBecomesTrue.actions[name], this.local);
                    }
                }
            } else {
                if (this.whenBecomesFalse === undefined &&
                      this.prototype.whenBecomesFalse !== undefined &&
                      this.prototype.whenBecomesFalse.actions !== undefined) {
                    this.whenBecomesFalse = {};
                    for (var name in this.prototype.whenBecomesFalse.actions) {
                        this.whenBecomesFalse[name] = new ToMergeEvaluationNode(this.prototype.whenBecomesFalse.actions[name], this.local);
                    }
                }
            }
        }
    }

    isActive(): boolean {
        return true;
    }

    isReady(): boolean {
        return true;
    }

    public preWriteNotification(cycle: number): void {
        var cv: boolean = isTrue(this.currentInput);

        if (cv !== this.nextConditionValue) {
            var actions = cv? this.whenBecomesTrue: this.whenBecomesFalse;
            var cpIndex: number = cv? 0: 1;
            if (debugWrites)
                gSimpleLog.log("upon", this.name, "=", cv);
            for (var name in actions) {
                actions[name].markForWrite(this, cv, name);
            }
            if (this.nextConditionValue !== this.currentConditionValue) {
                var actions = this.nextConditionValue? this.whenBecomesTrue: this.whenBecomesFalse;
                for (var name in actions) {
                    actions[name].unmarkForWrite();
                }
            }
            if (this.currentConditionValue !== undefined) {
                // Do not abort message handler on first call (which is not 
                // triggered by an event, but by the initialization of the node)
                if (this.continuePropagation[cpIndex] === undefined) {
                    if (actions !== undefined) {
                        abortMessagePropagation(this.name + "(default)/" + cv, true);
                    }
                } else if (this.continuePropagation[cpIndex].result !== undefined &&
                           isFalseValue(this.continuePropagation[cpIndex].result.value)) {
                    abortMessagePropagation(this.name + "(explicit)/" + cv, false);
                }
            }
            this.nextConditionValue = cv;
            globalCommitWritesTask.schedule();
        }
    }

    public endOfEvaluationCycleNotification(cycle: number): void {
        this.currentConditionValue = this.nextConditionValue;
    }

    debugName(): string {
        return "write(" + this.name + ")";
    }

    explain(classDebugInfo: AreaTemplateDebugInfo): any {
        var explanation: any = {};
        var cDI: AreaTemplateDebugInfo;

        explanation["upon: " + this.upon.debugName()] = this.upon.explain(getATDBIAttr(classDebugInfo, "upon"));
        if (this.continuePropagation[0] !== undefined) {
            explanation["continuePropagation/false: " + this.continuePropagation[0].debugName()] =
                this.continuePropagation[0].explain(getATDBIAttr(classDebugInfo, "continuePropagation"));
        }
        if (this.continuePropagation[1] !== undefined) {
            explanation["continuePropagation/true: " + this.continuePropagation[1].debugName()] =
                this.continuePropagation[1].explain(getATDBIAttr(classDebugInfo, "continuePropagation"));
        }
        if (this.whenBecomesTrue !== undefined) {
            explanation["true"] = {};
            cDI = getATDBIAttr(classDebugInfo, "true");
            for (var name in this.whenBecomesTrue) {
                explanation["true"][name] = this.whenBecomesTrue[name].explain(getATDBIAttr(cDI, name));
            }
        }
        if (this.whenBecomesFalse !== undefined) {
            explanation["false"] = {};
            cDI = getATDBIAttr(classDebugInfo, "false");
            for (var name in this.whenBecomesFalse) {
                explanation["false"][name] = this.whenBecomesFalse[name].explain(getATDBIAttr(cDI, name));
            }
        }
        return explanation;
    }

    defer(): void {
        throw "Should not be called";
    }

    undefer(): void {
        throw "Should not be called";
    }

    isDeferred(): boolean {
        return false;
    }

    getDebugOrigin(): string[] {
        return ["child controller " + this.name];
    }
}

var debugAreaConstruction: boolean = false;

class AreaPositionTree {

    top: number;
    left: number;
    width: number;
    height: number;
    z: number;

    id: string;
    embedding: AreaPositionTree;
    embedded: AreaPositionTree[];

    constructor(id: string, pos: Relative, offsets: EdgeRect, z: number, embedding: AreaPositionTree) {
        if (pos !== undefined) {
            this.id = id;
            this.embedding = embedding;
            this.embedded = [];
            if ("left" in offsets) {
                this.left = pos.left + offsets.left;
                this.top = pos.top + offsets.top;
                this.width = pos.width - offsets.left - offsets.right;
                this.height = pos.height - offsets.top - offsets.bottom;
            } else {
                this.top = pos.top;
                this.left = pos.left;
                this.width = pos.width;
                this.height = pos.height;
            }
            if (embedding !== undefined) {
                this.top += embedding.top;
                this.left += embedding.left;
            }
            this.z = z;
        }
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"AreaPositionTree",id:this.id});
    }

    getOverlappingAreas(): void {
    }

    overlaps(ap: AreaPositionTree): boolean {
        return this.left + this.width > ap.left && ap.left + ap.width > this.left &&
               this.top + this.height > ap.top && ap.top + ap.height > this.top;
    }

    contains(ap: AreaPositionTree): boolean {
        return this.left <= ap.left && ap.left + ap.width <= this.left + this.width &&
               this.top <= ap.top && ap.top + ap.height <= this.top + this.height;
    }
}

// Is incremented every time an area is created or destroyed. This can serve as
// an indication that area dependent cache has become invalid.
var areaChangeCounter: number = 0;


abstract class CoreArea
implements
    Watcher,
    Producer,
    EvaluationEnvironment,
    Stackable,
    PersistenceTemplateIndexProvider
{
    // Definition of a core area
    template: AreaTemplate;
    setIndices: any[];
    embedding: CoreArea;
    intersectionChain: IntersectionChain;

    // Run-time environment of a core area
    controller: ChildController;
    param: { attr: any; data: Result; source: EvaluationNode; position: number; };

    /** External referencing to this core area; undefined when this areas has
     * been destroyed */
    areaReference: ElementReference;
    areaId: string;
    tAreaId: string;
    persistentTemplateId: number;
    persistentIndexId: number;

    // Children
    children: {[childName: string]: ChildController} = {};
    childAreaWatchers: {[childName: string]: WatcherMap};
    isReferredOf?: {[expressionAreaId: string]: {[childName: string]: SetChildController}};

    // EvaluationEnvironment
    evaluationNodes: EvaluationNode[][];
    exports: {[exportId: number]: EvaluationNode} = undefined;
    parentsByTemplateId: {[templateId: number]: EvaluationEnvironment};
    localToDefun: number = 0;

    // Attributes controlling the appearance
    position: {[name: string]: EvaluationNode};

    // Writes
    writes: {[name: string]: WriteTriggerNode};

    // Controls pointerInArea propagation. When undefined, it should be
    // interpreted as {embedding: true}.
    propagatePointerInArea: {[attr: string]: boolean};

    // Watcher
    watcherId: number;
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    attributedTime: number;

    static nextSeqAreaId: number = 1;
    seqId: number;
    comment: string;

    result: Result;

    static instantiate(areaTemplate: AreaTemplate, controller: ChildController, setIndices: any[]): CoreArea {
        var area = areaTemplate.isDisplayArea !== false?
            new DisplayArea(areaTemplate, controller, setIndices, undefined):
            new CalculationArea(areaTemplate, controller, setIndices, undefined);
        var t0: number;

        if (gProfile) {
            t0 = performance.now();
        }
        area.finishInstantiation();
        if (gProfile) {
            area.attributedTime += performance.now() - t0;
        }
        return area;
    }

    constructor(template: AreaTemplate, controller: ChildController,
                setIndices: any[],
                areaIdentifier: any,
                paramAttr: Result = undefined,
                paramData: Result = undefined,
                source: EvaluationNode = undefined,
                position: number = undefined,
                referred: CoreArea = undefined) {
        this.setIndices = setIndices;
        this.makeAreaId(template, controller, areaIdentifier, referred);
        this.tAreaId = String(template.id) + ":" + setIndices.join(".");
        this.areaReference = new ElementReference(this.areaId);
        this.seqId = CoreArea.nextSeqAreaId++;
        this.template = template;
        this.controller = controller;
        this.watcherId = getNextWatcherId();
        this.evaluationNodes = [new Array<EvaluationNode>(template.functionNodes.length)];
        this.result = new Result([this.areaReference]);
        if (this.template.exports !== undefined) {
            this.exports = {};
            for (var exportId in this.template.exports) {
                this.exports[exportId] = undefined;
            }
        }
        if (gProfile) {
            this.totalUpdateInputTime = 0;
            this.attributedTime = 0;
        }

        if (paramAttr !== undefined) {
            this.param = {
                attr: paramAttr.value,
                data: paramData,
                source: source,
                position: position
            };
        }

        if (template.embeddingInReferred) {
            assert(referred !== undefined, "should not happen");
            this.embedding = referred;
            referred.addEmbeddedReferred(this);
        } else {
            this.embedding = controller !== undefined? controller.parent: undefined;
        }

        areaRelationMonitor.addArea(this.areaId);
        allAreaMonitor.addArea(this);

        if (referred) { // this indicates that this is an intersection area
            var parent = <DisplayArea> controller.parent; // parent and referred area always DisplayArea
            this.setIntersectionParents(parent, <DisplayArea> referred, controller.name);
        }

        if (debugAreaConstruction)
            gSimpleLog.log("create", "@" + this.areaId, this.tAreaId);
        if (gDomEvent !== undefined) {
            gDomEvent.recordComment("create @" + this.areaId + " " + this.tAreaId);
        }
        areaChangeCounter++;
    }

    destroy(): void {
        var embeddingArea = this.embedding;

        if (debugAreaConstruction)
            gSimpleLog.log("destroy", "@" + this.areaId, this.tAreaId);
        gDomEvent.recordComment("destroy @" + this.areaId + " " + this.tAreaId);

        if (this.template.embeddingInReferred) {
            embeddingArea.removeEmbeddedReferred(this);
        }
        for (var childName in this.children) {
            this.children[childName].destroy();
            delete this.children[childName];
        }
        if (this.intersectionChain !== undefined) {
            this.removeIntersection();
        }
        for (var childName in this.children) {
            this.children[childName].destroy();
            delete this.children[childName];
        }
        this.areaReference = undefined;
        this.result = undefined;
        this.informWatchers();
        this.removeWatchers();
        allAreaMonitor.removeArea(this);
        areaOverlapMonitor.removeArea(this.areaId);
        this.removeRelations();
        areaChangeCounter++;
    }

    finishInstantiation(): void {
        this.addWatchers();
        this.addRelations();
        this.instantiateChildren();
    }

    link(): CoreArea {
        return this;
    }

    unlink(): void {
    }

    makeAreaId(template: AreaTemplate, controller: ChildController,
               areaIdentifier: any, referred: CoreArea): void
    {
        var type: string;
        var parent: CoreArea = controller === undefined? undefined:
                               controller.parent;
        var areaIdentifierStr: string = undefined;

        // screen-area
        if (parent === undefined) {
            this.persistentTemplateId = gPaidMgr.getScreenAreaTemplateId();
            this.persistentIndexId = gPaidMgr.getScreenAreaIndexId();
            this.areaId = gPaidMgr.getScreenAreaId();
            return;
        }

        // detect type
        if (areaIdentifier !== undefined) {
            type = "set";
            areaIdentifierStr = String(areaIdentifier);
        } else if (referred !== undefined) {
            type = "intersection";
        } else {
            type = "single";
        }

        var childSection: string = template.childName;

        this.persistentTemplateId =
            gPaidMgr.getTemplateId(parent, type, childSection, referred);
        this.persistentIndexId = gPaidMgr.getIndexId(
            parent, type, areaIdentifierStr, referred);
        this.areaId = gPaidMgr.getAreaId(
            this.persistentTemplateId, this.persistentIndexId);
    }

    getParent(): EvaluationEnvironment {
        return this.controller === undefined? undefined: this.controller.parent;
    }

    getParentWithTemplateId(id: number): EvaluationEnvironment {
        return this.parentsByTemplateId[id];
    }

    getEmbedding(): CoreArea {
        return this.embedding;
    }

    getPathFromScreenArea(): string[] {
        var ptr: CoreArea = this;
        var path: string[] = [];

        while (ptr.controller !== undefined) {
            path.push(ptr.template.childName);
            ptr = ptr.controller.parent;
        }
        return path.reverse();
    }

    abstract addEmbeddedReferred(area: CoreArea): void;

    abstract removeEmbeddedReferred(area: CoreArea): void;

    // Interface to the rest of the system

    getRelation(relation: string): any[] {
        throw new Error("Should not be called");
    }

    isAreaSetMember(): boolean {
        return this.param !== undefined;
    }

    isIntersection(): boolean {
        return this.intersectionChain !== undefined;
    }

    getIntersectionChain(): IntersectionChain {
        return this.intersectionChain;
    }

    setIntersectionParents(expression: DisplayArea, referred: DisplayArea, intersectionName: string): void {
        this.intersectionChain =
        new IntersectionChain(expression, referred, intersectionName);
        areaRelationMonitor.addRelation(this.areaId, "expressionOf",
            [expression.areaReference]);
        areaRelationMonitor.addRelation(this.areaId, "referredOf",
            [referred.areaReference]);
        areaRelationMonitor.addRelation(this.areaId, "intersectionParentOf",
            [expression.areaReference, referred.areaReference]);
    }

    getIntersectionParents(): ElementReference[] {
        return this.intersectionChain === undefined? undefined:
               [this.intersectionChain.expressionArea.areaReference,
                this.intersectionChain.referredArea.areaReference];
    }

    getExpressionParent(): ElementReference {
        return this.intersectionChain === undefined? undefined:
               this.intersectionChain.expressionArea.areaReference;
    }

    getReferredParent(): ElementReference {
        return this.intersectionChain === undefined? undefined:
               this.intersectionChain.referredArea.areaReference;
    }

    removeIntersection() {
        areaRelationMonitor.removeRelation(this.areaId, "expressionOf");
        areaRelationMonitor.removeRelation(this.areaId, "referredOf");
        areaRelationMonitor.removeRelation(this.areaId, "intersectionParentOf");
        this.intersectionChain = undefined;
    }

    initWatchers(): void {
        var localEvaluationNodes: EvaluationNode[] = this.evaluationNodes[0];
        var paramInitValue: any = {pointerInArea: [false], dragInArea: [false]};

        if (localEvaluationNodes[0] !== undefined) {
            return;
        }

        // Build param: needed to store parameter values like ptrInArea and
        // areaSetContent, even if the node isn't used.
        var paramNode = <EvaluationParam>
            getEvaluationNode(this.template.functionNodes[areaParamIndex], this);
        if (this.param !== undefined) {
            // Add area set attribute and content to initial value
            paramInitValue.areaSetAttr = this.param.attr;
            paramInitValue.areaSetContent = this.param.data.value;
            paramNode.setSource(this.param.source, this.param.position);
            paramNode.set(new Result([paramInitValue]));
        }
    }

    addWatchers(): void {
        this.initWatchers();

        if (this.template.positionFunctions !== undefined) {
            this.position = {};
            for (var name in this.template.positionFunctions) {
                var evNode = getEvaluationNode(this.template.positionFunctions[name], this);
                this.position[name] = evNode;
                if (evNode.isConstant()) {
                    this.setPosition(name, evNode.result.value);
                } else {
                    evNode.addWatcher(this, ["position", name], true, true, false);
                }
            }
        }

        if (this.template.writeFunctions !== undefined) {
            this.writes = {};
            for (var name in this.template.writeFunctions) {
                this.writes[name] =
                    buildWriteTriggerNode(this.template.writeFunctions[name], this,
                                          "@" + this.areaId + ":" + name);
            }
        }
    }

    removeWatchers(): void {
        if (this.exports !== undefined && this.exports[0] !== undefined) {
            this.exports[0].removeWatcher(this, false, false);
        }
        for (var name in this.template.writeFunctions) {
            this.writes[name].destroy();
        }
        if (this.position !== undefined) {
            for (var name in this.position) {
                this.position[name].removeWatcher(this, true, false);
            }
        }
        var localEvaluationNodes: EvaluationNode[] = this.evaluationNodes[0];
        for (var i: number = localEvaluationNodes.length - 1; i >= 0; i--) {
            var en: EvaluationNode = localEvaluationNodes[i];
            if (en !== undefined) {
                en.destroy();
            }
        }
        // make sure no-one can access old EvaluationNodes while constructing
        // new ones: setting the length to 0 will cause a crash if it is
        // attempted on a stale pointer to this area's evaluationNodes.
        localEvaluationNodes.length = 0;
        this.evaluationNodes.length = 0;
        this.evaluationNodes = undefined;
    }

    hasBeenDestroyed(): boolean {
        return this.result === undefined;
    }

    cleanUpUnusedEvaluationNodes(): number {
        var localEvaluationNodes: EvaluationNode[] = this.evaluationNodes[0];
        var nrCleanedUp: number = 0;

        // First clean up children: they can watch nodes in localEvaluationNodes
        for (var childName in this.children) {
            nrCleanedUp += this.children[childName].cleanUpUnusedEvaluationNodes();
        }
        for (var i: number = localEvaluationNodes.length - 1; i > areaParamIndex; i--) {
            var en: EvaluationNode = localEvaluationNodes[i];
            // Don't destroy constants: their watcher lists are empty, even
            // though their value might be needed, and they cost very little to
            // keep around.
            if (en !== undefined && !en.isConstant()) {
                if (en.watchers !== undefined && en.watchers.size === 0) {
                    en.destroy();
                    localEvaluationNodes[i] = undefined;
                    nrCleanedUp++;
                } else if (en instanceof EvaluationVariant ||
                           en instanceof EvaluationVariant1 ||
                           en instanceof EvaluationBoolGate ||
                           en instanceof EvaluationCond) {
                    en.removeWatcherFromInactiveNodes();
                }
            }
        }
        return nrCleanedUp;
    }

    cleanUpRemovedExportNodes(): void {
        for (var childName in this.children) {
            this.children[childName].cleanUpRemovedExportNodes();
        }
        for (var exportId in this.exports) {
            var exportNode = this.exports[exportId];
            if (exportNode !== undefined && exportNode.watchers === undefined) {
                this.exports[exportId] = undefined;
            }
        }
    }

    // Note that these functions do not support switching embedding.
    // Note that this function is called before any child area is instantiated.
    addRelations(): void {
        if (this.controller !== undefined) {
            areaRelationMonitor.addRelation(this.areaId, "embedding",
                [this.embedding.areaReference]);
            areaRelationMonitor.addMultiRelation(this.embedding.areaId,
                "embedded", this.areaId, this.areaReference);
            var ptr: CoreArea = this.embedding;
            while (ptr !== undefined) {
                areaRelationMonitor.addMultiRelation(this.areaId, "embeddingStar",
                    ptr.areaId, ptr.areaReference);
                areaRelationMonitor.addMultiRelation(ptr.areaId, "embeddedStar",
                    this.areaId, this.areaReference);
                ptr = ptr.embedding;
            }
        }
    }

    removeRelations(): void {
        if (this.controller !== undefined) {
            areaRelationMonitor.removeRelation(this.areaId, "embedding");
            areaRelationMonitor.removeMultiRelation(this.embedding.areaId,
                "embedded", this.areaId);
            var ptr: CoreArea = this.embedding;
            while (ptr !== undefined) {
                areaRelationMonitor.removeMultiRelation(
                    this.areaId, "embeddingStar", ptr.areaId);
                areaRelationMonitor.removeMultiRelation(
                    ptr.areaId, "embeddedStar", this.areaId);
                ptr = ptr.embedding;
            }
        }
        areaRelationMonitor.removeArea(this.areaId);
    }

    getExport(exportId: number): EvaluationNode {
        if (exportId in this.template.exports &&
            this.exports[exportId] === undefined) {
            this.exports[exportId] = getEvaluationNode(this.template.exports[exportId], this);
        }
        return this.exports[exportId];
    }

    updateInput(pos: any, result: Result): void {
        switch (pos[0]) {
            case "position":
                this.setPosition(pos[1], result.value);
                break;
            case "stacking":
                this.setStacking(pos[1], result.value);
                break;
            default:
                Utilities.error("area " + this.areaId + "; unknown update position: " + pos);
                break;
        }
    }

    isActive(): boolean {
        return true;
    }

    isReady(): boolean {
        return true;
    }

    abstract setPosition(name: string, value: any): void;

    abstract setStacking(name: string, value: any): void;

    // Interface with input element. Overridden in DisplayArea

    abstract canReceiveFocus(): boolean;

    abstract canLoseFocus(): boolean;

    abstract takeFocus(): void;

    abstract releaseFocus(): void;

    abstract willHandleClick(): boolean;

    abstract getInputChanges(): {[attr: string]: any}|undefined;

    abstract updateParamInput(changes: {[attr: string]: any}, userInitiated: boolean,
                              checkExistence: boolean): void;

    updateParam(attr: string, value: any): void {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];
        var lastParamUpdate: any = paramNode.latchedValue !== undefined?
            paramNode.latchedValue.value[0]: paramNode.lastUpdate.value[0];

        if ("dataSource" in paramNode.result) {
            var controller = <SetChildController> this.controller;
            controller.updateAreaDataSourcePathValue(this.dataElementId, attr, getDeOSedValue(value));
        } else if (lastParamUpdate === undefined ||
                   !valueEqual(lastParamUpdate[attr], value)) {
            var paramValue: any = lastParamUpdate !== undefined?
                                  shallowCopyMinus(lastParamUpdate, attr): {};
            paramValue[attr] = value;
            paramNode.latchedValue = new Result([paramValue]);
            paramNode.latch();
            globalCommitWritesTask.schedule();
        }
    }

    abstract setInputState(attrib: string, value: any): boolean;

    // Implementation of EvaluationEnvironment

    getOwnId(): string {
        return this.areaId;
    }

    getTemplate(): AreaTemplate {
        return this.template;
    }

    getTemplateId(): number {
        return this.template.id;
    }

    abstract getPos(): Relative;

    abstract getOffsets(): EdgeRect;

    getEmbeddingDepth(): number {
        var depth: number = 0;
        var ptr: CoreArea = this.embedding;

        while (ptr !== undefined) {
            depth++;
            ptr = ptr.embedding;
        }
        return depth;
    }

    // Functions to inform EvaluationChildControllers
    addChildAreaWatcher(childName: string, watcher: Watcher, pos: any, childUnderDestruction: boolean): void {
        if (!childUnderDestruction && childName in this.children) {
            this.children[childName].addWatcher(watcher, pos);
        } else {
            if (this.childAreaWatchers === undefined) {
                this.childAreaWatchers = {};
            }
            if (!(childName in this.childAreaWatchers)) {
                this.childAreaWatchers[childName] =
                    new Map<number, {watcher: Watcher; pos: any[];}>();
            }
            var producer = this.childAreaWatchers[childName];
            if (producer.has(watcher.watcherId)) {
                producer.get(watcher.watcherId).pos.push(pos);
            } else {
                producer.set(watcher.watcherId, {
                    watcher: watcher,
                    pos: [pos]
                });
            }
        }
    }

    getChildAreas(childName: string): Result {
        return childName in this.children ?
            this.children[childName].result : undefined;
    }

    // assuming that it has been added before
    removeChildAreaWatcher(childName: string, watcher: Watcher): void {
        if (childName in this.children) {
            this.children[childName].removeWatcher(watcher, false);
        } else if (this.childAreaWatchers !== undefined) {
            this.childAreaWatchers[childName].delete(watcher.watcherId);
        }
    }

    updateDisplay(): void {
    }

    updateVisuals(): void {
    }

    wrapupUpdateVisuals(): void {
    }

    hasNoPosition(): boolean {
        return false;
    }

    getAbsPreviousPosition(): Rect {
        return undefined;
    }

    interpolatePreviousPosition(): void {
    }

    setZIndex(frameZ: any, displayZ: any): void {
        assert(false, "not applicable");
    }

    getFrameDiv(): HTMLDivElement {
        assert(false, "not applicable");
        return undefined;
    }

    getZArea(): ZArea {
        return undefined;
    }

    getZAreaRep(): ZArea {
        return undefined;
    }

    // set data: areaSetContent and areaSetAttr

    updateSetData(attr: any, data: Result): void {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];
        var lastParamUpdate: any = paramNode.lastUpdate.value !== undefined?
                                   paramNode.lastUpdate.value[0]: undefined;
        var paramValue: any = lastParamUpdate !== undefined?
                              shallowCopy(lastParamUpdate): {};
        var change: boolean = false;

        if (this.param === undefined) {
            change = true;
            this.param = {
                attr: attr,
                data: data,
                source: undefined,
                position: undefined
            };
            paramValue.areaSetAttr = attr;
            paramValue.areaSetContent = data.value;
        } else {
            if (!valueEqual(this.param.attr, attr)) {
                change = true;
                this.param.attr = attr;
                paramValue.areaSetAttr = attr;
            }
            if (!data.equal(this.param.data)) {
                change = true;
                this.param.data = data;
                paramValue.areaSetContent = data.value;
            }
        }
        if (paramNode.isLatched && change) {
            var latchedValue = paramNode.latchedValue.value[0];
            latchedValue.areaSetAttr = attr;
            latchedValue.areaSetContent = data.value;
        }
        if (change) {
            paramNode.set(new Result([paramValue]));
        }
    }

    updateSetPosition(src: EvaluationNode, position: number): void {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];

        this.param.position = position;
        paramNode.setSource(src, position);
    }

    addSetDataSameId(value: any): void {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];

        paramNode.pushToAreaSetContent(value);
    }

    getAreaParam(): Result {
        return this.evaluationNodes[0][areaParamIndex].result;
    }

    dataElementId: number = undefined;

    setAreaParam(paramResult: Result, dataElementId: number): void {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];

        this.dataElementId = dataElementId;
        if (this.param === undefined) {
            this.param = {
                attr: undefined,
                data: undefined,
                source: undefined,
                position: undefined
            };
        }
        this.param.attr = dataElementId;
        this.param.data = undefined;
        paramNode.set(paramResult);
    }

    updateDataElementID(dataElementId: number): void {
        var areaParam = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];

        areaParam.updateDataElementIds([dataElementId]);
        this.dataElementId = dataElementId;
    }

    getDataElementId(): number {
        return this.dataElementId;
    }

    // Interface to the rest of the system

    getAreaId(): string {
        return this.areaId;
    }

    getPersistentTemplateId(): number {
        return this.persistentTemplateId;
    }

    getPersistentIndexId(): number {
        return this.persistentIndexId;
    }

    getChildName(): string {
        return this.template.childName;
    }

    setComment(str: string) {
        this.comment = str;
    }

    instantiateChildren(): void {
        for (var childName in this.template.children) {
            var childTemplate = this.template.children[childName];
            if (this.children === undefined)
                this.children = {};
            if (this.template.setFunctions !== undefined &&
                childName in this.template.setFunctions) {
                this.children[childName] = new SetChildController(
                    childName, childTemplate, this, this.setIndices,
                    childTemplate.existenceQualifiers);
            } else {
                this.children[childName] = new StaticChildController(
                    this, childName, childTemplate, this.setIndices,
                    childTemplate.existenceQualifiers);
            }
            if (this.childAreaWatchers !== undefined && childName in this.childAreaWatchers) {
                this.children[childName].setWatchers(this.childAreaWatchers[childName]);
                delete this.childAreaWatchers[childName];
            }
        }
    }

    getEmbeddedAreaList(): CoreArea[] {
        return areaRelationMonitor.getRelation(this.areaId, "embedded").map(
            function(areaRef: ElementReference): CoreArea {
                return allAreaMonitor.getAreaById(areaRef.getElement());
            });
    }

    explain(forceActive: boolean): any {
        var explanation: any = {};
        var classDebugInfo: AreaTemplateDebugInfo =
            typeof(areaDebugInfo) === "undefined"? undefined:
            areaDebugInfo[this.template.id];
        var cDI: AreaTemplateDebugInfo;

        EvaluationNode.resetExplainFunctionNodes();
        this.getInheritExplanation(explanation);
        if (this.exports !== undefined && 0 in this.exports) {
            if (this.exports[0] === undefined) {
                this.getExport(0);
            }
            explanation.classes = this.explainClasses();
        }
        for (var childName in this.children) {
            var child = this.children[childName];
            if (explanation.children === undefined) {
                explanation.children = {};
            }
            explanation.children[childName] = child.explain();
        }
        if (this.position !== undefined) {
            explanation.position = {};
            cDI = getATDBIAttr(classDebugInfo, "position");
            for (var name in this.position)
                explanation.position[name + ": " + this.position[name].debugName()] =
                this.position[name].explain(getATDBIAttr(cDI, name));
        }
        if (this.exports !== undefined) {
            explanation.exports = {};
            for (var exportId in this.exports) {
                if (this.exports[exportId] !== undefined) {
                    var exportName: string = exportId === "0"? "class membership":
                                             exportPaths[exportId].join(".");
                    explanation.exports[exportId + ": " + exportName + "=" +
                                        this.exports[exportId].debugName()] =
                        this.exports[exportId].explain(undefined);
                } else {
                    explanation.exports[exportId] = "<<unwatched>>";
                }
            }
        }
        explanation.param = stripArray(this.evaluationNodes[0][areaParamIndex].result.value, true);
        if (this.template.id in debugAreaInfo) {
            var context = debugAreaInfo[this.template.id].context;
            explanation.context = {};
            cDI = getATDBIAttr(classDebugInfo, "context");
            for (var attr in context) {
                var fnRef = context[attr];
                if (fnRef.index !== -1) {
                    var en: EvaluationNode = this.getExprByFNRef(fnRef, forceActive);
                    if (en === undefined) {
                        explanation.context[attr] = undefined;
                    } else {
                        var contextCDI = getATDBIAttr(cDI, attr);
                        var contextAttrExpl = en.explain(contextCDI);
                        explanation.context[attr + " = " + en.debugName()] = contextAttrExpl;
                        if ("_definedIn" in contextAttrExpl) {
                            var values: number[] = contextCDI.values;
                            var className: string =
                                values === undefined || values.length === 0?
                                    undefined:
                                allValuesIdentical(values.map(getDeepestDefiningClass))?
                                    getDeepestDefiningClass(values[0]):
                                    "_mixed";
                            if (className === undefined) {
                                className = "<<unknown>>";
                            } else {
                                var libConfPos: number = className.search("::");
                                if (libConfPos >= 0) {
                                    className = className.slice(libConfPos + 2);
                                }
                            }
                            if (explanation.classes === undefined) {
                                explanation.classes = {};
                            }
                            if (!(className in explanation.classes)) {
                                explanation.classes[className] = {
                                    membership: "<<unknown>>"
                                }
                            }
                            if (!("context" in explanation.classes[className])) {
                                explanation.classes[className].context = {};
                            }
                            explanation.classes[className].context[attr + " = " + en.debugName()] = contextAttrExpl;
                        }
                    }
                }
            }
            if (debugAreaInfo[this.template.id].content !== undefined) {
                var fnRef = debugAreaInfo[this.template.id].content;
                if (fnRef.index !== -1) {
                    var en: EvaluationNode = this.getExprByFNRef(fnRef, forceActive);
                    if (en === undefined) {
                        explanation["content"] = undefined;
                    } else {
                        explanation["content" + " = " + en.debugName()] =
                            en.explain(getATDBIAttr(classDebugInfo, "content"));
                    }
                }
            }
        }
        return explanation;
    }

    explainClasses(): any {
        var classes = <EvaluationAV> this.exports[0];

        if (classes === undefined) {
            return undefined;
        }
        var expl: any = {};
        for (var className in classes.inputByAttr) {
            expl[className] = {
                membership: classes.inputByAttr[className].explain(undefined)
            }
        }
        return expl;
    }

    getExprByFNRef(fnRef: FNRef, forceCreate: boolean, forceActive: boolean = forceCreate): EvaluationNode {
        var en: EvaluationNode;

        if (fnRef.level === undefined) {
            en = globalEvaluationNodes[fnRef.index];
        } else {
            var targetEnv: EvaluationEnvironment = this;
            for (var i: number = 0; i < fnRef.level; i++) {
                targetEnv = targetEnv.getParent();
            }
            en = targetEnv.evaluationNodes[0][fnRef.index];
        }
        if (en === undefined && forceCreate) {
            en = getEvaluationNode(this.getFNByFNRef(fnRef), this);
        }
        if (en !== undefined && !en.isActive() && forceActive) {
            try {
                // Uses dataSourceAware in order not to disturb anything.
                // Unfortunately doesn't show actual value
                if (!en.forceActive(this, true)) {
                    console.log("node not evaluated on time:",
                                en.prototype.idStr());
                }
            } catch(e) {
                Utilities.warn(e.toString());
                if (g_noTryAndCatchUpdate) {
                    throw e;
                }
            }
            en.deactivate(this, true);
        }
        return en;
    }

    getFNByFNRef(fnRef: FNRef): FunctionNode {
        if (fnRef.level === undefined) {
            return FunctionNode.globalFunctionNodes[fnRef.index];
        } else {
            var template: AreaTemplate = this.template;
            for (var i: number = 0; i < fnRef.level; i++) {
                template = template.parent;
            }
            return template.functionNodes[fnRef.index];
        }
    }

    storeExprByFNRef(fnRef: FNRef, en: EvaluationNode): void {
        if (fnRef.level === undefined) {
            globalEvaluationNodes[fnRef.index] = en;
        } else {
            var targetEnv: EvaluationEnvironment = this;
            for (var i: number = 0; i < fnRef.level; i++) {
                targetEnv = targetEnv.getParent();
            }
            targetEnv.evaluationNodes[0][fnRef.index] = en;
        }
    }

    debugAddContext(debugInfo: any, forceActive: boolean): void {
        function debugValue(en: EvaluationNode): any {
            if (en === undefined) {
                return undefined;
            } else if (en.result === undefined) {
                return "<<removed>>";
            } else if ("dataSource" in en.result) {
                return en.result.dataSource.extractDataComplex(undefined, false);
            } else {
                return stripArray(en.result.value);
            }
        }
        if (this.template.id in debugAreaInfo) {
            var contextNodes = debugAreaInfo[this.template.id].context;
            debugInfo.context = {};
            for (var attr in contextNodes) {
                var fnRef = contextNodes[attr];
                if (fnRef.index !== -1) {
                    var en: EvaluationNode = this.getExprByFNRef(fnRef, forceActive);
                    debugInfo.context[attr] = debugValue(en);
                }
            }
            if (debugAreaInfo[this.template.id].content !== undefined) {
                var fnRef = debugAreaInfo[this.template.id].content;
                if (fnRef.index !== -1) {
                    var en: EvaluationNode = this.getExprByFNRef(fnRef, forceActive);
                    debugInfo.content = debugValue(en);
                }
            }
        }
    }

    debugGetContextLabelValue(attr: string): any {
        if (this.template.id in debugAreaInfo) {
            var contextNodes = debugAreaInfo[this.template.id].context;
            if (attr in contextNodes) {
                var fnRef = contextNodes[attr];
                if (fnRef.index !== -1) {
                    var en: EvaluationNode = this.getExprByFNRef(fnRef, true);
                    return en === undefined? undefined:
                        en.result === undefined? "<removed>" :
                        en.nrActiveWatchers === 0? {inactive: stripArray(en.result.value)}:
                        stripArray(en.result.value);
                }
            }
        }
        return "<unknown>";
    }

    debugGetLocalEvaluationNode(id: number): any {
        var en: EvaluationNode = this.evaluationNodes[0][id];

        return en === undefined? "<out of range>": stripArray(en.result.value);
    }

    debugGetExport(id: number): any {
        var en: EvaluationNode = this.exports[id];

        return en === undefined? "<<unwatched>>": stripArray(en.result.value);
    }

    getInheritExplanation(explanation: any): any {
        var debugInfo: AreaTemplateDebugInfo =
            typeof(areaDebugInfo) === "undefined"? undefined:
            areaDebugInfo[this.template.id];

        if (debugInfo !== undefined && "inherit" in debugInfo) {
            var template: AreaTemplate = this.template;
            var classAV = <EvaluationAV> this.getExport(0);
            var classNames: string[] = Object.keys(classAV.inputByAttr).
                sort(function(c1: string, c2: string): number {
                    return template.classNamePrio[c1] -
                           template.classNamePrio[c2];
                });
            explanation.inherit = {};
            for (var i: number = 0; i < classNames.length; i++) {
                var className: string = classNames[i];
                explanation.inherit[className] =
                    debugInfo.inherit[className].map(getClassPath);
            }
        }
        return explanation;
    }

    getZ(): number {
        return undefined;
    }

    getPositionTree(parent: AreaPositionTree): AreaPositionTree {
        var tp: AreaPositionTree = new AreaPositionTree(
            this.areaId, this.getPos(), this.getOffsets(), this.getZ(), parent);
        var children: CoreArea[] = this.getEmbeddedAreaList();

        for (var i: number = 0; i !== children.length; i++) {
            tp.embedded.push(children[i].getPositionTree(tp));
        }
        return tp;
    }

    isOpaquePosition(x: number, y: number): boolean {
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

    getEvaluationArea(): CoreArea {
        return this;
    }

    watchers?: WatcherMap;

    addWatcher(watcher: Watcher, pos: any, forceFirstUpdate: boolean, conditionallyActivate: boolean, dataSourceAware: boolean): void {
        if (!("watchers" in this)) {
            this.watchers = new Map<number, {watcher: Watcher; pos: any[];}>();
        }
        if (this.watchers.has(watcher.watcherId)) {
            this.watchers.get(watcher.watcherId).pos.push(pos);
        } else {
            this.watchers.set(watcher.watcherId, {
                watcher: watcher,
                pos: [pos]
            });
        }
    }

    removeWatcher(watcher: Watcher, conditionallyDeactivate: boolean): void {
        this.watchers.delete(watcher.watcherId);
    }

    removeWatcherForPos(watcher: Watcher, pos: any, conditionallyDeactivate: boolean, dataSourceAware: boolean): void {
        var w = this.watchers.get(watcher.watcherId);
        var posIndex = w.pos.indexOf(pos);

        if (posIndex >= 0) {
            if (w.pos.length === 1) {
                // If it's the only one, remove, update, etc. completely
                this.removeWatcher(watcher, conditionallyDeactivate);
            } else {
                // watcher is still interested in this node; only remove
                // the tag.
                w.pos.splice(posIndex, 1);
            }
        }
    }

    markAsChanged(): void {
    }

    informWatchers(): void {
        if ("watchers" in this) {
            this.watchers.forEach((w, watcherId): void => {
                for (var i: number = 0; i !== w.pos.length; i++) {
                    w.watcher.updateInput(w.pos[i], this.result);
                }
            });
        }
    }

    getDebugAttributeFor(en: EvaluationNode): string[] {
        var templateId: number = this.template.id;
        var attributes: string[] = undefined;

        if (templateId in debugAreaInfo) {
            var context = debugAreaInfo[templateId].context;
            for (var attr in context) {
                var fnRef = context[attr];
                if (fnRef.index !== -1 &&
                    this.getExprByFNRef(fnRef, false) === en) {
                    if (attributes === undefined) {
                        attributes = [attr];
                    } else {
                        attributes.push(attr);
                    }
                }
            }
        }
        return attributes;
    }

    debugName(): string {
        return "area(" + this.areaId + ")";
    }

    public isValid(): boolean {
        return !this.hasBeenDestroyed();
    }

    public getSource(fn: FunctionNode): SourcePointer {
        return undefined;
    }

    releaseDataSourceInput(resultReceiver: ReceiveDataSourceResult): void {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];
        var areaSetContent: Result = paramNode.result;

        if ("dataSource" in areaSetContent) {
            // Clean up unused element id query
            var idQuery = <DataSourceQueryByElementId> areaSetContent.dataSource;
            // idQuery.input.removeElementIdQueryApplication(idQuery);
            idQuery.removeResultReceiver(resultReceiver);
            delete areaSetContent.dataSource;
            if (this.param !== undefined) {
                this.param.attr = undefined;
                this.param.data = undefined;
            }
            paramNode.set(undefined);
        }
    }

    getDebugOrigin(): string[] {
        return ["area " + this.areaId];
    }

    getEmbeddingPositionTree(): AreaPositionTree {
        return this.embedding === undefined? undefined:
               this.embedding.getEmbeddingPositionTree();
    }
}

class CalculationArea extends CoreArea {
    addEmbeddedReferred(area: CoreArea): void {
        throw new Error("Should not be called.");
    }

    removeEmbeddedReferred(area: CoreArea): void {
        throw new Error("Should not be called.");
    }

    setPosition(name: string, value: any): void {
        throw new Error("Should not be called.");
    }

    setStacking(name: string, value: any): void {
        throw new Error("Should not be called.");
    }

    setIndependentContentPosition(value: any): void {
        throw new Error("Should not be called.");
    }

    setPropagatePointerInArea(value: any): void {
    }

    canReceiveFocus(): boolean {
        return false;
    }

    canLoseFocus(): boolean {
        return true;
    }

    takeFocus(): void {
    }

    releaseFocus(): void {
    }

    willHandleClick(): boolean {
        return false;
    }

    getInputChanges(): {[attr: string]: any}|undefined {
        return undefined;
    }

    updateParamInput(changes: {[attr: string]: any;}, userInitiated: boolean, checkExistence: boolean): void {
    }

    setInputState(attrib: string, value: any): boolean {
        throw new Error("Should not be called.");
    }

    getPos(): Relative {
        throw new Error("Should not be called.");
    }

    getOffsets(): EdgeRect {
        throw new Error("Should not be called.");
    }
}

interface LinePositionInformation {
    y0?: number;
    y1?: number;
    x0?: number;
    x1?: number;
}

class DisplayArea extends CoreArea {
    // Interface to the rendering
    relative: Relative = new Relative();
    previousPosition: Rect = new Rect();
    allPosConstraints: AllPosConstraints;
    contentPosManager: ContentPosManager;

    // Additional attributes controlling the appearance
    stacking: {[name: string]: EvaluationNode};

    displayEvaluationNode: EvaluationNode;
    foreignInterfaceEvaluationNode: EvaluationNode;
    display: Display;
    initDisplayConfigValue?: any = undefined;
    independentContentPosition: EvaluationNode;
    propagatePointerInAreaNode: EvaluationNode;
    visualUpdates: { display: any; position: boolean; frameZ: number; displayZ: number } = undefined;
    initializing: boolean = true;
    areaRegisteredToAbsolutePosManager: boolean = false;
    debugTransitionSource: ElementReference = undefined;

    dependentConstraints: {[name: string]: string[]} = {};

    // embedding: "referred" areas where this is the referred area
    embeddedReferred: {[areaId: string]: CoreArea};

    // Interface to the rendering
    contentPos?: ContentPos;
    displayDivPos?: DisplayDivPos;
    linePos: LinePositionInformation;
    zArea: ZArea = undefined;

    constructor(template: AreaTemplate, controller: ChildController,
                setIndices: any[],
                areaIdentifier: any,
                paramAttr: Result = undefined,
                paramData: Result = undefined,
                source: EvaluationNode = undefined,
                position: number = undefined,
                referred: DisplayArea = undefined)
    {
        super(template, controller, setIndices, areaIdentifier, paramAttr,
              paramData, source, position, referred);
        this.relative.embedding =
            this.embedding === undefined? null: this.embedding;
        this.contentPosManager = new ContentPosManager(this);
        this.allPosConstraints = new AllPosConstraints(this);
        this.createDisplay();
    }

    createDisplay(): void {
        assert(this.display === undefined, "should not create display twice");

        this.display = new Display(this);
        embedAreaFrameElementAtPos(this, this.relative, true);

        this.contentPosManager.registerAllModeChange("display", 0, this.display,
                                                     undefined);
        if (dbgCreateList !== undefined)
            dbgCreateList.push({cls:"DisplayArea",id:this.areaId});
    }

    destroy(): void {
        for (var expressionAreaId in this.isReferredOf) {
            for (var childName in this.isReferredOf[expressionAreaId]) {
                this.isReferredOf[expressionAreaId][childName].removeIntersectionPartner(this);
            }
        }
        for (var areaId in this.embeddedReferred) {
            var intersectionController = <SetChildController> this.embeddedReferred[areaId].controller;
            intersectionController.removeIntersectionPartner(this);
        }
        if (this.foreignDisplay !== undefined) {
            this.setForeignInterface(undefined, true);
        }
        this.contentPosManager.unregisterAllModeChange("display", 0);
        this.allPosConstraints.destroy();
        globalGeometryTask.schedule();
        gZIndex.removeArea(this);
        this.zArea = undefined;
        this.removeDisplay();
        this.setRenderingForeignDisplay(undefined, true);
        super.destroy();
    }

    removeDisplay(): void {
        if (this.display !== undefined) {
            var embeddingArea = <DisplayArea> this.embedding;
            this.contentPosManager.unregisterAllModeChange("display", 0);
            this.areaRegisteredToAbsolutePosManager = false;
            globalAbsolutePosManager.removeArea(this, embeddingArea);
            this.display.destroy();
            this.display = undefined;
            this.visualUpdates = undefined;
        }
    }

    updateInput(pos: any, result: Result): void {
        switch (pos[0]) {
            case "display":
                if (this.renderingForeignDisplay !== undefined) {
                    this.renderingForeignDisplay.addChildArea(
                        this.areaId, result, this.controller);
                    allAreaMonitor.requestVisualUpdate(this.renderingForeignDisplay.displayOfArea);
                } else {
                    this.setDisplay(result.value);
                }
                break;
            case "independentContentPosition":
                this.setIndependentContentPosition(result.value);
                break;
            case "propagatePointerInArea":
                this.setPropagatePointerInArea(result.value);
                break;
            case "foreign":
                this.setForeignInterface(result, false);
                break;
            default:
                super.updateInput(pos, result)
                break;
        }
    }

    setDisplay(value: any): void {
        if (logValues && logPrototypes === undefined)
            gSimpleLog.log("area", this.areaId, "display =", JSON.stringify(value));
        if (value instanceof Array) {
            value = stripArray(value, true);
        }
        if (value === undefined) {
            value = constEmptyObject;
        }

        if (this.visualUpdates === undefined) {
            allAreaMonitor.requestVisualUpdate(this);
            this.visualUpdates = { display: value, position: undefined, frameZ: undefined, displayZ: undefined };
            if ("initDisplayConfigValue" in this) {
                this.initDisplayConfigValue = value;
            } else {
                this.registerContentOffsets(value, false);
            }
        } else {
            this.visualUpdates.display = value;
        }
        if ("transitions" in value) {
            allAreaMonitor.requestVisualUpdate(this);
        }
        // Now also update param:input. Note that this will update value:, not
        // the other attributes. E.g., param:input:focus: will be set by the
        // browser, and therefore should not be part of an initialization, as
        // this will only take place once the evaluations are done.
        if (this.paramInputDefined()) {
            if (!("text" in value && "input" in value.text)) {
                // No longer defined, so change param:input to o()
                this.updateParamInput(undefined, false, false);
            }
        } else {
            if ("text" in value && "input" in value.text) {
                // Input just started, so initialize param:input:value
                this.updateParamInput({value: value.text.value}, false, false);
            }
        }
    }

    foreignDisplay?: ForeignInterface;
    renderingForeignDisplay?: ForeignInterface;

    setForeignInterface(result: Result, destroy: boolean): void {
        var newFI: ForeignInterface =
            result === undefined || (isEmptyOS(result.value) && result.foreignInterfaceSource === undefined)? undefined:
            result.foreignInterfaceSource;

        // Look for parent rendering foreign display
        if (newFI === undefined && this.intersectionChain === undefined &&
              !destroy && this.embedding instanceof DisplayArea &&
              this.embedding.foreignDisplay !== undefined) {
            this.setRenderingForeignDisplay(this.embedding.foreignDisplay, false);
            return;
        }
        // Parent doesn't render this area
        if (this.renderingForeignDisplay !== undefined) {
            this.setRenderingForeignDisplay(undefined, destroy);
        }
        if (newFI === this.foreignDisplay || this.display.displayElement === undefined) {
            // Don't undertake any action until the display elements have been created
            return;
        }
        if (this.foreignDisplay !== undefined) {
            this.foreignDisplay.releaseDiv();
            this.display.setForeignElement(undefined);
        }
        this.foreignDisplay = newFI;
        if (this.foreignDisplay !== undefined) {
            var foreignElement = this.foreignDisplay.setDiv(this,
                <HTMLDivElement>this.display.displayElement.content);
            this.display.setForeignElement(foreignElement);
            this.display.setShowEmbedding(newFI.allowsEmbedding());
        } else {
            this.display.setShowEmbedding(true);
        }
        // TODO: notify children !!!
    }

    /**
     * Tells the area that it will be rendered by a/another foreign interface.
     * This triggers removal of the display.
     * 
     * @param fd the rendering foreign interface
     * @param destroy true when the area is being destroyed
     */
    setRenderingForeignDisplay(fd: ForeignInterface, destroy: boolean): void {
        if (fd === undefined) {
            if (this.renderingForeignDisplay !== undefined) {
                this.renderingForeignDisplay.removeChildArea(this.areaId, this.controller);
                this.renderingForeignDisplay = undefined;
                if (!destroy) {
                    this.createDisplay();
                }
            }
            return;
        }
        this.removeDisplay();
        if (fd !== this.renderingForeignDisplay) {
            if (this.renderingForeignDisplay !== undefined) {
                this.renderingForeignDisplay.removeChildArea(this.areaId, this.controller);
            }
            this.renderingForeignDisplay = fd;
            if (this.displayEvaluationNode.isConstant()) {
                fd.addChildArea(this.areaId, this.displayEvaluationNode.result,
                                this.controller);
            } else {
                // Ensure a later upate for the entire display object
                this.displayEvaluationNode.forceUpdate(this, false);
            }
        }
    }

    updatePos(): void {
        if (this.visualUpdates === undefined) {
            allAreaMonitor.requestVisualUpdate(this);
            this.visualUpdates = {
                display: undefined,
                position: true,
                frameZ: undefined,
                displayZ: undefined
            };
        } else {
            this.visualUpdates.position = true;
        }
    }

    // TODO: test switching display/renderforeign!!!

    updateDisplay(): void {
        if (this.visualUpdates !== undefined) {
            if (this.visualUpdates.display !== undefined) {
                var noDisplayElement: boolean = this.display.displayElement === undefined;
                this.display.configurationUpdate(this.visualUpdates.display, false, false);
                if (noDisplayElement && this.foreignInterfaceEvaluationNode !== undefined) {
                    // The foreign interface was set before the divs had been created
                    this.setForeignInterface(this.foreignInterfaceEvaluationNode.result, false);
                }
            }
        }
    }

    updateVisuals(): void {
        if (this.visualUpdates !== undefined) {
            if (this.visualUpdates.display !== undefined) {
                this.display.configurationUpdate(this.visualUpdates.display,
                                                true, !this.initializing);
                if (!this.initializing) {
                    var transitions: any = this.display.getTransitions();
                    if (transitions !== undefined) {
                        this.copyTransitionsToReferredIntersections(transitions, this.areaReference);
                    }
                }
            }
            if (this.display !== undefined &&
                  this.visualUpdates.position !== undefined) {
                // Refresh the sizes of the displayDiv and embeddingDiv. See
                // explanation for their positioning at the top of this file.
                if (this.contentPos !== undefined) { // content positioned separately
                    this.display.updatePos(this.contentPos, this.displayDivPos);
                    if (this.foreignDisplay !== undefined) {
                        this.foreignDisplay.setSize(this.displayDivPos.width, this.displayDivPos.height);
                    }
                } else { // content positioned at offset zero from frame (on all sides)
                    this.display.updateZeroOffsetPos(this.relative);
                    if (this.foreignDisplay !== undefined) {
                        this.foreignDisplay.setSize(this.relative.width, this.relative.height);
                    }
                }
                this.display.refreshPos();  // Notify the area's display
                // embed the frame in the frame of the embedding area
                embedAreaFrameElementAtPos(this, this.relative);
            }
            if (this.display !== undefined &&
                  (this.visualUpdates.frameZ !== undefined ||
                    this.visualUpdates.displayZ !== undefined)) {
                this.display.setZIndex(this.visualUpdates.frameZ, this.visualUpdates.displayZ);
            }
            this.visualUpdates = undefined;
        }
    }

    wrapupUpdateVisuals(): void {
        if (this.display !== undefined) {
            if (this.initializing) {
                var transitions: any = this.display.getTransitions();
                var localTransitions: boolean = true;
                if (transitions === undefined && this.template.embeddingInReferred) {
                    transitions = this.getTransitionsFromParent();
                    localTransitions = false;
                }
                if (transitions !== undefined) {
                    if (localTransitions) {
                        delete this.debugTransitionSource;
                    }
                    this.display.applyTransitionProperties(transitions);
                    this.copyTransitionsToReferredIntersections(transitions,
                                                            this.areaReference);
                }
                this.initializing = false;
            }
            if (this.foreignDisplay) {
                this.foreignDisplay.wrapUpVisuals();
            }
            this.updatePreviousPosition();
        }
    }

    getTransitionsFromParent(): any {
        var parentController: ChildController = this.controller;

        while (parentController !== undefined) {
            var parent: CoreArea = parentController.parent;
            if (parent instanceof DisplayArea) {
                var transitions: any = parent.display.getTransitions();
                if (transitions !== undefined) {
                    this.debugTransitionSource = parent.areaReference;
                    return transitions;
                }
            }
            parentController = parent.controller;
        }
        return undefined;
    }

    // Copy the transition to child* intersection areas that are embedded
    // in the referred area to make them move in sync with this area. Copying
    // stops at areas that have transitions.
    // Note: perhaps intersection areas need to transition properly with both
    // parents, but we'll see about that later.
    copyTransitionsToReferredIntersections(transitions: any, transitionSource: ElementReference): void {
        for (var childName in this.children) {
            this.children[childName].
                copyTransitionsToReferredIntersections(transitions, transitionSource);
        }
    }

    setPosition(name: string, value: any): void {
        var deps: string[];

        if (logValues && logPrototypes === undefined) {
            gSimpleLog.log("area", this.areaId,
                        value === undefined || (value instanceof Array && value.length === 0)? "delete":
                        "_" + name in this.allPosConstraints.constraints? "modify": "add",
                        "position." + name + " =",
                        JSON.stringify(value));
        }
        if (value === undefined || (value instanceof Array && value.length === 0)) {
            if (name in this.dependentConstraints) {
                deps = this.dependentConstraints[name];
                for (var i: number = 0; i !== deps.length; i++) {
                    this.allPosConstraints.removeConstraintInnerName(deps[i]);
                }
                delete this.dependentConstraints[name];
            } else {
                this.allPosConstraints.removeConstraintInnerName(name);
            }
        } else {
            var posConstr: any = stripArray(value);
            var posDesc: any = {};
            var rewrite: boolean =
                this.translateShorthand(posDesc, name, posConstr) &&
                this.controller !== undefined;
            if (value instanceof Array && value.length !== 1) {
                Utilities.error("one name, one positioning constraint: " + name);
            }
            if (name in this.dependentConstraints) {
                deps = this.dependentConstraints[name];
                for (var i: number = 0; i !== deps.length; i++) {
                    var depName: string = deps[i];
                    if (!(depName in posDesc)) {
                        this.allPosConstraints.removeConstraintInnerName(depName);
                    }
                }
                if (!rewrite) {
                    delete this.dependentConstraints[name];
                }
            }
            if (rewrite) {
                deps = this.dependentConstraints[name] = [];
                for (var rewrittenName in posDesc) {
                    this.allPosConstraints.addNewConstraint(rewrittenName, posDesc);
                    deps.push(rewrittenName);
                }
            } else if (name in posDesc) {
                this.allPosConstraints.addNewConstraint(name, posDesc);
            }
        }
    }

    setStacking(name: string, value: any): void {
        var stConstr: any = value instanceof Array? value[0]: value;

        if (logValues && logPrototypes === undefined)
            gSimpleLog.log("area", this.areaId, "stacking." + name + " =", JSON.stringify(value));
        if (value instanceof Array && value.length !== 1) {
            Utilities.error("one name, one stacking constraint: " + name);
        }
        if (stConstr === undefined) {
            this.zArea.removeConstraint(name);
        } else {
            this.zArea.addConstraint(name, stConstr);
            this.zArea.updateConstraint(name, this.areaId);
        }
    }

    makeAreaSetRepr(constraintName: string): Stackable {
        var repr: AreaSetStackable;

        if (this.controller !== undefined) {
            if (this.controller.areaSetStackable === undefined) {
                this.controller.makeAreaSetRepr(constraintName);
            }
            repr = this.controller.areaSetStackable;
        }
        if (repr !== undefined) {
            repr.addSetMember(this, constraintName);
            return repr;
        }
        return this;
    }

    removeAreaSetRepr(): void {
        if (this.controller !== undefined &&
            this.controller.areaSetStackable !== undefined) {
            this.controller.areaSetStackable.removeSetMember(this);
        }
    }

    setIndependentContentPosition(value: any): void {
        this.contentPosManager.independentContentPositionHandler(isTrueValue(value));
    }

    setPropagatePointerInArea(value: any): void {
        if (value === undefined) {
            this.propagatePointerInArea = undefined;
        } else {
            value = ensureOS(value);
            this.propagatePointerInArea = {};
            for (var i: number = 0; i < value.length; i++) {
                if (typeof(value[i]) === "string") {
                    this.propagatePointerInArea[value[i]] = true;
                } else if (value[i] instanceof ElementReference) {
                    this.propagatePointerInArea[value[i].getElement()] = true;
                }
            }
        }
    }

    addWatchers(): void {
        var embeddingArea = <DisplayArea> this.embedding;

        super.addWatchers();

        if (this.template.displayFunction !== undefined) {
            this.displayEvaluationNode = getEvaluationNode(this.template.displayFunction, this);
            this.setDisplay(this.displayEvaluationNode.result.value);
            this.displayEvaluationNode.addWatcher(this, ["display"], true, true, false);
        }

        if (this.template.foreignInterfaceDisplayFunction !== undefined) {
            this.foreignInterfaceEvaluationNode = getEvaluationNode(this.template.foreignInterfaceDisplayFunction, this);
            this.setForeignInterface(this.foreignInterfaceEvaluationNode.result, false);
            this.foreignInterfaceEvaluationNode.addWatcher(this, ["foreign"], true, true, false);
        }

        // Initialize ContentPosManager
        if (this.template.independentContentPosition !== undefined) {
            this.independentContentPosition = getEvaluationNode(this.template.independentContentPosition, this);
            this.setIndependentContentPosition(this.independentContentPosition.result.value);
            this.independentContentPosition.addWatcher(this, ["independentContentPosition"], true, true, false);
        }

        // Initialize propagatePointerInArea
        if ("propagatePointerInArea" in this.template) {
            this.propagatePointerInAreaNode = getEvaluationNode(this.template.propagatePointerInArea, this);
            this.setPropagatePointerInArea(this.propagatePointerInAreaNode.result.value);
            this.propagatePointerInAreaNode.addWatcher(this, ["propagatePointerInArea"], true, true, false);
        }

        this.areaRegisteredToAbsolutePosManager = true;
        globalAbsolutePosManager.addArea(this, embeddingArea);
        this.zArea = gZIndex.addArea(this, embeddingArea);

        if (this.initDisplayConfigValue !== undefined) {
            this.registerContentOffsets(this.initDisplayConfigValue, false);
        }
        delete this.initDisplayConfigValue;

        if (this.template.stackingFunctions !== undefined) {
            this.stacking = {};
            for (var name in this.template.stackingFunctions) {
                var evNode = getEvaluationNode(this.template.stackingFunctions[name], this);
                if (evNode.isConstant()) {
                    this.setStacking(name, evNode.result.value);
                } else {
                    evNode.addWatcher(this, ["stacking", name], true, true, false);
                }
                this.stacking[name] = evNode;
            }
        }
    }

    removeWatchers(): void {
        if (this.displayEvaluationNode !== undefined) {
            this.displayEvaluationNode.removeWatcher(this, true, false);
        }
        if (this.stacking !== undefined) {
            for (var name in this.stacking) {
                this.stacking[name].removeWatcher(this, true, false);
                if (this.zArea !== undefined) {
                    this.zArea.removeConstraint(name);
                }
            }
        }
        if (this.independentContentPosition !== undefined) {
            this.independentContentPosition.removeWatcher(this, true, false);
        }
        if (this.propagatePointerInAreaNode !== undefined) {
            this.propagatePointerInAreaNode.removeWatcher(this, true, false);
        }
        if (this.foreignInterfaceEvaluationNode !== undefined){
            this.foreignInterfaceEvaluationNode.removeWatcher(this, true, false);
        }
        super.removeWatchers();
    }

    addIsReferredOf(ctrlr: SetChildController): void {
        var cpaid: string = ctrlr.parent.areaId;

        if (!("isReferredOf" in this)) {
            this.isReferredOf = {};
        }
        if (!(cpaid in this.isReferredOf)) {
            this.isReferredOf[cpaid] = {};
        }
        assert(!(ctrlr.name in this.isReferredOf[cpaid]), "check");
        this.isReferredOf[cpaid][ctrlr.name] = ctrlr;
    }

    removeIsReferredOf(ctrlr: SetChildController): void {
        var cpaid: string = ctrlr.parent.areaId;

        assert(cpaid in this.isReferredOf &&
            ctrlr.name in this.isReferredOf[cpaid], "check");
        delete this.isReferredOf[cpaid][ctrlr.name];
    }

    updateSetPosition(src: EvaluationNode, position: number): void {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];

        this.param.position = position;
        paramNode.setSource(src, position);
    }

    addEmbeddedReferred(area: CoreArea): void {
        if (this.embeddedReferred === undefined) {
            this.embeddedReferred = {};
        }
        assert(!(area.areaId in this.embeddedReferred), "added twice?");
        this.embeddedReferred[area.areaId] = area;
    }

    removeEmbeddedReferred(area: CoreArea): void {
        assert(area.areaId in this.embeddedReferred, "removed twice?");
        delete this.embeddedReferred[area.areaId];
    }

    registerContentOffsets(displayDescr: any, modify: boolean): any {
        var offsets: any = {};
        var propsSet: any = {}; // properties set by this function
        var hasDefinedValues: boolean = false;
        var edge: string;

        if (displayDescr !== undefined) {
            for (var cssDefaultProp in contentOffsetCSSProperties) {
                var defaultValue =
                    this.getAndConvertCssOffsetProperty(cssDefaultProp, displayDescr);
                var specificProperties: any = contentOffsetCSSProperties[cssDefaultProp];
                if (modify) {
                    // remove the default property from the css, it will be
                    // replaced by the specific properties below.
                    delete displayDescr[cssDefaultProp];
                }
                for (edge in specificProperties) {
                    var specificProp: any = specificProperties[edge];
                    var value: number = this.getAndConvertCssOffsetProperty(specificProp, displayDescr);
                    if (value === undefined) {
                        value = defaultValue;
                    }
                    if (value !== undefined) {
                        hasDefinedValues = true;
                    } else {
                        value = 0;
                    }
                    propsSet[specificProp] = value;
                    if (modify) {
                        displayDescr[specificProp] = value + "px";
                    }
                    offsets[edge] = offsets[edge]? offsets[edge] + value: value;
                }
            }
        }
        
        var needToScheduleGeometryTask: boolean = false;
        if (!hasDefinedValues) {
            needToScheduleGeometryTask =
                this.contentPosManager.setAllContentOffsets(undefined);
        } else {
            for (edge in offsets) {
                if (this.contentPosManager.
                      setContentOffset(edge, offsets[edge]? offsets[edge]: 0)) {
                    needToScheduleGeometryTask = true;
                }
            }
        }
        if (needToScheduleGeometryTask) {
            globalGeometryTask.schedule();
        }
        return propsSet;
    }

    getAndConvertCssOffsetProperty(cssProp: string, css: any): number {
        if (!css || css[cssProp] === undefined) {
            return undefined;
        }
        var value = !this.display? undefined:
            getCssLengthInPixels(css[cssProp], this.display.displayDiv);
        if (value === undefined) {
            Utilities.warn("unit specification not supported: " +
                cssProp + ": " + css[cssProp]);
            value = 0;
        }
        // set the property in the css to the pixel value
        css[cssProp] = value + "px";
        return value;
    }

    getZArea(): ZArea {
        return this.zArea;
    }

    // Returns the ZArea of the area, or its controller, if it has one,
    // or of any higher area.
    getZAreaRep(): ZArea {
        return this.controller !== undefined && this.controller.areaSetStackable !== undefined ?
            this.controller.areaSetStackable.getZAreaRep() : this.zArea;
    }

    setZIndex(frameZ: any, displayZ: any): void {
        assert(frameZ !== undefined || displayZ !== undefined, "if this assumption fails, setZIndex in visualUpdate() can go wrong");
        if (this.visualUpdates === undefined) {
            allAreaMonitor.requestVisualUpdate(this);
            this.visualUpdates = { display: undefined, position: undefined, frameZ: frameZ, displayZ: displayZ };
        } else {
            this.visualUpdates.frameZ = frameZ;
            this.visualUpdates.displayZ = displayZ;
        }
    }

    getFrameDiv(): HTMLDivElement {
        return this.display.frameDiv;
    }

    isInZeroContentOffsetMode(): boolean {
        return this.contentPosManager !== undefined &&
            this.contentPosManager.isInZeroOffsetMode();
    }

    isInAutoContentOffsetMode(): boolean {
        return this.contentPosManager !== undefined &&
            this.contentPosManager.isInAutoOffsetMode();
    }

    isInIndependentContentPositionMode(): boolean {
        return this.contentPosManager !== undefined &&
            this.contentPosManager.isInIndependentContentPositionMode();
    }

    getPos(): Relative {
        return this.relative;
    }

    getPosCorrectedForOffset(): Rect {
        var pos: Relative = this.getPos();
        var offsets: EdgeRect = this.getOffsets();
        var display: Display = this.display;
        return  display === undefined || pos === undefined || offsets === undefined ||
                !("left" in offsets) || display.displayType === "line"? pos:
                {
                    left: pos.left + offsets.left - display.paddingLeft,
                    top: pos.top + offsets.top - display.paddingTop,
                    width: pos.width - offsets.left - offsets.right + 
                        display.paddingLeft + display.paddingRight,
                    height: pos.height - offsets.top - offsets.bottom +
                            display.paddingTop + display.paddingBottom
                };
    }

    pointInsideDisplay(relX: number, relY: number, offsetFromParent: Point): boolean {
        if (this.renderingForeignDisplay !== undefined) {
            return false;
        }
        
        var correctedPos = this.getPosCorrectedForOffset();
        var bPos: Rect = this.hasVisibleBorder()? this.getPos(): correctedPos;

        if (bPos !== undefined && relX >= bPos.left && relY >= bPos.top &&
              relX < bPos.left + bPos.width && relY < bPos.top + bPos.height) {
            offsetFromParent.left = correctedPos.left;
            offsetFromParent.top = correctedPos.top;
            return true;
        }
        return false;
    }

    getOffsets(): EdgeRect {
        return this.contentPosManager.offsets;
    }

    translateShorthand(posDesc: any, name: string, desc: any): boolean {
        if (typeof(desc) === "object") {
            posDesc[name] = desc;
            return false;
        }
        if (this.embedding === undefined) {
            return false;
        }
        switch (name) {
            case "top":
            case "left":
            case "vertical-center":
            case "horizontal-center":
                posDesc[name] = {
                    point1: { element: this.embedding.areaReference, type: name, content: true },
                    point2: { element: this.areaReference, type: name },
                    equals: desc
                };
                return false;
            case "bottom":
            case "right":
                posDesc[name] = {
                    point1: { element: this.areaReference, type: name },
                    point2: { element: this.embedding.areaReference, type: name, content: true },
                    equals: desc
                };
                return false;
            case "height":
                posDesc[name] = {
                    point1: { element: this.areaReference, type: "top" },
                    point2: { element: this.areaReference, type: "bottom" },
                    equals: desc
                };
                return false;
            case "content-height":
                posDesc[name] = {
                    point1: { element: this.areaReference, type: "top",
                              content: true },
                    point2: { element: this.areaReference, type: "bottom",
                              content: true},
                    equals: desc
                };
                return false;
            case "width":
                posDesc[name] = {
                    point1: { element: this.areaReference, type: "left" },
                    point2: { element: this.areaReference, type: "right" },
                    equals: desc
                };
                return false;
            case "content-width":
                posDesc[name] = {
                    point1: { element: this.areaReference, type: "left",
                              content: true },
                    point2: { element: this.areaReference, type: "right",
                              content: true },
                    equals: desc
                };
                return false;
            case "vertical":
                posDesc._vertical_top = {
                    point1: { element: this.embedding.areaReference, type: "top", content: true },
                    point2: { element: this.areaReference, type: "top" },
                    equals: desc
                };
                posDesc._vertical_bottom = {
                    point1: { element: this.areaReference, type: "bottom" },
                    point2: { element: this.embedding.areaReference, type: "bottom", content: true },
                    equals: desc
                };
                return true;
            case "horizontal":
                posDesc._horizontal_left = {
                    point1: { element: this.embedding.areaReference, type: "left", content: true },
                    point2: { element: this.areaReference, type: "left" },
                    equals: desc
                };
                posDesc._horizontal_right = {
                    point1: { element: this.areaReference, type: "right" },
                    point2: { element: this.embedding.areaReference, type: "right", content: true },
                    equals: desc
                };
                return true;
            case "frame":
                posDesc._frame_top = {
                    point1: { element: this.embedding.areaReference, type: "top", content: true },
                    point2: { element: this.areaReference, type: "top" },
                    equals: desc
                };
                posDesc._frame_bottom = {
                    point1: { element: this.areaReference, type: "bottom" },
                    point2: { element: this.embedding.areaReference, type: "bottom", content: true },
                    equals: desc
                };
                posDesc._frame_left = {
                    point1: { element: this.embedding.areaReference, type: "left", content: true },
                    point2: { element: this.areaReference, type: "left" },
                    equals: desc
                };
                posDesc._frame_right = {
                    point1: { element: this.areaReference, type: "right" },
                    point2: { element: this.embedding.areaReference, type: "right", content: true },
                    equals: desc
                };
                return true;
            default:
                Utilities.error("unknown shorthand: " + name);
                return false;
        }
    }

    /// Returns the area position tree with all embedding pointers; the position
    /// will be relative to the screen area.
    getEmbeddingPositionTree(): AreaPositionTree {
        var embeddingTree = this.embedding === undefined? undefined:
                            this.embedding.getEmbeddingPositionTree();

        return new AreaPositionTree(this.areaId, this.getPos(),
                                 this.getOffsets(), this.getZ(), embeddingTree);
    }

    /**
     * True when the area is partially visible. Is only valid after positioning
     * updates have been applied. Works by walking up the parent tree and checking
     * area visibility against embedding area.
     * 
     * @returns {boolean} 
     * 
     * @memberof DisplayArea
     */
    inView(): boolean {
        var ptr: CoreArea = this;
        var ptrPos: Rect = ptr.getPos();

        function intersect(embedding: Rect, embedded: Rect): Rect {
            var r = new Rect();

            r.top = embedding.top + Math.max(embedded.top, 0);
            r.left = embedding.left + Math.max(embedded.left, 0);
            r.height = Math.min(embedding.height, embedded.top + embedded.height) - Math.max(embedded.top, 0);
            r.width = Math.min(embedding.width, embedded.left + embedded.width) - Math.max(embedded.left, 0);
            return r;
        }

        function visible(r: Rect): boolean {
            return r.height > 0 && r.top >= 0;
        }

        while (ptr.embedding !== undefined) {
            var embedding = ptr.embedding;
            if (embedding instanceof DisplayArea) {
                var embPos = embedding.getPos();
                ptrPos = intersect(embPos, ptrPos);
            }
            ptr = embedding;
        }
        return visible(ptrPos);
    }

    /**
     * True when the area is completely visible. Is only valid after positioning
     * updates have been applied.
     * 
     * @returns {boolean} 
     * 
     * @memberof DisplayArea
     */
    inFullView(): boolean {
        var ptr: CoreArea = this;
        var ptrPos: Rect = ptr.getPos();
        var origPos: Rect = ptrPos;

        function intersect(embedding: Rect, embedded: Rect): Rect {
            var r = new Rect();

            r.top = embedding.top + Math.max(embedded.top, 0);
            r.left = embedding.left + Math.max(embedded.left, 0);
            r.height = Math.min(embedding.height, embedded.top + embedded.height) - Math.max(embedded.top, 0);
            r.width = Math.min(embedding.width, embedded.left + embedded.width) - Math.max(embedded.left, 0);
            return r;
        }

        while (ptr.embedding !== undefined) {
            var embedding = ptr.embedding;
            if (embedding instanceof DisplayArea) {
                var embPos = embedding.getPos();
                ptrPos = intersect(embPos, ptrPos);
            }
            ptr = embedding;
        }
        return ptrPos.height === origPos.height && ptrPos.width === origPos.width;
    }

    explain(forceActive: boolean): any {
        var explanation: any = super.explain(forceActive);
        var classDebugInfo: AreaTemplateDebugInfo =
            typeof(areaDebugInfo) === "undefined"? undefined:
            areaDebugInfo[this.template.id];
        var cDI: AreaTemplateDebugInfo;

        if (this.displayEvaluationNode !== undefined) {
            explanation["display: " + this.displayEvaluationNode.debugName()] =
              this.displayEvaluationNode.explain(getATDBIAttr(classDebugInfo, "display"));
        } else {
            explanation["display"] = undefined;
        }
        if (this.debugTransitionSource !== undefined) {
            if (this.displayEvaluationNode !== undefined) {
                explanation["display: " + this.displayEvaluationNode.debugName()]._transitionSource =
                    this.debugTransitionSource.element;
            } else {
                explanation["display: undefined"] = {
                    _transitionSource: this.debugTransitionSource.element
                };
            }
        }
        if (this.independentContentPosition !== undefined) {
            explanation["independentContentPosition: " + this.independentContentPosition.debugName()] =
              this.independentContentPosition.explain(getATDBIAttr(classDebugInfo, "independentContentPosition"));
        } else {
            explanation["independentContentPosition"] = undefined;
        }
        if (this.stacking !== undefined) {
            explanation.stacking = {};
            cDI = getATDBIAttr(classDebugInfo, "stacking");
            for (var name in this.stacking)
                explanation.stacking[name + ": " + this.stacking[name].debugName()] =
                    this.stacking[name].explain(getATDBIAttr(cDI, name));
        }
        if (this.writes !== undefined) {
            explanation.writes = {};
            cDI = getATDBIAttr(classDebugInfo, "write");
            for (var name in this.writes) {
                explanation.writes[name + ": " + this.writes[name].debugName()] =
                    this.writes[name].explain(getATDBIAttr(cDI, name));
            }
        }
        if (this.propagatePointerInAreaNode !== undefined) {
            explanation["propagatePointerInArea: " + this.propagatePointerInAreaNode.debugName()] =
              this.propagatePointerInAreaNode.explain(getATDBIAttr(classDebugInfo, "propagatePointerInAreaNode"));
        } else {
            explanation["propagatePointerInArea"] = undefined;
        }
        return explanation;
    }

    // Interface with input element. If these functions are called outside
    // event processing, be sure to run the content task, since these functions
    // (can) change the state of {param: {input: _}}.

    canReceiveFocus(): boolean {
        return this.display !== undefined && this.inView() &&
               this.display.hasActiveInputElement();
    }

    canLoseFocus(): boolean {
        return this.display !== undefined && this.display.inputElementIsValid();
    }

    takeFocus(): void {
        this.display.takeFocus();
    }

    releaseFocus(): void {
        this.display.releaseFocus();
    }

    willHandleClick(): boolean {
        return this.display !== undefined && this.display.willHandleClick();
    }

    getInputChanges(): {[attr: string]: any}|undefined {
        return this.display !== undefined?
               this.display.getInputChanges(): undefined;
    }

    paramInputDefined(): boolean {
        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];
        var currParamValue: any = paramNode.result.value[0];

        return  currParamValue !== undefined && "input" in currParamValue;
    }

    // Called from the input element upon a change
    updateParamInput(changes: {[attr: string]: any}, userInitiated: boolean,
                     checkExistence: boolean): void
    {
        function convert(v: any): any[] {
            var n: number = typeof(v) === "string" && numberRegExp.test(v)?
                            Number.parseFloat(v): NaN;

            return isNaN(n)? ensureOS(v): [n];
        }

        if (checkExistence && !this.display.hasActiveInputElement()) {
            // This function is also called when the input element is being
            // removed.
            return;
        }

        if (debugWrites) {
            gSimpleLog.log("updateParamInput", this.areaId, JSON.stringify(changes));
        }

        var paramNode = <EvaluationParam> this.evaluationNodes[0][areaParamIndex];
        var lastUpdate: any[] = paramNode.lastUpdate.value[0];
        var latched: any[]|undefined = paramNode.latchedValue !== undefined?
                                     paramNode.latchedValue.value[0]: undefined;
        var changeVal: {[attr: string]: (number|string)[]}[];

        if (changes === undefined) {
            changeVal = [];
        } else {
            changeVal = [{}];
            for (var attr in changes) {
                changeVal[0][attr] = convert(changes[attr]);
            }
        }
        var mergeVal = [{input: changeVal}];
        if (userInitiated) {
            // The changes are considered a write, and will be handled in the
            // next round of updates. They are therefore added to this.lastUpdate.
            var writeBase = latched !== undefined? latched: lastUpdate;
            var writeVal = mergeCopyValue(mergeVal, writeBase, undefined);
            if (!valueEqual(writeVal, writeBase)) {
                paramNode.latchedValue = new Result(writeVal);
                paramNode.latch();
                globalCommitWritesTask.schedule();
            }
        } else {
            // The changes are considered part of the current state, and are
            // therefore merged into this.lastUpdate and this.result. If there
            // is a difference between the two, it will be posted in the next
            // round of updates.
            if (latched !== undefined) {
                paramNode.latchedValue.set(mergeCopyValue(mergeVal, latched, undefined));
            }
            paramNode.set(new Result(mergeCopyValue(mergeVal, lastUpdate, undefined)));
        }
    }

    // Called from a write to the param:input:
    setInputState(attrib: string, value: any): boolean {
        return this.display.setInputState(attrib, value);
    }

    getZ(): number {
        return this.zArea.getZ();
    }

    isOpaquePosition(x: number, y: number): boolean {
        return this.display !== undefined && this.display.isOpaquePosition(x, y);
    }

    hasVisibleBorder(): boolean {
        return this.display !== undefined && this.display.hasVisibleBorder();
    }

    updatePreviousPosition(): void {
        this.previousPosition.top = this.relative.top;
        this.previousPosition.left = this.relative.left;
        this.previousPosition.width = this.relative.width;
        this.previousPosition.height = this.relative.height;
    }

    // If it ever becomes important to animate intersection cells from a point
    // where they do not yet have a previous position, this code can interpolate
    // the origin from the two parents' previous positions, and move the
    // intersection's div to that place. After that, animation should look
    // natural. Call only if no hasNoPosition().
    interpolatePreviousPosition(): void {
        var expr: CoreArea = this.intersectionChain.expressionArea;
        var exprPrev: Rect = expr.getAbsPreviousPosition();
        var ref: CoreArea = this.intersectionChain.referredArea;
        var refPrev: Rect = ref.getAbsPreviousPosition();
        var embPrev: Rect = this.embedding === expr? exprPrev: refPrev;

        this.previousPosition.top = Math.max(exprPrev.top, refPrev.top);
        this.previousPosition.left = Math.max(exprPrev.left, refPrev.left);
        this.previousPosition.height = Math.max(
            Math.min(exprPrev.top + exprPrev.height,
                     refPrev.top + refPrev.height) -
                this.previousPosition.top,
            0);
        this.previousPosition.width = Math.max(
            Math.min(exprPrev.left + exprPrev.width,
                     refPrev.left + refPrev.width) -
                this.previousPosition.left,
            0);
        this.previousPosition.top -= embPrev.top;
        this.previousPosition.left -= embPrev.left;
        updateElementPos(this.display.frameDiv, this.previousPosition);
    }

    hasNoPosition(): boolean {
        return this.previousPosition.top === 0 && this.previousPosition.left === 0 &&
            this.previousPosition.width === 0 && this.previousPosition.height === 0;
    }

    getAbsPreviousPosition(): Rect {
        var r: Rect = new Rect();
        var ptr: CoreArea = this.embedding;

        if (this.intersectionChain !== undefined && this.hasNoPosition()) {
            this.interpolatePreviousPosition();
        }
        r.left = this.previousPosition.left;
        r.top = this.previousPosition.top;
        r.height = this.previousPosition.height;
        r.width = this.previousPosition.width;
        while (ptr !== undefined) {
            if (ptr instanceof DisplayArea) {
                if (ptr.intersectionChain !== undefined && ptr.hasNoPosition()) {
                    ptr.interpolatePreviousPosition();
                }
                r.top += ptr.previousPosition.top;
                r.left += ptr.previousPosition.left;
            }
            ptr = ptr.embedding;
        }
        return r;
    }

    displayElementVisible(): void {
        if (this.foreignDisplay !== undefined) {
            this.foreignDisplay.displayElementVisible();
        }
    }

    getAbsolutePosition(): Point {
        var absTop = this.relative.top;
        var absLeft = this.relative.left;
        var offsets = this.getOffsets();

        if ("left" in offsets) {
            absTop += offsets.top;
            absLeft += offsets.left;
        }
        for (var em = this.embedding; em; em = em.embedding) {
            if (em instanceof DisplayArea) {
                offsets = em.getOffsets();
                if ("left" in offsets) {
                    absTop += offsets.top;
                    absLeft += offsets.left;
                }
                absTop += em.relative.top;
                absLeft += em.relative.left;
            }
        }
        return { top: absTop, left:absLeft };
    }
}

// Display sizes

// These functions handle the various conversions needed
// for correct interaction between the display and the positioning system.
// This includes:
// 1. Conversion of relevant sizes into pixels (as positioning is pixel
//    based).
// 2. Calculation and registration of content offsets to the content position
//    manager.

// This regular expression can (hopefully) extract the value and the unit
// of any valid CSS 2.1 length specification.

var cssLengthRegEx =
    /^\s*(-?\d+(?:\.\d*)?)\s*(|%|px|pt|pc|em|ex|ch|in|cm|mm)\s*$/;

// Given a length specification (either a number or a string) which conforms
// to CSS 2.1 standards, this function returns the equivalent length in
// an integer number of pixels. If the length is not a valid length in CSS 2.1
// or we do not (yet) support the given unit, undefined is returned.
// To work correctly, this function may need access to the HTML element on
// which the length is defined and to the CSS properties which are about to
// be applied to that element. For example, an 'em' unit is defined relative
// to the font size, so we need to know the font size defined for the relevant
// element.

function getCssLengthInPixels(length:any, element:any):any {
    length = getDeOSedValue(length);
    // is this a pure number? in that case, it is already in pixel units
    if (typeof(length) === "number") {
        return Math.round(length);
    }
    if (typeof(length) !== "string") {
        return undefined;
    }
    // check for possible unit formats.
    var matches = length.match(cssLengthRegEx);
    if (!matches) {
        return undefined; // not a supported format
    }
    var value: number = Number(matches[1]);
    // convert to pixels and return the converted value
    switch (matches[2]) {
        case "%":
            return undefined; // not supported at present
        case "":
        case "px":
            // pixels
            return value; // no conversion needed here
        case "pt":
            // point (1 point is equal to 1/72 inch)
            return undefined; // not supported at present
        case "pc":
            // pica (1 pica is equal to 12 points)
            return undefined; // not supported at present
        case "em":
            // 1em is equal to the current font size
            return undefined; // not supported at present
        case "ex":
            // 1ex is equivalent to the x-height of the font 
            return undefined; // not supported at present
        case "ch":
            // 1ch is equivalent to the width of the character '0' in
            // the current font.
            return undefined; // not supported at present
        case "in": // inches
            return undefined; // not supported at present
        case "cm": // centimeters
            return undefined; // not supported at present
        case "mm": // millimeters
            return undefined; // not supported at present
        default:
            return undefined;
    }
}

// This table defines which CSS properties affect which offset.
// The offsets contributed by each entry in this table need to be added
// to get the total offset.
// Each entry appears under an attribute which defines the CSS property which
// sets the default value for that part of the offset for all offsets.
// For example, the CSS property "borderWidth" sets the default border
// width on all sides. Under the entry appear as attributes all sides which
// are affected by this property (at present, all sides) and the value
// under each attribute is the CSS property to use to override the default for
// that specific side.

var contentOffsetCSSProperties: any = {
    borderWidth: {
        left: "borderLeftWidth",
        right: "borderRightWidth",
        top: "borderTopWidth",
        bottom: "borderBottomWidth"
    },
    padding: {
        left: "paddingLeft",
        right: "paddingRight",
        top: "paddingTop",
        bottom: "paddingBottom"
    }
    // the margin property does not appear here, as we do not
    // want to use it (the relevant effect should be achieved through
    // positioning.
};
