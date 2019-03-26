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

// Debugging functions

// Class to trace expressions via areaId and context attribute.
class ContextAttributeTracer implements Watcher {
    traced: {[areaId: string]: {[contextAttr: string]: EvaluationNode}} = {};
    dataSourceAware: boolean;

    constructor() {
        this.watcherId = getNextWatcherId();
        this.dataSourceAware = true;
    }

    isBeingTraced(areaId: string, attr: string|number): boolean {
        return areaId in this.traced && attr in this.traced[areaId];
    }

    // Sets up tracing for area/attr
    // Watches allAreaMonitor for creation of area, the area itself for
    // destruction, and the expression for the value, and activates the
    // expression.
    addTraceFor(areaId: string, attr: string|number): void {
        var area = allAreaMonitor.allAreas[areaId];

        if (!(areaId in this.traced)) {
            allAreaMonitor.addAreaSpecificWatcher(areaId, this, ["signal", areaId]);
            this.traced[areaId] = {};
        }
        if ((area === undefined && areaId !== "") || this.traced[areaId][attr] !== undefined) {
            this.traced[areaId][attr] = undefined;
            return;
        }
        var fnRef: FNRef;
        if (typeof(attr) === "string") {
            if (areaId === "") {
                console.log("cannot trace attribute names in global nodes");
                return;
            }
            fnRef = debugAreaInfo[area.template.id].context[attr];
        } else {
            fnRef = {defunNr: 0, index: <number>attr, level: 0, suppressSet: false};
        }
        if (fnRef === undefined) {
            console.log("no such attribute:", "@" + areaId, attr);
            return;
        }
        var en: EvaluationNode = areaId === ""? globalEvaluationNodes[fnRef.index]:
                                 area.getExprByFNRef(fnRef, true, false);
        if (en === undefined) {
            console.log("no such attribute:", "@" + areaId, attr);
            return;
        }
        this.traced[areaId][attr] = en;
        en.addWatcher(this, ["value", areaId, attr], false, true, false);
        if (en.isScheduled()) {
            en.addForcedUpdate(this);
        } else {
            console.log("trace", areaId, attr, en.result.value);
        }
    }

    removeTraceFor(areaId: string, attr: string, removeAreaWatcher: boolean = true): void {
        if (!(areaId in this.traced) || !(attr in this.traced[areaId])) {
            return;
        }
        var en: EvaluationNode = this.traced[areaId][attr];
        if (en !== undefined) {
            en.removeWatcher(this, true, false);
        }
        if (removeAreaWatcher) {
            delete this.traced[areaId][attr];
            if (Utilities.isEmptyObj(this.traced[areaId])) {
                delete this.traced[areaId];
                allAreaMonitor.removeAreaSpecificWatcher(areaId, this);
            }
        } else {
            this.traced[areaId][attr] = undefined;
        }
    }

    watcherId: number;

    totalUpdateInputTime: number = 0;

    attributedTime: number = 0;

    updateInput(id: string[], result: Result): void {
        var updateType: string = id[0];
        var areaId: string = id[1];

        switch (updateType) {
          case "signal": // Area added or removed
            if (result.value.length !== 0) {
                // Reregister
                var area = allAreaMonitor.getAreaById(areaId);
                area.initWatchers();
                for (var attr1 in this.traced[areaId]) {
                    this.addTraceFor(areaId, attr1);
                }
            } else {
                for (var attr1 in this.traced[areaId]) {
                    this.removeTraceFor(areaId, attr1, false);
                    console.log("trace", areaId, attr1, "destroyed");
                }
            }
            break;
          case "value": // Change to expression
            var attr: string = id[2];
            if (result !== undefined) {
                console.log("trace", areaId, attr, result.value);
            } else {
                var en: EvaluationNode = this.traced[areaId][attr];
                en.removeWatcher(this, true, false);
                this.traced[areaId][attr] = undefined;
                console.log("trace", areaId, attr, "destroyed");
            }
        }
    }

    isActive(): boolean {
        return true;
    }

    isReady(): boolean {
        return true;
    }

    isDeferred(): boolean {
        return false;
    }

    defer(): void {
    }

    undefer(): void {
    }

    debugName(): string {
        return "contextTrace";
    }

    getDebugOrigin(): string[] {
        return ["contextTrace"];
    }
}

var gContextAttributeTracer = new ContextAttributeTracer();

