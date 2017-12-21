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

/// <reference path="../query/fegValueIndexer.ts" />

abstract class EvaluationDataSource extends EvaluationFunctionApplication
    implements IndexerDataSupplier
{

    data: any[] = constEmptyOS;
    indexer: FEGValueIndexer = undefined;
    dataPathNode: PathNode = undefined;

    uri: any;
    sourceName: string = ""; // data source name

    revision: any; // latch value of 2nd arg when data was last refreshed

    queueRunning: boolean = true; // false when this node has stopped the queue

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.result = new Result(this.data);
        this.result.value = constEmptyOS;
        this.constant = false;
    }

    destroy(): void {
        if ("indexer" in this) {
            this.releaseDataPathNode();
            if (this.result.dataSource !== undefined) {
                this.result.dataSource.removeResultReceiver(this);
            }
            this.indexer.destroy();
            delete this.result.dataSource;
        }
        EvaluationDatasourceInfo.infoRemove(this.watcherId);
        if (!this.queueRunning) {
            resumeScheduledTasks();
            this.queueRunning = true;
        }
        super.destroy();
    }

    releaseDataPathNode(): void {
        if (this.dataPathNode != undefined) {
            this.indexer.decPathNodeTracing(this.dataPathNode);
            this.dataPathNode = undefined;
        }
    }

    infoUpdate(state: string, attributes: DataSourceAttributesInfo[], type: string, progress: any, info?: string): void {
        EvaluationDatasourceInfo.infoUpdate(
            this.watcherId,
            (this.uri instanceof NativeObjectWrapper? this.uri: this.sourceName),
            extractBaseName(this.sourceName),
            this.revision,
            Date.now(),
            state,
            attributes,
            info,
            type,
            progress
        );
    }

    resumeQueue(): void {
        if (!this.queueRunning) {
            resumeScheduledTasks();
            this.queueRunning = true;
        }
    }

    suspendQueue(): void {
        if (this.queueRunning) {
            suspendScheduledTasks();
            this.queueRunning = false;
        }
    }

    endedLoading(state: string, attributes: DataSourceAttributesInfo[]): void {
        this.infoUpdate(state, attributes, this.debugName(), undefined);
    }

    // TODO: Now always loads data into indexer. Not ideal when the original
    // data is first put through processing steps before being queried. Possible
    // solution: indexer after 'map' or whatever, or index this anyway and
    // use merge indexers.
    setData(data: any[], attributes: DataSourceAttributesInfo[]): void {
        this.data = data;
        this.endedLoading("loaded", attributes);
        if (this.dataSourceResultMode) {
            this.releaseDataPathNode();
            this.indexer.clear();
            if (this.data !== undefined) {
                for (var i: number = 0; i < data.length; i++) {
                    this.indexer.addRawObject(this.data[i], undefined);
                }
            }
        } else {
            this.result.value = data;
            this.informAllWatchers();
        }
    }

    // We assume that this always runs in dataSourceResultMode. Any node that
    // doesn't will see o(). A solution is to store dataPerFacet, and convert
    // that to data when needed, but keeping that much data around is a waste
    // at this moment.
    // TODO: write indexer that uses the arrays directly in the pathNode.
    setColumnarData(dataPerFacet: {[facetName: string]: any[]}, attributes: DataSourceAttributesInfo[]): void {
        this.endedLoading("loaded", attributes);
        this.indexer.clear();
        this.indexer.addColumnObjects(dataPerFacet);
    }

    dataPerFacet: {[facetName: string]: SimpleValue[]} = undefined;
    attributes: DataSourceAttributesInfo[] = undefined;
    nrDataRows: number = 0;
    topLevelDataElementId: number = undefined;

    provideDataSupplier(nrRows: number, dataPerFacet: {[facetName: string]: any[]},
                        attributes: DataSourceAttributesInfo[]): void {
        var topLevelData: any = {
            state: "loaded",
            fullName: (this.uri instanceof NativeObjectWrapper? this.uri.file.name: this.sourceName),
            name: extractBaseName(this.sourceName),
            revision: getDeOSedValue(this.revision),
            lastUpdate: Date.now(),
            attributes: attributes,
            data: []
        };

        this.dataPerFacet = dataPerFacet;
        this.nrDataRows = nrRows;
        this.attributes = attributes;
        this.releaseDataPathNode();
        this.indexer.clear();

        var rootPathId: number = this.indexer.qcm.getRootPathId();
        var dataPathId: number = this.indexer.qcm.allocatePathId(rootPathId, "data");
        this.topLevelDataElementId =
            this.indexer.setTopLevelAttributeValue(topLevelData, undefined);
        this.indexer.setDataSupplier(this);
        this.indexer.announceNewDataElementsForPathId(
            dataPathId, this.topLevelDataElementId, 0, nrRows);
        // don't release dataPathId: it can change the path id for "data"
        this.dataPathNode = this.indexer.pathNodesById[dataPathId];
        this.indexer.incPathNodeTracing(this.dataPathNode);

        this.endedLoading("loaded", attributes);
    }

    // datasource and datatable can switch mode, but aren't dataSourceAware
    // towards its inputs (so don't change them), and will always keep the
    // indexer.
    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.isActive() && this.dataSourceInput !== undefined) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                this.result.value = emptyDataSourceResult;
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                this.result.value = this.data;
                delete this.result.dataSource;
            }
            this.markAsChanged();
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    newDataSourceResult(v: any[]): void {
        Utilities.error("should not be called");
    }

    reextractData(): void {
        assert(false, "should not be called");
    }

    errorInLoading(errorMessage: string): void {
        if (!this.queueRunning) {
            resumeScheduledTasks();
            this.queueRunning = true;
        }
        this.infoUpdate("error", undefined, this.debugName(), undefined, errorMessage);
    }

    // Filling path nodes only works for columns from a csv file under data:

    canFillPathNode(pathNode: PathNode): boolean {
        var path: string[] = this.indexer.qcm.getPathStrings(pathNode.pathId);

        return (path.length === 2 && path[0] === "data" && path[1] in this.dataPerFacet);
    }

    fillPathNode(pathNode: PathNode, ids: SupplierDataElementIdMappingRange[]): void {
        var path: string[] = this.indexer.qcm.getPathStrings(pathNode.pathId);
        // this.indexer.announceNewDataElementsForPathId(pathNode.pathId, 0, this.nrDataRows);

        if (path.length === 2 && path[0] === "data") {
            var columnData: any[] = this.dataPerFacet[path[1]];
            if (columnData !== undefined) {
                for (var i: number = 0; i < ids.length; i++) {
                    var rangeMap = ids[i];
                    this.indexer.addColumnRange(
                        pathNode, columnData.slice(rangeMap.rowNr, rangeMap.rowNr + rangeMap.nrDataElements),
                        rangeMap.firstDataElementId);
                }
            }
        }
    }

    unloadPathNode(pathNode: PathNode): void {
        // Not needed; all data is kept in memory
    }

    // TODO: longer path names
    public getRawDataDescription(): RawDataDescription {
        var values: SupplierDataPath[] = [];
        var pathObj: string[][] = [];

        for (var i = 0; i < this.attributes.length; i++) {
            var attr = this.attributes[i];
            var indexedValues = attr.uniqueValues === undefined? undefined:
                                attr.uniqueValues.slice(0).sort(compareSimpleValues);
            var compressedData = compressRawData(this.dataPerFacet[attr.name[0]], indexedValues);
            values.push({
                path: attr.name,
                indexedValues: indexedValues,
                pathValuesRanges: compressedData
            });
            pathObj.push(this.attributes[i].name);
        }
        return [{
            mapping: {
                rowNr: 0,
                nrDataElements: this.nrDataRows,
                firstDataElementId: 0,
                paths: pathObj
            },
            values: values
        }];
    }
}

//
// 'datasource' provides access to an external data source
//
// a data-source is identified by a name, which is interpreted as a file-name.
//
// the implementation below expects/assumes that the included file is prefixed
//   with 'g_datasource.<source-name> =", where <source-name> is also the
//   filename (without the .js), e.g. file xxx.js would contain
//   var g_datasource.xxx = o({...}, ...);
//   and would be used as [datasource, "xxx"]
//
// a refresh can be affected by changing the value of the optional 2nd argument
//
class EvaluationDataSourceFunction extends EvaluationDataSource {

    scriptElem: HTMLScriptElement = undefined;
    baseName: string;
    windowErrorHandler: any;
    errorTriggered: boolean;

