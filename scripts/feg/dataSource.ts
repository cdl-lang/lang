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

/// <reference path="../utils/node.d.ts" />
/// <reference path="../query/qcm.d.ts" />
/// <reference path="../query/fegReplaceableValueIndexer.ts" />

interface ReceiveDataSourceResult {
    watcherId: number;
    newDataSourceResult(v: any[]): void;
    reextractData(dataSource: DataSourceComposable): void;
}

var debugDataSourceObject: {[id: number]: DataSource} = {};

type ComparisonFunctionElement = {
    queries: any[];
    simpleQueries: SimpleQuery[];
    orderByValue: boolean;
    inAscendingOrder: boolean;
    unmatched: number; // -1 means at the end
};

type PathComparisonFunction = {
    path: string[];
    comparisons: ComparisonFunctionElement[];
};

/**
 * Minimum requirement for the contents of the result.
 * 
 * Non-data-source-aware watchers can specify the level of detail they are
 * interested in. E.g., for display:text:value, it doesn't make sense to ask
 * for anything more than a single, simple value, but complex functions might
 * want to see the whole result in order. The result received is guaranteed to
 * be at least of the required level, but can be of a higher level. The levels
 * are: 
 * 
 * * single: only one simple value is required; if the set is larger, an
 *   arbitrary value is returned.
 * * simple: all simple values are required, in arbitrary order.
 * * compound: all values are required, in arbitrary order.
 * * ordered: all values are required, in order.
 * 
 * @enum {number}
 */
enum MinimumResultRequirements {
    single,
    simple,
    compound,
    ordered
}

type AccuQuery = {
    selection?: string[];
    projections?: {[attr: string]: string[]};
    sort?: string;
    function?: string;
    position?: string;
    identity?: string;
    transform?: string;
    from: (AccuQuery | string);
    index?: AccuQuery;
};

function dataSourceGetSubtractionKey(prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>, elementID: number): PathNodeValue {
    return prevKeys !== undefined && prevKeys.has(elementID)?
           prevKeys.get(elementID):
           curKeys.get(elementID);
}

var dsRemoveQueue: DataSource[] = undefined;
var dsDestroyTimeOut: number = 0;

function dsRunCondRemove(): void {
    for (var i: number = 0; i < dsRemoveQueue.length; i++) {
        var ds: DataSource = dsRemoveQueue[i];
        if (ds !== undefined) {
            ds.conditionalDestroy();
        }
    }
    assert(dsRemoveQueue.every(function(d: DataSource): boolean{
        return d === undefined;
    }), "expecting all to have been removed");
    dsRemoveQueue = [];
}

/// This object can be passed along by a Result instead of an actual result.
/// Composition should take place on funcResult.
abstract class DataSource {
    static nextId: number = 1;

    static dataSourceFunctions: {[functionName: string]: (qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) => FuncResult} = {
        // cdl functions
        "size": makeSizeDSFunction,
        "not": makeNotDSFunction,
        "empty": makeNotDSFunction, // For data source, empty and not are equivalent
        "notEmpty": makeNotEmptyDSFunction,
        "sum": makeSumDSFunction,
        "min": makeMinDSFunction,
        "max": makeMaxDSFunction,
        "bool": makeBoolDSFunction,
        "singleValue": makeSingleValueDSFunction,
        // internal functions
        "changecount": makeChangeCountDSFunction,
        "changeinform": makeChangeInformerFunction
    };

    /** The id of this data source */
    id: number = DataSource.nextId++;;
    /** The input to which the operation is applied */
    input: DataSourceComposable;
    /** The nodes that create or own this operation, or are interested in its
     * result; operations that have a non data source output, like sum or bool,
     * send the result to them. An operation is not destroyed while there are
     * still receivers.
     */
    resultReceivers: Map<number, ReceiveDataSourceResult> = new Map<number, ReceiveDataSourceResult>();
    /// Number of result receivers that activate this data source (function)
    activatingReceivers: number = 0;

    // If this is set, there is a timer running that will call this.destroy();
    // this id can be used to cancel the timer.
    timeoutId: NodeJS.Timer|number;

    constructor(input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        this.input = input;
        this.resultReceivers.set(resultReceiver.watcherId, resultReceiver);
        debugDataSourceObject[this.id] = this;
    }

    destroy(): void {
        assert(this.id in debugDataSourceObject, "don't destroy twice");
        delete debugDataSourceObject[this.id];
        assert(this.resultReceivers !== undefined && this.resultReceivers.size === 0, "debugging");
        this.resultReceivers = undefined;
        this.input = undefined;
        this.removeEndOfUse();
    }

    activate(): void {
        Utilities.error("implement in derived class 1");
    }

    deactivate(): void {
        Utilities.error("implement in derived class 2");
    }

    conditionalDestroy(): void {
        if (this.resultReceivers.size === 0) {
            console.log("datasource", this.id, this.debugInfo(), "destroyed");
            this.destroy();
        } else {
            if (dsRemoveQueue !== undefined) {
                if (typeof(this.timeoutId) === "number") {
                    dsRemoveQueue[this.timeoutId] = undefined;
                } else {
                    Utilities.error("TODO: resolve different timeoutId type in node");
                }
            }
            this.timeoutId = undefined;
        }
    }

    abstract isEqual(ds: DataSource): boolean;

    markAsChanged(): void {
        Utilities.error("implement in derived class 4");
    }

    // When this data source is no longer in use, schedule it for destruction.
    checkEndOfUse(): void {
        if (this.resultReceivers.size === 0) {
            this.putOnRemoveQueue();
        }
    }

    // Removes the object from endOfUse scheduling: it removes the object from
    // the queue or clears the timeout.
    removeEndOfUse(): void {
        if (this.timeoutId !== undefined) {
            if (typeof(this.timeoutId) === "number") {
                if (dsRemoveQueue === undefined) {
                    clearTimeout(this.timeoutId);
                } else {
                    dsRemoveQueue[this.timeoutId] = undefined;
                }
            } else {
                Utilities.error("TODO: resolve different timeoutId type in node");
            }
            this.timeoutId = undefined;
        }
    }

    // When dsRemoveQueue is defined, all objects are moved to that queue and
    // destroyed when dsRunCondRemove runs. Otherwise, if dsDestroyTimeOut > 0,
    // the destruction is delayed by that time. If it is 0, destroy is called
    // immediately. This allows reuse of data sources in a certain time window.
    putOnRemoveQueue(): void {
        if (dsRemoveQueue === undefined) {
            if (this.timeoutId !== undefined) {
                if (typeof(this.timeoutId) === "number") {
                    clearTimeout(this.timeoutId);
                } else {
                    Utilities.error("TODO: resolve different timeoutId type in node");
                }
            }
            if (dsDestroyTimeOut === 0) {
                this.destroy();
            } else {
                this.timeoutId = setTimeout((): void => {
                    this.conditionalDestroy();
                }, dsDestroyTimeOut);
            }
        } else {
            if (this.timeoutId !== undefined) {
                if (typeof(this.timeoutId) === "number") {
                    dsRemoveQueue[this.timeoutId] = undefined;
                } else {
                    Utilities.error("TODO: resolve different timeoutId type in node");
                }
            }
            this.timeoutId = dsRemoveQueue.length;
            dsRemoveQueue[this.timeoutId] = this;
        }
    }

    addResultReceiver(resultReceiver: ReceiveDataSourceResult): void {
        assert(!this.resultReceivers.has(resultReceiver.watcherId), "do not register more than once");
        this.resultReceivers.set(resultReceiver.watcherId, resultReceiver);
        this.removeEndOfUse();
    }

    removeResultReceiver(resultReceiver: ReceiveDataSourceResult): void {
        assert(this.resultReceivers.has(resultReceiver.watcherId), "must be registered");
        this.resultReceivers.delete(resultReceiver.watcherId);
        this.checkEndOfUse();
    }

    belongsUniquelyTo(receiver: ReceiveDataSourceResult): boolean {
        return this.resultReceivers.size === 1 &&
               this.resultReceivers.has(receiver.watcherId);
    }

    hasSameSource(querySourceId: number): boolean {
        return false;
    }
    
    canMoveTo(receiver: ReceiveDataSourceResult, newInput: DataSourceComposable): boolean {
        return this.belongsUniquelyTo(receiver) && !newInput.isBasedOn(this);
    }

    isBasedOn(input: DataSource): boolean {
        var ptr = input;

        while (ptr !== undefined) {
            if (ptr === input) {
                return true;
            }
            ptr = ptr.input;
        }
        return false;
    }

    abstract refreshFuncResult(): void;

    // debug info
    abstract accumulatedQuery(): AccuQuery;

    debugInfo(): string {
        return "unknown";
    }

    // Tries to perform the query directly
    abstract getDebugResult(): any[];
};

interface DataSourceKeyUpdateInterface {
    indexerUpdateKeys(elementIds: number[], types: string[],
       keys: SimpleValue[], prevTypes: string[], prevKeys: SimpleValue[]): void;

    removeAllIndexerMatches(): void;
}

interface DataSourceKeyAndMatchesUpdateInterface extends DataSourceKeyUpdateInterface {
    addMatches(elementIDs: number[], pathNode: PathNode): void;
    removeMatches(elementIDs: number[], pathNode: PathNode): void;
}

class IndexerTracer implements IndexerTraceUpdateKeysInterface {
    doNotIndex: boolean = true; // Must be true
    id: number;
    parent: DataSourceKeyUpdateInterface;

    // The indexer to watch
    indexer: InternalQCMIndexer;
    // The id of the path to watch
    pathId: number;

    constructor(indexer: InternalQCMIndexer, pathId: number,
                parent: DataSourceKeyUpdateInterface) {
        this.id = InternalQCM.newId();
        this.indexer = indexer;
        this.pathId = pathId;
        indexer.addQueryCalcToPathNode(this);
        indexer.needKeyUpdateForQuery(this);
        this.parent = parent;
    }

    destroy(): void {
        this.indexer.stopKeyUpdateForQuery(this);
        this.indexer.removeQueryCalcFromPathNode(this);
        this.indexer = undefined;
    }

    getId(): number {
        return this.id;
    }

    isSelection(): boolean { // Must return true; otherwise the projection interface is used
        return true;
    }

    // Called when the content of the indexer/path changes. Note that when
    // elements get added or removed, they can also show up in the
    // add/removeMatches calls.
    updateKeys(elementIds: number[], types: string[], keys: SimpleValue[],
               prevTypes: string[], prevKeys: SimpleValue[]): void
    {
        this.parent.indexerUpdateKeys(
            elementIds, types, keys, prevTypes, prevKeys);
    }

    // Called when indexer is cleared. Since the monitor is not responsible
    // for match updates (but only for key updates) this call can be ignored
    // (the removal will be received from the input data source)
    removeAllIndexerMatches(): void {
    }
}

class IndexerTracerMatchUpdates extends IndexerTracer implements IndexerTraceUpdateMatchesInterface {
    parent: DataSourceKeyAndMatchesUpdateInterface;

    constructor(indexer: InternalQCMIndexer, pathId: number,
                parent: DataSourceKeyAndMatchesUpdateInterface) {
        super(indexer, pathId, undefined);
        this.parent = parent;
    }

    isSelection(): boolean { // false triggers calls to add/removeMatches
        return false;
    }

    addMatches(elementIDs: number[], pathNode: PathNode): void {
        this.parent.addMatches(elementIDs, pathNode);
    }

    removeMatches(elementIDs: number[], pathNode: PathNode): void {
        this.parent.removeMatches(elementIDs, pathNode);
    }
}

abstract class DataSourceComposable extends DataSource implements DataSourceKeyUpdateInterface {
    // The composable object
    funcResult: FuncResult;
    // Tracers per path that monitor changes to the path node; for a (slightly)
    // more efficient implementation, the resultReceivers should keep a re count
    // to determine if these are still needed.
    indexerTracers: {[pathId: number]: IndexerTracer};

    destroy() {
        if (this.funcResult !== undefined) {
            this.funcResult.destroy();
            this.funcResult = undefined;
        }
        this.stopIndexerMonitoring();
        super.destroy();
    }

    stopIndexerMonitoring(): void {
        for (var pathId in this.indexerTracers) {
            this.indexerTracers[pathId].destroy();
        }
        this.indexerTracers = undefined;
    }

    conditionalDestroy(): void {
        if ((this.dataQueryDSMap === undefined || this.dataQueryDSMap.size === 0) &&
              (this.orderingDSMap === undefined || this.orderingDSMap.size === 0) &&
              (this.sortDSMap === undefined || this.sortDSMap.size === 0) &&
              (this.elementIdQueryDSMap === undefined || this.elementIdQueryDSMap.size === 0) &&
              (this.functionDSMap === undefined || this.functionDSMap.size === 0) &&
              (this.elementIdTransformationMapDSMap === undefined || this.elementIdTransformationMapDSMap.size === 0) &&
              (this.mergeUnderIdentityWithPathDSMap === undefined || this.mergeUnderIdentityWithPathDSMap.size === 0) &&
              this.dataSourceMultiplexer === undefined) {
            super.conditionalDestroy();
        } else {
            this.removeEndOfUse();
        }
    }

    checkEndOfUse(): void {
        if ((this.dataQueryDSMap === undefined || this.dataQueryDSMap.size === 0) &&
              (this.orderingDSMap === undefined || this.orderingDSMap.size === 0) &&
              (this.sortDSMap === undefined || this.sortDSMap.size === 0) &&
              (this.elementIdQueryDSMap === undefined || this.elementIdQueryDSMap.size === 0) &&
              (this.functionDSMap === undefined || this.functionDSMap.size === 0) &&
              (this.identityDSMap === undefined || this.identityDSMap.size === 0) &&
              (this.elementIdTransformationMapDSMap === undefined || this.elementIdTransformationMapDSMap.size === 0) &&
              (this.mergeUnderIdentityWithPathDSMap === undefined || this.mergeUnderIdentityWithPathDSMap.size === 0) &&
              this.dataSourceMultiplexer === undefined) {
            super.checkEndOfUse();
        }        
    }

    alreadyRegisteredOn(receiver: ReceiveDataSourceResult, input: DataSourceComposable): boolean {
        throw "do not call";
    }

    moveToDataSource(receiver: ReceiveDataSourceResult, input: DataSourceComposable): void {
        throw "do not call";
    }

    static indexerIdMap: {[indexerId: number]: IndexerDataSource} = {};

