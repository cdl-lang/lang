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

/// <reference path="utilities.ts"/>
/// <reference path="result.ts"/>

var suppressMoveAndKey = false;
var logEventTimes = false;
var logEventHistory = false;
var logEventComments = false;

/// Set to true to log everything, or to {x: true, ...} to log events of type
/// x. {message: true} will log changes to [message], 
var debugEvents: boolean|{[evtType: string]: boolean} = false;

function debugLogEvent(type: string): boolean {
    return debugEvents === true ||
           (typeof(debugEvents) === "object" && debugEvents[type]);
}

// Tracks focus of the window in which the app runs.
// Events are ignored when the app is in the background.
var gAppInFront = true;

if (typeof window !== "undefined") {
    window.onblur = function() {
        gAppInFront = false;
    };
    window.onfocus = function() {
        gAppInFront = true;
    };
}

var inMouseDown = false;
    
// Don't process events that are equal to gDontProcessEvent. They have been
// created in the event handler and should only be handled by the targeted
// DOM element.
var gDontProcessEvent: Event = undefined;

// An attempt to save a few bytes by using the same empty array as o() in places
// where it's constant.
var domEventEmptyOS: any = [];

// Note that the changes in the global message, previous recipient's myMessage
// and the new recipient's myMessage occur at the same moment.
var domEventTrueResult = new Result(constTrueOS);
var domEventFalseResult = new Result(constEmptyOS);

// This file deals with intercepting DOM events, generating the corresponding
// event object, and managing its association with the global message.
// DomEvents are also used to set the pointer location. On each event the
// pointer object is set to be located at the reported coordinates.
// 
// The domEvents received from the browser are formatted as CDL messages,
// with the recipient set sequentially to the elements of the overlapping area
// set. For each recipient, the messageObject is set, and
// contentTask.processEvent is called to process all write entries, with their
// 'upon' triggers and, if applicable, their modifications.
// 
// The set of overlapping areas is computed using the embedding hierarchy,
// and is ordered by z-value.
// 
// The cursor is set on the outermost div, with id cdlRootDiv.
//

// TODO: walk up parents from cdlRootDiv, and subtract their clientLeft,
// and clientTop and add scrollLeft and scrollTop from/to clientX and clientY
// to compensate when cdlRootDiv's top/left is not at (0, 0).

type OverlappingArea = {recipient: CoreArea; insideVisibleRegion: boolean; relX: number; relY: number;};
type OverlappingAreaList = OverlappingArea[];
type EmittedValueList = { value: string; areas: CoreArea[]; }[];

class MondriaDomEvent {
    rootArea: CoreArea; // area that contains all areas
    lastKeyDownIdentifier: string = undefined;
    eventHistory: any[] = [];
    dragCounter: number = 0;
    lastIgnoredMouseMoveTime: number = undefined;
    domEventAreasUnderPointerResult: Result = new Result();
    areaChangeCounter: number = areaChangeCounter;
    areaWithFocus: CoreArea = undefined;
    nextAreaWithFocus: {area: CoreArea, focus: boolean}[] = [];
    eventDiv: HTMLElement = undefined;
    debugAbortId: string = undefined;

    // When true, the mouse is over 'screenArea'
    mouseOverScreenArea: boolean = true;

    // When 0, the cdlRootDiv (which contains the screenArea) is the top
    // div; when 1 or 2, the "runningDiv" is on top (2 means the embedded div,
    // spinnerElt, is showing)
    topDivState: number = 0;

    eventAutomaton: EventAutomaton = new EventAutomaton();

    // The id of the scheduled task that should check if the click expires
    checkClickExpirationTask: number|NodeJS.Timer = undefined;

    // pointerObj is the single pointer object.
    constructor(public pointerObj: MondriaPointer, public rootAreaId: string) {
        this.rootArea = allAreaMonitor.getAreaById(rootAreaId);
        this.lastKeyDownIdentifier = undefined;

        this.createDiv();
        this.addEventHandlers(this.eventDiv);
        this.addGlobalEventHandlers();
    }
    
    addEventHandlers(htmlElement: HTMLElement): void {
        var eventHandlers = [
            { type: "mousedown", handler: this.mouseDownHandler },
            { type: "mouseup", handler: this.mouseUpHandler },
            { type: "mousemove", handler: this.mouseMoveHandler },
            { type: "keydown", handler: this.keyDownHandler },
            { type: "keyup", handler: this.keyUpHandler},
            { type: "keypress", handler: this.keyPressHandler },
            { type: "wheel", handler: this.wheelHandler },
            { type: "mouseleave", handler: this.mouseOutHandler },
            { type: "mouseenter", handler: this.mouseInHandler },
            { type: "touchstart", handler: this.touchStartHandler },
            { type: "touchend", handler: this.touchEndHandler },
            { type: "touchcancel", handler: this.touchCancelHandler },
            { type: "touchmove", handler: this.touchMoveHandler }
        ];
    
        for (var i = 0; i < eventHandlers.length; i++) {
            var entry = eventHandlers[i];
            this.addEventHandler(entry.type, entry.handler, htmlElement);
        }
    }
    
    addGlobalEventHandlers(): void {
        var eventHandlers = [
            { type: "dragenter", handler: this.dragEnterHandler },
            { type: "dragleave", handler: this.dragLeaveHandler },
            { type: "dragover", handler: this.dragOverHandler },
            { type: "drop", handler: this.dropHandler },
            { type: "dragEnd", handler: this.dragEndHandler },
            { type: "mouseup", handler: this.mouseUpHandler },
            { type: "pointermove", handler: this.mouseMoveHandler }
        ];
    
        for (var i = 0; i < eventHandlers.length; i++) {
            var entry = eventHandlers[i];
            this.addEventHandler(entry.type, entry.handler, window);
        }
    }
    
    // --------------------------------------------------------------------------
    // createDiv
    // 
    // create a div extending over all of the dom document with a high z-value
    //  to allow interception of mouse events, and set global cursor.
    //
    createDiv(): void {
        this.eventDiv = document.getElementById("cdlRootDiv");
        this.eventDiv.style.cursor = "default";
        this.eventDiv.style.outline = "none";
    
        this.eventDiv.setAttribute("tabindex", "0");
        this.setGlobalFocus();
    }
    
    setGlobalFocus(): void {
        if (this.eventDiv.focus) {
            // jsdom doesn't have 'focus' on a div
            this.eventDiv.focus();
            this.recordComment("globalFocus");
        }
    }
    
    // --------------------------------------------------------------------------
    // addEventHandler
    // 
    // register 'handler' to handle dom events of type 'type'
    //
    addEventHandler(type: string, handler: (evt: Event)=>void, htmlElement: Window|HTMLElement): void {
        var that = this;

        function handlerCaller(domEvent: Event) {
            if (gDontProcessEvent === domEvent) {
                return;
            }
            if (mondriaMutex) {
                Utilities.runtimeWarning("suppressing re-entrancy");
                return;
            }
    
            mondriaMutex = true;
    
            debugTotalTimeStop("timed-out task delay");
            debugTotalTimeStart("event handling");
    
            try {
                handler.call(that, domEvent);
                debugTotalTimeStop("event handling");
                debugTotalTimeStart("timed-out task delay");
            }
            finally {
                mondriaMutex = false;
            }
        }
    
        htmlElement.addEventListener(type, handlerCaller, false);
    }
    
    startExpirationTask() {
        var self = this;
    
        if (!runTests) {
            this.checkClickExpirationTask = setTimeout(function() {
                self.checkClickExpired(Date.now(), 0, 0, true, "timeout");
            }, this.eventAutomaton.maxClickDelta);
        }
    }
    
