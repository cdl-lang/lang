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

/// <reference path="externalTypes.basic.d.ts" />
/// <reference path="include/pathFunctions.d.ts" />
/// <reference path="area.ts" />

// (minimal) declarations of interfaces to the existing Javascript code

class Point {
    top: number = 0;
    left: number = 0;
}

class Rect extends Point {
    width: number = 0;
    height: number = 0;
}

class EdgeRect extends Point {
    right: number = 0;
    bottom: number = 0;
}

class ContentPos extends Rect {
    error: Point;
    exact: Rect;
}

class Relative extends ContentPos {
    embedding: CoreArea;
    error: Point = new Point();
    exact: Rect = new Rect();
}

class DisplayDivPos extends Rect {
    embedding: CoreArea;
}

declare function updateElementPos(element: HTMLDivElement, pos: Rect): void;
declare function resetTransitionCssProp(style: CSSStyleDeclaration): void;

declare class Display {
    displayType: string;
    frameDiv: HTMLDivElement;
    displayDiv: HTMLDivElement;
    embeddingDiv: HTMLDivElement;
    descriptionDisplay: any;
    displayElement: {
        root: HTMLElement;
        format: HTMLElement;
        content: HTMLElement;
        type: string;
        value: any;
        size: Rect; // top and left are undefined
    };

    paddingTop: number;
    paddingLeft: number;
    paddingRight: number;
    paddingBottom: number;

    constructor(area: DisplayArea);
    destroy(): void;
    configurationUpdate(config: any, applyChange: boolean, applyTransition: boolean): void;
    applyTransitionProperties(transitions: any): void;
    setZIndex(frameZ: number, displayZ: number): void;
    refreshPos(): void;
    hasActiveInputElement(): boolean;
    inputElementIsValid(): boolean;
    takeFocus(): void;
    releaseFocus(): void;
    setInputState(attrib: string, value: any): boolean;
    isOpaquePosition(x: number, y: number): boolean;
    hasVisibleBorder(): boolean;
    willHandleClick(): boolean;
    getInputChanges(): {[attr: string]: any}|undefined;
    getTransitions(): any;
    setForeignElement(foreignElement: HTMLElement): void;
    setShowEmbedding(showEmbedding: boolean): void;

    updatePos(contentPos: ContentPos, displayPos: Rect): void;
    updateZeroOffsetPos(pos: Relative): void;

    debugGetDescription(): any;
}

declare class SurveyDisplay {
    constructor(areaId: string, surveyor: DisplayOffsetSurveyor);
    destroy(): void;
    update(dispObj: any, width: number, height: number): void;
    getWidth(): number;
    getHeight(): number;
    getSize(): number[];
    static getEmbeddingDiv(): HTMLDivElement;
}

declare var logEventHistory: boolean;

interface PosPairUpdateHandler {
    call(unused: any, posPair: PosPair, name: any): void;
}

interface AreaId {
    areaId: string;
}

declare class PosPair {
    changes: {[l1: string]: {[l2: string]: string}};

    constructor(areaId: AreaId, cm: any, pairDesc: any, name: any);

    registerHandler(handler: PosPairUpdateHandler): void;
    removeHandler(handler: PosPairUpdateHandler): void;
    newDescription(pairDesc: any): void;
    destroyPair(): void;
}

interface LabelPairOffsetUpdateHandler {
    updateOffset(paidId: any, l1: string, l2: string, offset: number): void;
}

declare class LabelPairOffset {
    constructor(cbObj: LabelPairOffsetUpdateHandler, pairId: any, l1: string, l2: string);
    destroy(): void;

    get(): number;
}

declare class PosConstraintManager {
    constraints: {[name: string]: any};
    newDescription(posDesc: Object): void;
    addNewConstraint(name: string, posDesc: any): void;
    removeConstraint(name: string): void;
    removeConstraintInnerName(name: string): void;
}

declare class AllPosConstraints extends PosConstraintManager {
    constructor(area: DisplayArea);
    destroy(): void;
}

