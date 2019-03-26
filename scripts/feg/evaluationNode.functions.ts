// Copyright 2018 Yoav Seginer, Theo Vosse.
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
/// <reference path="dataSource.ts" />

// When identifying a data source, this function passes along the original
// data and stores the ids in the original indexer using XXX
class EvaluationIdentify extends EvaluationNodeWithArguments implements ReceiveDataSourceResult {
    constant: boolean = true;
    arguments: Result[];

    // Single attribute used for identification projection
    // "" is equivalent to _
    // true is used for a constant identification
    identificationAttribute: string|boolean = undefined;
    identificationQuery: SimpleQuery;
    unidentified: WeakMap<any, string> = new WeakMap<any, string>();
    nextUniqueId: number = 0;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.inputs = new Array(prototype.functionArguments.length);
        this.arguments = new Array(prototype.functionArguments.length);
        this.result.value = emptyDataSourceResult;
        this.dataSourceAware = true;
    }

    destroy(): void {
        if (this.dataSourceInput !== undefined) {
            this.releaseDataSourceInput();
        }
        super.destroy();
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.arguments[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, true, true, i === 1);
        } else {
            this.updateInput(i, evalNode.result);
        }
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        this.inputs[1].setDataSourceResultMode(dataSourceResultMode);
        this.dataSourceResultMode = dataSourceResultMode;
    }

    dataSourceInput: DataSourceComposable;
    dataSourceIdentify: DataSourceComposable;

    // Get the application of the aggregate function on the data source,
    // and copy the possibly already existing result.
    setDataSourceInput(dataSource: DataSourceComposable): void {
        if (this.dataSourceInput !== dataSource) {
            this.dataSourceInput = dataSource;
            this.updateIdentificationQuery();
        }
    }

    updateIdentificationQuery(): void {
        if (this.dataSourceIdentify !== undefined) {
            this.dataSourceIdentify.removeResultReceiver(this);
        }
        if (this.identificationAttribute === undefined) {
            this.dataSourceIdentify = undefined;
            this.result.copy(this.arguments[1]);
        } else if (typeof(this.identificationAttribute) === "string") {
            // TODO: support for other identifications in data source
            this.dataSourceIdentify = 
                this.dataSourceInput.applyIdentity(
                    this.identificationAttribute, this,
                    this.inputs[0].querySourceId());
            this.result.dataSource = this.dataSourceIdentify;
            this.result.value = emptyDataSourceResult;
        }
        this.markAsChanged();
    }

    releaseDataSourceInput(): void {
        this.dataSourceIdentify.removeResultReceiver(this);
        this.dataSourceIdentify = undefined;
        this.dataSourceInput = undefined;
    }

    updateInput(i: any, result: Result): void {

        function getIdentificationAttribute(): string|boolean {
            var v: any = result.value;

            if (v instanceof Array && v.length === 1)
                v = v[0];
            if (v === _)
                return "";
            if (typeof(v) !== "object" || v instanceof NonAV)
                return v;
            var attributes: string[] = Object.keys(v);
            if (attributes.length !== 1)
                return undefined;
            var attr: string = attributes[0];
            v = v[attr];
            return v === _ || (v instanceof Array && v.length === 1 && v[0] === _)?
                attr: undefined;
        }

        this.arguments[i] = result;
        switch (i) {
          case 0:
            this.identificationAttribute = getIdentificationAttribute();
            if (this.identificationAttribute === undefined) {
                this.identificationQuery = makeSimpleQueryDefault(getDeOSedValue(result.value), undefined);
            } else if (this.identificationQuery !== undefined) {
                this.identificationQuery = undefined;
            }
            if (this.dataSourceResultMode) {
                this.updateIdentificationQuery();
            } else {
                // Evaluate again
                this.markAsChanged();
            }
            break;
          case 1:
            if ("dataSource" in result) {
                this.dataSourceResultMode = true;
                this.result.value = result.value;
                this.setDataSourceInput(result.dataSource);
            } else {
                this.dataSourceResultMode = false;
                this.markAsChanged();
            }
            break;
        }
    }

    newDataSourceResult(v: any[]): void {
    }

    reextractData(): void {
        assert(false, "should not be called");
    }

    isConstant(): boolean {
        return this.constant;
    }

    eval(): boolean {
        if (!this.dataSourceResultMode) {
            this.result.value = this.arguments[1].value;
            this.result.copyLabels(this.arguments[1]);
            this.result.identifiers = this.getIdentifiers(this.arguments[1].value);
        }
        return true;
    }

    // Limited implementation for extracting identifiers from an os.
    // Any problem will turn the id for an element into a unique id.
    getIdentifiers(value: any): any[] {
        var va: any = value instanceof Array? value: [value];
        var ids: any[] = new Array(va.length);

        if (typeof(this.identificationAttribute) === "string") {
            for (var i: number = 0; i !== va.length; i++) {
                if (this.identificationAttribute === "") {
                    ids[i] = this.getUniqueId(va[i]);
                } else {
                    var id: any = va[i] instanceof ElementReference? va[i].getElement():
                        va[i] instanceof Object? va[i][this.identificationAttribute]:
                        this.getUniqueId(va[i]);
                    if (id instanceof Array) {
                        if (id.length === 1) {
                            id = id[0];
                        } else {
                            id = this.getUniqueId(va[i]);
                        }
                    }
                    ids[i] = id;
                }
            }
        } else if (this.identificationQuery !== undefined) {
            ids = va.map((v: any): any => {
                var id: any = getDeOSedValue(this.identificationQuery.execute([v], undefined, undefined, undefined, undefined));
                return isSimpleType(id)? id: cdlifyNormalized(id);
            });
        } else {
            ids = va.map((v: any): any => this.identificationAttribute);
        }
        return ids;
    }

    getUniqueId(uvo: any): string { // the Unidentified Value Object
        if (isAV(uvo)) {
            if (!this.unidentified.has(uvo)) {
                var nuid: string = "id_" + String(this.watcherId) +
                    "_" + this.nextUniqueId++;
                this.unidentified.set(uvo, nuid);
            }
            return this.unidentified.get(uvo);
        } else if (uvo instanceof NonAV) {
            return uvo.stringify();
        } else {
            return uvo;
        }
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var identifiedPositions: DataPosition[] = undefined;

        if (positions !== undefined && typeof(this.identificationAttribute) === "string") {
            identifiedPositions = positions.map(pos_i => {
                if (pos_i.identity !== undefined) {
                    var pos_i_id = pos_i.copy();
                    if (pos_i_id.addedAttributes === undefined) {
                        pos_i_id.addedAttributes = {};
                    }
                    pos_i_id.addedAttributes[<string>this.identificationAttribute] =
                        ensureOS(pos_i_id.identity);
                    pos_i_id.identity = undefined;
                    pos_i_id.index = undefined;
                    return pos_i_id;
                } else {
                    return pos_i;
                }
            });
        } else if (positions !== undefined) {
            assert(this.identificationQuery === undefined, "TODO: writing for complex identification");
        }
        if (this.inputs[1] !== undefined) {
            return this.inputs[1].write(result, mode, attributes, identifiedPositions, reportDeadEnd);
        }
        return false;
    }

    debugName(): string {
        return "identify";
    }

    // querySourceId(): number {
    //     return this.inputs[1].querySourceId(this);
    // }

    multiQuerySourceIds(): number[] {
        return this.inputs[1].multiQuerySourceIds();
    }
}
identify.classConstructor = EvaluationIdentify;

type SortKeyValue = {value: any; type: string;};

// localeCompare takes a huge amount of time on Chrome: sorting 3000 strings
// costs around 4 seconds, so it's back to normal string comparison. To
// compensate, extractKeys() puts the locale lowercase version of the actual
// input in the key.
// Equally, handling value maps here also proved expensive (3000 items adds
// 6 to 9 seconds to the load time), so the mapping is also done in
// extractKeys().
// If both items are identical, their position is used to determine the order,
// which keeps sorting a bit stable.
function compareKeys(a: {pos: number; elt: any; key: SortKeyValue[]; identity: any;}, b: {pos: number; elt: any; key: SortKeyValue[]; identity: any;}, order: number[]): number {
    for (var i: number = 0; i < order.length; i++) {
        var cmp: number = 0;
        if (a.key[i] === undefined || b.key[i] === undefined) {
            // Undefined keys come from comparison functions; these values
            // do not follow the ascending/descending ordering.
            cmp = a.key[i] !== undefined? -1: b.key[i] !== undefined? 1: 0;
            if (cmp !== 0) {
                return cmp;
            }
        } else if (a.key[i].type !== b.key[i].type) {
            // "undefined" is always the largest regardless of order[i].
            if (a.key[i].type === "undefined") {
                return b.key[i].type === "undefined"? 0: 1;
            }
            if (b.key[i].type === "undefined") {
                return -1;
            }
            cmp = a.key[i].type < b.key[i].type? -1: 1;
        // } else if (a.key[i].type === "string") {
        //     cmp = a.key[i].value.localeCompare(b.key[i].value, userLocale, {sensitivity: "accent", numeric: true});
        } else if (a.key[i].type === "number") {
            cmp = a.key[i].value - b.key[i].value;
        } else if (a.key[i].value !== b.key[i].value) {
            cmp = a.key[i].value < b.key[i].value? -1: 1;
        }
        if (cmp !== 0) {
            return order[i] * cmp;
        }
    }
    return order[0] * (a.pos - b.pos);
}

type SimpleTypeSortKeyValue = {value: any; type: string; compareKey: any};