    cancelExpirationTask() {
        if (this.checkClickExpirationTask !== undefined) {
            clearTimeout(<any> this.checkClickExpirationTask);
            this.checkClickExpirationTask = undefined;
        }
    }
    
    mouseDownHandler(domEvent: MouseEvent): void {
        inMouseDown = true;
        if (!runTests) {
            // If the author wants to test time out events, (s)he should insert
            // them in the test
            this.cancelExpirationTask();
            this.startExpirationTask();
        }
        if (blockTaskLoop) {
            resumeTaskProcessing();
        }
        this.mouseEventHandler(domEvent, "MouseDown", [{
            pointer: this.pointerObj,
            pointerID: -1,
            buttonID: domEvent.button,
            state: "down"
        }]);
    }
    
    mouseUpHandler(domEvent: MouseEvent|ImpersonatedMouseDomEvent): void {
        inMouseDown = false;
        if (!runTests) {
            // If the author wants to test time out events, (s)he should insert
            // them in the test
            this.cancelExpirationTask();
            this.startExpirationTask();
        }
        if (blockTaskLoop) {
            resumeTaskProcessing();
        }
        this.mouseEventHandler(domEvent, "MouseUp", [{
            pointer: this.pointerObj,
            pointerID: -1,
            buttonID: domEvent.button,
            state: "up"
        }]);
    }
    
    /// mouse move events are not made available as messages, but they do
    /// have to update the pointer object and the 'pointer-in-area' attribute
    mouseMoveHandler(domEvent: MouseEvent|ImpersonatedMouseDomEvent): void {
        if (suppressMoveAndKey) {
            return;
        }
        if (!gAppInFront && !(domEvent instanceof ImpersonatedDomEvent)) {
            return;
        }
        if (blockTaskLoop){
            return;
        }
        if (inMouseDown)
            markEventStart("mouse move", 100);
    
        if (logEventHistory) {
            this.eventHistory.push({
                type: domEvent.type,
                absX: domEvent.clientX,
                absY: domEvent.clientY,
                time: Date.now(),
                shiftKey: domEvent.shiftKey,
                metaKey: domEvent.metaKey,
                altKey: domEvent.altKey,
                ctrlKey: domEvent.ctrlKey
            });
        }

        this.checkClickExpired(Date.now(), domEvent.clientX, domEvent.clientY,
                               false, "mousemove");
    
        // find the set of areas overlapping the mouse, ordered by their
        //  z-stacking
        var overlappingAreaList =
            this.getOverlappingAreas(domEvent.clientX, domEvent.clientY);

        // Do not prevent default when first is clickable
        var preventDefault: boolean = true;
        if (overlappingAreaList.length > 0) {
            var area: CoreArea = overlappingAreaList[0].recipient;
            if (area instanceof DisplayArea && area.display !== undefined &&
                    area.display.displayElement !== undefined &&
                    MondriaDomEvent.findClickable(area.display.displayElement.content,
                                                  domEvent.clientX, domEvent.clientY)) {
                preventDefault = false;
            }
        }
        if (preventDefault) {
            domEvent.preventDefault();
        }
        domEvent.stopPropagation();
        domEvent.stopImmediatePropagation();
        queueEvent(domEvent, undefined, undefined, domEventEmptyOS,
                this.pointerObj, overlappingAreaList, undefined,
                undefined, undefined, undefined, undefined, undefined);
    }

    inEventDivCoordinates(clientX: number, clientY: number): boolean {
        var divCoords: ClientRect = this.eventDiv.getBoundingClientRect();

        return divCoords.top <= clientY && clientY < divCoords.bottom &&
               divCoords.left <= clientX && clientX < divCoords.right;
    }

    // --------------------------------------------------------------------------
    // mouseOutHandler
    //
    // When the mouse leaves the screen area, reset all pointerInArea and
    // [overlap].
    //
    mouseOutHandler(domEvent: MouseEvent): void {
        if (blockTaskLoop)
            return;
        if (!this.mouseOverScreenArea ||
              this.inEventDivCoordinates(domEvent.clientX, domEvent.clientY)) {
    	    // This event was caused by a change in the order of divs, and does
            // not mean the mouse moved out of the screenArea
            return;
        }
        this.cancelExpirationTask();
        this.checkClickExpired(0, 0, 0, true, "mouseout");
        this.mouseOverScreenArea = false;
        this.recordComment("MouseOut");

        var message: EventObject = {
            type: ["MouseOut"],
            time: [Date.now()]
        };
        queueEvent(domEvent, message, undefined, [], this.pointerObj, undefined,
                   undefined, undefined, undefined, undefined, undefined,
                   undefined);
    }

    clearDragState(): boolean {
        if (this.dragCounter !== 0) {
            this.dragCounter = 0;
            this.dragValue = constEmptyOS;
            queueEvent(new ImpersonatedDomEvent("cleardragstate"), undefined,
                       undefined, [], this.pointerObj, undefined,
                       domEventEmptyOS, undefined, undefined, undefined,
                       undefined, undefined);
            return true;
        }
        return false;
    }
    
    // --------------------------------------------------------------------------
    // mouseInHandler
    //
    // Upon entering, the pointer needs to be updated.
    // 
    mouseInHandler(domEvent: MouseEvent): void {
        if (blockTaskLoop)
            return;
        if (this.mouseOverScreenArea ||
              !this.inEventDivCoordinates(domEvent.clientX, domEvent.clientY)) {
    	    // This event was caused by a change in the order of divs, and does
            // not mean the mouse moved out of the screenArea
            return;
        }
        this.mouseOverScreenArea = true;
        this.recordComment("MouseIn");
        this.clearDragState();

        if (inMouseDown && domEvent.buttons === 0) {
            // Fire mouse up if there's no button pressed on mousein, while
            // a button has been pressed before.
            this.mouseUpHandler(new ImpersonatedMouseDomEvent("mouseup",
                 undefined, domEvent.clientX, domEvent.clientY, undefined, []));
        }

        var message: EventObject = {
            type: ["MouseIn"],
            time: [Date.now()]
        };
        queueEvent(domEvent, message, undefined, [], this.pointerObj, undefined,
                   undefined, undefined, undefined, undefined, undefined,
                   undefined);
    }
    
    dragValue: any[] = constEmptyOS;

    dragEnterHandler(domEvent: DragEvent): void {
        if (blockTaskLoop)
            return;
        domEvent.preventDefault();
        if (this.dragCounter === 0) {
            this.dragValue = [];
            if (domEvent.dataTransfer.files === undefined || domEvent.dataTransfer.files.length === 0) {
                if ("items" in domEvent.dataTransfer) {
                    for (var i = 0; i < domEvent.dataTransfer.items.length; i++) {
                        this.dragValue.push({
                            kind: domEvent.dataTransfer.items[i].kind,
                            type: domEvent.dataTransfer.items[i].type
                        });
                    }
                } else {
                    this.dragValue.push({kind: "unknown"});
                }
            } else {
                for (var i = 0; i < domEvent.dataTransfer.files.length; i++) {
                    var file = shallowCopy(domEvent.dataTransfer.files[i]);
                    if ("items" in domEvent.dataTransfer) {
                        file.kind = domEvent.dataTransfer.items[i].kind;
                    } else {
                        file.kind = "file";
                    }
                    this.dragValue.push(file);
                }
            }
            queueEvent(domEvent, undefined, undefined, domEventEmptyOS,
                       this.pointerObj, undefined, this.dragValue,
                       undefined, undefined, undefined, undefined, undefined);
        }
        this.dragCounter = 1;
    }
    
    dragLeaveHandler(domEvent: DragEvent): void {
        if (blockTaskLoop)
            return;
        domEvent.preventDefault();
        if (this.dragCounter === 0 &&
              !this.inEventDivCoordinates(domEvent.clientX, domEvent.clientY)) {
    	    this.clearDragState();
        }

    }
    
