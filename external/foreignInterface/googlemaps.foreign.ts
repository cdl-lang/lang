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

// Note: map objects cannot be destroyed, and google.maps leaks. We therefore
// reuse map objects and the divs they're embedded in.

/// <reference path="../../scripts/feg/include/feg/cdl.d.ts" />
/// <reference path="../../scripts/feg/include/feg/result.d.ts" />

declare var google: any;

class GoogleMapsFI extends ForeignInterface {

    /**
     * list of GoogleMapsFI objects that still need to be initialized; can happen
     * the objects were created before googleMapsInit(), the callback point after
     * loading the google maps scripts, has been called. If any this.map is defined,
     * or there are maps in unusedMaps. objectsToInitialize is guaranteed to be
     * undefined.
     */
    static objectsToInitialize: GoogleMapsFI[] = [];
    /**
     * List of maps that are no longer in use.
     */
    static unusedMaps: GoogleMapsFI[] = [];
    /**
     * List of divs no longer in use. These divs are the ones used to initialize
     * the google.maps.Map objects at the same position in the unusedMaps array, and
     * need to be used in combination with them.
     */
    static unusedDivs: HTMLDivElement[] = [];

    static scriptLoaded: boolean = false;

    div: HTMLDivElement = undefined;
    map: any = undefined;
    initialized: boolean = false;
    ready: boolean = false;
    resultCallback: (err: any, data: any) => void = undefined;
    childGeometry: {[areaId: string]: any} = {};
    options: any = {
        zoom: 1,
        center: {lat: 0, lng: 0},
        mapTypeId: "terrain",
        noClear: true // Note: to reuse maps, this must be true
    };
    result: any = {
        center: {
            lat: 0,
            lng: 0
        }
    };
    childrenAddedBeforeInitialization: {[areaId: string]: Result} = undefined;
    dependentFunctions: GoogleMapsFIDependent[] = [];

    constructor() {
        super();
        if (!GoogleMapsFI.scriptLoaded) {
            var script = document.createElement("script");
            script.src = "https://maps.googleapis.com/maps/api/js?key=AIzaSyAi91NXTuy_XtE9wfTbyTG9V9gEOzQdk-A&callback=googleMapsInit";
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
            GoogleMapsFI.scriptLoaded = true;
        }
    }

    setArgument(i: number, res: Result): boolean {
        if (i === 0 && res instanceof Result) {
            var options = this.convertOptions(res.value);
            if (!(options instanceof Object) || options instanceof NonAV) {
                options = {};
            }
            this.options = mergeConst(options, {
                zoom: 1,
                center: {lat: 0, lng: 0},
                mapTypeId: "terrain"
            });
            if (this.map !== undefined) {
                this.map.setOptions(this.options);
            }
        }
        return false;
    }

