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

/// <reference path="../../scripts/feg/include/feg/cdl.d.ts" />
/// <reference path="../../scripts/feg/include/feg/result.d.ts" />
/// <reference path="cdlgeometry.d.ts" />

interface GraphCanvasFICoordinates {
    x: number;
    y: number;
}

interface GraphCanvasFILine {
    connect?: boolean;
    lineColor?: string;
    lineWidth?: string;
}

interface GraphCanvasFIColored {
    fillColor?: string;
    strokeColor?: string;
    strokeWidth?: number;
}

interface GraphCanvasFIPoint extends GraphCanvasFICoordinates, GraphCanvasFILine, GraphCanvasFIColored {
    type: "point";
}

interface GraphCanvasFIBoxed extends GraphCanvasFICoordinates, GraphCanvasFIColored, GraphCanvasFILine {
    width: number|string|undefined;
    height: number|string|undefined;
}

interface GraphCanvasFICircle extends GraphCanvasFICoordinates, GraphCanvasFIColored, GraphCanvasFILine {
    type: "circle";
    radius: number|string|undefined;
}

interface GraphCanvasFIEllipse extends GraphCanvasFIBoxed {
    type: "ellipse";
}

interface GraphCanvasFIRectangle extends GraphCanvasFIBoxed {
    type: "rectangle";
}

interface GraphCanvasFIArc extends GraphCanvasFICoordinates, GraphCanvasFIColored, GraphCanvasFILine {
    type: "arc";
    radius: number|string|undefined;
    inset?: number|string|undefined;
    start?: number;
    range?: number;
    end?: number;
}

interface GraphCanvasFIBar extends GraphCanvasFICoordinates, GraphCanvasFIColored, GraphCanvasFILine {
    type: "bar";
    width: number|string|undefined;
}

interface GraphCanvasFIGeometry extends GraphCanvasFIColored {
    type: "geometry";
    geometry: CDLGeometry;
}

type GraphCanvasFIConnectedElement = GraphCanvasFIPoint | GraphCanvasFIEllipse |
               GraphCanvasFIRectangle | GraphCanvasFIArc | GraphCanvasFICircle |
               GraphCanvasFIBar;

type GraphCanvasFIElement = GraphCanvasFIConnectedElement | GraphCanvasFIGeometry;

class GraphCanvasFI extends ForeignInterface implements Watcher {

    xLow: number = 0;
    xHigh: number = 1;
    yLow: number = 0;
    yHigh: number = 1;
    config: {
        xLow: number;
        xHigh: number;
        yLow: number;
        yHigh: number;
        xGrid?: number;
        yGrid?: number;
        gridWidth?: number;
        gridStyle?: string;
        shadowColor?: string;
        shadowBlur?: number;
        shadowOffsetX?: number;
        shadowOffsetY?: number;
        background?: string;
    };

    controllers = new Map<number, {
        controller: ChildController;
        areaIdToPoint: Map<string, GraphCanvasFIElement>;
    }>();
    canvas: HTMLCanvasElement = undefined;
    result: any = [true]; // result must match true
    resultCallBack: (err: any, data: any) => void = undefined;

    setDiv(area: DisplayArea, displayDiv: HTMLDivElement): HTMLElement|undefined {
        this.displayOfArea = area;
        this.canvas = document.createElement("canvas");
        this.canvas.style.position = "absolute";
        this.canvas.style.overflow = "hidden";
        this.canvas.style.left = "0px";
        this.canvas.style.top = "0px";

        displayDiv.appendChild(this.canvas);

        this.initialize();

        return this.canvas;
    }

    releaseDiv(): void {
        this.displayOfArea = undefined;
        if (this.canvas !== undefined) {
            this.canvas.parentNode.removeChild(this.canvas);
            this.canvas = undefined;
        }
    }

    isDisplay(): boolean {
        return this.canvas !== undefined;
    }

    execute(cb: (err: any, data: any) => void): boolean {
        let r = this.initialize();

        this.resultCallBack = cb;
        this.publishResult();
        return r;
    }

    publishResult(): void {
        if (this.resultCallBack !== undefined) {
            this.resultCallBack("remote", this.result);
        }
    }

    initialize(): boolean {
        if (this.canvas === undefined || !(this.arguments[0] instanceof Result)) {
            return false;
        }
        let config: any = stripArray(this.arguments[0].value, true);
        if (!isAV(config)) {
            return false;
        }
        let bg: any = config.backgroundColor;
        if (typeof(bg) === "string") {
            this.canvas.style.backgroundColor = bg;
        }
        if (!objectEqual(this.config, config)) {
            this.config = config;
            this.xLow = config.xLow;
            this.xHigh = config.xHigh;
            this.yLow = config.yLow;
            this.yHigh = config.yHigh;
            this.config.background = bg;
            return true;
        }
        return false;
    }