    dragOverHandler(domEvent: DragEvent): void {
        domEvent.preventDefault(); // Needed to get the drop event
    
        if (blockTaskLoop)
            return;
        markEventStart("dragover");
        if (logEventHistory) {
            this.eventHistory.push({
                type: domEvent.type,
                absX: domEvent.clientX,
                absY: domEvent.clientY,
                time: Date.now(),
                shiftKey: domEvent.shiftKey,
                metaKey: domEvent.metaKey,
                altKey: domEvent.altKey,
                ctrlKey: domEvent.ctrlKey
            });
        }
    
        this.cancelExpirationTask();
        this.checkClickExpired(Date.now(), domEvent.clientX, domEvent.clientY,
                               false, "mousemove");
    
        // find the set of areas overlapping the mouse, ordered by their
        //  z-stacking
        var overlappingAreaList = this.getOverlappingAreas(domEvent.clientX,
                                                          domEvent.clientY);
        queueEvent(domEvent, undefined, undefined, domEventEmptyOS,
                  this.pointerObj, overlappingAreaList, this.dragValue,
                  undefined, undefined, undefined, undefined, undefined);
    }
    
    dragEndHandler(domEvent: DragEvent): void {
        if (blockTaskLoop)
            return;
        domEvent.preventDefault();
        this.clearDragState();
    }
    
    // This function is called by the drop event, and sends a "FileChoice" event
    // with subType: "Drop"
    dropHandler(domEvent: DragEvent|ImpersonatedDropEvent): void {
        if (blockTaskLoop)
            return;
        domEvent.preventDefault();
        markEventStart("drop");
        // propagate dragInArea over areas overlapping the mouse
        this.fileChoice(domEvent, "Drop", domEvent.dataTransfer.files,
                       this.getOverlappingAreas(domEvent.clientX, domEvent.clientY));
        // and clear the drag state once the drop event has been processed
        this.clearDragState();
    }
    
    // This function is called by the input type=file element after the user picked
    // a file, and sends a "FileChoice" event similar to the drop event, but with
    // subType: "Pick"
    // Note: does not ignore event when !gAppInFront; Safari calls "blur" on the
    // window when the file pick dialog appears.
    pickFile(domEvent: MouseEvent|ImpersonatedDropEvent, inputArea: DisplayArea, fileList: FileList): void {
        domEvent.preventDefault();
        markEventStart("pick");
        this.fileChoice(domEvent, "Pick", fileList, [{
            recipient: inputArea,
            insideVisibleRegion: true,
            relX: 0,
            relY: 0
        }]);
    }
    
    // Sends a FileChoice event using the originating event's coordinates,
    // propagating like a mouse event.
    fileChoice(domEvent: MouseEvent|ImpersonatedDropEvent, subType: string, fileList: any, overlappingAreaList: OverlappingAreaList): void {
        var absX = domEvent.clientX;
        var absY = domEvent.clientY;
        var time = Date.now();
        var modifier = this.getDomModifier(domEvent);
        var areaList = overlappingAreaList.map(function(oa) { return oa.recipient; });
    
        if (logEventHistory) {
            this.eventHistory.push({
                type: domEvent.type,
                absX: absX,
                absY: absY,
                modifier: modifier,
                time: time
            });
        }
        this.eventAutomaton.reset();
    
        var files: EventFileList = [];
        for (var i = 0; i < fileList.length; i++) {
            var fileHandle = fileList[i];
            if (fileHandle instanceof File) {
                var now = new NativeObjectWrapper();
                now.file = fileHandle;
                files.push({
                    fileHandle: [now],
                    lastModified: ensureOS((<any>fileHandle).lastModified),
                    lastModifiedDate: ensureOS((<any>fileHandle).lastModifiedDate),
                    fullName: [fileHandle.name],
                    size: [fileHandle.size],
                    type: [fileHandle.type],
                    name: [extractBaseName(fileHandle.name)]
                });
            } else if (typeof(fileHandle) === "string") {
                files.push({
                    fileHandle: [fileHandle],
                    lastModified: constEmptyOS,
                    lastModifiedDate: constEmptyOS,
                    fullName: [<string>fileHandle],
                    size: undefined,
                    type: [extractExtension(<string>fileHandle)],
                    name: [extractBaseName(<string>fileHandle)]
                });
            }
        }
    
        var message: EventObject = {
            type: ["FileChoice"],
            time: [time],
            modifier: modifier,
            absX: [absX],
            absY: [absY],
            files: files
        };
    
        // Propagate FileChoice over the areas
        queueEvent(domEvent, message, [{value: subType, areas: areaList.slice(0)}],
                   areaList, undefined, overlappingAreaList, undefined,
                   undefined, undefined, undefined, undefined, undefined);
        queueEvent(new ImpersonatedMouseDomEvent("mousemove", undefined, absX, absY, undefined, []),
                   undefined, undefined, domEventEmptyOS, this.pointerObj,
                   overlappingAreaList, undefined, undefined, undefined,
                   undefined, undefined, undefined);
    }
    
    // Translates non-standard domEvent.key into standard names, also when the
    // browser happens to put the correct name in the key or keyIdentifier field
    // to begin with (that's Firefox).
    static keyTranslate: {[key: string]: string} = {
        "U+0008": "Backspace",
        "U+0009": "Tab",
        "U+000A": "Return",
        "U+001B": "Esc",
        "ArrowLeft": "Left",
        "ArrowUp": "Up",
        "ArrowRight": "Right",
        "ArrowDown": "Down",
        "Delete": "Del",
        "Enter": "Return",
        "Left": "Left",
        "Up": "Up",
        "Right": "Right",
        "Down": "Down",
        "Del": "Del",
        "Return": "Return",
        "U+007F": "Del",
        "ZoomToggle": "Zoom",
        "Escape": "Esc",
        "ScrollLock": "Scroll",
        "Backspace": "Backspace",
        "Tab": "Tab",
        "Clear": "Clear",
        "Shift": "Shift",
        "Control": "Control",
        "Alt": "Alt",
        "Pause": "Pause",
        "CapsLock": "CapsLock",
        "Esc": "Esc",
        "PageUp": "PageUp",
        "PageDown": "PageDown",
        "End": "End",
        "Home": "Home",
        "Select": "Select",
        "Execute": "Execute",
        "PrintScreen": "PrintScreen",
        "Insert": "Insert",
        "Help": "Help",
        "Win": "Win",
        "Apps": "Apps",
        "NumLock": "NumLock",
        "Scroll": "Scroll",
        "VolumeMute": "VolumeMute",
        "VolumeDown": "VolumeDown",
        "VolumeUp": "VolumeUp",
        "MediaNextTrack": "MediaNextTrack",
        "MediaPreviousTrack": "MediaPreviousTrack",
        "MediaStop": "MediaStop",
        "MediaPlayPause": "MediaPlayPause",
        "LaunchMail": "LaunchMail",
        "SelectMedia": "SelectMedia",
        "LaunchApplication1": "LaunchApplication1",
        "LaunchApplication2": "LaunchApplication2",
        "Play": "Play",
        "Zoom": "Zoom",
        "F1": "F1",
        "F2": "F2",
        "F3": "F3",
        "F4": "F4",
        "F5": "F5",
        "F6": "F6",
        "F7": "F7",
        "F8": "F8",
        "F9": "F9",
        "F10": "F10",
        "F11": "F11",
        "F12": "F12"
    };

    static modifierTable: {[key: string]: string} = {
        altKey: "alt",
        ctrlKey: "control",
        metaKey: "control", // "meta",
        shiftKey: "shift"
    };

