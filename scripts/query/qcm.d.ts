// Copyright 2017 Yoav Seginer, Theo Vosse, Gil Harari, and Uri Kolodny.
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

interface CompleteIncrementalUpdateTask {
    isActive(): boolean;
    scheduledForCompleteIncrementalUpdateTask: boolean;
    completeIncrementalUpdateTaskCancelled: boolean;
    completeIncrementalUpdate(): void;
}

declare class IntHashMap<T> {
    constructor(initialSize: number);
    clear(): void;
    makeValueArray(): Array<T>;
    set(key: number, value: T): void;
    has(key: number): boolean;
    get(key: number): T|undefined;
    getPos(key: number): number;
    delete(key: number): void;
    forEach(func: (value: T, id: number) => void): void;
    suspendMinFill(): void;
    resetMinFill(): void;
    expectSize(expectedSize: number): void;
    resize(): void;
}

declare class QCM {
    getRootPathId(): number;
    allocatePathId(pathId: number, attr: string): number;
    allocatePathIdFromPath(pathId: number, subPath: string[]): number;
    allocatePathIdByPathId(pathId: number): number;
    getPrefix(pathId: number): number;
    getPathId(prefixId: number, attr: string): number;
    releasePathId(pathId: number): void;
    getPathStrings(pathId: number): string[];
    getLastPathAttr(pathId: number): string;
    scheduleCompleteIncrementalUpdate(taskObj: CompleteIncrementalUpdateTask): void;
    executeScheduled(timer?: TimedOut): boolean;
    executeGarbageCollection(taskQueue: TaskQueue): boolean;

    static newId(): number;
}

declare class InternalQCM extends QCM {
}

declare class ElementNode {
    pathId: number;
    parent: number;
    children: Map<number, DataElementPathChildren>;
}

declare class DataElementPathChildren {
    ids: Map<number, any>
}

declare class PathNodeValue {
    key: any;
    type: string;
    objectValue: any; // experimental addition for storing objects as terminal value
}

declare class PathNode {
    indexer: InternalQCMIndexer;
    pathId: number;
    parent: PathNode;
    parentAttr: string;
    nodes: Map<number, PathNodeValue>;
    prevKeys: Map<number, PathNodeValue>;
    dataElementCount: number;
    scheduled: boolean;
    unloadedDataElementIds: RangeValue[];
    children: {[attr: string]: PathNode};
    trace: boolean;
}

declare class DataElements {
    getEntry(elementId: number): ElementNode;
}

// Receive updates from an indexer about changes to elements on a certain path.
// QueryCalc implements this interface.
interface IndexerTraceUpdateKeysInterface {
    // Path id must be set
    pathId: number;

    // Must return a unique number
    getId(): number;

    // Set to true when isSelection() is true but this object does not require
    // indexing.
    doNotIndex: boolean;

    // Return true when a selection, false when projection. Return true in
    // case this object doesn't represent either and doesn't implement
    // the projection interface.
    isSelection(): boolean;

    // Process the changes
    updateKeys(elementIds: number[], types: string[], keys: SimpleValue[],
               prevTypes: string[], prevKeys: SimpleValue[]): void;

    // Called when a selection query needs to remove indexer matches; other
    // objects can implement this as a NOP.
    removeAllIndexerMatches(): void;
}

interface IndexerTraceUpdateMatchesInterface {
    // Path id must be set
    pathId: number;

    // Must return a unique number
    getId(): number;

    // Set to true when isSelection() is true but this object does not require
    // indexing.
    doNotIndex: boolean;

    // Return false to activate this interface.
    isSelection(): boolean;

    // Called when nodes are added to a path node
    addMatches(elementIDs: number[], pathNode: PathNode): void;

    // Called when nodes are removed from a path node
    removeMatches(elementIDs: number[], pathNode: PathNode): void;
}

declare class InternalQCMIndexer {

    static getNextDataElementId(): number;
    static getDataElementIdRange(nrDataElements: number): number;

    qcm: QCM;
    paths: PathNode;
    pathNodesById: {[dataElementId: string]: PathNode};
    dataElements: DataElements;
    rootPathNodeId: number;

    constructor(internalQCM: QCM);

    destroy(): void;
    release(): void;

    getId(): number;
    getRootPathId(): number;
    clear(): void;

    keepPathNodeActive(pathNode: PathNode): void;
    releaseKeepPathNodeActive(pathNode: PathNode): void;
    
    addPath(pathId: number): PathNode;
    createPathNode(pathId: number): PathNode;
    removePathNode(pathNode: PathNode): void;
    incPathNodeTracing(pathNode: PathNode): void;
    decPathNodeTracing(pathNode: PathNode): void;

    expectAdditionalDataElementNum(dataElementNum: number): void;
    expectNodeNum(pathNode: PathNode, numNodes: number): void;
    addDataElementNode(pathNode: PathNode, dataElementId: number,
                       parentDataElementId: number, baseIdentity?: any,
                       groupId?: number, sourceId?: number): ElementNode;
    addNonDataElementNode(pathNode: PathNode, elementId: number): void;

    getPrevKey(pathNode: PathNode, elementID: number): PathNodeValue;
    setKeyValue(pathNode: PathNode, elementId: number, type: string, obj: any,
                isNewNode?: boolean): void;

    removeDataElement(dataElementId: number): void;

    removeNode(pathNode: PathNode, dataElementId: number): void;

    getRootPathId(): number;

    addQueryCalcToPathNode(monitor: IndexerTraceUpdateKeysInterface): void;
    removeQueryCalcFromPathNode(monitor: IndexerTraceUpdateKeysInterface): void;

    needKeyUpdateForQuery(monitor: IndexerTraceUpdateKeysInterface): void;
    stopKeyUpdateForQuery(monitor: IndexerTraceUpdateKeysInterface): void;