interface TimerInterface {
    timedOut(): boolean;
}

declare class PosCalc {
    getCurrentValue(l1: string, l2: string): number;
    constraintQueueIsEmpty(): boolean;
}

declare class Positioning {
    posCalc: PosCalc;

    reposition(timer: TimerInterface): boolean;
    refresh(): void;
    clearSolutionChanges(): void;
    needToRefresh(): boolean;
    addSegment(point1: string, point2: string, constraintId: string,
               priority: number, extremum1: number, extremum2: number,
               stability?: string, preference?: string, orGroups?: any): void;
    removeSegment(point1: string, point2: string, constraintId: string): void;
    addLinear(p1point1: string, p1point2: string, p2point1: string,
          p2point2: string, scalar: number, priority: number, id: number): void;
    removeLinearById(constraintId: string): void;
}

declare var strongAutoPosPriority: number;

// from node.js (automated tests)
declare var __dirname: string;

declare var globalPos: Positioning;

declare function initPositioning(): void;

declare class ContentPosManager {
    offsets: EdgeRect;

    constructor(area: DisplayArea);

    registerAllModeChange(subSystem: string, id: number, obj: Display,
                          opq: any): void;
    unregisterAllModeChange(subSystem: string, id: number): void;
    independentContentPositionHandler(value: any): void;
    isInZeroOffsetMode(): boolean;
    isInAutoOffsetMode(): boolean;
    isInIndependentContentPositionMode(): boolean;
    setContentOffset(edge: string, offset: number): boolean;
    setAllContentOffsets(offset: number): boolean;
}

declare var globalAbsolutePosManager: AbsolutePosManager;

declare var globalScreenWidthConstraint: any;
declare var globalScreenHeightConstraint: any;

declare function initAbsolutePosManager(): void;

declare function labelBySuffix(areaId: string, suffix: string): string;
declare function leftSuffix(area: string, isContent: boolean, isIntersection: boolean): string;
declare function topSuffix(area: string, isContent: boolean, isIntersection: boolean): string;

declare class AbsolutePosManager {
    addArea(area: DisplayArea, embedding: DisplayArea): void;
    removeArea(area: DisplayArea, embedding: DisplayArea): void;
    addAreaContentOffsets(area: DisplayArea): void;
    removeAreaContentOffsets(area: DisplayArea): void;
    newEmbedding(area: DisplayArea, prevEmbedding: DisplayArea, newEmbedding: DisplayArea): void;
    refreshPos(): void;
}

interface Stackable {
    areaId: string;
    setZIndex(frameZ: any, displayZ: any): void;
    getEmbeddingDepth(): number;
    getFrameDiv(): HTMLDivElement;
    getZArea(): ZArea;
    getZAreaRep(): ZArea; // The ZArea or the one of the representative
}

declare class ZArea {
    // the following are not accessible to FEG functions
    // constructor(area: Stackable);
    // destroy(): void;

    configurationUpdate(configuration: any, changeSet: any): void;
    newDescription(config: any): void;
    addConstraint(name: string, descr: any): void
    removeConstraint(name: string): void;
    updateConstraint(name: string, areaId: string): void;
    setSetRepresentative(repr: ZArea, constraintName: string): void;
    removeSetRepresentative(): void;
    clear(): void;
    getZ(): number;
    static compare(a: ZArea, b: ZArea): number;

    // These are also private
    // static get(area: Stackable): ZArea;
    // static release(zArea: ZArea): void;
}

declare class ZIndex {
    changes: boolean;
    addArea(area: Stackable, embedding: Stackable): ZArea;
    removeArea(area: Stackable): void;
    updateZ(): void;
    newEmbedding(area: Stackable, unused: any, newEmbedding: Stackable): void;
}

declare function initZIndex(): void;

declare class IntersectionChain {
    expressionArea: DisplayArea;
    referredArea: DisplayArea;

    constructor(expressionArea: DisplayArea, referredArea: DisplayArea, intersectionName: string);
}