    // --------------------------------------------------------------------------
    // translateKeyPressEvent
    //
    // Translates a key press event to the key value in the message.
    // Special keys, like function keys, are ignored by returning undefined.
    translateKeyPressEvent(domEvent: KeyboardEvent|ImpersonatedKeyDomEvent) {
        var key: string;
    
        if (domEvent.key !== undefined) {
            if (domEvent.charCode === 0) {
                // Special key, Firefox only; don't generate a KeyPress event
                return undefined;
            }
            key = domEvent.key;
        } else {
            if (domEvent.charCode < 32) {
                key = (<any>domEvent).keyIdentifier? (<any>domEvent).keyIdentifier:
                      this.lastKeyDownIdentifier;
            } else {
                key = String.fromCharCode(domEvent.charCode);
            }
        }
        return key in MondriaDomEvent.keyTranslate? MondriaDomEvent.keyTranslate[key]: key;
    }
    
    keyDownHandler(domEvent: KeyboardEvent): boolean {
        return this.keyDownUpHandler(domEvent, undefined, true);
    }
    
    keyPressHandler(domEvent: KeyboardEvent): boolean {
        return this.keyPressHandlerInt(domEvent, undefined);
    }
    
    keyUpHandler(domEvent: KeyboardEvent): boolean {
        return this.keyDownUpHandler(domEvent, undefined, false);
    }
    
    // --------------------------------------------------------------------------
    // keyDownUpHandler
    //
    keyDownUpHandler(domEvent: KeyboardEvent|ImpersonatedKeyDomEvent, recipient: DisplayArea, down: boolean): boolean {
        var key = domEvent.key || (<any>domEvent).keyIdentifier;
        var translated = key in MondriaDomEvent.keyTranslate? MondriaDomEvent.keyTranslate[key]: key;
        var char = String.fromCharCode(domEvent.keyCode);
        var eventType = down? "KeyDown": "KeyUp";
    
        if (suppressMoveAndKey) return true;
        if (!("key" in domEvent)) {
            this.lastKeyDownIdentifier = key;
        }
        if (key in MondriaDomEvent.keyTranslate) {
            this.keyEventHandler(domEvent, eventType, translated, char, recipient);
        } else {
            this.keyEventHandler(domEvent, eventType, char, key, recipient);
        }
        return true;
    }
    
    // --------------------------------------------------------------------------
    // keyPressHandlerInt
    //
    keyPressHandlerInt(domEvent: KeyboardEvent|ImpersonatedKeyDomEvent, recipient: DisplayArea): boolean {
        var key = this.translateKeyPressEvent(domEvent);
        var char = String.fromCharCode(domEvent.charCode);
    
        if (suppressMoveAndKey || key === undefined) return true;
        this.keyEventHandler(domEvent, "KeyPress", key, char, recipient);
        return true;
    }
    
    // --------------------------------------------------------------------------
    // wheelHandler
    //
    wheelHandler(domEvent: WheelEvent): void {
        if (suppressMoveAndKey) return;
        this.wheelEventHandler(domEvent);
    }
    
    firstTouchId: number|undefined = 0;

    touchStartHandler(domEvent: TouchEvent): void {
        inMouseDown = true;
        if (!runTests) {
            // If the author wants to test time out events, (s)he should insert
            // them in the test
            this.cancelExpirationTask(); 
            this.startExpirationTask();
        }
        if (blockTaskLoop) {
            resumeTaskProcessing();
        }
        if (this.firstTouchId === undefined && domEvent.changedTouches.length > 0) {
            this.firstTouchId = domEvent.changedTouches[0].identifier;
        }
        this.touchEventHandler(domEvent, ["TouchDown", "MouseDown"]);
    }

    touchEndHandler(domEvent: TouchEvent): void {
        inMouseDown = false;
        if (!runTests) {
            // If the author wants to test time out events, (s)he should insert
            // them in the test
            this.cancelExpirationTask();
            this.startExpirationTask();
        }
        if (blockTaskLoop) {
            resumeTaskProcessing();
        }
        this.touchEventHandler(domEvent, ["TouchUp", "MouseUp"]);
        if (domEvent.touches.length === 0) {
            this.firstTouchId = undefined;
        }
    }

    touchEventHandler(domEvent: TouchEvent, type: string[]): void {
        if (!gAppInFront && !(domEvent instanceof ImpersonatedDomEvent))
            return;

        var touch1 = domEvent.changedTouches[0];
        if (!touch1) {
            return;
        }
        var absX = touch1.clientX;
        var absY = touch1.clientY;
        var time = Date.now();
        var modifier = this.getDomModifier(domEvent);
    
        assert(domEventEmptyOS.length === 0, "I'm counting on this, you know");
        markEventStart("mouse " + type);
    
        // find the set of areas overlapping the mouse, ordered by their z-stacking
        var overlappingAreaList =
            this.extendOverlappingAreas(this.getOverlappingAreas(absX, absY));
        var areaList = overlappingAreaList.map(function(oa) { return oa.recipient; });
    
        var subTypes: EmittedValueList;
        if (runTests && domEvent instanceof ImpersonatedTouchDomEvent) {
            if (domEvent.subType === undefined) {
                subTypes = domEventEmptyOS;
            } else {
                subTypes = [{
                    areas: overlappingAreaList.map(oa => oa.recipient),
                    value: domEvent.subType
                }];
            }
        } else {
            subTypes = this.eventAutomaton.step(type[1], time, absX, absY, overlappingAreaList);
        }
        if (logEventHistory) {
            this.eventHistory.push({
                type: type,
                absX: absX,
                absY: absY,
                modifier: modifier,
                time: time,
                subTypes: subTypes === undefined? undefined: subTypes.map(subType => subType.value)
            });
        }
    
        var message: EventObject = {
            type: touch1.identifier === this.firstTouchId? type: [type[0]], // only send corresponding mouse event when identifier is 0
            time: [time],
            modifier: modifier,
            absX: [absX],
            absY: [absY],
            touchID: [touch1.identifier]
        };
    
        if (type[1] === "MouseGestureExpired" && domEvent instanceof ImpersonatedMouseGestureExpiredEvent) {
            message.reason = [domEvent.reason];
        }
    
        // Do not prevent default when first is clickable
        var preventDefault: boolean = true;
        if (areaList.length > 0) {
            var area: CoreArea = areaList[0];
            if (area instanceof DisplayArea && area.display !== undefined &&
                  area.display.displayElement !== undefined &&
                  MondriaDomEvent.findClickable(area.display.displayElement.content, absX, absY)) {
                preventDefault = false;
            }
        }
        if (preventDefault) {
            domEvent.preventDefault();
        }
        domEvent.stopPropagation();
        domEvent.stopImmediatePropagation();
        // First create empty event for mousemove, so that pointerInArea
        // changes before the MouseDown begins
        queueEvent(new ImpersonatedDomEvent("MouseMove"), undefined, undefined,
                   domEventEmptyOS, this.pointerObj, overlappingAreaList, undefined,
                   undefined, undefined, undefined, undefined, undefined);
        // Note: MouseGestureExpired doesn't update the pointer
        queueEvent(domEvent, message, subTypes, areaList, undefined,
                   overlappingAreaList, undefined, undefined, undefined,
                   undefined, copyTouch(touch1), undefined);
        if (domEvent.touches.length === 0) {
            queueEvent(domEvent, undefined, undefined, [], undefined, [],
                       undefined, undefined, undefined, undefined,
                       copyTouch(touch1), undefined);
        }
    }

    touchCancelHandler(domEvent: TouchEvent): void {
        inMouseDown = false;
        if (!runTests) {
            // If the author wants to test time out events, (s)he should insert
            // them in the test
            this.cancelExpirationTask();
            this.startExpirationTask();
        }
        if (blockTaskLoop) {
            resumeTaskProcessing();
        }
        this.touchEventHandler(domEvent, ["TouchUp", "MouseUp"]);
    }