    /// Creates a data source that is the root of a tree and consists of
    /// an indexer.
    static createIndexerDataSourceRoot(indexer: InternalQCMIndexer, resultReceiver: ReceiveDataSourceResult, name: string): IndexerDataSource {
        var indexerId: number = indexer.getId();
        var ids: IndexerDataSource;

        if (indexerId in IndexerDataSource.indexerIdMap) {
            ids = IndexerDataSource.indexerIdMap[indexerId];
            ids.addResultReceiver(resultReceiver);
        } else {
            IndexerDataSource.indexerIdMap[indexerId] = ids =
                new IndexerDataSource(indexer, resultReceiver, name);
        }
        return ids;
    }

    /// Creates a query in a FuncResult. These objects are not shared and cannot
    /// be updated.
    static createQueryDataSourceRoot(query: any, resultReceiver: ReceiveDataSourceResult): QueryDataSource {
        return new QueryDataSource(query, resultReceiver);
    }

    static globalId: number = 0;

    /**
     * Maps an owner id + querySourceId to a query application; use globalId for
     * the owner if the application chain is global.
     * 
     * @type {Map<number, Map<number, DataSourceQueryByData>>}
     * @memberof DataSourceComposable
     */
    dataQueryDSMap: Map<number, Map<number, DataSourceQueryByData>>;

    // Applies a query to this data source
    applyDataQuery(query: any, resultReceiver: ReceiveDataSourceResult, querySourceId: number, ownerId: number = DataSourceComposable.globalId): DataSourceQueryByData {
        var qds: DataSourceQueryByData;
        var queryString: string = cdlifyNormalized(query);
        var qsIdMap: Map<number, DataSourceQueryByData>;

        assert(typeof(querySourceId) === "number", "must be a number");
        if (!("dataQueryDSMap" in this)) {
            this.dataQueryDSMap = new Map<number, Map<number, DataSourceQueryByData>>();
        }
        if (this.dataQueryDSMap.has(ownerId)) {
            qsIdMap = this.dataQueryDSMap.get(ownerId);
        } else {
            qsIdMap = new Map<number, DataSourceQueryByData>();
            this.dataQueryDSMap.set(ownerId, qsIdMap);
        }
        if (qsIdMap.has(querySourceId)) {
            qds = qsIdMap.get(querySourceId);
            qds.updateQuery(query);
            qds.addResultReceiver(resultReceiver);
        } else {
            qds = new DataSourceQueryByData(query, resultReceiver.watcherId,
                                            queryString, querySourceId, ownerId,
                                            this, resultReceiver);
            qsIdMap.set(querySourceId, qds);
        }
        return qds;
    }

    removeDataQueryApplication(qds: DataSourceQueryByData): void {
        assert(this.dataQueryDSMap !== undefined &&
               this.dataQueryDSMap.has(qds.ownerId) &&
               this.dataQueryDSMap.get(qds.ownerId).has(qds.querySourceId),
               "debugging");
        var qsIdMap = this.dataQueryDSMap.get(qds.ownerId);

        qsIdMap.delete(qds.querySourceId);
        if (qsIdMap.size === 0) {
            this.dataQueryDSMap.delete(qds.ownerId);
        }
        this.checkEndOfUse();
    }

    getQueryApplicationWithSourceId(sourceId: number, ownerId: number = DataSourceComposable.globalId): DataSourceQueryByData {
        return this.dataQueryDSMap !== undefined && this.dataQueryDSMap.has(ownerId)?
               this.dataQueryDSMap.get(ownerId).get(sourceId): undefined;
    }

    elementIdQueryDSMap: Map<number, DataSourceQueryByElementId>;

    applyElementIdQuery(elementIDs: number[], resultReceiver: ReceiveDataSourceResult, watcherId: number): DataSourceQueryByElementId {
        var qds: DataSourceQueryByElementId;
        var queryString: string = "#" + elementIDs.join(",");

        if (!("elementIdQueryDSMap" in this)) {
            this.elementIdQueryDSMap = new Map<number, DataSourceQueryByElementId>();
        }
        if (this.elementIdQueryDSMap.has(watcherId)) {
            qds = this.elementIdQueryDSMap.get(watcherId);
            qds.addResultReceiver(resultReceiver);
        } else {
            qds = new DataSourceQueryByElementId(elementIDs, watcherId, queryString, this, resultReceiver);
            this.elementIdQueryDSMap.set(watcherId, qds);
        }
        return qds;
    }

    removeElementIdQueryApplication(qds: DataSourceQueryByElementId): void {
        assert(this.elementIdQueryDSMap !== undefined && this.elementIdQueryDSMap.has(qds.watcherId), "debugging");
        this.elementIdQueryDSMap.delete(qds.watcherId);
        this.checkEndOfUse();
    }

    functionDSMap: Map<string, DataSourceFunctionApplication>;

    // Applies an aggregate function to this data source
    applyAggregateFunction(functionName: string, resultReceiver: ReceiveDataSourceResult): DataSourceFunctionApplication {
        var fds: DataSourceFunctionApplication;

        if (!("functionDSMap" in this)) {
            this.functionDSMap = new Map<string, DataSourceFunctionApplication>();
        }
        if (this.functionDSMap.has(functionName)) {
            fds = this.functionDSMap.get(functionName);
            fds.addResultReceiver(resultReceiver);
        } else {
            fds = new DataSourceFunctionApplication(functionName, this, resultReceiver);
            this.functionDSMap.set(functionName, fds);
        }
        return fds;
    }

    removeFunctionApplication(fds: DataSourceFunctionApplication): void {
        assert(this.functionDSMap !== undefined && this.functionDSMap.has(fds.functionName), "debugging");
        this.functionDSMap.delete(fds.functionName);
        this.checkEndOfUse();
    }

    orderingDSMap: Map<number, DataSourceOrdering>;

    // Applies a query to this data source.
    // TODO: more than single ranges
    applyOrdering(q: any, resultReceiver: ReceiveDataSourceResult): DataSourceOrdering {
        var ods: DataSourceOrdering =
            new DataSourceOrdering(q, resultReceiver.watcherId, this, resultReceiver);

        if (!("orderingDSMap" in this)) {
            this.orderingDSMap = new Map<number, DataSourceOrdering>();
        }
        assert(!this.orderingDSMap.has(resultReceiver.watcherId), "don't register twice");
        this.orderingDSMap.set(resultReceiver.watcherId, ods);
        return ods;
    }

    removeOrderingApplication(qds: DataSourceOrdering): void {
        assert(this.orderingDSMap !== undefined && this.orderingDSMap.has(qds.watcherId), "debugging");
        this.orderingDSMap.delete(qds.watcherId);
        this.checkEndOfUse();
    }

    sortDSMap: Map<number, DataSourceSort>;

    // Applies a query to this data source.
    // TODO: more than single ranges
    applySort(pathComparisons: PathComparisonFunction[], resultReceiver: ReceiveDataSourceResult): DataSourceSort {
        if (!("sortDSMap" in this)) {
            this.sortDSMap = new Map<number, DataSourceSort>();
        }
        if (this.sortDSMap.has(resultReceiver.watcherId)) {
            var sds = this.sortDSMap.get(resultReceiver.watcherId);
            sds.addResultReceiver(resultReceiver);
            return sds;
        }
        var ods: DataSourceSort = new DataSourceSort(
            pathComparisons, resultReceiver.watcherId, this, resultReceiver);
        this.sortDSMap.set(resultReceiver.watcherId, ods);
        return ods;
    }

    removeSortApplication(qds: DataSourceSort): void {
        assert(this.sortDSMap !== undefined && this.sortDSMap.has(qds.watcherId), "debugging");
        this.sortDSMap.delete(qds.watcherId);
        this.checkEndOfUse();
    }

    identityDSMap: Map<string, DataSourceIdentityApplication>;

    // Applies an identity attribute to this data source
    applyIdentity(identityAttribute: string, resultReceiver: ReceiveDataSourceResult, querySourceId: number): DataSourceIdentityApplication {
        var ids: DataSourceIdentityApplication;

        if (!("identityDSMap" in this)) {
            this.identityDSMap = new Map<string, DataSourceIdentityApplication>();
        }
        if (this.identityDSMap.has(identityAttribute)) {
            ids = this.identityDSMap.get(identityAttribute);
            ids.addResultReceiver(resultReceiver);
        } else {
            ids = new DataSourceIdentityApplication(identityAttribute, this, resultReceiver, querySourceId);
            this.identityDSMap.set(identityAttribute, ids);
        }
        return ids;
    }

    removeIdentityApplication(ids: DataSourceIdentityApplication): void {
        assert(this.identityDSMap !== undefined && this.identityDSMap.has(ids.identityAttribute), "debugging");
        this.identityDSMap.delete(ids.identityAttribute);
        this.checkEndOfUse();
    }

    elementIdTransformationMapDSMap: Map<string, DataSourceElementIdTransformation>;

    // Applies an element id transformation to this data source
    applyElementIdTransformation(transformationName: string, resultReceiver: ReceiveDataSourceResult): DataSourceElementIdTransformation {
        var ets: DataSourceElementIdTransformation;

        if (!("elementIdTransformationMapDSMap" in this)) {
            this.elementIdTransformationMapDSMap = new Map<string, DataSourceElementIdTransformation>();
        }
        if (this.elementIdTransformationMapDSMap.has(transformationName)) {
            ets = this.elementIdTransformationMapDSMap.get(transformationName);
            ets.addResultReceiver(resultReceiver);
        } else {
            switch (transformationName) {
              case "uniqueById":
                ets = new DataSourceUniqueById(this, resultReceiver);
                break;
              default:
                Utilities.error("unknown element id transformation: " + transformationName);
                break;
            }
            this.elementIdTransformationMapDSMap.set(transformationName, ets);
        }
        return ets;
    }

    removeElementIdTransformation(ets: DataSourceElementIdTransformation): void {
        assert(this.elementIdTransformationMapDSMap !== undefined && this.elementIdTransformationMapDSMap.has(ets.transformationName), "debugging");
        this.elementIdTransformationMapDSMap.delete(ets.transformationName);
        this.checkEndOfUse();
    }

    mergeUnderIdentityWithPathDSMap: Map<number, DataSourceMergeUnderIdentityWithPath>;

    // Applies an mergeUnderIdentityWithPath attribute to this data source
    applyMergeUnderIdentityWithPath(path: string, resultReceiver: ReceiveDataSourceResult): DataSourceMergeUnderIdentityWithPath {
        var muiwp: DataSourceMergeUnderIdentityWithPath;

        if (!("mergeUnderIdentityWithPathDSMap" in this)) {
            this.mergeUnderIdentityWithPathDSMap = new Map<number, DataSourceMergeUnderIdentityWithPath>();
        }
        if (this.mergeUnderIdentityWithPathDSMap.has(resultReceiver.watcherId)) {
            muiwp = this.mergeUnderIdentityWithPathDSMap.get(resultReceiver.watcherId);
        } else {
            muiwp = new DataSourceMergeUnderIdentityWithPath(this, path, resultReceiver);
            this.mergeUnderIdentityWithPathDSMap.set(resultReceiver.watcherId, muiwp);
        }
        return muiwp;
    }

    removeMergeUnderIdentityWithPathApplication(muiwp: DataSourceMergeUnderIdentityWithPath): void {
        assert(this.mergeUnderIdentityWithPathDSMap !== undefined && this.mergeUnderIdentityWithPathDSMap.has(muiwp.watcherId), "debugging");
        this.mergeUnderIdentityWithPathDSMap.delete(muiwp.watcherId);
        this.checkEndOfUse();
    }

    dataSourceMultiplexer: DataSourceComposableMultiplexer;

    // The dataSourceMultiplexer can only be removed by destroying it (i.e., remove
    // all query applications and resultReceivers).
    getDataSourceMultiplexer(resultReceiver: ReceiveDataSourceResult): DataSourceComposableMultiplexer {
        if (this.dataSourceMultiplexer === undefined) {
            this.dataSourceMultiplexer = new DataSourceComposableMultiplexer(this, resultReceiver);
        } else {
            this.dataSourceMultiplexer.addResultReceiver(resultReceiver);
        }
        return this.dataSourceMultiplexer;
    }

    // Maps a funcResult id to an index application
    indexQueryDSMap = new Map<number, DataSourceIndex>();

    // Note the there are no apply/removeIndexQuery() functions on this node; they
    // can only be applied to a DataSourceComposableMultiplexer.

    dumpApplicationStructure(activeOnly: boolean = true): any {
        var appls: any = {};

        if (this.dataQueryDSMap) {
            this.dataQueryDSMap.forEach((qsIdMap: Map<number, DataSourceQueryByData>, ownerId: number): void => {
                qsIdMap.forEach((qds: DataSourceQueryByData, querySourceId: number): void => {
                    if (!activeOnly || qds.funcResult.isActiveStar()) {
                        var lbl: string = ownerId === 0?
                            querySourceId + ": " + qds.debugInfo():
                            querySourceId + "(owner=" + ownerId + "): " + qds.debugInfo();
                        appls[lbl] = qds.dumpApplicationStructure(activeOnly);
                    }
                })
            });
        }
        if (this.functionDSMap) {
            this.functionDSMap.forEach((fds: DataSourceFunctionApplication, functionName: string): void => {
                if (!activeOnly || fds.activatingReceivers > 0) {
                    appls[fds.debugInfo()] = "";
                }
            });
        }
        if (this.orderingDSMap) {
            this.orderingDSMap.forEach((ods: DataSourceOrdering, watcherId: number): void => {
                if (!activeOnly || ods.funcResult.isActiveStar()) {
                    appls[watcherId + ": " + ods.debugInfo()] =
                        ods.dumpApplicationStructure(activeOnly);
                }
            });
        }
        if (this.sortDSMap) {
            this.sortDSMap.forEach((ods: DataSourceSort, watcherId: number): void => {
                if (!activeOnly || ods.funcResult.isActiveStar()) {
                    appls[watcherId + ": " + ods.debugInfo()] =
                        ods.dumpApplicationStructure(activeOnly);
                }
            });
        }
        if (this.elementIdQueryDSMap) {
            this.elementIdQueryDSMap.forEach((qds: DataSourceQueryByElementId, watcherUd: number): void => {
                if (!activeOnly || qds.funcResult.isActiveStar()) {
                    appls["#" + qds.queryString + ": " + qds.debugInfo()] =
                        qds.dumpApplicationStructure(activeOnly);
                }
            });
        }
        if (this.identityDSMap) {
            this.identityDSMap.forEach((ids: DataSourceIdentityApplication, identityAttribute: string): void => {
                if (!activeOnly || ids.funcResult.isActiveStar()) {
                    appls[ids.debugInfo()] =
                        ids.dumpApplicationStructure(activeOnly);
                }
            });
        }
        if (this.elementIdTransformationMapDSMap) {
            this.elementIdTransformationMapDSMap.forEach((ets: DataSourceComposable, transformationName: string): void => {
                if (!activeOnly || ets.activatingReceivers > 0) {
                    appls[transformationName] =
                        ets.dumpApplicationStructure(activeOnly);
                }
            });
        }
        if (this.mergeUnderIdentityWithPathDSMap) {
            this.mergeUnderIdentityWithPathDSMap.forEach((muiwp: DataSourceMergeUnderIdentityWithPath, watcherId: number): void => {
                if (!activeOnly || muiwp.funcResult.isActiveStar()) {
                    appls[watcherId + ": " + muiwp.debugInfo()] =
                        muiwp.dumpApplicationStructure(activeOnly);
                }
            });
        }
        if (this.dataSourceMultiplexer) {
            if (!activeOnly || this.dataSourceMultiplexer.funcResult.isActiveStar()) {
                appls[this.dataSourceMultiplexer.debugInfo()] =
                    this.dataSourceMultiplexer.dumpApplicationStructure(activeOnly);
            }
        }
        if (this.indexQueryDSMap) {
            this.indexQueryDSMap.forEach((iqs: DataSourceIndex, watcherId: number): void => {
                if (!activeOnly || iqs.funcResult.isActiveStar()) {
                    appls[watcherId + ": " + iqs.debugInfo()] = "-->index";
                }
            });
        }
        return appls;
    }