declare function embedAreaFrameElementAtPos(area: DisplayArea, pos: Relative, dontSetPos?: boolean): void;
declare function chainsAllowIntersection(referredArea: DisplayArea, expressionArea: DisplayArea, intersectionName: string): boolean;

declare var userLocale: string;
declare var gProgressDiv: HTMLElement;
declare var logEventHistory: boolean;

declare function createScreenArea(): void;
declare function updateScreenAreaPosition(areaId: string): void;
declare function taskQueueEmptyHook(): void;
declare function taskQueueInitProgressHook(p: number): void;
declare function taskQueueRunningHook(): void;
declare function debugNoPendingTasksNotification(): void;
declare function clearProgressDiv(): void;
declare function hideSplashScreen(): void;
declare function showRunningDivNow(): void;
//declare function setSplashScreenText(text: string): void;
declare function unhideCdlRootDiv(): void;

declare class SortedListNode<T> {
    entry: T;
    sortVal: number;
}

declare class SortedList<T> {
    getNode(path: any, dontCreate: boolean): SortedListNode<T>;
    insert(entry: T, path: any, sortVal: number,
           atEnd: boolean): SortedListNode<T>;
    isEmpty(): boolean;
    remove(path: any): T;

    first: SortedListNode<T>;
}

declare function debugStartTimer(group: string, label: string): void;
declare function debugStopTimer(label: string): void;

declare function debugTotalTimeStart(label: string): void;
declare function debugTotalTimeStop(label: string): void;

declare var mondriaMutex: boolean;

declare var debugObjCache: boolean;
declare function resetDebugObjCache(): void;
declare function initDebugObjMgr(): void;

declare var gMaxMessageSize: number;
declare var baseDelay: number;
declare var sizeDependentDelay: number;

// the window.location object
declare class LocationObject {
    hash: string;
    host: string;
    hostname: string;
    href: string;
    origin: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
};
declare function getWindowLocation(): LocationObject;

// default app-state parameters can be tweaked by adding a javascript line
//  assigning 'remoteServerPort', 'wwwBaseUrlPath' etc. to the desired values
declare var remoteServerPort: number;
declare var remoteServerPath: string;
declare var wwwBaseUrlPath: string;
declare var appStateOwner: string;

declare function debugObjAbsAreaPosition(area: CoreArea): any;
declare function debugObjClasses(area: CoreArea, val: any): string[];

// Timing statistics from js/util/debugObj.js
declare function exprStatPerTemplate(): string;
declare function exprStatPerType(): string;
declare function exprStatPerArea(): string;
declare function exprStatPerPrototype(): string;
declare function resetExprStat(): void;
declare function userAlert(msg: string): void;

declare var gRunningDiv: HTMLDivElement;

declare class DebugTracingLog {
    newCycle(priority: number): void;
}
declare var globalDebugTracingLog: DebugTracingLog;

declare var buildInfo: {
  date: string;
  rootRevision: string;
  scriptRevision: string;
  cdlRevision: string;
  host: string;
};

declare interface FileSaver {
    readyState: number;
}

/**
 * See: https://github.com/eligrey/FileSaver.js
 * 
 * @param {Blob} data 
 * @param {string} [filename] 
 * @param {boolean} [disableAutoBOM] 
 * @returns {FileSaver} 
 */
declare function saveAs(data: Blob, filename?: string, disableAutoBOM?: boolean): FileSaver;

/**
 * See: https://github.com/tsayen/dom-to-image
 * 
 * @interface DomToImage
 */
declare interface DomToImage {
    toBlob: (node: HTMLElement, options?: any) => Promise<Blob>;
    toJpeg: (node: HTMLElement, options?: any) => Promise<any>;
    toPixelData: (node: HTMLElement, options?: any) => Promise<Uint8Array>;
    toPng: (node: HTMLElement, options?: any) => Promise<any>;
    toSvg: (node: HTMLElement, options?: any) => Promise<string>;
}

declare var domtoimage: DomToImage;

declare function determineScreenAreaSize(): Rect;