class EvaluationSort extends EvaluationFunctionApplication
    implements OrderingResultWatcherInterface
{

    prototype: SortNode;

    // Sort keys and order of the values. All three members are arrays of the
    // same length.

    /** A list of the paths of the sort values in order of priority */
    paths: string[][];
    /** The order in which each path has to be sorted */
    order: number[];
    /** The map that assigns an order to a specific value; if it is undefined,
      * the natural order is used. */
    valueMap: {[value: string]: number}[];

    /** OS of comparison functions */
    comparisonFunctions: ComparisonFunctionValue[][];

    // Sort keys and values for area imports

    /** The list of paths encoded as export ids */
    sortKeyExportIds: number[];
    /** The position of each export id in the sort key order; only used to
     *  verify presence. */
    sortKeyExportIdMap: {[exportId: number]: number};
    /** Mapping each export id onto a set of areas. Of each area under each id,
      * the watched evaluation node is stored, plus its last result and the
      * flag that indicates if this node has activated it or not.
      */
    areas: {
        [exportId: number]: {
            [areaId: string]: {
                watched: EvaluationNode;
                active: boolean;
                result: Result;
            }
        }
    };
    combinedInputs: EvaluationNode[];

    /** Interface to positioning when sorting indexer to javascript */
    orderingResultWatcher: OrderingResultWatcher;
    /** Result node when sorting indexer to indexer: it's a _ projection
      * that avoids changes when the comparison chain is updated */
    sortResultNode: DataSourceQueryByData;

    constructor(prototype: SortNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constEmptyOS;
        this.dataSourceAware = true;
        this.dataSourceResultMode = true;
        this.orderingResultWatcher = undefined;
        this.result.value = emptyDataSourceResult;
        if (prototype.areaSort) {
            this.sortKeyExportIds = undefined;
            this.sortKeyExportIdMap = undefined;
            this.areas = {};
        }
    }

    removeAsWatcher(): void {
        var dataNode: EvaluationNode = this.inputs[0];

        super.removeAsWatcher();
        for (var exportId in this.areas) {
            var ae = this.areas[exportId];
            for (var areaId in ae) {
                var node: EvaluationNode = ae[areaId].watched;
                node.removeWatcher(this, false, false);
                if (ae[areaId].active && node !== dataNode) {
                    node.deactivate(this, false);
                }
            }
        }
        this.areas = undefined;
    }

    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
        if (i === 1) {
            this.setSortKey(result.value);
        } else if (i === 0) {
            if (("dataSource" in result || "dataSource" in this.result) &&
                (this.inputs[0].isScheduled() || !this.inputs[0].isActive())) {
                // Wait with changing datasources until input has been updated
                this.inputs[0].addForcedUpdate(this);
            } else if ("dataSource" in result) {
                this.setDataSourceInput(result.dataSource);
                // Do not call markAsChanged; that is up to the data source
                // chain.
            } else {
                if (this.dataSourceInput !== undefined) {
                    this.releaseDataSourceInput();
                    this.dataSourceInput = undefined;
                }
                if (this.prototype.areaSort) {
                    if (this.prototype.areaSort && this.nrActiveWatchers > 0 &&
                          this.setAreas(result.value)) {
                        this.markAsChanged();
                    }
                } else {
                    this.markAsChanged();
                }
            }
        } else {
            var exportId: number = i[0];
            var areaId: string = i[1];
            if (result !== undefined) {
                this.areas[exportId][areaId].result = result;
            } else {
                var ae = this.areas[exportId];
                if (!(exportId in this.sortKeyExportIdMap)) {
                    delete this.areas[exportId];
                }
                if (ae[areaId].active) {
                    ae[areaId].watched.deactivate(this, false);
                }
                ae[areaId].watched.removeWatcher(this, false, false);
                delete ae[areaId];
            }
            this.markAsChanged();
        }
    }

    setSortKey(sortKeys: any[]): void {
        this.paths = [];
        this.order = [];
        this.valueMap = [];
        this.comparisonFunctions = [];
        if (sortKeys !== undefined) {
            this.determineSortKeys(sortKeys, []);
        }
        if (this.inputs[0] !== undefined && this.inputs[0].result !== undefined &&
              "dataSource" in this.inputs[0].result) {
            this.setDataSourceComparisonQuery(this.inputs[0].result.dataSource);
        } else {
            if (this.dataSourceInput !== undefined) {
                this.releaseDataSourceInput();
            }
            if (this.prototype.areaSort && this.inputs[0] !== undefined) {
                this.determineSortKeyExportIds();
                if (this.setAreas(this.inputs[0].result.value)) {
                    this.markAsChanged();
                }
            }
            this.markAsChanged();
        }
    }

    /** Recursively extracts the sort keys. It extracts the paths through an
      * av, until it reaches a string or an os of values. If the string is
      * "ascending" or "descending", the values will be sorted according to their
      * natural order. If there is an os of values, these will determine the
      * sorting order. */
    determineSortKeys(sk: any, path: string[]): void {

        function isOSOfSimpleValues(v: any): boolean {
            return v instanceof Array && v.length !== 0 &&
                   v.every(function(v_i: any): boolean {
                       return isSimpleType(v_i);
                   });
        }

        function isOSOfComparisonFunctions(v: any): boolean {
            return v instanceof Array && v.length !== 0 &&
                   v.every(function(v_i: any): boolean {
                       return v_i instanceof ComparisonFunctionValue;
                   });
        }

        if (!(sk instanceof Array)) {
            if (sk === undefined) {
                return;
            }
            sk = [sk];
        }
        var terminalSKs: any[] = [];
        var pathSKs: any[] = [];
        for (var i = 0; i < sk.length; i++) {
            var sk_i: any = sk[i];
            if (typeof(sk_i) === "object" && isAV(sk_i)) {
                pathSKs.push(sk_i);
            } else {
                if(sk_i == "ascending" || sk_i == "descending")
                    terminalSKs.push(new ComparisonFunctionValue([sk_i]));
                else
                    terminalSKs.push(sk_i);
            }
        }
        if (isOSOfSimpleValues(terminalSKs)) {
            // Old sort key
            if (terminalSKs.length === 1 && (terminalSKs[0] === "ascending" ||
                  terminalSKs[0] === "descending")) {
                this.paths.push(path);
                this.order.push(terminalSKs[0]=== "ascending"? 1: -1);
                this.valueMap.push(undefined);
            } else {
                var vMap: {[value: string]: number} = {};
                for (var j: number = 0; j < terminalSKs.length; j++) {
                    vMap[terminalSKs[j]] = j;
                }
                this.paths.push(path);
                this.order.push(1);
                this.valueMap.push(vMap);
            }
            this.comparisonFunctions.push(undefined);
        } else if (isOSOfComparisonFunctions(terminalSKs)) {
            // New sort key
            this.paths.push(path);
            this.order = cconcat(this.order, terminalSKs.map(
                function(cf: ComparisonFunctionValue): number {
                    return cf.inAscendingOrder()? 1: -1;
                }));
            this.valueMap.push(undefined);
            this.comparisonFunctions.push(terminalSKs);
        } else if (terminalSKs.length !== 0) {
            Utilities.warn("invalid sort key at path '" + path.join(".") + "': " +
                           cdlify(terminalSKs));
        }
        for (var i: number = 0; i < pathSKs.length; i++) {
            for (var attr in pathSKs[i]) {
                this.determineSortKeys(pathSKs[i][attr], path.concat(attr));
            }
        }
    }

    determineSortKeyExportIds(): void {
        this.sortKeyExportIds = [];
        this.sortKeyExportIdMap = {};
        for (var i: number = 0; i < this.paths.length; i++) {
            if (this.paths[i].length !== 0) {
                var exportPath: string[] = normalizePath(this.paths[i]);
                var exportId: number =
                    getPathAssociation(exportPath, pathToExportId);
                if (exportId === undefined) {
                    Utilities.warn("unknown export id for " +
                                   exportPath.join("."));
                } else {
                    this.sortKeyExportIdMap[exportId] =
                        this.sortKeyExportIds.length;
                    this.sortKeyExportIds.push(exportId);
                }
            }
        }
    }

    sortQuery: DataSourceSort;

    setDataSourceInput(dataSource: DataSourceComposable): void {
        if (this.dataSourceInput !== dataSource) {
            this.setDataSourceComparisonQuery(dataSource);
        }
    }

    releaseDataSourceInput(): void {
        if (this.orderingResultWatcher !== undefined) {
            this.orderingResultWatcher.destroy();
            this.orderingResultWatcher = undefined;
        }
        if (this.sortResultNode !== undefined) {
            this.sortResultNode.removeResultReceiver(this);
            this.sortResultNode = undefined;
        }
        this.sortQuery.removeResultReceiver(this);
        this.sortQuery = undefined;
        this.dataSourceInput = undefined;
        delete this.result.dataSource;
        this.markAsChanged();
    }

    setDataSourceComparisonQuery(dataSource: DataSourceComposable): void {
        var pathComparisons: PathComparisonFunction[] = this.pathComparisonFunctions();

        if (this.dataSourceInput === dataSource) {
            this.sortQuery.updateSortKeys(pathComparisons);
        } else {
            if (this.dataSourceInput !== undefined) {
                if (this.orderingResultWatcher !== undefined) {
                    this.orderingResultWatcher.destroy();
                    this.orderingResultWatcher = undefined;
                }
                if (this.sortResultNode !== undefined) {
                    this.sortResultNode.removeResultReceiver(this);
                    this.sortResultNode = undefined;
                }
                this.sortQuery.removeResultReceiver(this);
            }
            // Register the query on the new input
            this.sortQuery = dataSource.applySort(pathComparisons, this);
            if (!this.dataSourceResultMode) {
                assert(this.orderingResultWatcher === undefined, "debugging");
                this.orderingResultWatcher =
                    new OrderingResultWatcher(globalInternalQCM, this, undefined);
                this.orderingResultWatcher.init(this.sortQuery);
                if (this.isActive()) {
                    this.orderingResultWatcher.activate();
                }
                this.sortQuery.updateIndexerMonitoringForDominatedPath();
            } else {
                this.sortResultNode = this.sortQuery.applyDataQuery(
                    _, this, DataSourceQueryByData._id, this.watcherId);
            }
            this.dataSourceInput = dataSource;
            this.markAsChanged(); // pass on the changed dataSource
        }
    }

    pathComparisonFunctions(): PathComparisonFunction[] {
        var comparisonFunctions: PathComparisonFunction[] =
            new Array<PathComparisonFunction>(this.paths.length);

        for (var i: number = 0; i < this.paths.length; i++) {
            if (this.comparisonFunctions[i] === undefined) {
                comparisonFunctions[i] = {
                    path: this.paths[i],
                    comparisons: [{
                        queries: [],
                        simpleQueries: undefined,
                        orderByValue: true,
                        inAscendingOrder: this.order[i] === 1,
                        unmatched: undefined
                    }]
                };
            } else {
                comparisonFunctions[i] = {
                    path: this.paths[i],
                    comparisons: this.buildComparisonElements(
                        this.comparisonFunctions[i])
                };
            }
        }
        return comparisonFunctions;
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.dataSourceInput !== undefined) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                assert(this.sortResultNode === undefined, "debugging");
                if (this.orderingResultWatcher !== undefined) {
                    this.orderingResultWatcher.destroy();
                    this.orderingResultWatcher = undefined;
                }
                this.sortResultNode = this.sortQuery.applyDataQuery(
                    _, this, DataSourceQueryByData._id, this.watcherId);
                if (this.result !== undefined) {
                    this.result.value = emptyDataSourceResult;
                }
                this.sortQuery.stopIndexerMonitoring();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                assert(this.orderingResultWatcher === undefined, "debugging");
                if (this.sortResultNode !== undefined) {
                    this.sortResultNode.removeResultReceiver(this);
                    this.sortResultNode = undefined;
                }
                this.orderingResultWatcher =
                    new OrderingResultWatcher(globalInternalQCM, this, undefined);
                this.orderingResultWatcher.init(this.sortQuery);
                if (this.isActive()) {
                    this.orderingResultWatcher.activate();
                }
                this.sortQuery.updateIndexerMonitoringForDominatedPath();
                this.markAsChanged();
            }
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    // Let data go untouched when there are no sort keys
    dontSort(): boolean {
        return this.prototype.areaSort?
               this.sortKeyExportIds.length === 0:
               this.paths.length === 0;
    }
 
    // When sort key is _, and there is no map, don't call compareKeys.
    sortDirectly(): boolean {
        return this.paths.length === 1 && this.paths[0].length === 0 &&
               this.valueMap[0] === undefined &&
               this.comparisonFunctions[0] === undefined;
    }

    // TODO: Does not yet watch for changes
    extractDataSourceResult(): boolean {
        var oldValue: any[] = this.result.value;
        var res: any[] = this.sortQuery.extractData(
            MinimumResultRequirements.ordered, this.orderingResultWatcher);
        var hadDataSource: boolean = "dataSource" in this.result;

        // console.log(this.prototype.idStr(), "sort.extractDataSourceResult",
        //             this.sortQuery.sortString, "#" + res.length);
        this.result.value = res;
        if (hadDataSource) {
            delete this.result.dataSource;
        }
        return hadDataSource || !valueEqual(oldValue, res);
    }

    reextractData(): void {
        assert(!this.dataSourceResultMode, "should have been disabled");
        this.markAsChanged();
    }

    // First the values for the keys for each element in data are extracted and
    // value-mapped (if necessary); then the result is put in a big map that
    // is sorted, after which the values and identifiers are extracted in the
    // new order.
    eval(): boolean {
        // First check for data source input
        if (this.dataSourceInput !== undefined) {
            if (this.dataSourceResultMode) {
                // Update is propagated via the data source application chain
                if (this.result.dataSource !== this.sortResultNode) {
                    // Pass the ordering query on as a data source
                    this.result.dataSource = this.sortResultNode;
                    this.result.value = emptyDataSourceResult;
                    return true;
                }
                return false;
            } else {
                return this.extractDataSourceResult();
            }
        } else if ("dataSource" in this.result) {
            delete this.result.dataSource;
            // note: this changes the result, and must result in return true;
        }

        function simpleValueToSortKeys(simpleValue: any): SimpleTypeSortKeyValue {
            var type = typeof(simpleValue);

            return {
                type: type,
                value: simpleValue,
                compareKey: type === "string"? simpleValue.toLocaleLowerCase(): simpleValue
            };
        }

        function sortKeysToSimpleValue(sortKey: SimpleTypeSortKeyValue): any {
            return sortKey.value;
        }

        // Sorting criterion when the order is ascending and there are no keys.
        // undefined ends at the bottom because of the type comparison.
        function compareJSValues(a: SimpleTypeSortKeyValue, b: SimpleTypeSortKeyValue): number {
            if (a.type !== b.type) {
                return a.type < b.type? -1: 1;
            }
            if (a.type === "number") {
                return a.compareKey - b.compareKey;
            }
            if (a.compareKey !== b.compareKey) {
                return a.compareKey < b.compareKey? -1: 1;
            }
            return 0;
        }

        // Sorting criterion when the order is descending and there are no keys.
        // Type comparison is different than in compareJSValues in order to get
        // undefined at the bottom.
        function compareJSValuesDesc(a: SimpleTypeSortKeyValue, b: SimpleTypeSortKeyValue): number {
            if (a.type !== b.type) {
                return a.type === "undefined"? 1: b.type === "undefined"? -1:
                    a.type < b.type? -1: 1;
            }
            if (a.type === "number") {
                return b.compareKey - a.compareKey;
            }
            if (a.compareKey !== b.compareKey) {
                return b.compareKey < a.compareKey? -1: 1;
            }
            return 0;
        }


        var data: any = this.arguments[0].value instanceof Array? this.arguments[0].value:
            this.arguments[0].value === undefined? undefined: [this.arguments[0].value];
        var identifiers: any[] = this.arguments[0].identifiers;
        var keys: SortKeyValue[][] =
            this.dontSort() || (this.sortDirectly() && identifiers === undefined)?
            undefined:
            this.extractKeys(data);
        var order: number[] = this.order;

        this.result.copyLabels(this.arguments[0]);
        if (data !== undefined) {
            if (data === emptyDataSourceResult && "dataSource" in this.result) {
                this.result.value = data;
            } else if (this.dontSort()) {
                this.result.value = data;
            } else if (this.sortDirectly() && identifiers === undefined) {
                this.result.value = data.map(simpleValueToSortKeys).sort(
                    this.order[0] === 1? compareJSValues: compareJSValuesDesc).
                    map(sortKeysToSimpleValue);
            } else {
                // Array of data and associated sort values
                var map: {pos: number; elt: any; key: SortKeyValue[]; identity: any;}[] =
                    new Array(data.length);
                for (var i: number = 0; i < data.length; i++) {
                    map[i] = {
                        pos: i,
                        elt: data[i],
                        key: keys[i],
                        identity: identifiers !== undefined? identifiers[i]: undefined
                    };
                }
                map.sort(function(a: {pos: number; elt: any; key: SortKeyValue[]; identity: any;}, b: {pos: number; elt: any; key: SortKeyValue[]; identity: any;}): number {
                    return compareKeys(a, b, order);
                });
                this.result.value = map.map(function(a: {pos: number; elt: any; key: any[]; identity: any;}): any {
                    return a.elt;
                });
                if (identifiers !== undefined) {
                    identifiers = map.map(function(a: {pos: number; elt: any; key: any[]; identity: any;}): any {
                        return a.identity;
                    });
                }
            }
        }
        this.result.setIdentifiers(identifiers);
        return true;
    }

    setAreas(data: any): boolean {
        var change: boolean = false;
        var wait: boolean = false;
        var newAreaIds: {[areaId: string]: boolean} = {};

        if (data === undefined) {
            data = [];
        } else if (!(data instanceof Array)) {
            data = [data];
        }
        for (var i: number = 0; i !== data.length; i++) {
            if (data[i] instanceof ElementReference) {
                var elemRef = <ElementReference> data[i];
                var area: CoreArea = allAreaMonitor.getAreaById(elemRef.element);
                for (var j: number = 0; j < this.sortKeyExportIds.length; j++) {
                    var exportId: number = this.sortKeyExportIds[j];
                    var ae = this.areas[exportId];
                    if (ae === undefined) {
                        ae = this.areas[exportId] = {}; 
                    }
                    if (area !== undefined && area.exports !== undefined &&
                          exportId in area.exports) {
                        var expNode: EvaluationNode = area.getExport(exportId);
                        newAreaIds[area.areaId] = true;
                        if (!(area.areaId in ae)) {
                            ae[area.areaId] = {
                                watched: expNode,
                                active: false,
                                result: undefined
                            };
                            expNode.addWatcher(this, [exportId, area.areaId], true, false, false);
                        }
                        if (this.nrActiveWatchers > 0 && !expNode.isConstant() &&
                              !ae[area.areaId].active) {
                            expNode.activate(this, false);
                            ae[area.areaId].active = true;
                            if (expNode.isScheduled()) {
                                wait = true;
                                expNode.forceUpdate(this, false);
                            }
                            change = true;
                        }
                        ae[area.areaId].result = expNode.result;
                    }
                }
            }
        }
        for (var exportId2 in this.areas) {
            var ae = this.areas[exportId2];
            var deleteId: boolean = false;
            if (!(exportId2 in this.sortKeyExportIdMap)) {
                delete this.areas[exportId2];
                deleteId = true;
            }
            for (var areaId in ae) {
                if (deleteId || !(areaId in newAreaIds)) {
                    if (ae[areaId].active) {
                        ae[areaId].watched.deactivate(this, false);
                    }
                    ae[areaId].watched.removeWatcher(this, false, false);
                    delete ae[areaId];
                    change = true;
                }
            }
        }
        if ((wait || change) && "combinedInputs" in this) {
            this.combinedInputs = undefined;
        }
        return change && !wait;
    }

    activateInputs(): void {
        super.activateInputs();
        this.paths = [];
        this.order = [];
        this.valueMap = [];
        this.comparisonFunctions = [];
        this.determineSortKeys(this.arguments[1].value, []);
        if (this.prototype.areaSort && this.inputs[0] !== undefined) {
            this.determineSortKeyExportIds();
            if (this.inputs[0].isScheduled()) {
                this.inputs[0].forceUpdate(this, false);
            } else if (this.setAreas(this.inputs[0].result.value)) {
                this.markAsChanged();
            }
        }
    }

    deactivateInputs(): void {
        super.deactivateInputs();
        if (this.sortQuery !== undefined) {
            this.sortQuery.stopIndexerMonitoring();
        }
        if (this.prototype.areaSort) {
            for (var i: number = 0; i < this.sortKeyExportIds.length; i++) {
                var ae = this.areas[this.sortKeyExportIds[i]];
                for (var areaId in ae) {
                    if (ae[areaId].active) {
                        ae[areaId].watched.deactivate(this, false);
                        ae[areaId].active = false;
                    }
                }
            }
        }
    }

    allInputs(): EvaluationNode[] {
        if (this.prototype.areaSort) {
            if (this.combinedInputs === undefined) {
                var ci: EvaluationNode[] = this.inputs.slice(0);
                for (var i: number = 0; i < this.sortKeyExportIds.length; i++) {
                    var ae = this.areas[this.sortKeyExportIds[i]];
                    for (var areaId in ae) {
                        if (ae[areaId].active) {
                            ci.push(ae[areaId].watched);
                        }
                    }
                }
                this.combinedInputs = ci;
            }
            return this.combinedInputs;
        } else {
            return this.inputs;
        }
    }

    allLogInputs(): EvaluationNode[] {
        if (this.prototype.areaSort) {
            var ci: EvaluationNode[] = this.inputs.slice(0);
            for (var i: number = 0; i < this.sortKeyExportIds.length; i++) {
                var ae = this.areas[this.sortKeyExportIds[i]];
                for (var areaId in ae) {
                    ci.push(ae[areaId].watched);
                }
            }
            return ci;
        } else {
            return this.inputs;
        }
    }

    // TODO: reordering!!
    // write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[]): void {
    //     this.inputs[0].write(result, mode, attributes, positions);
    // }

    debugName(): string {
        return "sort";
    }

    extractKeys(data: any): SortKeyValue[][] {
        var keys: SortKeyValue[][];
        var comparisonElements: ComparisonFunctionElement[][] = [];

        function extractPath(data: any, path: string[]): any {
            var ptr: any = data;

            for (var i: number = 0; i !== path.length; i++) {
                var elt: any = ptr instanceof Array? ptr[0]: ptr;
                if (isAV(elt)) {
                    ptr = elt[path[i]];
                } else {
                    return undefined;
                }
            }
            return ptr;
        }

        if (data === undefined) {
            return constEmptyOS;
        }
        keys = new Array(data.length);
        for (var i: number = 0; i !== data.length; i++) {
            var key: SortKeyValue[] = [];
            if (this.prototype.areaSort && data[i] instanceof ElementReference) {
                var elemRef: ElementReference = data[i];
                for (var j: number = 0; j < this.sortKeyExportIds.length; j++) {
                    var exportId: number = this.sortKeyExportIds[j];
                    var ae = this.areas[exportId][elemRef.element];
                    if (ae !== undefined) {
                        var value: any = getDeOSedValue(ae.result.value);
                        if (this.valueMap[j] !== undefined) {
                            key.push({
                                value: this.valueMap[j][value],
                                type: "number"
                            });
                        } else {
                            var type: string = typeof(value);
                            key.push({
                                value: type === "string"? value.toLocaleLowerCase(): value,
                                type: type
                            });
                        }
                    } else {
                        key.push({
                            value: undefined,
                            type: undefined
                        });
                    }
                }
            } else {
                for (var j: number = 0; j < this.paths.length; j++) {
                    var value: any = extractPath(data[i], this.paths[j]);
                    if (value instanceof Array && value.length === 1) {
                        value = value[0];
                    }
                    if (this.comparisonFunctions[j] !== undefined) {
                        if (comparisonElements[j] === undefined) {
                            comparisonElements[j] = this.buildComparisonElements(
                                this.comparisonFunctions[j]);
                        }
                        key = cconcat(key, this.applyComparisonFunctions(value, comparisonElements[j]));
                    } else if (this.valueMap[j] !== undefined) {
                        var mapped = this.valueMap[j][value];
                        key.push({
                            value: mapped,
                            type: mapped === undefined? "undefined": "number"
                        });
                    } else {
                        var type: string = typeof(value);
                        if (type === "object") {
                            type = "undefined";
                            value = undefined;
                        }
                        key.push({
                            value: type === "string"? value.toLocaleLowerCase(): value,
                            type: type
                        });
                    }
                }
            }
            keys[i] = key;
        }
        return keys;
    }

    // querySourceId(): number {
    //     return this.inputs[0].querySourceId(this);
    // }

    multiQuerySourceIds(): number[] {
        return this.inputs[0].multiQuerySourceIds();
    }

    buildComparisonElements(comparisonFunctions: ComparisonFunctionValue[]): ComparisonFunctionElement[] {
        return comparisonFunctions.map(function(cf: ComparisonFunctionValue): ComparisonFunctionElement {
            var unmatchedPos: number = -1; 
            var n: number = cf.elements.length;
            var q: any[] = [];
            for (var i = 0; i < n; i++) {
                var element: any[] = cf.elements[i];
                var sElt = getDeOSedValue(element);
                if (sElt === unmatched) {
                    if (unmatchedPos !== -1) {
                        Utilities.warn("more than one unmatched in comparison function");
                    }
                    unmatchedPos = i;
                } else if (i !== n - 1 || (sElt !== ascending && sElt !== descending)) {
                    q.push(element);
                }
            }
            if (q.length === 1 && q[0] instanceof Array &&
                  q[0].every((elt: any) => { return elt instanceof ComparisonFunctionValue; })) {
                q = q[0].map((elt: any) => { return elt.elements.reduce(
                    function(a: any[], b: any[]): any[] {
                        return a.concat(b);
                    }, []);
                });
            }
            return {
                queries: q,
                simpleQueries: q.map(function(elt: any): SimpleQuery {
                                         return makeSimpleQuery(elt, undefined);
                                     }),
                orderByValue: cf.orderByValue(),
                inAscendingOrder: cf.inAscendingOrder(),
                unmatched: unmatchedPos
            };
        });
    }

    applyComparisonFunctions(value: any, comparisonElements: ComparisonFunctionElement[]): SortKeyValue[] {
        var key: SortKeyValue[] = new Array(comparisonElements.length);

        for (var i: number = 0; i < comparisonElements.length; i++) {
            var compElt: ComparisonFunctionElement = comparisonElements[i];
            var queries: SimpleQuery[] = compElt.simpleQueries;
            var j: number = 0;
            var projValue: any = undefined;
            while (j < queries.length && !queries[j].testSingle(value)) {
                j++;
            }
            if (j < queries.length) {
                // Position j matched
                if (queries[j].isProjection()) {
                    projValue = singleton(queries[j].execute([value], undefined, undefined, undefined, undefined));
                    while (projValue === undefined && j < queries.length) {
                        if (queries[j].isProjection()) {
                            projValue = singleton(queries[j].execute([value], undefined, undefined, undefined, undefined));
                        }
                    }
                    key[i] = {
                        value: projValue === undefined?
                            (compElt.unmatched === -1 || j < compElt.unmatched? j: j + 1):
                            singleton(projValue),
                        type: projValue === undefined? "number": typeof(projValue)
                    };
                } else if (compElt.orderByValue) {
                    var type: string = typeof(value);
                    key[i] = {
                        value: type === "string"?
                               value.toLocaleLowerCase(): value,
                        type: type
                    };
                    break; // leave the rest undefined
                } else {
                    // c(query_1, query_2, ...)
                    key[i] = {
                        value:
                            compElt.unmatched === -1 || j < compElt.unmatched?
                            j: j + 1,
                        type: "number"
                    };
                }
            } else {
                // No match with a query
                if (compElt.orderByValue || compElt.unmatched === -1) {
                    // Place at the end
                    key[i] = {
                        value: undefined,
                        type: "undefined"
                    };
                } else {
                    key[i] = {
                        value: compElt.unmatched,
                        type: "number"
                    };
                }
            }
        }
        return key;
    }

    // OrderingResultWatcherInterface

    refreshIndexerAndPaths(tag: any, dataObj: FuncResult): void {
        this.sortQuery.updateIndexerMonitoringForDominatedPath();
        this.markAsChanged();
    }

    replaceIndexerAndPaths(tag: any, prevPrefixPathId: number,
                           prefixPathId: number, dataObj: FuncResult): void {
        this.sortQuery.updateIndexerMonitoringForDominatedPath();
        this.markAsChanged();
    }

    updateDataElementPosition(elementIds: number[], firstOffset: number,
                              lastOffset: number, setSize: number): void {
        this.markAsChanged();
    }
}