    initialize(): void {
        if (this.map !== undefined || this.div === undefined || this.initialized) {
            return;
        }
        this.initialized = true;
        if (GoogleMapsFI.objectsToInitialize === undefined) {
            var self = this;

            // Auxiliary function for sending events
            function sendMouseEvent(subType: string, evt: any): void {
                var message: any = {
                    type: ["GoogleMaps"],
                    subType: [subType],
                    time: [Date.now()],
                    modifier: [],
                    source: [self.local]
                };
                if (evt instanceof Object) {
                    if ("latLng" in evt) {
                        var loc = evt.latLng.toJSON();
                        message.lat = [loc.lat];
                        message.lng = [loc.lng];
                    }
                    if ("placeId" in evt) {
                        message.placeId = [evt.placeId];
                    }
                }
                queueEvent(new ImpersonatedMouseDomEvent("googlemaps", undefined, undefined, undefined, undefined, undefined),
                        message, [{value: subType, areas: []}], [], undefined,
                        [], domEventEmptyOS, undefined, undefined, undefined,
                        undefined, undefined);
            }

            function initMap(): void {
                google.maps.event.trigger(self.map, 'resize');
                self.map.setOptions(self.options);
                for (var areaId in self.childrenAddedBeforeInitialization) {
                    self.addChildArea(areaId, self.childrenAddedBeforeInitialization[areaId], undefined);
                }
                self.childrenAddedBeforeInitialization = undefined;
                self.ready = true;
                self.publishResult();
                var events = ['mouseover', 'mouseout', 'mousedown', 'mouseup', 
                              'click', 'dblclick'];
                self.map.data.addListener('mouseover', (evt: any): void => {
                    self.handleMouseMove(true, evt);
                });
                self.map.data.addListener('mouseout', (evt: any): void => {
                    self.handleMouseMove(false, evt);
                });
                self.map.data.addListener('mousedown', (evt: any): void => {
                    self.handleMouseEvent('mousedown', evt);
                });
                self.map.data.addListener('mouseup', (evt: any): void => {
                    self.handleMouseEvent('mouseup', evt);
                });
            }

            // Reuse a map, or create one
            if (GoogleMapsFI.unusedMaps.length > 0) {
                this.map = GoogleMapsFI.unusedMaps.pop();
                initMap();
            } else {
                this.map = new google.maps.Map(this.div, this.options);
                // Since the div is not ready when the map is created, the map
                //  seems to think it's 0px by 0px, and needs a resize event and
                //  needs to recenter as well.
                google.maps.event.addListenerOnce(this.map, 'idle', initMap);
            }

            // Track center
            this.result.center = this.options.center;
            this.map.addListener('center_changed', function() {
                self.result.center = self.map.getCenter().toJSON();
                self.result.bounds = self.map.getBounds().toJSON();
                self.publishResult();
            });
            // Track zoom
            this.result.zoom = this.options.zoom;
            this.map.addListener('zoom_changed', function() {
                self.result.zoom = self.map.getZoom();
                self.result.center = self.map.getCenter().toJSON();
                self.result.bounds = self.map.getBounds().toJSON();
                self.publishResult();
            });
            // Suppress interruption by the "running div" during dragging, but
            // only temporarily: if there is a longer running update during
            // dragging, the second time out will trigger the running div, but
            // long running updates also interfere with the responsiveness of
            // the dragging itself, so avoid them.
            google.maps.event.addListener(this.map, 'drag', function() {
                suppressRunningUntil = Date.now() + 200;
            });
            // Drag start and end sound messages, so you can suspend heavy
            // computations during dragging.
            google.maps.event.addListener(this.map, 'dragstart', function(evt: any): void {
                sendMouseEvent("DragStart", evt);
            });
            google.maps.event.addListener(this.map, 'dragend', function(evt: any): void {
                sendMouseEvent("DragEnd", evt);
            });
            // Click and double click send events with geo coordinates. You can
            // block their default actions in the options.
            google.maps.event.addListener(this.map, 'click', function(evt: any): void {
                sendMouseEvent("Click", evt);
            });
            google.maps.event.addListener(this.map, 'dblclick', function(evt: any): void {
                sendMouseEvent("DoubleClick", evt);
            });
        } else {
            GoogleMapsFI.objectsToInitialize.push(this);
        }
    }

    /**
     * Removes div (from parent) and event handlers
     */
    release() {
        if (this.div !== undefined) {
            this.div.parentNode.removeChild(this.div);
        }
        if (this.map !== undefined) {
            google.maps.event.clearListeners(this.map);
            this.map.data.clearListeners();
        }
        for (var i = 0; i < this.dependentFunctions.length; i++) {
            this.dependentFunctions[i].unregisterMap();
        }
    }

    execute(cb: (err: any, data: any) => void): boolean {
        this.resultCallback = cb;
        this.publishResult();
        return false;
    }

