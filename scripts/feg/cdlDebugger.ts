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

/// <reference path="functionNode.ts" />

//
// This file contains code that facilitates introspective debugging of
//  cdl in cdl; that is, providing debugging information using cdl functions,
//  in cdl value format
//
// DebuggerAreaInfoEN provides debugging information about an area. The current
//  information it provides includes:
//
//  - areaId
//  - tAreaId
//  - position: { width/height/absTop/absLeft/relTop/relLeft/zIndex}
//  - embedded: o({name: <child section name>, areaId: }, ... )
//  - embedding: areaId
//  - display: the currently active display description; this could prove
//      inappropriate for cdl processing, as the values are not arrays
//        ({backgroun: "red"}, rather than the feg std. of
//           {background: ["red"]})
//  - childType: root/single/areaSet/intersection
//  - childName: how this area is referred to by its parent
//  - referredParent/expressionParent: areaIds of an intersection area parents
//  - classes: the classes which this area derives
//  - prev/next: areaIds of the prev/next of an
//             area-set-member/intersection-area
//  - areaSetAttr/areaSetContent
//
// DebuggerContextInfoEN provides the value of the area 'content' and the set of
//  context label values for the same area.
//
// DebuggerInfoMgr maintains the set of areas for which a Debugger*Info
//  is requested; it is scheduled after each run of the content/heometry task,
//  and actually executes when the content/geometry tasks have nothing to do,
//  as it has a lower priority.
// It marks a pseudo value as modified, allowing other debug info generators
//  (DebuggerAreaInfoEN/DebuggerContextInfoEN) to watch it and update
//  following its modification.
//

// a typedef
class DebuggerClassNameNPriority {
    public className: string;
    public priority: number;
};

class DebuggerInfoFN extends FunctionNode {
    static singleton: DebuggerInfoFN = new DebuggerInfoFN();

    constructor() {
        var anyDataVT: ValueType = new ValueType;
        anyDataVT.addAnyData();
        super(undefined, 0, anyDataVT, undefined);
    }

    static getSingleton(): DebuggerInfoFN {
        return DebuggerInfoFN.singleton;
    }

    getDataSourceInputs(): FunctionNode[] {
        return undefined;
    }

    allInputs(): FunctionNode[] {
        Utilities.error("do not call");
        return undefined;
    }

    toCDLString(indent: string): string {
        Utilities.error("do not call");
        return undefined;
    }

    toExportString(origin: number): string {
        Utilities.error("do not call");
        return undefined;
    }

    getMaximumInputId(stack: NumberSet, process: (fn: FunctionNode, stack: NumberSet, isEndNode: boolean) => FunctionNode, setId: boolean): number {
        Utilities.error("do not call");
        return undefined;
    }

    markWritablePath(): void  {
        Utilities.error("do not call");
        return undefined;
    }

    checkWritability(): void {
        Utilities.error("do not call");
        return undefined;
    }
    setPriority(prio: number): void  {
        Utilities.error("do not call");
        return undefined;
    }
}

class DebuggerInfoEN extends EvaluationNode {
    areaId: string;

    constructor(areaId: string) {
        super(DebuggerInfoFN.getSingleton(), undefined);
        this.areaId = areaId;
    }

    // recreate an area's debug info, and test if it were modified
    eval(): boolean {
        this.inputHasChanged = false;
        var r: any = this.createDebuggerInfo(this.areaId);
        if (typeof(r) === "undefined") {
            r = constEmptyOS;
        }

        if (! (valueEqual([r], [this.result.value]))) {
            // modified - update result
            this.result = new Result(r);
            return true;
        }

        return false;
    }

    evalSet(): boolean {
        throw "Should not be called";
    }

    createDebuggerInfo(areaId: string): any {
        assert(false, "must be overridden");
        return undefined;
    }

    // watch gDebuggerInfoMgr, and update whenever it decides on a debugger
    //  update cycle
    activate(src: Watcher, dataSourceAware: boolean): void {
        if (this.nrActiveWatchers === 0) {
            gDebuggerInfoMgr.addWatcher(this, "debugCycle", false, true, false);
        }
        super.activate(src, dataSourceAware);
    }

    deactivate(src: Watcher, dataSourceAware: boolean): void {
        super.deactivate(src, dataSourceAware);
        if (this.nrActiveWatchers === 0) {
            gDebuggerInfoMgr.removeWatcher(this, true, false);
        }
    }

    updateInput(pos: any, result: Result): void {
        this.markAsChanged();
    }

    // XXX ??
    getScheduleStep(): number { return 0; }
    getSchedulePriority(): number { return 0; }
}