/// This evaluation node is data soure aware. If its data contains a dataSource
/// field, it applies an ordering query; if it doesn't it deletes the ordering
/// query. If there is a data source, dataSourceResultMode determines whether
/// ...
abstract class EvaluationPositionFunction extends EvaluationFunctionApplication
    implements OrderingResultWatcherInterface
{
    /// The actual ordering query
    orderingQuery: DataSourceOrdering = undefined;
    // Interface to positioning when converting result to javascript
    orderingResultWatcher: OrderingResultWatcher = undefined;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.dataSourceAware = true;
        this.dataSourceResultMode = true;
        this.result.value = emptyDataSourceResult;
    }

    destroy(): void {
        this.unsetQuery();
        super.destroy();
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.arguments[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, true, true, i === 1);
        }
        if (i === 0) {
            if (this.inputs[1] !== undefined) {
                this.setQuery(evalNode.result);
            }
        } else {
            this.setArgument(evalNode.result);
        }
    }

    abstract updateInput(i: any, result: Result): void;

    /// Sets the ordering query
    setQuery(q: any): void {
        if (this.inputs[1] !== undefined &&
              ("dataSource" in this.inputs[1].result || "dataSource" in this.result) &&
              (this.inputs[1].isScheduled() || !this.inputs[1].isActive())) {
            // Wait with changing datasources until input has been updated
            this.inputs[1].addForcedUpdate(this);
        } else if (this.inputs[1] !== undefined && "dataSource" in this.inputs[1].result) {
            this.setDataSourceOrderingQuery(q, this.inputs[1].result.dataSource);
        } else {
            if (this.dataSourceInput !== undefined) {
                this.releaseDataSourceInput();
            }
            this.markAsChanged();
        }
    }

    unsetQuery(): void {
        if (this.dataSourceInput !== undefined) {
            this.releaseDataSourceInput();
        }
    }

    setDataSourceOrderingQuery(q: any, dataSource: DataSourceComposable): void {
        if (this.dataSourceInput === dataSource) {
            this.orderingQuery.updateOrdering(q);
        } else {
            if (this.orderingResultWatcher !== undefined) {
                this.orderingResultWatcher.destroy();
            }
            if (this.dataSourceInput !== undefined) {
                this.dataSourceInput.removeOrderingApplication(this.orderingQuery);
                this.orderingQuery.removeResultReceiver(this);
            }
            // Register the query on the new input
            this.orderingQuery = dataSource.applyOrdering(q, this);
            this.dataSourceInput = dataSource;
            if (!this.dataSourceResultMode) {
                this.orderingResultWatcher =
                    new OrderingResultWatcher(globalInternalQCM, this, undefined);
                this.orderingResultWatcher.init(this.orderingQuery);
                if (this.isActive()) {
                    this.orderingResultWatcher.activate();
                }
                this.orderingQuery.updateIndexerMonitoringForDominatedPath();
            }
            this.markAsChanged(); // pass on the changed dataSource
        }
    }

    releaseDataSourceInput(): void {
        if (this.orderingResultWatcher !== undefined) {
            this.orderingResultWatcher.destroy();
            this.orderingResultWatcher = undefined;
        }
        this.dataSourceInput.removeOrderingApplication(this.orderingQuery);
        this.orderingQuery.removeResultReceiver(this);
        this.orderingQuery = undefined;
        this.dataSourceInput = undefined;
        this.markAsChanged();
    }

    // Counts the number of changes to the query output. 
    queryUpdateCounter: number = 0;
    // Last change count when data was extracted
    counterAtLastExtraction: number = -1;

    extractDataSourceResult(): boolean {
        var oldValue: any[] = this.result.value;
        var res: any[] = this.orderingQuery.extractData(
            MinimumResultRequirements.ordered, this.orderingResultWatcher);
        var hadDataSource: boolean = "dataSource" in this.result;

        this.counterAtLastExtraction = this.queryUpdateCounter;
        this.result.value = res;
        if (hadDataSource) {
            delete this.result.dataSource;
        }
        return hadDataSource || !valueEqual(oldValue, res);
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.dataSourceInput !== undefined) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                if (this.orderingResultWatcher !== undefined) {
                    this.orderingResultWatcher.destroy();
                    this.orderingResultWatcher = undefined;
                }
                if (this.result !== undefined) {
                    this.result.value = emptyDataSourceResult;
                }
                this.orderingQuery.stopIndexerMonitoring();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                this.orderingResultWatcher =
                    new OrderingResultWatcher(globalInternalQCM, this, undefined);
                this.orderingResultWatcher.init(this.orderingQuery);
                if (this.isActive()) {
                    this.orderingResultWatcher.activate();
                }
                this.orderingQuery.updateIndexerMonitoringForDominatedPath();
                this.markAsChanged();
            }
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    setArgument(result: Result): void {
        if (this.arguments[0] !== undefined) {
            this.setQuery(this.arguments[0].value);
        }
    }

    eval(): boolean {
        var oldValue: any = this.result.value;
        var change: boolean = false;

        if (this.dataSourceInput !== undefined) {
            if (this.dataSourceResultMode) {
                // Update is propagated via the data source application chain
                if (this.result.dataSource !== this.orderingQuery) {
                    // Pass the ordering query on as a data source
                    this.result.dataSource = this.orderingQuery;
                    this.result.value = emptyDataSourceResult;
                    return true;
                }
                return false;
            } else {
                return this.extractDataSourceResult();
            }
        } else if ("dataSource" in this.result) {
            delete this.result.dataSource;
            change = true;
        }
        this.execute();
        return change || !valueEqual(oldValue, this.result.value);
    }

    deactivateInputs(): void {
        if (this.orderingQuery !== undefined) {
            this.orderingQuery.stopIndexerMonitoring();
        }
        super.deactivateInputs();
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var selectedPositions: DataPosition[] = 
            this.getSelectedPositions(positions);

        if (selectedPositions.length === 0) {
            this.reportDeadEndWrite(reportDeadEnd,
                                    "empty selection by " + this.bif.name);
            return false;
        }
        return this.getWritableInput().write(result, mode, attributes, selectedPositions, reportDeadEnd);
    }

    // Performs the actual position function.
    abstract execute(): void;

    // Returns the writable node. Implemented in derived class.
    getWritableInput(): EvaluationNode {
        return undefined;
    }

    // Returns the writable position. Implemented in derived class.
    // Note that undefined means: all.
    getSelectedPositions(positions: DataPosition[]): DataPosition[] {
        Utilities.warn("dead-ended write: derived class doesn't implement write at " + gWriteAction);
        return [];
    }

    // OrderingResultWatcherInterface

    reextractData(): void {
        this.markAsChanged();
    }

    refreshIndexerAndPaths(tag: any, dataObj: FuncResult): void {
        this.orderingQuery.updateIndexerMonitoringForDominatedPath();
        this.markAsChanged();
    }

    replaceIndexerAndPaths(tag: any, prevPrefixPathId: number,
                           prefixPathId: number, dataObj: FuncResult): void {
        this.orderingQuery.updateIndexerMonitoringForDominatedPath();
        this.markAsChanged();
    }

    updateDataElementPosition(elementIds: number[], firstOffset: number,
                              lastOffset: number, setSize: number): void {
        this.markAsChanged();
    }
}

class EvaluationPFFirst extends EvaluationPositionFunction {

    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
        if (result === undefined) {
            this.unsetQuery();
        } else {
            this.setArgument(result);
        }
    }

    setQuery(q: any): void {
        if (this.inputs[0] !== undefined && "dataSource" in this.inputs[0].result) {
            this.setDataSourceOrderingQuery(new RangeValue([0], true, true), this.inputs[0].result.dataSource);
        } else {
            if (this.dataSourceInput !== undefined) {
                this.releaseDataSourceInput();
            }
            this.markAsChanged();
        }
    }

    execute(): void {
        if (this.arguments.length !== 1 ||
              this.arguments[0].value === undefined) {
            this.result.set(constEmptyOS);
            return;
        }
        var os: any[] = this.arguments[0].value;
        var identifiers: any[] = this.arguments[0].identifiers;
        assert(os instanceof Array, "argument not os");
        this.result.value = os.length === 0? []: [os[0]];
        if (identifiers !== undefined) {
            this.result.identifiers = identifiers.slice(0, os.length);
        } else if ("identifiers" in this.result) {
            delete this.result.identifiers;
        }
    }

    getWritableInput(): EvaluationNode {
        return this.inputs[0];
    }

    getSelectedPositions(positions: DataPosition[]): DataPosition[] {
        if (this.arguments.length !== 1 ||
              this.arguments[0].value === undefined) {
            Utilities.warn("dead-ended write: undefined or wrong argument at " + gWriteAction);
            return [];
        }
        if (positions !== undefined &&
              (positions.length !== 1 || positions[0].index !== 0 || positions[0].length !== 1)) {
            Utilities.warn("dead-ended write: cannot write through first at " + gWriteAction);
            return [];
        }
        var os: any[] = this.arguments[0].value;
        return os.length === 0? []:
            positions === undefined? [new DataPosition(0, 1)]:
            positions;
    }
}
first.classConstructor = EvaluationPFFirst;

class EvaluationPFLast extends EvaluationPositionFunction {

    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
        if (result === undefined) {
            this.unsetQuery();
        } else {
            this.setArgument(result);
        }
    }

    setQuery(q: any): void {
        if (this.inputs[0] !== undefined && "dataSource" in this.inputs[0].result) {
            this.setDataSourceOrderingQuery(new RangeValue([-1], true, true), this.inputs[0].result.dataSource);
        } else {
            if (this.dataSourceInput !== undefined) {
                this.releaseDataSourceInput();
            }
            this.markAsChanged();
        }
    }

    execute(): void {
        if (this.arguments.length !== 1 ||
              this.arguments[0].value === undefined) {
            this.result.set(constEmptyOS);
            return;
        }
        var os: any[] = this.arguments[0].value;
        var inputIdentifiers: any[] = this.arguments[0].identifiers;
        assert(os instanceof Array, "argument not os");
        this.result.value = os.length === 0? []: [os[os.length - 1]];
        if (inputIdentifiers !== undefined) {
            this.result.identifiers = os.length === 0? []: inputIdentifiers.slice(-1);
        } else if ("identifiers" in this.result) {
            delete this.result.identifiers;
        }
    }

    getWritableInput(): EvaluationNode {
        return this.inputs[0];
    }

    getSelectedPositions(positions: DataPosition[]): DataPosition[] {
        if (this.arguments.length !== 1 ||
              this.arguments[0].value === undefined) {
            Utilities.warn("dead-ended write: undefined or wrong argument at " + gWriteAction);
            return [];
        }
        if (positions !== undefined &&
              (positions.length !== 1 || positions[0].index !== 0 || positions[0].length !== 1)) {
            Utilities.warn("dead-ended write: cannot write through last at " + gWriteAction);
            return [];
        }
        var os: any[] = this.arguments[0].value;
        return os.length === 0? []:
            positions === undefined? [new DataPosition(os.length - 1, 1)]:
            [new DataPosition(os.length - 1, 1, positions[0].path, positions[0].sub)];
    }
}
last.classConstructor = EvaluationPFLast;

class EvaluationPFPos extends EvaluationPositionFunction {
    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
        if (result === undefined) {
            this.unsetQuery();
        } else if (i === 0) {
            this.setQuery(result.value);
        } else {
            this.setArgument(result);
        }
    }

    execute(): void {
        // Converts a range in lower/upperbound
        function rangeToPositions(r: RangeValue): number[] {
            var l = r.min, m = r.max;
            if (l < 0) l += os.length;
            if (m < 0) m += os.length;
            if (l > m) {
                var tmp: number = m;
                m = l;
                l = tmp;
            }
            if (!r.closedLower)
                l++;
            if (!r.closedUpper)
                m--;
            if (m >= os.length)
                m = os.length - 1;
            return [l, m];
        }
        if (this.arguments.length !== 2 ||
              this.arguments[0].value === undefined ||
              this.arguments[1].value === undefined) {
            this.result.set(constEmptyOS);
            return;
        }
        var positions: any[] = this.arguments[0].value;
        var os: any[] = this.arguments[1].value;
        var identifiers: any[] = this.arguments[0].identifiers;
        assert(positions instanceof Array && os instanceof Array, "argument not os");
        var res: any[] = [];
        var ids: any[] = identifiers === undefined? undefined: [];
        for (var i: number = 0; i < positions.length; i++) {
            var p: any = positions[i];
            if (p instanceof RangeValue) {
                var bounds = rangeToPositions(p);
                Array.prototype.push.apply(res, os.slice(bounds[0], bounds[1] + 1));
                if (identifiers !== undefined) {
                    Array.prototype.push.apply(ids, identifiers.slice(bounds[0], bounds[1] + 1));
                }
            } else if (typeof(p) === "number") {
                if (-os.length <= p && p < os.length) {
                    res.push(p < 0? os[os.length + p]: os[p]);
                    if (identifiers !== undefined) {
                        ids.push(p < 0? identifiers[os.length + p]: identifiers[p]);
                    }
                }
            } else {
                console.error("not a position:", p);
            }
        }
        this.result.value = res;
        this.result.setIdentifiers(ids);
    }

    getWritableInput(): EvaluationNode {
        return this.inputs[1];
    }

    getSelectedPositions(positions: any): DataPosition[] {
        if (this.arguments.length !== 2 ||
              this.arguments[0].value === undefined ||
              this.arguments[1].value === undefined) {
            Utilities.warn("dead-ended write: undefined or wrong argument at " + gWriteAction);
            return [];
        }
        if (positions !== undefined && positions.length !== 1) {
            Utilities.warn("dead-ended write: cannot write through pos at " + gWriteAction);
            return [];
        }
        var posarg: any[] = this.arguments[0].value;
        var osLength: number = this.arguments[1].size();
        var selectedPositions: DataPosition[] = [];
        for (var i: number = 0; i < posarg.length; i++) {
            var p: any = posarg[i];
            var index: number, length: number;
            if (p instanceof RangeValue) {
                var r = <RangeValue> p;
                var l = r.min, m = r.max;
                if (l < 0) l += osLength;
                if (m < 0) m += osLength;
                index = l < m? l: m;
                length = l < m? m - l + 1: l - m + 1;
            } else if (p >= -osLength) {
                index = p < 0? osLength + p: p;
                length = 1;
            } else {
                Utilities.warn("dead-ended write: cannot write through pos at " + gWriteAction);
                return [];
            }
            if (positions === undefined) {
                selectedPositions.push(new DataPosition(index, length));
            } else {
                selectedPositions.push(
                    new DataPosition(positions[0].index + index, 
                                     positions[0].length,
                                     positions[0].path, positions[0].sub));
            }
        }
        return selectedPositions;
    }
}
pos.classConstructor = EvaluationPFPos;

/**
 * This class implements EvaluationNode not for evaluating, but for giving a
 * node that can serve as a proxy for dependency on positioning. If a node adds
 * this as an input, it will not be ready until positioning has been completed.
 * Since there is only one positioning, there is only one node of this class.
 * The only use is by [offset].
 * 
 * @class EvaluationPositioningDependency
 * @extends {EvaluationNode}
 */
class EvaluationPositioningDependency extends EvaluationNode {
    // Simulate a scheduled state; -2 is reserved for "scheduled outside the
    // evaluation queue".
    scheduledAtPosition: number = -2;
    isBeingInitialized: boolean = false;

    isReady(): boolean {
        return !globalGeometryTask.isScheduled;
    }

    undefer(): void {
        if (this.awaitingThis !== undefined) {
            var awaitingThis = this.awaitingThis;
            awaitingThis.forEach((ev: Evaluator, key: number): void => {
                ev.undefer();
                evaluationQueue.schedule(ev, false);
            });
            this.awaitingThis = undefined;
        }
    }

    updateInput(id: any, result: Result): void {
    }

    eval(): boolean {
        assert(false, "should not be called");
        return true;
    }
};
var globalPositioningDependency = new EvaluationPositioningDependency(undefined, undefined);

// Behaves like a function application (which it is in the function graph), but
// eval doesn't compute the value directly. Instead, it updates the posPoints.
// Update is done after callback to updateOffsets and once positioning has
// completely finished.
// TODO: Resolve implicit me in PosPair to the area of origin.
class EvaluationOffset extends EvaluationFunctionApplication {
    me: {areaId: string;};
    pairDescription: any = {point1: {}, point2: {}};
    posPair: PosPair;
    labelPairs: {[pairAttr: number]: LabelPairOffset} = {};
    labelPosInOS: {[pairAttr: number]: number} = {};
    nextPairNum: number = 0;
    offsets: {[l1: string]: {[l2: string]: number}} = {};
    offsetValues: number[] = [];
    calledFromEval: boolean = false;
    highPriority: boolean = false;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.me = {areaId: local.getOwnId()};
        this.posPair = undefined;
        this.result.value = constEmptyOS;
        this.startWatching();
    }

    destroy(): void {
        if (this.posPair !== undefined) {
            this.stopWatching();
        }
        super.destroy();
    }

    isConstant(): boolean {
        return false;
    }

    resultIsTransient(): boolean {
        return true;
    }

    startWatching(): void {
        this.posPair = new PosPair(this.me, undefined, this.pairDescription, undefined);
        this.posPair.registerHandler(this);
    }

    stopWatching(): void {
        for (var attr in this.labelPairs) {
            this.labelPairs[attr].destroy();
        }
        this.posPair.destroyPair();
        this.posPair = undefined;
        this.labelPairs = {};
    }

    allInputs(): EvaluationNode[] {
        if (!this.highPriority) {
            this.addPositioningDependency();
        } else {
            this.removePositioningDependency();
        }
        return this.inputs;
    }

    // Create a dependency on the positioning task
    addPositioningDependency(): void {
        if (this.inputs[this.inputs.length - 1] !== globalPositioningDependency) {
            // Create a dependency on the positioning task
            this.inputs.push(globalPositioningDependency);
            if (this.isActive()) {
                globalPositioningDependency.activate(this, false);
            }
        }
    }

    removePositioningDependency(): void {
        if (this.inputs[this.inputs.length - 1] === globalPositioningDependency) {
            if (this.isActive()) {
                globalPositioningDependency.deactivate(this, false);
            }
            this.inputs.pop();
            if (this.deferred) {
                this.undefer();
            }
        }
    }

    markAsChanged(): void {
        if (this.highPriority || globalPositioningDependency.isReady()) {
            super.markAsChanged();
        } else {
            this.inputHasChanged = true;
            if (!this.deferred) {
                if (this.isScheduled()) {
                    evaluationQueue.unschedule(this);
                }
                this.defer();
            }
        }
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        explanation["_id"] = this.prototype.idStr();
        explanation["_result"] = this.result !== undefined && !this.result.hasLabels()?
            this.result.value: this.result;
        explanation["_active"] = this.nrActiveWatchers;
        if (!ignoreInputs && this.inputs !== undefined) {
            for (var i: number = 0; i !== this.inputs.length; i++) {
                if (this.inputs[i] !== undefined && this.inputs[i] !== globalPositioningDependency) {
                    explanation[i + ": " + this.inputs[i].debugName()] =
                        this.inputs[i].explain(undefined);
                }
            }
        }
        if (gProfile) {
            explanation["_attributedTime"] = this.totalAttributedTime;
        }
        return explanation;
    }

    // activateInputs(): void {
    //     assert(this.posPair === undefined, "wrong");
    //     super.activateInputs();
    //     this.startWatching();
    // }

    eval(): boolean {
        var change: boolean = false;
        var pt1: any = stripArray(this.arguments[0].value, true);
        var pt2: any = stripArray(this.arguments[1].value, true);
        var highPriority: boolean = this.arguments[2] !== undefined &&
                                    isTrue(this.arguments[2].value);

        if (!objectEqual(pt1, this.pairDescription.point1)) {
            this.pairDescription.point1 = pt1;
            change = true;
        }
        if (!objectEqual(pt2, this.pairDescription.point2)) {
            this.pairDescription.point2 = pt2;
            change = true;
        }
        if (this.highPriority !== highPriority) {
            this.highPriority = highPriority;
            change = true;
        }
        if (change) {
            this.calledFromEval = true;
            this.posPair.newDescription(this.pairDescription);
            this.calledFromEval = false;
            if (highPriority) {
                this.removePositioningDependency();
                runGeometry();
            }
            globalGeometryTask.schedule();
        }
        if (!this.deferred &&
              !valueEqual(this.offsetValues, this.result.value)) {
            this.result.value = this.offsetValues.slice(0);
            return true;
        }
        return false;
    }

    // deactivateInputs(): void {
    //     assert(this.posPair !== undefined, "wrong");
    //     super.deactivateInputs();
    //     this.stopWatching();
    // }

    // Callback from PosPair
    call(unused: any, posPair: PosPair, name: any): void {
        var recalcPosition: boolean = false;

        for (var l1 in this.posPair.changes) {
            var changesL1: {[l2: string]: string} = this.posPair.changes[l1]; 
            for (var l2 in changesL1) {
                if (changesL1[l2] == "added") {
                    if (this.addPair(l1, l2)) {
                        recalcPosition = true;
                    }
                } else {
                    this.removePair(l1, l2);
                }
            }
        }
        // If the positioning needs to be recalculated (i.e., offset is not
        // known), delay that until it is really needed, indicated by the flag
        // gPosRefreshNeeded. Currently, the function globalPosRefresh() is
        // called when the flag is set before evaluation of the to and merge of
        // a write clause and at the end of a priority queue (i.e., when all
        // nodes of priority 1 have been done, or when all nodes of priority 0
        // have been done).
        if (recalcPosition) {
            if (this.highPriority) {
                runGeometry();
            }
            globalGeometryTask.schedule();
            if (!this.highPriority && this.inputHasChanged && !this.deferred) {
                if (this.isScheduled()) {
                    evaluationQueue.unschedule(this);
                }
                this.defer();
            }
        } else {
            this.markAsChanged();
        }
    }

    addPair(label1: string, label2: string): boolean {
        var shouldRecalc: boolean = false;
        var pairNum: number = this.addOffset(label1, label2);

        if (!(pairNum in this.labelPairs)) {
            // a new pair - request positioning to calculate its offset
            var labelPairOffset = new LabelPairOffset(this, pairNum, label1, label2);
            this.labelPairs[pairNum] = labelPairOffset;
            // get its current offset (if possible)
            var offset: number = labelPairOffset.get();
            if (offset === undefined) {
                // The queues are empty, so we can ask for the value
                // directly. If the value is unknown, we get an undefined.
                offset = globalPos.posCalc.getCurrentValue(label1, label2);
            }
            this.addToOutput(pairNum, offset);
            shouldRecalc = offset === undefined;
        }
        return shouldRecalc;
    }

    removePair(l1: string, l2: string): void {
        assert(l1 in this.offsets, "l1");
        var l1Offsets: {[l2: string]: number} = this.offsets[l1];
        assert(l2 in l1Offsets, "l2");
        var pairNum: number = l1Offsets[l2];

        delete l1Offsets[l2];
        this.removeFromOutput(pairNum);
        assert(pairNum in this.labelPairs, "pairNum");
        var labelPair = this.labelPairs[pairNum];
        labelPair.destroy();
        delete this.labelPairs[pairNum];
        if (Utilities.isEmptyObj(l1Offsets)) {
            delete this.offsets[l1];
        }
    }

    addOffset(l1: string, l2: string): number {
        var l1Offsets: {[l2: string]: number};

        if (l1 in this.offsets) {
            l1Offsets = this.offsets[l1];
        } else {
            l1Offsets = this.offsets[l1] = {};
        }
        var pairNum: number = l1Offsets[l2];
        if (pairNum === undefined) {
            l1Offsets[l2] = pairNum = this.nextPairNum++;
        }
        return pairNum;
    }

    updateOffset(attr: number, label1: string, label2: string, offset: number): void {
        var labelPos: number = this.labelPosInOS[attr];

        offset = offset !== undefined? Math.round(offset * 128) / 128: undefined;
        if (this.offsetValues[labelPos] !== offset) {
            this.offsetValues[labelPos] = offset;
            if (logValues && this.isLogNode()) {
                gSimpleLog.log("offset", this.logValString(), offset,
                            "(" + label1 + ";" + label2 + ")");
            }
            this.markAsChanged();
        }
    }

    addToOutput(attr: number, offset: number) {
        var labelPos: number;

        offset = offset !== undefined? Math.round(offset * 128) / 128: undefined;
        if (!(attr in this.labelPosInOS)) {
            this.labelPosInOS[attr] = labelPos = this.offsetValues.length;
        } else {
            labelPos = this.labelPosInOS[attr];
        }
        if (this.offsetValues[labelPos] !== offset) {
            this.offsetValues[labelPos] = offset;
            if (!this.calledFromEval) {
                this.markAsChanged();
            } else if (this.deferred) {
                this.undefer();
            }
        }
    }

    removeFromOutput(attr: number) {
        var labelPos: number = this.labelPosInOS[attr];

        assert(labelPos !== undefined, "debugging");
        delete this.labelPosInOS[attr];
        this.offsetValues.splice(labelPos, 1);
        for (var remAttr in this.labelPosInOS) {
            if (this.labelPosInOS[remAttr] > labelPos) {
                this.labelPosInOS[remAttr]--;
            }
        }
        if (!this.calledFromEval) {
            this.markAsChanged();
        }
    }

    debugName(): string {
        return "offset";
    }
}
offset.classConstructor = EvaluationOffset;