    publishResult(): void {
        if (this.resultCallback !== undefined) {
            this.resultCallback((this.ready? "remote": "waiting"),
                                normalizeObject(this.result));
        }
        for (var i = 0; i < this.dependentFunctions.length; i++) {
            this.dependentFunctions[i].markAsChanged();
        }
    }

    handleMouseMove(inArea: boolean, evt: any): void {
        suppressRunningUntil = Date.now() + 200;
        globalEventQueue.addPointerInArea(inArea, evt.feature.getId());
    }

    // The event will be propagated and caught by the underlying event handler,
    // which then only has to add google map's click target to its list.
    handleMouseEvent(type: string, evt: any): void {
        suppressRunningUntil = Date.now() + 200;
        gDomEvent.addTargetAreaForNextEvent(type, evt.feature.getId());
    }

    setDiv(area: DisplayArea, displayDiv: HTMLDivElement): HTMLElement|undefined {
        var div = GoogleMapsFI.unusedDivs.length > 0?
                  GoogleMapsFI.unusedDivs.pop(): undefined;

        this.displayOfArea = area;
        if (div === undefined) {
            div = document.createElement("div");
            div.style.position = "absolute";
            div.style.overflow = "hidden";
            div.style.left = "0px";
            div.style.top = "0px";
            div.style.width = "100%";
            div.style.height = "100%";
        }
        this.div = div;
        displayDiv.appendChild(div);
        this.initialize();
        return undefined;
    }

    allowsEmbedding(): boolean {
        return false;
    }

    releaseDiv(): void {
        this.displayOfArea = undefined;
        this.release();
        // Note that if this.div isn't undefined, but this.map is, we let the
        // div go.
        if (this.map !== undefined) {
            GoogleMapsFI.unusedMaps.push(this.map);
            GoogleMapsFI.unusedDivs.push(this.div);
        }
        this.map = undefined;
        this.div = undefined;
        this.initialized = false;
        this.ready = false;
    }

    write(result: Result, mode: WriteMode, attributes: MergeAttributes, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var pct = new PositionChangeTracker();
        var newValue = determineWrite([], result, mode, attributes, positions, pct);
        var newMapOptions: any = undefined;

        for (var i: number = 0; i < newValue.length; i++) {
            var wrElem: any = this.convertOptions(newValue[i]);
            if (isAV(wrElem)) {
                if (typeof(wrElem.zoom) === "number") {
                    if (newMapOptions === undefined) {
                        newMapOptions = {};
                    }
                    this.options.zoom = newMapOptions.zoom = wrElem.zoom;
                }
                if (isAV(wrElem.center)) {
                    if (typeof(wrElem.center.lat) === "number" ||
                          typeof(wrElem.center.lng) === "number") {
                        if (newMapOptions === undefined) {
                            newMapOptions = {};
                        }
                        if (newMapOptions.center === undefined) {
                            newMapOptions.center = shallowCopy(this.options.center);
                        }
                    }
                    if (typeof(wrElem.center.lat) === "number") {
                        this.options.center.lat = newMapOptions.center.lat =
                            wrElem.center.lat;
                    }
                    if (typeof(wrElem.center.lng) === "number") {
                        this.options.center.lng = newMapOptions.center.lng =
                            wrElem.center.lng;
                    }
                }
                if (wrElem.styles instanceof Object) {
                    this.options.styles = mergeConst(wrElem.styles, this.options.styles);
                }
            }
        }
        if (newMapOptions !== undefined && this.map !== undefined) {
            this.map.setOptions(newMapOptions);
        }

        return true;
    }

    addDependentFunction(fi: GoogleMapsFIDependent): void {
        this.dependentFunctions.push(fi);
    }

    removeDependentFunction(fi: GoogleMapsFIDependent): void {
        var index = this.dependentFunctions.indexOf(fi);

        if (index >= 0) {
            this.dependentFunctions.splice(index, 1);
        }
    }