function debugIterate(set: any, fun: (value: any, index: number) => void): void {
    var array: any[] = set instanceof MoonOrderedSet? set.os:
                       set instanceof Array? set:
                       [set];

    for (var i: number = 0; i < array.length; i++) {
        fun(array[i], i);
    }
}

function contextTrace(areaId: string, attr: string|number): void {
    if (gDomEvent !== undefined && areaId !== "" &&
          allAreaMonitor.getAreaById(areaId) === undefined) {
        console.log("no such area:", areaId);
    }
    if (gContextAttributeTracer.isBeingTraced(areaId, attr)) {
        console.log("already being traced");
        return;
    }
    gContextAttributeTracer.addTraceFor(areaId, attr);
}

//alias for contextTrace
var cT = contextTrace;

function contextUntrace(areaId: string, attr: string) {
    if (!gContextAttributeTracer.isBeingTraced(areaId, attr)) {
        console.log("not being traced");
        return;
    }
    gContextAttributeTracer.removeTraceFor(areaId, attr);
}

var areaDebugBreaks: {[areaId: string]: {[writeName: string]: {[caseName: string]: boolean}}} = {};

function setDebugBreak(areaId: any, writeName?: any, caseName?: any): void {
    if (typeof(areaId) === "string" && writeName === undefined && caseName === undefined) {
        var arr = areaId.split(":");
        areaId = arr[0] + ":" + arr[1];
        writeName = arr[2];
        caseName = arr[3];
    }
    debugIterate(areaId, (areaId: any, index0: number): void =>  {
        if (areaId === _) {
            areaId = "_";
        }
        if (!(areaId in areaDebugBreaks)) {
            areaDebugBreaks[areaId] = {};
        }
        debugIterate(writeName, (writeName: any, index1: number): void =>  {
            if (writeName === _) {
                writeName = "_";
            }
            if (!(writeName in areaDebugBreaks[areaId])) {
                areaDebugBreaks[areaId][writeName] = {};
            }
            debugIterate(caseName, (caseName: any, index2: number): void =>  {
                if (caseName === _) {
                    caseName = "_";
                }
                areaDebugBreaks[areaId][writeName][caseName] = true;
            });
        });
    });
}

function clearDebugBreak(areaId: any, writeName: any, caseName: any): void {
    debugIterate(areaId, (areaId: any, index0: number): void => {
        if (areaId === _) {
            areaId = "_";
        }
        if (!(areaId in areaDebugBreaks)) {
            return;
        }
        debugIterate(writeName, (writeName: any, index1: number): void => {
            if (writeName === _) {
                writeName = "_";
            }
            if (!(writeName in areaDebugBreaks[areaId])) {
                return;
            }
            debugIterate(caseName, (caseName: any, index2: number): void => {
                if (caseName === _) {
                    caseName = "_";
                }
                delete areaDebugBreaks[areaId][writeName][caseName];
            });
        });
    });
}

function shouldDebugBreak(areaId: string, writeName: string, caseName: string): boolean {
    if (!(areaId in areaDebugBreaks)) {
        if ("_" in areaDebugBreaks) {
            areaId = "_";
        } else {
            return false;
        }
    }
    if (!(writeName in areaDebugBreaks[areaId])) {
        if ("_" in areaDebugBreaks[areaId]) {
            writeName = "_";
        } else {
            return false;
        }
    }
    if (!(caseName in areaDebugBreaks[areaId][writeName])) {
        return "_" in areaDebugBreaks[areaId][writeName];
    }
    return areaDebugBreaks[areaId][writeName][caseName];
}

var gGlobalDefaultChangeList: any = [{}];

function setGlobalDefault(pathStr: any, value: any, mode?: string): void {
    if (typeof(pathStr) !== "string" || pathStr.length === 0) {
        console.log("path must be a non-empty string");
        return;
    }
    if (typeof(globalDefaultsNodeIndex) === "undefined") {
        console.log("application doesn't use global defaults");
        return;
    }
    var path: string[] = pathStr.split(".");
    var position: DataPosition[] = [new DataPosition(0, 1)];
    var globalDefaultsNode: EvaluationWrite =
        <EvaluationWrite> globalEvaluationNodes[globalDefaultsNodeIndex];
    var writeResult: Result = new Result(normalizeObject(value));
    var mergeAttributes: MergeAttributes = new MergeAttributes(
        mode === "push", mode === "atomic", mode === "erase").
        extendWithPath(path);
    var pct: PositionChangeTracker = new PositionChangeTracker();

    for (var i: number = path.length - 1; i >= 0; i--) {
        position = [new DataPosition(0, 1, [path[i]], position)];
    }
    globalDefaultsNode.write(
        writeResult, WriteMode.merge, mergeAttributes, position, true);
    gGlobalDefaultChangeList = determineWrite(gGlobalDefaultChangeList,
                  writeResult, WriteMode.merge, mergeAttributes, position, pct);
    gGlobalDefaultChangeList[pathStr] = value;
    evaluationQueue.releaseLatched();
    if (!globalDefaultsNode.isActive()) {
        globalDefaultsNode.eval();
    }
}