// Implements [overlap, [pointer], osOfAreas] (and [overlap, osOfAreas,
// [pointer]]). Will give wrong results when both arguments are regular
// sets of areas.
class EvaluationOverlap extends EvaluationFunctionApplication {

    nrOverlapping: number = 0;
    watchedAreas: {[areaId: string]: boolean} = {};

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constFalseOS;
    }

    updateInput(pos: any, result: Result): void {
        if (this.result === undefined) {
            return;
        }
        if (pos === 0 || pos === 1) { // argument update
            if (result === undefined || result.value === undefined) {
                this.setAreas(constEmptyOS);
            } else {
                this.setAreas(result.value);
            }
        } else if (result !== undefined || pos in this.watchedAreas) {
            // update from areaOverlapMonitor; ignore destruction message
            // when areaId has not yet been registered
            var newOverlap: boolean = result !== undefined && result.value[0];
            if ((pos in this.watchedAreas && this.watchedAreas[pos]) !== newOverlap) {
                if (newOverlap) {
                    this.incrCount();
                } else {
                    this.decrCount();
                }
                this.watchedAreas[pos] = newOverlap;
            }
        }
    }

    isConstant(): boolean {
        return false;
    }

    eval(): boolean {
        return true;
    }

    setAreas(areaIds: any[]): void {
        var res: Result;
        var areaId: string;

        function isPointerAreaRef(v: any): boolean {
            if (v instanceof ElementReference) {
                return v.element === EFPointer.res[0].element;
            }
            return false;
        }

        if (areaIds.length === 1 && isPointerAreaRef(areaIds[0])) {
            return;
        }
        var newWatchedAreas: {[areaId: string]: boolean} = {};
        for (var i: number = 0; i < areaIds.length; i++) {
            if (!isPointerAreaRef(areaIds[i])) {
                areaId = areaIds[i].element;
                if (!(areaId in this.watchedAreas)) {
                    res = areaOverlapMonitor.addWatcherFor(areaId, this, areaId);
                    newWatchedAreas[areaId] = res.value[0];
                    if (res.value[0]) {
                        this.incrCount();
                    }
                } else {
                    newWatchedAreas[areaId] = this.watchedAreas[areaId];
                }
            } else {
                Utilities.warn("EvaluationOverlap: [pointer] mixed with other areas");
            }
        }
        for (areaId in this.watchedAreas) {
            if (!(areaId in newWatchedAreas)) {
                if (this.watchedAreas[areaId]) {
                    this.decrCount();
                }
                delete this.watchedAreas[areaId];
            }
        }
        this.watchedAreas = newWatchedAreas;
    }

    incrCount(): void {
        this.nrOverlapping++;
        if (this.nrOverlapping === 1) {
            this.result.value = constTrueOS;
            this.markAsChanged();
        }
    }

    decrCount(): void {
        this.nrOverlapping--;
        assert(this.nrOverlapping >= 0, "too many decrCount()");
        if (this.nrOverlapping === 0) {
            this.result.value = constFalseOS;
            this.markAsChanged();
        }
    }

    removeAsWatcher(): void {
        super.removeAsWatcher();
        for (var areaId in this.watchedAreas) {
            areaOverlapMonitor.removeWatcherFor(areaId, this);
        }
    }
}
overlap.classConstructor = EvaluationOverlap;

class EvaluationTime extends EvaluationFunctionApplication {

    lastInput: any = undefined;
    lastChangeTime: number = 0;
    interval: number = 1000;
    maxTime: number = 0;
    startCounting: boolean = true;
    timerId: number|NodeJS.Timer = undefined;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = [0];
    }

    updateInput(pos: any, result: Result): void {
        var v: any = result === undefined? undefined: result.value;
        
        switch (pos) {
          case 0:
            if (!objectEqual(this.lastInput, v)) {
                this.lastInput = v;
                this.markAsChanged();
            }
            break;
          case 1:
            v = getDeOSedValue(v);
            if (typeof(v) === "number" && v > 0) {
                v *= 1000;
            } else {
                v = 0;
            }
            if (this.interval !== v) {
                this.interval = v;
                this.markAsChanged();
            }
            if (this.inputs.length === 2 && this.maxTime !== v) {
                this.maxTime = v;
                this.markAsChanged();
            }
            break;
          case 2:
            v = getDeOSedValue(v);
            if (typeof(v) === "number" && v > 0) {
                v *= 1000;
            } else {
                v = 0;
            }
            if (this.maxTime !== v) {
                this.maxTime = v;
                this.markAsChanged();
            }
            break;
        }
    }

    markAsChanged(): void {
        this.startCounting = true;
        super.markAsChanged();
    }

    eval(): boolean {
        var nTime: number = 0;

        if (this.startCounting) {
            this.lastChangeTime = Date.now();
            this.startCounting = false;
            if (this.timerId !== undefined) {
                clearInterval(<any> this.timerId);
            }
            if (this.interval > 0 && this.maxTime > 0) {
                this.timerId = setInterval(() => this.updateTimer(), this.interval);
            }
            nTime = 0;
        } else {
            nTime = (Date.now() - this.lastChangeTime) / 1000;
        }
        if (nTime !== this.result.value[0]) {
            this.result.value = [nTime];
            return true;
        }
        return false;
    }

    updateTimer(): void {
        super.markAsChanged();
        if (Date.now() - this.lastChangeTime >= this.maxTime) {
            clearInterval(<any> this.timerId);
            this.timerId = undefined;
        }
    }

    isConstant(): boolean {
        return false;
    }

}
time.classConstructor = EvaluationTime;

// If the input of this node changes, it sets its output to true. At the end of
// the evaluation cycle, it returns back to false. The change is recorded with
// respect to the input at end of the last cycle.
// This node never gets scheduled the normal way, but informs its watchers
// directly from the pre-write notification.
class EvaluationChanged extends EvaluationFunctionApplication implements TimeSensitive {

    lastInput: any = undefined;
    currentInput: any = undefined;
    falseNotified: boolean = true; // initially, yes
    status: boolean = false;
    isOnTimeQueue: boolean = false;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constFalseOS;
    }

    destroy(): void {
        evaluationQueue.removeTimeSensitiveNode(this);
        super.destroy();
    }

    updateInput(pos: any, result: Result): void {
        this.currentInput = result === undefined? undefined: result.value;
        evaluationQueue.addTimeSensitiveNode(this);
        this.markAsChanged();
    }

    eval(): boolean {

        if(!this.falseNotified) {
            this.falseNotified = true;
            return true;
        }
        
        var status: boolean = !objectEqual(this.lastInput, this.currentInput); 

        this.inputHasChanged = false;
        if (status !== this.status) {
            this.status = status;
            this.result.set(status? constTrueOS: constFalseOS);
            return true;
        }
        return false;
    }
    
    public preWriteNotification(cycle: number): void {
    }

    endOfEvaluationCycleNotification(cycle: number): void {
        
        if(this.status) {
            this.lastInput = this.currentInput;
            this.status = false;
            this.result.set(constFalseOS);
            this.falseNotified = false;
            evaluationQueue.addTimeSensitiveNode(this);
            this.markAsChanged();
        } else if(!objectEqual(this.lastInput, this.currentInput) &&
                  this.nrActiveWatchers > 0) {
            evaluationQueue.addTimeSensitiveNode(this);
            this.markAsChanged();
        }
    }

    isConstant(): boolean {
        return false;
    }
}
changed.classConstructor = EvaluationChanged;

function mapElementReferenceArrayToObject(arr: ElementReference[]): {[areaId: string]: ElementReference} {
    var res: {[areaId: string]: ElementReference} = {};

    for (var i: number = 0; i < arr.length; i++) {
        res[arr[i].element] = arr[i];
    }
    return res;
}

// An incremental update aware implementation of [a, b], where a and b are both
// an os of area references. The result is the intersection of both os'es.
// Bug: order of data is not respected.
// Subtle bug: it is not known from what the position of added or removed data
// is. Therefore, the result cannot be updated properly when an area reference
// occurs more than once in the data.  It is not likely to happen though, since
// it's unusual to have the same area reference multiple times in an os.
class EvaluationCompareAreasQuery extends EvaluationFunctionApplication {

    // These three are always in sync
    queryAreaIds: {[areaId: string]: number} = {};
    dataAreaIds: {[areaId: string]: number} = {};
    resultAreaIds: {[areaId: string]: number} = {};
    needsFullUpdate: boolean = false;
    incrementalResult: ElementReference[] = [];
    needsSort: boolean = false;

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.arguments[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, false, true, false);
        }
        this.updateInput(i, evalNode.result);
    }

    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
        if (this.nrActiveWatchers > 0) {
            if (i === 0) {
                this.updateQuery(result);
            } else {
                this.updateData(result);
            }
        } else {
            this.needsFullUpdate = true;
            this.markAsChanged();
        }
    }

    updateQuery(result: Result): void {
        if (!this.needsFullUpdate && result.incremental) {
            this.updateResult(this.queryAreaIds, this.dataAreaIds, result.added, result.removed);
        } else {
            this.needsFullUpdate = true;
            this.markAsChanged();
        }
    }

    updateData(result: Result): void {
        if (!this.needsFullUpdate && result.incremental) {
            this.updateResult(this.dataAreaIds, this.queryAreaIds, result.added, result.removed);
            if (result.added.length > 0 || result.removed.length === 0) {
                // When added and removed are both empty, there has been a
                // change of order; when added isn't empty, sort is needed too.
                this.needsSort = true;
                this.markAsChanged();
            }
        } else {
            this.needsFullUpdate = true;
            this.markAsChanged();
        }
    }

    // Using the symmetry of [o(a_1, a_2, ...), o(b_1, b_2, ...)] ===
    // [o(b_1, b_2, ...), o(a_1, a_2, ...)]. Note that we ignore modified.
    updateResult(A: {[areaId: string]: number}, B: {[areaId: string]: number}, added: any[], removed: any[]): void {
        var m: any, areaId: string;
        var change: boolean = false;
        var toRemove: string[] = undefined;

        for (var i: number = 0; i < removed.length; i++) {
            m = removed[i];
            if (m instanceof ElementReference) {
                areaId = m.element;
                if (areaId in A) {
                    A[areaId]--;
                    if (A[areaId] === 0) {
                        if (areaId in B) {
                            if (toRemove === undefined) {
                                toRemove = [areaId];
                            } else {
                                toRemove.push(areaId);
                            }
                        }
                        delete A[areaId];
                    }
                }
            }                
        }
        if (toRemove !== undefined) {
            change = true;
            this.removeFromResult(toRemove);
        }
        for (var i: number = 0; i < added.length; i++) {
            m = added[i];
            if (m instanceof ElementReference) {
                areaId = m.element;
                if (areaId in A) {
                    A[areaId]++;
                } else {
                    if (areaId in B) {
                        this.addToResult(areaId, m);
                        change = true;
                    }
                    A[areaId] = 1;
                }
            }                
        }
        if (change) {
            this.markAsChanged();
        }
    }

    addToResult(areaId: string, v: ElementReference): void {
        assert(!(areaId in this.resultAreaIds), "bad update");
        this.resultAreaIds[areaId] = this.incrementalResult.length;
        this.incrementalResult.push(v);
    }

    removeFromResult(areaIds: string[]): void {
        var resultAreaIds: {[areaId: string]: number} = this.resultAreaIds;
        var positions: number[] = areaIds.map(function(areaId: string): number {
            return resultAreaIds[areaId];
        }).sort(function(a: number, b: number): number { return a - b; });

        assert(positions.length > 0, "bad update");
        for (var i: number = positions.length - 1; i >= 0; i--) {
            var pos: number = positions[i];
            assert(pos < this.incrementalResult.length, "bad update");
            var areaId: string = this.incrementalResult[pos].element;
            delete this.resultAreaIds[areaId];
            this.incrementalResult.splice(pos, 1);
        }
        for (var i: number = positions[0]; i < this.incrementalResult.length; i++) {
            this.resultAreaIds[this.incrementalResult[i].element] = i;
        }
    }

    eval(): boolean {
        if (!this.needsFullUpdate) {
            this.result.value = this.incrementalResult.slice(0);
            if (this.needsSort) {
                this.sort(this.result.value);
                this.needsSort = false;
            }
            return true;
        }

        var oldValue: any = this.result.value;
        var query: any[] = this.arguments[0].value,
            data: any[] = this.arguments[1].value;
        var res: ElementReference[] = [];
        var areaId: string;
        this.queryAreaIds = {};
        this.dataAreaIds = {};
        this.resultAreaIds = {};
        if (query !== undefined) {
            assert(query instanceof Array, "argument not os");
            for (var i: number = 0; i !== query.length; i++) {
                var m: any = query[i];
                if (m instanceof ElementReference) {
                    areaId = m.element;
                    if (areaId in this.queryAreaIds) {
                        this.queryAreaIds[areaId]++;
                    } else {
                        this.queryAreaIds[areaId] = 1;
                    }
                }
            }
        }
        if (data !== undefined) {
            assert(data instanceof Array, "argument not os");
            for (var i: number = 0; i !== data.length; i++) {
                var m: any = data[i];
                if (m instanceof ElementReference) {
                    areaId = m.element;
                    if (areaId in this.dataAreaIds) {
                        this.dataAreaIds[areaId]++;
                    } else {
                        this.dataAreaIds[areaId] = 1;
                        if (areaId in this.queryAreaIds) {
                            this.resultAreaIds[areaId] = res.length;
                            res.push(m);
                        }
                    }
                }
            }
        }
        this.needsFullUpdate = false;
        this.needsSort = false;
        this.incrementalResult = res;
        if (valueEqual(oldValue, res)) {
            return false;
        }
        this.result.value = res.slice(0);
        return true;
    }

    sort(refs: ElementReference[]): void {
        var areaIdPosition: {[areaId: string]: number} = {};
        var data: any[] = this.arguments[1].value;

        for (var i: number = 0; i !== data.length; i++) {
            var m: any = data[i];
            if (m instanceof ElementReference) {
                var areaId: string = m.element;
                if (!(areaId in areaIdPosition)) {
                    areaIdPosition[areaId] = i;
                }
            }
        }
        refs.sort((a: ElementReference, b: ElementReference) => {
            return areaIdPosition[a.element] - areaIdPosition[b.element];
        });
    }

    debugName(): string {
        return "compareAreasQuery";
    }

}
compareAreasQuery.classConstructor = EvaluationCompareAreasQuery;

