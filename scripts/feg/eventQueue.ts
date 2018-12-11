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

/// <reference path="evaluationQueue.ts" />
/// <reference path="pointer.ts" />
/// <reference path="eventHandlers.ts" />

type ButtonStateChange = {pointer: MondriaPointer; pointerID: number; buttonID: number; state: string;};

enum QueuedEventState {
    waiting,
    start,
    recipients,
    end,
    done
}

class QueuedEvent {
    /// When true, the event has been handled
    public state: QueuedEventState = QueuedEventState.waiting;
    /// List of the areas that have handled the event already
    public handledBy: (string|ElementReference)[] = constEmptyOS;
    /// When true, processing has been interrupted, gets set by
    /// abortMessagePropagation
    public abortPropagation: string = undefined;
    /// Points at the area with an input element that takes the focus, if the
    /// event propagates to such an area, it is aborted, and the event is sent
    /// to the area.
    public focussedInputElement: DisplayArea = undefined;
    /// True when the recipient list wasn't empty
    public hadRecipients: boolean;

    constructor(
        /// Time of the event in ms.
        public time: number,
        /// The original event
        public event: any,
        /// The original event type
        public type: string,
        /// A protected event cannot be flushed due to a time-out.
        /// Currently, this is only used for MouseUp and KeyUp events.
        public isProtected: boolean,
        /// When the handler has been called, its message is placed here, to be
        /// tried by all recipients. Only once the message has been processed
        /// completely, the next event can be handled.
        public message: EventObject|undefined,
        // Sub-types for the message with a list of applicable recipients
        public subTypes: { value: string; areas: CoreArea[]; }[]|undefined,
        /// The recipients for the message, the message is sent to these recipients
        /// in order. 
        public recipients: (string|CoreArea)[],
        /// One or more button state changes
        public buttonStateChanges: ButtonStateChange[]|undefined,
        /// The pointer object involved in mouse events
        public pointer: MondriaPointer|undefined,
        /// Objects being dragged. When undefined, doesn't change the dragging
        /// status. Otherwise, the dragging status is updated with its truthiness.
        public dragging: any[]|FileList|undefined,
        /// List of areas under pointer
        public overlappingAreas: OverlappingAreaList,
        /// If this is an input change event, changes to the recipient
        public changes: {[attr: string]: any}|undefined,
        /// If this is an input change event, check input element's existence or not
        public checkExistence: boolean,
        /// The touch for this event
        public touch: Touch|undefined,
        /// The clickable element that was under this event; if this is defined,
        /// the area's param is updated with this.changes.
        public clickableElement: Element|undefined
    ) {
        this.hadRecipients = recipients !== undefined && recipients.length > 0;
    }

    canChangeFocus(): boolean {
        var event: any = this.event;

        if (event instanceof ImpersonatedDomEvent) {
            switch (event.type) {
              case "MouseDown":
              case "FileChoice":
                return this.hadRecipients;
            }
        } else {
            switch (event.type) {
              case "mousedown":
              case "drop":
                return this.hadRecipients;
            }
        }
        return false;
    }

    dispatchEvent(focussedInputElement: DisplayArea): void {
        // If there is an element that gets the focus or will handle the click,
        // but it's not the top area, create a new event and dispatch it to the
        // element in it that can actually handle the click. This only works for
        // links, but does not seem to work for input elements.
        if ((this.event.type === "mousedown" || this.event.type === "MouseDown" ||
              this.event.type === "mouseup" || this.event.type === "MouseUp") &&
             focussedInputElement.display.displayElement !== undefined) {
            var element = MondriaDomEvent.findClickable(
                focussedInputElement.display.displayElement.content,
                this.event.clientX, this.event.clientY);
            if (element !== undefined) {
                if (debugLogEvent(this.event.type)) {
                    console.log("dispatching", this.event.type, "to", (<any>element).offsetParent.id);
                }
                var e = new MouseEvent(this.event.type, this.event);
                gDontProcessEvent = e;
                element.dispatchEvent(e);
                // Links should (also) receive a "click" event. Since we don't have
                // an explicit click event handler, we synthesize it here.
                if (this.subTypes !== undefined &&
                      this.subTypes.some(st => st.value === "Click" && st.areas.indexOf(focussedInputElement) >= 0)) {
                    e = new MouseEvent("click", this.event);
                    element.dispatchEvent(e);
                }
                gDontProcessEvent = undefined;
            }
        }
    }
}