    actualSrcHint: string; // which resource was actually used

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.dataSourceAware = false;
    }

    updateInput(pos: any, result: Result): void {
        // pos 0 is the datasource name
        if (pos === 0) {
            var sourceNameArr: string[];
            var sourceName: string;
            sourceNameArr = (typeof(result) !== "object") ? [] :
                ((result.value instanceof Array) ? result.value : []);
            if ((sourceNameArr.length === 1) &&
                (typeof(sourceNameArr[0]) === "string")) {
                sourceName = sourceNameArr[0];
                if (sourceName !== this.sourceName) {
                    this.sourceName = sourceName;
                    this.reload();
                }
            } else {
                sourceName = undefined;
                this.data = constEmptyOS;
                this.markAsChanged();
            }
        } else if (pos === 1) {
            if (!objectEqual(result.value, this.revision)) {
                this.revision = result.value;
                this.reload();
            }
        }
    }

    eval(): boolean {
        if (this.dataSourceResultMode) {
            return true;
        } else if (!objectEqual(this.data, this.result.value)) {
            this.result.value = this.data;
            return true;
        }
        return false;
    }

    // callback for <script> load error - print an error to the console and
    //  set an error state on the datasourceInfo element
    onLoadError(err: any): void {
        var errDetail: string = "(" + this.sourceName + ")";

        window.onerror = this.windowErrorHandler;
        this.errorTriggered = true;

        if (typeof(err) === "string") {
            errDetail += ": " + err;
        }
        this.errorInLoading(errDetail);
        console.log("EvaluationDataSourceFunction: error: failed to load '" +
                    this.actualSrcHint + "' " + errDetail);
    }

    // callback for <script> tag - load complete; also gets called when there
    // is a syntax error, which is why onLoadError() sets the flag
    // this.errorTriggered.
    //
    // call this.markAsChanged() to get eval() called and notify watchers
    onLoad(): void {
        window.onerror = this.windowErrorHandler;

        this.resumeQueue();
        if (!this.errorTriggered) {
            if (this.baseName !== undefined) {
                this.data = g_datasource[this.baseName];
            } else {
                this.data = g_datasource[this.sourceName];
            }
            if (this.data !== undefined) {
                this.setData(normalizeObject(this.data), undefined);
            }
            this.endedLoading("loaded", undefined);
        }
    }

    // refresh the datasource
    reload(): void {
        this.suspendQueue();
        if (typeof(requireFS()) !== "undefined") {
            this.nodejsReload();
        } else {
            this.browserReload();
        }
    }

    //
    // (re)load the datasource by adding a <script> element at the end
    //  of <head>. If reloading, the previous <script> element is removed first
    //
    browserReload(): void {
        var self = this;
        var scriptElem: HTMLScriptElement;
        var srcStr: string;

        srcStr = this.makeDataSrc();

        this.actualSrcHint = srcStr;

        this.infoUpdate(this.scriptElem === undefined? "initialLoad": "reload",
                        undefined, this.debugName(), 0);

        if (typeof(this.scriptElem) !== "undefined") {
            this.scriptElem.parentNode.removeChild(this.scriptElem);
            this.scriptElem = undefined;
        }

        // window.onerror is called when there is a syntax error in the js file
        this.windowErrorHandler = window.onerror;
        this.errorTriggered = false;
        window.onerror = function (err) {
            self.onLoadError(err);
        }

        scriptElem = document.createElement("script");
        scriptElem.type = "text/javascript";
        scriptElem.onerror = function (err) {
            self.onLoadError(err);
        }
        scriptElem.onload = function () {
            self.onLoad();
        }

        var head: Node = document.head;
        if (typeof(head) === "undefined") {
            head = document.getElementsByTagName("head")[0];
        }

        this.scriptElem = scriptElem;

        head.appendChild(this.scriptElem);

        this.scriptElem.src = srcStr;
    }

    //
    // construct a filename from 'this.sourceName', read it into memory,
    //  parse it to a name and a JSON object. assign the parsed JSON object
    //  into g_datasource[<name>]
    //
    // XXX the format of the datasource file must follow a specific, rather ugly
    //     pattern
    // XXX the datasource file must be located at a specific location relative
    //      to the location of the script containing this code (__dirname)
    //
    nodejsReload(): void {
        var self = this;
        var fn: string = this.getDataSourceFilename();

        var fs = requireFS();

        this.infoUpdate(
            this.actualSrcHint === undefined? "initialLoad": "reload",
            undefined, this.debugName(), 0
        );

        this.actualSrcHint = fn;

        fs.readFile(fn, 'utf8', function (err: any, data: any) {
            if  (err) {
                self.onLoadError(err);
            } else {
                var prefixLen: number = data.indexOf("[");
                if (prefixLen < 0) {
                    self.onLoadError("Invalid Format: '['");
                    return;
                }
                var prefix: string = data.slice(0, prefixLen);

                var matchList: string[];

                var re: RegExp;
                re = new RegExp(
                    '^g_datasource[.]([a-zA-Z0-9_]*)[ \t\n]*=[ \t\n]*$',
                    'm'
                );
                matchList = re.exec(prefix);

                if (matchList.length !== 2) {
                    self.onLoadError("Invalid Format: datasource name");
                    return;
                }

                data = data.slice(prefixLen);

                // remove trailing white space and ';'
                re = new RegExp('^[ \t\n;]*$', 'm');

                var suffLen: number;
                for (suffLen = 0; suffLen < data.length; suffLen++) {
                    var result: any;

                    result = re.exec(data.slice(-suffLen - 2, -1));

                    if (result === null) {
                        break;
                    }

                    // the anchors ^$ may match a single line, rather than
                    //  the complete string
                    if (result[0].length < suffLen) {
                        break;
                    }
                }

                data  = data.slice(0, -suffLen - 1);

                var varName: string = matchList[1];

                try {
                    g_datasource[varName] = JSON.parse(data);
                } catch(ex) {
                    self.onLoadError("Invalid format: not JSON");
                    return;
                }

                self.onLoad();
            }
        });
    }

    // construct the data file url; assumptions about file/server structure are
    //  hard-coded below, unless the source name starts with an explicit
    //  protocol (although the .js must still be left off).
    makeDataSrc(): string {
        var re = new RegExp('^(file|https?|[st]?ftp)://.*/(.*)\.js$', 'm');
        var matchList = re.exec(this.sourceName);

        if (matchList !== null && matchList.length === 3) {

            this.baseName = matchList[2];
            return this.sourceName;

        } else {

            var loc: LocationObject = getWindowLocation();
            var stripCount: number;
            var proto = loc.protocol;

            if (proto === "file:") {
                stripCount = 5;
            } else {
                stripCount = 1;
            }

            var path = loc.pathname.split('/').slice(0, -stripCount).join('/');

            return proto + "//" + loc.host + path + "/data/" +
                encodeURIComponent(this.sourceName + ".js");
        }
    }

    // construct data file name;
    // assumes specific location of script and data
    getDataSourceFilename(): string {
        var path = requirePath();

        var scriptPath = __dirname;
        var basePath = scriptPath.split(path.sep).slice(0, -4).join(path.sep);
        return [basePath, "data", this.sourceName + ".js"].join(path.sep);
    }

    debugName(): string {
        return "datasource";
    }
}
datasource.classConstructor = EvaluationDataSourceFunction;

// jsonp should direct data into members of this object:
var g_datasource: {[src: string]: any} = {};

//
// datasourceInfo - provide some information about data sources
//
// datasourceInfo maintains a cdl o/s, with a single element per distinct
//  datasource.
class DataSourceInfo {
    // data source name, as specified in the datasource argument
    name: (string|NativeObjectWrapper)[];
    // The display name for the data source (path and extension removed)
    baseName: string[];
    //the last revision used to refresh the datasource
    revision: any[];
    // the time of last refresh (ms since 1/1/1970)
    refreshTime: number[];
    // 'initialLoad'/'reload'/'loaded'/'error'
    state: string[];
    // Ordered set of attributes found in the data, plus information about
    // each attribute
    attributes: DataSourceAttributesInfo[];
    // Extra info, not used
    info: string[];
    // Type of the data source: 
    type: string[];
    // Progress of loading/writing
    progress: number[];
};

class EvaluationDatasourceInfo extends EvaluationFunctionApplication {

    static info: {[uid: number]: DataSourceInfo} = {};
    static instances: {[wid: number]: EvaluationFunctionApplication} = {};

    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);
        this.constant = false;
        EvaluationDatasourceInfo.instances[this.watcherId] = this;
        this.result.value = constEmptyOS;
    }

    destroy(): void {
        delete EvaluationDatasourceInfo.instances[this.watcherId];
        super.destroy();
    }

    eval(): boolean {
        var infoList: any[] = [];

        var sinfo: {[uid: number]: DataSourceInfo};
        sinfo = EvaluationDatasourceInfo.info;

        for (var uid in sinfo) {
            infoList.push(sinfo[uid]);
        }

        this.result = new Result(infoList);

        return true;
    }

    debugName(): string {
        return "datasourceInfo";
    }


    static infoUpdate(uid: number, name: string | NativeObjectWrapper, baseName: string,
                      revision: any[], refreshTime: number, state: string,
                      attributes: DataSourceAttributesInfo[], info: string,
                      type: string, progress: number
                     ): void
    {
        var minfo: DataSourceInfo = new DataSourceInfo();

        minfo.name = [name];
        minfo.baseName = [baseName];
        minfo.revision = revision;
        minfo.refreshTime = [refreshTime];
        minfo.state = [state];
        minfo.attributes = attributes;
        minfo.type = [type];
        minfo.progress = progress === undefined? constEmptyOS: [progress];
        if (info !== undefined) {
            minfo.info = [info];
        }

        EvaluationDatasourceInfo.info[uid] = minfo;

        EvaluationDatasourceInfo.notifyAll();
    }

    static infoRemove(uid: number) {
        if (uid in EvaluationDatasourceInfo.info) {
            delete EvaluationDatasourceInfo.info[uid];
            EvaluationDatasourceInfo.notifyAll();
        }
    }

    static notifyAll(): void {
        for (var wid in EvaluationDatasourceInfo.instances) {
            EvaluationDatasourceInfo.instances[wid].markAsChanged();
        }
    }

    static hasDataloadInProgress(): boolean {
        for (var uid in EvaluationDatasourceInfo.info) {
            var state = EvaluationDatasourceInfo.info[uid].state[0];
            if ((state === "initialLoad") || (state === "reload")) {
                return true;
            }
        }
        return false;
    }
}
datasourceInfo.classConstructor = EvaluationDatasourceInfo;

enum DataSourceFileType {
    unknown,
    text,
    csv,
    json,
    // jsonStat
}

var dataTableMaxNrRows: number = undefined;
var dataTableMaxNrColumns: number = undefined;
var dataTableFacetRestriction: string = undefined;