    collectReachableDSIds(idSet: Set<number>): void {
        if (idSet.has(this.id)) {
            return;
        }
        idSet.add(this.id);
        if (this.dataQueryDSMap) {
            this.dataQueryDSMap.forEach(qsIdMap =>
                qsIdMap.forEach(ds =>
                    ds.collectReachableDSIds(idSet))
            );
        }
        if (this.functionDSMap) {
            this.functionDSMap.forEach(fds => idSet.add(fds.id));
        }
        if (this.orderingDSMap) {
            this.orderingDSMap.forEach(ds => ds.collectReachableDSIds(idSet));
        }
        if (this.sortDSMap) {
            this.sortDSMap.forEach(ds => ds.collectReachableDSIds(idSet));
        }
        if (this.elementIdQueryDSMap) {
            this.elementIdQueryDSMap.forEach(ds => ds.collectReachableDSIds(idSet));
        }
        if (this.identityDSMap) {
            this.identityDSMap.forEach(ds => ds.collectReachableDSIds(idSet));
        }
        if (this.elementIdTransformationMapDSMap) {
            this.elementIdTransformationMapDSMap.forEach(ds => ds.collectReachableDSIds(idSet));
        }
        if (this.mergeUnderIdentityWithPathDSMap) {
            this.mergeUnderIdentityWithPathDSMap.forEach(ds => ds.collectReachableDSIds(idSet));
        }
        if (this.dataSourceMultiplexer) {
            this.dataSourceMultiplexer.collectReachableDSIds(idSet);
        }
        if (this.indexQueryDSMap) {
            this.indexQueryDSMap.forEach(ds => ds.collectReachableDSIds(idSet));
        }
    }

    debugActive(): string {
        var funcResult: any = this.funcResult;
        
        return (funcResult.isActive()? "+": "-") +
            this.id + "(" + funcResult.id +
            (funcResult.resultIndexer ?
             ":idx:" + funcResult.resultIndexer.id : "") + ") ";
    }

    debugMatchList(): string {
        var matches: number[] = this.funcResult.getDominatedMatches();

        return "[" + 
               (matches.length > 10? matches.slice(0, 10): matches).join(",") +
               (matches.length > 10? ",...]": "]") + "/" + matches.length;
    }

    // TODO: key updates?
    extractData(req: MinimumResultRequirements, ord: OrderingResultWatcher): any[] {
        switch (req) {
          case MinimumResultRequirements.single:
            return this.extractDataSimple(true);
          case MinimumResultRequirements.simple:
            return this.extractDataSimple(false);
          case MinimumResultRequirements.compound:
            return this.extractDataComplex(undefined);
          case MinimumResultRequirements.ordered:
            return this.extractDataComplex(ord);
        }
        return [];
    }

    extractDataSimple(single: boolean): any[] {
        var indexer: InternalQCMIndexer = this.funcResult.getDominatedIndexer();
        var pathId: number = this.funcResult.getDominatedProjPathId();
        var pathNode: PathNode = indexer.pathNodesById[pathId];
        var res: any[] = [];
        var pathIds: {[pathId: number]: boolean} = {};

        pathIds[pathId] = true;
        try {
            this.funcResult.getDominatedMatchesAsObj().forEach(function(value: any, dataElementId: number): void {
                var node: PathNodeValue = pathNode.nodes.get(dataElementId);
                if (node !== undefined && node.key !== undefined) {
                    res.push(node.key);
                    if (single) {
                        throw 0;
                    }
                }
            });
        } catch (ex) {
            // Expected to get here when single is true
            if (!single || ex !== 0) {
                throw ex;
            }
        }
        this.updateIndexerMonitors(pathIds, indexer);
        return res;
    }

    nrExtractedElements: number = 0;

    extractDataComplex(ord: OrderingResultWatcher, updateIndexerMonitors: boolean = true): any[] {
        var indexer: InternalQCMIndexer = this.funcResult.getDominatedIndexer();
        var pathId: number = this.funcResult.getDominatedProjPathId();
        var pathNode: PathNode = indexer.pathNodesById[pathId];
        var res: any[] = [];
        var pathIds: {[pathId: number]: boolean} = {};

        function extractObject(pathNode: PathNode, dataElement: ElementNode, dataElementId: number): any {
            var res: any = {};

            for (var attr in pathNode.children) {
                var childPathNode: PathNode = pathNode.children[attr];
                var node: PathNodeValue = childPathNode.nodes.get(dataElementId);
                if (node !== undefined) {
                    var val: any = node.key !== undefined? node.key:
                        extractObject(childPathNode, dataElement, dataElementId);
                    if (val !== undefined) {
                        if (attr in res) {
                            res[attr].push(val);
                        } else {
                            res[attr] = [val];
                        }
                        if (!(childPathNode.pathId in pathIds)) {
                            pathIds[childPathNode.pathId] = true;
                        }
                    }
                }
                if (dataElement.children !== undefined &&
                    dataElement.children.has(childPathNode.pathId)) {
                    dataElement.children.get(childPathNode.pathId).ids.
                        forEach((val: any, subDataElementId: number): void => {
                            var node: PathNodeValue = childPathNode.nodes.get(subDataElementId);
                            var val: any = node.key !== undefined? node.key:
                                extractObject(childPathNode,
                                              indexer.dataElements.getEntry(subDataElementId),
                                              subDataElementId);
                            if (val !== undefined) {
                                if (attr in res) {
                                    res[attr].push(val);
                                } else {
                                    res[attr] = [val];
                                }
                                if (!(childPathNode.pathId in pathIds)) {
                                    pathIds[childPathNode.pathId] = true;
                                }
                            }
                        });
                }
            }
            return res;
        }

        function extractDataElement(val: any, dataElementId: number): any {
            var node: PathNodeValue = pathNode.nodes.get(dataElementId);

            if (node !== undefined) {
                if (node.key !== undefined) {
                    res.push(node.key);
                } else {
                    var obj: any = extractObject(
                        pathNode, indexer.dataElements.getEntry(dataElementId),
                        dataElementId);
                    if (obj !== undefined) {
                        res.push(obj);
                    }
                }
            }
        }

        pathIds[pathId] = true;
        if (ord === undefined) {
            this.funcResult.getDominatedMatchesAsObj().forEach(extractDataElement);
        } else {
            for (var i: number = 0; i < ord.dataElementIdsInOrder.length; i++) {
                extractDataElement(undefined, ord.dataElementIdsInOrder[i]);
            }
        }
        if (updateIndexerMonitors) {
            this.updateIndexerMonitors(pathIds, indexer);
        }
        if (productStatus <= ProductStatus.testing) {
            this.nrExtractedElements += res.length;
            if (res.length >= 500) {
                Utilities.warn("extracting " + res.length + " elements");
            } else if (this.nrExtractedElements >= 10000) {
                Utilities.warn("extracted " + this.nrExtractedElements + " so far");
            }
        }
        return res;
    }

    updateIndexerMonitoringForDominatedPath(): void {
        var indexer: InternalQCMIndexer = this.funcResult.getDominatedIndexer();
        var pathId: number = this.funcResult.getDominatedProjPathId();

        if (indexer !== undefined && pathId !== undefined) {
            var newPathIds: {[pathId: number]: boolean} = {};
            newPathIds[pathId] = true;
            this.updateIndexerMonitors(newPathIds, indexer);
        }
    }

    updateIndexerMonitors(newPathIds: {[pathId: number]: boolean}, indexer: InternalQCMIndexer): void {
        for (var oldPathId in this.indexerTracers) {
            if (!(oldPathId in newPathIds)) {
                this.indexerTracers[oldPathId].destroy();
                delete this.indexerTracers[oldPathId];
            }
        }
        if (this.indexerTracers === undefined) {
            this.indexerTracers = {};
        }
        for (var newPathId in newPathIds) {
            if (!(newPathId in this.indexerTracers)) {
                this.indexerTracers[newPathId] = new IndexerTracer(indexer, Number(newPathId), this);
            }
        }
    }

    // Requests that the data be extracted again. See IndexerMonitor.updateKeys
    indexerUpdateKeys(elementIds: number[], types: string[],
                      keys: SimpleValue[], prevTypes: string[],
                      prevKeys: SimpleValue[]): void
    {
        if (this.resultReceivers !== undefined) {
            this.resultReceivers.forEach((rr: ReceiveDataSourceResult): void => {
                rr.reextractData(this);
            });
        }
    }

    removeAllIndexerMatches(): void {
    }

    signalNewFuncResultToApplications(funcResult: FuncResult): void {
        if ("dataQueryDSMap" in this) {
            this.dataQueryDSMap.forEach((qsIdMap: Map<number, DataSourceQueryByData>, ownerId: number): void => {
                qsIdMap.forEach((qds: DataSourceQueryByData, querySourceId: number): void => {
                    qds.refreshFuncResult();
                })
            });
        }
        if ("functionDSMap" in this) {
            this.functionDSMap.forEach((fds: DataSourceFunctionApplication, functionName: string): void => {
                fds.refreshFuncResult();
            });
        }
        if ("orderingDSMap" in this) {
            this.orderingDSMap.forEach((ods: DataSourceOrdering, watcherId: number): void => {
                ods.refreshFuncResult();
            });
        }
        if ("sortDSMap" in this) {
            this.sortDSMap.forEach((ods: DataSourceSort, watcherId: number): void => {
                ods.refreshFuncResult();
            });
        }
        if ("elementIdQueryDSMap" in this) {
            this.elementIdQueryDSMap.forEach((qds: DataSourceQueryByElementId, watcherId: number): void => {
                qds.refreshFuncResult();
            });
        }
        if ("identityDSMap" in this) {
            this.identityDSMap.forEach((ids: DataSourceIdentityApplication, identityAttribute: string): void => {
                ids.refreshFuncResult();
            });
        }
        if ("elementIdTransformationMapDSMap" in this) {
            this.elementIdTransformationMapDSMap.forEach((ets: DataSourceComposable, transformationName: string): void => {
                ets.refreshFuncResult();
            });
        }
        if ("mergeUnderIdentityWithPathDSMap" in this) {
            this.mergeUnderIdentityWithPathDSMap.forEach((muiwp: DataSourceMergeUnderIdentityWithPath, watcherId: number): void => {
                muiwp.refreshFuncResult();
            });
        }
        if (this.dataSourceMultiplexer !== undefined) {
            this.dataSourceMultiplexer.refreshFuncResult();
        }
    }
}

class IndexerDataSource extends DataSourceComposable {
    indexer: InternalQCMIndexer;
    funcResult: DataResult;
    name: string;

    constructor(indexer: InternalQCMIndexer, resultReceiver: ReceiveDataSourceResult, name: string) {
        super(undefined, resultReceiver);
        this.funcResult = new DataResult(globalInternalQCM, indexer, 
                                         globalInternalQCM.getRootPathId());
        this.name = name;
    }

    destroy(): void {
    }

    isEqual(ds: DataSource): boolean {
        if (ds instanceof IndexerDataSource) {
            return this.funcResult.getId() === ds.funcResult.getId();
        }
        return false;
    }

    refreshFuncResult(): void {
    }

    accumulatedQuery(): AccuQuery {
        return {from: this.name};
    }

    debugInfo(): string {
        return this.id + " indexer " + this.funcResult.getId();
    }

    getDebugResult(): any[] {
        for (var rr of this.resultReceivers.values()) {
            return (<any>rr).getDebugResult();
        }
        return [];
    }
}

// This is a wrapper around DataSourceQueryRefCount, which is not a
// DataSourceComposable. It does not share its query object, and it's not shared
// among other objects neither. Since it's not composed on top of another
// object, the only thing keeping it alive is its resultReceiver.
class QueryDataSource extends DataSourceComposable {
    funcResult: DataResult;
    private dataSourceQuery: DataSourceQueryRefCount;

    constructor(queryObj: any, resultReceiver: ReceiveDataSourceResult) {
        super(undefined, resultReceiver);
        this.dataSourceQuery = new DataSourceQueryRefCount(queryObj);
        this.funcResult = this.dataSourceQuery.queryDesc;
    }

    destroy(): void {
        this.dataSourceQuery.destroy();
        this.dataSourceQuery = undefined;
        this.funcResult = undefined;
        super.destroy();
    }

    isEqual(ds: DataSource): boolean {
        return this === ds;
    }

    refreshFuncResult(): void {
    }

    accumulatedQuery(): AccuQuery {
        return {from: this.dataSourceQuery.queryObj};
    }

    debugInfo(): string {
        return this.id + " queryRoot " + this.funcResult.getId();
    }

    getDebugResult(): any[] {
        return [this.dataSourceQuery.queryObj];
    }
}