// a base class for pseudo dom events generated by test-nodes
// and synthetic events (InputChange).
class ImpersonatedDomEvent {
    timeStamp: number = Date.now();

    constructor (public type: string) {
    }

    stopPropagation(): void { return; }
    stopImmediatePropagation(): void { return; }
    preventDefault(): void { return; }
}

// add modifier handling
class ImpersonatedDomEventWithModifier extends ImpersonatedDomEvent {
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;

    constructor(type: string, modifier: string[]) {
        super(type);
        if (modifier !== undefined) {
            for (var i = 0; i < modifier.length; i++) {
                var mod = modifier[i];
                if (mod === "alt") {
                    this.altKey = true;
                } else if (mod === "control") {
                    this.ctrlKey = true;
                } else if (mod === "meta") {
                    this.metaKey = true;
                } else if (mod === "shift") {
                    this.shiftKey = true;
                }
            }
        }
    }
}

// a derived class for mouse events (a class with no methods)
class ImpersonatedMouseDomEvent extends ImpersonatedDomEventWithModifier {
    constructor(type: string, public subType: string, public clientX: number,
                public clientY: number, public button: number, modifier: string[]) {
        super(type, modifier);
    }
}

// a derived class for touch events (a class with no methods)
class ImpersonatedTouchDomEvent extends ImpersonatedDomEventWithModifier {
    constructor(type: string, public subType: string) {
        super(type, []);
    }
}

class ImpersonatedMouseGestureExpiredEvent extends ImpersonatedMouseDomEvent {
    reason: string;
    constructor(subType: string, clientX: number, clientY: number) {
        super("MouseGestureExpired", subType, clientX, clientY, undefined, []);
    }
}

class ImpersonatedDropEvent extends ImpersonatedMouseDomEvent {
    dataTransfer: any;

    constructor(public area: any, clientX: number, clientY: number, public subType: string, fileNames: string[]) {
        super("FileChoice", undefined, clientX, clientY, undefined, []);
        this.dataTransfer = {
            files: fileNames
        }
    }
}

class ImpersonatedKeyDomEvent extends ImpersonatedDomEventWithModifier {
    // These fields exist for type compatibility with the old event interface
    keyCode: number;
    charCode: number;
    which: number;
    location: number;
    repeat: boolean;

    constructor(type: string, public key: string, public char: string,
                modifier: string[]) {
        super(type, modifier);
    }
}

var emptyMessage: EventObject[] = [];
var emptyMessageResult: Result = new Result(emptyMessage);

class EventQueue {

    eventQueue: QueuedEvent[] = [];
    pointerInAreas: {[areaReference: string]: CoreArea} = {};
    dragInAreas: {[areaReference: string]: CoreArea} = {};
    domEventAreasUnderPointerResult: Result = new Result();
    prevRecipient: CoreArea = undefined;
    lastMousePosition: number[] = [0, 0];
    dragging: boolean = false;

    // This is the administration for restriction event propagation to areas
    // that have received the logically preceding event: a double click expired
    // can only be received by an area that has received the preceding click.
    // Only works for Click.
    subTypeReceivers: {[subType: string]: {[areaId: string]: boolean}} = {};

