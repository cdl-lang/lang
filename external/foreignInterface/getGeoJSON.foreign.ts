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

// Gets geo json data from the first argument, which can be a URI string or a
// NativeObjectWrapper containing a File object, and converts it to cdl data
// on every change to the argument

/// <reference path="../../scripts/feg/include/feg/cdl.d.ts" />
/// <reference path="../../scripts/feg/include/feg/result.d.ts" />
/// <reference path="cdlgeometry.d.ts" />

class GetGeoJSONFI extends ForeignInterface {

    uri: any = undefined;
    state: string = "waiting";
    result: any = constEmptyOS;
    resultCallBack: (err: any, data: any) => void = undefined;

    setArgument(i: number, res: Result): boolean {
        if (i === 0 && res instanceof Result) {
            var arg: any = getDeOSedValue(res.value);
            if (!(arg instanceof Array) && this.uri !== arg) {
                this.uri = arg;
                this.loadURI(this.uri);
                return true;
            }
        }
        return false;
    }    

    execute(cb: (err: any, data: any) => void): boolean {
        this.resultCallBack = cb;
        this.publishResult();
        return false;
    }

    publishResult(): void {
        if (this.resultCallBack !== undefined) {
            this.resultCallBack(this.state, this.result);
        }
    }

    loadURI(uri: any): void {
        var self = this;

        if (this.uri instanceof NativeObjectWrapper &&
              this.uri.file !== undefined) {
            var fileReader = new FileReader();
            fileReader.onabort = function () {
                self.abort();
            };
            fileReader.onerror = function (errorEvent) {
                self.error(errorEvent);
            };
            fileReader.onloadend = function () {
                if (fileReader !== undefined) {
                    self.load(fileReader.result.toString());
                    fileReader = undefined;
                }
            };
            fileReader.readAsText(this.uri.file);
        } else if (typeof(this.uri) === "string" &&
                   /^(\.\.?\/|((file|https?|[st]?ftp):\/\/))/.test(this.uri)) {
            var client = new XMLHttpRequest();
            client.onerror = function (errorEvent) {
                self.error(errorEvent);
            };
            client.open("GET", uri, true);
            // workaround for the node package: don't install abort handler
            // before opening.
            client.onabort = function () {
                self.abort();
            };
            client.onloadend = function () {
                if (client !== undefined) {
                    self.load(client.responseText);
                    client = undefined;
                }
            };
            client.send();
        }
    }

    error(errorEvent: any): void {
        this.state = "error";
        this.result = constEmptyOS;
        this.publishResult();
    }

    abort(): void {
        this.state = "error";
        this.result = constEmptyOS;
        this.publishResult();
    }

    load(response: string): void {
        try {
            this.state = "remote";
            this.result = [convertGeoJSONtoCDL(JSON.parse(response))];
            this.publishResult();
        } catch (e) {
            this.error(e);
        }
    }
}

var geoJSONTypeStructure: any = {
    LineString: "Point",
    LinearRing: "Point",
    Polygon: "LinearRing",
    MultiPoint: "Point",
    MultiLineString: "LineString",
    MultiPolygon: "Polygon"
};

function convertGeoJSONtoCDL(geoJSON: any): any {

    function convertGeoJSONCoordinates(coords: any[], parentType: string): any {
        if (parentType === "Point") {
            return { lng: coords[0], lat: coords[1] };
        } else if (coords instanceof Array) {
            var nextType: any = geoJSONTypeStructure[parentType];
            return coords.map(function(coord: any): any {
                var arrObj: any = {};
                arrObj[nextType] = convertGeoJSONCoordinates(coord, nextType);
                return arrObj;
            });
        } else {
            return constEmptyOS;
        }
    }

    function getBBox(coords: any[], parentType: string, bbox: CDLGeoRect): any {
        if (parentType === "Point") {
            var lng: number = coords[0];
            var lat: number = coords[1];
            if (lat > bbox.north[0]) {
                bbox.north[0] = lat;
            }
            if (lat < bbox.south[0]) {
                bbox.south[0] = lat;
            }
            if (lng < bbox.west[0]) {
                bbox.west[0] = lng;
            }
            if (lng > bbox.east[0]) {
                bbox.east[0] = lng;
            }
        } else if (coords instanceof Array) {
            var nextType: any = geoJSONTypeStructure[parentType];
            for (var i = 0; i < coords.length; i++) {
                getBBox(coords[i], nextType, bbox);
            }
        }
    }

    if (geoJSON instanceof Array) {
        return geoJSON.map(convertGeoJSONtoCDL);
    } else if (geoJSON instanceof Object) {
        var cdl: any = {};
        for (var attr in geoJSON) {
            if (attr === "coordinates") {
                cdl[attr] =
                    convertGeoJSONCoordinates(geoJSON[attr], geoJSON.type);
            } else {
                cdl[attr] = ensureOS(convertGeoJSONtoCDL(geoJSON[attr]));
                if (attr === "geometry" && !("bbox" in geoJSON)) {
                    cdl.bbox = [{
                        north: [-90], west: [180], south: [90], east: [-180]
                    }];
                    getBBox(geoJSON.geometry.coordinates, geoJSON.geometry.type,
                            cdl.bbox[0]);
                }
            }
        }
        return cdl;
    } else {
        return geoJSON;
    }
}

addForeignInterface({
    getGeoJSON: wrapForeignInterface(GetGeoJSONFI)
});