    addChildArea(areaId: string, result: Result, childController: ChildController) {
        if (this.map === undefined) {
            if (this.childrenAddedBeforeInitialization === undefined) {
                this.childrenAddedBeforeInitialization = {};
            }
            this.childrenAddedBeforeInitialization[areaId] = result;
        } else {
            if (result instanceof Result) {
                var r: any = convertCDLtoGeoJSON(result.value);
                var g: any = r.foreign && r.foreign.value && r.foreign.value.geometry?
                    convertGeoJSONtoGoogleMapsGeometry(r.foreign.value.geometry):
                    undefined;
                var feature: any;
                if (g !== undefined) {
                    if (!objectEqual(r.foreign.value.geometry, this.childGeometry[areaId])) {
                        var d = new google.maps.Data.Feature({
                            geometry: g,
                            id: areaId
                        });
                        feature = this.map.data.add(d);
                        this.childGeometry[areaId] = r.foreign.value.geometry;
                    } else {
                        feature = this.map.data.getFeatureById(areaId);
                    }
                    if (feature) {
                        var style: any = {};
                        if (r.background) {
                            style.fillColor = r.background;
                            style.fillOpacity = 1;
                        } else {
                            style.fillOpacity = 0;
                        }
                        if (r.borderColor) {
                            style.strokeColor = r.borderColor;
                        }
                        if (r.borderWidth >= 0) {
                            style.strokeWeight = r.borderWidth;
                        }
                        if (r.opacity >= 0) {
                            style.fillOpacity = r.opacity;
                        }
                        this.map.data.overrideStyle(feature, style);
                    }
                }
            }
        }
    }

    removeChildArea(areaId: string): void {
        if (this.map === undefined) {
            if (this.childrenAddedBeforeInitialization !== undefined) {
                delete this.childrenAddedBeforeInitialization[areaId];
            }
        } else {
            var feature = this.map.data.getFeatureById(areaId);
            if (feature !== undefined) {
                this.map.data.remove(feature);
            }
            delete this.childGeometry[areaId];
        }
        globalEventQueue.addPointerInArea(false, areaId);
    }

    convertOptions(v: any): any {
        var options: any;

        function convertStyles(styles: any): any {
            var res: any = [];

            styles = ensureOS(styles);
            for (var i = 0; i < styles.length; i++) {
                if (isAV(styles[i])) {
                    var style = stripArray(styles[i], true);
                    if (style.stylers !== undefined) {
                        style.stylers = ensureOS(style.stylers);
                    }
                    res.push(style);
                }
            }
            return res;
        }

        if (v instanceof Array) {
            options = v[0];
            for (var i = 0; i < v.length; i++) {
                options = mergeConst(options, v[i]);
            }
        } else {
            options = v;
        }
        if (isAV(options)) {
            for (var attr in options) {
                if (attr === "styles") {
                    options[attr] = convertStyles(options[attr]);
                } else {
                    options[attr] = stripArray(options[attr], true);
                }
            }
        }
        return options;
    }
}

function convertCDLtoGeoJSON(cdl: any): any {

    function convertCDLCoordinates(coord: any): any {
        if (coord instanceof Array) {
            return coord.map(convertCDLCoordinates);
        } else if (coord instanceof Object) {
            if ("Point" in coord) {
                return coord.Point;
            } else if ("LineString" in coord) {
                return convertCDLCoordinates(coord.LineString);
            } else if ("LinearRing" in coord) {
                return convertCDLCoordinates(coord.LinearRing);
            } else if ("Polygon" in coord) {
                return convertCDLCoordinates(coord.Polygon);
            } else if ("LineString" in coord) {
                return convertCDLCoordinates(coord.LineString);
            } else if ("LineString" in coord) {
                return convertCDLCoordinates(coord.LineString);
            }
        }
        return coord;
    }

    if (cdl instanceof Array) {
        return cdl.length === 1?
               convertCDLtoGeoJSON(cdl[0]): cdl.map(convertCDLtoGeoJSON);
    } else if (cdl instanceof Object) {
        var geoJSON: any = {};
        for (var attr in cdl) {
            geoJSON[attr] = attr === "coordinates"?
                convertCDLCoordinates(cdl[attr]):
                convertCDLtoGeoJSON(cdl[attr]);
        }
        return geoJSON;
    } else {
        return cdl;
    }
}