    private setMessage(messageValue: any[], recipient: string|CoreArea): void {
        var messageResult: Result = new Result(messageValue);

        function updateMessage(area: CoreArea, message: Result): void {
            if (!area.hasBeenDestroyed() &&
                  area.evaluationNodes[0][areaMessageIndex] !== undefined) {
                (<EvaluationMessageQueue>area.evaluationNodes[0][areaMessageIndex]).set(message);
            }
        }

        if (recipient instanceof DisplayArea && messageValue.length === 1) {
            var absX = singleton(messageValue[0].absX);
            var absY = singleton(messageValue[0].absY);
            if (typeof(absX) === "number") {
                var areaAbsPos = recipient.getAbsolutePosition();
                messageValue[0].relX = [absX - areaAbsPos.left];
                messageValue[0].relY = [absY - areaAbsPos.top];
            }
        }

        if (debugLogEvent("message")) {
            console.log("set message", cdlify(messageValue), recipient instanceof CoreArea? recipient.areaId: recipient);
        }

        (<EvaluationMessageQueue>globalEvaluationNodes[globalMessageNodeIndex]).set(messageResult);
        if (this.prevRecipient !== undefined) {
            updateMessage(this.prevRecipient, emptyMessageResult);
        }
        if (recipient instanceof CoreArea) {
            updateMessage(recipient, messageResult);
            this.prevRecipient = recipient;
        } else {
            this.prevRecipient = undefined;
        }
        globalContentTask.schedule();
    }

    public sendMessage(messageValue: any[], recipient: any): void {
        var recip: string|CoreArea = undefined;

        if (recipient instanceof ElementReference) {
            recip = allAreaMonitor.getAreaById(recipient.element);
        } else if (typeof(recipient) === "string") {
            recip = recipient;
        }
        if (recip !== undefined) {
            this.setMessage(messageValue, recip);
        }
    }

    public clearMessage(): void {
        this.setMessage(constEmptyOS, undefined);
    }

    public nextQueuedEvent(): boolean {
        if (this.eventQueue.length === 0) {
            return true;
        }
        if (globalDebugTracingLog !== undefined) {
            globalDebugTracingLog.newCycle(0);
        }        
        var nextEvent: QueuedEvent = this.eventQueue[0];
        if (nextEvent !== undefined && nextEvent.state === QueuedEventState.done) {
            this.terminateEvent();
        } else if (nextEvent !== undefined) {
            if (nextEvent.state === QueuedEventState.waiting) {
                this.startNextEvent();
            }
            if (nextEvent.message !== undefined) {
                var lMessage: EventObject = shallowCopy(nextEvent.message);
                var nextRecipient: string|CoreArea;
                switch (nextEvent.state) {
                    case QueuedEventState.start:
                        nextRecipient = "start";
                        nextEvent.state = nextEvent.hadRecipients?
                              QueuedEventState.recipients: QueuedEventState.end;
                        break;
                    case QueuedEventState.recipients:
                        nextRecipient = nextEvent.recipients.shift();
                        nextEvent.state = nextEvent.recipients.length > 0?
                            QueuedEventState.recipients: QueuedEventState.end;
                        break;
                    case QueuedEventState.end:
                        nextRecipient = "end";
                        nextEvent.state = QueuedEventState.done;
                        break;
                    default:
                        Utilities.error("error in QueuedEventState");
                        break;
                }
                if (debugLogEvent("message")) {
                    console.log("next recipient", (nextRecipient instanceof CoreArea? nextRecipient.areaId: nextRecipient));
                }
                if (typeof(nextRecipient) === "string") {
                    lMessage.recipient = [<string>nextRecipient];
                    lMessage.subType = nextEvent.subTypes === undefined? constEmptyOS:
                        nextEvent.subTypes.map(subType => subType.value);
                } else {
                    var areaRecipient = <CoreArea> nextRecipient;
                    if (areaRecipient === undefined || areaRecipient.hasBeenDestroyed()) {
                        // Skip non-existent area; don't add it to handledBy
                        return this.eventQueue.length === 0;
                    }
                    lMessage.recipient = [areaRecipient.areaReference];
                    if (areaRecipient.canReceiveFocus() || areaRecipient.willHandleClick()) {
                        // Cast is safe
                        nextEvent.focussedInputElement = <DisplayArea> areaRecipient;
                        if (debugLogEvent("message")) {
                            console.log("focussed element", areaRecipient.areaId);
                        }
                    } else {
                        lMessage.subType = nextEvent.subTypes === undefined? constEmptyOS:
                            nextEvent.subTypes.
                            filter(subType => subType.areas.indexOf(areaRecipient) >= 0).
                            map(subType => subType.value);
                        for (var i = 0; i < lMessage.subType.length; i++) {
                            var subType = lMessage.subType[i];
                            if (nextEvent.type === "mouseup" && subType === "Click") {
                                if (!(subType in this.subTypeReceivers)) {
                                    this.subTypeReceivers[subType] = {};
                                }
                                this.subTypeReceivers[subType][areaRecipient.areaId] = true;
                            }
                        }
                    }
                    if (nextEvent.clickableElement !== undefined &&
                          nextEvent.changes !== undefined) {
                        // The InputChange event sets the area's param at the
                        // same time, so they happen at the same time, and so
                        // they are queued in the same order as the actual
                        // changes.
                        areaRecipient.updateParamInput(
                            nextEvent.changes, nextEvent.type !== "inputchange",
                            nextEvent.checkExistence);
                    }
                }
                lMessage.handledBy = nextEvent.handledBy;
                this.setMessage([lMessage], nextRecipient);
                nextEvent.handledBy = nextEvent.handledBy.concat(lMessage.recipient);
            } else {
                nextEvent.state = QueuedEventState.done;
            }
        } else {
            this.setMessage(emptyMessage, undefined);
        }
        return this.eventQueue.length === 0;
    }