class EvaluationDataTable extends EvaluationDataSource
    implements IndexerDataSupplier
{
    client: XMLHttpRequest;
    fileReader: FileReader;
    errorInLoad: boolean = false;
    fileMode: DataSourceFileType;
    dataParsed: boolean = false;
    uri: any = undefined;
    revision: number = 0;
    onlyFirstBlock: boolean = true;
    customArg: any = undefined;
    queueRunning: boolean = true; // false when this node has stopped the queue

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.indexer = new FEGValueIndexer(globalInternalQCM);
        this.indexer.addPath(globalInternalQCM.getRootPathId());
        this.result.dataSource = IndexerDataSource.createIndexerDataSourceRoot(this.indexer, this, this.uri);
        this.result.value = emptyDataSourceResult;
        this.dataSourceResultMode = true;
    }

    updateInput(i: any, result: Result): void {
        var self = this;

        function checkValue<T>(orig: T, attr: string): T {
            var newValue: any;

            if (typeof(self.customArg) !== "object" ||
                  self.customArg instanceof Array ||
                  self.customArg instanceof NonAV ||
                  self.customArg[attr] === undefined) {
                return orig;
            }
            newValue = getDeOSedValue(self.customArg[attr]);
            self.revision++;
            self.markAsChanged();
            return newValue;
        }

        this.arguments[i] = result;
        if (result === undefined) {
            this.inputs[i].removeWatcher(this, false, false);
            this.inputs[i] = undefined;
        } else if (i === 0) {
            var arg: any = getDeOSedValue(result.value);
            if (this.result.dataSource instanceof IndexerDataSource) {
                (<IndexerDataSource>this.result.dataSource).name = arg;
            }
            if (!(arg instanceof Array) && this.uri !== arg) {
                this.uri = arg;
                this.sourceName = this.uri instanceof NativeObjectWrapper? this.uri.file.name: this.uri;
                this.markAsChanged();
            }
        } else if (i === 1) {
            if (!objectEqual(result.value, this.customArg)) {
                this.customArg = getDeOSedValue(result.value);
                this.onlyFirstBlock = checkValue(this.onlyFirstBlock, "onlyFirstBlock");
            }
        }
    }

    setResult(state: string, info: string, attributes: DataSourceAttributesInfo[], data: any[]): void {
        var resultObject: any = {
            state: [state],
            fullName: [this.uri],
            name: [extractBaseName(this.sourceName)],
            revision: ensureOS(this.revision),
            lastUpdate: [Date.now()]
        };

        if (info !== undefined) {
            resultObject.info = info;
        } 
        if (attributes !== undefined) {
            resultObject.attributes = attributes;
        } 
        if (data !== undefined) {
            resultObject.data = data;
        } 
        this.result.set([resultObject]);
    }

    resumeQueue(): void {
        if (!this.queueRunning) {
            resumeScheduledTasks();
            this.queueRunning = true;
        }
    }

    suspendQueue(): void {
        if (this.queueRunning) {
            suspendScheduledTasks();
            this.queueRunning = false;
        }
    }

    abort(): void {
        this.errorInLoad = true;
        console.log("load aborted", getDeOSedValue(this.arguments[0].value));
        this.setResult("error", "load aborted", undefined, undefined);
        this.infoUpdate("error", [], "datatable", undefined, "load aborted");
        this.client = undefined;
        this.resumeQueue();
    }

    error(errorEvent: ErrorEvent): void {
        var uri: string = getDeOSedValue(this.arguments[0].value);

        this.errorInLoad = true;
        console.log("error loading", uri);
        this.setResult("error", "no such file: " + this.sourceName, undefined, undefined);
        this.infoUpdate("error", [], "datatable", undefined, "no such file: " + this.sourceName);
        this.client = undefined;
        this.resumeQueue();
    }

    // These two regular expressions match anglo and euro number formats, and
    // put the (optional) sign in the first field, the leading digits in the
    // second field, the remaining integer digits in the third field (where it's
    // safe to remove comma or dot), and the optional fractional part in the
    // fifth field (including leading dot/comma).
    static angloNumberFormat = /^([+-])?([0-9][0-9]?[0-9]?)((,[0-9][0-9][0-9])*)(\.[0-9]*)?$/;
    static euroNumberFormat = /^([+-])?([0-9][0-9]?[0-9]?)((\.[0-9][0-9][0-9])*)(,[0-9]*)?$/;
    static dateTest = /^[0-9][0-9]?[/-][0-9][0-9]?[/-][0-9][0-9][0-9][0-9]$/;

    load(response: string, async: boolean): void {
        if (this.fileMode === DataSourceFileType.unknown) {
            var firstChar: string = response[0];
            if (firstChar === '[' || firstChar === '{' || firstChar === ' ') {
                this.fileMode = DataSourceFileType.json;
            } else {
                this.fileMode = DataSourceFileType.text;
            }
        }
        switch (this.fileMode) {
          case DataSourceFileType.json:
            this.loadJSON(response);
            break;
        //   case DataSourceFileType.jsonStat:
        //     this.loadJSONStat(response);
        //     break;
          default:
            this.loadMatrix(response);
            break;
        }
        if (async) {
            this.resumeQueue();
            this.informAllWatchers();
        }
    }

    loadJSON(response: string): void {
        var data: any[];
        var attributeToIndex: {[attr: string]: number} = {};
        var attributes: DataSourceAttributesInfo[] = [];
        var columnHeaders: string[] = [];
        var type: string[] = [];
        var typeFrequencies: any[] = [];
        var nrColumns: number = 0;
        var min: number[] = [];
        var max: number[] = [];
        var uniqueValues: any[][] = [];
        var valueCount: {[v: string]: number}[] = [];
        var integerValued: boolean[] = [];
        var dataSize: number = 0;
        var dataPerFacet: {[facetName: string]: any[]} = {};
        var useDataSupplyMechanism: boolean = true;

        try {
            // First try to parse it as one line
            data = ensureOS(JSON.parse(response));
        }
        catch (ignoreError) {
            try {
                // On failure, split the data into lines, and JSON.parse them
                // individually; skip empty lines and lines starting with the
                // JS comment symbol
                data = response.split(/[\n\r]+/).map(function(line: string, lineNr: number): any {
                    if (line === "" || line.startsWith("//")) {
                        return undefined;
                    }
                    try {
                        return JSON.parse(line);
                    } catch (err) {
                        throw err + " in line " + String(lineNr + 1);
                    }
                });
            } catch (errMsg) {
                this.setResult("error", errMsg, undefined, undefined);
                return;
            }
        }
        var maxExpectedUniqueValues: number = Math.max(data.length / 50, 12 * Math.log(data.length));
        dataPerFacet["recordId"] = [];
        for (var i: number = 0; i < data.length; i++) {
            var obj: any = data[i];
            var empty: boolean = true;
            for (var attr in obj) {
                var v_ij: any = obj[attr];
                var j: number = attributeToIndex[attr];
                if (j === undefined) {
                    j = nrColumns++;
                    attributeToIndex[attr] = j;
                    type[j] = "undefined";
                    typeFrequencies[j] = {
                        number: 0,
                        string: 0,
                        object: 0,
                        undefined: 0,
                        boolean: 0,
                        currency: 0
                    };
                    uniqueValues[j] = [];
                    valueCount[j] = {};
                    integerValued[j] = true;
                    columnHeaders[j] = attr;
                    dataPerFacet[attr] = [];
                }
                var type_j: string = type[j];
                if (v_ij !== null && v_ij !== undefined &&
                      (!(v_ij instanceof Object) ||
                        (v_ij instanceof Array && v_ij.length === 1))) {
                    // Determine type and value of cell i,j; note that unlike
                    // csv, v_ij can be an array or object. The latter case is
                    // not handled.
                    if (v_ij instanceof Array) {
                        v_ij = v_ij[0];
                    }
                    var type_ij: string = typeof(v_ij);
                    if (type_ij !== "number") {
                        var n_ij: number = Number(v_ij);
                        if (!isNaN(n_ij)) {
                            v_ij = n_ij;
                            type_ij = "number";
                        }
                    }
                    if (integerValued[j] &&
                         (type_ij !== "number" || v_ij !== Math.floor(v_ij))) {
                        integerValued[j] = false;
                    }
                    empty = false;
                    dataPerFacet[attr][dataSize] = v_ij;
                } else {
                    if (v_ij !== null && v_ij !== undefined) {
                        // It's an AV or an array
                        useDataSupplyMechanism = false;
                    }
                    type_ij = "undefined";
                }
                // Determine attributes of column j
                if (type_j !== type_ij) {
                    if (type_j === "undefined") {
                        type[j] = type_ij;
                        if (type_ij === "number") {
                            min[j] = v_ij;
                            max[j] = v_ij;
                        }
                        if (type_ij === "object") {
                            uniqueValues[j] = undefined;
                            valueCount[j] = undefined;
                        }
                    } else if (type_j !== "mixed") {
                        type[j] = "mixed";
                        min[j] = undefined;
                        max[j] = undefined;
                    }
                } else if (type_ij === "number") {
                    if (min[j] > v_ij)
                        min[j] = v_ij;
                    if (max[j] < v_ij)
                        max[j] = v_ij;
                }
                typeFrequencies[j][type_ij]++;
                if (valueCount[j] !== undefined) {
                    if (v_ij in valueCount[j]) {
                        valueCount[j][v_ij]++;
                    } else if (type_ij !== "undefined") {
                        if (uniqueValues[j].length > maxExpectedUniqueValues) {
                            // Stop counting at size dependent number of different values
                            uniqueValues[j] = undefined;
                            valueCount[j] = undefined;
                        } else {
                            uniqueValues[j].push(v_ij);
                            valueCount[j][v_ij] = 1;
                        }
                    }
                }
            }
            if (!empty) {
                dataPerFacet["recordId"][dataSize] = dataSize;
                dataSize++;
            }
        }
        for (var j: number = 0; j < nrColumns; j++) {
            var name: string = columnHeaders[j];
            var attrInfo: DataSourceAttributesInfo = {
                name: name === undefined? []: [name],
                type: type[j] === "number" && integerValued[j]?
                      ["integer"]: [type[j]],
                typeCount: normalizeObject(typeFrequencies[j])
            };
            if (min[j] !== undefined) {
                attrInfo.min = [min[j]];
                attrInfo.max = [max[j]];
            }
            if (uniqueValues[j] !== undefined) {
                attrInfo.uniqueValues = uniqueValues[j];
            }
            attributes.push(attrInfo);
        }
        attributes.push({
            name: ["recordId"],
            type: ["integer"],
            min: [1],
            max: [data.length],
            typeCount: [{
                number: [data.length],
                string: [0],
                object: [0],
                undefined: [0],
                boolean: [0],
                currency: [0]
            }]
        });
        this.endedLoading("loaded", attributes);
        if (this.arguments[1] !== undefined &&
              isTrue(interpretedQuery({noIndexer: _}, this.arguments[1].value))) {
            this.indexer.destroy();
            delete this.indexer;
            delete this.result.dataSource;
            this.dataSourceResultMode = false;
            this.result.value = [{
                state: "loaded",
                fullName: (this.uri instanceof NativeObjectWrapper? this.uri.file.name: this.sourceName),
                name: extractBaseName(this.sourceName),
                revision: getDeOSedValue(this.revision),
                lastUpdate: Date.now(),
                attributes: attributes,
                data: normalizeObject(data)
            }];
            this.endedLoading("loaded", attributes);
            this.informAllWatchers();
        } else if (useDataSupplyMechanism) {
            this.dataPerFacet = dataPerFacet;
            this.provideDataSupplier(dataSize, dataPerFacet, attributes);
        } else {
            this.indexer.clear();
            this.indexer.addRawObject({
                attributes: attributes,
                data: data
            }, undefined);
            this.endedLoading("loaded", attributes);
        }
    }

    // loadJSONStat(response: string): void {
    // }

    loadMatrix(response: string): void {

        function isHeaderRow(r: string[]): boolean {
            return r.every(s => s !== undefined && /[^0-9]/.test(s));
        }

        function isEmptyRow(r: string[]): boolean {
            return r.every(s => s === undefined);
        }

        function findHeaders(m: string[][]): string[][] {
            var headerStart: number = 0;

            while (headerStart < m.length - 2 && isEmptyRow(m[headerStart])) {
                headerStart++;
            }
            while (headerStart < m.length - 2 &&
                   m[headerStart].length < m[headerStart + 1].length &&
                   isHeaderRow(m[headerStart + 1])) {
                headerStart++;
            }
            return headerStart === 0? m: m.slice(headerStart);
        }

        var matrix: string[][] = findHeaders(this.parseResponse(response));
        var columnHeaders: string[] = matrix[0].map(function(value: string, i: number): string {
            return value === undefined? "column " + i: value;
        });
        var currencySymbols = { "¥": 1, "$": 1, "£": 1, "€": 1 };
        var attributes: DataSourceAttributesInfo[] = [];
        var dataPerFacet: {[facetName: string]: any[]} = {};
        var maxExpectedUniqueValues: number = 12 * Math.log(matrix.length - 1);
        var recordIds: number[] = [];
        var facetRestrictionQuery: any = undefined;
        var nrRows = dataTableMaxNrRows !== undefined && dataTableMaxNrRows < matrix.length?
                     dataTableMaxNrRows: matrix.length - 1;
        var stringCache = new Map<string, string>();
        var originalAttributes: {[attr: string]: string} = { recordId: "recordId" };
        var numTest1 = EvaluationDataTable.angloNumberFormat;
        var numTest2 = EvaluationDataTable.euroNumberFormat;
        var dateTest = EvaluationDataTable.dateTest;
        var possibleDate: boolean[] = [];
        var fixedUpNames: string[] = [];

        function fixUpAttribute(attr: string): string {
            if (attr === "") {
                attr = "unknown";
            }
            if (!(attr in originalAttributes)) {
                originalAttributes[attr] = attr;
                return attr;
            }
            var suffix: number = 0;
            var nAttr: string;
            do {
                suffix++;
                nAttr = attr + " " + suffix;
            }
            while (nAttr in originalAttributes);
            originalAttributes[nAttr] = attr;
            return nAttr;
        }

        // Removes the currency marking from the column, and puts back the
        // original strings.
        function cancelCurrency(row: number, column: any[], j: number): void {
            for (var i: number = 0; i < row - 1; i++) {
                column[i] = matrix[i + 1][j];
            }
        }

        function convertDates(): void {
            var min1 = Number.MAX_VALUE, min2 = Number.MAX_VALUE, min3 = Number.MAX_VALUE;
            var max1 = 0, max2 = 0, max3 = 0;
            var dateSplit = /^([0-9][0-9]?)[/-]([0-9][0-9]?)[/-]([0-9][0-9][0-9][0-9])$/;
            var fmt: (matches: RegExpExecArray) => number;

            function dmy(matches: RegExpExecArray): number {
                var date: Date = new Date(1, 0);

                date.setDate(Number(matches[1]));
                date.setMonth(Number(matches[2]) - 1);
                date.setFullYear(Number(matches[3]));
                return date.getTime() / 1000;
            }

            function mdy(matches: RegExpExecArray): number {
                var date: Date = new Date(1, 0);

                date.setDate(Number(matches[2]));
                date.setMonth(Number(matches[1]) - 1);
                date.setFullYear(Number(matches[3]));
                return date.getTime() / 1000;
            }

            function ymd(matches: RegExpExecArray): number {
                var date: Date = new Date(1, 0);

                date.setDate(Number(matches[3]));
                date.setMonth(Number(matches[2]) - 1);
                date.setFullYear(Number(matches[1]));
                return date.getTime() / 1000;
            }

            for (var j = 0; j < possibleDate.length; j++) {
                if (possibleDate[j]) {
                    for (var i: number = 1; i <= nrRows; i++) {
                        var v_ij: any = matrix[i][j];
                        if (typeof(v_ij) === "string") {
                            var matches = dateSplit.exec(v_ij);
                            if (matches !== null) {
                                var f1 = Number(matches[1]);
                                var f2 = Number(matches[2]);
                                var f3 = Number(matches[3]);
                                if (f1 > max1) {
                                    max1 = f1;
                                }
                                if (f1 < min1) {
                                    min1 = f1;
                                }
                                if (f2 > max2) {
                                    max2 = f2;
                                }
                                if (f2 < min2) {
                                    min2 = f2;
                                }
                                if (f3 > max3) {
                                    max3 = f3;
                                }
                                if (f3 < min3) {
                                    min3 = f3;
                                }
                            }
                        }
                    }
                }
            }
            if ((12 < max1 && max1 <= 31 && max2 <= 12 && 1500 <= max3 && max3 <= 2100) ||
                (max1 === min1 && min2 === 1 && max2 === 12 && 1500 <= max3 && max3 <= 2100)) {
                fmt = dmy;
            } else if ((12 < max2 && max2 <= 31 && max1 <= 12 && 1500 <= max3 && max3 <= 2100) ||
                       (max2 === min2 && min1 === 1 && max1 === 12 && 1500 <= max3 && max3 <= 2100)) {
                fmt = mdy;
            } else if ((12 < max3 && max3 <= 31 && max2 <= 12 && 1500 <= max1 && max1 <= 2100) ||
                       (max3 === min3 && min2 === 1 && max2 === 12 && 1500 <= max1 && max1 <= 2100)) {
                fmt = ymd;
            } else {
                return;
            }
            for (var j = 0; j < possibleDate.length; j++) {
                if (possibleDate[j]) {
                    var min = Number.MAX_VALUE;
                    var max = -Number.MAX_VALUE;
                    var attr = attributes[j];
                    var typeCount = attr.typeCount[0];
                    var column = dataPerFacet[fixedUpNames[j]];
                    attributes[j].type = ["date"];
                    typeCount.date = typeCount.string;
                    typeCount.string = [0];
                    typeCount.nrUniqueValuesPerType[0].date = typeCount.nrUniqueValuesPerType[0].string;
                    typeCount.nrUniqueValuesPerType[0].string = [0];
                    for (var i: number = 1; i <= nrRows; i++) {
                        var v_ij: any = matrix[i][j];
                        if (typeof(v_ij) === "string") {
                            var matches = dateSplit.exec(v_ij);
                            var conv = fmt(matches);
                            column[i - 1] = conv;
                            if (conv < min) {
                                min = conv;
                            }
                            if (conv > max) {
                                max = conv;
                            }
                        }
                    }
                    attributes[j].min = [min];
                    attributes[j].max = [max];
                    if (attributes[j].uniqueValues !== undefined) {
                        attributes[j].uniqueValues = attributes[j].uniqueValues.map((v: any): any =>
                            typeof(v) === "string"? fmt(dateSplit.exec(v)): v
                        );
                    }
                }
            }
        }

        function convertNumberFormat(numStr: string): any {
            var matches: string[];

            if ((((matches = numTest1.exec(numStr)) !== null) ||
                ((matches = numTest2.exec(numStr)) !== null))) {
               var convStr: string = matches[1] === undefined? "": matches[1];
               convStr += matches[2];
               if (matches[3] !== undefined) {
                   convStr += matches[3].replace(/,/g, "");
               }
               if (matches[5] !== undefined) {
                   convStr += "." + matches[5].substr(1);
               }
               return Number(convStr);
           }
           return numStr;
        }

        this.dataParsed = true;
        if (this.onlyFirstBlock) {
            for (var i = 1; i <= nrRows; i++) {
                var row_i: string[] = matrix[i];
                if (row_i.every(s => s === undefined)) {
                    nrRows = i - 1;
                    break;
                }
            }
        }
        if (dataTableFacetRestriction !== undefined) {
            var facetqs = dataTableFacetRestriction.split(",");
            facetRestrictionQuery  = {};
            for (var i = 0; i < facetqs.length; i++) {
                var facetq = facetqs[i];
                var qvalue: any = facetq[0] === "+"? new RangeValue([1,Infinity], true, false): 0;
                var qattr: string = facetq.slice(1);
                facetRestrictionQuery[qattr] = qvalue;
            }
        }
        for (var j: number = 0; j < columnHeaders.length; j++) {
            var originalName: string = columnHeaders[j];
            var name: string = fixUpAttribute(originalName);
            var column: any[] = new Array(nrRows);
            // Maintain type, min, max, etc. information
            var type_j: string = "undefined";
            var currency_j: string = undefined;
            var integerValued_j: boolean = true;
            var min_j: number = undefined;
            var max_j: number = undefined;
            var valueCount_j = new Map<any, number>();
            var uniqueValues_j: any[] = [];
            var possibleDateCount: number = 0;
            var typeCount: any = {
                number: 0,
                string: 0,
                object: 0,
                undefined: 0,
                boolean: 0,
                currency: 0,
                nrPositive: 0,
                nrNegative: 0,
                nrUnique: 0,
                nrUniqueValuesPerType: {
                    number: 0,
                    string: 0,
                    object: 0,
                    boolean: 0,
                    currency: 0
                }
            };
            fixedUpNames.push(name);
            for (var i: number = 0; i < nrRows; i++) {
                var v_ij: any = matrix[i + 1][j];
                if (v_ij !== "NULL" && v_ij !== "" &&
                      v_ij !== "undefined" && v_ij !== undefined) {
                    // Determine type and value of cell i,j
                    var n_ij: number = Number(v_ij);
                    var type_ij: string;
                    var currency_ij: string = undefined;
                    // Try more costly currency and locale conversions only when
                    // the column is not mixed already.
                    if (type_j !== "mixed" && v_ij !== undefined && isNaN(n_ij)) {
                        currency_ij = v_ij.charAt(0);
                        if (currency_ij in currencySymbols) {
                            var numStr: string = v_ij.substr(1);
                            n_ij = Number(numStr);
                            if (isNaN(n_ij)) {
                                n_ij = convertNumberFormat(numStr);
                            }
                        } else {
                            currency_ij = undefined;
                            n_ij = convertNumberFormat(v_ij);
                        }
                    }
                    if (!isNaN(n_ij) && n_ij !== -Infinity && n_ij !== Infinity) {
                        v_ij = n_ij;
                        if (currency_ij === undefined) {
                            type_ij = "number";
                            column[i] = n_ij;
                        } else {
                            type_ij = "currency";
                            if (currency_j === undefined) {
                                currency_j = currency_ij;
                                column[i] = n_ij;
                            } else if (currency_j !== "" &&
                                       currency_j !== currency_ij) {
                                cancelCurrency(i, column, j);
                                currency_j = "";
                                type_ij = "string";
                                column[i] = v_ij;
                            } else {
                                column[i] = n_ij;
                            }
                        }
                        if (integerValued_j && n_ij !== Math.floor(n_ij)) {
                            integerValued_j = false;
                        }
                    } else {
                        type_ij = "string";
                        if (stringCache.has(v_ij)) {
                            v_ij = stringCache.get(v_ij);
                        } else {
                            stringCache.set(v_ij, v_ij);
                        }
                        if (dateTest.test(v_ij)) {
                            possibleDateCount++;
                        }
                        column[i] = v_ij;
                    }
                } else {
                    type_ij = "undefined";
                }
                // Determine attributes of column j
                if (type_j !== type_ij) {
                    if (type_j === "undefined") {
                        type_j = type_ij;
                        if (type_ij === "number" || type_ij === "currency") {
                            min_j = n_ij;
                            max_j = n_ij;
                        }
                    } else if (v_ij !== undefined && type_j !== "mixed") {
                        if (type_j === "currency") {
                            cancelCurrency(i, column, j);
                            currency_j = "";
                            if (type_ij !== "string") {
                                type_j = "mixed";
                            } else {
                                type_j = "string";
                            }
                        } else {
                            type_j = "mixed";
                        }
                        min_j = undefined;
                        max_j = undefined;
                    }
                } else if (type_ij === "number" || type_ij === "currency") {
                    if (min_j > n_ij)
                        min_j = n_ij;
                    if (max_j < n_ij)
                        max_j = n_ij;
                }
                typeCount[type_ij]++;
                if (type_ij === "number" || type_ij === "currency") {
                    if (n_ij > 0) {
                        typeCount.nrPositive++;
                    } else if (n_ij < 0) {
                        typeCount.nrNegative++;
                    }
                }
                if (type_ij !== "undefined") {
                    let cnt = valueCount_j.get(v_ij);
                    if (cnt !== undefined) {
                        valueCount_j.set(v_ij, cnt + 1);
                    } else {
                        valueCount_j.set(v_ij, 1);
                        typeCount.nrUnique++;
                        typeCount.nrUniqueValuesPerType[type_ij]++;
                        if (uniqueValues_j !== undefined) {
                            if (uniqueValues_j.length > maxExpectedUniqueValues) {
                                // Stop storing at 12*ln(size) different values
                                uniqueValues_j = undefined;
                            } else {
                                uniqueValues_j.push(v_ij);
                            }
                        }
                    }
                }
            }
            if (facetRestrictionQuery !== undefined &&
                  !interpretedBoolMatch(facetRestrictionQuery, typeCount)) {
                continue;
            }
            dataPerFacet[name] = column;
            // Define attribute records
            var attr: DataSourceAttributesInfo = {
                name: [name],
                type: type_j === "number" && integerValued_j?
                      ["integer"]: [type_j],
                typeCount: normalizeObject(typeCount)
            };
            if (name !== originalName){
                attr.originalName = [originalName];
            }
            if (min_j !== undefined) {
                attr.min = [min_j];
                attr.max = [max_j];
            }
            if (uniqueValues_j !== undefined && type_j !== "currency") {
                attr.uniqueValues = uniqueValues_j;
            }
            if (type_j === "currency") {
                attr.currency = [currency_j];
            }
            attributes.push(attr);
            possibleDate.push(possibleDateCount === typeCount.string &&
                           typeCount.number === 0 && typeCount.object === 0 &&
                           typeCount.boolean === 0 && typeCount.currency === 0);
            if (attributes.length >= dataTableMaxNrColumns) {
                break;
            }
        }
        convertDates();
        for (var i: number = 0; i < nrRows; i++) {
            recordIds.push(i);
        }
        dataPerFacet["recordId"] = recordIds;
        attributes.push({
            name: ["recordId"],
            type: ["integer"],
            min: [1],
            max: [nrRows],
            typeCount: [{
                number: [nrRows],
                string: [0],
                object: [0],
                undefined: [0],
                boolean: [0],
                currency: [0],
                nrPositive: [nrRows],
                nrNegative: [0],
                nrUnique: [nrRows],
                nrUniqueValuesPerType: [{
                    number: [nrRows],
                    string: 0,
                    object: 0,
                    boolean: 0,
                    currency: 0
                }]
            }]
        });
        // this.setColumnarData(dataPerFacet, attributes);
        this.provideDataSupplier(nrRows, dataPerFacet, attributes);
    }
    
    parseResponse(response: string): string[][] {
        if (this.fileMode !== DataSourceFileType.csv) {
            return response.split(/\r?\n/).map(function(line: string): string[] {
                return line.split('\t');
            });
        }
        var matrix: any[][] = [];
        var row: any[] = undefined;
        
        function addRow(): void {
            if (row !== undefined) {
                matrix.push(row);
                row = undefined;
            }
        }

        var startPos: number = undefined;
        var endPos: number = undefined;
        var percentPos: number = undefined;
        var doubleQuote: boolean;

        function addField(): void {
            var val: any;

            if (startPos === undefined || endPos === undefined) {
                val = undefined;
            } else if (percentPos !== endPos) {
                val = response.substring(startPos, endPos + 1);
                if (doubleQuote) {
                    val = val.replace(/""/g, '"');
                }
            } else {
                var numVal: number = Number(response.substring(startPos, endPos));
                if (isNaN(numVal) || numVal === Infinity || numVal === -Infinity) {
                    val = response.substring(startPos, endPos + 1);
                    if (doubleQuote) {
                        val = val.replace(/""/g, '"');
                    }
                } else {
                    val = numVal / 100;
                }
            }
            if (row === undefined) {
                row = [val];
            } else {
                row.push(val);
            }
            startPos = undefined;
            endPos = undefined;
        }

        // Parse CSV with a finite state machine
        var l: number = response.length;
        var state: number = 0;
        var prevCh: string;
        for (var i: number = 0; i !== l; i++) {
            var ch: string = response[i];
            switch (state) {
              case 0: // initial state, start of a field
                doubleQuote = false;
                percentPos = undefined;
                switch (ch) {
                  case '"':
                    startPos = i + 1;
                    state = 1;
                    break;
                  case ",":
                    addField();
                    break;
                  case "\n": case "\r":
                    if (prevCh !== "\n" && prevCh !== "\r") {
                        addField();
                        addRow();
                    }
                  case " ": case "\t":
                    break;
                  default:
                    startPos = endPos = i;
                    state = 3;
                    break;
                }
                break;
              case 1: // start quoted string
                switch (ch) {
                  case '"': // double quote or terminate string
                    endPos = i - 1;
                    state = 2;
                    break;
                }
                break;
              case 2: // escaped character in double quoted string
                switch (ch) {
                  case '"': // double quote
                    doubleQuote = true;
                    state = 1;
                    break;
                  case ",":
                    addField();
                    state = 0;
                    break;
                  case "\n": case "\r":
                    if (prevCh !== "\n" && prevCh !== "\r") {
                        addField();
                        addRow();
                    }
                    state = 0;
                    break;
                }
                break;
              case 3: // unquoted field
                switch (ch) {
                  case ",":
                    addField();
                    state = 0;
                    break;
                  case " ": case "\t":
                    break;
                  case "%":
                    percentPos = i;
                    endPos = i;
                    break;
                  case "\n": case "\r":
                    if (prevCh !== "\n" && prevCh !== "\r") {
                        addField();
                        addRow();
                    }
                    state = 0;
                    break;
                  default:
                    endPos = i;
                    break;
                }
                break;
            }
            prevCh = ch;
        }
        if (prevCh !== "\n" && prevCh !== "\r") {
            addField();
            addRow();
        }
        return matrix;
    }

    eval(): boolean {
        this.errorInLoad = false;
        this.dataParsed = false;
        if (this.uri instanceof NativeObjectWrapper &&
              this.uri.file !== undefined) {
            this.infoUpdate("loading", [], "datatable", 0, undefined);
            this.determineFileMode(this.uri.file.name, false);
            this.fileReader = new FileReader();
            this.fileReader.onabort = (): void => {
                this.abort();
            }
            this.fileReader.onerror = (errorEvent: ErrorEvent): void => {
                this.error(errorEvent);
            }
            this.fileReader.onloadend = (): void => {
                if (this.fileReader !== undefined) {
                    this.load(this.fileReader.result, true);
                    this.fileReader = undefined;
                }
            }
            this.suspendQueue();
            this.fileReader.readAsText(this.uri.file);
        } else if (typeof(this.uri) === "string" &&
                   /^(\.\.?\/|((file|https?|[st]?ftp):\/\/))/.test(this.uri)) {
            this.infoUpdate("loading", [], "datatable", 0, undefined);
            var uri: string = /^(file|https?|[st]?ftp):\/\//.test(this.uri)?
                this.uri: combineFilePath(runtimeEnvironment.dirName, this.uri);
            this.determineFileMode(uri, true);
            this.client = new XMLHttpRequest();
            this.client.onerror = (errorEvent: ErrorEvent): void => {
                this.error(errorEvent);
            }
            this.client.open("GET", uri, true);
            // workaround for the node package: don't install abort handler
            // before opening.
            this.client.onabort = (): void => {
                this.abort();
            }
            this.client.onloadend = (): void => {
                if (this.client !== undefined) {
                    this.load(this.client.responseText, true);
                    this.client = undefined;
                }
            }
            this.client.send();
            if (!this.errorInLoad) {
                this.suspendQueue();
            } else {
                this.infoUpdate("error", [], "datatable", undefined, "opening file not allowed by browser");
                this.setResult("error", "opening datatable not allowed by browser: " + uri, undefined, undefined);
                console.log("opening datatable not allowed by browser", uri);
            }
        } else {
            if (!valueEqual(this.result.value, constEmptyOS)) {
                this.result.set(constEmptyOS);
                return true;
            }
        }
        return false;
    }

    determineFileMode(str: string, isURL: boolean): void {
        if (this.arguments[1] !== undefined) {
            var fileType: any = getDeOSedValue(interpretedQuery({fileType: _}, this.arguments[1].value));
            switch (fileType) {
              case "csv":
                this.fileMode = DataSourceFileType.csv;
                return;
              case "json":
                this.fileMode = DataSourceFileType.json;
                return;
            //   case "json-stat":
            //     this.fileMode = DataSourceFileType.jsonStat;
            //     return;
              case "txt": case "tsv":
                this.fileMode = DataSourceFileType.text;
                return;
              case false: case undefined:
                break;
              default:
                this.fileMode = DataSourceFileType.unknown;
                return;
            }
        }
        if (isURL) {
            this.fileMode = /\.[Cc][Ss][Vv](\?.*)?$/.test(str)? DataSourceFileType.csv:
                            /\.[Jj][Ss][Oo][Nn](\?.*)?$/.test(str)? DataSourceFileType.json:
                            /\.[Tt][SsXx][VvTt](\?.*)?$/.test(str)? DataSourceFileType.text:
                            DataSourceFileType.unknown;
        } else {
            this.fileMode = /\.[Cc][Ss][Vv]$/.test(str)? DataSourceFileType.csv:
                            /\.[Jj][Ss][Oo][Nn]$/.test(str)? DataSourceFileType.json:
                            /\.[Tt][SsXx][VvTt]$/.test(str)? DataSourceFileType.text:
                            DataSourceFileType.unknown;
        }
    }

    debugName(): string {
        return "datatable";
    }

    getDebugResult(): any[] {
        var data: any[] = [];
        var attrs: string[] = this.attributes.map(function(attr: DataSourceAttributesInfo): string { return attr.name[0]; });
        var nrRows: number = attrs.reduce((prevMax: number, attr: string): number => {
            var nrRows: number = this.dataPerFacet[attr].length;
            return nrRows > prevMax? nrRows: prevMax;
        }, 0);

        for (var i = 0; i < nrRows; i++) {
            var row: any = {};
            for (var j = 0; j < attrs.length; j++) {
                var attr: string = attrs[j];
                var cell: any = this.dataPerFacet[attr][i];
                if (cell !== undefined) {
                    row[attr] = cell;
                }
            }
            data.push(row);
        }
        return [{
            state: ["loaded"],
            fullName: [this.sourceName],
            name: [extractBaseName(this.sourceName)],
            revision: [getDeOSedValue(this.revision)],
            lastUpdate: [Date.now()],
            attributes: this.attributes,
            data: data
        }];
    }
}
datatable.classConstructor = EvaluationDataTable;