    touchMoveHandler(domEvent: TouchEvent): void {
        if (suppressMoveAndKey) {
            return;
        }
        if (!gAppInFront && !(domEvent instanceof ImpersonatedDomEvent)) {
            return;
        }
        if (blockTaskLoop){
            return;
        }
        if (inMouseDown)
            markEventStart("mouse move", 100);
        if (domEvent.touches.length === 0) {
            return;
        }
        var touch1 = domEvent.touches[0];
        var clientX = touch1.clientX;
        var clientY = touch1.clientY;

        if (logEventHistory) {
            this.eventHistory.push({
                type: domEvent.type,
                absX: clientX,
                absY: clientY,
                time: Date.now(),
                shiftKey: domEvent.shiftKey,
                metaKey: domEvent.metaKey,
                altKey: domEvent.altKey,
                ctrlKey: domEvent.ctrlKey
            });
        }

        this.checkClickExpired(Date.now(), clientX, clientY, false, "mousemove");
    
        // find the set of areas overlapping the mouse, ordered by their
        //  z-stacking
        var overlappingAreaList =
            this.getOverlappingAreas(clientX, clientY);

        // Do not prevent default when first is clickable
        var preventDefault: boolean = true;
        if (overlappingAreaList.length > 0) {
            var area: CoreArea = overlappingAreaList[0].recipient;
            if (area instanceof DisplayArea && area.display !== undefined &&
                    area.display.displayElement !== undefined &&
                    MondriaDomEvent.findClickable(area.display.displayElement.content,
                                                  clientX, clientY)) {
                preventDefault = false;
            }
        }
        if (preventDefault) {
            domEvent.preventDefault();
        }
        domEvent.stopPropagation();
        domEvent.stopImmediatePropagation();
        queueEvent(domEvent, undefined, undefined, domEventEmptyOS,
                this.pointerObj, overlappingAreaList, undefined,
                undefined, undefined, undefined, copyTouch(touch1), undefined);
    }

    /**
     * Checks if the conditions for a click or double click have expired, and sends
     * a notification to that effect. The conditions for a click or double click
     * can be found in {@EventAutomaton}. Only sends DoubleClickExpired when the
     * click is also expired.
     * 
     * @param {any} force when true, the expiration is forced
     */
    checkClickExpired(t: number, x: number, y: number, force: boolean, reason: string) {
        if (this.eventAutomaton.canEmitClick() &&
              (force || this.eventAutomaton.clickExpired(t, x, y))) {
            this.cancelExpirationTask();
            this.eventAutomaton.moveToExpiration();
            if (!runTests) {
                // Must be explicitly inserted in a test
                this.mouseEventHandler(
                    new ImpersonatedMouseGestureExpiredEvent(
                        reason, this.eventAutomaton.lastX, this.eventAutomaton.lastY),
                    "MouseGestureExpired", undefined);
            }
        }
    }
    
    /// Children of foreign interfaces under the pointer
    foreignManagedAreasForEvent: {[event: string]: {[areaId: string]: boolean}};

    addTargetAreaForNextEvent(type: string, areaId: string): void {
        if (this.foreignManagedAreasForEvent === undefined) {
            this.foreignManagedAreasForEvent = {};
        }
        if (!(type in this.foreignManagedAreasForEvent)) {
            this.foreignManagedAreasForEvent[type] = {};
        }
        this.foreignManagedAreasForEvent[type][areaId] = true;
    }

    // Add foreign rendered areas marked for event in front
    extendOverlappingAreas(overlappingAreas: OverlappingAreaList): OverlappingAreaList {
        if (this.foreignManagedAreasForEvent !== undefined &&
              event.type in this.foreignManagedAreasForEvent) {
            for (var areaId in this.foreignManagedAreasForEvent[event.type]) {
                var area = allAreaMonitor.getAreaById(areaId);
                if (area !== undefined) {
                    overlappingAreas =
                        [{recipient: area, insideVisibleRegion: true, relX: undefined, relY: undefined}].
                        concat(overlappingAreas.filter(a => a.recipient !== area));
                }
            }
            this.foreignManagedAreasForEvent = undefined;
        }
        return overlappingAreas;
    }

    // --------------------------------------------------------------------------
    // mouseEventHandler
    //
    // TODO: improve efficiency. During a simple mouse move, the mouse
    // event handler does a lot of processing, even when no-one is listening.
    // Possible optimizations
    // - check only those areas that listen to the actual event
    // - maintain a tree of areas with their absolute positions (update list when
    //   area changes position) and search that first
    //
    mouseEventHandler(domEvent: MouseEvent|ImpersonatedMouseDomEvent, type: string, buttonStateChanges: ButtonStateChange[]) {
        if (!gAppInFront && !(domEvent instanceof ImpersonatedDomEvent))
            return;
    
        var absX = domEvent.clientX;
        var absY = domEvent.clientY;
        var time = Date.now();
        var modifier = this.getDomModifier(domEvent);
    
        assert(domEventEmptyOS.length === 0, "I'm counting on this, you know");
        markEventStart("mouse " + type);
    
        // find the set of areas overlapping the mouse, ordered by their z-stacking
        var overlappingAreaList =
            this.extendOverlappingAreas(this.getOverlappingAreas(absX, absY));
        var areaList = overlappingAreaList.map(function(oa) { return oa.recipient; });
    
        var subTypes: EmittedValueList;
        if (runTests && domEvent instanceof ImpersonatedMouseDomEvent) {
            if (domEvent.subType === undefined) {
                subTypes = domEventEmptyOS;
            } else {
                subTypes = [{
                    areas: overlappingAreaList.map(oa => oa.recipient),
                    value: domEvent.subType
                }];
            }
        } else {
            subTypes = this.eventAutomaton.step(type, time, absX, absY, overlappingAreaList);
        }
        if (logEventHistory) {
            this.eventHistory.push({
                type: type,
                absX: absX,
                absY: absY,
                modifier: modifier,
                time: time,
                subTypes: subTypes === undefined? undefined: subTypes.map(subType => subType.value)
            });
        }
    
        var message: any = {
            type: [type],
            time: [time],
            modifier: modifier,
            absX: [absX],
            absY: [absY]
        };
    
        if (type === "MouseGestureExpired" && domEvent instanceof ImpersonatedMouseGestureExpiredEvent) {
            message.reason = [domEvent.reason];
        }
    
        // Do not prevent default when first is clickable
        var preventDefault: boolean = true;
        var clickableElement: Element = undefined;
        var changes: any = undefined;
        if (areaList.length > 0) {
            var area: CoreArea = areaList[0];
            if (area instanceof DisplayArea && area.display !== undefined &&
                  area.display.displayElement !== undefined) {
                clickableElement = MondriaDomEvent.findClickable(
                    area.display.displayElement.content, absX, absY);
                preventDefault = clickableElement === undefined;
                changes = area.getInputChanges();
            }
        }
        if (preventDefault) {
            domEvent.preventDefault();
        }
        domEvent.stopPropagation();
        domEvent.stopImmediatePropagation();
        // Note: MouseGestureExpired doesn't update the pointer
        queueEvent(domEvent, message, subTypes, areaList,
                (type !== "MouseGestureExpired"? this.pointerObj: undefined),
                overlappingAreaList, undefined, buttonStateChanges,
                changes, undefined, undefined, clickableElement);
    }
    