// [displayWidth/displayHeight/baseLineHeight, { modifiers } ]
//
// measure the current area's width/height, assuming the display description
//  is the one currently described by the area, applying the modifications
//  present in the argument's 'display:' section (if one is present).
//
// For text, one may query how wide the area must be to fit the complete text
//  value - the one currently defined by the area, or the one in the argument's
//  display.text.value -if rendered with the resulting display description
//  (e.g. font family/size/weight).
//  If 'width:' is specified in the argument, one may also sensibly query about
//   the height required to render the text assuming that width. displayWidth
//   may also be quried when specifying 'width:', as the actual width may be
//   different (e.g. due to long words that cannot be broken in the
//   configured settings)
//  If width is not specified, [displayHeight] returns the line's height
//
// For images, a simple displayWidth/displayHeight returns the natural image
//  dimensions. Specifying a width or height and asking about the other
//  dimension is interpreted as requesting the value for that dimension that
//  would preserve the original aspect ratio
//
// An EvaluationDisplayOffset is constructed with two arguments:
//  the area's display-description, and an optional argument specifying
//  the modifiers (described above)
//
// The actual surveying work is done by a DisplayOffsetSurveyor. One is created
//  for each unique pair of arguments, identified by their watcherId in 'eval()'
//
//
class EvaluationDisplayOffset extends EvaluationFunctionApplication {
    surveyor: DisplayOffsetSurveyor;
    me: string; // areaId

    // last survey result, as notified by surveyor
    surveyorResult: number = undefined;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.me = local.getEvaluationArea().getAreaId();
        this.result.value = constEmptyOS;
    }

    destroy(): void {
        this.releaseSurveyor();
        super.destroy();
    }

    // super-class handling, plus mark 'updateSurveyor' as true
    updateInput(i: number, result: Result) : void {
        if (result === undefined) {
            // Node will be removed soon; should not evaluate any more.
            this.inputs[i].removeWatcher(this, false, false);
            this.inputs[i] = undefined;
            this.arguments = undefined;
        } else {
            this.arguments[i] = result;
            this.updateSurveyor();
        }
    }

    // Updates the surveyor object when active and all inputs are ready.
    // This can lead to superfluous updates, but rarely.
    updateSurveyor(): void {
        if (this.isActive() &&
              (this.inputs[0] !== undefined && !this.inputs[0].isScheduled()) &&
              (this.inputs.length === 1 || (this.inputs[1] !== undefined && !this.inputs[1].isScheduled()))) {
            this.updateOffsets();
        }
    }

    activateInputs(): void {
        super.activateInputs();
        this.updateSurveyor();
    }

    deactivateInputs(): void {
        this.releaseSurveyor();
        super.deactivateInputs();
    }

    eval(): boolean {
        assert(this.arguments[0] instanceof Result,
               "display node must be defined by now");

        var curResult: number = undefined;
        if (this.result && this.result.value instanceof Array) {
            curResult = this.result.value[0];
        }
        if (curResult !== this.surveyorResult) {
            this.result = new Result(this.surveyorResult === undefined ?
                                     undefined : [this.surveyorResult]);
            return true;
        }
        return false;
    }

    // Caches the result of the callback once all resources have been loaded.
    // The key of the cache is the flattened display
    // object (in normalized form) minus attributes that don't influence size
    // (such as color, see suppressedAttributes).
    static cache = new Map<string, { key: string; size: number[];}>();
    // Set of attributes that don't influence measurement.
    static suppressedAttributes: any = {
        text: {
            textAlign: true,
            verticalAlign: true,
            color: true,
            textFillColor: true,
            textStrokeColor: true
        },
        html: {
            textAlign: true,
            verticalAlign: true,
            color: true,
            textFillColor: true,
            textStrokeColor: true,
            handleClick: true
        },
        foreign: true,
        triangle: true,
        line: true,
        arc: true,
        padding: true,
        paddingLeft: true,
        paddingRight: true,
        paddingTop: true,
        paddingBottom: true,
        boxShadow: true,
        background: true,
        borderRadius: true,
        borderTopLeftRadius: true,
        borderTopRightRadius: true,
        borderBottomLeftRadius: true,
        borderBottomRightRadius: true,
        borderStyle: true,
        borderColor: true,
        borderLeftStyle: true,
        borderLeftColor: true,
        borderRightStyle: true,
        borderRightColor: true,
        borderTopStyle: true,
        borderTopColor: true,
        borderBottomStyle: true,
        borderBottomColor: true,
        opacity: true,
        viewOpacity: true,
        transition: true,
        hoverText: true,
        pointerOpaque: true,
        windowTitle: true,
        borderWidth: true,
        borderLeftWidth: true,
        borderRightWidth: true,
        borderTopWidth: true,
        borderBottomWidth: true,
        hideDuringPrinting: true,
        filter: true
    };

    displayString: string = undefined;

    updateOffsets(): void {
        var areaDisplay: Result = this.arguments[0];
        var modifier: Result = this.arguments[1];
        var modObj: any = modifier === undefined? {}: stripArray(modifier.value, true);
        var dispObj: any = shallowCopyMinusTree(
            deOsedMerge(modObj.display, areaDisplay.value),
            EvaluationDisplayOffset.suppressedAttributes);
        var width: number = typeof(modObj.width) === "number"? modObj.width: undefined;
        var height: number = typeof(modObj.height) === "number"? modObj.height: undefined;

        if (isNaN(width)) {
            width = undefined;
        }
        if (isNaN(modObj.height)) {
            height = undefined;
        }
        if (width !== undefined || height !== undefined) {
            // Make sure the cache can distinguish queries made with and without
            // width and height requirements.
            var tagString: string = "";
            if (width !== undefined) {
                tagString += "w" + width;
            }
            if (height !== undefined) {
                tagString += "h" + height;
            }
            dispObj[".tag"] = [tagString];
        }
        this.displayString = cdlifyNormalized(dispObj);
        if (EvaluationDisplayOffset.cache.has(this.displayString)) {
            var cacheValue = EvaluationDisplayOffset.cache.get(this.displayString);
            this.displayString = cacheValue.key; // Saves some memory
            this.surveyNotification(true, cacheValue.size);
            return;
        }
        // We need to use a surveyor to get the value for us. Make sure not to
        // register on the same surveyor twice.
        var surveyor = DisplayOffsetSurveyor.getSurveyor(this.displayString, dispObj, modObj);
        if (this.surveyor !== surveyor) {
            this.releaseSurveyor();
            this.surveyor = surveyor;
            this.surveyor.register(this);
        }
    }

    // called by the surveyor when the values may have changed
    surveyNotification(lastCall: boolean, size: number[]): void {
        var ret: number = this.bif.name === "displayWidth"? size[0]:
                          this.bif.name === "displayHeight"? size[1]:
                          size[2];

        if (ret !== this.surveyorResult) {
            this.surveyorResult = ret;
            this.markAsChanged();
        }
        if (lastCall) {
            this.releaseSurveyor();
            if (!EvaluationDisplayOffset.cache.has(this.displayString)) {
                EvaluationDisplayOffset.cache.set(this.displayString, {
                    key: this.displayString,
                    size: size
                });
            }
        }
    }

    // unregister the surveyor so it does not call us any more
    // (and that it may know that it has become redundant, and be recycled)
    releaseSurveyor(): void {
        if (this.surveyor !== undefined) {
            DisplayOffsetSurveyor.releaseSurveyor(this.surveyor, this);
            this.surveyor = undefined;
        }
    }
}

class EvaluationDisplayWidth extends EvaluationDisplayOffset {
}
displayWidth.classConstructor = EvaluationDisplayWidth;
class EvaluationDisplayHeight extends EvaluationDisplayOffset {
}
displayHeight.classConstructor = EvaluationDisplayHeight;
class EvaluationBaseLineHeight extends EvaluationDisplayOffset {
}
baseLineHeight.classConstructor = EvaluationBaseLineHeight;

//
// DisplayOffsetSurveyor
//
// this class mediates between EvaluationDisplayOffset, which provides the
//  EvaluationNode interface, and SurveyDisplay, which communicates with
//   the browser
//
// DisplayOffsetSurveyors are potentially pulled amongst multiple
//  EvaluationDisplayOffset clients. This is done in an attempt to lower the
//  number of dom elements created for surveys. The same SurveyDisplay can be
//  used for both width and height measurements, and certainly can be used
//  several times if the same area instantiates several calls to a DisplayOffset
//  function with the same 'modifier' argument.
// Pulling is managed by the static methods 'getSurveyor' and 'releaseSurveyor'.
// The static member 'surveyorByDisplay' stores the id->DisplayOffsetSurveyor
//  mapping. It is the responsibility of the calling EvaluationDisplayOffset to
//  construct and use the id's in a consistent manner (it is now the display
//  string that is also used for caching).
//
// Each DisplayOffsetSurveyor thus may have several clients. These are
//  maintained in this.client, indexed by the client's watcher-id (the client is
//  an EvaluationDisplayOffset). this.client is modified by the methods
//   register() / unregister()
// When unregister() unregisters the last remaining client, it calls the static
//  releaseSurveyor on itself, affecting its own demise.
//
// The update() method expects a merged display plus the object that sets the
//  width and/or height.
// 
// 

class DisplayOffsetSurveyor {
    /// The object that controls the div
    survObj: SurveyDisplay;
    /// All registered clients with the same request
    clients = new Map<number, EvaluationDisplayOffset>();
    /// The string representation of the request
    displayString: string = undefined;
    /// True when the text is in italics, something the browser doesn't measure properly.
    // italicizedText: boolean = false;
    /// Actual font size (16 is the default)
    fontSize: number = 16;
    /// When true, the display requires an image to be loaded, which means it
    /// can be updated from Image.onload().
    containsImage: boolean = false;
    /// Callback result
    size: number[] = undefined;

    static surveyorByDisplay = new Map<string, DisplayOffsetSurveyor>();
    static resourcesLoaded: boolean = false;

    constructor(divId: string, displayString: string) {
        this.survObj = new SurveyDisplay(divId, this);
        this.displayString = displayString;
    }

    destroy(): void {
        this.survObj.destroy();
        this.survObj = undefined;
    }

    update(dispObj: any, modObj: any) {
        var width: number = isEmptyOS(modObj.width)? undefined: Number(modObj.width);
        var height: number = isEmptyOS(modObj.height)? undefined: Number(modObj.height);

        if (isNaN(width)) {
            width = undefined;
        }
        if (isNaN(modObj.height)) {
            height = undefined;
        }
        if (dispObj.text !== undefined && dispObj.text.fontStyle !== undefined) {
            var fontSize: any = dispObj.text.fontSize;
            // this.italicizedText = (dispObj.text.fontStyle === "italic" || dispObj.text.fontStyle === "oblique");
            // when there's no numeric looking font size, so the browser
            // sticks to the default
            if (typeof(fontSize) === "number") {
                this.fontSize = fontSize;
            } else if (typeof(fontSize) === "string") {
                try {
                    this.fontSize = Number.parseInt(fontSize);
                } catch (e) {
                }
            }
        } else if (dispObj.image !== undefined && dispObj.image.src !== undefined) {
            this.containsImage = true;
        }
        this.survObj.update(dispObj, width, height);
    }

    register(client: EvaluationDisplayOffset): void {
        assert(!this.clients.has(client.watcherId),
               "DisplayOffsetSurveyor: client should register only once");
        this.clients.set(client.watcherId, client);
        if (this.size !== undefined) {
            client.surveyNotification(DisplayOffsetSurveyor.resourcesLoaded, this.size);
        }
    }

    unregister(client: EvaluationDisplayOffset): void {
        assert(this.clients.has(client.watcherId),
               "DisplayOffsetSurveyor: can only unregister registered clients");
        this.clients.delete(client.watcherId);
    }

    surveyNotification(): void {
        if (this.survObj !== undefined) { // ignore notification after destroy
            this.size = this.survObj.getSize();
            // if (this.italicizedText) {
            //     this.size[0] += Math.floor(this.fontSize * 1.25);
            // }
            this.clients.forEach(client => {
                client.surveyNotification(DisplayOffsetSurveyor.resourcesLoaded, this.size);
            });
        }
    }

    imageSizeNotification(width: number, height: number): void {
        if (this.survObj !== undefined) { // ignore notification after destroy
            this.size = [width, height];
            this.clients.forEach(client => {
                client.surveyNotification(true, this.size);
            });
        }
    }

    static surveyorDivId: number = 0;

    /// Returns a surveyor from cache if there is one registered for exactly the
    /// same display string, or creates a new one
    static getSurveyor(displayString: string, dispObj: any, modObj: any): DisplayOffsetSurveyor {
        var surveyor: DisplayOffsetSurveyor;

        if (DisplayOffsetSurveyor.surveyorByDisplay.has(displayString)) {
            surveyor = DisplayOffsetSurveyor.surveyorByDisplay.get(displayString);
        } else {
            var newSurveyorDivId: string = "displayOffset" + DisplayOffsetSurveyor.surveyorDivId++;
            surveyor = new DisplayOffsetSurveyor(newSurveyorDivId, displayString);
            DisplayOffsetSurveyor.surveyorByDisplay.set(displayString, surveyor);
            surveyor.update(dispObj, modObj);
        }
        return surveyor;
    }

    static releaseSurveyor(surveyor: DisplayOffsetSurveyor, client: EvaluationDisplayOffset): void {
        surveyor.unregister(client);
        if (surveyor.clients.size === 0) {
            DisplayOffsetSurveyor.surveyorByDisplay.delete(surveyor.displayString);
            surveyor.destroy();
        }
    }

    static pollAllSurveyor(lastCall: boolean): void {
        var nrImageSurv: number = 0;

        DisplayOffsetSurveyor.resourcesLoaded = lastCall;
        DisplayOffsetSurveyor.surveyorByDisplay.forEach(surveyor => {
            if (!surveyor.containsImage) {
                surveyor.surveyNotification();
            } else {
                nrImageSurv++;
            }
        })
        if (lastCall) {
            assert(DisplayOffsetSurveyor.surveyorByDisplay.size === nrImageSurv,
                   "not all text surveyors have been released");
        }
    }
}

// Constant implementation could be improved ever so slightly: if the condVar
// and all the on expressions are constant, constancy only depends on the
// matched use expression
class EvaluationCond extends EvaluationNode
    implements CleanUpUnusedEvaluationNodes, ReceiveDataSourceResult
{
    prototype: CondNode;
    watcherId: number;
    condVar: EvaluationNode;
    altList: {on: EvaluationNode; use: EvaluationNode}[] = [];
    condVarBoolMatch: boolean = true;
    boolVarAppl: DataSourceFunctionApplication;
    useChanged: boolean = false;
    constant: boolean = false;
    varAndOnConstant: boolean = true;

    // Currently active use expression; if equal to altList.length, no
    // on expression matches the condition variable.
    selectedPos: number = undefined;

    // lowest position where condition has changed
    updatePos: number = 0;

    // Set Mode
    condVarDependsOnDefunParameter: boolean;
    useDependsOnDefunParameter: boolean[];

    constructor(prototype: CondNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result.value = constEmptyOS;
        this.dataSourceResultMode = true;
        if ("schedulingError" in prototype) {
            this.inputs = [];
        }
    }

    destroy(): void {
        if (this.boolVarAppl !== undefined) {
            this.setCondVarDataSource(undefined);
        }
        super.destroy();
    }

    addAltOn(on: EvaluationNode): void {
        var pos: number = this.altList.length;

        if (!on.isConstant()) {
            on.addWatcher(this, pos + 1, false, true, false);
            if ("schedulingError" in this.prototype) {
                this.inputs.push(on);
            }
            this.condVarBoolMatch = false;
            this.varAndOnConstant = false;
        } else if (!(on.result.value instanceof Array) ||
                   on.result.value.length !== 1 ||
                   (on.result.value[0] !== true && on.result.value[0] !== false)) {
            this.condVarBoolMatch = false;
        }
        this.altList[pos] = {on: on, use: undefined};
        this.selectedPos = pos + 1;
    }

    // Set following addAltOn, so it is known whether the on values are constant
    // booleans.
    setConditionVar(condVar: EvaluationNode): void {
        this.condVar = condVar;
        if (!condVar.isConstant()) {
            this.condVar.addWatcher(this, 0, false, true, this.condVarBoolMatch);
            if ("schedulingError" in this.prototype) {
                this.inputs.push(condVar);
            }
            this.varAndOnConstant = false;
        }
    }

    init(): void {
        if (this.varAndOnConstant) {
            // The variable and the on: values are constant, so there's only one
            // relevant use: expression. Instantiate it and check if it's constant.
            var newPos: number = 0;
            var condVarVal: any = this.condVar.result.value;
            while (newPos < this.altList.length) {
                var av: any = getDeOSedValue(this.altList[newPos].on.result.value);
                if (av === null || interpretedQualifierMatch(av, condVarVal)) {
                    break;
                }
                newPos++;
            }
            this.selectedPos = newPos;
            this.updatePos = undefined;
            if (newPos < this.altList.length) {
                var use: EvaluationNode = this.instantiateUse(newPos);
                if (use.isConstant()) {
                    this.constant = true;
                } else {
                    this.selectedPos = this.altList.length;
                    this.updatePos = 0;
                }
            } else {
                this.constant = true;
            }
        }
        super.init();
    }

    isConstant(): boolean {
        return this.constant;
    }

    instantiateUse(pos: number): EvaluationNode {
        var use = getEvaluationNode(this.prototype.altList[pos].use, this.local);

        use.addWatcher(this, -pos - 1, false, false, true);
        this.altList[pos].use = use;
        return use;
    }

    removeAsWatcher(): void {
        if (this.nrActiveWatchers > 0) {
            this.deactivateInputs();
        }
        this.condVar.removeWatcher(this, false, this.condVarBoolMatch);
        for (var i: number = 0; i !== this.altList.length; i++) {
            this.altList[i].on.removeWatcher(this, false, false);
            if (this.altList[i].use !== undefined) {
                this.altList[i].use.removeWatcher(this, false, true);
            }
        }
        this.condVar = undefined;
        this.altList = undefined;
        this.inputs = undefined;
    }

    updateInput(id: number, result: Result): void {
        if (result === undefined) {
            this.selectedPos = undefined;
            this.updatePos = undefined;
            return;
        } else if (this.selectedPos === undefined) {
            this.updatePos = undefined;
            return;
        }
        if (id === 0) { // cond var change
            if (this.condVarBoolMatch) {
                this.setCondVarDataSource(result.dataSource);
            }
            this.updatePos = 0;
            this.markAsChanged();
        } else if (id > 0) { // alt change
            var pos: number = id - 1;
            // No need to check if on value at higher position changes
            if (pos <= this.selectedPos &&
                  (this.updatePos === undefined || this.updatePos > pos)) {
                this.updatePos = pos;
                this.markAsChanged();
            }
        } else if (-id - 1 === this.selectedPos) { // id < 0 => use change
            // Only mark as changed when the currently active value changes
            this.useChanged = true;
            this.markAsChanged();
        }
    }

    isDeferableInput(id: number, input: EvaluationNode): boolean {
        return id === 0 || // Cond var changes
               (id > 0 && id - 1 <= this.selectedPos) || // alt:on: changes
               (id < 0 && -id - 1 === this.selectedPos); // alt:use changes
    }

    setCondVarDataSource(dataSource: DataSourceComposable): void {
        if (this.boolVarAppl !== undefined && this.boolVarAppl.input !== dataSource) {
            if (this.nrActiveWatchers > 0) {
                this.boolVarAppl.deactivate();
            }
            this.boolVarAppl.removeResultReceiver(this);
            this.boolVarAppl = undefined;
        }
        if (dataSource !== undefined) {
            this.boolVarAppl = dataSource.applyAggregateFunction("bool", this);
            if (this.nrActiveWatchers > 0) {
                this.boolVarAppl.activate();
            }
        }
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.isActive() && this.selectedPos < this.altList.length) {
            var use: EvaluationNode = this.altList[this.selectedPos].use;
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                use.activeWatcherBecomesDataSourceAware(this);
                this.markAsChanged();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                use.activeWatcherNoLongerIsDataSourceAware(this);
                this.markAsChanged();
            }
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    newDataSourceResult(v: any[]): void {
        this.updatePos = 0;
        this.markAsChanged();
    }

    reextractData(dataSource: DataSourceComposable): void {
    }

    eval(): boolean {
        var oldValue = this.result.value;
        var resultLabels = this.result.getLabels();
        var condVarVal: any = this.boolVarAppl !== undefined?
                        this.boolVarAppl.getResult(): this.condVar.result.value;
        var useChanged: boolean = this.useChanged;

        this.useChanged = false;
        if (this.updatePos !== undefined) { // Else only current use has changed
            var newPos: number = this.updatePos;
            this.updatePos = undefined;
            while (newPos < this.altList.length) {
                var av: any = getDeOSedValue(this.altList[newPos].on.result.value);
                if (av === null || interpretedQualifierMatch(av, condVarVal)) {
                    break;
                }
                newPos++;
            }
            if (newPos !== this.selectedPos) {
                if (this.selectedPos < this.altList.length) {
                    var use: EvaluationNode = this.altList[this.selectedPos].use;
                    use.deactivate(this, this.dataSourceResultMode);
                    if (!use.isConstant() && "schedulingError" in this.prototype) {
                        this.inputs.pop();
                    }
                }
                this.selectedPos = newPos;
                if (newPos < this.altList.length) {
                    var use: EvaluationNode = this.altList[newPos].use;
                    if (use === undefined) {
                        use = this.instantiateUse(newPos);
                    }
                    if (!use.isConstant()) {
                        use.activate(this, this.dataSourceResultMode);
                        use.forceUpdate(this, true);
                        if ("schedulingError" in this.prototype) {
                            this.inputs.push(use);
                        }
                        return undefined; // leave scheduled
                    }
                }
            } else if (!useChanged) {
                return false; // alt selection nor current use changed
            }
        }
        if (this.selectedPos < this.altList.length) {
            this.result.copy(this.altList[this.selectedPos].use.result);
        } else {
            this.result.set(constEmptyOS);
        }
        return oldValue === undefined ||
            !this.result.equalLabels(resultLabels) ||
            !valueEqual(oldValue, this.result.value);
    }

    activateInputs(): void {
        this.condVar.activate(this, this.condVarBoolMatch);
        this.updatePos = 0;
        this.inputHasChanged = true;
        if (this.boolVarAppl !== undefined) {
            this.boolVarAppl.activate();
        }
        for (var i: number = 0; i < this.altList.length; i++) {
            this.altList[i].on.activate(this, false);
        }
    }

    deactivateInputs(): void {
        if (this.boolVarAppl !== undefined) {
            this.boolVarAppl.deactivate();
        }
        if (this.condVar !== undefined) {
            this.condVar.deactivate(this, this.condVarBoolMatch);
            for (var i: number = 0; i < this.altList.length; i++) {
                this.altList[i].on.deactivate(this, false);
            }
            if (this.selectedPos < this.altList.length) {
                this.altList[this.selectedPos].use.deactivate(this, this.dataSourceResultMode);
            }
            // Signal that no use expression is active
            this.selectedPos = this.altList.length + 1;
        }
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (this.selectedPos < this.altList.length) {
            return this.altList[this.selectedPos].use.write(result, mode, attributes, positions, reportDeadEnd);
        } else {
            this.reportDeadEndWrite(reportDeadEnd, "no active condition");
            return false;
        }
    }
    
    debugName(): string {
        return "cond";
    }

    toFullString(): string {
        var str = "[cond, " + this.condVar.toFullString() + ", o(";

        for (var i: number = 0; i < this.altList.length; i++) {
            if (i !== 0) str += ", ";
            str += "{on: " + this.altList[i].on.toFullString() + ", use: " +
                   (this.altList[i].use === undefined? "undefined":
                    this.altList[i].use.toFullString()) +
                   "}";
        }
        str += ")] = " + cdlifyLim(this.result.value, 80);
        return str;
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        var alt: any;
        
        super.specificExplanation(explanation, classDebugInfo, true);
        explanation["var: " + this.condVar.debugName()] = this.condVar.explain(undefined);
        explanation.alternatives = [];
        for (var i: number = 0; i < this.selectedPos && i < this.altList.length; i++) {
            alt = {};
            alt["on: " + this.altList[i].on.debugName()] =
                this.altList[i].on.explain(undefined);
            explanation.alternatives.push(alt);
        }
        if (this.selectedPos < this.altList.length) {
            alt = {};
            alt["on: " + this.altList[i].on.debugName()] =
                this.altList[i].on.explain(undefined);
            alt["use: " + this.altList[i].use.debugName()] =
                this.altList[i].use.explain(undefined);
            explanation.alternatives.push(alt);
        }
        return explanation;
    }

    // querySourceId(): number {
    //     return this.selectedPos < this.altList.length?
    //            this.altList[this.selectedPos].use.querySourceId(this):
    //            this.watcherId;
    // }

    multiQuerySourceIds(): number[] {
        return this.selectedPos < this.altList.length?
               this.altList[this.selectedPos].use.multiQuerySourceIds():
               [];
    }

    removeWatcherFromInactiveNodes(): void {
        for (var i: number = 0; i !== this.altList.length; i++) {
            if (i !== this.selectedPos && this.altList[i].use !== undefined &&
                  !this.altList[i].use.isConstant()) {
                this.altList[i].use.removeWatcherForPos(this, -i - 1, false, undefined);
                this.altList[i].use = undefined;
            }
        }
    }
}