    /// First time handling of the event. Performs button state change, pointer
    /// position update, modifier changes and pointerInArea updates.
    startNextEvent(): void {
        var nextEvent: QueuedEvent = this.eventQueue[0];

        if (nextEvent.buttonStateChanges !== undefined) {
            for (var i: number = 0; i < nextEvent.buttonStateChanges.length; i++) {
                var change: ButtonStateChange = nextEvent.buttonStateChanges[i];
                change.pointer.setButtonState(change.buttonID, change.state);
            }
        }
        if (nextEvent.pointer !== undefined) {
            var domEvent = nextEvent.event;
            this.updateDragging(nextEvent);
            if (domEvent !== undefined && domEvent.clientX !== undefined &&
                  nextEvent.pointer.setPos(domEvent.clientX, domEvent.clientY)) {
                globalGeometryTask.executeTask(undefined);
            }
            nextEvent.pointer.setModifierState(
                !!domEvent.shiftKey, !!domEvent.metaKey, !!domEvent.altKey,
                !!domEvent.ctrlKey || !!domEvent.metaKey);
            if (nextEvent.overlappingAreas !== undefined) {
                this.updatePointerInArea(nextEvent.overlappingAreas,
                                         this.dragging);
            }
            this.lastMousePosition = [domEvent.clientX, domEvent.clientY];
        }
        if (nextEvent.touch !== undefined) {
            var touch = nextEvent.touch;
            if (touch !== undefined && touch.clientX !== undefined &&
                  gPointer.setPos(touch.clientX, touch.clientY)) {
                globalGeometryTask.executeTask(undefined);
            }
            if (nextEvent.overlappingAreas !== undefined) {
                this.updatePointerInArea(nextEvent.overlappingAreas,
                                         this.dragging);
            }
            this.lastMousePosition = [touch.clientX, touch.clientY];
        }
        this.restrictSubTypePropagation(nextEvent);
        nextEvent.state = QueuedEventState.start;
        if (typeof(Event) !== "undefined" && nextEvent.event instanceof Event) {
            clearProgressDiv();
        }
        if (logEventHistory) {
            gDomEvent.eventHistory.push({
                type: "process",
                event: nextEvent.type,
                time: Date.now(),
                queueLen: this.eventQueue.length
            });
        }
        if (debugLogEvent("message")) {
            console.log("next event", nextEvent.type, cdlify(nextEvent.message),
                        nextEvent.recipients.map(r => r instanceof CoreArea? r.areaId: r).join(","));
        }
    }