    wheelEventHandler(domEvent: WheelEvent): void {
        if (!gAppInFront && !(domEvent instanceof ImpersonatedDomEvent))
            return;
    
        var absX = domEvent.clientX;
        var absY = domEvent.clientY;
        var time = Date.now();
        var overlappingAreaList =
            this.extendOverlappingAreas(this.getOverlappingAreas(absX, absY));
        var modifier = this.getDomModifier(domEvent);
        var deltaMode = domEvent.deltaMode === 2? "page":
                        domEvent.deltaMode === 1? "line":
                        "pixel";
        var areaList = overlappingAreaList.map(function(oa) { return oa.recipient; });

        markEventStart("wheel");
        if (logEventHistory) {
            this.eventHistory.push({
                type: domEvent.type,
                absX: absX,
                absY: absY,
                deltaX: domEvent.deltaX,
                deltaY: domEvent.deltaY,
                deltaZ: domEvent.deltaZ,
                deltaMode: deltaMode,
                modifier: modifier,
                time: time
            });
        }
    
        var message = {
            type: ["Wheel"],
            deltaX: [domEvent.deltaX],
            deltaY: [domEvent.deltaY],
            deltaZ: [domEvent.deltaZ],
            deltaMode: [deltaMode],
            time: [time],
            modifier: modifier
        };
    
        // Do not prevent default when first is clickable
        var preventDefault: boolean = true;
        if (areaList.length > 0) {
            var area: CoreArea = areaList[0];
            if (area instanceof DisplayArea && area.display !== undefined &&
                  area.display.displayElement !== undefined &&
                  MondriaDomEvent.findClickable(area.display.displayElement.content, absX, absY) !== undefined) {
                preventDefault = false;
            }
        }
        if (preventDefault) {
            domEvent.preventDefault();
        }
        domEvent.stopPropagation();
        domEvent.stopImmediatePropagation();
        queueCancelEventsOfType("wheel");
        queueEvent(domEvent, message, [], areaList, undefined,
                   overlappingAreaList, undefined, undefined,
                   undefined, undefined, undefined, undefined);
    }
    
    // Looks for a clickable/actionable element in the DOM elements under 'element'
    // whose bounding rectangle covers the given coordinates. The idea is that that
    // is the place to dispatch clicks to when the display:html:handleClick is true.
    static findClickable(element: Element, clientX: number, clientY: number): Element {
        if (element instanceof HTMLAnchorElement ||
              (element instanceof HTMLDivElement &&
               (element.contentEditable === "true" || element.contentEditable === "")) ||
              element instanceof HTMLInputElement  ||
              element instanceof HTMLTextAreaElement) {
            var clientRect = element.getBoundingClientRect();
            return clientRect.top <= clientY && clientY <= clientRect.bottom &&
                   clientRect.left <= clientX && clientX <= clientRect.right?
                  element: undefined;
        } else if (element !== undefined && element.children !== undefined) {
            for (var i = 0; i < element.children.length; i++) {
                var ch = MondriaDomEvent.findClickable(element.children[i], clientX, clientY);
                if (ch !== undefined) {
                    return ch;
                }
            }
        }
        return undefined;
    }
    
    // --------------------------------------------------------------------------
    // getOverlappingAreas
    // 
    // find all the areas overlapping the mouse by descending through the
    //   area embedding tree. Scanning in a DFS post order, with siblings ordered
    //   by their z-order, to get all areas ordered by their z-order.
    //
    getOverlappingAreas(x: number, y: number): OverlappingAreaList {
        var areaList: OverlappingAreaList = [];
        var offsetFromParent: Point = { left: 0, top: 0 };

        if (this.rootArea instanceof DisplayArea &&
              this.rootArea.pointInsideDisplay(x, y, offsetFromParent)) {
            var rootEntry: OverlappingArea = {
                recipient: this.rootArea,
                insideVisibleRegion: true, // Doesn't matter
                relX: x,
                relY: y
            };
            this.rGetOverlappingAreas(areaList, rootEntry);
        }
    
        return areaList.sort(function (a, b) {
            return ZArea.compare(b.recipient.getZAreaRep(),
                                 a.recipient.getZAreaRep());
        });
    }
    
    // --------------------------------------------------------------------------
    // rgetOverlappingAreas
    // 
    // getOverlappingAreas recursive little helper
    // 
    // list is the list to which matching entries are pushed
    // area is the current area entry; it is already known to match, but we should 
    //  first push its matching embedded* area entries (if any exist).
    // x and y are the coordinates of the mouse relative to area's top left corner
    //
    rGetOverlappingAreas(list: OverlappingAreaList, areaEntry: OverlappingArea): void {
        var embeddedAreaList = this.getOverlappingEmbeddedArea(areaEntry);
    
        for (var i = 0; i < embeddedAreaList.length; i++) {
            var curEntry = embeddedAreaList[i];
            this.rGetOverlappingAreas(list, curEntry);
        }
        list.push(areaEntry);
    }
    
    // --------------------------------------------------------------------------
    // getOverlappingEmbeddedArea
    // 
    // return the subset of the embedded areas of 'area' which overlap relX/relY
    //
    getOverlappingEmbeddedArea(areaEntry: OverlappingArea): OverlappingAreaList {
        var relX = areaEntry.relX;
        var relY = areaEntry.relY;
        var overlapping: OverlappingAreaList = [];
        var embedded: any[] = areaRelationMonitor.getRelation(
            areaEntry.recipient.getAreaId(), "embedded");
    
        for (var i = 0; i < embedded.length; i++) {
            var child = allAreaMonitor.getAreaById(embedded[i].getElement());
            if (child === undefined) {
                console.log(areaEntry.recipient.getAreaId(), "missing",
                            embedded[i].getElement());
                continue;
            }
            var offsetFromParent: Point = { left: 0, top: 0 };
            if (child instanceof DisplayArea &&
                  child.pointInsideDisplay(relX, relY, offsetFromParent)) {
                var x = relX - offsetFromParent.left,
                    y = relY - offsetFromParent.top;
                overlapping.push({
                    recipient: child,
                    insideVisibleRegion: child.isOpaquePosition(x, y),
                    relX: x,
                    relY: y
                });
            }
        }
    
        return overlapping;
    }
    
    setNextFocussedArea(area: CoreArea, focus: boolean): void {
        this.nextAreaWithFocus.push({area: area, focus: focus});
        globalSetFocusTask.schedule();
    }

    focusChanged(area: CoreArea): boolean {
        return this.nextAreaWithFocus.some(focusElt => focusElt.area === area);
    }

    updateFocus(): void {
        var nextAreaWithFocus = this.nextAreaWithFocus;

        this.nextAreaWithFocus = [];
        for (var i = 0; i < nextAreaWithFocus.length; i++) {
            var area = nextAreaWithFocus[i].area;
            var focus = nextAreaWithFocus[i].focus;
            if (area !== undefined && !area.hasBeenDestroyed() &&
                  area.canReceiveFocus()) {
                if (focus) {
                    area.takeFocus();
                    return;
                }
            }
        }
        this.eventDiv.focus();
    }
    
    // --------------------------------------------------------------------------
    // getDomModifier
    //
    getDomModifier(domEvent: any): string[]{
        var modifier: string[] = [];

        for (var attr in MondriaDomEvent.modifierTable) {
            if (domEvent[attr]) {
                modifier.push(MondriaDomEvent.modifierTable[attr]);
            }
        }
        return modifier;
    }
    
    // --------------------------------------------------------------------------
    // setPointerImage
    //
    setPointerImage(img: string): void {
        this.eventDiv.style.setProperty("cursor", img, "");
    }
    