// Queries cannot be (de)activated; they become active once an active non-query
// is registered.
abstract class DataSourceQuery extends DataSourceComposable {
    queryString: string;
    watcherId: number;
    funcResult: InternalQueryResult;

    constructor(queryString: string, watcherId: number, input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult, isSelectionChainEnd: boolean) {
        super(input, resultReceiver);
        this.queryString = queryString;
        this.watcherId = watcherId;
        this.funcResult = new InternalQueryResult(globalInternalQCM,
                                                  isSelectionChainEnd);
        this.funcResult.setData(input.funcResult);
    }

    refreshFuncResult(): void {
        this.funcResult.setData(this.input.funcResult);
    }
}

class DataSourceQueryRefCount {
    refCount: number = 0;
    queryObj: any; // debugging only
    queryIndexer: FEGReplaceableValueIndexer;
    queryDesc: DataResult;
    query: Query;

    constructor(queryObj: any) {
        this.queryObj = queryObj;
        this.queryIndexer = new FEGReplaceableValueIndexer(globalInternalQCM);
        this.queryIndexer.alwaysUniqueDataElementId = true;
        this.queryIndexer.minimizeDataElementMovement = true;
        this.queryIndexer.replaceRawObject(queryObj);
        this.queryDesc = new DataResult(globalInternalQCM, this.queryIndexer, 
                                        globalInternalQCM.getRootPathId());
        this.query = new Query(globalInternalQCM);
        this.query.setData(this.queryDesc);
        this.query.lockActive("DataSource");
    }

    destroy(): void {
        assert(this.refCount === 0, "DEBUGGING");
        this.query.unlockActive("DataSource");
        this.query.destroy();
        this.queryDesc.destroy();
        this.queryIndexer.destroy();
        this.query = undefined;
        this.queryDesc = undefined;
        this.queryIndexer = undefined;
    }

    update(queryObj: any): void {
        if (!objectEqual(this.queryObj, queryObj)) {
            this.queryObj = queryObj;
            this.queryIndexer.replaceRawObject(queryObj);
        }
    }
};

class DataSourceQueryByData extends DataSourceQuery {
    queryObj: any;
    querySourceId: number;
    ownerId: number;
    queryRef: DataSourceQueryRefCount;

    // This id can be used for the constant _ query object
    static _id: number = -1;
    static _idForSelectionChain: number = -2;

    static querySourceIdMap: Map<number, DataSourceQueryRefCount> = new Map<number, DataSourceQueryRefCount>();

    constructor(query: any, watcherId: number, queryString: string,
            querySourceId: number, ownerId: number, input: DataSourceComposable,
            resultReceiver: ReceiveDataSourceResult) {
        // querySourceId === _idForSelectionChain => multiQuery chain end
        super(queryString, watcherId, input, resultReceiver,
              querySourceId === DataSourceQueryByData._idForSelectionChain);
        this.queryObj = query;
        this.querySourceId = querySourceId;
        this.ownerId = ownerId;
        if (DataSourceQueryByData.querySourceIdMap.has(querySourceId)) {
            this.queryRef = DataSourceQueryByData.querySourceIdMap.get(querySourceId);
            // Someone has to update it; no harm in doing it more than once
            this.queryRef.update(query);
        } else {
            this.queryRef = new DataSourceQueryRefCount(query);
            DataSourceQueryByData.querySourceIdMap.set(querySourceId, this.queryRef);
        }
        this.queryRef.refCount++;
        this.funcResult.setQuery(this.queryRef.query);
    }

    destroy(): void {
        assert(this.queryRef !== undefined, "do not destroy twice");
        assert(this.input.dataQueryDSMap.has(this.ownerId) &&
               this.input.dataQueryDSMap.get(this.ownerId).has(this.querySourceId),
               "must be registered on data source");
        this.input.removeDataQueryApplication(this);
        this.queryRef.refCount--;
        if (this.queryRef.refCount === 0) {
            this.queryRef.destroy();
            DataSourceQueryByData.querySourceIdMap.delete(this.querySourceId);
        }
        this.queryRef = undefined;
        super.destroy();
    }

    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceQueryByData) {
            return this.funcResult.getId() === ds.funcResult.getId() ||
                   (this.queryString === ds.queryString &&
                    this.input.isEqual(ds.input));
        }
        return false;
    }

    updateQuery(query: any): void {
        if (!objectEqual(this.queryObj, query)) {
            var newQueryString: string = cdlifyNormalized(query);
            this.queryString = newQueryString;
            this.queryObj = query;
            this.queryRef.update(query);
        }
    }

    hasSameSource(querySourceId: number): boolean {
        return this.querySourceId === querySourceId;
    }

    changeQuerySourceId(newId: number): void {
        var oldId: number = this.querySourceId;
        
        if (oldId !== newId) {
            var dsMap: Map<number, DataSourceQueryByData> =
                this.input.dataQueryDSMap.get(this.ownerId);
            assert(this.querySourceId === oldId && dsMap !== undefined &&
                   dsMap.has(oldId) && !dsMap.has(newId), "changeQuerySourceId error");
            dsMap.set(newId, dsMap.get(oldId));
            dsMap.delete(oldId);
            this.querySourceId = newId;
            DataSourceQueryByData.querySourceIdMap.set(newId, this.queryRef);
            DataSourceQueryByData.querySourceIdMap.delete(oldId);
        }
    }

    // The receiver can move this application to the new input iff it is the
    // sole owner, comes from the same source, and the query is not yet
    // registered on the new input. If registered, a move could be possible, but
    // leads to code duplication without any gain.
    canMoveTo(receiver: ReceiveDataSourceResult, newInput: DataSourceComposable): boolean {
        return this.belongsUniquelyTo(receiver) &&
               !newInput.isBasedOn(this) &&
               !("dataQueryDSMap" in newInput &&
                 newInput.dataQueryDSMap.has(this.ownerId) &&
                 newInput.dataQueryDSMap.get(this.ownerId).has(this.querySourceId));
    }

    alreadyRegisteredOn(receiver: ReceiveDataSourceResult, input: DataSourceComposable): boolean {
        return input.dataQueryDSMap.has(this.ownerId) &&
               input.dataQueryDSMap.get(this.ownerId).has(this.querySourceId);
    }

    moveToDataSource(receiver: ReceiveDataSourceResult, input: DataSourceComposable): void {
        var oldInput: DataSourceComposable = this.input;
        var qsIdMap: Map<number, DataSourceQueryByData>;

        if (this.funcResult.dataObj === input.funcResult) {
            return;
        }
        this.input = input;
        if (!("dataQueryDSMap" in input)) {
            input.dataQueryDSMap = new Map<number, Map<number, DataSourceQueryByData>>();
        }
        assert(!input.dataQueryDSMap.has(this.ownerId) ||
               !input.dataQueryDSMap.get(this.ownerId).has(this.querySourceId),
               "debugging");
        if (input.dataQueryDSMap.has(this.ownerId)) {
            qsIdMap = input.dataQueryDSMap.get(this.ownerId);
        } else {
            qsIdMap = new Map<number, DataSourceQueryByData>();
            input.dataQueryDSMap.set(this.ownerId, qsIdMap);
        }
        qsIdMap.set(this.querySourceId, this);
        input.removeEndOfUse();
        this.funcResult.setData(input.funcResult);
        oldInput.removeDataQueryApplication(this);
    }

    debugInfo(): string {
        var watcherIds: number[] = [];

        this.resultReceivers.forEach(function(rr: ReceiveDataSourceResult, watcherId: number): void {
            watcherIds.push(watcherId);
        });
        return this.debugActive() + this.queryString + ": " +
               this.debugMatchList(); // + " watcherId=" + watcherIds.join(",");
    }

    accumulatedQuery(): AccuQuery {
        var from = this.input.accumulatedQuery();
        var acc: AccuQuery = {from: from};

        function accuQuery(q: any, path: string[]): void {

            function addSel(str: string): void {
                if (!("selection" in acc)) {
                    acc.selection = [];
                }
                acc.selection.push(path.join(".") + " " + str);
            }

            function addProj(path: string[]): void {
                if (!("projection" in acc)) {
                    acc.projections = {};
                }
                acc.projections[path[path.length - 1]] = path;
            }

            if (q === _ || (q instanceof Array && q.length === 1 && q[0] === _)) {
                addProj(path);
            } else if (q instanceof RangeValue) {
                addSel("between " + q.min + " and " + q.max);
            } else if (q instanceof NonAV) {
                addSel("= " + q.stringify());
            } else if (q instanceof Array) {
                if (q.length === 0) {
                    addSel("= o()");
                } else if (q.length === 1) {
                    addSel("= " + safeJSONStringify(q[0]));
                } else {
                    addSel("in (" + q.join(",") + ")");
                }
            } else if (q instanceof Object) {
                for (var attr in q) {
                    accuQuery(q[attr], path.concat(attr));
                }
            } else {
                addSel("= " + safeJSONStringify(q));
            }
        }

        accuQuery(this.queryObj, []);
        return acc;
    }

    getDebugResult(): any[] {
        return interpretedQuery(this.queryObj, this.input.getDebugResult());
    }
}

class DataSourceQueryByElementId extends DataSourceQuery {
    elementIDs: number[];
    query: IdQuery;

    constructor(elementIDs: number[], watcherId: number, queryString: string, input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super(queryString, watcherId, input, resultReceiver, false);
        this.elementIDs = elementIDs;
        this.query = new IdQuery(globalInternalQCM);
        this.query.addDataElements(elementIDs);
        this.funcResult.setQuery(this.query);
    }

    destroy(): void {
        assert(this.query !== undefined, "do not destroy twice");
        this.input.removeElementIdQueryApplication(this);
        this.query.destroy();
        this.query = undefined;
        super.destroy();
    }

    updateDataElements(elementIDs: number[]): void {
        var remove: number[] = this.elementIDs.filter((eltID: number): boolean => {
            return elementIDs.indexOf(eltID) === -1;
        });
        var add: number[] = elementIDs.filter((eltID: number): boolean => {
            return this.elementIDs.indexOf(eltID) === -1;
        });

        // Update query (and queryString)
        this.query.removeDataElements(remove);
        this.query.addDataElements(add);
        this.query.refreshQuery();
        this.queryString = "#" + elementIDs.join(",");
        this.elementIDs = elementIDs;
    }

    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceQueryByElementId) {
            return this.funcResult.getId() === ds.funcResult.getId() ||
                   (this.watcherId === ds.watcherId &&
                    this.input.isEqual(ds.input));
        }
        return false;
    }

    debugInfo(): string {
        return this.debugActive() + "element " + this.elementIDs.join(",");
    }

    accumulatedQuery(): AccuQuery {
        var acc = this.input.accumulatedQuery();

        return {
            selection: ["elementID in (" + this.elementIDs.join(",") + ")"],
            from: acc
        };
    }

    getDebugResult(): any[] {
        return []; // get selected data element???
    }
}

class DataSourceFunctionApplication extends DataSource {
    functionName: string;
    funcAppl: FuncResult;
    result: any[] = undefined;

    constructor(functionName: string, input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super(input, resultReceiver);
        this.functionName = functionName;
        this.funcAppl = DataSource.dataSourceFunctions[functionName](globalInternalQCM, input.funcResult, this);
    }

    destroy(): void {
        assert(this.functionName !== undefined, "do not destroy twice");
        assert(this.input.functionDSMap.has(this.functionName), "must be registered on data source");
        this.input.removeFunctionApplication(this);
        this.functionName = undefined;
        this.result = undefined;
        this.funcAppl.destroy();
        this.funcAppl = undefined;
        super.destroy();
    }

    activate(): void {
        this.activatingReceivers++;
        if (this.activatingReceivers === 1) {
            this.funcAppl.activated();
        }
    }

    deactivate(): void {
        this.activatingReceivers--;
        assert(this.activatingReceivers >= 0, "too many deactivates");
        if (this.activatingReceivers === 0) {
            this.funcAppl.deactivated();
        }
    }

    refreshFuncResult(): void {
        this.funcAppl.setData(this.input.funcResult);
    }

    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceFunctionApplication) {
            return this.functionName === ds.functionName &&
                   this.input.isEqual(ds.input);
        }
        return false;
    }

    newResult(v: any[]): void {
        if (!objectEqual(this.result, v)) {
            this.result = v;
            if (this.resultReceivers !== undefined) {
                this.resultReceivers.forEach((rr: ReceiveDataSourceResult): void => {
                    rr.newDataSourceResult(v);
                });
            }
        }
    }

    getResult(): any[] {
        return this.result;
    }

    debugActive(): string {
        return (this.activatingReceivers > 0? "+": "-") + this.id;
    }

    debugInfo(): string {
        return this.debugActive() + " " + this.functionName + ": " + cdlify(this.result);
    }

    accumulatedQuery(): AccuQuery {
        var acc = this.input.accumulatedQuery();

        return {
            function: this.functionName,
            from: acc
        };
    }

    getDebugResult(): any[] {
        var input: any[] = this.input.getDebugResult();

        switch (this.functionName) {
            case "size":
                return [input.length];
            default:
                console.log("not implemented for", this.functionName); // TODO
                return [];
        }
    }
}

// This class only passes along the funcResult of its input. It only serves as
// a branching (multiplexing) point for operations which have more than one
// data source input, and can for now only be used to apply index queries.
// It doesn't own the funcResult and cannot be used to extract data.
class DataSourceComposableMultiplexer extends DataSourceComposable {
    input: DataSourceComposable;
    funcResult: FuncResult;

    constructor(input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super(input, resultReceiver);
        this.funcResult = input.funcResult;
    }

    destroy(): void {
        this.input.dataSourceMultiplexer = undefined;
        this.input.checkEndOfUse();
        this.funcResult = undefined;
        super.destroy();
    }

    stopIndexerMonitoring(): void {
    }

    updateIndexerMonitoringForDominatedPath(): void {
    }

    conditionalDestroy(): void {
        if (this.indexQueryDSMap === undefined || this.indexQueryDSMap.size === 0) {
            super.conditionalDestroy();
        } else {
            this.removeEndOfUse();
        }
    }

    checkEndOfUse(): void {
        if (this.resultReceivers.size === 0 && this.indexQueryDSMap.size === 0) {
            this.putOnRemoveQueue();
        }        
    }