abstract class EvaluationRemoteData extends EvaluationFunctionApplication
    implements RemoteResourceUpdateClientToServer
{
    dataHandle: number = undefined;
    
    destroy(): void {
        this.releaseDataHandle();
        super.destroy();
    }

    releaseDataHandle(): void {
        if (this.dataHandle !== undefined) {
            // TODO: check that it is released
            gRemoteMgr.unsubscribe(this.dataHandle);
            this.dataHandle = undefined;
        }
    }

    isConstant(): boolean {
        return false;
    }

    abstract resourceUpdate(newValue: any, consumerIdent: any): void;

    abstract resourceConnectionStateUpdate(errorId: number, errorMessage: string, ident: any): void;

    // Not needed in an interactive application
    allRequestsAcknowledged(): void {
    }
    // handle additional information provided by the write acknowledgement
    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void {
    }

    // Part of the RemoteResourceUpdate interface for the server

    id: number;

    signalTermination(reason: string): void {
        throw new Error('Method not implemented.');
    }

    // template admin

    getTemplateIndexAdmin(): TemplateIndexInformationChannel {
        return undefined;
    }

    getTemplateIndexIdUpdates(): (XDRTemplateDefinition|XDRIndexDefinition)[] {
        return undefined;
    }

    resetTemplateIndexIds(): void {
    }

    defineRemoteTemplateIndexIds(definitionList: any): void {
    }

    loginStatusUpdate(username: string, authenticated: boolean): void {
    }

    resourceUpdateComplete(resourceId: number): void {
    }
}