    getPrevKeyObj(pathNode: PathNode): Map<number, PathNodeValue>;
}

declare class IdentityIndexer extends InternalQCMIndexer {
    getBaseIdentity(elementId: number): any;
    getAdditionalIdentity(identificationId: number, elementId: number): any;
    setBaseIdentityForExistingNode(elementId: number, identity: any): void;
}

declare class MergeIndexer extends IdentityIndexer {
}

declare class FuncResult {
    qcm: QCM;
    id: number;

    composedActive: {[id: number]: InternalDataComposition};
    composedActiveNum: number;

    isActiveStar(): boolean;

    dataObj: FuncResult;

    constructor(qcm: QCM);

    destroy(): void;

    getId(): number;

    setData(data: FuncResult): void;

    setQuery(query: QueryDescInterface): void;

    refreshIndexerAndPaths(dataObj: FuncResult): void;
    replaceIndexerAndPaths(prevPrefixPathId: number, prefixPathId: number,
                           dataObj: FuncResult): void;

    getDominatedIndexer(): InternalQCMIndexer;
    getDominatedProjPathNum(): number;
    getDominatedProjPathId(): number;
    getDominatedProjMappings(): any;
    getDominatedMatches(projectionId?: number): number[];
    getDominatedMatchesAsObj(projectionId?: number): IntHashMap<any>;
    getDominatedIdentification(): number;

    getDifference(oldFuncResult: FuncResult, added: number[], removed: number[]): void;
    filterDominatedMatchPositions(elementIDs: number[]): number[];

    addActiveComposedFunc(composedFunc: FuncResult, wasComposed: boolean): void;
    removeActiveComposedFunc(composedFuncId: number): void;

    isActive(): boolean;
    activated(): void;
    deactivated(): void;
}

// Some of these functions have a default implementation in FuncResult, but
// really should be implemented by the derived class.
interface InternalDataComposition {
    supportsMultiProj(): boolean;

    isActive(): boolean;

    refreshIndexerAndPaths(dataObj: FuncResult): void;
    replaceIndexerAndPaths(prevPrefixPathId: number, prefixPathId: number,
                           dataObj: FuncResult): void;

    refreshProjMappings(pathMappings: any): void;

    addDataObjMatches(oldDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void;
    removeDataObjMatches(newDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void;

    addMatches(elementIDs: number[], source: FuncResult): void;
    removeMatches(elementIDs: number[], source: FuncResult): void;
    removeAllMatches(source: FuncResult): void;

    addProjMatches(elementIDs: number[], resultID: number, projectionID: number): void;
    removeProjMatches(elementIDs: number[], resultID: number, projectionID: number): void;
}

declare class DataResult extends FuncResult {
    constructor(qcm: QCM, indexer: InternalQCMIndexer, pathId: number,
                identificationId?: number, isReplaceable?: boolean);

    indexer: InternalQCMIndexer;
}

interface QueryDescInterface {
}

declare class Query extends FuncResult implements QueryDescInterface {
    constructor(qcm: QCM);

    lockActive(lockName: string): void;
    unlockActive(lockName: string): void;
}

declare class IdQuery extends FuncResult implements QueryDescInterface {
    constructor(qcm: QCM);
    addDataElements(elementIDs: number[]): void;
    removeDataElements(elementIDs: number[]): void;
    refreshQuery(): void;
}

declare class ResultToMerge extends FuncResult {
    constructor(qcm: QCM, targetIndexer: InternalQCMIndexer,
                minTargetPathId: number, priority: number,
                sourceIdentificationId: number, targetIdentificationId: number,
                underIdentity: boolean, identityOnly: boolean);
}

declare class RootQueryCalc {
    id: number;
}

declare class InternalRootQueryCalc extends RootQueryCalc {
    indexer: InternalQCMIndexer;
    prefixProjPathId: number;
    projPathId: number;
}

declare class InternalQueryResult extends FuncResult {
    constructor(qcm: QCM, assumeNonZeroDomMatchCount: boolean);
    matchCount: number;
    matches: any;
    rootQueryCalc: InternalRootQueryCalc;

    getDominatedMatches(): number[];

    getDominatedMatchesAsObj(): IntHashMap<any>;
}

declare class IdentityResult extends FuncResult {
    constructor(qcm: QCM, identifiedDataObj: FuncResult,
                identity?:number, identificationId?: number);

    setIdentifiedData(identificationObj: FuncResult): void;
    setIdentificationData(identificationObj: FuncResult): void;
}

declare class Comparison {

    constructor(internalQCM: QCM);

    destroy(): void;
}

declare class PartitionComparison extends Comparison {

    constructor(internalQCM: QCM);

    projPathId: number;
    setPartition(projPathId: number, queries: any[], gapPos: number,
                 partitionAscending: boolean, valueAscending: boolean): void;
}

declare class CompResult extends FuncResult {

    constructor(qcm: QCM);

    setComparison(comp: Comparison): void;

}

declare class OrderResult extends FuncResult {
}

interface OrderTracingInterface {
    updatePos(elementIds: number[], firstOffset: number,
              lastOffset: number, setSize: number): void;
}

declare class RangeOrderResult extends OrderResult {
    updateOffsets(offset: number[], lowOpen: boolean, highOpen: boolean, isOrderRange: boolean): void;
    addOrderTracing(orderTracingObj: OrderTracingInterface): void;
    removeOrderTracing(orderTracingObj: OrderTracingInterface): void;
}

declare class IndexOrderResult extends FuncResult {
    setOrderedData(data: FuncResult): void;
    setToIndexData(query: FuncResult): void;
}

declare var globalInternalQCM: QCM;