    // No sharing of index objects
    applyIndexQuery(indexQuery: DataSourceComposable, resultReceiver: ReceiveDataSourceResult): DataSourceIndex {
        var dsi = new DataSourceIndex(this, indexQuery, resultReceiver);

        this.indexQueryDSMap.set(dsi.id, dsi);
        return dsi;
    }

    removeIndexQuery(dsi: DataSourceIndex): void {
        assert(this.indexQueryDSMap.has(dsi.id), "unregistered [index]");
        this.indexQueryDSMap.delete(dsi.id);
        this.checkEndOfUse();
    }

    dumpApplicationStructure(activeOnly: boolean = true): any {
        var appls: any = super.dumpApplicationStructure(activeOnly);

        if (this.indexQueryDSMap) {
            this.indexQueryDSMap.forEach((indexQuery: DataSourceIndex, querySourceId: number): void => {
                appls[String(querySourceId) + ": " + indexQuery.debugInfo()] =
                    indexQuery.dumpApplicationStructure(activeOnly);
            });
        }
        return appls;
    }

    accumulatedQuery(): AccuQuery {
        return this.input.accumulatedQuery();
    }

    getDebugResult(): any[] {
        return this.input.getDebugResult();
    }
    
    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceComposableMultiplexer) {
            return this.input.isEqual(ds.input);
        }
        return false;
    }

    refreshFuncResult(): void {
        if (this.indexQueryDSMap) {
            this.indexQueryDSMap.forEach((indexQuery: DataSourceIndex): void => {
                indexQuery.refreshFuncResult();
            });
        }
    }

    // All the functions which should not be called

    applyDataQuery(query: any, resultReceiver: ReceiveDataSourceResult, querySourceId: number, ownerId: number = DataSourceComposable.globalId): DataSourceQueryByData {
        throw "do not call";
    }

    removeDataQueryApplication(qds: DataSourceQueryByData): void {
        throw "do not call";
    }

    getQueryApplicationWithSourceId(sourceId: number, ownerId: number = DataSourceComposable.globalId): DataSourceQueryByData {
        throw "do not call";
    }

    applyElementIdQuery(elementIDs: number[], resultReceiver: ReceiveDataSourceResult, watcherId: number): DataSourceQueryByElementId {
        throw "do not call";
    }

    removeElementIdQueryApplication(qds: DataSourceQueryByElementId): void {
        throw "do not call";
    }

    applyAggregateFunction(functionName: string, resultReceiver: ReceiveDataSourceResult): DataSourceFunctionApplication {
        throw "do not call";
    }

    removeFunctionApplication(fds: DataSourceFunctionApplication): void {
        throw "do not call";
    }

    applyOrdering(q: any, resultReceiver: ReceiveDataSourceResult): DataSourceOrdering {
        throw "do not call";
    }

    removeOrderingApplication(qds: DataSourceOrdering): void {
        throw "do not call";
    }

    applySort(pathComparisons: PathComparisonFunction[], resultReceiver: ReceiveDataSourceResult): DataSourceSort {
        throw "do not call";
    }

    removeSortApplication(qds: DataSourceSort): void {
        throw "do not call";
    }

    applyIdentity(identityAttribute: string, resultReceiver: ReceiveDataSourceResult, querySourceId: number): DataSourceIdentityApplication {
        throw "do not call";
    }

    removeIdentityApplication(ids: DataSourceIdentityApplication): void {
        throw "do not call";
    }

    applyElementIdTransformation(transformationName: string, resultReceiver: ReceiveDataSourceResult): DataSourceElementIdTransformation {
        throw "do not call";
    }

    removeElementIdTransformation(ets: DataSourceElementIdTransformation): void {
        throw "do not call";
    }

    applyMergeUnderIdentityWithPath(path: string, resultReceiver: ReceiveDataSourceResult): DataSourceMergeUnderIdentityWithPath {
        throw "do not call";
    }

    removeMergeUnderIdentityWithPathApplication(muiwp: DataSourceMergeUnderIdentityWithPath): void {
        throw "do not call";
    }

    extractData(req: MinimumResultRequirements, ord: OrderingResultWatcher): any[] {
        throw "do not call";
    }

    extractDataSimple(single: boolean): any[] {
        throw "do not call";
    }

    extractDataComplex(ord: OrderingResultWatcher, updateIndexerMonitors: boolean = true): any[] {
        throw "do not call";
    }

    updateIndexerMonitors(newPathIds: {[pathId: number]: boolean}, indexer: InternalQCMIndexer): void {
        throw "do not call";
    }

    // Requests that the data be extracted again. See IndexerMonitor.updateKeys
    indexerUpdateKeys(elementIds: number[], types: string[],
                      keys: SimpleValue[], prevTypes: string[],
                      prevKeys: SimpleValue[]): void {
        throw "do not call";
    }

    removeAllIndexerMatches(): void {
    }

    signalNewFuncResultToApplications(funcResult: FuncResult): void {
        throw "do not call";
    }
}

class DataSourceIndex extends DataSourceComposable {

    input: DataSourceComposableMultiplexer;
    indexQuery: DataSourceComposable;
    funcResult: IndexOrderResult;

    constructor(input: DataSourceComposableMultiplexer, indexQuery: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super(input, resultReceiver);
        this.indexQuery = indexQuery;
        this.funcResult = new IndexOrderResult(globalInternalQCM);
        this.funcResult.setOrderedData(this.input.funcResult);
        this.funcResult.setToIndexData(this.indexQuery.funcResult);
    }

    destroy(): void {
        this.input.removeIndexQuery(this);
        this.input = undefined;
        this.indexQuery = undefined;
        super.destroy();
    }

    accumulatedQuery(): AccuQuery {
        return {
            index: this.indexQuery.accumulatedQuery(),
            from: this.input.accumulatedQuery()
        };
    }

    getDebugResult(): any[] {
        return undefined;
    }
    
    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceIndex) {
            return this.indexQuery.isEqual(ds.indexQuery) &&
                   this.input.isEqual(ds.input);
        }
        return false;
    }

    debugInfo(): string {
        return "index"; // TODO: add index values
    }

    refreshFuncResult(): void {
        this.funcResult.setData(this.input.funcResult);
    }
}

abstract class AggregateDSFunction extends FuncResult
    implements InternalDataComposition, DataSourceKeyUpdateInterface,
               CompleteIncrementalUpdateTask
{
    parent: DataSourceFunctionApplication;
    value: SimpleValue = undefined;
    indexerMonitor: IndexerTracer;
    needsKeyUpdates: boolean = false;
    scheduledForCompleteIncrementalUpdateTask: boolean = false;
    completeIncrementalUpdateTaskCancelled: boolean = false;
    addedMatches: number[];
    removedMatches: number[];
    elementIDUpdates: number[];
    typeUpdates: string[];
    keyUpdates: SimpleValue[];
    prevTypeUpdates: string[];
    prevKeyUpdates: SimpleValue[];
    pathNodePrevKeys: Map<number, PathNodeValue>;
    /// activeDiffUpdateMode gets set to true when a remove is received after an
    /// add. From that point on, the added and removed matches are no longer
    /// guaranteed to be disjoint, and the lists will need to be kept disjoint
    /// for the completion function.
    activeDiffUpdateMode: boolean;

    constructor(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
        super(qcm);
        this.parent = parent;
        this.setData(data);
        this.setIndexerMonitor();
        this.init();
        if (this.needsKeyUpdates) {
            this.addedMatches = undefined;
            this.removedMatches = undefined;
            this.elementIDUpdates = undefined;
            this.typeUpdates = undefined;
            this.keyUpdates = undefined;
            this.prevTypeUpdates = undefined;
            this.prevKeyUpdates = undefined;
            this.pathNodePrevKeys = undefined;
            this.activeDiffUpdateMode = false;
        }
        this.markAsChanged();
    }

    destroy(): void {
        if (this.indexerMonitor !== undefined) {
            this.indexerMonitor.destroy();
            this.indexerMonitor = undefined;
        }
        super.destroy();
    }

    // Initialize and set value. Initializations in the constructor and
    // member initializations are not seen until the first update.
    abstract init(): void;

    markAsChanged(): void {
        this.parent.newResult(this.value === undefined? constEmptyOS: [this.value]);
    }

    setValue(v: SimpleValue): void {
        if (this.value !== v) {
            this.value = v;
            this.markAsChanged();
        }
    }

    // Called when new elements have been added
    abstract add(elementIDs: number[], keys: Map<number, PathNodeValue>): void;

    // Called when present elements have been removed
    abstract subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void;

    // Called when elements have been changed value
    abstract change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void;

    // Called after updating with needsKeyUpdates === true
    wrapUp(pathNode: PathNode): void {
    }

    reset(): void {
    }

    supportsMultiProj(): boolean {
        return false;
    }

    isActive(): boolean {
        return this.parent.activatingReceivers > 0;
    }

    activated(): void {
        super.activated();
        if (this.scheduledForCompleteIncrementalUpdateTask &&
              this.completeIncrementalUpdateTaskCancelled) {
            this.completeIncrementalUpdateTaskCancelled = false;
            this.scheduledForCompleteIncrementalUpdateTask = false;
            this.completeIncrementalUpdate();
        }
    }

    refreshIndexerAndPaths(dataObj: FuncResult): void {
        this.reset();
        this.setIndexerMonitor();
        if (this.needsKeyUpdates) {
            this.addedMatches = undefined;
            this.removedMatches = undefined;
            this.elementIDUpdates = undefined;
            this.typeUpdates = undefined;
            this.keyUpdates = undefined;
            this.prevTypeUpdates = undefined;
            this.prevKeyUpdates = undefined;
            this.pathNodePrevKeys = undefined;
            this.activeDiffUpdateMode = false;
        }
        this.markAsChanged();
    }

    replaceIndexerAndPaths(prevPrefixPathId: number, prefixPathId: number,
                           dataObj: FuncResult): void {
        // the result remains unchanged (queued changes still need to be
        // processed) only need to re-register the indexer monitor
        this.setIndexerMonitor();
    }
    
    addMatches(elementIDs: number[], source: FuncResult): void {
        if (this.needsKeyUpdates) {
            if (!this.activeDiffUpdateMode) {
                this.addedMatches = this.addedMatches === undefined?
                               elementIDs: this.addedMatches.concat(elementIDs);
            } else if (elementIDs !== undefined) {
                // At this point, the added elements are not necessarily disjoint,
                // but we have the guarantee that addedMatches and removedMatches are
                var addSet: Set<number> = new Set<number>(this.addedMatches);
                var remSet: Set<number> = new Set<number>(this.removedMatches);
                // Remove the elements from addedMatches, or add to
                // removedMatches (but keep unique)
                for (var i = 0; i < elementIDs.length; i++) {
                    var eltID = elementIDs[i];
                    if (remSet.has(eltID)) {
                        remSet.delete(eltID);
                    } else if (!addSet.has(eltID)) {
                        this.addedMatches.push(eltID);
                    }
                }
                if (remSet.size !== this.removedMatches.length) {
                    // Some element has been removed
                    var remArr: number[] = [];
                    remSet.forEach(function(eltID: number): void {
                        remArr.push(eltID);
                    })
                    this.removedMatches = remArr;
                }
            }
            this.qcm.scheduleCompleteIncrementalUpdate(this);
        } else {
            this.add(elementIDs, undefined);
            this.markAsChanged();
        }
    }
    
    removeMatches(elementIDs: number[], source: FuncResult): void {
        if (this.needsKeyUpdates) {
            var indexer: InternalQCMIndexer = this.dataObj.getDominatedIndexer();
            var pathId: number = this.dataObj.getDominatedProjPathId();
            var pathNode: PathNode = indexer.pathNodesById[pathId];
            if (this.addedMatches === undefined) {
                this.removedMatches = this.removedMatches === undefined?
                             elementIDs: this.removedMatches.concat(elementIDs);
            } else {
                // When a remove follows an add, the added elements are not
                // necessarily disjoint, but we have the guarantee that
                // addedMatches and removedMatches are.
                this.activeDiffUpdateMode = true;
                if (this.removedMatches === undefined) {
                    this.removedMatches = [];
                }
                var addSet: Set<number> = new Set<number>(this.addedMatches);
                var remSet: Set<number> = new Set<number>(this.removedMatches);
                // Remove the elements from addedMatches, or add to
                // removedMatches (but keep unique)
                for (var i = 0; i < elementIDs.length; i++) {
                    var eltID = elementIDs[i];
                    if (addSet.has(eltID)) {
                        addSet.delete(eltID);
                    } else if (!remSet.has(eltID)) {
                        this.removedMatches.push(eltID);
                    }
                }
                if (addSet.size !== this.addedMatches.length) {
                    // Some element has been removed
                    var addArr: number[] = [];
                    addSet.forEach(function(eltID: number): void {
                        addArr.push(eltID);
                    })
                    this.addedMatches = addArr;
                }
            }
            if (this.pathNodePrevKeys === undefined) {
                this.pathNodePrevKeys = indexer.getPrevKeyObj(pathNode);
            }
            this.qcm.scheduleCompleteIncrementalUpdate(this);
        } else {
            this.subtract(elementIDs, undefined, undefined);
            this.markAsChanged();
        }
    }

    removeAllMatches(source: FuncResult): void {
        this.reset();
        this.markAsChanged();
    }

    addDataObjMatches(oldDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        this.add(this.dataObj.getDominatedMatches(), undefined);
        this.markAsChanged();
    }

    removeDataObjMatches(newDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        this.reset();
        this.markAsChanged();
    }

    refreshProjMappings(pathMappings: any): void {
    }

    addProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.addMatches(elementIDs, undefined);
    }

    removeProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.removeMatches(elementIDs, undefined);
    }

    setIndexerMonitor(): void {
        if (this.indexerMonitor !== undefined) {
            this.indexerMonitor.destroy();
            this.indexerMonitor = undefined;
        }
        if (this.needsKeyUpdates) {
            var indexer: InternalQCMIndexer = this.dataObj.getDominatedIndexer();
            var pathId: number = this.dataObj.getDominatedProjPathId();
            if (indexer !== undefined && pathId !== undefined) {
                this.indexerMonitor = new IndexerTracer(indexer, pathId, this);
            }
        }
    }

    indexerUpdateKeys(elementIDs: number[], types: string[],
       keys: SimpleValue[], prevTypes: string[], prevKeys: SimpleValue[]): void
    {
        this.elementIDUpdates = this.elementIDUpdates === undefined? elementIDs: this.elementIDUpdates.concat(elementIDs);
        this.typeUpdates = this.typeUpdates === undefined? types: this.typeUpdates.concat(types);
        this.keyUpdates = this.keyUpdates === undefined? keys: this.keyUpdates.concat(keys);
        this.prevTypeUpdates = this.prevTypeUpdates === undefined? prevTypes: this.prevTypeUpdates.concat(prevTypes);
        this.prevKeyUpdates = this.prevKeyUpdates === undefined? prevKeys: this.prevKeyUpdates.concat(prevKeys);
        this.qcm.scheduleCompleteIncrementalUpdate(this);
    }

    removeAllIndexerMatches(): void {
        assert(false, "this function should never be called");
    }

    completeIncrementalUpdate(): void {
        var indexer: InternalQCMIndexer = this.dataObj.getDominatedIndexer();
        var pathId: number = this.dataObj.getDominatedProjPathId();
        var pathNode: PathNode = indexer.pathNodesById[pathId];

        if (this.removedMatches !== undefined) {
            var pathNodePrevKeys: Map<number, PathNodeValue> =
                this.pathNodePrevKeys && this.pathNodePrevKeys.size > 0 ?
                this.pathNodePrevKeys : undefined; 
            this.subtract(this.removedMatches, pathNodePrevKeys, pathNode.nodes);
        }
        if (this.addedMatches !== undefined) {
            this.add(this.addedMatches, pathNode.nodes);
        }
        if (this.keyUpdates !== undefined) {
            var updatePositions: number[] =
                this.dataObj.filterDominatedMatchPositions(
                    this.elementIDUpdates);
            var added: Set<number> = updatePositions.length === 0? undefined:
                this.addedMatches === undefined? new Set<number>():
                this.addedMatches.reduce(function(set: Set<number>, id: number): Set<number> {
                    set.add(id);
                    return set;
                }, new Set<number>());
            for (var i: number = 0; i < updatePositions.length; i++) {
                var updatePosition: number = updatePositions[i];
                var eltID: number = this.elementIDUpdates[updatePosition];
                if (!added.has(eltID)) { // ignore added elements
                    this.change(eltID, this.prevTypeUpdates[updatePosition],
                                this.prevKeyUpdates[updatePosition],
                                this.typeUpdates[updatePosition],
                                this.keyUpdates[updatePosition]);
                }
            }
        }
        if (this.needsKeyUpdates) {
            this.wrapUp(pathNode);
        }
        if (this.keyUpdates !== undefined ||
              this.removedMatches !== undefined ||
              this.addedMatches !== undefined) {
            this.markAsChanged();
        }
        this.addedMatches = undefined;
        this.removedMatches = undefined;
        this.elementIDUpdates = undefined;
        this.typeUpdates = undefined;
        this.keyUpdates = undefined;
        this.prevTypeUpdates = undefined;
        this.prevKeyUpdates = undefined;
        this.pathNodePrevKeys = undefined;
        this.activeDiffUpdateMode = false;
    }
}

