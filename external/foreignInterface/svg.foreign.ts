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

function testOneAV<T>(v: any, cb: (av: {[attr: string]: any}) => T): T|undefined {
    return isAV(v)? cb(v): undefined;
}

function testOneAVAttr<T>(v: any, attr: string, cb: (attrValue: any) => T): T|undefined {
    return testOneAV(v, (av) => av[attr] !== undefined? cb(av[attr]): undefined);
}

function testValue(v: any): string|number|undefined {
    return typeof(v) === "string" || typeof(v) === "number"? v: undefined;
}

class SVGFI extends ForeignInterface implements Watcher {

    controllers = new Map<number, {
        controller: ChildController;
        areaIdToDescription: Map<string, any>;
        areaIdToPrevDescription: Map<string, any>;
        areaIdToSVGElement: Map<string, SVGElement>;
    }>();
    // div: HTMLDivElement = undefined;
    svg: SVGSVGElement = undefined;
    result: any = [true]; // result must match true
    resultCallBack: (err: any, data: any) => void = undefined;

    setDiv(area: DisplayArea, displayDiv: HTMLDivElement): HTMLElement|undefined {
        this.displayOfArea = area;
        // this.div = document.createElement("div");
        this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        this.svg.setAttribute("version", "1.1");
        this.svg.setAttribute("width", "100");
        this.svg.setAttribute("height", "100");
        this.svg.setAttribute("baseProfile", "full");
        // this.div.appendChild(this.svg);
        // displayDiv.appendChild(this.div);
        displayDiv.appendChild(this.svg);
        if (this.arguments !== undefined && this.arguments[0] !== undefined) {
            this.setViewBox();
        }
        return undefined;
    }

    releaseDiv(): void {
        this.displayOfArea = undefined;
        if (this.svg !== undefined) {
            this.svg.parentNode.removeChild(this.svg);
            this.svg = undefined;
        }
    }

    setArgument(i: number, arg: Result): boolean {
        const r: boolean = super.setArgument(i, arg);
        
        if (this.arguments[0] !== undefined && this.svg !== undefined) {
            this.setViewBox();
        }
        return r;
    }

    private setViewBox(): void {
        const v: any = stripArray(this.arguments[0].value, true);

        if (isAV(v) && isAV(v.viewBox)) {
            const viewBox: any = v.viewBox;
            let x: number = typeof(viewBox.x) === "number"? viewBox.x: 0;
            let y: number = typeof(viewBox.y) === "number"? viewBox.y: 0;
            let width: number|undefined = typeof(viewBox.width) === "number"? viewBox.width: undefined;
            let height: number|undefined = typeof(viewBox.height) === "number"? viewBox.height: undefined;
            if (width === undefined || height === undefined) {
                this.svg.removeAttribute("viewBox");
            } else {
                this.svg.setAttribute("viewBox",
                    String(x) + " " + String(y) + " " + String(width) + " " + String(height));
            }
        } else {
            this.svg.removeAttribute("viewBox");
        }
    }

    isDisplay(): boolean {
        return this.svg !== undefined;
    }

    execute(cb: (err: any, data: any) => void): boolean {
        this.resultCallBack = cb;
        this.publishResult();
        return false;
    }

    publishResult(): void {
        if (this.resultCallBack !== undefined) {
            this.resultCallBack("remote", this.result);
        }
    }

    addChildArea(areaId: string, result: Result, controller: ChildController): void {
        if (result instanceof Result) {
            if (!this.controllers.has(controller.watcherId)) {
                this.controllers.set(controller.watcherId, {
                    controller: controller,
                    areaIdToDescription: new Map(),
                    areaIdToPrevDescription: new Map(),
                    areaIdToSVGElement: new Map()
                });
                controller.addWatcher(this, controller.watcherId, false);
            }
            const controllerInfo = this.controllers.get(controller.watcherId);
            const displayValue: any = stripArray(result.value, true);
            if (testOneAVAttr(displayValue, "foreign", (fv) => testOneAVAttr(fv, "value", isTrue))) {
                controllerInfo.areaIdToDescription.set(areaId, displayValue);
            } else {
                controllerInfo.areaIdToDescription.set(areaId, undefined);
            }
        }
    }