function getGlobalDefaults(): void {
    var globalDefaultsNode: EvaluationWrite =
        <EvaluationWrite> globalEvaluationNodes[globalDefaultsNodeIndex];

    console.log(cdlify(globalDefaultsNode.result.value, ""));
}

function printGlobalDefaultChanges(): void {
    console.log(cdlify(gGlobalDefaultChangeList, ""));
}

var dbgCreateList: any[] = undefined;

function areaHierarchy(area: CoreArea = allAreaMonitor.getAreaById("1:1")): any {
    var hier: any = {};
    var embedded: ElementReference[] =
        areaRelationMonitor.getRelation(area.areaId, "embedded").slice(0);
    
    function compareSiblingsByComment(areaRef1: ElementReference, areaRef2: ElementReference): number {
        var area1 = allAreaMonitor.getAreaById(areaRef1.getElement());
        var childName1 = area1.comment.slice(area1.comment.lastIndexOf(":") + 1);
        var area2 = allAreaMonitor.getAreaById(areaRef2.getElement());
        var childName2 = area2.comment.slice(area2.comment.lastIndexOf(":") + 1);

        // Note that no two areas can be identical
        return childName1 < childName2? -1:
              childName1 > childName2? 1:
              area1.areaId < area2.areaId? -1:
              1;
    }

    embedded.sort(compareSiblingsByComment);
    for (var i = 0; i !== embedded.length; i++) {
        var childAreaId = embedded[i].getElement();
        var childArea = allAreaMonitor.getAreaById(childAreaId);
        var areaLabel = childAreaId + "(" + childArea.tAreaId + ") " + childArea.comment;
        hier[areaLabel] = areaHierarchy(childArea);
    }
    return hier;
}

function sortAreaIds(areaIds: string[]): string[] {
    return areaIds.map(function(areaId){
        var splt = areaId.split(":");
        return { t: Number(splt[0]), e: Number(splt[1]), id: areaId };
    }).sort(function(a, b) {
        return a.t !== b.t? a.t - b.t: a.e - b.e;
    }).map(function(e) {
        return e.id;
    });
}

function printAllDataSourceApplicationTrees(activeOnly: boolean): {[key: string]: any} {
    var appls: {[key: string]: any} = {};

    function allExpr(areaId: string, nodes: EvaluationNode[]): void {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (node && node instanceof EvaluationFunctionApplication &&
                  (node.bif.name === "datatable" || node.bif.name === "database") &&
                  node.result.dataSource !== undefined) {
                appls[node.prototype.idStr() + ": " + node.prototype.toString()] =
                      node.result.dataSource.dumpApplicationStructure(activeOnly);
            }
            if (node instanceof EvaluationApply) {
                if (node.environment !== undefined) {
                    allExpr(areaId, node.environment.cache);
                }
            } else if (node instanceof EvaluationMap ||
                       node instanceof EvaluationFilter ||
                       node instanceof EvaluationMultiQuery) {
                if (node.environments !== undefined) {
                    for (var j = 0; j < node.environments.length; j++) {
                        allExpr(areaId, node.environments[j].cache);
                    }
                }
            }
        }
    }

    if (activeOnly === undefined) {
        activeOnly = true;
    }
    allExpr("global", globalEvaluationNodes);
    var areaIds = sortAreaIds(Object.keys(allAreaMonitor.allAreas));
    for (var i = 0; i < areaIds.length; i++) {
        var areaId = areaIds[i];
        var area = allAreaMonitor.allAreas[areaId];
        allExpr(areaId, area.evaluationNodes[0]);
    }
    return appls;
}