function convertGeoJSONtoGoogleMapsGeometry(geoJSON: any): any {
    if (!geoJSON || typeof(geoJSON) !== "object") {
        return undefined;
    }
    switch (geoJSON.type) {
      case "Point":
        return new google.maps.Data.Point(geoJSON.coordinates);
      case "MultiPoint":
        return new google.maps.Data.MultiPoint(geoJSON.coordinates);
      case "LineString":
        return new google.maps.Data.LineString(geoJSON.coordinates);
      case "MultiLineString":
        return new google.maps.Data.MultiLineString(geoJSON.coordinates);
      case "LinearRing":
        return new google.maps.Data.LinearRing(geoJSON.coordinates);
      case "Polygon":
        return new google.maps.Data.Polygon(geoJSON.coordinates);
      case "MultiPolygon":
        return new google.maps.Data.MultiPolygon(geoJSON.coordinates);
      default:
        return undefined;
    }
}

function googleMapsInit(): void {
    var oti = GoogleMapsFI.objectsToInitialize;

    GoogleMapsFI.objectsToInitialize = undefined;
    for (var i = 0; i < oti.length; i++) {
        var gmfi = oti[i];
        gmfi.initialized = false;
        gmfi.initialize();
    }
}

addForeignInterface({google: {maps: wrapForeignInterface(GoogleMapsFI)}});

abstract class GoogleMapsFIDependent extends ForeignInterface {

    registeredMap: GoogleMapsFI = undefined;
    ready: boolean = false;
    result: any = constEmptyOS;
    resultCallback: (err: any, data: any) => void = undefined;

    destroy(): void {
        if (this.registeredMap !== undefined) {
            this.registeredMap.removeDependentFunction(this);
            this.registeredMap = undefined;
        }
        super.destroy();
    }

    publishResult(): void {
        if (this.resultCallback !== undefined) {
            this.resultCallback((this.ready? "remote": "waiting"),
                                normalizeObject(this.result));
        }
    }

    unregisterMap(): void {
        this.registeredMap = undefined;
    }

    markAsChanged(): void {
        this.execute(this.resultCallback);
    }
}

/**
 * Implements "geo query" for a google maps object: turns lat/lng into offset
 * in area. First argument is a GoogleMaps foreign interface, the second an os
 * of lat/lng coordinates.
 */
class GoogleMapsGeo2Offset extends GoogleMapsFIDependent {

    execute(cb: (err: any, data: any) => void): boolean {
        var arg0 = this.arguments[0];
        var arg1 = this.arguments[1];
        var res: any = [];

        this.resultCallback = cb;
        if (arg0 === undefined ||
              !(arg0.foreignInterfaceSource instanceof GoogleMapsFI)) {
            cb("error", constEmptyOS);
            return false;
        }
        var foreignInterface = arg0.foreignInterfaceSource;
        if (foreignInterface !== this.registeredMap) {
            this.ready = false;
            if (this.registeredMap !== undefined) {
                this.registeredMap.removeDependentFunction(this);
            }
            this.registeredMap = foreignInterface;
            foreignInterface.addDependentFunction(this);
        }
        var map = foreignInterface.map;
        if (map === undefined) {
            cb("waiting", constEmptyOS);
            return false;
        }
        this.ready = true;

        // Inverse of GoogleMapsOffset2Geo, so converts lat/lng and the maps
        // north-west corner to points, and multiplies the difference by scale.
        var proj = map.getProjection();
        var bounds = map.getBounds().toJSON();
        var nwLatLng = new google.maps.LatLng(bounds.north, bounds.west);
        var nwPoint = proj.fromLatLngToPoint(nwLatLng);
        var scale = 1 << map.getZoom();

        if (arg1 !== undefined && arg1.value instanceof Array) {
            for (var i = 0; i < arg1.value.length; i++) {
                var elt = stripArray(arg1.value[i]);
                if (isAV(elt) && typeof(elt.lat) === "number" &&
                      typeof(elt.lng) === "number") {
                    var latLng = new google.maps.LatLng(elt.lat, elt.lng);
                    var point = proj.fromLatLngToPoint(latLng);
                    var cnv = {
                        top: (point.y - nwPoint.y) * scale,
                        left: (point.x - nwPoint.x) * scale
                    };
                    res = res.concat(normalizeObject(cnv));
                }
            }
        }
        this.result = res;
        this.publishResult();
        return false;
    }
}