    removeChildArea(areaId: string, controller: ChildController): void {
        if (!this.controllers.has(controller.watcherId)) {
            const controllerInfo = this.controllers.get(controller.watcherId);
            const childElement = controllerInfo.areaIdToSVGElement.get(areaId);
            if (childElement !== undefined) {
                controllerInfo.areaIdToSVGElement.delete(areaId);
                this.svg.removeChild(childElement);
                controllerInfo.areaIdToPrevDescription.delete(areaId);
            }
            if (controllerInfo.areaIdToDescription.delete(areaId)) {
                if (controllerInfo.areaIdToDescription.size === 0) {
                    controller.removeWatcher(this, false);
                    this.controllers.delete(controller.watcherId);
                }
            }
        }
    }

    setSize(width: number, height: number): void {
        this.svg.setAttribute("width", String(width));
        this.svg.setAttribute("height", String(height));
    }

    static topLevelAttributes: {[attr: string]: string} = {
        background: "fill",
        borderColor: "stroke",
        borderWidth: "stroke-width",
        opacity: "opacity"
    };

    wrapUpVisuals(): void {
        for (const [watcherId, controllerInfo] of this.controllers) {
            const orderedAreaList: ElementReference[] = controllerInfo.controller.result.value;
            const areaIdToDescription = controllerInfo.areaIdToDescription;
            if (orderedAreaList instanceof Array) {
                for (let i = 0; i < orderedAreaList.length; i++) {
                    const areaId = orderedAreaList[i].getElement();
                    // Extract display:foreign:value: and display:foreign:value:type
                    const description = areaIdToDescription.get(areaId);
                    // Note: shallowCopy needed for modification *and* caching
                    let foreignValue: any = shallowCopy(
                        testOneAVAttr(description, "foreign", (foreign) =>
                            testOneAVAttr(foreign, "value",  (v) => v)));
                    const type: any = testOneAVAttr(foreignValue, "type", (v) => v);
                    // Create element when needed; remove it first when type/tag has changed
                    let svgElement = controllerInfo.areaIdToSVGElement.get(areaId);
                    if (svgElement !== undefined &&
                          (!isAV(foreignValue) || svgElement.tagName !== type)) {
                        this.svg.removeChild(svgElement);
                        controllerInfo.areaIdToSVGElement.delete(areaId);
                        controllerInfo.areaIdToPrevDescription.delete(areaId);
                        svgElement = undefined;
                    }
                    if (svgElement === undefined && isAV(foreignValue) && typeof(type) === "string") {
                        svgElement = document.createElementNS("http://www.w3.org/2000/svg", type);
                        this.svg.appendChild(svgElement);
                        controllerInfo.areaIdToSVGElement.set(areaId, svgElement);
                    }
                    // Merge background/fill and borderColor/stroke
                    if (foreignValue !== undefined) {
                        for (var displayAttr in SVGFI.topLevelAttributes) {
                            const foreignAttr = SVGFI.topLevelAttributes[displayAttr];
                            const displayValue = testOneAVAttr(description, displayAttr, testValue);
                            if (displayValue !== undefined && testOneAVAttr(foreignValue, foreignAttr, (v) => v) === undefined) {
                                foreignValue[foreignAttr] = displayValue;
                            }
                        }
                    }
                    const prevDescription: any = controllerInfo.areaIdToPrevDescription.get(areaId);
                    if (svgElement !== undefined && isAV(foreignValue) &&
                          !objectEqual(foreignValue, prevDescription)) {
                        this.assignProperties(svgElement, foreignValue, prevDescription);
                        controllerInfo.areaIdToPrevDescription.set(areaId, foreignValue);
                    }
                }
            }
        }
    }

    displayElementVisible(): void {
        this.wrapUpVisuals();
    }

    private assignProperties(svgElement: SVGElement, description: any, prevDescription: any): void {
        if (prevDescription !== undefined) {
            for (let attr in description) {
                const val: any = description[attr];
                if (attr !== "type" && prevDescription[attr] !== val) {
                    svgElement.setAttribute(attr, val);
                }
            }
            for (let attr in prevDescription) {
                if (!(attr in description)) {
                    svgElement.removeAttribute(attr);
                }
            }
        } else {
            for (let attr in description) {
                const val: any = description[attr];
                if (attr !== "type") {
                    svgElement.setAttribute(attr, val);
                }
            }
        }
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
}

addForeignInterface({
    svg: wrapForeignInterface(SVGFI)
});