class EvaluationMerge extends EvaluationFunctionApplication {
    eval(): boolean {
        var res: any[];
        var ids: any[];

        if (this.arguments.length === 0) {
            ids = undefined;
            res = constEmptyOS;
        } else if (this.arguments.length === 1) {
            // Merge with one argument merges the elements in the os based on
            // their identity.
            var val0 = this.arguments[0].value;
            var id0 = this.arguments[0].identifiers;
            if (id0 === undefined) {
                res = val0.slice(0);
            } else {
                var idMap: Map<any, number> = new Map<any, number>();
                res = [];
                ids = [];
                for (var j: number = 0; j < val0.length; j++) {
                    var id: any = id0[j];
                    var val: any = val0[j];
                    var dest: number|undefined = idMap.get(id);
                    if (dest === undefined) {
                        // Element with new id
                        idMap.set(id, res.length);
                        res.push(val);
                        ids.push(id);
                    } else {
                        // Element with existing id, so merge
                        res[dest] = getDeOSedValue(mergeCopyAV(res[dest], val, undefined));
                    }
                }
            }
        } else if ("identifiers" in this.arguments[0]) {
            return this.evalSet();
        } else {
            res = this.arguments[0].value;
            ids = this.arguments[0].identifiers;
            for (var i: number = 1; i !== this.arguments.length; i++) {
                res = mergeCopyValue(res, this.arguments[i].value, undefined);
                if (ids === undefined) {
                    ids = this.arguments[i].identifiers;
                }
            }
        }
        if (!objectEqual(this.result.value, res) ||
              !objectEqual(this.result.identifiers, ids)) {
            this.result.set(res);
            if (ids !== undefined) {
                this.result.identifiers = ids;
            }
            return true;
        }
        return false;
    }

    evalSet(): boolean {
        var oldValue: any = this.result.value;
        var oldIdentifiers: any = this.result.identifiers;
        var res: any[] = this.arguments[0].value;
        var ids: any[] = this.arguments[0].identifiers;
        var idsCloned: boolean = false;

        for (var i: number = 1; i !== this.arguments.length; i++) {
            var arg_i: any[] = this.arguments[i].value;
            if (ids !== undefined && this.arguments[i].identifiers !== undefined) {
                // Merge by identifier
                var arg_ids: any[] = this.arguments[i].identifiers;
                var argIds: {[id: string]: number} = {}; // map for new arg
                for (var j: number = 0; j < arg_ids.length; j++) {
                    argIds[arg_ids[j]] = j;
                }
                var nRes: any[] = new Array<any>(res.length);
                // combine res with arg_i by id; first for existing ids
                for (var j: number = 0; j < res.length; j++) {
                    var id: any = ids[j];
                    if (id in argIds) {
                        nRes[j] = getDeOSedValue(mergeCopyAV(res[j], arg_i[argIds[id]], undefined));
                    } else {
                        nRes[j] = res[j];
                    }
                }
                // repeat for new ids from this.arguments[i]
                argIds = {}; // map for new arg
                for (var j: number = 0; j < ids.length; j++) {
                    argIds[ids[j]] = j;
                }
                res = nRes;
                for (var j: number = 0; j < arg_ids.length; j++) {
                    var id: any = arg_ids[j];
                    if (id !== undefined && arg_i[j] !== undefined &&
                        !(id in argIds)) {
                        res.push(arg_i[j]);
                        if (!idsCloned) {
                            ids = ids.slice(0);
                            idsCloned = true;
                        }
                        ids.push(id);
                    }
                }
            } else {
                // Merge by position. Note that if arg_i is longer than
                // res, identifiers of the final elements are undefined.
                var nrElt: number = Math.max(res.length, arg_i.length);
                var nRes: any[] = new Array<any>(nrElt);
                for (var j: number = 0; j < nrElt; j++) {
                    nRes[j] = getDeOSedValue(mergeCopyAV(res[j], arg_i[j], undefined));
                }
                res = nRes;
            }
        }
        if (!objectEqual(oldValue, res) || !objectEqual(oldIdentifiers, ids)) {
            this.result.set(res);
            this.result.identifiers = ids;
            return true;
        }
        return false;
    }
}
merge.classConstructor = EvaluationMerge;

// [mergeWrite] allows writing through the first argument, and merges the empty
// ordered set as if it were undefined (but only for the first argument and 
// not in set mode either, since that would be inside a [map]).
class EvaluationMergeWrite extends EvaluationMerge {
    eval(): boolean {
        var oldValue: any = this.result.value;
        var oldIdentifiers: any = this.result.identifiers;
        var res: any[] = undefined;
        var ids: any[] = undefined;

        if (this.arguments.length < 1) {
            ids = undefined;
            res = constEmptyOS;
        } else if ("identifiers" in this.arguments[0]) {
            return this.evalSet();
        } else {
            if (!(this.arguments[0].value instanceof Array) ||
                  this.arguments[0].value.length !== 0) {
                res = this.arguments[0].value;
                ids = this.arguments[0].identifiers;
            }
            for (var i: number = 1; i !== this.arguments.length; i++) {
                res = mergeCopyValue(res, this.arguments[i].value, undefined);
                if (ids === undefined) {
                    ids = this.arguments[i].identifiers;
                }
            }
            if (res === undefined) {
                res = constEmptyOS;
            }
        }
        if (!objectEqual(oldValue, res) || !objectEqual(oldIdentifiers, ids)) {
            this.result.set(res);
            if (ids !== undefined) {
                this.result.identifiers = ids;
            }
            return true;
        }
        return false;
    }

    // Writes go through to the first argument, but when the result of the
    // mergeWrite is identified, the identities are added to the write positions.
    // The identity is added as an extra attribute in the write operation by a
    // deeper [identify]. This assures that written value can be merged with the 
    // value that provided the identity, regardless of the source.
    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var input0 = this.inputs[0];

        if (input0 !== undefined) {
            if (positions !== undefined && "identifiers" in this.result) {
                positions = positions.map(pos => pos.copyWithIdentity(this.result.identifiers[pos.index]));
            }
            return input0.write(result, mode, attributes, positions,
                                reportDeadEnd);
        } else {
            this.reportDeadEndWrite(reportDeadEnd,
                                    "no first argument to write through"); 
            return false;
        }
    }
}
mergeWrite.classConstructor = EvaluationMergeWrite;

class EvaluationIsDisjoint extends EvaluationFunctionApplication
implements FuncResultWatcherInterface
{
    funcResultWatchers: FuncResultWatcher[] = [
        new FuncResultWatcher(globalInternalQCM, this, 0),
        new FuncResultWatcher(globalInternalQCM, this, 1)
    ];
    dataElements: Set<number>[] = [new Set<number>(), new Set<number>()];
    nrCommonElements: number = 0;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.dataSourceAware = true;
    }

    destroy(): void {
        this.funcResultWatchers[0].destroy();
        this.funcResultWatchers[1].destroy();
        super.destroy();
    }

    updateInput(i: any, result: Result): void {
        if (result !== undefined) {
            assert(result.dataSource !== undefined, "not expecting JS data");
            this.funcResultWatchers[i].setData(result.dataSource.funcResult);
        }
    }

    // FuncResultWatcherInterface

    refreshIndexerAndPaths(tag: number, dataObj: FuncResult): void {
        this.dataElements[tag].clear();
        this.nrCommonElements = 0;
        this.markAsChanged();
    }

    replaceIndexerAndPaths(tag: number, prevPrefixPathId: number,
                           prefixPathId: number, dataObj: FuncResult): void {
        return; // nothing to do: result did not change
    }

    removeAllElementIds(tag: number): void {
        this.dataElements[tag].clear();
        this.nrCommonElements = 0;
        this.markAsChanged();
    }

    addElementIds(elementIDs: number[], tag: number): void {
        var tagSet: Set<number> = this.dataElements[tag];
        var otherSet: Set<number> = this.dataElements[1 - tag];

        for (var i: number = 0; i < elementIDs.length; i++) {
            var elementID: number = elementIDs[i];
            assert(!tagSet.has(elementID), "error in assumption");
            tagSet.add(elementID);
            if (otherSet.has(elementID)) {
                this.nrCommonElements++;
            }
        }
        this.markAsChanged();
    }

    removeElementIds(elementIDs: number[], tag: number): void {
        var tagSet: Set<number> = this.dataElements[tag];
        var otherSet: Set<number> = this.dataElements[1 - tag];

        for (var i: number = 0; i < elementIDs.length; i++) {
            var elementID: number = elementIDs[i];
            assert(tagSet.has(elementID), "error in assumption");
            tagSet.delete(elementID);
            if (otherSet.has(elementID)) {
                this.nrCommonElements--;
            }
        }
        this.markAsChanged();
    }

    activateInputs(): void {
        this.funcResultWatchers[0].activate();
        this.funcResultWatchers[1].activate();
    }

    deactivateInputs(): void {
        this.funcResultWatchers[0].deactivate();
        this.funcResultWatchers[1].deactivate();
    }

    eval(): boolean {
        var newValue: any[] =
            this.nrCommonElements === 0? constTrueOS: constFalseOS;

        if (this.result.value !== newValue) {
            this.result.value = newValue;
            return true;
        }
        return false;
    }

    debugName(): string {
        return "isDisjoint";
    }

}
isDisjoint.classConstructor = EvaluationIsDisjoint;

// Checks if the two arguments have the same value. The result is always the
// value of the first argument. If the two values differ, it logs to the console
// and jumps into the debugger.
class EvaluationVerificationFunction extends EvaluationFunctionApplication {
    eval(): boolean {
        if (!this.arguments[0].equal(this.arguments[1])) {
            console.log("verification error");
            breakIntoDebugger();
        }
        this.result = this.arguments[0];
        return true;
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        return this.inputs[0].write(result, mode, attributes, positions,
                                   reportDeadEnd);
    }

    debugName(): string {
        return "verificationFunction";
    }

    // querySourceId(): number {
    //     return this.inputs[0].querySourceId(this);
    // }

    multiQuerySourceIds(): number[] {
        return this.inputs[0].multiQuerySourceIds();
    }
}
verificationFunction.classConstructor = EvaluationVerificationFunction;

// Turns undefined into o().
class EvaluationMakeDefined extends EvaluationFunctionApplication {
    eval(): boolean {
        if (this.arguments[0].value === undefined) {
            var change: boolean = this.result.value.length > 0;
            this.result.value = constEmptyOS;
            return change;
        } else {
            this.result.value = this.arguments[0].value;
            return true;
        }
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        return this.inputs[0].write(result, mode, attributes, positions,
                                   reportDeadEnd);
    }

    debugName(): string {
        return "makeDefined";
    }

    // querySourceId(): number {
    //     return this.arguments[0].value !== undefined?
    //            this.inputs[0].querySourceId(this): this.watcherId;
    // }

    multiQuerySourceIds(): number[] {
        return this.arguments[0].value !== undefined?
               this.inputs[0].multiQuerySourceIds(): [];
    }
}
makeDefined.classConstructor = EvaluationMakeDefined;

/**
 * Walk the parse tree and compute the result. For each attribute, the function
 * getAttrValue() is called, allowing an interface to JS values as well as
 * indexers.
 * 
 * @param {ParseTree} tree 
 * @param {any[]} data 
 * @param {(data: any[], attr: string) => number[]} getAttrValue 
 * @returns {number[]} 
 */
function interpretParseTree(tree: ParseTree, data: any[], getAttrValue: (data: any[], attr: string) => number[]): number[] {

    // unary functions: undefined when input is undefined
    function zip1(f:(a: number) => number, args: number[][]): number[] {
        var args0: number[] = args[0];

        return args0 !== undefined?
                args0.map(function(a_i: number, i: number): number {
                    return a_i !== undefined? f(a_i): undefined;
                }): constEmptyOS;
    }

    // two arg functions: undefined when one input is undefined
    function zip2(f:(a: number, b: number) => number, args: number[][]): number[] {
        var args0: number[] = args[0];
        var args1: number[] = args[1];

        return args0 !== undefined && args1 !== undefined?
                args0.map(function(a_i: number, i: number): number {
                    var b_i: number = args1[i];
                    return a_i !== undefined && b_i !== undefined? f(a_i, b_i): undefined;
                }): constEmptyOS;
    }

    // multiple arg functions: undefined is passed along
    function zip(f:(args: number[]) => number, args: number[][]): number[] {
        var i: number = 0;
        var res: number[] = [];

        while (true) {
            var end: boolean = true;
            var args_i: number[] = [];
            for (var j: number = 0; j < args.length; j++) {
                if (i < args[j].length) {
                    end = false;
                    args_i.push(args[j][i]);
                }
            }
            if (end) {
                break;
            }
            res.push(f(args_i));
            i++;
        }
        return res;
    }

    function min(args: number[]): number {
        var m: number = undefined;

        for (var i: number = 0; i < args.length; i++) {
            if (m === undefined || args[i] < m) {
                m = args[i];
            }
        }
        return m;
    }

    function max(args: number[]): number {
        var m: number = undefined;

        for (var i: number = 0; i < args.length; i++) {
            if (m === undefined || args[i] > m) {
                m = args[i];
            }
        }
        return m;
    }

    function sum(args: number[]): number {
        var sum: number = 0;

        for (var i: number = 0; i < args.length; i++) {
            if (args[i] !== undefined) {
                sum += args[i];
            }
        }
        return sum;
    }

    function avg(args: number[]): number {
        var sum: number = 0;
        var nr: number = 0;

        for (var i: number = 0; i < args.length; i++) {
            if (args[i] !== undefined) {
                sum += args[i];
                nr++;
            }
        }
        return nr === 0? undefined: sum / nr;
    }

    var args: number[][] = tree.arguments === undefined? undefined:
        tree.arguments.map((arg: ParseTree): number[] => {
            return interpretParseTree(arg, data, getAttrValue);
        });

    switch (tree.head) {
      case "+": return args === undefined || args.length != 2? constEmptyOS:
                    zip2((a: number, b: number): number => {
                        return a + b;
                    }, args);
      case "-": return args === undefined || args.length != 2? constEmptyOS:
                    zip2((a: number, b: number): number => {
                            return a - b;
                        }, args);
      case "*": return args === undefined || args.length != 2? constEmptyOS:
                    zip2((a: number, b: number): number => {
                            return a * b;
                        }, args);
      case "/": return args === undefined || args.length != 2? constEmptyOS:
                    zip2((a: number, b: number): number => {
                            return b !== 0? a / b: undefined;
                        }, args);
      case "%": return args === undefined || args.length != 2? constEmptyOS:
                    zip2((a: number, b: number): number => {
                            return b !== 0? a % b: undefined;
                        }, args);
      case "^": return args === undefined || args.length != 2? constEmptyOS:
                    zip2((a: number, b: number): number => {
                            var r = Math.pow(a, b);
                            return isNaN(r)? undefined: r;
                        }, args);
      case "unaryMinus": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            return -a;
                        }, args);
      case "ln": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            return a > 0? Math.log(a): undefined;
                        }, args);
      case "log10": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            return a > 0? Math.log(a) / Math.LN10: undefined;
                        }, args);
      case "logb": return args === undefined || args.length != 2? constEmptyOS:
                    zip2((a: number, b: number): number => {
                            return a > 0 && b > 0? Math.log(a) / Math.log(b): undefined;
                        }, args);
      case "exp": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            return Math.exp(a);
                        }, args);
      case "abs": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            return Math.abs(a);
                        }, args);
      case "sqrt": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            return a > 0? Math.sqrt(a): undefined;
                        }, args);
      case "second": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getSeconds();
                            return isNaN(n)? undefined: n;
                        }, args);
      case "minute": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getMinutes();
                            return isNaN(n)? undefined: n;
                        }, args);
      case "hour": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getHours();
                            return isNaN(n)? undefined: n;
                        }, args);
      case "dayOfWeek": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getDay();
                            return isNaN(n)? undefined: n + 1;
                        }, args);
      case "dayOfMonth": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getDate();
                            return isNaN(n)? undefined: n;
                        }, args);
      case "month": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getMonth();
                            return isNaN(n)? undefined: n + 1;
                        }, args);
      case "quarter": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getMonth();
                            return isNaN(n)? undefined: Math.trunc(n / 3) + 1;
                        }, args);
      case "year": return args === undefined || args.length != 1? constEmptyOS:
                    zip1((a: number): number => {
                            var n = new Date(a * 1000).getFullYear();
                            return isNaN(n)? undefined: n;
                        }, args);
      case "pi":
        return data.map((_: any): number => {
            return Math.PI;
        });
      case "e":
        return data.map((_: any): number => {
            return Math.E;
        });
      case "max": return zip(max, args);
      case "min": return zip(min, args);
      case "sum": return zip(sum, args);
      case "avg": return zip(avg, args);
      default:
        if (typeof(tree.head) === "number") {
            // Return the same number for all elements
            var num: number = tree.head;
            return data.map((_: any): number => {
                return num;
            });
        }
        if (typeof(tree.head) === "string") {
            // assume it's an attribute
            return getAttrValue(data, tree.head);
        }
        return constEmptyOS;
    }
}