class EvaluationDataBase extends EvaluationRemoteData
    implements RemoteResourceUpdateClientToServer, IndexerDataSupplier
{
    table: string = undefined;
    queryParameters: any;
    attributes: DataSourceAttributesInfo[] = undefined; // Probably not needed
    nrDataRows: number;
    indexer: FEGValueIndexer;
    subscriptions: {[pathId: number]: number} = {};
    idsPerPathNode: {[pathId: number]: SupplierDataElementIdMappingRange[]} = {};
    nrPathsLoading: number = 0;
    pathIdsLoading: {[pathId: number]: number} = {};
    paths: string[][] = undefined;
    connected: boolean = false;

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.indexer = new FEGValueIndexer(globalInternalQCM);
        this.indexer.addPath(globalInternalQCM.getRootPathId());
        this.result.dataSource = IndexerDataSource.createIndexerDataSourceRoot(
            this.indexer, this, "database");
        this.result.value = emptyDataSourceResult;
        this.dataSourceResultMode = true;
    }

    destroy(): void {
        EvaluationDatasourceInfo.infoRemove(this.watcherId);
        gRemoteMgr.unregisterForLoginStatusUpdates(this);
        this.releaseSubscriptions();
        if (this.indexer !== undefined) {
            this.result.dataSource.removeResultReceiver(this);
            delete this.result.dataSource;
            this.indexer.clear();
        }
        super.destroy();
    }

    releaseSubscriptions(): void {
        for (var pathId in this.subscriptions) {
            gRemoteMgr.unsubscribe(this.subscriptions[pathId]);
            delete this.subscriptions[pathId];
            delete this.idsPerPathNode[pathId];
        }
    }

    infoUpdate(state: string, attributes: DataSourceAttributesInfo[], progress: any, info?: string): void {
        EvaluationDatasourceInfo.infoUpdate(this.watcherId, this.table, this.table,
            [1], Date.now(), state, attributes, info, "database", progress);
    }

    // This could be more subtle if the indexer would replace the existing data
    // elements with the new ones on announcing new data elements. Now an update
    // to the database clears the whole indexer. Not sure if worth it,
    // especially since a change in size can have consequences for data element
    // id ranges.
    provideDataSupplier(nrRows: number): void {
        this.nrDataRows = nrRows;
        this.indexer.setDataSupplier(this);
        this.indexer.announceNewDataElements(0, nrRows);
        this.indexer.incPathNodeTracing(this.indexer.paths); // TODO: release?
    }

    eval(): boolean {
        var table: string = getDeOSedValue(this.arguments[0].value);
        var arg2 = this.arguments[1] === undefined? undefined:
                   stripArray(this.arguments[1].value, true);
        var queryParameters: any = isAV(arg2)? arg2.parameters: undefined;

        if (table !== this.table || !objectEqual(queryParameters, this.queryParameters)) {
            this.table = table;
            this.queryParameters = queryParameters;
            this.indexer.clear();
            if (typeof(table) === "string") {
                this.subscribeToTable();
            } else {
                EvaluationDatasourceInfo.infoRemove(this.watcherId);
            }
        }
        return false;
    }

    subscribeToTable(): void {
        var hostSpec = {
            protocol: gAppStateMgr.appStateInfo.protocol[0],
            hostName: gAppStateMgr.appStateInfo.serverAddress[0],
            port: gAppStateMgr.appStateInfo.serverPort[0],
            path: gAppStateMgr.appStateInfo.serverPath[0]
        };
        var rootPathId: number = this.indexer.qcm.getRootPathId();
        var rootPathIdAsStr = String(rootPathId);
        var resourceSpec: ResourceSpecification = {
            type: "table",
            app: this.table,
            path: <string[]>[],
            owner: gAppStateMgr.appStateInfo.owner[0],
            params: this.queryParameters
        };

        this.releaseSubscriptions();
        this.indexer.clear();
        var dataHandle = gRemoteMgr.subscribe(
            this, hostSpec, resourceSpec,
            XDR.xdrTableElement,
            function (elem: any): any {
                return rootPathIdAsStr;
            },
            rootPathIdAsStr);
        gRemoteMgr.registerForLoginStatusUpdates(this);
        if (dataHandle !== undefined) {
            this.subscriptions[rootPathId] = dataHandle;
            this.doInfoUpdate(rootPathId, false);
            this.connected = true;
        } else {
            this.infoUpdate("error", [], undefined);
            this.connected = false;
        }
    }

    // consumerIdent is the string representation of the pathId. The root path
    // id contains the mapping info
    resourceUpdate(newValue: any, consumerIdent: any): void {
        if (typeof(newValue) === "object") {
            var data: any[] = newValue[consumerIdent];
            var pathId: number = Number(consumerIdent);
            var pathNode = this.indexer.pathNodesById[pathId];
            if (pathId in this.pathIdsLoading) {
                this.indexer.decPathNodeTracing(pathNode);
            }
            this.doInfoUpdate(pathId, true);
            if (data instanceof Array) {
                for (var i = 0; i < data.length; i++) {
                    var data_i = data[i];
                    if (data_i.path instanceof Array) {
                        if (debugDelayLoad) {
                            if (this.delayedResources === undefined) {
                                this.delayedResources = new Map<number, any>();
                            }
                            this.delayedResources.set(pathId, data_i);
                        } else {
                            this.loadResource(pathId, data_i);
                        }
                    }
                }
            }
        }
    }

    loadResource(pathId: number, data: any): void {
        var pathNode = this.indexer.pathNodesById[pathId];

        if ("mapping" in data && data.path.length === 0) {
            var mapping: SupplierDataElementIdMappingRange = data.mapping;
            this.provideDataSupplier(mapping.nrDataElements);
            if (mapping.paths instanceof Array) {
                this.paths = mapping.paths;
            } else {
                // Old version of the data:
                this.paths = [];
                for (var attr in mapping.paths) {
                    this.paths.push([attr]);
                }
            }
        } else if ("pathValuesRanges" in data) {
            var pathData: SupplierDataPath = data;
            var ids = this.idsPerPathNode[pathId]; // TODO: multiple ranges
            this.indexer.addColumnRange(pathNode,
                decompressRawData(pathData.pathValuesRanges, pathData.indexedValues),
                ids[0].firstDataElementId);
        }
        this.markAsChanged(); // Easiest way to trigger all queues.
    }

    delayedResources: Map<number, any>;

    delayedResourceLoad(pathIds: number|number[]): void {
        var lPathIds: number[] = pathIds instanceof Array? pathIds: [pathIds];

        for (var i = 0; i < lPathIds.length; i++) {
            var pathId = lPathIds[i];
            if (this.delayedResources.has(pathId)) {
                this.loadResource(pathId, this.delayedResources.get(pathId));
                this.delayedResources.delete(pathId)
            } else {
                console.warn("path id not in delayed resources:", pathId);
            }
        }
    }

    // IndexerDataSupplier interface: adds data to the path nodes on request

    canFillPathNode(pathNode: PathNode): boolean {
        var path: string[] = this.indexer.qcm.getPathStrings(pathNode.pathId);

        return this.paths !== undefined &&
               this.paths.some(function(p: string[]): boolean {
                   return valueEqual(path, p);
               });
    }

    // Note: doesn't work properly when there's an os of values for one data element
    fillPathNode(pathNode: PathNode, ids: SupplierDataElementIdMappingRange[]): void {
        var pathId: number = pathNode.pathId;
        var path: string[] = this.indexer.qcm.getPathStrings(pathNode.pathId);
        var hostSpec = {
            protocol: gAppStateMgr.appStateInfo.protocol[0],
            hostName: gAppStateMgr.appStateInfo.serverAddress[0],
            port: gAppStateMgr.appStateInfo.serverPort[0],
            path: gAppStateMgr.appStateInfo.serverPath[0]
        };
        var resourceSpec: ResourceSpecification = {
            type: "table",
            app: this.table,
            path: path,
            owner: gAppStateMgr.appStateInfo.owner[0],
            params: this.queryParameters
        };

        if (!(pathId in this.subscriptions)) {
            var dataHandle = gRemoteMgr.subscribe(
                this, hostSpec, resourceSpec,
                XDR.xdrTableElement,
                function (elem: any): string {
                    return String(pathId);
                },
                String(pathId));
            gRemoteMgr.registerForLoginStatusUpdates(this);
            if (dataHandle !== undefined) {
                this.indexer.incPathNodeTracing(pathNode);
                this.subscriptions[pathId] = dataHandle;
                this.idsPerPathNode[pathId] = ids;
                this.doInfoUpdate(pathId, false);
            }
        }
    }

    unloadPathNode(pathNode: PathNode): void {
        var pathId: number = pathNode.pathId;

        if (pathId in this.subscriptions) {
            gRemoteMgr.unsubscribe(this.subscriptions[pathId]);
            delete this.subscriptions[pathId];
            this.doInfoUpdate(pathId, true);
        }
    }

    doInfoUpdate(pathId: number, loaded: boolean): void {
        if (loaded) {
            if (!(pathId in this.pathIdsLoading)) {
                return; // resourceUpdate after initial loading
            }
            this.nrPathsLoading--;
            delete this.pathIdsLoading[pathId];
            if (this.nrPathsLoading === 0) {
                this.infoUpdate("loaded", [], undefined);
            }
            assert(this.nrPathsLoading >= 0, "nrPathsLoading is negative");
        } else {
            if (this.nrPathsLoading === 0) {
                this.infoUpdate("loading", [], 0);
            }
            if (!(pathId in this.pathIdsLoading)) {
                this.pathIdsLoading[pathId] = 1;
                this.nrPathsLoading++;
            }
        }
    }

    resourceConnectionStateUpdate(errorId: number, errorMessage: string, ident: any): void {
        // do nothing. The client continues to try to reconnect. Until then,
        // the client continues to use the data available.
        return;
    }

    allRequestsAcknowledged(): void {
    }
    // handle additional information provided by the write acknowledgement
    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void {
    }

    // Databases should not be re-uploaded
    public getRawDataDescription(): RawDataDescription {
        return [];
    }

    loginStatusUpdate(username: string, authenticated: boolean): void {
        if (authenticated && !this.connected) {
            this.subscribeToTable();
        }
    }
}
database.classConstructor = EvaluationDataBase;