    // --------------------------------------------------------------------------
    // keyEventHandler
    // 
    // translate the domEvent to a CDL message
    //   type: <KeyDown/KeyPress/KeyUp>,
    //   modifier: an ordered-set holding a subset of "alt", "control",
    //             "meta", "shift"
    //   key: a string identifying the key pressed (KeyDown/KeyUp)
    //   char: a string of printable text associated with the key pressed, taking
    //          into account modifiers, caps-lock etc
    //   repeat: boolean, true if the event is generated by the key being held down
    //   location: where on the keyboard the key is, "standard"/"left"/"right"/
    //           "numpad"/"mobile"/"joystick"
    // 
    // the message is set, dependencies associated with modules of high enough 
    //  effective priority are processed, then the message is reset.
    // 
    // continue propagation is used to decide if the default behavior should be
    //  allowed or cancelled (e.g. should "<control>l" open a new browser location,
    //  or was it handled internally by the application)
    //  
    //
    keyEventHandler(domEvent: KeyboardEvent|ImpersonatedKeyDomEvent, type: string, key: string, char: string, recipient: DisplayArea): void {
        if (!gAppInFront && !(domEvent instanceof ImpersonatedDomEvent)) {
            return;
        }
    
        var date = new Date();
        var time = date.getTime();
        
        markEventStart("key " + type);
        var modifier = this.getDomModifier(domEvent);
        if (logEventHistory) {
            this.eventHistory.push({
                type: type,
                key: domEvent.key,
                char: domEvent.char,
                which: domEvent.which,
                charCode: domEvent.charCode,
                location: domEvent.location,
                repeat: domEvent.repeat,
                modifier: modifier,
                time: time
            });
        }
    
        var locationList: string[] = [
            "standard",
            "left",
            "right",
            "numpad",
            "mobile",
            "joystick"
        ];
    
        var message: EventObject = {
            key: [key],
            char: [char],
            type: [type],
            time: [time],
            modifier: modifier,
            repeat: [domEvent.repeat],
            location: [locationList[domEvent.location]]
        };
    
        // for the pointer state, we merge the information in the event's modifier
        //  members (altKey, ctrlKey, etc.) with the individual keyDown/keyUp
        // event, in case they report a modifier; so that a key Down/Up event of the
        // shift key itself causes the shift to be enabled/disabled in the pointer
        // state.
        //
        // XX firefox does not (yet) support keyEvent.key), see
        //   https://bugzilla.mozilla.org/show_bug.cgi?id=680830
        if (typeof(message.key[0]) === "string") {
            var pointerMod: any = {};
            for (var modName in MondriaDomEvent.modifierTable) {
                var modVal = !!(<any>domEvent)[modName];
                if (message.key[0].toLowerCase() === MondriaDomEvent.modifierTable[modName]) {
                    modVal = type === "KeyUp"? false : true;
                }
                pointerMod[modName] = modVal;
            }
            this.pointerObj.setModifierState(
                pointerMod.shiftKey,
                pointerMod.metaKey, pointerMod.altKey,
                pointerMod.ctrlKey || pointerMod.metaKey);
    
            // have [pointer] reflect modifier changes
            this.pointerObj.flushUpdate();
        }
    
        if (debugLogEvent(type)) {
            console.log("type=" + message.type[0] + ", key=" + message.key[0],
                        "char=" + message.char[0]);
        }
    
        if (this.blockDefaultBrowserAction(key, pointerMod)) {
            domEvent.preventDefault();
            domEvent.stopPropagation();
            domEvent.stopImmediatePropagation();
        }
        queueEvent(domEvent, message, undefined,
                   recipient === undefined? ["global"]: [recipient, "global"],
                   undefined, [], undefined, undefined, undefined, undefined,
                   undefined, undefined);
    }
    
    blockDefaultBrowserAction(key: string, modifiers: any): boolean {
        return key === "Tab" ||
               ((key === "s" || key === "S") && (modifiers.ctrlKey || modifiers.metaKey));
    }

    resizeScreenArea(width: number, height: number): void {
        globalScreenWidthConstraint.newDescription({
            point1: { type: "left" },
            point2: { type: "right" },
            equals: width,
            priority: 10000
        }, 10000);
        globalScreenHeightConstraint.newDescription({
            point1: { type: "top" },
            point2: { type: "bottom" },
            equals: height,
            priority: 10000
        }, 10000);
        scheduleGeometryTask();
        // if this resize was really a zoom in/out, re-measure all display
        // queries
        scheduleDisplayQueryRecalculation();
        if (logEventHistory) {
            this.eventHistory.push({
                type: "resizeScreenArea",
                width: width,
                height: height,
                time: Date.now()
            });
        }

    }
    
    recordHandlerCalled(name: string): void {
        if (logEventHistory && logEventComments) {
            this.eventHistory.push({
                type: "comment",
                comment: "handlerCalled",
                name: name,
                time: Date.now()
            });
        }
    }
    
    recordShowRunningDiv(state: number): void {
        this.topDivState = state;
        if (logEventHistory && logEventComments) {
            this.eventHistory.push({
                type: "comment",
                comment: "runningDiv",
                state: state,
                time: Date.now()
            });
        }
    }
    
    recordUnhandledEvent(name: string): void {
        if (logEventHistory) {
            this.eventHistory.push({
                type: "comment",
                comment: "unhandledEvent",
                name: name,
                time: Date.now()
            });
        }
    }
    
    recordComment(comment: string): void {
        if (logEventHistory && logEventComments) {
            this.eventHistory.push({
                type: "comment",
                comment: comment,
                time: Date.now()
            });
        }
    }
}

function debugEventMessage(message: EventObject, areaList: OverlappingAreaList, groupState: number): void {
    if (!debugEventFilter(message)) {
        var consoleMsg = cdlify(message); 
        if (groupState === 0) {
            (<any>console.groupCollapsed)("%cevent: " + consoleMsg, 'font-weight:500;');
        } else {
            console.log(consoleMsg);
        }
        if (areaList) {
            debugEventListArea(areaList);
        }
        if (groupState === 2) {
            console.groupEnd();
        }
    }
}

function debugEventPropagationAbortedMessage(message: EventObject): void {
    if (!debugEventFilter(message)) {
        var abortIdMsg = gDomEvent.debugAbortId?
                            " by " + gDomEvent.debugAbortId: "";
        console.log("event propagation aborted" + abortIdMsg);
    }
}

function debugEventListArea(areaList: OverlappingAreaList): void {
    var paidList: string[] = [];

    for (var i = 0; i < areaList.length; i++) {
        paidList.push("@" + areaList[i].recipient.areaId);
    }
    console.log("covering area list:", paidList);
}

function debugEventFilter(msg: EventObject): boolean {
    return msg.type !== undefined && !runTests && msg.type[0] === "MouseMove";
}

var lastEventDescription: string = undefined;
var globalTaskQueueIterationTimeout: number = 50;

function markEventStart(msg: string, timeOutPerm: number = undefined) {
    if (timeOutPerm !== undefined) {
        globalTaskQueue.iterationTimeout = timeOutPerm;
    } else {
        globalTaskQueue.iterationTimeout = globalTaskQueueIterationTimeout;
    }
    if (gInitPhase || !logEventTimes)
        return;
    if (lastEventDescription !== undefined) {
        console.log(lastEventDescription + " interrupted after " +
                    (Date.now() - mondriaOnLoadDate.getTime()) + " ms");
    }
    mondriaOnLoadDate = new Date();
    lastEventDescription = msg;
}

function markEventEnd() {
}