class SizeDSFunction extends AggregateDSFunction {
    init(): void {
        this.value = 0;
    }

    reset(): void {
        this.value = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        this.value = <number> this.value + elementIDs.length;
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        this.value = <number> this.value - elementIDs.length;
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
    }
}

function makeSizeDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
    return new SizeDSFunction(qcm, data, parent);
}

class NotDSFunction extends AggregateDSFunction {
    nrTrueElements: number = 0;
    needsKeyUpdates: boolean = true;

    init(): void {
        this.value = true;
        this.nrTrueElements = 0;
    }

    reset(): void {
        this.value = true;
        this.nrTrueElements = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = keys.get(elementIDs[i]);
            if (elt !== undefined && (elt.type !== "boolean" || elt.key !== false)) {
                this.nrTrueElements++;
            }
        }
        this.setValue(this.nrTrueElements === 0);
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = dataSourceGetSubtractionKey(prevKeys, curKeys, elementIDs[i]);
            if (elt.type !== "boolean" || elt.key !== false) {
                this.nrTrueElements--;
            }
        }
        this.setValue(this.nrTrueElements === 0);
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
        if (prevType !== "boolean" || prevKey !== false) {
            this.nrTrueElements--;
        }
        if (type !== "boolean" || key !== false) {
            this.nrTrueElements++;
        }
        this.setValue(this.nrTrueElements === 0);
    }
}

function makeNotDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
    return new NotDSFunction(qcm, data, parent);
}

class NotEmptyDSFunction extends AggregateDSFunction {
    nrElements: number;

    init(): void {
        this.value = false;
        this.nrElements = 0;
    }

    reset(): void {
        this.value = false;
        this.nrElements = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        this.nrElements += elementIDs.length;
        this.value = this.nrElements !== 0;
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        this.nrElements -= elementIDs.length;
        this.value = this.nrElements !== 0;
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
    }
}

function makeNotEmptyDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
    return new NotEmptyDSFunction(qcm, data, parent);
}

class SumDSFunction extends AggregateDSFunction {
    value: number;
    nrValues: number;
    needsKeyUpdates: boolean = true;

    init(): void {
        this.value = 0;
        this.nrValues = 0;
    }

    reset(): void {
        this.value = 0;
        this.nrValues = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = keys.get(elementIDs[i]);
            if (elt !== undefined && elt.type === "number") {
                this.value += elt.key;
                this.nrValues++;
            }
        }
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = dataSourceGetSubtractionKey(prevKeys, curKeys, elementIDs[i]);
            if (elt !== undefined && elt.type === "number") {
                this.nrValues--;
                if (this.nrValues === 0) {
                    this.value = 0;
                } else {
                    this.value -= elt.key;
                }
            }
        }
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
        if (prevType === "number") {
            this.value -= <number> prevKey;
        }
        if (type === "number") {
            this.value += <number> key;
        }
    }
}

function makeSumDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
    return new SumDSFunction(qcm, data, parent);
}

class MinDSFunction extends AggregateDSFunction {
    nrMinElements: number = 0;
    needsKeyUpdates: boolean = true;

    init(): void {
        this.value = undefined;
        this.nrMinElements = 0;
    }

    reset(): void {
        this.value = undefined;
        this.nrMinElements = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = keys.get(elementIDs[i]);
            if (elt !== undefined) {
                if (this.value === undefined || elt.key < this.value) {
                    this.value = elt.key;
                    this.nrMinElements = 1;
                } else if (elt.key === this.value) {
                    this.nrMinElements++;
                }
            }
        }
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = dataSourceGetSubtractionKey(prevKeys, curKeys, elementIDs[i]);
            if (elt.key === this.value) {
                this.nrMinElements--;
            }
        }
        if (this.nrMinElements === 0) {
            // When removing the known minimum, reset and let wrapUp check
            // remaining elements again.
            this.reset();
        }
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
        if (prevKey === this.value) {
            this.nrMinElements--;
        }
        if (this.value === undefined || key < this.value) {
            this.value = key;
            this.nrMinElements = 1;
        } else if (key === this.value) {
            this.nrMinElements++;
        }
    }

    wrapUp(pathNode: PathNode): void {
        if (this.nrMinElements === 0) {
            this.reset();
        }
        if (this.value === undefined) {
            this.add(this.dataObj.getDominatedMatches(), pathNode.nodes);
        }
    }
}

function makeMinDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
    return new MinDSFunction(qcm, data, parent);
}

class MaxDSFunction extends AggregateDSFunction {
    nrMaxElements: number = 0;
    needsKeyUpdates: boolean = true;

    init(): void {
        this.value = undefined;
        this.nrMaxElements = 0;
    }

    reset(): void {
        this.value = undefined;
        this.nrMaxElements = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = keys.get(elementIDs[i]);
            if (elt !== undefined) {
                if (this.value === undefined || elt.key > this.value) {
                    this.value = elt.key;
                    this.nrMaxElements = 1;
                } else if (elt.key === this.value) {
                    this.nrMaxElements++;
                }
            }
        }
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = dataSourceGetSubtractionKey(prevKeys, curKeys, elementIDs[i]);
            if (elt.key === this.value) {
                this.nrMaxElements--;
            }
        }
        if (this.nrMaxElements === 0) {
            // When removing the known maximum, reset and let wrapUp check
            // remaining elements again.
            this.reset();
        }
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
        if (prevKey === this.value) {
            this.nrMaxElements--;
        }
        if (this.value === undefined || key > this.value) {
            this.value = key;
            this.nrMaxElements = 1;
        } else if (key === this.value) {
            this.nrMaxElements++;
        }
    }

    wrapUp(pathNode: PathNode): void {
        if (this.nrMaxElements === 0) {
            this.reset();
        }
        if (this.value === undefined) {
            this.add(this.dataObj.getDominatedMatches(), pathNode.nodes);
        }
    }
}

function makeMaxDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
    return new MaxDSFunction(qcm, data, parent);
}

/// Determines whether the data matches true or false, and sets that as its
/// result.
class BoolDSFunction extends AggregateDSFunction {
    value: boolean;
    nrTrueElements: number = 0;
    needsKeyUpdates: boolean = true;
    
    init(): void {
        this.value = false;
        this.nrTrueElements = 0;
    }

    reset(): void {
        this.value = false;
        this.nrTrueElements = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = keys.get(elementIDs[i]);
            if (elt !== undefined && (elt.type !== "boolean" || elt.key !== false)) {
                this.nrTrueElements++;
            }
        }
        this.setValue(this.nrTrueElements !== 0);
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = dataSourceGetSubtractionKey(prevKeys, curKeys, elementIDs[i]);
            if (elt !== undefined && (elt.type !== "boolean" || elt.key !== false)) {
                this.nrTrueElements--;
            }
        }
        this.setValue(this.nrTrueElements !== 0);
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
        if (prevType !== "boolean" || prevKey !== false) {
            this.nrTrueElements--;
        }
        if (type !== "boolean" || key !== false) {
            this.nrTrueElements++;
        }
        this.setValue(this.nrTrueElements !== 0);
    }
}

function makeBoolDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication): BoolDSFunction {
    return new BoolDSFunction(qcm, data, parent);
}

class SingleValueDSFunction extends AggregateDSFunction {
    value: any = undefined;
    needsKeyUpdates: boolean = true;
    dataElementId: number = undefined;
    
    init(): void {
    }

    reset(): void {
        this.value = undefined;
        this.dataElementId = undefined;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        var elt: PathNodeValue;

        if (this.dataElementId === undefined) {
            for (var i: number = 0; i < elementIDs.length; i++) {
                elt = keys.get(elementIDs[i]);
                if (elt !== undefined) {
                    this.dataElementId = elementIDs[i];
                    break;
                }
            }
            if (this.dataElementId !== undefined) {
                this.setValue(elt.key);
            }
        }
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        if (elementIDs.indexOf(this.dataElementId) >= 0) {
            // Element has been removed
            this.reset();
        }
    }

    wrapUp(pathNode: PathNode): void {
        if (this.dataElementId === undefined) {
            this.add(this.dataObj.getDominatedMatches(), pathNode.nodes);
        }
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
        if (eltID === this.dataElementId) {
            this.setValue(key);
        }
    }
}

function makeSingleValueDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication): SingleValueDSFunction {
    return new SingleValueDSFunction(qcm, data, parent);
}

// Checks if a specific value is in the matches. Should be improved by deferring
// to the query mechanism, but is now in place to give the qualifier matcher
// an easier time.
class SimpleValueMatchDSFunction extends AggregateDSFunction {
    simpleMatchValue: SimpleValue;
    nrMatchingElements: number = 0;
    needsKeyUpdates: boolean = true;

    constructor(simpleMatchValue: any, qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
        super(qcm, data, parent);
        this.simpleMatchValue = simpleMatchValue;
    }

    init(): void {
        this.value = false;
        this.nrMatchingElements = 0;
    }

    reset(): void {
        this.value = false;
        this.nrMatchingElements = 0;
    }

    add(elementIDs: number[], keys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = keys.get(elementIDs[i]);
            if (elt !== undefined && elt.key === this.simpleMatchValue) {
                this.nrMatchingElements++;
            }
        }
        this.setValue(this.nrMatchingElements !== 0);
    }

    subtract(elementIDs: number[], prevKeys: Map<number, PathNodeValue>, curKeys: Map<number, PathNodeValue>): void {
        for (var i: number = 0; i < elementIDs.length; i++) {
            var elt: PathNodeValue = dataSourceGetSubtractionKey(prevKeys, curKeys, elementIDs[i]);
            if (elt.key === this.simpleMatchValue) {
                this.nrMatchingElements--;
            }
        }
        this.setValue(this.nrMatchingElements !== 0);
    }

    change(eltID: number, prevType: string, prevKey: SimpleValue, type: string, key: SimpleValue): void {
        if (prevKey === this.simpleMatchValue) {
            this.nrMatchingElements--;
        }
        if (key === this.simpleMatchValue) {
            this.nrMatchingElements++;
        }
        this.setValue(this.nrMatchingElements !== 0);
    }
}

/// Sends a signal to the receiver when the result has changed. The new value is
/// a count of the number of updates, although it counts per change instead of
/// per update cycle.
class ChangeCountDSFunction extends FuncResult implements InternalDataComposition {
    parent: DataSourceFunctionApplication;
    value: number = 0;

    constructor(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
        super(qcm);
        this.parent = parent;
        this.setData(data);
        this.markAsChanged();
    }

    markAsChanged(): void {
        this.value++;
        this.parent.newResult([this.value]);
    }

    supportsMultiProj(): boolean {
        return false;
    }

    isActive(): boolean {
        return this.parent.activatingReceivers > 0;
    }

    refreshIndexerAndPaths(dataObj: FuncResult): void {
        this.markAsChanged();
    }

    replaceIndexerAndPaths(prevPrefixPathId: number, prefixPathId: number,
                           dataObj: FuncResult): void {
        return; // result remains unchanged
    }

    addMatches(elementIDs: number[], source: FuncResult): void {
        this.markAsChanged();
    }
    
    removeMatches(elementIDs: number[], source: FuncResult): void {
        this.markAsChanged();
    }

    removeAllMatches(source: FuncResult): void {
        this.markAsChanged();
    }

    addDataObjMatches(oldDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        this.markAsChanged();
    }

    removeDataObjMatches(newDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        this.markAsChanged();
    }

    refreshProjMappings(pathMappings: any): void {
    }

    addProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.markAsChanged();
    }

    removeProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.markAsChanged();
    }
}

function makeChangeCountDSFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
    return new ChangeCountDSFunction(qcm, data, parent);
}

