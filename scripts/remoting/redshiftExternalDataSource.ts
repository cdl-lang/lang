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

/// <reference path="externalDataSourceAPI.ts" />
/// <reference path="../feg/utilities.ts" />
/// <reference path="remotingLog.ts" />


let Redshift = require('node-redshift');

// Parse int8, i.e. 8 byte ints, as numbers. For some historical reason, pg (the
// underlying library) doesn't do that, even though it works for numbers 2^63-1.
let types = require('pg').types;
types.setTypeParser(20, function(val: any) {
  return parseInt(val);
});

/**
 * Performs a single query on a redshift db and stores the data until no more
 * resources share it.
 * 
 * The client is ready when "data" and/or "err" have been set.
 */
class RedShiftClient {
    nrSharingResources: number = 0;
	readyQueue: ReadyInterface[];

    static clients: {[id: string]: RedShiftClient} = {};

    static getSharedClient(dataSourceSpec: ExternalDataSourceSpecification, queryParameters: any[]): RedShiftClient {
        var clientId = dataSourceSpec.id + ":" + JSON.stringify(queryParameters);
        var client = RedShiftClient.clients[clientId];

        if (client === undefined) {
            client = new RedShiftClient(dataSourceSpec, queryParameters, clientId);
            RedShiftClient.clients[clientId] = client;
        }
        client.nrSharingResources++;
        return client;
    }

    client: {
        host: string;
        port: number;
        database: string;
        user: string;
        password: string;
    };

    id: string;
    query: string;

    err: any;
    data: any[];
    dataRevision: number = Date.now();

    constructor(dataSourceSpec: ExternalDataSourceSpecification, public queryParameters: any[], public clientId: string) {
        this.id = dataSourceSpec.id;
        this.client = {
            host: dataSourceSpec.hostname,
            port: dataSourceSpec.portNumber === undefined? 5439: dataSourceSpec.portNumber,
            database: dataSourceSpec.database,
            user: dataSourceSpec.credentials.username,
            password: dataSourceSpec.credentials.password
        };
        this.query = dataSourceSpec.query;

        let redshiftClient = new Redshift(this.client, {rawConnection: false});
        RemotingLog.log(5, () => "create " + this.id + ": sending query: " + this.query);
        redshiftClient.parameterizedQuery(
            this.query,
            dataSourceSpec.queryParameters === undefined? undefined: this.queryParameters,
            {raw: true},
            (err: any, data: any): void => {
                RemotingLog.log((err? 0: 5), () => this.id + ": received: " +
                    (err? "error " + err.toString(): data.length + " nr rows"));
                this.err = err;
                this.data = err? []: data;
                this.setReady();
            }
        );
    }

    destroy(): void {
        RemotingLog.log(5, () => "destroy " + this.id);
        delete this.data; // just to be sure
        this.clientId = undefined;
    }

    releaseClient(obj: ReadyInterface|undefined): void {
        this.nrSharingResources--;
        if (this.readyQueue !== undefined && obj !== undefined) {
            let index = this.readyQueue.indexOf(obj);
            if (index >= 0) {
                this.readyQueue.splice(index, 1);
            }
        }
        if (this.nrSharingResources === 0) {
            delete RedShiftClient.clients[this.clientId];
            this.destroy();
        }
    }

	isReady(obj: ReadyInterface): boolean {
        if ("data" in this) {
            return true;
        }
        if (this.readyQueue === undefined) {
            this.readyQueue = [];
        }
        this.readyQueue.push(obj);
        return false;
    }

    setReady(): void {
        if (this.readyQueue !== undefined) {
            for (var i = 0; i < this.readyQueue.length; i++) {
                this.readyQueue[i].setReady();
            }
            this.readyQueue = undefined
        }
    }
}

class RedShiftExternalDataSource extends ExternalDataSource {
    client: RedShiftClient;
    delayedCallback: (err: any, data: any, rev: number) => void = undefined;

    static accepts(dataSourceSpec: ExternalDataSourceSpecification, path: string[]): boolean {
        return dataSourceSpec.type === "redshift" &&
               typeof(dataSourceSpec.database) === "string" &&
               path.length <= 1;
    }

    constructor(dataSourceSpec: ExternalDataSourceSpecification, parameterValues: any[], path: string[]) {
        super(dataSourceSpec, parameterValues, path);
        this.client = RedShiftClient.getSharedClient(dataSourceSpec, parameterValues);
    }

    destroy(): void {
        this.client.releaseClient(this);
        this.client = undefined;
    }

    getData(cb: (err: any, data: any, rev: number) => void): void {
        if (!this.client.isReady(this)) {
            this.delayedCallback = cb;
            return;
        }
        this.delayedCallback = undefined;
        if (this.client.err) {
            cb(this.client.err, undefined, this.client.dataRevision);
        } else {
            cb(null, this.extractData(this.client.data), this.client.dataRevision);
        }
    }

    setReady(): void {
        if (this.delayedCallback !== undefined) {
            this.getData(this.delayedCallback);
        }
    }

    // Extracts data for the current path (can be the top path), and synthesizes
    // the attribute recordId if it doesn't exist.
    extractData(rawData: any[]): (SingleRangeRawDataDescription|SupplierDataPath)[] {
        if (this.path.length === 0) {
            var representativeAV = rawData.length === 0? {}: rawData[0];
            var paths = Object.keys(representativeAV).map(attr => [attr]);
            if (!("recordId" in representativeAV)) {
                paths.push(["recordId"]);
            }
            return [{
                path: this.path,
                mapping: {
                    rowNr: 0,
                    nrDataElements: rawData.length,
                    firstDataElementId: 0,
                    paths: paths
                }
            }];
        } else {
            var attr = this.path[0];
            var indexedValues: any[]|undefined;
            var compressedData: {o: number; v: any[];}[];
            if (attr === "recordId" && rawData.length > 0 && !(attr in rawData[0])) {
                compressedData = [{o: 0, v: rawData.map((value, index) => index)}];
            } else {
                var columnData = rawData.map(row => row[attr]);
                indexedValues = getUniqueValues(columnData);
                compressedData = compressRawData(columnData, indexedValues);
            }
            return [{
                path: this.path,
                indexedValues: indexedValues,
                pathValuesRanges: compressedData
             }];
        }
    }
}

externalDataSourceClasses.push({
    classConstructor: RedShiftExternalDataSource,
    accepts: RedShiftExternalDataSource.accepts
});