    private updateDragging(nextEvent: QueuedEvent): void {
        if (nextEvent.dragging !== undefined) {
            var isDragging = isTrue(nextEvent.dragging);
            nextEvent.pointer.setDragState(nextEvent.dragging);
            if (this.dragging != isDragging) {
                this.dragging = isDragging;
                globalReupdatePointerInAreaTask.schedule();
            }
        }
    }

    /// Remove the event from the beginning of the queue, and set message to o() 
    terminateEvent(): void {
        var nextEvent: QueuedEvent = this.eventQueue.shift();
        var focussedInputElement = nextEvent.focussedInputElement !== undefined?
                                   nextEvent.focussedInputElement: undefined;

        assert(nextEvent.state === QueuedEventState.done, "debugging");
        if (debugLogEvent("message")) {
            console.log("end of event");
        }
        this.setMessage(emptyMessage, undefined);
        if (nextEvent.canChangeFocus() &&
              !gDomEvent.focusChanged(focussedInputElement)) {
            gDomEvent.setNextFocussedArea(focussedInputElement, true);
        }
        if (focussedInputElement !== undefined) {
            nextEvent.dispatchEvent(focussedInputElement);
        }
    }

    // This function limits the MouseGestureExpired/DoubleClick to those areas
    // that have seen a subType: "Click".
    restrictSubTypePropagation(event: QueuedEvent): void {
        // Reset subTypeReceivers for this event
        if (event.subTypes === undefined) {
            return;
        }
        for (var i = 0; i < event.subTypes.length; i++) {
            var subType = event.subTypes[i];
            delete this.subTypeReceivers[subType.value];
        }
        if (event.type === "MouseGestureExpired") {
            var restrictedSubTypes = [];
            var newRecipients: {[areaId: string]: boolean} = {};
            for (var i = 0; i < event.subTypes.length; i++) {
                var subType = event.subTypes[i];
                var subTypeAreas = subType.value === "DoubleClick" && this.subTypeReceivers["Click"] !== undefined?
                    subType.areas.filter(
                        area => area.areaId in this.subTypeReceivers["Click"]
                    ):
                    subType.areas;
                if (subTypeAreas.length > 0) {
                    restrictedSubTypes.push({value: subType.value, areas: subTypeAreas});
                    for (var j = 0; j < subTypeAreas.length; j++) {
                        newRecipients[subTypeAreas[j].areaId] = true;
                    }
                }
            }
            event.subTypes = restrictedSubTypes;
            event.recipients = event.recipients.filter(
                recipient => typeof(recipient) === "string" || recipient.areaId in newRecipients
            );
            event.hadRecipients = event.recipients.length > 0;
        }
    }

    /// Tracks information for debugging propagatePointerInArea
    static debugPPIAInfo: any[] = [];

    /// Children of foreign interfaces under the pointer
    foreignManagedAreasUnderPointer: {[areaId: string]: boolean};

    // Only updates foreignManagedAreasUnderPointer; does not trigger the queue.
    // the event should still come, or the queue must be run by the foreign
    // interface (directly or by inserting an event).
    addPointerInArea(inArea: boolean, areaId: string): void {
        if (inArea) {
            if (this.foreignManagedAreasUnderPointer === undefined) {
                this.foreignManagedAreasUnderPointer = {};
            }
            this.foreignManagedAreasUnderPointer[areaId] = true;
        } else if (this.foreignManagedAreasUnderPointer !== undefined) {
            delete this.foreignManagedAreasUnderPointer[areaId];
        }
    }