// This function is used to post events received by input elements.
function postKeyEvent(domEvent: ImpersonatedKeyDomEvent, recipient: ElementReference): boolean {
    var eventRecipient: DisplayArea;

    if (recipient instanceof ElementReference) {
        var area = allAreaMonitor.getAreaById((<ElementReference>recipient).element);
        if (area instanceof DisplayArea) {
            eventRecipient = area;
        } else {
            return false;
        }
    }
    domEvent.stopImmediatePropagation();
    domEvent.stopPropagation();
    switch (domEvent.type) {
      case "keydown":
        return gDomEvent.keyDownUpHandler(domEvent, eventRecipient, true);
      case "keyup":
        return gDomEvent.keyDownUpHandler(domEvent, eventRecipient, false);
      case "keypress":
        return gDomEvent.keyPressHandlerInt(domEvent, eventRecipient);
    }
    return false;
}

// States of the automaton
var EventAutomatonState = {
    initialState: 0,
    firstMouseDown: 1,
    click: 2,
    secondMouseDown: 3,
    clickExpiredState: 4,
    doubleClickExpiredState: 5
}

var nrClicks = 0;

/**
 * This class implements a DFA for turning event information into event
 * sub-types. It takes the event type, time, coordinates and overlapping area
 * list as its input, and emits the sub-types for the last event. The
 * transition table is implemented in step().
 */
class EventAutomaton {

    // The parameters that control click and double click
    maxClickDelta = 700; // max 700ms between mouse down and mouse up
    maxClickMouseMovement = 3; // more than 3 pixels moved means no click
    maxInterClickDelta = 700; // max 700ms between 1st mouse up and 2nd mouse down
    // Time and location of previously relevant event
    lastT = -this.maxClickDelta - 1;
    lastX = -this.maxClickMouseMovement - 1;
    lastY = -this.maxClickMouseMovement - 1;

    state: number;

    lastOverlappingAreaList: OverlappingAreaList = undefined;

    constructor() {
        // Setting up the DFA
        this.goto(EventAutomatonState.initialState);
    }
    
    reset(): void {
        this.goto(EventAutomatonState.initialState);
        this.lastT = -this.maxClickDelta - 1;
        this.lastX = -this.maxClickMouseMovement - 1;
        this.lastY = -this.maxClickMouseMovement - 1;
    }

    goto(state: number): void {
        this.state = state;
    }
    
    /**
     * Implements the transition table. You can use GraphViz' "dot" to convert the
     * following lines into a graphical representation: 
     *  
     * digraph events {
     *   initialState -> firstMouseDown [label="on:MouseDown\nmark"];
     *   firstMouseDown -> click [label="on:MouseUp+\nmark\nemit Click"];
     *   firstMouseDown -> initialState;
     *   firstMouseDown -> clickExpiredState [label="on:timeout or\nmouse move"];
     *   click -> secondMouseDown [label="on:MouseDown+\nmark"];
     *   click -> firstMouseDown [label="on:MouseDown-\nmark"];
     *   click -> initialState;
     *   secondMouseDown -> initialState [label="on:MouseUp+\nemit Click&DoubleClick"];
     *   secondMouseDown -> initialState;
     *   secondMouseDown -> doubleClickExpiredState [label="on:timeout or\nmouse move"];
     *   clickExpiredState -> initialState [label="emit click\nexpiration"];
     *   doubleClickExpiredState -> initialState [label="emit click&double\nclick expiration"];
     * }
     * 
     * A + means: within time and space boundaries; a - means: outside; no label
     * means: in all other cases; mark means: record current time and position for
     * use in the next event.
     */
    step(type: string, t: number, x: number, y: number, overlappingAreaList: OverlappingAreaList): EmittedValueList {
        var deltaT: number = t - this.lastT;
        var deltaX: number = Math.abs(x - this.lastX);
        var deltaY: number = Math.abs(y - this.lastY);
        var emitted: EmittedValueList = [];
    
        switch (this.state) {
          case EventAutomatonState.initialState:
            if (type === "MouseDown") {
                this.goto(EventAutomatonState.firstMouseDown);
                this.lastOverlappingAreaList = overlappingAreaList;
            }
            break;
          case EventAutomatonState.firstMouseDown:
            if (type === "MouseUp") {
                if ((deltaT <= this.maxClickDelta || testSingleStep) &&
                      deltaX <= this.maxClickMouseMovement &&
                      deltaY <= this.maxClickMouseMovement) {
                    nrClicks++;
                    emitted.push({
                        value: "Click",
                        areas: this.getLastOverlappingAreas()
                    });
                    this.goto(EventAutomatonState.click);
                } else {
                    this.goto(EventAutomatonState.initialState);
                }
            } else {
                this.goto(EventAutomatonState.initialState);
            }
            break;
          case EventAutomatonState.click:
            if (type === "MouseDown") {
                if ((deltaT <= this.maxInterClickDelta || testSingleStep) &&
                      deltaX <= this.maxClickMouseMovement &&
                      deltaY <= this.maxClickMouseMovement) {
                    this.goto(EventAutomatonState.secondMouseDown);
                } else {
                    this.goto(EventAutomatonState.firstMouseDown);
                    this.lastOverlappingAreaList = overlappingAreaList;
                }
            } else {
                this.goto(EventAutomatonState.firstMouseDown);
                this.lastOverlappingAreaList = overlappingAreaList;
            }
            break;
          case EventAutomatonState.secondMouseDown:
            if (type === "MouseUp") {
                if (deltaT <= this.maxClickDelta &&
                      deltaX <= this.maxClickMouseMovement &&
                      deltaY <= this.maxClickMouseMovement) {
                    nrClicks++;
                    emitted.push({
                        value: "DoubleClick",
                        areas: this.getLastOverlappingAreas()
                    });
                }
            }
            this.goto(EventAutomatonState.initialState);
            break;
          case EventAutomatonState.clickExpiredState:
            emitted.push({
                value: "Click",
                areas: this.getLastOverlappingAreas()
            });
            this.goto(EventAutomatonState.initialState);
            break;
          case EventAutomatonState.doubleClickExpiredState:
            emitted.push({
                value: "DoubleClick",
                areas: this.getLastOverlappingAreas()
            });
            this.goto(EventAutomatonState.initialState);
            break;
          default:
            assert(false, "Error in eventAutomaton's state");
        }
        this.lastT = t;
        this.lastX = x;
        this.lastY = y;
        return emitted;
    }
    
    getLastOverlappingAreas() {
        return this.lastOverlappingAreaList.map(function(oa) {
            return oa.recipient;
        }).filter(function(area) {
            return area !== undefined && area.areaReference !== undefined;
        });
    }
    
    canEmitClick() {
        return this.state === EventAutomatonState.firstMouseDown ||
               this.state === EventAutomatonState.click ||
               this.state === EventAutomatonState.secondMouseDown;
    }
    
    canEmitDoubleClick() {
        return this.state === EventAutomatonState.secondMouseDown;
    }
    
    clickExpired(t: number, x: number, y: number): boolean {
        return (t - this.lastT > this.maxInterClickDelta && !testSingleStep) ||
               Math.abs(x - this.lastX) > this.maxClickMouseMovement ||
               Math.abs(y - this.lastY) > this.maxClickMouseMovement;
    }
    
    // Only call this when the MouseUp still has to come
    moveToExpiration(): void {
        this.goto(this.state === EventAutomatonState.firstMouseDown?
                  EventAutomatonState.clickExpiredState:
                  EventAutomatonState.doubleClickExpiredState);
    }
}

function copyTouch(touch: Touch): Touch {
    return {
        identifier: touch.identifier,
        clientX: touch.clientX,
        clientY: touch.clientY,
        pageX: touch.pageX,
        pageY: touch.pageY,
        screenX: touch.screenX,
        screenY: touch.screenY,
        target: touch.target,
        altitudeAngle: touch.altitudeAngle,
        azimuthAngle: touch.azimuthAngle,
        rotationAngle: touch.rotationAngle,
        force: touch.force,
        radiusX: touch.radiusX,
        radiusY: touch.radiusY,
        touchType: touch.touchType
    };
}