/// Sends a signal to the receiver when the result has changed. The new value is
/// a count of the number of updates, although it counts per change instead of
/// per update cycle.
class ChangeInformerFunction extends FuncResult implements InternalDataComposition {
    parent: DataSourceFunctionApplication;

    constructor(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication) {
        super(qcm);
        this.parent = parent;
        this.setData(data);
    }

    supportsMultiProj(): boolean {
        return false;
    }

    isActive(): boolean {
        return this.parent.activatingReceivers > 0;
    }

    refreshIndexerAndPaths(dataObj: FuncResult): void {
        this.parent.newResult([{operation: "refresh"}]);
    }

    replaceIndexerAndPaths(prevPrefixPathId: number, prefixPathId: number,
                           dataObj: FuncResult): void {
        return; // result remains unchanged
    }

    addMatches(elementIDs: number[], source: FuncResult): void {
        this.parent.newResult([{operation: "add", elementIDs: elementIDs}]);
    }
    
    removeMatches(elementIDs: number[], source: FuncResult): void {
        this.parent.newResult([{operation: "remove", elementIDs: elementIDs}]);
    }

    removeAllMatches(source: FuncResult): void {
        this.parent.newResult([{operation: "removeAll"}]);
    }

    addDataObjMatches(oldDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        this.parent.newResult([{operation: "add", elementIDs: this.dataObj.getDominatedMatches()}]);
    }

    removeDataObjMatches(newDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        this.parent.newResult([{operation: "removeAll"}]);
    }

    refreshProjMappings(pathMappings: any): void {
        this.parent.newResult([{operation: "refresh"}]);
    }

    addProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.parent.newResult([{operation: "remove", elementIDs: elementIDs}]);
    }

    removeProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.parent.newResult([{operation: "remove", elementIDs: elementIDs}]);
    }
}

function makeChangeInformerFunction(qcm: QCM, data: FuncResult, parent: DataSourceFunctionApplication): ChangeInformerFunction {
    return new ChangeInformerFunction(qcm, data, parent);
}

// TODO: activate/deactivate. Beware of refreshIndexerAndPaths() and  that is called
// when activating the OrderingAdministration.
class DataSourceOrdering extends DataSourceComposable {
    ordering: any = undefined;
    orderingString: string = ""; // debugging only
    watcherId: number;
    funcResult: RangeOrderResult;
    changeCount: number = 0;

    constructor(ordering: any, watcherId: number, input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super(input, resultReceiver);
        this.watcherId = watcherId;
        this.funcResult = new RangeOrderResult(globalInternalQCM);
        this.updateOrdering(ordering);
        this.refreshFuncResult();
    }

    destroy(): void {
        assert(this.input !== undefined, "do not destroy twice");
        this.ordering = undefined;
        this.orderingString = undefined;
        super.destroy();
    }

    refreshFuncResult(): void {
        this.funcResult.setData(this.input.funcResult);
    }

    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceOrdering) {
            return this.funcResult.getId() === ds.funcResult.getId() ||
                   (this.orderingString === ds.orderingString &&
                    this.input.isEqual(ds.input));
        }
        return false;
    }

    updateOrdering(ordering: any): void {
        var newOrderingString: string = cdlifyNormalized(ordering);

        if (this.orderingString !== newOrderingString) {
            var offsets: number[];
            var lowOpen: boolean = false;
            var highOpen: boolean = false;
            if (ordering instanceof Array) {
                if (ordering.length > 1) {
                    Utilities.warn("No support for os of ranges in [pos]");
                }
                ordering = ordering[0];
            }
            if (ordering instanceof RangeValue) {
                offsets = [ordering.min, ordering.max];
                lowOpen = !ordering.closedLower;
                highOpen = !ordering.closedUpper;
            } else if (typeof(ordering) === "number") {
                offsets = [ordering, ordering];
            } else {
                // Return o()
                offsets = [0, 0];
                lowOpen = true;
                highOpen = true;
            }
            this.funcResult.updateOffsets(offsets, lowOpen, highOpen, false); // < probably should be set to true!
            this.ordering = ordering;
            this.orderingString = newOrderingString;
        }
    }

    debugInfo(): string {
        return this.debugActive() + "pos " + this.orderingString + ": " + this.debugMatchList();
    }

    accumulatedQuery(): AccuQuery {
        var acc = this.input.accumulatedQuery();

        return {
            position: this.orderingString,
            from: acc
        };
    }

    getDebugResult(): any[] {
        return this.input.getDebugResult(); // TODO: sorting
    }
}

type ComparisonQueries = {
    comparison: PartitionComparison;
    queries: Query[];
    queryDescs: DataResult[];
    indexers: FEGReplaceableValueIndexer[];
};

class DataSourceSort extends DataSourceComposable {

    pathComparisons: PathComparisonFunction[];
    sortString: string;
    watcherId: number;
    comparisonResults: CompResult[] = []; // From lowest to highest priority
    comparisonQueries: ComparisonQueries[] = []; // same order
    funcResult: FuncResult; // the highest priority comparison, or the input

    constructor(pathComparisons: PathComparisonFunction[], watcherId: number, input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super(input, resultReceiver);
        this.pathComparisons = pathComparisons;
        this.sortString = this.makeSortString();
        this.watcherId = watcherId;
        this.updateSortKeys(pathComparisons);
    }

    destroy(): void {
        assert(this.input !== undefined, "do not destroy twice");
        this.destroyComparisonResults(0);
        this.destroyComparisonQueries(0);
        if (this.funcResult === this.input.funcResult) {
            // Don't destroy funcResult when there are no sort keys: it belongs
            // to the input.
            this.funcResult = undefined;
        }
        this.input.removeSortApplication(this);
        super.destroy();
    }

    // TODO: share queries. Could or could not be relevant, since most will be
    // simple value selections, e.g. true or r(-Infinity, +Infinity).
    updateComparisonQueries(cq: ComparisonQueries, partitionProjPathId: number, cf: ComparisonFunctionElement): ComparisonQueries {
        var queryIndexer: FEGReplaceableValueIndexer;
        var queryDesc: DataResult;
        var query: Query;

        if (cq === undefined) {
            cq = {
                comparison: new PartitionComparison(globalInternalQCM),
                queries: [],
                queryDescs: [],
                indexers: []
            };
        }
        for (var i: number = 0; i < cf.queries.length; i++) {
            if (i < cq.queries.length) {
                cq.indexers[i].replaceRawObject(cf.queries[i]);
            } else {
                queryIndexer = new FEGReplaceableValueIndexer(globalInternalQCM);
                queryIndexer.replaceRawObject(cf.queries[i]);
                cq.indexers.push(queryIndexer);
                queryDesc = new DataResult(globalInternalQCM, queryIndexer,
                                           globalInternalQCM.getRootPathId());
                cq.queryDescs.push(queryDesc);
                query = new Query(globalInternalQCM);
                query.setData(queryDesc);
                cq.queries.push(query);
            }
        }
        for (; i < cq.queries.length; i++) {
            cq.queries[i].destroy();
            cq.queryDescs[i].destroy();
            cq.indexers[i].destroy();
        }
        cq.queries.length = cf.queries.length;
        cq.queryDescs.length = cf.queries.length;
        cq.indexers.length = cf.queries.length;
        cq.comparison.setPartition(partitionProjPathId, cq.queries,
                               cf.unmatched === -1? undefined: cf.unmatched,
                               cf.inAscendingOrder,
                               cf.orderByValue? cf.inAscendingOrder: undefined);
        return cq;
    }

    destroyComparisonResults(k: number): void {
        for (var i: number = this.comparisonResults.length - 1; i >= k; i--) {
            this.comparisonResults[i].destroy();
        }
        this.comparisonResults.length = k;
    }

    destroyComparisonQueries(k: number): void {
        for (var i: number = this.comparisonQueries.length - 1; i >= k; i--) {
            var cq = this.comparisonQueries[i];
            for (var j: number = 0; j < cq.queries.length; j++) {
                cq.queries[j].destroy();
            }
            for (var j: number = 0; j < cq.queryDescs.length; j++) {
                cq.queryDescs[j].destroy();
            }
            for (var j: number = 0; j < cq.indexers.length; j++) {
                cq.indexers[j].destroy();
            }
        }
        this.comparisonQueries.length = k;
    }

    updateSortKeys(pathComparisons: PathComparisonFunction[]): void {
        var prevFuncResult: FuncResult = this.input.funcResult;
        var rId: number = globalInternalQCM.getRootPathId();
        var k: number = 0;

        // Count backwards so the last one is the highest priority comparison
        for (var i: number = pathComparisons.length - 1; i >= 0; i--) {
            // Update the comparison for this path
            var pcf: PathComparisonFunction = pathComparisons[i];
            var partitionProjPathId: number =
                globalInternalQCM.allocatePathIdFromPath(rId, pcf.path);
            for (var j: number = pcf.comparisons.length - 1; j >= 0; j--) {
                // check whether there is an existing comparison object
                // for the same path. Use that for this comparison and place
                // it an the relevanr result node in the result chain
                // (the first k are already in use)
                for(var compPos: number = k ;
                    compPos < this.comparisonQueries.length ; compPos++) {
                    if(this.comparisonQueries[compPos].comparison.projPathId ==
                       partitionProjPathId) {
                        if(compPos == k)
                            break; // position in chain did not change
                        // exchange this comparison object with the k'th
                        // object
                        var tmp = this.comparisonQueries[k];
                        this.comparisonQueries[k] =
                            this.comparisonQueries[compPos];
                        this.comparisonQueries[compPos] = tmp;
                        this.comparisonResults[k].setComparison(
                            this.comparisonQueries[k].comparison);
                    }
                }
                // Create Comparison, Query and associated objects.
                // Store all for later update or disposal.
                this.comparisonQueries[k] = this.updateComparisonQueries(
                    this.comparisonQueries[k], partitionProjPathId,
                    pcf.comparisons[j]);
                // Hook comparison to a FuncResult and chain it to the previous
                if (k < this.comparisonResults.length) {
                    this.comparisonResults[k].setComparison(
                        this.comparisonQueries[k].comparison);
                } else {
                    var compResult: CompResult =
                        new CompResult(globalInternalQCM);
                    compResult.setComparison(
                        this.comparisonQueries[k].comparison);
                    compResult.setData(prevFuncResult);
                    this.comparisonResults[k] = compResult;
                }
                prevFuncResult = this.comparisonResults[k];
                k++;
            }
        }

        this.pathComparisons = pathComparisons;
        this.sortString = this.makeSortString();

        // Output is the highest priority comparison result, which can be
        // different. Since the DataSource object doesn't change, we have to
        // inform all registered applications here.
        if (this.funcResult !== prevFuncResult) {
            this.funcResult = prevFuncResult;
            this.signalNewFuncResultToApplications(this.funcResult);
        }

        if (this.comparisonQueries.length > k) {
            this.destroyComparisonResults(k);
            this.destroyComparisonQueries(k);
        }
    }

    refreshFuncResult(): void {
        if (this.comparisonResults.length > 0) {
            this.comparisonResults[0].setData(this.input.funcResult);
        } else if (this.funcResult !== this.input.funcResult) {
            this.funcResult = this.input.funcResult;
            this.signalNewFuncResultToApplications(this.funcResult);
        }
    }

    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceSort) {
            return this.funcResult.getId() === ds.funcResult.getId() ||
                   (this.sortString === ds.sortString &&
                    this.input.isEqual(ds.input));
        }
        return false;
    }

    debugInfo(): string {
        return this.debugActive() + "sort " + this.sortString;
    }

    accumulatedQuery(): AccuQuery {
        var acc = this.input.accumulatedQuery();

        return {
            sort: this.sortString,
            from: acc,
        };
    }

    makeSortString(): string {
        var pcfs: string[] = this.pathComparisons.map(function(pcf: PathComparisonFunction): string {
            var cfs: string[] = pcf.comparisons.map(function(cf: ComparisonFunctionElement): string {
                var dir: string = cf.inAscendingOrder? "ascending": "descending";
                if (cf.orderByValue) {
                    return "c(" + cdlify(cf.queries[0]) + ", " + dir + ")";
                } else {
                    var cs: string[] = cf.queries.map(flatcdlify);
                    if (cf.unmatched > -1) {
                        cs.splice(cf.unmatched, 0, "unmatched");
                    }
                    return "c(" + cs.join(",") + ")";
                }
            });
            var path: string = cfs.length === 1? cfs[0]: "o(" + cfs.join(",") + ")";
            for (var i: number = pcf.path.length - 1; i >= 0; i--) {
                path = "{" + pcf.path[i] + ": " + path + "}";
            }
            return path;
        });

        return pcfs.length === 1? pcfs[0]: "o(" + pcfs.join(", ") + ")";
    }

    getDebugResult(): any[] {
        return this.input.getDebugResult(); // TODO: sorting
    }
}

class DataSourceIdentityApplication
extends DataSourceComposable
implements ReceiveDataSourceResult
{
    watcherId: number;
    identityAttribute: string;
    funcResult: IdentityResult;
    idQuery: any;
    idQueryDS: DataSourceQueryByData;

    constructor(identityAttribute: string, input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult, querySourceId: number) {
        super(input, resultReceiver);
        this.watcherId = getNextWatcherId();
        this.identityAttribute = identityAttribute;
        this.funcResult = new IdentityResult(globalInternalQCM, input.funcResult);
        if (identityAttribute === "") {
            // This is [identify, _, o(...)]
            this.funcResult.setIdentificationData(input.funcResult);
        } else {
            // This is [identify, {attr: _}, o(...)]
            this.idQuery = {};
            this.idQuery[identityAttribute] = _;
            this.idQueryDS = input.applyDataQuery(this.idQuery, this, querySourceId);
            this.funcResult.setIdentificationData(this.idQueryDS.funcResult);
        }
    }

    destroy(): void {
        assert(this.identityAttribute !== undefined, "do not destroy twice");
        assert(this.input.identityDSMap.has(this.identityAttribute), "must be registered on data source");
        if (this.idQueryDS !== undefined) {
            this.idQueryDS.removeResultReceiver(this);
            this.idQueryDS = undefined;
        }
        this.input.removeIdentityApplication(this);
        this.identityAttribute = undefined;
        super.destroy();
    }

    refreshFuncResult(): void {
        this.funcResult.setData(this.input.funcResult);
    }

    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceIdentityApplication) {
            return this.identityAttribute === ds.identityAttribute &&
                   this.input.isEqual(ds.input);
        }
        return false;
    }

    debugInfo(): string {
        return this.debugActive() + "identify:" + this.identityAttribute;
    }

    accumulatedQuery(): AccuQuery {
        var acc = this.input.accumulatedQuery();

        return {
            identity: this.identityAttribute,
            from: acc
        };
    }

    getDebugResult(): any[] {
        return this.input.getDebugResult(); // Ignore identities
    }

    // Implementation of ReceiveDataSourceResult which allows this object to
    // be the owner of idQueryDS, but we are not interested in the updates.

    newDataSourceResult(v: any[]): void {
    }

    reextractData(dataSource: DataSourceComposable): void {
    }
}