    // Updates property ptrInArea/dragInArea. Returns true when there is a
    // change. Adds foreignManagedAreasUnderPointer in front.
    updatePointerInArea(areas: OverlappingAreaList, drag: boolean): void {
        var newPtrInAreas: {[areaReference: string]: CoreArea} = {};
        var areasUnderPointerValue: ElementReference[] = [];

        var areaQueue: CoreArea[] = [];

        function addToQueue(area: CoreArea, insideVisibleRegion: boolean, reason: string, origin: string) {
            if (!(area.areaId in newPtrInAreas)) {
                var disp = area instanceof DisplayArea? area.display: undefined;
                areaQueue.push(area);
                areasUnderPointerValue.push(area.areaReference);
                newPtrInAreas[area.areaId] = area;
                var dbgInfo: any = {};
                dbgInfo.areaId = area.areaId;
                dbgInfo.reason = reason;
                dbgInfo.insideVisibleRegion = insideVisibleRegion;
                dbgInfo.propagateTo =
                    area.propagatePointerInArea === undefined ||
                    Utilities.isEmptyObj(area.propagatePointerInArea)?
                    "implicit embedding":
                    Object.keys(area.propagatePointerInArea).filter(function(attr) {
                        return area.propagatePointerInArea[attr];
                    }).join(", ");
                if (origin !== undefined) {
                    dbgInfo.from = origin;
                }
                if (disp !== undefined) {
                    dbgInfo.display = disp.descriptionDisplay;
                }
                EventQueue.debugPPIAInfo.push(dbgInfo);
            }
        }

        EventQueue.debugPPIAInfo = [];

        // Prioritize areas rendered by foreign interfaces
        for (var areaId in this.foreignManagedAreasUnderPointer) {
            var area = allAreaMonitor.getAreaById(areaId);
            if (area !== undefined) {
                areas = [{recipient: area, insideVisibleRegion: true, relX: undefined, relY: undefined}].
                        concat(areas.filter(a => a.recipient !== area));
            }
        }

        areaOverlapMonitor.updatePointerOverlap(areas);

        // step A. - z-based trickling:
        //
        // iterate areas in areas in z-order
        //
        // for each area:
        //   if it is not already in newPtrInAreas:
        //      add it to the queue/newPtrInAreas
        //
        //   if the area is opaque, break iteration
        // (else) continue to next area
        //
        var recipient: CoreArea;

        for (var i = 0; i < areas.length; i++) {
            recipient = areas[i].recipient;
            addToQueue(recipient, areas[i].insideVisibleRegion, "z-order", undefined);
            if (areas[i].insideVisibleRegion) {
                EventQueue.debugPPIAInfo[EventQueue.debugPPIAInfo.length - 1].reason += " opaque";
                break;
            }
            EventQueue.debugPPIAInfo[EventQueue.debugPPIAInfo.length - 1].reason += " transparent";
        }

        // step B. - propagation to parents:
        //
        // while the queue is not empty:
        //    pop an area from the queue
        //    if it has a 'propagatePointerInArea', propagate according to it,
        //          adding the embedding/expression/referred area to the queue
        //    otherwise, if it is opaque, propagate to its embedding, adding it
        //          to the queue
        //    (otherwise no propagation)
        //
        while (areaQueue.length > 0) {
            recipient = areaQueue.pop();
            var recipientId = recipient.getAreaId();
            var ppia = recipient.propagatePointerInArea;
            if (recipient instanceof DisplayArea && ppia !== undefined) {
                for (var ppiaElt in ppia) {
                    switch (ppiaElt) {
                      case "embedding":
                        if (recipient.embedding) {
                            addToQueue(recipient.embedding, true,
                                       "explicit from embedded", recipientId);
                        }
                        break;
                      case "expression":
                        if (recipient.intersectionChain) {
                            addToQueue(recipient.intersectionChain.expressionArea,
                                       true, "explicit from intersection (expression)",
                                       recipientId);
                        }
                        break;
                      case "referred":
                        if (recipient.intersectionChain) {
                            addToQueue(recipient.intersectionChain.referredArea,
                                       true, "explicit from intersection (referred)",
                                       recipientId);
                        }
                        break;
                      default:
                        var explicitArea = allAreaMonitor.getAreaById(ppiaElt);
                        if (explicitArea !== undefined) {
                            addToQueue(explicitArea, true, "explicit area", recipientId);
                        }
                    }
                }
            } else if (recipient.embedding) {
                addToQueue(recipient.embedding, true, "implicit from embedded",
                            recipientId);
            }
        }

        // Update pointerInArea or dragInArea
        // var change = false;
        var propInAreas = drag? this.dragInAreas: this.pointerInAreas; 
        // First set the property to true for the current areas
        for (var areaId in propInAreas) {
            if (!propInAreas[areaId].hasBeenDestroyed()) {
                // If the area hasn't been destroyed since the last call to this
                // function and is not in newPtrInAreas, set to false
                if (!(areaId in newPtrInAreas)) {
                    this.setPtrInArea(propInAreas[areaId], false, drag);
                }
            } else {
                // If it had been destroyed, remove it from pointerInAreas, so that
                // it will get set to true if it is in newPtrInAreas
                delete propInAreas[areaId];
            }
        }
        // Then set the property to false for no longer relevant areas
        for (areaId in newPtrInAreas) {
            if (!(areaId in propInAreas)) {
                if (!newPtrInAreas[areaId].hasBeenDestroyed()) {
                    this.setPtrInArea(newPtrInAreas[areaId], true, drag)
                }
            }
        }
        if (drag) {
            this.dragInAreas = newPtrInAreas;
        } else {
            this.pointerInAreas = newPtrInAreas;
        }
        // Clear the other property
        var nonPropInAreas = !drag? this.dragInAreas: this.pointerInAreas;
        for (areaId in nonPropInAreas) {
            if (!nonPropInAreas[areaId].hasBeenDestroyed()) {
                this.setPtrInArea(nonPropInAreas[areaId], false, !drag)
            }
            delete nonPropInAreas[areaId];
        }

        this.setAreasUnderPointer(areasUnderPointerValue);
    }

