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

// from: environment.js
declare function requirePerformanceNow(): void;
declare function requireFS(): any;
declare function requirePath(): any;
declare function requireSurveyMode(): any;
declare function requireWeakMap(): any;
declare function requireWebSockets(): any;
declare function requirePerformanceNow(): any;
declare function requireBtoaAtob(): any;
declare function requireXMLHttpRequest(): any;

declare function mondriaInternalError(msg: string): void;
declare function mMessage(msg: string): void;
declare function unsubcribeResourceHook(): void;

// from: scripts/utils/binsearch.js
declare function binarySearch<T1, T2>(
    arr: T1[], val: T2, comp: (a: T1, b: T2, info?: any) => number,
    from?: number, to?: number, compInfo?: any): number;

// from: scripts/utils/arrayUtils.js
declare function cconcat<T>(l1: T[], l2: T[]): T[];

declare function initializeModeDetection(): void;

declare class ArgParse {
    getArg<T>(name: string, defaultValue: T): T;
    hasArg(name: string): boolean;
    getArgv(): string[];
    getAppName(): string;
}

declare function getArgParser(): ArgParse;
declare function argvConvertString(str: string): any;
declare var gArgParser: ArgParse;

interface ResourceSpecification {
    owner?: string;
    type?: string;
    app?: string;
    path?: string[];
    params?: {[parameterName: string]: any};
}

interface HostSpec {
    protocol: string;
    hostName: string;
    port?: number;
    path?: string;
    ca?: Buffer; // the binary contents of the certificate
    username?: string;
    password?: string;
}

interface FileSpec {
    path: string;
}

interface RemoteResourceUpdate {
    id: number;

    // this method is called by gRemoteMgr when it learns on updates to the
    // .appStateIdentifier with which this EvaluationWrite has registered
    resourceUpdate(consumerIdent: any, elementObj: any, revision: number): void;

    // notify each the consumer that the connection state is now
    // 'errorId/errorMessage'.
    // Error signals are
    // * 1: connection lost
    // * 2: termination signalled
    resourceConnectionStateUpdate(errorId: number, errorMessage: string,
                                 ident: any): void;

    // Signal that all writes have been acknowledged for the given resource.
    
    allRequestsAcknowledged(resourceId: number): void;

    // handle additional information provided by the write acknowledgement
    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void;

    // Send termination to the client
    signalTermination(reason: string): void;
}

interface RemoteIdentifier {
    templateId: number;
    indexId: number;
    path: string;
}

interface RemoteResourceUpdateClientToServer {
    watcherId: number;
    allRequestsAcknowledged(): void;
    resourceUpdate(elementObj: ResourceElementMapByIdent, consumerId: string): void;
    loginStatusUpdate(username: string, authenticated: boolean, errorMessage: string): void;
    resourceUpdateComplete(resourceId: number): void;
}

type ResourceElementMapByIdent = {[element: string]: any};

interface RemoteResourceUpdateServerToClient {
    id: number;
    signalTermination(reason: string): void;
    resourceUpdate(id: string, elementObj: ResourceElementMapByIdent, revision: number): void;
}

declare class DebugObjMgr {
    init(): void;
}

declare var gDebugObjMgr: DebugObjMgr;

interface WebSocketOwner {
    openHandler(): void;
    errorHandler(error: any): void;
    messageHandler(data: any): void;
    closeHandler(error: any): void;
}

declare var runtimeEnvironment: {
    name: string; // Name of the environment
    appName: string;
    dirName: string;
    jsdom: any;
    surveyMode: string;
    weakMap: any;
    nodeWebSocketState: (strState: string) => number;
    newWebSocket: (owner: WebSocketOwner, url: string, options: any) => WebSocketConnection;
    performance: {
        now: any; // require("performance-now");
    };
    fs: any; // require("fs");
    path: any; // require("path");
    pathFunctions: PathFunctions;
    supportsPassiveListeners: boolean;
};

interface DataSourceAttributesInfo {
    // Name of the facet/column
    name: string[];
    // Original name, in case it was renamed (names cannot start with _ when uploading to mongodb) 
    originalName?: string[];
    // information about the type of the data in this column: string, number,
    // integer, or mixed. If no data, it's left undefined
    type?: string[];
    // Count of the number of values of each type
    typeCount: any[];
    // Minimum value found if type is not mixed
    min?: number[];
    // Maximum value found if type is not mixed
    max?: number[];
    // Os of unique values, but only when in proportion to the size of the
    // data (when there are less than 12 * Math.log(data.length - 1)
    // such values, to be precise).
    uniqueValues?: any[];
    // Symbol of the currency if it was found
    currency?: string[];
}

interface SupplierDataElementIdMappingRange {
    rowNr: number;
    nrDataElements: number;
    firstDataElementId: number;
    paths: string[][] | {[attr: string]: any};
}

interface SupplierDataPath {
    path: string[];
    indexedValues: SimpleValue[];
    pathValuesRanges: {
        o: number; // offset where this segment starts
        v: SimpleValue[]; // real values or indexed values
    }[];
}

interface SingleRangeRawDataDescription {
    mapping: SupplierDataElementIdMappingRange;
    values?: SupplierDataPath[];
}

type RawDataDescription = SingleRangeRawDataDescription[];
