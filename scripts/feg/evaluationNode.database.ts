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

/// <reference path="../query/fegValueIndexer.ts" />
/// <reference path="dataParsers.ts" />

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

    dataParser: DataParser = undefined;
    // the following fields are loaded from the data parser (if the data
    // is parsed, otherwise they should not be used).
    dataPerFacet: {[facetName: string]: SimpleValue[]};
    attributes: DataSourceAttributesInfo[];
    nrDataRows: number = 0;
    topLevelDataElementId: number = undefined;

    provideDataSupplier(): void {
        var topLevelData: any = {
            state: "loaded",
            fullName: (this.uri instanceof NativeObjectWrapper? this.uri.file.name: this.sourceName),
            name: extractBaseName(this.sourceName),
            revision: getDeOSedValue(this.revision),
            lastUpdate: Date.now(),
            attributes: this.dataParser.attributes,
            data: []
        };

        this.dataPerFacet = this.dataParser.dataPerFacet;
        this.nrDataRows = this.dataParser.nrRows;
        this.attributes = this.dataParser.attributes;
        this.releaseDataPathNode();
        if (this.indexer !== undefined) {
            this.indexer.clear();
        } else {
            this.createIndexer();
        }

        var rootPathId: number = this.indexer.qcm.getRootPathId();
        var dataPathId: number = this.indexer.qcm.allocatePathId(rootPathId, "data");
        this.topLevelDataElementId =
            this.indexer.setTopLevelAttributeValue(topLevelData, undefined);
        this.indexer.setDataSupplier(this);
        this.indexer.announceNewDataElementsForPathId(
            dataPathId, this.topLevelDataElementId, 0, this.nrDataRows);
        // don't release dataPathId: it can change the path id for "data"
        this.dataPathNode = this.indexer.pathNodesById[dataPathId];
        this.indexer.incPathNodeTracing(this.dataPathNode);

        this.endedLoading("loaded", this.attributes);
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

    createIndexer(): void {
        if (this.indexer === undefined) {
            this.indexer = new FEGValueIndexer(globalInternalQCM);
            this.indexer.addPath(globalInternalQCM.getRootPathId());
            this.result.dataSource = IndexerDataSource.createIndexerDataSourceRoot(this.indexer, this, this.uri);
            this.setDataSourceResultMode(true);
            this.result.value = emptyDataSourceResult;
        }
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
    tsv,
    csv,
    json
}

// datasource provides general access to external data (that is, not from
// the CDL server). The data may be parsed or not (depending on specification
// provided by the user).

class EvaluationDataSourceFunction extends EvaluationDataSource
    implements IndexerDataSupplier
{
    client: XMLHttpRequest;
    fileReader: FileReader;
    // in case the input is a local file, the last modified time for which
    // the file was parsed
    fileLastModified:number = undefined;
    errorInLoad: boolean = false;
    fileMode: DataSourceFileType;
    dataParsed: boolean = false;
    uri: any = undefined;
    revision: number = 0;
    onlyFirstBlock: boolean = true;
    customArg: any = undefined;
    queueRunning: boolean = true; // false when this node has stopped the queue
    withCredentialsFlag: boolean|undefined;
    waitForReply: boolean = false;
    // if this is set to true and the input is a (local) file handle, the
    // system re-reads the file when it is modified while the file handle
    // is being held by this object.
    watchFile:boolean = false;

    // if the content type is not given and cannot be determined by the
    // suffix of the source name (e.g. .csv), then if this proeprty is true,
    // the class will try to determine the type of the input based on the
    // content of the raw data loaded.
    protected useContentToDecideMode: boolean = false;
    
    constructor(prototype: FunctionApplicationNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.createIndexer();
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
                this.withCredentialsFlag = checkValue(this.withCredentialsFlag, "withCredentials");
                this.waitForReply = checkValue(this.waitForReply, "waitForReply");
                this.watchFile = checkValue(this.watchFile, "watchFile");
                if(!this.watchFile) // just to be on the safe side
                    gFileHandleScanner.removeFileHandle(this);
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

    load(response: string, async: boolean): void {
        if (this.useContentToDecideMode &&
            this.fileMode === DataSourceFileType.unknown)
            this.determineFileModeByContent(response);

        var noIndexer: boolean =
            (this.arguments[1] !== undefined &&
             isTrue(interpretedQuery({noIndexer: _},this.arguments[1].value)));
        // in case there is no indexer
        var data: any[] = undefined;
        
        switch (this.fileMode) {
        case DataSourceFileType.json:
            this.dataParser = new JsonDataParser(response);
            break;
        case DataSourceFileType.csv:
            this.dataParser = new CsvMatrixDataParser(response,
                                                      this.onlyFirstBlock);
            break;
        case DataSourceFileType.tsv:
            this.dataParser = new TsvMatrixDataParser(response,
                                                      this.onlyFirstBlock);
            break;
        case DataSourceFileType.text:
        default:
            // as this is a single string, we never use an indexer
            this.setNoIndexerData([], [response]);
        }

        if(this.dataParser !== undefined) {
            this.dataParser.loadData();
            if(noIndexer) {
                this.setNoIndexerData(this.dataParser.attributes,
                                      this.dataParser.getDataAsOSOfAVs());
            } else if (this.dataParser.useDataSupplyMechanism) {
                // reads values from data parser
                this.provideDataSupplier();
            } else { // only in JSON mode
                this.indexer.clear();
                this.indexer.addRawObject({
                    attributes: this.dataParser.attributes,
                    data: this.dataParser.getDataAsOSOfAVs()
                }, undefined);
            }
            this.endedLoading("loaded", this.dataParser.attributes);
        }

        // remove the parser (to allow the memory to be garbage collected)
        this.dataParser = undefined;
        
        if (async) {
            this.resumeQueue();
            this.informAllWatchers();
        }
    }

    private setNoIndexerData(attributes: DataSourceAttributesInfo[], data: any[]): void {
        if (this.indexer !== undefined) {
            this.indexer.destroy();
            delete this.indexer;
        }
        delete this.result.dataSource;
        this.dataSourceResultMode = false;
        this.result.value = [{
            state: "loaded",
            fullName: (this.uri instanceof NativeObjectWrapper ? this.uri.file.name : this.sourceName),
            name: extractBaseName(this.sourceName),
            revision: getDeOSedValue(this.revision),
            lastUpdate: Date.now(),
            attributes: attributes,
            data: normalizeObject(data)
        }];
        this.endedLoading("loaded", attributes);
        this.informAllWatchers();
    }

    eval(): boolean {
        this.errorInLoad = false;
        this.dataParsed = false;
        var isFileHandle:boolean = (this.uri instanceof NativeObjectWrapper &&
                                    this.uri.file !== undefined);
        if(!isFileHandle)
            gFileHandleScanner.removeFileHandle(this);
        if (isFileHandle) {
            this.infoUpdate("loading", [], "datatable", 0, undefined);
            this.determineFileMode(this.uri.file.name, false);
            this.fileReader = new FileReader();
            this.fileReader.onabort = (): void => {
                this.abort();
            }
            this.fileReader.onerror = (ev: FileReaderProgressEvent): any => {
                this.error(new ErrorEvent(ev.toString()));
            }
            this.fileReader.onloadend = (): void => {
                if (this.fileReader !== undefined) {
                    this.load(this.fileReader.result, true);
                    this.fileReader = undefined;
                }
            }
            if (this.waitForReply) {
                this.suspendQueue();
            }
            this.fileLastModified = this.uri.file.lastModified;
            this.fileReader.readAsText(this.uri.file);
            if(this.watchFile)
                gFileHandleScanner.addFileHandle(this);
        } else if (typeof(this.uri) === "string") {
            this.infoUpdate("loading", [], "datatable", 0, undefined);
            var uri: string = /^\.\.?\//.test(this.uri)?
                combineFilePath(runtimeEnvironment.dirName, this.uri): this.uri;
            this.determineFileMode(uri, true);
            this.client = new XMLHttpRequest();
            if (this.withCredentialsFlag) {
                this.client.withCredentials = true;
            }
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
            this.client.send("{}");
            if (!this.errorInLoad) {
                if (this.waitForReply) {
                    this.suspendQueue();
                }
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
            var fileType: any =
                getDeOSedValue(interpretedQuery({fileType: _},
                                                this.arguments[1].value));
            switch (fileType) {
              case "csv":
                this.fileMode = DataSourceFileType.csv;
                return;
              case "json":
                this.fileMode = DataSourceFileType.json;
                return;
              case "txt":
                this.fileMode = DataSourceFileType.text;
                return;
              case "tsv":
                this.fileMode = DataSourceFileType.tsv;
                return;
              case false: case undefined:
                break;
              default:
                this.fileMode = DataSourceFileType.unknown;
                return;
            }
        }
        if (isURL) {
            this.fileMode = /\.[Cc][Ss][Vv](\?.*)?$/.test(str)?
                DataSourceFileType.csv:
                /\.[Jj][Ss][Oo][Nn](\?.*)?$/.test(str)?
                DataSourceFileType.json:
                /\.[Tt][Ss][Vv](\?.*)?$/.test(str)?
                DataSourceFileType.tsv:
                /\.[Tt][Xx][Tt](\?.*)?$/.test(str)?
                DataSourceFileType.text: DataSourceFileType.unknown;
        } else {
            this.fileMode = /\.[Cc][Ss][Vv]$/.test(str)?
                DataSourceFileType.csv:
                /\.[Jj][Ss][Oo][Nn]$/.test(str)?
                DataSourceFileType.json:
                /\.[Tt][Ss][Vv]$/.test(str)?
                DataSourceFileType.tsv:
                /\.[Tt][Xx][Tt]$/.test(str)?
                DataSourceFileType.text: DataSourceFileType.unknown;
        }
    }

    // If could not determine the file mode using the file name (or parameters
    // provided by the CDL) try to guess using the content of the raw data.
    
    determineFileModeByContent(response: string) {
        var firstChar: string = response[0];
        if (firstChar === '[' || firstChar === '{' || firstChar === ' ') {
            this.fileMode = DataSourceFileType.json;
        } else {
            this.fileMode = DataSourceFileType.text;
        }
    }

    checkFileLastModified():void {
        var isFileHandle:boolean = (this.uri instanceof NativeObjectWrapper &&
                                    this.uri.file !== undefined);
        if(!isFileHandle)
            return;

        if(this.uri.file.lastModified !== this.fileLastModified) {
            // mark input as modified
            this.markAsChanged();
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
datasource.classConstructor = EvaluationDataSourceFunction;

// 'datatable' is the same as 'datasource' except that it makes an extra
// effort to parse the data by attempting to detect the format of the data
// based on the raw content in cases where no explicit indication
// of the data format is given.

class EvaluationDataTable extends EvaluationDataSourceFunction
    implements IndexerDataSupplier
{
    constructor(prototype: FunctionApplicationNode,
                local: EvaluationEnvironment) {
        super(prototype, local);
        this.useContentToDecideMode = true;
    }
}

datatable.classConstructor = EvaluationDataTable;

//
// Open file handle scanner
//

// Class for global object which scans registered open file handles for
// changes in their 'lastModified' time and then triggers their re-processing.
// The file handles themselves are not registered here, only the evaluation
// node.

class FileHandleScanner
{
    evaluators: Set<EvaluationDataSourceFunction>;
    timerId: number|NodeJS.Timer = undefined;
    scanInterval: number = 1000; // scan interval in ms

    constructor() {
        this.evaluators = new Set<EvaluationDataSourceFunction>();
    }

    // add new evaluator which should scan for updates of its file handle.
    addFileHandle(evaluator: EvaluationDataSourceFunction) {
        this.evaluators.add(evaluator);
        // set timeout if this is the first registration
        if(this.timerId === undefined)
            this.timerId = setInterval(() => this.scheduleNextScan(),
                                       this.scanInterval);
    }

    removeFileHandle(evaluator: EvaluationDataSourceFunction) {
        if(this.evaluators.size === 0)
            return;
        this.evaluators.delete(evaluator);
        // remove timeout if this is the last one
        if(this.evaluators.size === 0) {
            clearInterval(<any>this.timerId);
            this.timerId = undefined;
        }
    }
    
    // This function is called periodically to check whether the last modified
    // time of the file has changed. The actual test is performed by the
    // evaluation node.

    scanFileHandles(): void {
        this.evaluators.
            forEach(function(evaluator: EvaluationDataSourceFunction) {
                evaluator.checkFileLastModified();
            });
    }

    // called after timeout to schedule the scanning of the files
    scheduleNextScan() {
        globalFileHandleScanTask.schedule();
    }
}

var gFileHandleScanner = new FileHandleScanner();

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