function printAllDataSourceApplications(): void {
    for (var id in debugDataSourceObject) {
        var dso = debugDataSourceObject[id];
        if (!(dso instanceof DataSourceComposable)) {
            continue;
        }
        var str = String(dso.id) + " " + dso.debugInfo() + " ->";
        if (dso.dataQueryDSMap) {
            dso.dataQueryDSMap.forEach((qsIdMap: Map<number, DataSourceQueryByData>, ownerId: number): void => {
                qsIdMap.forEach((qds: DataSourceQueryByData, querySourceId: number): void => {
                    str += " query:" + String(qds.id);
                })
            });
        }
        if (dso.functionDSMap) {
            dso.functionDSMap.forEach((fds: DataSourceFunctionApplication, functionName: string): void => {
                str += " func:" + String(fds.id);
            });
        }
        if (dso.orderingDSMap) {
            dso.orderingDSMap.forEach((ods: DataSourceOrdering, watcherId: number): void => {
                str += " ordering:" + String(ods.id);
            });
        }
        if (dso.sortDSMap) {
            dso.sortDSMap.forEach((ods: DataSourceSort, watcherId: number): void => {
                str += " sort:" + String(ods.id);
            });
        }
        if (dso.elementIdQueryDSMap) {
            dso.elementIdQueryDSMap.forEach((qds: DataSourceQueryByElementId, watcherUd: number): void => {
                str += " elemId:" + String(qds.id);
            });
        }
        if (dso.identityDSMap) {
            dso.identityDSMap.forEach((ids: DataSourceIdentityApplication, identityAttribute: string): void => {
                str += " id:" + String(ids.id);
            });
        }
        if (dso.elementIdTransformationMapDSMap) {
            dso.elementIdTransformationMapDSMap.forEach((ets: DataSourceComposable, transformationName: string): void => {
                str += " idTransform:" + String(ets.id);
            });
        }
        if (dso.mergeUnderIdentityWithPathDSMap) {
            dso.mergeUnderIdentityWithPathDSMap.forEach((muiwp: DataSourceMergeUnderIdentityWithPath, watcherId: number): void => {
                str += " muiwp:" + String(muiwp.id);
            });
        }
        if (dso.dataSourceMultiplexer) {
            str += " multiplex:" + String(dso.dataSourceMultiplexer.id);
        }
        if (dso.indexQueryDSMap) {
            dso.indexQueryDSMap.forEach((iqs: DataSourceIndex, watcherId: number): void => {
                str += " index:" + String(iqs.id);
            });
        }
        console.log(str);
    }
}

function Av_(areaId: string): string[] {
    var area = allAreaMonitor.getAreaById(areaId);
    var evaluationNodes = area.evaluationNodes[0];
    var qualifierNodes = <EvaluationQualifiers[]> evaluationNodes.filter(function(en) {
        return en instanceof EvaluationQualifiers;
    });
    var rep: {[qStr: string]: number} = {};
    var activeVariants: string[] = [];

    for (var i = 0; i < qualifierNodes.length; i++) {
        var qualifierNode = qualifierNodes[i];
        for (var j = 0; j < qualifierNode.qualifiedVariants.length; j++) {
            if (qualifierNode.qualifiedVariants[j]) {
                var qualifiers = qualifierNode.prototype.qualifiers[j];
                var qStr = "{" + qualifiers.map(function(sq) {
                    var lvlDiff = getLevelDifference(qualifierNode.prototype.localToArea, sq.localToArea, true);
                    return lvlDiff === 0?
                           sq.originalAttribute + ":" + cdlify(sq.originalValue):
                           sq.originalAttribute + "/" + lvlDiff + ":" + cdlify(sq.originalValue);
                }).join(", ") + "}";
                if (!(qStr in rep)) {
                    rep[qStr] = 1;
                    activeVariants.push(qStr);
                }
            }
        }
    }
    return activeVariants.sort();
}

function printAllActiveVariants(): void {
    for (var areaId in allAreaMonitor.allAreas) {
        var area: CoreArea = allAreaMonitor.allAreas[areaId];
        var activeVariants: string[] = Av_(areaId);
        console.log(String(area.template.id) + "\t" + area.areaId + "\t" + activeVariants.join("\t"));
    }
}

class SimpleLogger {
    logs: string[] = [];
    print: boolean = true;

    log(...args: any[]): void {
        var str = args.join(" ");

        if (this.print) {
            console.log(str);
        } else {
            this.logs.push(str);
        }
    }
}

var gSimpleLog = new SimpleLogger();s