class DebuggerAreaInfoEN extends DebuggerInfoEN {

    createDebuggerInfo(areaId: string): any {
        var area: CoreArea = allAreaMonitor.getAreaById(areaId);
        if (typeof(area) === "undefined") {
            return undefined;
        }

        var positionObj: {[posAttr: string]: any} = {};
        var dAbsPos: any = debugObjAbsAreaPosition(area);
        for (var posAttr in dAbsPos) {
            positionObj[posAttr] = [dAbsPos[posAttr]];
        }

        var embeddedList: any[] = [];
        var dEmbeddedList = area.getEmbeddedAreaList();
        for (var i = 0; i < dEmbeddedList.length; i++) {
            var embeddedArea: CoreArea = dEmbeddedList[i];
            embeddedList.push(
                {
                    name: [embeddedArea.getChildName()],
                    areaId: [embeddedArea.areaId]
                }
            );
        }

        var embeddingArea: CoreArea = area.getEmbedding();

        var embeddingId: string = undefined;
        if (typeof(embeddingArea) !== "undefined") {
            embeddingId = embeddingArea.areaId;
        }

        var dispArea = <DisplayArea>area;
        var displayObj: any = (typeof(dispArea.display) !== "undefined") ?
            dispArea.display.debugGetDescription() : undefined;

        var childType: string;

        // childType
        if (typeof(area.controller) === "undefined") {
            childType = "root";
        } else if (area.isIntersection()) {
            childType = "intersection";
        } else if (area.isAreaSetMember()) {
            childType = "areaSet";
        } else {
            childType = "single";
        }

        var childName = area.getChildName();

        var classList = this.getClassList(area);

        var areaInfo: any = {
            areaId: [area.areaId],
            tAreaId: [area.tAreaId],
            position: [positionObj],
            embedded: embeddedList,
            embedding: [embeddingId],
            display: displayObj === undefined? []: [displayObj],
            childType: [childType],
            childName: [childName],
            classes: classList
        };

        // referredParent / expressionParent
        if (dispArea.isIntersection()) {
            var referredRef: ElementReference = dispArea.getReferredParent();
            var expressionRef: ElementReference =
                dispArea.getExpressionParent();

            areaInfo.referredParent = [referredRef.getElement()];
            areaInfo.expressionParent = [expressionRef.getElement()];
        }

        // prev / next
        if (dispArea.isAreaSetMember() || dispArea.isIntersection()) {
            var prevRef: ElementReference =
                DebuggerAreaInfoEN.getRelation(dispArea, "prev");
            var nextRef: ElementReference =
                DebuggerAreaInfoEN.getRelation(dispArea, "next");

            if (typeof(prevRef) !== "undefined") {
                areaInfo.prev = [prevRef.getElement()];
            }
            if (typeof(nextRef) !== "undefined") {
                areaInfo.next = [nextRef.getElement()];
            }
        }

        // areaSetAttr / areaSetContent
        if (dispArea.param !== undefined) {
            var attrResult = dispArea.param.attr;
            if (attrResult && attrResult.value) {
                areaInfo.areaSetAttr = attrResult.value;
            }

            var dataResult = dispArea.param.data;
            if (dataResult && dataResult.value) {
                areaInfo.areaSetContent = dataResult.value;
            }
        }

        return areaInfo;
    }

    //
    // get the prev/next of 'area'
    // return either a single elementReference or 'undefined'
    //
    static getRelation(area: DisplayArea, rel: string):
    ElementReference {
        var ref = areaRelationMonitor.getRelation(area.areaId, rel);
        if (ref instanceof Array) {
            if (ref.length === 0) {
                ref = undefined;
            } else if (ref.length === 1) {
                ref = ref[0];
            } else {
                Utilities.error("DebuggerAreaInfoEN.getRelation: area '" +
                                area.areaId +
                                "' has multiple(" + ref.length +
                                ") " + rel + " areas");
                ref = undefined;
            }
        }
        assert(((typeof(ref) === "undefined") ||
                (ref instanceof ElementReference)),
               "DebuggerAreaInfoEN.getRelation: " +
               "ref is either undefined or an ElementReference");
        return ref;
    }

    getClassList(area: CoreArea): string[] {
        var rawClassObj = debugObjClasses(area, undefined);
        var sortClassList: DebuggerClassNameNPriority[] = [];

        var areaTemplate = area.getTemplate();

        for (var className in rawClassObj) {
            var priority = areaTemplate.getClassNamePriority(className);

            sortClassList.push({className: className, priority: priority});
        }

        sortClassList.sort(function (
            a: DebuggerClassNameNPriority,
            b: DebuggerClassNameNPriority
        ) {
            return a.priority - b.priority;
        });

        var classList: string[] = [];

        for (var i = 0; i < sortClassList.length; i++) {
            classList.push(sortClassList[i].className);
        }

        return classList;
    }
}