    reupdatePointerInArea(): void {
        var overlappingAreas = gDomEvent.getOverlappingAreas(this.lastMousePosition[0], this.lastMousePosition[1]);

        this.updatePointerInArea(overlappingAreas, this.dragging);
    }

    setPtrInArea(area: CoreArea, status: boolean, drag: boolean): void {
        var nextValue = status? constTrueOS: constFalseOS;

        area.updateParam(drag? "dragInArea": "pointerInArea", nextValue);
    }

    // Clears drag/pointerInArea for a given area and removes it from the internal
    // administration, so that if the area is under the pointer after the next
    // update, it will be set to true.
    clearPtrInArea(area: CoreArea): void {
        area.updateParam("dragInArea", false);
        area.updateParam("pointerInArea", false);
        delete this.dragInAreas[area.areaId];
        delete this.pointerInAreas[area.areaId];
        globalReupdatePointerInAreaTask.schedule();
    }

    setAreasUnderPointer(areaList: ElementReference[]): void {
        if (typeof(globalAreasUnderPointerNodeIndex) !== "undefined") {
            var globalAreasUnderPointerNode = <EvaluationStore>
                    globalEvaluationNodes[globalAreasUnderPointerNodeIndex];
            this.domEventAreasUnderPointerResult.value = areaList;
            globalAreasUnderPointerNode.set(this.domEventAreasUnderPointerResult);
        }
    }

    addEvent(event: QueuedEvent): void {
        function isContinuous(evtType: string): boolean {
            return evtType === "mousemove" || evtType === "pointermove" ||
                   evtType === "touchmove" || evtType === "wheel";
        }
        function identicalEvent(e1: QueuedEvent, e2: QueuedEvent): boolean {
            return e1.type === e2.type ||
                   ((e1.type === "mousemove" || e1.type === "MouseMove" || e1.type === "pointermove" || e1.type === "touchmove") &&
                    (e2.type === "mousemove" || e2.type === "MouseMove" || e2.type === "pointermove" || e2.type === "touchmove"));
        }
        if (isContinuous(event.type)) {
            // Keep only the last of a sequence of continuous events: mouse
            // move, pointer move, touch move and wheel
            for (let i = 0; i < this.eventQueue.length; i++) {
                const evt = this.eventQueue[i];
                if (identicalEvent(evt, event)) {
                    this.eventQueue.splice(i, 1);
                    if (logEventHistory && logEventComments) {
                        gDomEvent.eventHistory.push({
                            type: "comment",
                            comment: "remove identical event",
                            index: i
                        });
                    }
                    break;
                }
            }
        }
        this.eventQueue.push(event);
        globalNextQueuedEvent.schedule();
    }