class EFEvaluateFormula extends EvaluationFunctionApplication {
    parser: StringParseFormula = new StringParseFormula();
    parseResult: ParseResult = undefined;

    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
        if (result === undefined) {
            this.inputs[i].removeWatcher(this, false, false);
            this.inputs[i] = undefined;
        } else if (i === 0) {
            var formula: any = getDeOSedValue(result.value);
            if (typeof(formula) !== "string") {
                this.parseResult = undefined;
            } else {
                this.parseResult = this.parser.parse(formula);
            }
            this.markAsChanged();
        } else if (i === 1) {
            if (this.parseResult !== undefined) {
                this.markAsChanged();
            }
        }
    }

    eval(): boolean {
        var oldIdentifiers: any[] = this.result.identifiers;
        var oldValue: any[] = this.result.value;
        var newValue: number[] = undefined;
        var newIdentifiers: any[] = undefined;

        if (this.parseResult === undefined) {
            // set after change to formula that was not a string
            newValue = constEmptyOS;
        } else if (this.parseResult.success && this.arguments[1].value !== undefined) {
            var res: number[] = this.interpret();
            if (oldIdentifiers === undefined) {
                newValue = res.filter(function(n: number): boolean {
                    return n !== undefined;
                });
            } else {
                newValue = [];
                newIdentifiers = [];
                for (var i = 0; i < res.length; i++) {
                    var res_i = res[i];
                    if (res_i !== undefined) {
                        newValue.push(res_i);
                        newIdentifiers.push(oldIdentifiers[i]);
                    }
                }
            }
        } else {
            newValue = constEmptyOS;
        }
        this.result.value = newValue;
        return !valueEqual(oldValue, newValue) ||
               !valueEqual(oldIdentifiers, newIdentifiers);
    }

    evalSet(): boolean {
        var oldValue: any[] = this.result.value;
        var newValue: number[] = undefined;

        if (this.parseResult === undefined) {
            // set after change to formula that was not a string
            newValue = constEmptyOS;
        } else if (this.parseResult.success && this.arguments[1].value !== undefined) {
            newValue = this.interpret();
        } else {
            newValue = constEmptyOS;
        }
        this.result.value = newValue;
        this.result.copyLabels(this.arguments[1]);
        return !valueEqual(oldValue, newValue);
    }

    interpret(): number[] {
        return interpretParseTree(
                this.parseResult.tree, ensureOS(this.arguments[1].value),
                function(data: any[], attr: string): number[] {
                    return data.map(function(data_i: any): number {
                        var r: any = typeof (data_i) === "object" ?
                            getDeOSedValue(data_i[attr]) : undefined;
                        return typeof (r) === "number" ? r : undefined;
                    })
                });
    }
}
evaluateFormula.classConstructor = EFEvaluateFormula;

// Adds a path node to the indexer; only works when input data source is
// an indexer; outputs the same indexer
// TODO: make it work for ordered sets under attribute (in extract,
// aligning in interpret, and key updates)
class EFAddComputedAttribute extends EvaluationFunctionApplication
    implements DataSourceKeyAndMatchesUpdateInterface
{
    // The new attribute. This node owns the path node with that name
    attribute: string = undefined;
    // The input and output indexer
    indexer: InternalQCMIndexer = undefined;
    // Path where the data resides
    dataPathId: number = undefined;
    // Path where the result of the computation is stored
    resultPathId: number = undefined;
    // When true, recompute for all data elements
    recomputeAll: boolean = false;
    // The parser
    parser: StringParseFormula = new StringParseFormula();
    // The parsed formula
    parseResult: ParseResult = undefined;
    // Monitors per referenced path
    indexerMonitors: {[pathId: number]: IndexerTracer} = {};

    dataSourceAware: boolean = true;

    // This is a hack. The current implementation of EFAddComputedAttribute works
    // directly on the original indexer, which leads to synchronization problems.
    // This hack assumes that multiple versions of this node writing to the same
    // path are trying to write the same value.
    // This table specifies the following
    // - each pathId maps to a list of watcherIds that compute the values for that path
    // - the first node of that list takes care of changes, the rest ignores it
    // - deactivation implies removal from the list
    // - when the list becomes empty, the pathNode can be removed
    // A correct solution would entail a merge indexer.
    static pathNodeRefCount = new Map<number, number[]>();

    isPathNodeOwner(): boolean {
        return this.watcherId === EFAddComputedAttribute.pathNodeRefCount.get(this.resultPathId)[0];
    }

    thereIsNoPathNodeOwner(): boolean {
        return EFAddComputedAttribute.pathNodeRefCount.get(this.resultPathId).length === 0;
    }

    addToPathNodeRefCount(): void {
        if (this.resultPathId !== undefined) {
            if (!EFAddComputedAttribute.pathNodeRefCount.has(this.resultPathId)) {
                EFAddComputedAttribute.pathNodeRefCount.set(this.resultPathId, []);
            }
            EFAddComputedAttribute.pathNodeRefCount.get(this.resultPathId).push(this.watcherId);
        }
    }

    removeFromPathNodeRefCount(): void {
        if (this.resultPathId !== undefined) {
            var watcherIds = EFAddComputedAttribute.pathNodeRefCount.get(this.resultPathId);
            var index = watcherIds.indexOf(this.watcherId);
            assert(index !== -1, "EFAddComputedAttribute already removed?");
            watcherIds.splice(index, 1);
        }
    }

    activateInputs(): void {
        this.addToPathNodeRefCount();
        super.activateInputs();
    }

    deactivateInputs(): void {
        super.deactivateInputs();
        this.removeFromPathNodeRefCount();
    }

    destroy(): void {
        this.dataSourceInput = undefined; // It's not ours to destroy
        super.destroy();
        this.destroyResult();
        this.destroyAllIndexerMonitors(false);
        this.indexer = undefined;
    }

    destroyAllIndexerMonitors(reinit: boolean): void {
        for (var pathId in this.indexerMonitors) {
            this.indexerMonitors[pathId].destroy();
        }
        this.indexerMonitors = reinit? {}: undefined;
    }

    destroyResult(): void {
        if (this.resultPathId !== undefined) {
            if (this.thereIsNoPathNodeOwner()) {
                this.removeResultsForIDs(this.getAllRootDataElementIds());
            }
            this.indexer.qcm.releasePathId(this.resultPathId);
            this.indexer.decPathNodeTracing(this.indexer.pathNodesById[this.resultPathId]);
            this.resultPathId = undefined;
        }
    }

    removeResultsForIDs(elementIds: number[]): void {
        var pathNode: PathNode = this.indexer.pathNodesById[this.resultPathId];
        for (var i: number = 0; i < elementIds.length; i++) {
            this.indexer.removeNode(pathNode, elementIds[i]);
        }
    }

    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
        if (result === undefined) {
            this.inputs[i].removeWatcher(this, false, this.dataSourceAware);
            this.inputs[i] = undefined;
        } else {
            switch (i) {
              case 0:
                this.changeAttribute(getDeOSedValue(result.value));
                break;
              case 1:
                this.changeFormula(getDeOSedValue(result.value));
                break;
              case 2:
                this.changeData(result);
                break;
            }
        }
    }

    changeAttribute(attribute: any): void {
        if (typeof(attribute) !== "string") {
            attribute = undefined;
        }
        if (attribute === this.attribute) {
            return;
        }
        this.clearResult();
        this.setAttribute(attribute);
    }

    clearResult(): void {
        if (this.indexer !== undefined) {
            this.markAsChanged();
            this.removeFromPathNodeRefCount();
            this.destroyResult();
            this.destroyAllIndexerMonitors(true);
        }
    }

    setAttribute(attribute: string): void {
        if (attribute !== undefined && this.indexer !== undefined && this.dataPathId !== undefined) {
            this.resultPathId = this.indexer.qcm.allocatePathId(this.dataPathId, attribute);
            this.indexer.addPath(this.resultPathId);
            this.indexer.incPathNodeTracing(this.indexer.pathNodesById[this.resultPathId]);
            this.recomputeAll = true;
            this.addToPathNodeRefCount();
            this.markAsChanged();
        }
        this.attribute = attribute;
    }

    changeFormula(formula: any): void {
        if (typeof(formula) !== "string") {
            this.parseResult = undefined;
        } else {
            this.parseResult = this.parser.parse(formula);
        }
        this.recomputeAll = true;
        this.destroyAllIndexerMonitors(true);
        this.markAsChanged();
    }

    changeData(result: Result): void {
        var dataSource: DataSourceComposable = result.dataSource;
        var indexer: InternalQCMIndexer = dataSource !== undefined?
                         dataSource.funcResult.getDominatedIndexer(): undefined;
        var dataPathId: number = dataSource !== undefined?
                      dataSource.funcResult.getDominatedProjPathId(): undefined;

        if (indexer === this.indexer && dataPathId === this.dataPathId && dataPathId !== undefined) {
            return;
        }
        if (this.indexer !== undefined) {
            this.clearResult();
            this.dataSourceInput = undefined;
        }
        this.indexer = indexer;
        this.dataPathId = dataPathId;
        if (indexer !== undefined) {
            this.setAttribute(this.attribute);
            this.dataSourceInput = dataSource;
            this.recomputeAll = true;
            // Copy the input directly to the output.
            this.result.dataSource = this.dataSourceInput;
            this.result.value = emptyDataSourceResult;
        } else {
            Utilities.warn("applying dynamicAttribute to non indexer data");
            // Copy the input directly to the output.
            delete this.result.dataSource;
            this.result.value = constEmptyOS;
        }
    }

    setDataPathId(): void {
        this.dataPathId = this.dataSourceInput === undefined? undefined:
                       this.dataSourceInput.funcResult.getDominatedProjPathId();
    }

    // TODO: might keep the result when an attribute is removed (after removal
    // of UDF).
    indexerUpdateKeys(elementIds: number[], types: string[],
        keys: SimpleValue[], prevTypes: string[], prevKeys: SimpleValue[]): void
    {
        if (this.parseResult.success) {
            this.recomputeForIds(elementIds);
        }
    }

    removeAllIndexerMatches(): void {
    }

    eval(): boolean {
        if (this.recomputeAll && this.parseResult.success) {
            if (this.dataPathId === undefined) {
                // We can get here when the input data source's funcResult
                // wasn't compiled on the call to changeData(). Since there is a
                // whole cycle between that moment and this, the indexer queue
                // has been run once, so it now must be.
                this.setDataPathId();
            }
            if (this.resultPathId === undefined) {
                this.setAttribute(this.attribute);
            }
            if (this.resultPathId !== undefined) {
                this.recomputeForIds(this.getAllRootDataElementIds());
                this.recomputeAll = false;
            }
        }
        if (this.result.dataSource !== this.dataSourceInput) {
            if (this.dataSourceInput === undefined) {
                delete this.result.dataSource;
                this.result.value = constEmptyOS;
            } else {
                this.result.dataSource = this.dataSourceInput;
                this.result.value = emptyDataSourceResult;
            }
            return true;
        }
        return false;
    }

    getAllRootDataElementIds(): number[] {
        var dataElementIds: number[] = [];

        if (this.indexer !== undefined && this.dataPathId !== undefined) {
            var dataPathNode: PathNode = this.indexer.pathNodesById[this.dataPathId];
            dataPathNode.nodes.forEach(function(v: any, dataElementId: number): void {
                dataElementIds.push(dataElementId);
            });
        }
        return dataElementIds;
    }

    recomputeForIds(dataElementIds: number[]): void {
        if (!this.isPathNodeOwner()) {
            return;
        }
        var res: number[] = interpretParseTree(
            this.parseResult.tree, dataElementIds,
            (data: any[], attr: string): number[] => {
                var pathId = this.indexer.qcm.allocatePathId(this.dataPathId, attr);
                if (!(pathId in this.indexerMonitors)) {
                    // If the path didn't exist, this adds it, and triggers
                    // filling it 
                    this.indexerMonitors[pathId] = new IndexerTracerMatchUpdates(
                        this.indexer, pathId, this);
                }
                this.indexer.qcm.releasePathId(pathId);

                var pathNode: PathNode = this.indexer.pathNodesById[pathId];
                if (pathNode === undefined) {
                    return [];
                }
                var nodes: Map<number, PathNodeValue> = pathNode.nodes;
                // TODO: child data elements with other ids
                return dataElementIds.map((dataElementId: number): number => {
                    var value: PathNodeValue = nodes.get(dataElementId);
                    return value !== undefined && value.type === "number"?
                           value.key: undefined;
                });
            }
        );
        var indexer: InternalQCMIndexer = this.indexer;
        var pathNode: PathNode = indexer.pathNodesById[this.resultPathId];
        var pathNodeWasEmpty: boolean = pathNode.nodes.size == 0; 
        if (Utilities.isEmptyObj(this.indexerMonitors)) {
            // When no attribute has been registered, register on the highest
            // path for updates
            this.indexerMonitors[this.dataPathId] = new IndexerTracerMatchUpdates(
                this.indexer, this.dataPathId, this);
        }
        // assuming res.length <= dataElementIds.length
        for (var i: number = 0; i < res.length; i++) {
            var value: number = res[i];
            if (value !== undefined) {
                var elementId: number = dataElementIds[i];
                if (!pathNode.nodes.has(elementId)) {
                    indexer.addNonDataElementNode(pathNode, elementId);
                }
                indexer.setKeyValue(pathNode, elementId, "number", value);
            } else if(!pathNodeWasEmpty) {
                var elementId: number = dataElementIds[i];
                indexer.removeNode(pathNode, elementId);
            }
        }
    }

    public addMatches(elementIDs: number[], pathNode: PathNode): void {
        this.recomputeForIds(elementIDs);
    }

    public removeMatches(elementIDs: number[], pathNode: PathNode): void {
        if (this.isPathNodeOwner()) {
            this.removeResultsForIDs(elementIDs);
        }
    }
}
addComputedAttribute.classConstructor = EFAddComputedAttribute;

class EvaluationIndex extends EvaluationNode implements ReceiveDataSourceResult {
    constant: boolean = true;
    inputs: EvaluationNode[] = new Array<EvaluationNode>(2);
    arguments: Result[] = new Array<Result>(2);
    dataSourceAware: boolean = true;
    dataSourceResultMode: boolean = true;

    /// The DataSource of the collection input
    dataSourceInput: DataSourceComposable;
    /// The multiplexer that is on top of the dataSourceInput
    inputMultiplexer: DataSourceComposableMultiplexer;
    /// The index data is turned into a query on the same data.
    indexQuery: DataSourceQueryByData;
    /// The index operation itself, whose funcResult must be passed along
    indexResult: DataSourceIndex;
    /// Instantiation of [changed] when [index] is not in dataSourceResultMode
    /// (which is of course the usual case).
    dataSourceFunctionApplication: DataSourceFunctionApplication;
    collectionHasChanged: boolean = false;
    indexValueHasChanged: boolean = false;