addForeignInterface({
    google: {
        geoToOffset: wrapForeignInterface(GoogleMapsGeo2Offset)
    }
});

/**
 * Implements "geo query" for a google maps object: turns top/left offsets in
 * area into lat/lng; if the object contains height and width as well, it's
 * converted into north, west, south and east.
 */
class GoogleMapsOffset2Geo extends GoogleMapsFIDependent {
    execute(cb: (err: any, data: any) => void): boolean {
        var arg0 = this.arguments[0];
        var arg1 = this.arguments[1];
        var res: any = [];

        this.resultCallback = cb;
        if (arg0 === undefined ||
              !(arg0.foreignInterfaceSource instanceof GoogleMapsFI)) {
            cb("error", constEmptyOS);
            return false;
        }
        var foreignInterface = arg0.foreignInterfaceSource;
        if (foreignInterface !== this.registeredMap) {
            this.ready = false;
            if (this.registeredMap !== undefined) {
                this.registeredMap.removeDependentFunction(this);
            }
            this.registeredMap = foreignInterface;
            foreignInterface.addDependentFunction(this);
        }
        var map = foreignInterface.map;
        if (map === undefined) {
            cb("waiting", constEmptyOS);
            return false;
        }
        this.ready = true;

        // Convert north-west corner into a Point, add the top/left of the offset
        // to it, compensating for the scale, and convert that back to LatLng.
        // Things to know: a Point is a scale dependent absolute value.
        // When maximally zoomed out, lat:0, lng:0 corresponds to (64,64), and
        // that doubles for every zoom level.
        var proj = map.getProjection();
        var bounds = map.getBounds().toJSON();
        var nwLatLng = new google.maps.LatLng(bounds.north, bounds.west);
        var nwPoint = proj.fromLatLngToPoint(nwLatLng);
        var scale = 1 << map.getZoom();

        if (arg1 !== undefined && arg1.value instanceof Array) {
            for (var i = 0; i < arg1.value.length; i++) {
                var elt = stripArray(arg1.value[i]);
                if (isAV(elt) && typeof(elt.left) === "number" &&
                      typeof(elt.top) === "number") {
                    var point = new google.maps.Point(nwPoint.x + elt.left / scale,
                                                      nwPoint.y + elt.top / scale);
                    var cnv = proj.fromPointToLatLng(point).toJSON();
                    if (typeof(elt.height) === "number" &&
                          typeof(elt.width) === "number") {
                        var nw = cnv;
                        point = new google.maps.Point(point.x + elt.width / scale,
                                                      point.y + elt.height / scale);
                        var se = proj.fromPointToLatLng(point);
                        cnv = {
                            north: nw.lat,
                            west: nw.lng,
                            south: se.lat(),
                            east: se.lng()
                        }
                    }
                    res = res.concat(normalizeObject(cnv));
                }
            }
        }
        this.result = res;
        this.publishResult();
        return false;
    }
}

addForeignInterface({
    google: {
        offsetToGeo: wrapForeignInterface(GoogleMapsOffset2Geo)
    }
});