class EvaluationDatabases extends EvaluationRemoteData
    implements RemoteResourceUpdateClientToServer, ResourceConsumer
{
    dataHandle: number = undefined;
    revision: any = undefined;
    
    destroy(): void {
        gRemoteMgr.unregisterForLoginStatusUpdates(this);
        this.releaseDataHandle();
        super.destroy();
    }

    releaseDataHandle(): void {
        if (this.dataHandle !== undefined) {
            gRemoteMgr.unregisterForLoginStatusUpdates(this);
            gRemoteMgr.releaseResource(this.dataHandle);
            gRemoteMgr.unsubscribe(this.dataHandle);
        }
    }

    isConstant(): boolean {
        return false;
    }

    eval(): boolean {
        this.listCollections();
        return false;
    }

    listCollections(): void {
        var hostSpec = {
            protocol: gAppStateMgr.appStateInfo.protocol[0],
            hostName: gAppStateMgr.appStateInfo.serverAddress[0],
            port: gAppStateMgr.appStateInfo.serverPort[0],
            path: gAppStateMgr.appStateInfo.serverPath[0]
        };
        var resourceSpec = {
            type: "metadata",
            app: "any",
            owner: gAppStateMgr.appStateInfo.owner[0]
        };

        this.dataHandle = gRemoteMgr.subscribe(
            this, hostSpec, resourceSpec,
            XDR.xdrMetadataElement, this.getIdentStringFun(),
            "metadata");
        gRemoteMgr.registerForLoginStatusUpdates(this);
        if (this.dataHandle !== undefined) {
            this.infoUpdate("loading", 0);
        } else {
            this.infoUpdate("error", undefined);
        }
    }
    
    getIdentStringFun(): (obj: any) => string {
        return function (obj) {
            return obj.ident;
        }
    }

    infoUpdate(state: string, progress: number): void {
        EvaluationDatasourceInfo.infoUpdate(this.watcherId, "databases", "databases",
            [1], Date.now(), state, [], undefined, "databases", progress);
    }

    // Handles updates from the server. These are only updates for entries
    // which were already assigned IDs by the server. The initial assignment
    // of this ID is handled through the write acknowledgement.
    
    resourceUpdate(newValue: any, consumerIdent: any): void {

        // new value (a copy of the existing value to be modified by the
        // update).
        var metadata =
            this.result.isEmpty() ? [] : [].concat(this.result.value);
        var modified = false;
        
        for(var ident in newValue) {
            var remove = (!newValue[ident].value ||
                          newValue[ident].value === xdrDeleteIdent);
            var value: any[] = normalizeObject(newValue[ident].value);
            var insertPos:number = metadata.length; // by default, add new entry
            
            for(var i:number = 0, l:number = metadata.length ; i < l ; ++i) {
                var entry:any = metadata[i];
                if(entry.id !== undefined && entry.id[0] == ident) {
                    insertPos = i;
                    break;
                }
            }

            if(remove) {
                // removal operation
                if(insertPos < metadata.length) {
                    metadata.splice(insertPos, 1);
                    modified = true;
                }
                continue;
            }
            
            if(!objectEqual(metadata[insertPos], value[0])) {
                metadata[insertPos] = value[0];
                modified = true;
            }
        }

        if(modified) {
            this.result.set(metadata);
            this.informAllWatchers();
        }
        this.infoUpdate("loaded", undefined);
    }

    // handle additional information provided by the write acknowledgement
    // the write acknowledgement information lists the assignment of ID
    // by the server to new data uploaded from this client (specified by name).
    // This function searches for the entry with the given name and no ID
    // and for an entry with the given ID. If an entry with the given ID
    // already exists, the entry with the given name (and no ID) is removed
    // (the update must have arrived first). Otherwise, the ID is set on
    // the entry with the given name (awaiting an update with the remaining
    // information).

    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void {

        if(this.result.isEmpty())
            return; // no entry without ID
        
        // create a first level copy of the metadata 
        var metadata =
            this.result.isEmpty() ? [] : [].concat(this.result.value);
        var modified = false;
        
        for(var name in writeAckInfo) {

            var id: string = writeAckInfo[name];
            if(id === undefined)
                continue;

            // search for the entry with this ID
            var idPos:number = undefined;
            // search for the named entry
            var namedPos:number = undefined;
            
            for(var i:number = 0, l:number = metadata.length ; i < l ; ++i) {
                var entry:any = metadata[i];
                if(entry.id !== undefined && entry.id[0] !== undefined) {
                    if(entry.id[0] == id) {
                        idPos = i;
                        if(namedPos !== undefined)
                            break;
                    }
                } else if(entry.name !== undefined && entry.name[0] == name) {
                    namedPos = i;
                    if(idPos !== undefined)
                        break;
                }
            }

            if(idPos !== undefined) {
                if(namedPos !== undefined) {
                    // remove the named entry
                    metadata.splice(namedPos, 1);
                    modified = true;
                }
            } else if(namedPos !== undefined) {
                // set the ID (and remove the progress)
                var newEntry = shallowCopy(metadata[namedPos]);
                newEntry.id = [id];
                delete newEntry.uploadProgress;
                metadata[namedPos] = newEntry;
                modified = true;
            }
        }

        if(modified) {
            this.result.set(metadata);
            this.informAllWatchers();
        }
    }
    
    resourceConnectionStateUpdate(errorId: number, errorMessage: string, ident: any): void {
        if (errorId !== 0) {
            console.log("connection error:", errorMessage);
            this.infoUpdate("loaded", undefined);
        }
    }

    // Can only send one record at a time.
    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[]): void {
        if ((positions === undefined ||
              (positions.length === 1 && positions[0].length === 1)) &&
              result !== undefined && result.value !== undefined &&
              result.value instanceof Array && result.value.length === 1) {
            if (debugWrites) {
                console.log("write to [databases]", result.value);
            }
            if (positions !== undefined && positions[0].path !== undefined) {
                // This is a write to one or more lower attributes: create the
                // object, extract the top level position and send that as an
                // update. updateMetaData will add the id (if needed), and the
                // persistence server will perform the merge.
                var writePosition: number = positions[0].index;
                var pct = new PositionChangeTracker();
                var offsetPosition = positions[0].copyWithOffset(writePosition);
                var currentPosValue = this.result.value[writePosition];
                if (currentPosValue === undefined) {
                    currentPosValue = {};
                }
                var writeResult: any = stripArray(
                    determineWrite([currentPosValue], result, mode, attributes,
                                   [offsetPosition], pct),
                    true);
                this.updateMetaData(writeResult,
                                    [new DataPosition(writePosition, 1)]);
            } else {
                this.updateMetaData(result.value[0], positions);
            }
        } else {
            Utilities.warn("dead ended write to [databases]; writing through projection or areaSetContent? at " + gWriteAction);
        }               
    }

    /**
     * Sends the new value to the remote manager, which will send it to the
     * persistence server. There the new value is merged with existing value.
     * If there is a change in metadata or table contents, the resources will
     * be updated, so there's no need to do that here.
     * 
     * If the value doesn't carry an 'id' field, the identity is derived
     * from its name (temporarily, until an ID is assigned by the server).
     * 
     * @param {*} value the changed attributes of the metadata
     * @param {DataPosition[]} positions
     */
    updateMetaData(value: any, positions: DataPosition[]): void {
        // Replace o(x) by x, and send the result to the metadata resource
        // The update should be sent back when the deletion is done.
        var denormalizedUpdateValue: any =
            stripArray(shallowCopyMinus(value, "data"), true);
        var idFromPosition: any = positions === undefined? undefined:
            getDeOSedValue(this.result.value[positions[0].index].id);

        denormalizedUpdateValue.data = value.data;
        if (!("id" in denormalizedUpdateValue) &&
            idFromPosition !== undefined) {
            // Use id from the destination position
            denormalizedUpdateValue = shallowCopy(denormalizedUpdateValue);
            denormalizedUpdateValue.id = idFromPosition;
        }
        if (!("id" in denormalizedUpdateValue) &&
              !("data" in denormalizedUpdateValue)) {
            Utilities.warn("possibly wrong write [databases]; no id nor data");
        }

        // identify this write (either the ID from the entry (if exists)
        // or the name)
        var ident = ("id" in denormalizedUpdateValue) ?
            denormalizedUpdateValue.id : denormalizedUpdateValue.name; 
        
        if (this.dataHandle !== undefined) {
            gRemoteMgr.write(this.dataHandle, ident, denormalizedUpdateValue);
        } else {
            Utilities.warn("no remote connection");
        }

        // if this is a new entry (has no ID yet) we create a new entry
        // containing only the name and a progress report field and add this
        // to the list of metadata. We wait to receive the rest of
        // the information from the server.
        if(!("id" in denormalizedUpdateValue)) {
            var newMetadataEntry = {
                name: [denormalizedUpdateValue.name],
                uploadProgress: [{ dataTransferred: [0], state: ["sending"] }]
            };
            // create the new metadata set
            var metadata = this.result.isEmpty() ?
                [newMetadataEntry] : this.result.value.concat(newMetadataEntry);

            this.result.set(metadata);
            this.informAllWatchers();
        }
    }

    // This function is called to report the progress of the transfer of
    // an outbound message, that is, a message sent as a result of updating
    // the metadata by this client. Currently, this happens when the data
    // is uploaded. 'identities' is an array of strings identifying the
    // metadata entries which were included in the message. This can be
    // either the table ID or the name of the metadata entry (at the moment,
    // this is always the database name, as metadata entries may be added,
    // but not modified). 'elementObj' is the original object submitted to
    // the write operation (see teh function 'updateMetaData()').
    // 'receiveLen' is the length of the message already received by the
    // other side and 'totalLen' is the total length of the message to
    // be transmitted (these are given as the number of characters in
    // the string).
    // This function finds the relevant entries in the metadata and updates
    // them with the progress. Currently, there should only be one
    // metadata update in each message (if there are multiple ones, this
    // progress report is for all of them together).
    
    outboundProgressUpdate(identities: Array<string>, elementObj: any,
                           receivedLen: number, totalLen: number): void
    {
        if(identities === undefined || elementObj === undefined)
            // progress report not for upload message
            return;
        
        var metadata =
            this.result.isEmpty() ? [] : [].concat(this.result.value);
        var modified = false;
        // progress (fractional)
        var progress = Math.round(receivedLen/totalLen * 100) / 100;
        
        for(var i: number = 0, l: number = identities.length ; i < l ; ++i) {
            var identity:string = identities[i];

            // find a metadata entry with this name but without an ID or
            // with this as ID.
            var matchedPos:number = undefined;
            var byName = true; // is the identity matched a name or ID
            
            for(var j:number = 0, m:number = metadata.length ; j < m ; ++j) {
                var entry:any = metadata[j];
                if(entry.id !== undefined && entry.id[0] !== undefined) {
                    if(entry.id[0] != identity)
                        continue; // no match
                    matchedPos = j;
                    byName = false; // match by identity
                    break;
                } else if(entry.name !== undefined &&
                          entry.name[0] == identity) {
                    matchedPos = j;
                    break;
                }
            }

            if(!byName || matchedPos === undefined)
                // currently, outbound progress report only for entries
                // which were not assigned an ID (initial upload).
                continue;

            if(metadata[matchedPos].uploadProgress &&
               metadata[matchedPos].uploadProgress[0].dataTransferred[0] ==
               progress)
                continue; // change in progress too small
            
            var newEntry = shallowCopy(metadata[matchedPos]);
            newEntry.uploadProgress = [{ dataTransferred: [progress],
                                         state: [receivedLen == totalLen ?
                                                 "finalizing" :
                                                 "sending"]}];
            metadata[matchedPos] = newEntry;
            modified = true;
        }

        if(modified) {
            this.result.set(metadata);
            this.informAllWatchers();
        }
    }

    loginStatusUpdate(username: string, authenticated: boolean): void {
        if (authenticated && this.dataHandle === undefined) {
            this.listCollections();
        }
    }
}
databases.classConstructor = EvaluationDatabases;