    destroy(): void {
        this.unsetDataSourceFunctionApplication();
        this.releaseDataSource();
        super.destroy();
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.arguments[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, true, true, i === 0);
        } else {
            this.updateInput(i, evalNode.result);
        }
    }

    releaseDataSource(): void {
        this.releaseIndexQuery();
        if (this.inputMultiplexer !== undefined) {
            this.inputMultiplexer.removeResultReceiver(this);
            this.inputMultiplexer = undefined;
        }
        this.dataSourceInput = undefined;
    }

    releaseIndexQuery(): void {
        if (this.dataSourceFunctionApplication !== undefined) {
            this.unsetDataSourceFunctionApplication();
        }
        if (this.indexResult !== undefined) {
            this.indexResult.removeResultReceiver(this);
            this.indexResult = undefined;
        }
        if (this.indexQuery !== undefined) {
            this.indexQuery.removeResultReceiver(this);
            this.indexQuery = undefined;
        }
    }

    updateInput(pos: number, result: Result): void {
        if (result === undefined) {
            return;
        }
        this.arguments[pos] = result;
        if (pos === 0) {
            this.collectionHasChanged = true;
        } else if (pos === 1) {
            this.indexValueHasChanged = true;
        }
        this.markAsChanged();
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.isActive() && this.dataSourceInput !== undefined) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                assert(this.dataSourceFunctionApplication !== undefined, "debugging");
                this.unsetDataSourceFunctionApplication();
                this.dataSourceResultMode = true;
                this.markAsChanged();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                assert(this.dataSourceFunctionApplication === undefined, "debugging");
                this.dataSourceResultMode = false; // Must come before activate
                if (this.isActive() && this.dataSourceInput !== undefined) {
                    this.setDataSourceFunctionApplication();
                }
                this.markAsChanged();
            }
        } else {
            this.dataSourceResultMode = dataSourceResultMode;
        }
    }

    unsetDataSourceFunctionApplication(): void {
        if (this.dataSourceFunctionApplication !== undefined) {
            if (this.isActive()) {
                this.indexResult.stopIndexerMonitoring();
                this.dataSourceFunctionApplication.deactivate();
            }
            this.dataSourceFunctionApplication.removeResultReceiver(this);
            this.dataSourceFunctionApplication = undefined;
        }
    }

    setDataSourceFunctionApplication(): void {
        this.dataSourceFunctionApplication =
            this.indexResult.applyAggregateFunction("changeinform", this);
        if (this.isActive()) {
            this.dataSourceFunctionApplication.activate();
            this.indexResult.updateIndexerMonitoringForDominatedPath();
        }
    }

    activateInputs(): void {
        super.activateInputs();
        if (this.dataSourceFunctionApplication !== undefined) {
            this.dataSourceFunctionApplication.activate();
            this.indexResult.updateIndexerMonitoringForDominatedPath();
        }
    }

    deactivateInputs(): void {
        super.deactivateInputs();
        if (this.dataSourceFunctionApplication !== undefined) {
            this.dataSourceFunctionApplication.deactivate();
            this.indexResult.stopIndexerMonitoring();
        }
    }

    // When the collection is a datasource, create DataSourceIndex, even if it
    // requires synthesizing a query.
    setIndexCollection(result: Result): void {
        if ("dataSource" in result) {
            this.setIndexCollectionDataSource(result.dataSource);
        } else {
            this.setIndexCollectionDataSource(undefined);
        }
    }

    // When the query chain underlying the [index] function changes, don't
    // attempt to reuse the objects. It's inefficient, and possibly unstable.
    setIndexCollectionDataSource(dataSource: DataSourceComposable): void {
        if (this.dataSourceInput === dataSource) {
            return;
        }
        this.releaseDataSource();
        this.dataSourceInput = dataSource;
        if (dataSource !== undefined) {
            this.inputMultiplexer = dataSource.getDataSourceMultiplexer(this);
            if (this.inputs[1] !== undefined && this.inputs[1].result !== undefined) {
                this.setIndexQuery(this.inputs[1].result);
            }
        }
    }

    setIndexQuery(result: Result): void {
        assert(this.inputMultiplexer !== undefined, "needs inputMultiplexer");
        if (this.indexQuery !== undefined) {
            // Just update the query
            this.indexQuery.updateQuery(this.arguments[1].value);
            return;
        }
        // Create index query application on every change to query and colelction
        // when inputMultiplexer is defined. Note that we ditch the query and
        // the result on every change. In order to avoid unnecessary destruction
        // of the order service, the new IndexOrderResult is created before the
        // old one is deleted.
        this.indexQuery = this.dataSourceInput.applyDataQuery(
            this.arguments[1].value, this, this.inputs[1].querySourceId());
        this.indexResult = this.inputMultiplexer.applyIndexQuery(this.indexQuery, this);
        if (!this.dataSourceResultMode) {
            this.setDataSourceFunctionApplication();
        }
        this.markAsChanged();
    }

    extractDataSourceResult(): boolean {
        var oldValue: any[] = this.result.value;
        var res: any[] = this.indexResult.extractData(MinimumResultRequirements.simple, undefined);
        var hadDataSource: boolean = "dataSource" in this.result;

        this.result.value = res; // Ensures result.value !== emptyDataSourceResult
        if (hadDataSource) {
            delete this.result.dataSource;
        }
        return hadDataSource || !valueEqual(oldValue, res);
    }

    eval(): boolean {
        var change: boolean = false;

        if (this.collectionHasChanged) {
            this.setIndexCollection(this.inputs[0].result);
            this.collectionHasChanged = false;
        }
        if (this.indexValueHasChanged && this.dataSourceInput !== undefined) {
            this.setIndexQuery(this.inputs[1].result);
            this.indexValueHasChanged = false;
        }
        if (this.dataSourceInput !== undefined) {
            if (this.dataSourceResultMode) {
                // Update is propagated via the data source application chain
                // unless the FuncResult has changed
                if (this.result.dataSource !== this.indexResult) {
                    // Pass the query func result on as a data source
                    this.result.dataSource = this.indexResult;
                    this.result.value = emptyDataSourceResult;
                    return true;
                }
                return false;
            } else {
                globalInternalQCM.executeScheduled();
                return this.extractDataSourceResult();
            }
        } else {
            this.releaseDataSource();
            if ("dataSource" in this.result) {
                delete this.result.dataSource;
                change = true;
            }
        }
        
        var collection: any[] = this.arguments[0].value;
        var targets: any[] = this.arguments[1].value;
        var indices: number[] = [];

        if (collection !== undefined && targets !== undefined) {
            for (var j: number = 0; j < targets.length; j++) {
                for (var i: number = 0; i < collection.length; i++) {
                    if (objectEqual(collection[i], targets[j])) {
                        indices.push(i);
                    }
                }
            }
        }
        if (!valueEqual(indices, this.result.value)) {
            this.result.value = indices;
            return true;
        }
        return change;
    }

    newDataSourceResult(v: any[]): void {
        this.markAsChanged();
    }

    reextractData(dataSource: DataSourceComposable): void {
        this.markAsChanged();
    }
}
index.classConstructor = EvaluationIndex;

class EvaluationRedirect extends EvaluationFunctionApplication {
    eval(): boolean {
        return false;
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var pct = new PositionChangeTracker();
        var newValue: any = determineWrite([], result, mode, attributes, positions, pct);

        if (newValue.length === 1 && typeof(newValue[0]) === "string") {
            window.location.href = newValue[0];
            return true;
        }
        this.reportDeadEndWrite(reportDeadEnd,"empty URL to redirect");
        return false;
    }
}
redirect.classConstructor = EvaluationRedirect;

var openWindowReferencesPerTarget: {[target: string]: Window} = {};

class EvaluationSystemInfo extends EvaluationFunctionApplication {

    powerDisconnected: boolean|undefined = undefined;
    connectionStatus: string = "unconnected";

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);

        var self = this;
        globalSystemEvents.addHandler("power disconnected", function(id: number, info: boolean): void {
            self.powerDisconnected = info;
            self.markAsChanged();
        });
        globalSystemEvents.addHandler("connection opened", function(): void {
            self.connectionStatus = "connected";
            self.markAsChanged();
        });
        globalSystemEvents.addHandler("connection error", function(): void {
            self.connectionStatus = "error";
            self.markAsChanged();
        });
        globalSystemEvents.addHandler("connection error cleared", function(): void {
            self.connectionStatus = "connected";
            self.markAsChanged();
        });
        globalSystemEvents.addHandler("connection closed", function(): void {
            self.connectionStatus = "unconnected";
            self.markAsChanged();
        });

        this.constant = false;
    }

    eval(): boolean {
        var v: any = {
            url: [window.location.href],
            language: [navigator.language],
            languages: ensureOS((<any>navigator).languages),
            maxTouchPoints: [navigator.maxTouchPoints],
            connectionStatus: [this.connectionStatus],
            waitBusyTime: [gWaitBusyTime1]
        };

        if (this.powerDisconnected !== undefined) {
            v.powerDisconnected = [this.powerDisconnected];
        }
        if (!objectEqual(v, this.result.value[0])) {
            this.result.value = [v];
            return true;
        }
        return false;
    }

    static writeObjType: ValueTypeDescription = 
        vtd("av", {
            url: [vtd("string"), vtd("undefined")],
            newWindow: [vtd("boolean"), vtd("undefined")],
            target: [vtd("string"), vtd("undefined")],
            arguments: [
                vtd("av", {
                    _: [vtd("string"), vtd("number"), vtd("boolean")]
                }),
                vtd("undefined")
            ],
            useSameAppState: [vtd("boolean"), vtd("undefined")],
            waitBusyTime: vtd("number")
        });

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: true): boolean {
        var pct = new PositionChangeTracker();
        var newValue: any = determineWrite([], result, mode, attributes, positions, pct);

        if (newValue.length !== 1 || !EvaluationSystemInfo.writeObjType.matches(newValue)) {
            return false;
        }
        var waitBusyTime: any = singleton(newValue[0].waitBusyTime);
        if (typeof(waitBusyTime) === "number") {
            gWaitBusyTime1 = waitBusyTime;
            this.markAsChanged();
        }
        var url: any = singleton(newValue[0].url);
        if (typeof(url) === "string") {
            var args: any[] = newValue[0].arguments;
            if (isTrue(newValue[0].useSameAppState) && gAppStateMgr.appStateHandle !== undefined) {
                args = args === undefined? []: ensureOS(args);
                args.push({
                    remote: true,
                    appStateServer: singleton(gAppStateMgr.appStateInfo.serverAddress),
                    appStatePort: singleton(gAppStateMgr.appStateInfo.serverPort),
                    appStatePath: singleton(gAppStateMgr.appStateInfo.serverPath),
                    protocol: singleton(gAppStateMgr.appStateInfo.protocol),
                    appName: singleton(gAppStateMgr.appStateInfo.appName)
                });
            }
            if (typeof(url) === "string" && args instanceof Array) {
                var hasArguments = url.indexOf("?") >= 0;
                for (var i = 0; i < args.length; i++) {
                    var arg = args[i];
                    if (arg instanceof Object) {
                        for (var attr in arg) {
                            var val: any = arg[attr];
                            if (val !== undefined && !(val instanceof Array && val.length === 0)) {
                                url += (hasArguments? "&": "?") + encodeURIComponent(attr) +
                                        "=" + encodeURIComponent(singleton(val));
                            }
                            hasArguments = true;
                        }
                    }
                }
            }
            if (isFalse(newValue[0].newWindow)) {
                window.location.href = singleton(url);
            } else {
                var target: any = singleton(newValue[0].target);
                if (typeof(target) === "string") {
                    if (!openWindowReferencesPerTarget[target] ||
                            openWindowReferencesPerTarget[target].closed) {
                        openWindowReferencesPerTarget[target] =
                            window.open(singleton(url));
                    } else {
                        openWindowReferencesPerTarget[target].focus();
                    }
                } else {
                    window.open(singleton(url));
                }
            }
        }

        return true;
    }
}
systemInfo.classConstructor = EvaluationSystemInfo;

// TODO: perhaps type info for date/string conversion.
class EvaluationDownload extends EvaluationFunctionApplication {
    eval(): boolean {
        return false;
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var arg0: any = singleton(this.arguments[0].value);
        var arg1: any = singleton(this.arguments[1].value);
        var arg2: any[] = this.arguments[2] !== undefined? ensureOS(this.arguments[2].value): constEmptyOS;
        var baseName: string = typeof(arg0) === "string"? arg0: runtimeEnvironment.appName;
        var fileType: string = arg1 && typeof(arg1) === "string" ? arg1: undefined;
        var nrColumns: number = 0;
        var attributeToColumnNr: {[attr: string]: number} = {};
        var headers: string[] = [];

        function dataToJSON(data: any[]): string {
            return data.map(function(item: any): string {
                return JSON.stringify(item);
            }).join("\n");
        }

        function toCSVString(v: any): string {
            if (typeof(v) !== "string") {
                return String(v);
            }
            if (/[\\",]/.test(v)) {
                return '"' + v.replace(/[\\",]/g, "\\$&") + '"';
            }
            return v;
        }

        function determineCsvHeaders(): void {
            for (var i: number = 0; i < arg2.length; i++) {
                var facetSpec: any = arg2[i];
                if (facetSpec instanceof Object && facetSpec !== null) {
                    var attr: any = singleton(facetSpec.attribute);
                    if (typeof(attr) === "number" || typeof(attr) === "boolean") {
                        attr = String(attr);
                    }
                    if (typeof(attr) === "string") {
                        var headerSpec: any = singleton(facetSpec.header);
                        var headerStr: string = typeof(headerSpec) === "string"? headerSpec: attr;
                        attributeToColumnNr[attr] = nrColumns;
                        headers.push(headerStr);
                        nrColumns++;
                    }
                }
            }
        }

        function dataToCSV(data: any[]): string {
            var rows: string[] = [];

            determineCsvHeaders();
            for (var i: number = 0; i < data.length; i++) {
                var item: any = data[i];
                var row: string[] = [];
                if (typeof(item) === "object" && item !== null) {
                    for (var attr in item) {
                        var cellValue: any = item[attr];
                        if (isSimpleValue(cellValue)){
                            var colNr: number;
                            if (attr in attributeToColumnNr) {
                                colNr = attributeToColumnNr[attr];
                            } else {
                                colNr = nrColumns++;
                                attributeToColumnNr[attr] = colNr;
                                headers[colNr] = attr;
                            }
                            row[colNr] = toCSVString(getDeOSedValue(cellValue));
                        }
                    }
                    rows.push(row.join(","));
                }
            }
            return headers.join(",") + "\n" + rows.join("\n");
        }

        function dataToString(data: any[]): string {
            if(fileType === "json")
                return dataToJSON(data);
            else if(fileType === "csv")
                return dataToCSV(data);
            else if(os.length == 1 && typeof(os[0]) === "string")
                return os[0];

            // other cases (try to concatenate as strings, if not successful,
            // convert as JSON).
            
            var outputStr: string = "";
                
            for(var i = 0, l = data.length ; i < l ; ++i) {
                var type: string = typeof(data[i]);
                if(type == "string" || type == "number" ||
                   type == "boolean")
                    outputStr += data[i];
                else
                    return dataToJSON(data);
            }

            return outputStr;
        }

        var os: any[] = ensureOS(result.value);
        if (os.length === 0) {
            return true;
        }
        var areaReferences: ElementReference[] = os.filter(function (elt: any): elt is ElementReference { return elt instanceof ElementReference; });
        var fileName: string = baseName;
        if(fileType && !/\.\w*/.test(fileName))
            fileName += "." + fileType;
        if (areaReferences.length > 0 && fileType === "png") {
            var area = allAreaMonitor.getAreaById(areaReferences[0].element);
            if (!(area instanceof DisplayArea)) {
                return false;
            }
            // perhaps add option { // Some (small) random image imagePlaceholder: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAABxJREFUeNpi+A8EDEgAzocx0BXgFsDQiqwAIMAAW3Aj3ZRED7gAAAAASUVORK5CYII=" }
            domtoimage.toBlob(area.display.frameDiv).then(function(blob) {
                saveAs(blob, fileName);
            }).catch(function (error) {
                console.error("Error while copying image:", error);
                return false;
            });
        } else if (areaReferences.length === 0) {
            saveAs(new Blob([dataToString(os)]), fileName);
        }

        return true;
    }
}
download.classConstructor = EvaluationDownload;

class PrintAreaTask implements PrintJob {
    constructor(public area: DisplayArea|undefined) {
    }

    getEmbeddingRect(): Rect {
        if (this.area === undefined || this.area.hasBeenDestroyed() || !(this.area.embedding instanceof DisplayArea)) {
            return {left: Number.MAX_SAFE_INTEGER, top: Number.MAX_SAFE_INTEGER, width: 0, height: 0};
        }
        if (this.area.embedding === undefined) {
            return {left: 0, top: 0, width: this.area.relative.width, height: this.area.relative.height};
        }
        var pos = this.area.embedding.getAbsolutePosition();
            return {left: pos.left, top: pos.top, width: this.area.embedding.relative.width, height: this.area.embedding.relative.height};
    }

    getRelative(): Relative {
        return this.area === undefined || this.area.hasBeenDestroyed()?
               undefined: this.area.relative;
    }

    getHTMLRepr(): string {
        return this.area !== undefined && !this.area.hasBeenDestroyed()?
               this.area.display.frameDiv.outerHTML: undefined;
    }
}

// Writing an area reference to this global function opens a new window, and
// queues a print job for that area. Writing true simply calls the print
// function for the main window.
class EvaluationPrintArea extends EvaluationFunctionApplication {
    eval(): boolean {
        return false;
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var pct = new PositionChangeTracker();
        var newValue: any[] = determineWrite([], result, mode, attributes, positions, pct);

        if (newValue.length === 1 && newValue[0] === true) {
            var message: EventObject = {
                type: ["Print"],
                subType: ["start"],
                time: [Date.now()]
            };
            queueEvent(new ImpersonatedDomEvent("print"), message, undefined,
                       constEmptyOS, undefined, constEmptyOS, constEmptyOS,
                       undefined, undefined, undefined, undefined, undefined);
            globalPrintTask.addPrintTask(undefined);
            return true;
        }

        function optionsToString(opt: {[attr: string]: string|number}): string {
            return Object.keys(opt).map(function(attr) {
                return attr + "=" + String(opt[attr]);
            }).join(",");
        }
        var winOptions: {[attr: string]: string|number} = {
            toolbar: "no",
            location: "no",
            directories: "no",
            status: "no",
            menubar: "no",
            scrollbars: "no",
            resizable: "no"
        };
        var win = window.open("", document.title, optionsToString(winOptions));

        globalPrintTask.setWindow(win);
        for (var i = 0; i < newValue.length; i++) {
            var element = newValue[i];
            if (element instanceof ElementReference) {
                var area: CoreArea = allAreaMonitor.getAreaById(element.getElement());
                if (area instanceof DisplayArea) {
                    // Note: window cannot be opened later.
                    globalPrintTask.addPrintTask(new PrintAreaTask(area));
                }
            }
        }
        return true;
    }
}
printArea.classConstructor = EvaluationPrintArea;

class EvaluationForeignInterfaceFunction extends EvaluationFunctionApplication {

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.constant = true;
        this.result.value = foreignInterfaceObjects;
    }

    eval(): boolean {
        return false;
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        console.log("TODO");
        return false;
    }
}
foreignFunctions.classConstructor = EvaluationForeignInterfaceFunction;

class EvaluationRemoteStatus extends EvaluationFunctionApplication {
    eval(): boolean {
        var result: NormalizedValue = undefined;

        if (this.arguments[0] !== undefined &&
              typeof(this.arguments[0].remoteStatus) === "string") {
            result = [{state: [this.arguments[0].remoteStatus]}];
        } else {
            result = constEmptyOS;
        }
        if (!valueEqual(this.result.value, result)) {
            this.result.value = result;
            return true;
        }
        return false;
    }
}
remoteStatus.classConstructor = EvaluationRemoteStatus;

class EvaluationLoginInfo extends EvaluationFunctionApplication {

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);

        var self = this;
        globalSystemEvents.addHandler("login", function(): void {
            self.markAsChanged();
        });
        globalSystemEvents.addHandler("logout", function(): void {
            self.markAsChanged();
        });
        this.constant = false;
    }

    eval(): boolean {
        var v: any = {
            username: gAppStateMgr.appStateInfo.owner
        };

        if (!objectEqual(v, this.result.value[0])) {
            this.result.value = [v];
            return true;
        }
        return false;
    }

    static loginWriteObjType: ValueTypeDescription = 
        vtd("av", {
            username: vtd("string"),
            password: [vtd("string")]
        });
    static createAccountWriteObjType: ValueTypeDescription = 
        vtd("av", {
            username: vtd("string"),
            password: [vtd("string")],
            email: [vtd("string"), vtd("undefined")]
        });

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var pct = new PositionChangeTracker();
        var newValue: any = determineWrite([], result, mode, attributes, positions, pct);
        var createAccount: boolean = this.arguments[0] !== undefined &&
              interpretedBoolMatch({createAccount: _}, this.arguments[0].value);

        if (!createAccount && newValue.length === 1 && EvaluationLoginInfo.loginWriteObjType.matches(newValue)) {
            var username: any = singleton(newValue[0].username);
            var password: any = singleton(newValue[0].password);
            gAppStateMgr.login(username, password);
        } else if (createAccount && newValue.length === 1 && EvaluationLoginInfo.createAccountWriteObjType.matches(newValue)) {
            var username: any = singleton(newValue[0].username);
            var password: any = singleton(newValue[0].password);
            var email: string = singleton(newValue[0].email);
            gAppStateMgr.createAccount(username, password, email);
        } else if (isFalse(result.value)) {
            gAppStateMgr.logout();
        }
        return true;
    }
}
loginInfo.classConstructor = EvaluationLoginInfo;