abstract class DataSourceElementIdTransformation extends DataSourceComposable {
    transformationName: string;
    funcResult: FuncResult;

    constructor(transformationName: string, input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super(input, resultReceiver);
        this.transformationName = transformationName;
    }

    destroy(): void {
        assert(this.transformationName !== undefined, "do not destroy twice");
        assert(this.input.elementIdTransformationMapDSMap.has(this.transformationName), "must be registered on data source");
        this.input.removeElementIdTransformation(this);
        this.transformationName = undefined;
        super.destroy();
    }

    refreshFuncResult(): void {
        this.funcResult.setData(this.input.funcResult);
    }

    isEqual(ds: DataSource): boolean {
        if (this === ds) {
            return true;
        }
        if (ds instanceof DataSourceElementIdTransformation) {
            return this.transformationName === ds.transformationName &&
                   this.input.isEqual(ds.input);
        }
        return false;
    }

    debugInfo(): string {
        return this.debugActive() + this.transformationName;
    }

    accumulatedQuery(): AccuQuery {
        var acc = this.input.accumulatedQuery();

        return {
            transform: this.transformationName,
            from: acc
        };
    }
}

class DataSourceUniqueById
extends DataSourceElementIdTransformation
implements ReceiveDataSourceResult {
    watcherId: number;
    mergeIndexer: MergeIndexer;
    resultToMerge: ResultToMerge;
    funcResult: DataResult;
    sourceIdentificationId: number;
    identify: DataSourceIdentityApplication;

    constructor(input: DataSourceComposable, resultReceiver: ReceiveDataSourceResult) {
        super("uniqueById", input, resultReceiver);
        this.watcherId = getNextWatcherId();
        this.mergeIndexer = new MergeIndexer(globalInternalQCM);
        this.sourceIdentificationId =
            input.funcResult.getDominatedIdentification();
        if (this.sourceIdentificationId === undefined) {
            // Insert [identify, _, input] 
            this.identify = input.applyIdentity("", this, undefined);
            this.sourceIdentificationId =
                this.identify.funcResult.getDominatedIdentification();
        } else {
            this.identify = undefined;
        }
        this.resultToMerge = new ResultToMerge(
            globalInternalQCM, this.mergeIndexer,
            globalInternalQCM.getRootPathId(), 0,
            this.sourceIdentificationId, undefined,
            true, true);
        this.funcResult = new DataResult(globalInternalQCM, this.mergeIndexer, 
                                         globalInternalQCM.getRootPathId());
        this.resultToMerge.setData(this.identify === undefined?
                                   input.funcResult: this.identify.funcResult);
    }

    destroy(): void {
        this.resultToMerge.destroy();
        this.resultToMerge = undefined;
        this.mergeIndexer.destroy();
        this.mergeIndexer = undefined;
        if (this.identify !== undefined) {
            this.identify.removeResultReceiver(this);
            this.identify = undefined;
        }
        super.destroy();
    }

    getDebugResult(): any[] {
        return this.input.getDebugResult(); // TODO: make unique
    }

    // Implementation of ReceiveDataSourceResult which allows this object to
    // own the identity function, but we are not interested in the updates.

    newDataSourceResult(v: any[]): void {
    }

    reextractData(dataSource: DataSourceComposable): void {
    }
}

/**
 * An indexer that represents [map, [defun, "elt", {"#path": "elt"}], input],
 * i.e. where all input elements are mapped to a deeper path. This particular
 * interface allows the owner to add other paths and update the values in it,
 * i.c. pointerInArea, dragInArea, areaSetAttr, and input:{value, focus,
 * selectionStart, selectionEnd, selectionDirection}.
 * 
 * @class DataSourceMergeUnderIdentityWithPath
 * @extends {DataSourceComposable}
 */
class DataSourceMergeUnderIdentityWithPath extends DataSourceComposable {
    combinedIndexer: MergeIndexer;
    resultToMerge: ResultToMerge;
    funcResult: DataResult;
    watcherId: number;
    pathString: string;
    pathNode: PathNode;

    constructor(input: DataSourceComposable, path: string, resultReceiver: ReceiveDataSourceResult) {
        super(input, resultReceiver);
        var targetPathId: number = globalInternalQCM.allocatePathId(undefined, path);

        this.pathString = path;
        this.watcherId = resultReceiver.watcherId;
        this.combinedIndexer = new MergeIndexer(globalInternalQCM);
        this.pathNode = this.combinedIndexer.addPath(targetPathId);
        this.resultToMerge = new ResultToMerge(globalInternalQCM,
              this.combinedIndexer, targetPathId, 0, 0, undefined, true, false);
        this.funcResult = new DataResult(globalInternalQCM,
                       this.combinedIndexer, globalInternalQCM.getRootPathId());
        this.resultToMerge.setData(input.funcResult);
    }

    activate(): void {
        assert(this.activatingReceivers === 0, "must be activated only once");
        this.combinedIndexer.incPathNodeTracing(this.pathNode);
        this.activatingReceivers = 1;
    }

    deactivate(): void {
        assert(this.activatingReceivers === 1, "must be deactivated only once");
        this.combinedIndexer.decPathNodeTracing(this.pathNode);
        this.activatingReceivers = 0;
    }

    destroy(): void {
        assert(this.activatingReceivers === 0, "still active");
        this.resultToMerge.destroy();
        this.resultToMerge = undefined;
        this.combinedIndexer.destroy();
        this.combinedIndexer = undefined;
        super.destroy();
    }

    debugInfo(): string {
        return this.debugActive() + "mergeUnderIdentityWithPath";
    }

    refreshFuncResult(): void {
        this.funcResult.setData(this.input.funcResult);
    }

    accumulatedQuery(): AccuQuery {
        return {from: this.input.accumulatedQuery(), identity: this.pathString};
    }

    isEqual(ds: DataSource): boolean {
        if (ds instanceof DataSourceMergeUnderIdentityWithPath) {
            return this.pathString === ds.pathString && this.input.isEqual(ds.input);
        }
        return false;
    }

    getDebugResult(): any[] {
        var input: any = this.input.getDebugResult();
        var result: any = {};

        result[this.pathString] = input;
        return [result];
    }
}

interface FuncResultWatcherInterface {
    refreshIndexerAndPaths(tag: any, dataObj: FuncResult): void;
    replaceIndexerAndPaths(tag: any, prevPrefixPathId: number,
                           prefixPathId: number, dataObj: FuncResult): void;
    removeAllElementIds(tag: any): void;
    addElementIds(elementIDs: number[], tag: any): void;
    removeElementIds(elementIDs: number[], tag: any): void;
}

class FuncResultWatcher extends FuncResult implements InternalDataComposition {

    controller: FuncResultWatcherInterface;
    tag: any;
    active: boolean = false;

    constructor(qcm: QCM, controller: FuncResultWatcherInterface, tag: any) {
        super(qcm);
        this.controller = controller;
        this.tag = tag;
    }

    supportsMultiProj(): boolean {
        return false;
    }

    isActive(): boolean {
        return this.active;
    }

    activate(): void {
        if (!this.active) {
            this.activated();
            this.active = true;
        }
    }

    deactivate(): void {
        if (this.active) {
            this.deactivated();
            this.active = false;
        }
    }

    refreshIndexerAndPaths(dataObj: FuncResult): void {
        this.controller.refreshIndexerAndPaths(this.tag, dataObj);
    }

    replaceIndexerAndPaths(prevPrefixPathId: number, prefixPathId: number,
                           dataObj: FuncResult): void {
        this.controller.replaceIndexerAndPaths(this.tag, prevPrefixPathId,
                                               prefixPathId, dataObj);
    }

    refreshProjMappings(pathMappings: any): void {
        Utilities.error("not expected to be called");
    }

    addDataObjMatches(oldDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        if (didIndexerOrPathChange) {
            this.addMatches(this.dataObj.getDominatedMatches(), this.dataObj);
        } else {
            var added: number[] = [];
            var removed: number[] = [];
            this.dataObj.getDifference(oldDataObj, added, removed);
            if (added.length !== 0) {
                this.addMatches(added, this.dataObj);
            }
            if (removed.length !== 0) {
                this.removeMatches(removed, this.dataObj);
            }
        }
    }

    removeDataObjMatches(newDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
        if (didIndexerOrPathChange) {
            this.controller.removeAllElementIds(this.tag);
        }
    }

    addMatches(elementIDs: number[], source: FuncResult): void {
        this.controller.addElementIds(elementIDs, this.tag);
    }

    removeMatches(elementIDs: number[], source: FuncResult): void {
        this.controller.removeElementIds(elementIDs, this.tag);
    }

    removeAllMatches(source: FuncResult): void {
        this.controller.removeAllElementIds(this.tag);
    }

    addProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.controller.addElementIds(elementIDs, this.tag);
    }

    removeProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
        this.controller.removeElementIds(elementIDs, this.tag);
    }
}

interface OrderingResultWatcherInterface {
    refreshIndexerAndPaths(tag: any, dataObj: FuncResult): void;
    replaceIndexerAndPaths(tag: any, prevPrefixPathId: number,
                           prefixPathId: number, dataObj: FuncResult): void;
    updateDataElementPosition(elementIds: number[], firstOffset: number,
                              lastOffset: number, setSize: number): void;
}

var testReuseOrderResult: boolean = false;

// Also manages a RangeOrderResult over r(0, -1) on the given data
class OrderingResultWatcher extends FuncResult
    implements InternalDataComposition, OrderTracingInterface
{

    controller: OrderingResultWatcherInterface;
    orderResult: RangeOrderResult = undefined;
    rangeOrderResultOwned: boolean = false;
    tag: any;
    active: boolean = false;
    dataElementIdsInOrder: number[] = [];

    constructor(qcm: QCM, controller: OrderingResultWatcherInterface, tag: any) {
        super(qcm);
        this.controller = controller;
        this.tag = tag;
    }

    destroy(): void {
        this.orderResult.removeOrderTracing(this);
        super.destroy();
        this.controller = undefined;
        this.tag = undefined;
        if (this.rangeOrderResultOwned) {
            this.orderResult.destroy();
            this.rangeOrderResultOwned = false;
        }
        this.orderResult = undefined;
    }

    init(dataSource: DataSourceComposable): void {
        if (testReuseOrderResult && dataSource instanceof DataSourceOrdering) {
           this.orderResult = dataSource.funcResult;
        } else {
            this.orderResult = new RangeOrderResult(globalInternalQCM);
            this.orderResult.updateOffsets([0, Infinity], false, false, true);
            this.orderResult.setData(dataSource.funcResult);
            this.rangeOrderResultOwned = true;
        }
        this.setData(this.orderResult);
        this.orderResult.addOrderTracing(this);
    }

    supportsMultiProj(): boolean {
        return false;
    }

    isActive(): boolean {
        return this.active;
    }

    activate(): void {
        if (!this.active) {
            this.activated();
            this.active = true;
        }
    }

    deactivate(): void {
        if (this.active) {
            this.deactivated();
            this.active = false;
        }
    }

    refreshIndexerAndPaths(dataObj: FuncResult): void {
        this.controller.refreshIndexerAndPaths(this.tag, dataObj);
    }

    replaceIndexerAndPaths(prevPrefixPathId: number, prefixPathId: number,
                           dataObj: FuncResult): void {
        this.controller.replaceIndexerAndPaths(this.tag, prevPrefixPathId,
                                               prefixPathId, dataObj);
    }

    updatePos(elementIds: number[], firstOffset: number,
              lastOffset: number, setSize: number): void
    {
        var arr: number[] = this.dataElementIdsInOrder;

        arr = cconcat(arr.slice(0, firstOffset), elementIds);
        if (arr.length < setSize) {
            arr = cconcat(arr, this.dataElementIdsInOrder.slice(lastOffset+1,
                                                                setSize));
        }
        this.dataElementIdsInOrder = arr;
        this.controller.updateDataElementPosition(elementIds, firstOffset,
                                                  lastOffset, setSize);
    }

    refreshProjMappings(pathMappings: any): void {
        Utilities.error("not expected to be called");
    }

    addDataObjMatches(oldDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
    }

    removeDataObjMatches(newDataObj: FuncResult, didIndexerOrPathChange: boolean, argNum: number): void {
    }

    addMatches(elementIDs: number[], source: FuncResult): void {
    }

    removeMatches(elementIDs: number[], source: FuncResult): void {
    }

    removeAllMatches(source: FuncResult): void {
    }

    addProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
    }

    removeProjMatches(elementIDs: number[], resultID: number, projectionID: number): void {
    }
}

// TODO: find place for global declaration for the internal QCM
var globalInternalQCM: QCM = new InternalQCM();

function accuquery(ds: DataSource): string {
    function accToString(acc: AccuQuery): string {
        var str: string;
        if (acc.function !== undefined) {
            str = "SELECT " + acc.function.toUpperCase() + "(*)";
        } else if (acc.projections !== undefined) {
            if ("undefined" in acc.projections) {
                str = "SELECT DISTINCT *";
            } else {
                str = "SELECT " + Object.keys(acc.projections).join(", ");
            }
        } else {
            str = "SELECT *";
        }
        if (acc.selection !== undefined) {
            str += " WHERE " + acc.selection.join(" AND ");
        }
        if (acc.sort !== undefined) {
            str += " ORDER BY " + acc.sort;
        }
        if (acc.position !== undefined) {
            str += " LIMIT " + acc.position;
        }
        if (acc.from !== undefined) {
            if (typeof(acc.from) === "string") {
                str += " FROM " + acc.from;
            } else {
                str += " FROM (" + accToString(acc.from) + ")";
            }
        }
        return str;
    }
    return accToString(ds.accumulatedQuery());
}