    cancelEventsOfType(type: string): void {
        this.eventQueue = this.eventQueue.filter(qEvt => qEvt.type !== type);
    }

    clear(): void {
        this.eventQueue = [];
    }

    abortEvent(debugAbortId: string, defaultAbort: boolean): boolean {
        var currentEvent: QueuedEvent = this.eventQueue[0];

        function isKeyEvent(event: any): boolean {
            return event.type === "keydown" || event.type === "keypress" || event.type === "keyup";
        }

        if (currentEvent === undefined) {
            return false;
        }
        if (defaultAbort && isKeyEvent(currentEvent.event)) {
            // Only explicit aborts for key events
            return false;
        }
        if (currentEvent.abortPropagation === undefined) {
            currentEvent.abortPropagation = debugAbortId;
            currentEvent.recipients = ["end"];
            return true;
        }
        return false;
    }
}

var globalEventQueue: EventQueue = new EventQueue();
var lastEventType: string = ""; // debugging!!!

function queueEvent(
    event: any, // The original DOMEvent
    message: EventObject,
    subTypes: { value: string; areas: CoreArea[]; }[],
    recipients: (string|CoreArea)[],
    pointer: MondriaPointer,
    overlappingAreas: OverlappingAreaList,
    dragging: any[]|FileList,
    buttonStateChanges: ButtonStateChange[],
    changes: {[attr: string]: any},
    checkExistence: boolean,
    touch: Touch,
    clickableElement: Element): void
{
    // Debugging the js code that calls this.
    assert(event, "event must be defined");
    assert(message === undefined || (message instanceof Object && !(message instanceof Array)), "debugging");
    assert(subTypes === undefined || subTypes instanceof Array, "debugging");
    assert(recipients instanceof Array, "debugging");
    assert(pointer === undefined || pointer instanceof MondriaPointer, "debugging");
    assert(dragging === undefined || dragging instanceof Array || dragging instanceof FileList, "debugging");
    assert(buttonStateChanges === undefined || buttonStateChanges instanceof Array, "debugging");

    if (debugLogEvent("message")) {
        console.log("queue event", event.type, cdlify(message));
    }
    lastEventType = event.type;

    globalEventQueue.addEvent(new QueuedEvent(
        event.timeStamp,
        event,
        event.type,
        event.type === "mouseup",
        message,
        subTypes,
        recipients,
        buttonStateChanges,
        pointer,
        dragging,
        overlappingAreas,
        changes,
        checkExistence,
        touch,
        clickableElement
    ));
}

function queueCancelEventsOfType(type: string): void {
    globalEventQueue.cancelEventsOfType(type);
}

function clearEventQueue(): void {
    globalEventQueue.clear();
}

function abortMessagePropagation(debugAbortId: string, defaultAbort: boolean): void {
    if (globalEventQueue.abortEvent(debugAbortId, defaultAbort)) {
        if (debugLogEvent("message")) {
            console.log("event propagation aborted by", debugAbortId);
        }
    }
}

function postInputParamChangeEvent(recipient: CoreArea, checkExistence: boolean,
                                   changes: {[attr: string]: any},
                                   clickableElement: Element): void
{
    var message: EventObject = {
        type: ["InputChange"],
        time: [Date.now()]
    };
    var overlappingAreas = [{recipient: recipient, insideVisibleRegion: true, relX: 0, relY: 0}];

    gDomEvent.recordComment("inputChange");
    queueEvent(new ImpersonatedDomEvent("inputchange"), message, undefined,
              [recipient], undefined, overlappingAreas, constEmptyOS, undefined,
              changes, checkExistence, undefined, clickableElement);
}