// Gets the raw data from the indexer, if available. Only to be called in a
// write statement.
class EvaluationGetRawData extends EvaluationNodeWithArguments {

    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.inputs = new Array(prototype.functionArguments.length);
        this.arguments = new Array(prototype.functionArguments.length);
        this.result.value = constEmptyOS;
        this.dataSourceAware = true;
        this.dataSourceResultMode = false;
    }

    addArgument(i: number, evalNode: EvaluationNode): void {
        this.inputs[i] = evalNode;
        this.arguments[i] = evalNode.result;
        if (!evalNode.isConstant()) {
            this.constant = false;
            evalNode.addWatcher(this, i, true, true, true);
        } else {
            this.updateInput(i, evalNode.result);
        }
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
    }

    updateInput(i: any, result: Result): void {
        this.arguments[i] = result;
    }

    isConstant(): boolean {
        return false;
    }

    // Should only get called on write
    eval(): boolean {
        var inp: Result = this.arguments[0];

        if (inp === undefined || inp.value === undefined) {
            // Pass value on when not applicable
            this.result.value = inp;
            return true;
        }
        if (!("dataSource" in inp)) {
            // Project data when not a datasource
            var simpleQuery = new SingleAttributeProjection("data");
            this.result.value = convertToRawDataDescription(simpleQuery.execute(inp.value, undefined, undefined, undefined, undefined));
            return true;
        }
        var dataSource: DataSourceComposable = inp.dataSource;
        var indexer: InternalQCMIndexer = dataSource.funcResult.getDominatedIndexer();
        if (!(indexer instanceof FEGValueIndexer)) {
            this.result.value = constEmptyOS;
            return true;
        }
        this.result.value = (<FEGValueIndexer>indexer).getRawDataDescription();
        return true;
    }

    activateInputs(): void {
        super.activateInputs();
        this.inputHasChanged = true; // Force reevaluation
    }
}
getRawData.classConstructor = EvaluationGetRawData;