    addChildArea(areaId: string, result: Result, controller: ChildController): void {
        if (result instanceof Result) {
            if (!this.controllers.has(controller.watcherId)) {
                this.controllers.set(controller.watcherId, {
                    controller: controller,
                    areaIdToPoint: new Map()
                });
                controller.addWatcher(this, controller.watcherId, false);
            }
            let controllerInfo = this.controllers.get(controller.watcherId);
            let displayValue: any = stripArray(result.value, true);
            if (isAV(displayValue) && isAV(displayValue.foreign) &&
                  isAV(displayValue.foreign.value)) {
                controllerInfo.areaIdToPoint.set(areaId, displayValue.foreign.value);
            } else {
                controllerInfo.areaIdToPoint.set(areaId, undefined);
            }
        }
    }

    removeChildArea(areaId: string, controller: ChildController): void {
        if (!this.controllers.has(controller.watcherId)) {
            let controllerInfo = this.controllers.get(controller.watcherId);
            if (controllerInfo.areaIdToPoint.delete(areaId)) {
                if (controllerInfo.areaIdToPoint.size === 0) {
                    controller.removeWatcher(this, false);
                    this.controllers.delete(controller.watcherId);
                }
            }
        }
    }

    wrapUpVisuals(): void {
        let ctx = this.canvas.getContext("2d");
        let rect = this.canvas.getBoundingClientRect();
        let xf = rect.width / (this.xHigh - this.xLow);
        let yf = rect.height / (this.yHigh - this.yLow);

        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        this.resetCanvas(ctx);
        this.drawGrid(ctx, rect);
        this.setGraphOptions(ctx);
        for (let [watcherId, controllerInfo] of this.controllers) {
            let orderedAreaList: ElementReference[] = controllerInfo.controller.result.value;
            let areaIdToPoint = controllerInfo.areaIdToPoint;
            if (orderedAreaList instanceof Array && orderedAreaList.length > 1) {
                let connect: boolean = false;
                ctx.beginPath();
                for (var i = 0; i < orderedAreaList.length; i++) {
                    let areaId = orderedAreaList[i].element;
                    let elt = areaIdToPoint.get(areaId);
                    if (isAV(elt) && elt.type !== "geometry") {
                        if (i === 0) {
                            ctx.strokeStyle = GraphCanvasFI.defaultString(elt.lineColor, "black");
                            ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.lineWidth, 1);
                        }
                        connect = this.drawLine(elt, xf, yf, connect, ctx);
                    } else {
                        connect = false;
                    }
                }
                ctx.stroke();
                for (var i = 0; i < orderedAreaList.length; i++) {
                    let areaId = orderedAreaList[i].element;
                    let elt = areaIdToPoint.get(areaId);
                    if (isAV(elt)) {
                        this.drawElement(elt, xf, yf, ctx);
                    } else {
                        connect = false;
                    }
                }
            }
        }
    }

    private resetCanvas(ctx: CanvasRenderingContext2D): void {
        ctx.shadowColor = "";
    }

    private drawGrid(ctx: CanvasRenderingContext2D, rect: ClientRect): void {
        let xf = rect.width / (this.xHigh - this.xLow);
        let yf = rect.height / (this.yHigh - this.yLow);
        let xGrid = this.config.xGrid;
        let yGrid = this.config.yGrid;

        ctx.lineWidth = GraphCanvasFI.defaultNumber(this.config.gridWidth, 1);
        ctx.strokeStyle = GraphCanvasFI.defaultString(this.config.gridStyle, "lightgrey");
        if (typeof(xGrid) === "number") {
            ctx.beginPath();
            for (let x = this.xLow + xGrid; x < this.xHigh; x += xGrid) {
                let xc = (x - this.xLow) * xf;
                ctx.moveTo(xc, 0);
                ctx.lineTo(xc, rect.height);
            }
            ctx.stroke();
        }
        if (typeof(yGrid) === "number") {
            ctx.beginPath();
            for (let y = this.yLow + yGrid; y < this.yHigh; y += yGrid) {
                let yc = (this.yHigh - y) * yf;
                ctx.moveTo(0, yc);
                ctx.lineTo(rect.width, yc);
            }
            ctx.stroke();
        }
    }

    private setGraphOptions(ctx: CanvasRenderingContext2D): void {
        if (typeof(this.config.shadowColor) === "string") {
            ctx.shadowColor = this.config.shadowColor;
            ctx.shadowBlur = GraphCanvasFI.defaultNumber(this.config.shadowBlur, 0);
            ctx.shadowOffsetX = GraphCanvasFI.defaultNumber(this.config.shadowOffsetX, 0);
            ctx.shadowOffsetY = GraphCanvasFI.defaultNumber(this.config.shadowOffsetY, 0);
        }
    }

    private drawLine(elt: GraphCanvasFIConnectedElement, xf: number, yf: number,
                     connect: boolean, ctx: CanvasRenderingContext2D): boolean {
        let x = (elt.x - this.xLow) * xf;
        let y = (this.yHigh - elt.y) * yf;

        if (isNaN(x) || isNaN(y)) {
            return false;
        }
        if (connect && elt.connect) {
            ctx.lineTo(x, y);
            ctx.stroke();
        } else {
            ctx.moveTo(x, y);
        }
        return true;
    }

    private drawElement(elt: GraphCanvasFIElement, xf: number, yf: number,
                        ctx: CanvasRenderingContext2D): void {
        if (elt.type === "geometry") {
            this.drawGeometry(elt, xf, yf, ctx);
            return;
        }
        let x = (elt.x - this.xLow) * xf;
        let y = (this.yHigh - elt.y) * yf;
        let width: number;
        let height: number;
        let radius: number;

        if (isNaN(x) || isNaN(y)) {
            return;
        }
        switch (elt.type) {
          case "point":
            if (!elt.connect) {
                ctx.beginPath();
                ctx.moveTo(x, y);
                ctx.strokeStyle = GraphCanvasFI.defaultString(elt.strokeColor, "black");
                ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);
                ctx.lineTo(x + 1, y);
                ctx.stroke();            
            }
            break;
          case "rectangle":
          case "ellipse":
            width = this.sizeInPixels(elt.width, xf, 3);
            height = this.sizeInPixels(elt.height, yf, 3);
            if (elt.type === "rectangle") {
                if (typeof(elt.fillColor) === "string") {
                    ctx.fillStyle = elt.fillColor;
                    ctx.fillRect(x - width / 2, y - height / 2, width, height);
                }
                if (typeof(elt.strokeColor) === "string") {
                    ctx.strokeStyle = elt.strokeColor;
                    ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);
                    ctx.strokeRect(x - width / 2, y - height / 2, width, height);
                }
            } else {
                ctx.fillStyle = GraphCanvasFI.defaultString(elt.fillColor, "");
                ctx.strokeStyle = GraphCanvasFI.defaultString(elt.strokeColor, "black");
                ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);
                ctx.ellipse(x, y, width / 2, height / 2, 0, 0, Math.PI * 2);
            }
            break;
          case "circle":
            radius = this.sizeInPixels(elt.radius, Math.min(xf, yf), 3);
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 6.283185307179586);
            if (typeof(elt.fillColor) === "string") {
                ctx.fillStyle = elt.fillColor;
                ctx.fill();
            }
            if (typeof(elt.strokeColor) === "string") {
                ctx.strokeStyle = elt.strokeColor;
                ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);
                ctx.stroke();
            }
            break;
          case "bar":
            width = this.sizeInPixels(elt.width, xf, 3);
            height = ctx.canvas.height - y;
            if (typeof(elt.fillColor) === "string") {
                ctx.fillStyle = elt.fillColor;
                ctx.fillRect(x - width / 2, y, width, height);
            }
            if (typeof(elt.strokeColor) === "string") {
                ctx.strokeStyle = elt.strokeColor;
                ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);
                ctx.strokeRect(x - width / 2, y, width, height);
            }
            break;
          case "arc":
            let start = typeof(elt.start) === "number"? (elt.start - 0.25) * 6.283185307179586: -1.570796326794897;
            let end = typeof(elt.end) === "number"? (elt.end - 0.25) * 6.283185307179586:
                      typeof(elt.range) === "number"? elt.range * 6.283185307179586 + start:
                      4.71238898038469;
            let inset = this.sizeInPixels(elt.inset, Math.min(xf, yf), 3);
            radius = this.sizeInPixels(elt.radius, Math.min(xf, yf), 3);
            ctx.lineWidth = radius - inset;
            ctx.strokeStyle = GraphCanvasFI.defaultString(elt.strokeColor, "black");
            radius -= (radius - inset) / 2;
            ctx.beginPath();
            ctx.arc(x, y, radius, start, end, false);
            if (typeof(elt.fillColor) === "string") {
                ctx.fillStyle = elt.fillColor;
                ctx.fill();
            }
            ctx.stroke();
            break;
        }
    }

    private drawGeometry(elt: GraphCanvasFIGeometry, xf: number, yf: number,
                         ctx: CanvasRenderingContext2D): void {
        let xLow = this.xLow;
        let yHigh = this.yHigh;
        let selfConfig = this.config;

        function drawPoint(geo: CDLGeometryPointShape): void {
            let point = geo.Point;
            let x = (point.lng - xLow) * xf;
            let y = (yHigh - point.lat) * yf;
            let radius = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);

            ctx.strokeStyle = GraphCanvasFI.defaultString(elt.strokeColor, "black");
            ctx.lineWidth = radius;
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        function drawLine(geo: CDLGeometryPointShape[]|CDLGeometryPointShape): void {
            let arr = geo instanceof Array? geo: [geo];

            ctx.beginPath();
            for (var i = 0; i < arr.length; i++) {
                let point = arr[i].Point;
                let x = (point.lng - xLow) * xf;
                let y = (yHigh - point.lat) * yf;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.strokeStyle = GraphCanvasFI.defaultString(elt.strokeColor, "black");
            ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);
            ctx.stroke();
        }
        function drawLinearRing(geo: CDLGeometryPointShape[]|CDLGeometryPointShape, fill: boolean): void {
            let arr = geo instanceof Array? geo: [geo];

            ctx.beginPath();
            for (var i = 0; i < arr.length; i++) {
                let point = arr[i].Point;
                let x = (point.lng - xLow) * xf;
                let y = (yHigh - point.lat) * yf;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.closePath();
            if (elt.strokeColor !== undefined) {
                ctx.strokeStyle = GraphCanvasFI.defaultString(elt.strokeColor, "black");
                ctx.lineWidth = GraphCanvasFI.defaultNumber(elt.strokeWidth, 1);
                ctx.stroke();
            }
            if (fill) {
                if (elt.fillColor !== undefined) {
                    ctx.fillStyle = GraphCanvasFI.defaultString(elt.fillColor, "black");
                    ctx.fill();
                }
            } else {
                ctx.fillStyle = GraphCanvasFI.defaultString(selfConfig.background, "white");
                ctx.fill();
            }
        }
        function drawMultiLine(geo: CDLGeometryLineShape[]|CDLGeometryLineShape): void {
            let arr = geo instanceof Array? geo: [geo];

            for (var i = 0; i < arr.length; i++) {
                drawLine(arr[i].Line);
            }
        }
        function drawPolygon(geo: CDLGeometryLinearRingShape[]|CDLGeometryLinearRingShape): void {
            let arr = geo instanceof Array? geo: [geo];

            for (var i = 0; i < arr.length; i++) {
                drawLinearRing(arr[i].LinearRing, i === 0);
            }
        }
        function drawMultiPolygon(geo: CDLGeometryPolygonShape[]|CDLGeometryPolygonShape): void {
            let arr = geo instanceof Array? geo: [geo];

            for (var i = 0; i < arr.length; i++) {
                drawPolygon(arr[i].Polygon);
            }
        }

        let geo = elt.geometry.geometry;
        switch (geo.type) {
          case "MultiPolygon":
            drawMultiPolygon(geo.coordinates);
            break;
          case "Polygon":
            drawPolygon(geo.coordinates);
            break;
          case "LinearRing":
            drawLinearRing(geo.coordinates, true);
            break;
          case "MultiLine":
            drawMultiLine(geo.coordinates);
            break;
          case "Line":
            drawLine(geo.coordinates);
            break;
          case "Point":
            drawPoint(geo.coordinates);
            break;
        }
    }

    displayElementVisible(): void {
        this.wrapUpVisuals();
    }

    // Watcher interface

    watcherId: number = getNextWatcherId();
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    attributedTime: number;

    updateInput(id: any, result: Result): void {
        throw new Error("Method not implemented.");
    }

    debugName(): string {
        return "GraphCanvasFI";
    }

    getDebugOrigin(): string[] {
        return undefined;
    }

    isDeferred(): boolean {
        return false;
    }

    defer(): void {
    }

    undefer(): void {
    }

    isActive(): boolean {
        return true;
    }

    isReady(): boolean {
        return true;
    }

    static defaultString(str: any, def: string): string {
        return typeof(str) === "string"? str: def;
    }

    static defaultNumber(n: any, def: number): number {
        return typeof(n) === "number"? n: def;
    }

    sizeInPixels(v: any, f: number, defaultValue: number): number {
        if (v === undefined) {
            return defaultValue;
        } else  if (typeof(v) === "string") {
            if (v.endsWith("px")) {
                var s = parseInt(v);
                return isNaN(s)? defaultValue: s;
            } else if (v.endsWith("%")) {
                var s = parseFloat(v);
                return isNaN(s)? defaultValue: s / 100 * this.canvas.width;
            } else {
                return defaultValue;
            }
        } else {
            return v * f;
        }
    }
}

addForeignInterface({
    graphCanvas: wrapForeignInterface(GraphCanvasFI)
});