class DebuggerContextInfoEN extends DebuggerInfoEN {

    createDebuggerInfo(areaId: string): any {
        var area: CoreArea = allAreaMonitor.getAreaById(areaId);
        if (typeof(area) === "undefined") {
            return undefined;
        }

        var cdebugInfo: any = {};

        area.debugAddContext(cdebugInfo, false);

        var contextOS: any = [];
        var contextAV: any = {};

        for (var attr in cdebugInfo.context) {
            var value = cdebugInfo.context[attr];
            if (typeof(value) !== "undefined") {
                contextAV[attr] = [value];
                contextOS.push(
                    {
                        name: [attr],
                        value: [value]
                    }
                );
            }
        }

        var ret: any = {
            areaId: [areaId],
            context: [contextAV],
            contextOS: contextOS
        };

        if (("content" in cdebugInfo) && cdebugInfo.content) {
            ret.content = [cdebugInfo.content];
        }

        return ret;
    }
}

// DebuggerInfoMgr
// 
// this class is scheduled by the debugger task, and marks its result as
//  modified; all debug info generators should watch this result, and update
//  only after it was modified
//
// this class also generates Debugger*InfoEN instances when they are first
//  requested (currently they are not recycled)
//
class DebuggerInfoMgr implements Producer {
    result: Result = new Result([1]);

    watchers: {[id: number]: {watcher: Watcher; pos: number[];}} = {};

    areaInfo: {[areaId: string]: DebuggerAreaInfoEN} = {};
    contextInfo:  {[areaId: string]: DebuggerContextInfoEN} = {};

    update(): void {
        var value = this.result.value;
        value[0] += 1;

        this.informWatchers();
    }

    getInfo(infoType: string, areaId: string): DebuggerInfoEN {
        if (infoType === "areaInfo") {
            if (! (areaId in this.areaInfo)) {
                this.createAreaInfo(areaId);
            }
            return this.areaInfo[areaId];
        } else if (infoType === "contextInfo") {
            if (! (areaId in this.contextInfo)) {
                this.createContextInfo(areaId);
            }
            return this.contextInfo[areaId];
        }
        return undefined;
    }

    releaseInfo(infoType: string, areaId: string) {}

    createAreaInfo(areaId: string) {
        var en = new DebuggerAreaInfoEN(areaId);
        en.isBeingInitialized = false;
        this.areaInfo[areaId] = en;
    }

    createContextInfo(areaId: string) {
        var en = new DebuggerContextInfoEN(areaId);
        en.isBeingInitialized = false;
        this.contextInfo[areaId] = en;
    }

    addWatcher(watcher: Watcher, pos: any, forceFirstUpdate: boolean,
               conditionallyActivate: boolean, dataSourceAware: boolean): void
    {
        if (watcher.watcherId in this.watchers) {
            this.watchers[watcher.watcherId].pos.push(pos);
        } else {
            var positions: any[] = new Array(1);
            positions[0] = pos;
            this.watchers[watcher.watcherId] = {
                watcher: watcher,
                pos: positions
            };
        }
    }

    removeWatcher(watcher: Watcher, conditionallyDeactivate: boolean,
                  dataSourceAware: boolean): void
    {
        if (watcher.watcherId in this.watchers) {
            delete this.watchers[watcher.watcherId];
        }
    }

    removeWatcherForPos(watcher: Watcher, pos: any,
                        conditionallyDeactivate: boolean,
                        dataSourceAware: boolean): void
    {
        if (watcher.watcherId in this.watchers) {
            var w = this.watchers[watcher.watcherId];
            var posIndex = w.pos.indexOf(pos);
            if (posIndex >= 0) {
                if (w.pos.length === 1) {
                    delete this.watchers[watcher.watcherId];
                } else {
                    w.pos.splice(posIndex, 1);
                }
            }
        }
    }

    markAsChanged(): void {
    }

    informWatchers(): void {
        for (var watcherId in this.watchers) {
            var w = this.watchers[watcherId];
            for (var i: number = 0; i !== w.pos.length; i++) {
                w.watcher.updateInput(w.pos[i], this.result);
            }
        }
    }

}

var gDebuggerInfoMgr: DebuggerInfoMgr = new DebuggerInfoMgr();