// Converts normalized data into the data structure for uploading. Not efficient,
// but probably doesn't need to be.
// - No top-level values; top level must be an os of AVs.
// - No array values.
// - Only simple values; no "NonAV" values like ElementReferences or RegExps.
function convertToRawDataDescription(data: any[]): RawDataDescription {
    var dataPerPath: SupplierDataPath[] = [];
    var valuesPerPath: any[][];
    var pathMap = new Map<number, {path: string[]; next: Map<string, number>;}>();

    function addAV(pathIndex: number, obj: any): void {
        var curPath = pathMap.get(pathIndex);
        for (var attr in obj) {
            var v: any = getDeOSedValue(obj[attr]);
            var pathAttrIndex: number;
            if (curPath.next.has(attr)) {
                pathAttrIndex = curPath.next.get(attr);
            } else {
                pathAttrIndex = dataPerPath.length;
                curPath.next.set(attr, pathAttrIndex);
                pathMap.set(pathAttrIndex, {path: curPath.path.concat(attr), next: new Map<string, number>()});
                valuesPerPath[pathAttrIndex] = [];
                dataPerPath[pathAttrIndex] = {
                    path: pathMap.get(pathAttrIndex).path,
                    indexedValues: undefined,
                    pathValuesRanges: [{
                        o: 0,
                        v: valuesPerPath[pathAttrIndex]
                    }]
                };
            }
            if (isSimpleType(v)) {
                valuesPerPath[pathAttrIndex][i] = v;
            } else if (!(v instanceof Array) && isAV(v)) {
                addAV(pathAttrIndex, v);
            }
        }
    }

    function pathObj(map: Map<number, {path: string[]; next: Map<string, number>;}>): string[][] {
        var paths: string[][] = [];

        map.forEach(function(v): void { paths.push(v.path); });
        return paths;
    }

    dataPerPath.push({path: [], indexedValues: undefined, pathValuesRanges: undefined}); // Data for root path is ignored at return
    pathMap.set(0, {path: [], next: new Map<string, number>()});
    for (var i = 0; i < data.length; i++) {
        var row: any = data[i];
        if (isAV(row)) {
            addAV(0, row);
        } /* else if (isSimpleType(row)) {
            valuesPerPath[0][i] = row;
        } */
    }
    return [{
        mapping: {
            rowNr: 0,
            nrDataElements: data.length,
            firstDataElementId: 0,
            paths: pathObj(pathMap),
        },
        values: dataPerPath.slice(1).map(d => {
            return {
                path: d.path,
                indexedValues: undefined,
                pathValuesRanges: compressRawData(d.pathValuesRanges[0].v, undefined)
            };
        })
    }];
}
