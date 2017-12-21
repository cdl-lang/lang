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

/// <reference path="result.ts" />
/// <reference path="watcherProducer.ts" />
/// <reference path="area.ts" />

// Note: AreaMonitorBase supports a limited form of incremental updates in
// Result. But since every change immediately results in a direct inform of
// all watchers, there is no point in checking e.g. if add and remove cancel
// each other.
class AreaMonitorBase implements Producer {

    result: Result;
    priority: number = 0;
    watchers: WatcherMap = undefined;

    constructor() {
        this.result = new Result([]);
        this.result.added = [];
        this.result.removed = [];
        this.result.incremental = true;
    }

    destroy() {
        this.result = undefined;
        this.informWatchers();
        this.watchers = undefined;
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

    // Note that this removes all positions
    removeWatcher(watcher: Watcher, conditionallyDeactivate: boolean): void {
        if (this.watchers !== undefined) {
            this.watchers.delete(watcher.watcherId);
        }
    }

    removeWatcherForPos(watcher: Watcher, pos: string, conditionallyDeactivate: boolean): void {
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

    informWatchers(): void {
        if (this.watchers !== undefined) {
            this.watchers.forEach((w, watcherId): void => {
                for (var i: number = 0; i !== w.pos.length; i++) {
                    w.watcher.updateInput(w.pos[i], this.result);
                }
            });
        }
        if (this.result !== undefined && this.result.incremental) {
            this.result.added.length = 0;
            this.result.removed.length = 0;
        }
    }

    markAsChanged(): void {
        // Pushes all changes immediately, since it cannot be scheduled.
        // Possible delay should be implemented in the function watching
        // the area monitor
        this.informWatchers();
    }
}

interface AreaCallbackObject {
    addArea(area: CoreArea, embedding: CoreArea): void;
    removeArea(area: CoreArea, embedding: CoreArea): void;
    newEmbedding(area: CoreArea, embedding: CoreArea): void;
}

// Removes element "pos" from areaList and updates all positions in areaPos
// when areaList and areaPos are each others inverse.
// assumption: areaPos[areaList[i].getElement()] === i &&
//             areaList[areaPos[areaId]].getElement() == areaId
function removeFromPosList(pos: number, areaList: string[],
                           areaPos: {[areaId: string]: number}): void
{
    areaList.splice(pos, 1);
    for (var i: number = pos; i < areaList.length; i++) {
        areaPos[areaList[i]] = i;
    }
}

class AllAreaMonitor extends AreaMonitorBase {
    allAreas: {[areaId: string]: CoreArea} = {};
    areaPos: {[areaId: string]: number} = {};
    callbacks: AreaCallbackObject[] = [];
    areaSpecificWatchers: {[areaId: string]: {[id: number]: {watcher: Watcher; pos: number[];}}} = {};
    // areaPositionTree: AreaPositionTree;

    addArea(area: CoreArea): void {
        var embedding: CoreArea = area.getEmbedding();

        assert(!(area.areaId in this.allAreas), "debugging");
        this.allAreas[area.areaId] = area;
        this.areaPos[area.areaId] = this.result.value.length;
        this.result.value.push(area.areaId);
        this.result.added.push(area.areaId);
        for (var i: number = 0; i !== this.callbacks.length; i++) {
            this.callbacks[i].addArea(area, embedding);
        }
        this.markAsChanged();
        if (area.areaId in this.areaSpecificWatchers) {
            var watchers = this.areaSpecificWatchers[area.areaId];
            var result: Result = new Result([area.areaId]);
            for (var watcherId in watchers) {
                var w = watchers[watcherId];
                for (var i: number = 0; i !== w.pos.length; i++) {
                    w.watcher.updateInput(w.pos[i], result);
                }
            };
        }
    }

    removeArea(area: CoreArea): void {
        var pos: number = this.areaPos[area.areaId];
        var embedding: CoreArea = area.getEmbedding();

        assert(area.areaId in this.allAreas, "debugging");
        for (var i: number = 0; i !== this.callbacks.length; i++) {
            this.callbacks[i].removeArea(area, embedding);
        }
        delete this.areaPos[area.areaId];
        if (pos !== undefined) {
            removeFromPosList(pos, this.result.value, this.areaPos);
        }
        delete this.allAreas[area.areaId];
        this.result.removed.push(area.areaId);
        this.markAsChanged();
        if (area.areaId in this.areaSpecificWatchers) {
            var watchers = this.areaSpecificWatchers[area.areaId];
            var result: Result = new Result(constEmptyOS);
            for (var watcherId in watchers) {
                var w = watchers[watcherId];
                for (var i: number = 0; i !== w.pos.length; i++) {
                    w.watcher.updateInput(w.pos[i], result);
                }
            };
        }
        if (area.areaId in this.needsUpdate) {
            delete this.needsUpdate[area.areaId];
        }
    }

    addAreaSpecificWatcher(areaId: string, watcher: Watcher, pos: any): void {
        var watchers = this.areaSpecificWatchers[areaId];

        if (watchers === undefined) {
            this.areaSpecificWatchers[areaId] = watchers = {};
        }
        if (watcher.watcherId in watchers) {
            watchers[watcher.watcherId].pos.push(pos);
        } else {
            watchers[watcher.watcherId] = {
                watcher: watcher,
                pos: [pos]
            };
        }
    }

    removeAreaSpecificWatcher(areaId: string, watcher: Watcher): void {
        delete this.areaSpecificWatchers[areaId][watcher.watcherId];
    }

    getAreaById(areaId: string): CoreArea {
        return this.allAreas[areaId];
    }

    getAllAreaIds(): string[] {
        return Object.keys(this.allAreas);
    }

    exists(areaId: string): boolean {
        return areaId in this.allAreas;
    }

    addCallBack(cbObj: AreaCallbackObject): void {
        this.callbacks.push(cbObj);
    }

    removeCallback(cbObj: AreaCallbackObject): void {
        var pos = this.callbacks.indexOf(cbObj);

        if (pos !== -1) {
            this.callbacks.splice(pos, 1);
        }
    }

    addAreaSpecificCallBack(type: string, areaId: string, cbObj: any,
         updateFunction: (embeddingRequestId: string, opaque: any, areaId: string, prevEmbeddingId: string, embeddingId: string) => void): number
    {
        return 0;
    }

    removeAreaSpecificCallBack(type: string, embeddingRequestId: string): void {
    }

    registerLCE(areas: {[areaId: string]: CoreArea}, lceHandler: any,
                handleFun: (reqId: number, lce: CoreArea, entry: any) => void,
                cbData: any): number
    {
        var lce: CoreArea = undefined;

        for (var areaId in areas) {
            if (lce === undefined) {
                lce = areas[areaId];
            } else {
                lce = getLCE(lce, areas[areaId]);
            }
        }
        handleFun.call(lceHandler, 0, lce, cbData);
        return 0;
    }

    unregisterLCE(reqId: number): void {
    }

    updating: boolean = false;
    interrupted: boolean = false;
    needsUpdate: {[areaId: string]: boolean} = {};
    hasBeenUpdated: {[areaId: string]: boolean} = {};
    scheduled: boolean = false;
    yieldToBrowserFirst: boolean = false;

    requestVisualUpdate(area: CoreArea): void {
        this.needsUpdate[area.areaId] = true;
        if (!this.scheduled) {
            globalVisualFlushTask.schedule();
            globalAreaDisplayUpdateTask.schedule();
            this.scheduled = true;
        }
    }

    // Call when the browser needs yield to browser before wrapup.
    signalYieldToBrowserFirst(): void {
        this.yieldToBrowserFirst = true;
    }

    areaDisplayUpdate(): boolean {
        for (var areaId in this.needsUpdate) {
            this.allAreas[areaId].updateDisplay();
        }
        return true;
    }

    // This is called when the initialization is over. When this function is
    // called while running (due to focus change, probably), raise the interrupt
    // flag and run all visual updates again.
    updateVisuals(): boolean {
        if (this.updating) {
            this.interrupted = true;
        } else {
            this.updating = true;
            this.scheduled = false;
            do {
                this.interrupted = false;
                for (var areaId in this.needsUpdate) {
                    this.allAreas[areaId].updateVisuals();
                    this.hasBeenUpdated[areaId] = true;
                    delete this.needsUpdate[areaId];
                    if (SetChildController.creatingAreas !== 0 ||
                          !evaluationQueue.isEmpty(0) ||
                          !globalPosConstraintSynchronizer.isEmpty() ||
                          globalPos.needToRefresh()) {
                        // Areas, evaluation and constraints need to be taken
                        // care of first.
                        // TODO: Is this still necessary? processUrgencies()?
                        this.updating = false;
                        globalVisualWrapupTask.schedule();
                        return false;
                    }
                }
            } while (this.interrupted);
            this.updating = false;
            globalVisualWrapupTask.schedule();
            yieldToBrowser();
        }
        return !this.scheduled;
    }

    wrapupUpdateVisuals(): boolean {
        if (this.yieldToBrowserFirst) {
            this.yieldToBrowserFirst = false;
            yieldToBrowser();
            return false;
        }
        var mustYield = false;
        for (var areaId in this.hasBeenUpdated) {
            if (areaId in this.allAreas) {
                this.allAreas[areaId].wrapupUpdateVisuals();
                mustYield = true;
            }
        }
        this.hasBeenUpdated = {};
        // this.areaPositionTree = this.allAreas[gPaidMgr.getScreenAreaId()].
        //                                          getPositionTree(undefined);
        if (mustYield) {
            yieldToBrowser();
        }
        return true;
    }

    /**
     * Forces the areas on screen to update to their current visual state.
     * Note that updateVisuals() and wrapupUpdateVisuals() still need to be
     * called to clear the lists and copy transitions, etc.
     */
    forceTempUpdate(): void {
        for (var areaId in this.needsUpdate) {
            this.allAreas[areaId].updateVisuals();
        }
    }

    cleanUpUnusedEvaluationNodes(): number {
        var screenArea: CoreArea = this.allAreas[gPaidMgr.getScreenAreaId()];
        var nrCleanedUp: number = screenArea.cleanUpUnusedEvaluationNodes();

        screenArea.cleanUpRemovedExportNodes();
        return nrCleanedUp;
    }

    allDisplayElementsVisible(): void {
        for (var areaId in this.allAreas) {
            var area = this.allAreas[areaId];
            if (area instanceof DisplayArea) {
                area.displayElementVisible();
            }
        }
    }
}

var allAreaMonitor: AllAreaMonitor = new AllAreaMonitor();

class AreaRelationWatcher extends AreaMonitorBase {

    setResult(value: any): void {
        if (!objectEqual(value, this.result.value)) {
            this.result.value = value;
            this.markAsChanged();
        }
    }

    getResult(): any {
        return this.result.value;
    }

    add(id: string, value: any): void {
        Utilities.error("not to be called");
    }

    remove(id: string): void {
        Utilities.error("not to be called");
    }
}

class AreaMultiRelationWatcher extends AreaRelationWatcher {
    id2pos: {[id: string]: number} = {};
    ids: string[] = [];

    setResult(value: any): void {
        if (value === undefined) {
            if (this.result.value !== undefined) {
                this.result.value = undefined;
                this.markAsChanged();
            }
        } else {
            Utilities.error("not to be called: use add/remove");
        }
    }

    add(id: string, value: any): void {
        var pos: number;

        if (id in this.id2pos) {
            pos = this.id2pos[id];
        } else {
            pos = this.result.value.length;
            this.id2pos[id] = pos;
            this.result.added.push(value);
            this.ids.push(id);
        }
        this.result.value[pos] = value;
        this.markAsChanged();
    }

    remove(id: string): void {
        var pos: number = this.id2pos[id];

        assert(0 <= pos && pos < this.result.value.length, "debugging");
        this.result.removed.push(this.result.value.splice(pos, 1)[0]);
        this.ids.splice(pos, 1);
        delete this.id2pos[id];
        for (var i: number = pos; i < this.ids.length; i++) {
            var sId: string = this.ids[i];
            this.id2pos[sId]--;
        }
        this.markAsChanged();
    }
}

class AreaRelationMonitor {

    areaRelations: {[areaId: string]: {[relation: string]: AreaRelationWatcher}} = {};

    // Here we define the standard relations on an area, because they will be
    // added anyway, and "multi" relations must be defined in advance.
    // Relations added later on are "single" relations by default.
    addArea(areaId: string): void {
        this.areaRelations[areaId] = {
            embedding: new AreaRelationWatcher(),
            embedded: new AreaMultiRelationWatcher(),
            embeddingStar: new AreaMultiRelationWatcher(),
            embeddedStar: new AreaMultiRelationWatcher()
        };
    }

    removeArea(areaId: string): void {
        var noRelationsLeft: boolean = true;

        for (var relation in this.areaRelations[areaId]) {
            var watcher = this.areaRelations[areaId][relation];
            watcher.setResult(undefined);
            if (watcher.watchers === undefined || watcher.watchers.size === 0) {
                delete this.areaRelations[areaId][relation];
            } else {
                noRelationsLeft = false;
            }
        }
        if (noRelationsLeft) {
            delete this.areaRelations[areaId];
        }
    }

    addRelation(areaId: string, relation: string, value: any): void {
        if (!(relation in this.areaRelations[areaId])) {
            this.areaRelations[areaId][relation] = new AreaRelationWatcher();
        }
        this.areaRelations[areaId][relation].setResult(value);
    }

    // Set maintaince by the monitor
    addMultiRelation(areaId: string, relation: string, id: string, value: any): void {
        if (!(relation in this.areaRelations[areaId])) {
            this.areaRelations[areaId][relation] = new AreaMultiRelationWatcher();
        }
        this.areaRelations[areaId][relation].add(id, value);
    }

    getRelation(areaId: string, relation: string): any {
        return !(areaId in this.areaRelations) ||
               this.areaRelations[areaId][relation] === undefined? []:
               this.areaRelations[areaId][relation].getResult();
    }

    getEmbeddingId(areaId: string): string {
        var embedding: any = this.getRelation(areaId, "embedding");

        return embedding instanceof Array? embedding[0]: embedding;
    }

    getExpressionId(areaId: string): string {
        var expr: any = this.getRelation(areaId, "expressionOf");

        return expr instanceof Array? expr[0]: expr;
    }

    getReferredId(areaId: string): string {
        var ref: any = this.getRelation(areaId, "referredOf");

        return ref instanceof Array? ref[0]: ref;
    }

    removeRelation(areaId: string, relation: string): void {
        if (relation in this.areaRelations[areaId]) {
            this.areaRelations[areaId][relation].setResult(undefined);
            delete this.areaRelations[areaId][relation];
        }
    }

    removeMultiRelation(areaId: string, relation: string, id: string): void {
        if (relation in this.areaRelations[areaId]) {
            this.areaRelations[areaId][relation].remove(id);
        }
    }

    addWatcher(areaId: string, relation: string, watcher: Watcher, pos: any): void {
        if (!(areaId in this.areaRelations)) {
            this.areaRelations[areaId] = {};
        }
        if (!(relation in this.areaRelations[areaId])) {
            this.areaRelations[areaId][relation] = new AreaRelationWatcher();
        }
        this.areaRelations[areaId][relation].addWatcher(watcher, pos);
    }

    removeWatcher(areaId: string, relation: string, watcher: Watcher): void {
        var relations = this.areaRelations[areaId];

        if (relations !== undefined && relation in relations) {
            relations[relation].removeWatcher(watcher, false);
        }
    }
}

var areaRelationMonitor: AreaRelationMonitor = new AreaRelationMonitor();

class SingleAreaBoolValueMonitor extends AreaMonitorBase {

    constructor() {
        super();
        this.result.value = new Array(1);
        this.result.value[0] = false;
        this.result.added = undefined;
        this.result.removed = undefined;
        this.result.incremental = false;
        if (dbgCreateList !== undefined) dbgCreateList.push({cls:"SingleAreaBoolValueMonitor"});
    }

    set(v: boolean): void {
        if (v !== this.result.value[0]) {
            this.result.value[0] = v;
            this.markAsChanged();
        }
    }

}

class AreaOverlapMonitor {

    areasOverlappingWithPointer: {[areaId: string]: boolean} = {};
    monitorPerArea = new Map<string, SingleAreaBoolValueMonitor>();

    updatePointerOverlap(areas: {recipient: CoreArea; relX: number; relY: number;}[]): void {
        var newAreas: {[areaId: string]: boolean} = {};

        for (var i: number = 0; i < areas.length; i++) {
            newAreas[areas[i].recipient.areaId] = true;
        }
        for (var areaId in this.areasOverlappingWithPointer) {
            if (!(areaId in newAreas) && this.monitorPerArea.has(areaId)) {
                this.monitorPerArea.get(areaId).set(false);
            }
        }
        for (var areaId in newAreas) {
            if (!(areaId in this.areasOverlappingWithPointer) && this.monitorPerArea.has(areaId)) {
                this.monitorPerArea.get(areaId).set(true);
            }
        }
        this.areasOverlappingWithPointer = newAreas;
    }

    addWatcherFor(areaId: string, watcher: Watcher, pos: any): Result {
        var mon: SingleAreaBoolValueMonitor;

        if (this.monitorPerArea.has(areaId)) {
            mon = this.monitorPerArea.get(areaId);
        } else {
            mon = new SingleAreaBoolValueMonitor();
            this.monitorPerArea.set(areaId, mon);
            mon.set(areaId in this.areasOverlappingWithPointer);
        }
        mon.addWatcher(watcher, pos);
        return mon.result;
    }

    removeWatcherFor(areaId: string, watcher: Watcher): void {
        if (this.monitorPerArea.has(areaId)) {
            this.monitorPerArea.get(areaId).removeWatcher(watcher, false);
        }
    }

    removeArea(areaId: string): void {
        if (this.monitorPerArea.has(areaId)) {
            this.monitorPerArea.get(areaId).set(false);
        }
    }

}

var areaOverlapMonitor: AreaOverlapMonitor = new AreaOverlapMonitor();

// An area state is a sorted list of area ids.
var areaStates: {[stateHash: string]: number} = undefined;
var areaStateHistory: string[][] = undefined;
var lastAreaChangeCounter: number = 0;

function checkAreaCreationCycle(): void {
    var areaState: string[] = Object.keys(allAreaMonitor.allAreas).sort();
    var areaStateHash: string = areaState.join(",");

    function listDiffs(s0: string[], s1: string[]): string {
        var i: number = 0;
        var j: number = 0;
        var diffs: string[] = [];

        while (i < s0.length && j < s1.length) {
            if (s0[i] === s1[j]) {
                i++;
                j++;
            } else if (s0[i] < s1[j]) {
                diffs.push("-" + s0[i]);
                i++;
            } else {
                diffs.push("+" + s1[j]);
                j++;
            }
        }
        while (i < s0.length) {
            diffs.push("-" + s0[i]);
            i++;
        }
        while (j < s1.length) {
            diffs.push("+" + s1[j]);
            j++;
        }
        return diffs.join(" ");
    }

    if (areaChangeCounter === lastAreaChangeCounter) {
        return;
    }
    lastAreaChangeCounter = areaChangeCounter;
    if (areaStates === undefined) {
        areaStates = {};
        areaStateHistory = [];
    }
    if (areaStateHash !== "" && areaStateHash in areaStates) {
        console.log("area creation cycle starting at", areaStates[areaStateHash],
                    "of length", areaStateHistory.length - areaStates[areaStateHash]);
        for (var i = areaStates[areaStateHash]; i < areaStateHistory.length; i++) {
            var prevState = areaStateHistory[i];
            var nextState = i + 1 < areaStateHistory.length? areaStateHistory[i + 1]: areaState;
            console.log("state", i, ":", listDiffs(prevState, nextState));
        }
        breakIntoDebugger();
    }
    areaStates[areaStateHash] = areaStateHistory.length;
    areaStateHistory.push(areaState);
}

function clearAreaCreationState(): void {
    if (areaStates !== undefined) {
        areaStates = undefined;
        areaStateHistory = undefined;
    }
}
