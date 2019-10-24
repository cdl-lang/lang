// Copyright 2019 Yoav Seginer.
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

// [tempAppStateConnectionInfo] returns an a/v whose properties describe
//  the app-state persistence connection:
//    errorId: 0 - no error, otherwise - an error occurred
//    errorMessage - a string (not too informative, currently)
//    serverAddress - string
//    serverPort - integer
//    protocol - "ws" or "wss"
//    user - string
//    appName - string
//
class EvaluationAppStateConnectionInfo extends
          EvaluationFunctionApplication implements AppStateInfoConsumer {

    appStateRegId: number;

    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);
        this.result.value = [gAppStateMgr.getAppStateInfo()];
        this.appStateRegId =
            gAppStateMgr.appStateInfoRegister(this, "appState");
    }

    destroy(): void {
        if (typeof(this.appStateRegId) !== "undefined") {
            gAppStateMgr.appStateInfoUnregister(this.appStateRegId);
            this.appStateRegId = undefined;
        }
        super.destroy();
    }

    isConstant(): boolean {
        return false;
    }
              
    eval(): boolean {
        return false;
    }

    debugName(): string {
        return "tempAppStateConnectionInfo";
    }

    appStateInfoUpdate(ident: string, appStateInfo: AppStateInfo): void {
        this.result.value = [shallowCopy(appStateInfo)];
        this.informAllWatchers();
    }
}
tempAppStateConnectionInfo.classConstructor = EvaluationAppStateConnectionInfo;

class PositionChange {
    origin: string[] = [gWriteAction];
    values: any[] = [];

    constructor(public index: number,
                public origLength: number,
                public newLength: number,
                public sub: {[attr: string]: PositionChangeTracker} = undefined) {
    }

    clone(): PositionChange {
        var clone: PositionChange =
            new PositionChange(this.index, this.origLength, this.newLength);

        if (this.sub !== undefined) {
            clone.sub = {};
            for (var attr in this.sub) {
                clone.sub[attr] = this.sub[attr].clone();
            }
        }
        clone.origin = this.origin.slice(0);
        clone.values = this.values.slice(0);
        return clone;
    }

    markProjection(attr: string): PositionChangeTracker {
        assert(this.origLength <= 1 && this.newLength === 1, "cannot write to multiple positions");
        this.origLength = 1;
        if (this.sub === undefined) {
            this.sub = {};
        }
        if (!(attr in this.sub)) {
            this.sub[attr] = new PositionChangeTracker();
        }
        return this.sub[attr];
    }

    /**
     * Checks if the new value is compatible with all previously written values
     * 
     * @memberOf PositionChange
     */
    allCompatible(newValue: any, writeMode: WriteMode): boolean {
        switch (writeMode) {
          case WriteMode.replace:
            return this.values.every(function(value: any): boolean {
                return objectEqual(value, newValue);
            });
          case WriteMode.merge:
            return this.values.every(function(value: any): boolean {
                return objectCompatible(value, newValue);
            });
        }
        return false;
    }
}
type PositionChanges = PositionChange[];

class PositionChangeTracker {
    /** Sorted list of changes to the os */
    changes: PositionChanges = [];

    clone(): PositionChangeTracker {
        var clone: PositionChangeTracker = new PositionChangeTracker();

        clone.changes = this.changes.map(function(change: PositionChange): PositionChange {
            return change.clone();
        })
        return clone;
    }

    markShift(index: number, origLength: number, newValue: any, allowReuse: boolean, writeMode: WriteMode): PositionChange {
        var ndx: number = binarySearch(this.changes, index, function(a: PositionChange, b: number): number {
            return a.index - b;
        });

        if (ndx < 0) {
            // posPtr.index was not in this.changes 
            var beforeNdx: number = -(ndx + 2);
            var afterNdx: number = -(ndx + 1);
            if (beforeNdx >= 0 && this.changes[beforeNdx].index + this.changes[beforeNdx].origLength > index) {
                console.log("cannot change: overwriting another write (1):",
                            this.changes[beforeNdx].origin.join(","));
                return undefined;
            }
            if (afterNdx < this.changes.length && index + origLength > this.changes[afterNdx].index) {
                console.log("cannot change: overwriting another write (2)",
                            this.changes[afterNdx].origin.join(","));
                return undefined;
            }
            var change = new PositionChange(index, origLength, newValue.length);
            change.values.push(newValue);
            this.changes.splice(afterNdx, 0, change);
            return change;
        } else {
            // posPtr.index was in this.changes
            var change: PositionChange = this.changes[ndx];
            if (allowReuse) {
                if (origLength !== change.origLength || newValue.length !== change.newLength) {
                    console.log("different lengths:", change.origin.join(","));
                    return undefined;
                }
                change.origin.push(gWriteAction);
            } else if (!change.allCompatible(newValue, writeMode)) {
                // Multiple writes to this location cannot be honored. 
                console.log("multiple writes:", change.origin.join(","));
                return undefined;
            } else {
                change.values.push(newValue);
            }
            return change;
        }
    }

    getIndex(origIndex: number): number {
        var offset: number = 0;

        for (var i = 0; i < this.changes.length && this.changes[i].index < origIndex; i++) {
            offset += this.changes[i].newLength - this.changes[i].origLength;
        }
        return origIndex + offset;
    }

    clear(): void {
        this.changes = [];
    }

    isClean(): boolean {
        return this.changes.length === 0;
    }
}

class EvaluationStore extends EvaluationNode implements Latchable {
    prototype: StorageNode;

    // The last update, and the next value on eval.
    lastUpdate: Result = new Result(undefined);

    // Value written to this node, which is latched until the scheduler allows
    // it to replace the actual value.
    latchedValue: Result = undefined;
    // From Latchable
    isLatched: boolean = false;

    // Source points at the source of the data in this node. If position is
    // defined, the data comes from that/those specific position(s).
    // This is used for linking to a data element in an area set,
    // or to function arguments.
    source: EvaluationNode = undefined;
    position: number[] = undefined;

    // positionValidator: PositionValidator;
    positionChangeTracker: PositionChangeTracker = new PositionChangeTracker();

    dataSourceFunctionApplication: DataSourceFunctionApplication;
    dataSourceChanged: boolean;
    dataSourceInput: DataSourceComposable;

    constructor(prototype: StorageNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.inputHasChanged = false;
        this.result.value = constEmptyOS;
        this.dataSourceAware = true;
        this.dataSourceResultMode = true;
        if ("schedulingError" in prototype) {
            this.inputs = [];
        }
    }

    destroy(): void {
        if (this.dataSourceFunctionApplication !== undefined) {
            this.dataSourceFunctionApplication.removeResultReceiver(this);
            this.dataSourceFunctionApplication = undefined;
        }
        super.destroy();
    }

    set(value: Result): boolean {
        if (value === undefined) {
            if (this.dataSourceFunctionApplication !== undefined) {
                this.dataSourceFunctionApplication.removeResultReceiver(this);
                this.dataSourceFunctionApplication = undefined;
            }
            if (this.dataSourceInput !== undefined) {
                this.dataSourceInput = undefined;
                this.dataSourceChanged = true;
                this.markAsChanged();
            }
            if (this.lastUpdate.value !== undefined) {
                this.lastUpdate.set(undefined);
                this.markAsChanged();
                return true;
            }
            return this.dataSourceChanged;
        } else {
            if (!this.lastUpdate.equal(value)) {
                this.lastUpdate.copy(value);
                if (value.dataSource !== this.result.dataSource) {
                    if (this.dataSourceFunctionApplication !== undefined) {
                        this.dataSourceFunctionApplication.removeResultReceiver(this);
                        this.dataSourceFunctionApplication = undefined;
                    }
                    if ("dataSource" in value) {
                        this.dataSourceFunctionApplication =
                            value.dataSource.applyAggregateFunction("changecount", this);
                        if (this.isActive() && !this.dataSourceResultMode) {
                            this.dataSourceFunctionApplication.activate();
                        }
                    }
                    this.dataSourceInput = value.dataSource;
                    this.dataSourceChanged = true;
                }
                this.markAsChanged();
                return true;
            }
        }
        return false;
    }

    pushToAreaSetContent(value: any, identifiers: any[],
                         subIdentifiers: any[]): void
    {
        this.lastUpdate.value[0].areaSetContent =
            this.lastUpdate.value[0].areaSetContent.concat(value);
        if(identifiers !== undefined || subIdentifiers !== undefined)
            this.lastUpdate.addSubIdentifiersUnderAttr("areaSetContent",
                                                       identifiers,
                                                       subIdentifiers);
        this.markAsChanged();
    }

    pushToPositions(position: number): void {
        this.position.push(position);
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        if (this.isActive() && this.dataSourceInput !== undefined) {
            if (dataSourceResultMode && !this.dataSourceResultMode) {
                this.dataSourceFunctionApplication.deactivate();
                if (this.result !== undefined) {
                    this.result.value = emptyDataSourceResult;
                }
                this.dataSourceInput.stopIndexerMonitoring();
            } else if (!dataSourceResultMode && this.dataSourceResultMode) {
                this.dataSourceFunctionApplication.activate();
                this.markAsChanged();
            }
        }
        this.dataSourceResultMode = dataSourceResultMode;
    }

    setSource(source: EvaluationNode, position: number): void {
        this.source = source;
        this.position = [position];
    }

    // to be used when 'position' is an array of positions
    setSources(source: EvaluationNode, position: number[]): void {
        this.source = source;
        this.position = position === undefined ? undefined : position.slice(0);
    }
    
    updateInput(i: any, result: Result): void {
        this.set(this.extractResult(result));
    }

    activateInputs(): void {
        if (this.dataSourceFunctionApplication !== undefined &&
              !this.dataSourceResultMode) {
            this.dataSourceFunctionApplication.activate();
        }
    }

    deactivateInputs(): void {
        if (this.dataSourceFunctionApplication !== undefined &&
              !this.dataSourceResultMode) {
            this.dataSourceFunctionApplication.deactivate();
        }
        if (this.dataSourceInput !== undefined) {
            this.dataSourceInput.stopIndexerMonitoring();
        }
    }

    newDataSourceResult(v: any[]): void {
        this.dataSourceChanged = true;
        if (!this.dataSourceResultMode) {
            this.markAsChanged();
        }
    }

    reextractData(): void {
        assert(!this.dataSourceResultMode, "should have been disabled");
        this.markAsChanged();
    }

    extractDataSourceResult(): boolean {
        var oldValue: any[] = this.result.value;
        var res: any[] = this.dataSourceInput.extractData(
            MinimumResultRequirements.compound, undefined);
        var hadDataSource: boolean = "dataSource" in this.result;

        // console.log(this.prototype.idStr(),
        //             "defunParam.extractDataSourceResult", "#" + res.length);
        this.result.value = res;
        if (hadDataSource) {
            delete this.result.dataSource;
        }
        return hadDataSource || !valueEqual(oldValue, res);
    }

    isConstant(): boolean {
        return false;
    }

    eval(): boolean {
        if (this.dataSourceFunctionApplication !== undefined) {
            var change = this.dataSourceChanged;
            this.dataSourceChanged = false;
            if (debugWrites && this.prototype.localToDefun === 0) {
                console.log("write eval", this.prototype.idStr(),
                            this.prototype.path.toString());
            }
            if (!this.dataSourceResultMode) {
                if (this.lastUpdate.value !== emptyDataSourceResult) {
                    if (!this.result.equal(this.lastUpdate)) {
                        change = true;
                        this.result.copy(this.lastUpdate);
                    }
                } else if (this.extractDataSourceResult()) {
                    change = true;
                }
                return change;
            } else if (change) {
                this.result.copy(this.lastUpdate);
                return true;
            }
            return false;
        }
        if (this.result.equal(this.lastUpdate)) {
            return false;
        }
        if (debugWrites && debugWritesEval && this.prototype.localToDefun === 0) {
            var area: CoreArea = this.local.getEvaluationArea();
            var areaId: string = area === undefined? "global": "@"+area.areaId;
            console.log("write eval", areaId, this.prototype.idStr(),
                        this.prototype.path.toString(),
                        ":=", cdlifyLim(this.lastUpdate.value, 200));
        }
        this.result.copy(this.lastUpdate);
        return true;
    }

    // Like markAsChanged, but the node is scheduled on the latch queue, where
    // it will be executed once the normal queue is finished. Note that inactive
    // nodes are also scheduled there.
    latch(): void {
        this.inputHasChanged = true;
        evaluationQueue.latch(this);
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (positions !== undefined &&
            (positions.length !== 1 || positions[0].index !== 0)) {
            this.reportDeadEndWrite(reportDeadEnd,
                                    "wrong position for EvaluationStore");
            return false;
        }
        if (this.source !== undefined) {
            // Can only write through to a single value. Anything else is an
            // error of the caller.
            var sub: DataPosition[] =
                this.position === undefined? positions:
                positions === undefined?
                [new DataPosition(this.position[0], 1)]:
                [new DataPosition(this.position[0], 1, positions[0].path, positions[0].sub)];
            return this.source.write(result, mode, sub, reportDeadEnd);
        } else {
            var topWrite: boolean = positions === undefined || positions[0].path === undefined;
            var curValue: any = this.latchedValue !== undefined?
                                this.latchedValue: this.lastUpdate;
            var newValue: any = determineWrite(curValue.value, result, mode, positions, new PositionChangeTracker());
            if (debugWrites && newValue !== curValue.value) {
                var cv: any = debugWritesString? cdlify(curValue): curValue;
                var nv: any = debugWritesString? cdlify(newValue): newValue;
                gSimpleLog.log("replaced", "@" + this.local.getOwnId() + ":" + this.prototype.path.join("."), cv);
                gSimpleLog.log("by", nv);
            }
            if (!valueEqual(newValue, curValue.value) ||
                  (topWrite &&
                   (this.latchedValue === undefined ||
                    !this.latchedValue.equalLabels(result)))) {
                this.latchedValue = new Result(newValue);
                if (topWrite) {
                    this.latchedValue.copyLabels(result);
                }
                this.latch();
            }
            return true;
        }
    }

    // Release is called when all latched nodes are being unlatched, so it only
    // needs to be implemented by those nodes that call latch: Store and Write.
    release(): void {
        if (!this.latchedValue.equal(this.lastUpdate)) {
            if (debugWrites && debugWritesEval) {
                console.log("unlatch", this.prototype.idStr(),
                            cdlify(this.lastUpdate), "=>",
                            cdlify(this.latchedValue));
            }
            this.lastUpdate = this.latchedValue;
            this.latchedValue = undefined;
            this.markAsChanged();
        }
        this.latchedValue = undefined;
        this.positionChangeTracker.clear();
    }

    extractResult(r: Result): Result {
        return r === undefined? undefined:
            this.position === undefined? r: r.subs(this.position);
    }

    debugName(): string {
        return "store";
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        var prototype = <StorageNode> this.prototype;

        super.specificExplanation(explanation, classDebugInfo);
        explanation.path = prototype.path;
        if (this.latchedValue !== undefined) {
            explanation.latchedValue = getDeOSedValue(this.latchedValue.value);
        }
        return explanation;
    }

    toFullString(): string {
        return "[" + pathToQueryString(this.prototype.path, "_") +
            ", [me]] = " + cdlifyLim(this.result.value, 80);
    }

    // querySourceId(): number {
    //     return this.source !== undefined && this.position === undefined?
    //            this.source.querySourceId(this): this.watcherId;
    // }

    multiQuerySourceIds(): number[] {
        return this.source !== undefined && this.position === undefined?
               this.source.multiQuerySourceIds(): [this.watcherId];
    }
}

/// [message] and [myMessage] return [] or an array with one value of type
/// EventObject. 
type EventFileList = {
    name: string[];
    fullName: string[];
    type: string[];
    size: number[];
    lastModified: number[];
    lastModifiedDate: any[];
    fileHandle: any[];
}[];
type EventObject = {
    type: string[];
    time: number[];
    subType?: string[];
    modifier?: string[];
    absX?: number[];
    absY?: number[];
    deltaX?: number[];
    deltaY?: number[];
    deltaZ?: number[];
    deltaMode?: string[];
    key?: string[];
    char?: string[];
    repeat?: boolean[];
    location?: string[];
    recipient?: (string|ElementReference)[];
    handledBy?: (string|ElementReference)[];
    reason?: string[];
    files?: EventFileList;
    touchID?: number[];
};

class EvaluationMessageQueue extends EvaluationStore {

    static emptyMessage: Result = new Result(constEmptyOS);

    constructor(prototype: StorageNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.dataSourceResultMode = false;
    }

    // A FIFO queue of global messages
    messageQueue: Result[] = [];

    recipientsOfLastMessage: any[];

    empty(): boolean {
        return this.messageQueue.length === 0;
    }

    nextMessage(): boolean {
        var message: Result = this.messageQueue.shift();;

        if (debugWrites || debugLogEvent("message")) {
            console.log("set global message", cdlify(message.value));
        }
        for (var i = 0; i < message.value.length; i++) {
            // Map list of recipients to areas
            var messageRecipientList = !("recipient" in message.value[i])? []:
                                       ensureOS(message.value[i].recipient);
            var recipients: any[] = [];
            var recipientIds: any = {};
            
            for (var j = 0; j < messageRecipientList.length; j++) {
                var recip = messageRecipientList[j];
                if (recip instanceof ElementReference) {
                    if (!(recip.element in recipientIds)) {
                        recipients.push(allAreaMonitor.getAreaById(recip.getElement()));
                        recipientIds[recip.element] = true;
                    }
                } else {
                    recipients.push(recip);
                }
            }
            queueEvent(new ImpersonatedDomEvent("message"), message.value[i],
                       undefined, recipients, undefined, undefined, [],
                       undefined, undefined, false, undefined, undefined);
        }
        return this.messageQueue.length === 0;
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        if (positions === undefined ||
              (positions.length === 1 &&
               positions[0].index === 0 && positions[0].path === undefined)) {
            var r: Result = new Result(undefined);
            r.copy(result);
            if (debugWrites) {
                console.log("write to [message]", cdlify(result.value));
            }
            this.messageQueue.push(r);
            globalNextMessageTask.schedule();
            return true;
        } else {
            this.reportDeadEndWrite(reportDeadEnd, "in write to message queue");
            return false;
        }               
    }
}

var browserDependentCursorNames: {[genericName: string]: string[]} = {
    grab: ["-webkit-grab", "-moz-grab"],
    grabbing: ["-webkit-grabbing", "-moz-grabbing"]
};

class EvaluationPointerStore extends EvaluationStore implements TimeSensitive {
    latchedValue: any = constEmptyOS;
    isOnTimeQueue: boolean = false;

    static writeObjType: ValueTypeDescription = 
        vtd("av", { display: vtd("av", { image: vtd("string") }) });

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var pct = new PositionChangeTracker();
        var newValue: any = determineWrite([{}], result, mode, positions, pct);

        // Test for single value disabled
        if (EvaluationPointerStore.writeObjType.matches(newValue)) {
            if (debugWrites) {
                console.log("write to [{display: {image: _}}, [pointer]]", cdlify(result.value));
            }
            this.latchedValue = newValue[0].display[0].image;
            evaluationQueue.addTimeSensitiveNode(this);
            return true;
        } else {
            return super.write(result, mode, positions, reportDeadEnd);
        }
    }

    public endOfEvaluationCycleNotification(cycle: number): void {
        var newImageName: any = this.latchedValue;

        this.result.value[0].display[0].image = ensureOS(newImageName);
        if (newImageName instanceof Array) {
            newImageName = newImageName[0];
        }
        if (typeof(newImageName) === "string") {
            if (debugWrites) {
                Utilities.log("writing " + newImageName +
                              " to pointer.display.image");
            }
            gDomEvent.setPointerImage(newImageName);
            if (newImageName in browserDependentCursorNames) {
                var alternatives = browserDependentCursorNames[newImageName];
                for (var i: number = 0; i < alternatives.length; i++) {
                    gDomEvent.setPointerImage(alternatives[i]);
                }
            }
        } else {
            Utilities.warn("non string for mouse image");
        }
    }

    public preWriteNotification(cycle: number): void {
    }
}

class EvaluationDebugBreak extends EvaluationStore {
    constructor(prototype: StorageNode, local: EvaluationEnvironment) {
        super(prototype, local);
        this.dataSourceResultMode = false;
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        setGDebugBreak();
        return true;
    }
}

// A write to this affects the input element.
class EvaluationParam extends EvaluationStore {
    areaId: string;

    constructor(prototype: StorageNode, areaId: string, local: EvaluationEnvironment) {
        super(prototype, local);
        this.areaId = areaId;
        this.result.value = [{
            pointerInArea: [false]
        }];
        this.lastUpdate.copy(this.result);
    }

    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var self: EvaluationParam = this;
        var area: CoreArea = allAreaMonitor.getAreaById(this.areaId);

        function updateInputAttr(attrib: string, value: any, endValue: any): boolean {
            var curValue: any = self.latchedValue !== undefined?
                self.latchedValue.value[0]: self.lastUpdate.value[0];
            var update: any = mergeCopyValue({input: value}, curValue, undefined, undefined);

            if(valueEqual(curValue, update))
                return true;
            if (area.setInputState(attrib, singleton(endValue))) {
                self.latchedValue = new Result(update);
                self.latch();
                return true;
            }
            return false;
        }

        function wrapPathAttr(path: string[], pos: number, terminal: any): any {
            var queryObject: any = terminal;

            for (var i: number = path.length - 1; i >= pos; i--) {
                var attr: string = path[i];
                var tmp: any = {};
                tmp[attr] = queryObject;
                queryObject = [tmp];
            }
            return queryObject;
        }

        // if the write requires the insertion of a new element and this
        // area was created for an identifier, ad the element with that
        // identifier (otherwise, don't add anything).
        function addIdentifierToPos(positions: DataPosition[]): DataPosition[] {
            if(positions.length !== 1 || positions[0].index !== 0 ||
               positions[0].length !== 0)
                return [];
            if(!(area.controller instanceof SetChildController) ||
               !(<SetChildController>area.controller).useIdentity)
                return []; // not created for an identifier
            var identifier: any = area.param.attr;
            return [positions[0].copyWithAddedIdentifier(identifier)];
        }
        
        // For writes to param:input, this functions unwraps the path in
        // 'positions', and then possible AVs in 'result', and writes
        // the terminal value to the appropriate source.
        //   Writes to param:areaSetContent: are redirected towards the source,
        // with positions modified to indicated the position in the area set.
        function unwrapPositions(result: Result, path: string[], positions: DataPosition[]): boolean {
            if (positions === undefined ||
                  (path.length === 1 && path[0] === "areaSetContent")) {
                switch (path[0]) {
                  case "input":
                    return updateInputAttr(path[1], wrapPathAttr(path, 1, ensureOS(result.value)), result.value);
                  case "areaSetContent":
                    var sub: DataPosition[];
                    if(positions === undefined)
                        sub = self.position.map(n => new DataPosition(n, 1));
                    else {
                        sub = [];
                        for(var i = 0 ; i < positions.length ; ++i) {
                            for(var j = 0 ; j < positions[i].length ; ++j) {
                                var newPos: DataPosition = positions[i].copy();
                                newPos.length = 1;
                                newPos.index =
                                    self.position[positions[i].index + j];
                                sub.push(newPos);
                            }
                        }
                        if(sub.length == 0)
                            // try insertion by identifier
                            sub = addIdentifierToPos(positions);
                        if(sub.length == 0) { // still empty
                            self.reportDeadEndWrite(
                                reportDeadEnd,
                                "in write to areaSetContent " + self.local.getOwnId());
                            return false;
                        }
                    }
                    return self.source.write(result, mode, sub, reportDeadEnd);
                default:
                    self.reportDeadEndWrite(reportDeadEnd,
                                            "in write to param in " +
                                            self.local.getOwnId());
                    return false;
                }
            } else if (positions !== undefined && positions.length === 1 &&
                  positions[0].index === 0 && positions[0].path !== undefined) {
                return unwrapPositions(
                    result, path.concat(positions[0].path[0]),
                    positions[0].sub);
            } else if (positions !== undefined && positions.length === 1 &&
                       positions[0].index === 0 && positions[0].path === undefined) {
                var v: any = getDeOSedValue(result.value);
                if (!(v instanceof Array) && isAV(v)) {
                    self.lastUpdate.value[0] = shallowCopy(self.lastUpdate.value[0]);
                    var success: boolean = true;
                    
                    for (var attrib in v) {
                        var attrResult: Result = result.popAttr(attrib);
                        if(!unwrapPositions(attrResult, path.concat(attrib),
                                            undefined))
                            success = false;
                    }
                    return success;
                } else {
                    return unwrapPositions(result.value, path, undefined);
                }
            } else {
                self.reportDeadEndWrite(reportDeadEnd,
                                        "in write to param in " +
                                        self.local.getOwnId());
                return false;
            }
        }

        var success: boolean = unwrapPositions(result, [], positions);

        if (debugWrites) {
            console.log("write to param", cdlify(result.value));
        }

        return success;
    }

    updateDataElementIds(dataElementIds: number[]): void {
        if ("dataSource" in this.lastUpdate) {
            (<DataSourceQueryByElementId> this.lastUpdate.dataSource).
                updateDataElements(dataElementIds);
        }
        if ("dataSource" in this.result) {
            (<DataSourceQueryByElementId> this.result.dataSource).
                updateDataElements(dataElementIds);
        }
    }
}

// Is a normal store, but
// - allows informing the body it's a constant, which can then propagate to the
//   top node (when the whole body is constant, it can be removed; only the
//   result needs to be stored).
// - propagates activation and (N)DSA to its source
class EvaluationDefunParameter extends EvaluationStore {
    constant: boolean = false;

    constructor(prototype: StorageNode, local: EvaluationEnvironment) {
        super(prototype, local);
        var src: SourcePointer = local.getSource(prototype);
        this.setSource(src.node, src.position);
    }

    isConstant(): boolean {
        return this.constant;
    }

    setDataSourceResultMode(dataSourceResultMode: boolean): void {
        var wasInDataSourceResultMode: boolean = this.dataSourceResultMode;

        super.setDataSourceResultMode(dataSourceResultMode);
        if (this.dataSourceResultMode !== wasInDataSourceResultMode && this.isActive()) {
            if (this.dataSourceResultMode) {
                this.source.activeWatcherBecomesDataSourceAware(this);
            } else {
                this.source.activeWatcherNoLongerIsDataSourceAware(this);
            }
        }
    }

    setSource(source: EvaluationNode, position: number): void {
        this.source = source;
        this.position = [position];
        this.constant = source.isConstant();
        if (this.constant) {
            this.set(source.result);
        }
    }
    
    activateInputs(): void {
        super.activateInputs();
        this.source.activate(this, this.dataSourceResultMode);
    }

    deactivateInputs(): void {
        this.source.deactivate(this, this.dataSourceResultMode);
        super.deactivateInputs();
    }
}

var gAppStateChangeList: {
    areaId: string;
    path: string[];
    value: any;
}[] = [];

class EvaluationWrite extends EvaluationNode implements Latchable {
    prototype: WritableNode;
    lastUpdate: any;

    valueOrigin: string; // "init" / "write" / "remote" / undefined
    initialValue: EvaluationNode = undefined;
    latchedValue: any = undefined;
    isLatched: boolean = false;
    positionChangeTracker: PositionChangeTracker = new PositionChangeTracker();

    // this identifier represents the persistent-area-id and the path within
    // the area's data-object
    appStateIdentifier: AppStateIdentifier = undefined;

    constructor(prototype: WritableNode, local: EvaluationEnvironment) {
        super(prototype, local);
        if ("schedulingError" in prototype) {
            this.inputs = [];
        }
    }

    setInitialValue(initialValue: FunctionNode, local: EvaluationEnvironment,
                    templateId: number, indexId: number, path: string[]): void
    {
        var persistenceValue: any = undefined;

        this.appStateIdentifier = templateId === undefined? undefined:
            new AppStateIdentifier(templateId, indexId, String(path));

        // an undefined appStateIdentifier indicates a local writable variable,
        // which has no business with gAppStateMgr; otherwise, register with
        // gAppStateMgr for updates to this identifier's value;
        // updates result in calls to '.remoteUpdate()' defined below
        if (this.appStateIdentifier !== undefined) {
            gAppStateMgr.register(this.appStateIdentifier, this);
            // if there's already a value for this identifier get it..
            persistenceValue = gAppStateMgr.get(this.appStateIdentifier);
            if (persistenceValue !== xdrDeleteIdent) {
                this.result.remoteStatus = "waiting";
            } else {
                persistenceValue = undefined;
                this.result.remoteStatus = "local";
            }
        } else {
            this.result.remoteStatus = "local";
        }

        // .. and use it for the initialization (overriding this.initialValue)
        if (persistenceValue !== undefined) {
            this.result.value = persistenceValue;
            this.result.remoteStatus = "remote";
            this.valueOrigin = "remote";
        } else if (initialValue !== undefined) {
            // Construct initial value expression if necessary and copy result
            this.registerInitialValue(initialValue, local);
        } else {
            this.inputHasChanged = false;
        }
        this.lastUpdate = this.result.value;
    }

    /// This function makes the write value a live (copy of the initial)
    /// expression again. It is also called by the appState manager when the
    /// value was not present on the server after logging in, i.e. when the
    /// persisted app state assumed a live expression.
    reinitialize(): void {
        var lastValue = this.result.value;

        this.lastUpdate = undefined;
        this.latchedValue = undefined;
        this.isLatched = false;
        this.valueOrigin = undefined;
        this.registerInitialValue(this.prototype.initialValue, this.local);
        if (!valueEqual(lastValue, this.lastUpdate)) {
            this.markAsChanged();
        }
        // This function can be called outside of the evaluation loop, and
        // therefore must force the content task to run.
        globalContentTask.schedule();
    }

    destroy(): void {
        if (this.appStateIdentifier !== undefined) {
            // no longer interested in remote-update notifications..
            gAppStateMgr.unregister(this.appStateIdentifier);
        }
        this.unregisterInitialValue();
        super.destroy();
    }

    activateInputs(): void {
        if (this.initialValue !== undefined) {
            this.initialValue.activate(this, false);
        }
    }

    deactivateInputs(): void {
        if (this.initialValue !== undefined) {
            this.initialValue.deactivate(this, false);
        }
    }

    // Determines and sets the result of the write operation without altering
    // any existing value.
    write(result: Result, mode: WriteMode, positions: DataPosition[], reportDeadEnd: boolean): boolean {
        var newValue: any;
        var curValue: any = this.latchedValue !== undefined?
                            this.latchedValue: this.lastUpdate;
        var oldPct: PositionChangeTracker = this.positionChangeTracker.clone();

        // terminate the live update (if still alive) and determine
        // the new value
        this.unregisterInitialValue();
        newValue = determineWrite(curValue, result, mode, positions, this.positionChangeTracker);
        if (debugWrites && newValue !== curValue) {
            var cv: any = debugWritesString? cdlify(curValue): curValue;
            var nv: any = debugWritesString? cdlify(newValue): newValue;
            gSimpleLog.log("replaced", "@" + this.local.getOwnId() + ":" + this.prototype.path.join("."), cv);
            gSimpleLog.log("by", nv);
        }
        if (!valueEqual(newValue, curValue)) {
            this.latchedValue = newValue;
            this.valueOrigin = "write";
            this.latch();
        } else {
            this.positionChangeTracker = oldPct;
        }
        return true;
    }

    latch(): void {
        this.inputHasChanged = true;
        evaluationQueue.latch(this);
    }

    release(): void {
        if (!valueEqual(this.latchedValue, this.lastUpdate)) {
            if (debugWrites && debugWritesEval) {
                console.log("unlatch", this.prototype.idStr(),
                            cdlify(this.lastUpdate), "=>",
                            cdlify(this.latchedValue));
            }
            this.lastUpdate = this.latchedValue;
            this.latchedValue = undefined;
            this.markAsChanged();
            gAppStateChangeList.push({
                areaId: this.local.getOwnId(),
                path: this.prototype.path,
                value: this.lastUpdate
            });
        }
        this.latchedValue = undefined;
        this.positionChangeTracker.clear();
    }

    isConstant(): boolean {
        return false;
    }

    updateInput(pos: any, result: Result): void {
        if (this.latchedValue === undefined && !valueEqual(result.value, this.lastUpdate)) {
            this.lastUpdate = result.value;
            this.markAsChanged();
        }
    }

    /// Unregisters the write's initial/live value and with it the live update.
    /// Called upon a remote update or a (local) write.
    unregisterInitialValue(): void {
        if (this.initialValue !== undefined) {
            this.initialValue.removeWatcher(this, true, false);
            this.initialValue = undefined;
            if ("schedulingError" in this.prototype) {
                this.inputs.length = 0;
            }
        }
    }

    eval(): boolean {
        if (debugWrites && debugWritesEval && this.prototype.localToDefun === 0) {
            var area: CoreArea = this.local.getEvaluationArea();
            var areaId: string = area === undefined? "global": "@"+area.areaId;
            console.log("write eval", this.valueOrigin, areaId,
                        this.prototype.idStr(),
                        this.prototype.path.toString(),
                        ":=", cdlifyLim(this.lastUpdate, 200));
        }
        this.result.value = this.lastUpdate;
        return true;
    }

    debugName(): string {
        return "write";
    }

    specificExplanation(explanation: any, classDebugInfo: AreaTemplateDebugInfo, ignoreInputs: boolean = false): void {
        var prototype = <WritableNode> this.prototype;

        super.specificExplanation(explanation, classDebugInfo);
        explanation.path = prototype.path;
        if (this.latchedValue !== undefined) {
            explanation.latchedValue = getDeOSedValue(this.latchedValue);
        }
        return explanation;
    }

    // this method is called by gRemoteMgr when it learns on updates to the
    // .appStateIdentifier with which this EvaluationWrite has registered
    //
    // the new value is latched, and changed are evetually applied by
    // gRemoteMgr for a batch of changes
    remoteUpdate(newValue: any): void {
        var curValue: any = this.latchedValue !== undefined?
            this.latchedValue: this.lastUpdate;

        assert(newValue !== undefined,
               "remoteUpdate: undefined values should not reach this point");
        gAppStateChangeList.push({
                areaId: this.local.getOwnId(),
                path: this.prototype.path,
                value: this.lastUpdate
            });
        this.unregisterInitialValue();
        if (!valueEqual(newValue, curValue)) {
            this.lastUpdate = newValue;
            this.latchedValue = undefined;
            this.isLatched = false; // suppress calls to release()
            this.markAsChanged();
        }
        this.valueOrigin = "remote";
        this.result.remoteStatus = "remote";
    }

    // called from appStateMgr when the server notifies that the value should
    //  be removed. Revert to the (current value of the) default value, if
    //  one is defined
    remoteDelete(): void {
        this.registerInitialValue(this.prototype.initialValue, this.local);
    }

    registerInitialValue(initialValue: FunctionNode, local: EvaluationEnvironment): void {
        this.initialValue = getEvaluationNode(initialValue, local);
        this.result.value = this.initialValue.result.value;
        if (!this.initialValue.isConstant()) {
            this.initialValue.addWatcher(this, "initialValue", true, true, false);
            if ("schedulingError" in this.prototype) {
                this.inputs.push(this.initialValue);
            }
        }
        else {
            if (this.result.value !== undefined) {
                this.markAsChanged();
            }
        }
        this.valueOrigin = "init";
        this.result.remoteStatus = "local";
    }

    remoteError(): void {
        // Nothing yet. It's possible to delay initialization of this node until
        // a remote update arrives, and initialize locally when an error occurs.
        this.result.remoteStatus = "error";
    }

    toFullString(): string {
        return "[" + pathToQueryString(this.prototype.path, "_") +
            ", [me]] = " + cdlifyLim(this.result.value, 80);
    }
}

function determineWrite(curValue: any, result: Result, mode: WriteMode, positions: DataPosition[], pct: PositionChangeTracker) {
    var newValue: any;

    if (curValue === undefined) {
        curValue = [];
    }
    if (positions === undefined) {
        var resultValue: any = result.value === undefined? constEmptyOS: result.value;
        if (pct.markShift(0, Infinity, resultValue, false, mode) === undefined) {
            Utilities.warn("dead-ended write: overwriting data: " + gWriteAction + " at " + gWriteAction);
            return;
        }
        switch (mode) {
          case WriteMode.replace:
            newValue = resultValue;
            break;
          case WriteMode.merge:
            // Possibly todo: mark only affected attributes
            if (resultValue instanceof Array && resultValue.length === 0) {
                newValue = resultValue;
            } else {
                var mergeAttributes: MergeAttributes =
                    result.mergeAttributes && result.mergeAttributes.length == 1?
                    result.mergeAttributes[0] : undefined;
                newValue = mergeCopyValue(resultValue, curValue,
                                          mergeAttributes, undefined);
            }
            break;
        }
    } else {
        newValue = curValue;
        for (var i: number = 0; i !== positions.length; i++) {
            // This is inefficient if the number of positions is high, as
            // the whole structure is replaced on every iteration. In
            // practice, it won't have any effect, since there are no
            // massive writes.
            newValue = updateValue(newValue, result, positions[i], mode, pct);
        }
    }
    return newValue;
}

// Merges newValue in the os in the place indicated by position, and returns
// a new object with the result.
function updateValue(os: any[], result: Result, position: DataPosition, mode: WriteMode, pct: PositionChangeTracker): any[] {

    function findAddedAttributes(addedAttributes: {[attr: string]: string}): number {
        for (var i: number = 0; i < os.length; i++) {
            if (interpretedBoolMatch(addedAttributes, os[i])) {
                return i;
            }
        }
        return os.length;
    }

    function addAttributes(target: any[], added: any): any[] {

        if(added === undefined)
            return target;

        var merged: any[] = [];
        
        for(var i = 0, l = target.length ; i < l ; ++i) {
        
            var target_i: any = target[i];

            if(typeof(target_i) !== "object")
                merged.push(target_i);
            else {
                var merge_i: any = {};
                for (var attr in target_i)
                    merge_i[attr] = target_i[attr];
                for (var attr in added) {
                    if(!(attr in merge_i))
                        merge_i[attr] = added[attr];
                }

                merged.push(merge_i);
            }
        }
        return merged;
    }

    var index: number = position.addedAttributes === undefined?
                        pct.getIndex(position.index):
        findAddedAttributes(position.addedAttributes);
    var repl: any[];
    if(position.path !== undefined && position.path.length > 0) {
        repl = updateSubPathValue(os, result, position, index, mode, pct);
    } else {
        // values to be merged at this position
        switch (mode) {
        case WriteMode.replace:
            repl = ensureOS(result.value);
            break;
        case WriteMode.merge:
            var variants: Result[] = getMergedValues(result, position);
            repl = [];
            if(position.isAppend()) {
                repl = ensureOS(variants[0].value);
                break;
            }
            var numVariants = variants.length;
            var mergeLength = position.identified ? 1 : position.length;
            for(var i = 0 ; i < position.length ; i += mergeLength) {
                variants[numVariants] =
                    new Result(os.slice(index,index+mergeLength));
                if(position.toSubIdentifiers) // position length must be 1
                    variants[numVariants].setSubIdentifiers(
                        position.toSubIdentifiers);
                repl = repl.concat(
                    mergeVariants(variants, undefined, undefined, 0,
                                  variants.length, false, undefined).value);
            }
            if (pct.markShift(index, position.length, repl, false, mode) ===
                undefined) {
                Utilities.warn("double write (term): " + gWriteAction);
                return os;
            }
            break;
        }
    }
    if (position.addedAttributes !== undefined)
        repl = addAttributes(repl, position.addedAttributes);
    if(position.isAppend())
        return os.concat(repl);
    return os.slice(0, index).concat(repl).concat(os.slice(index + position.length));
}

// Create the value(s) to be merged. If the merging is not by identifiers,
// this simply returns the input result, but if merging is by identifiers,
// the values with the right identifier need to be extracted. These
// are returned as an array of Result objects, including all merge attributes,
// identifiers and sub-identifiers, ordered in decreasing order of priority.

function getMergedValues(result: Result, position: DataPosition): Result[]
{
    if(position.identified === undefined)
        return [result]; // unchanged

    var newValue: any[] = ensureOS(result.value);
    // 'identified' is an array with the positions of the values
    // which have the same identity as the write target.
    newValue = position.identified.map(n => newValue[n]);
    
    if(position.isAppend())
        return [new Result(newValue)];
    
    var attributes: MergeAttributes[] = result.mergeAttributes;
    var subIdentifiers: any[] = result.subIdentifiers;
    if(attributes && attributes.length > 1)
        attributes = position.identified.map(n => attributes[n]);
    if(subIdentifiers)
        subIdentifiers = position.identified.map(n => subIdentifiers[n]);

    // return a result per element in the new value (as they all have the
    // same identity and are about to be merged with a single element in
    // the existing value).

    var variants: Result[] = [];
    
    for(var i = 0 ; i < newValue.length ; ++i) {
        var pos = newValue.length - i - 1; // add in reverse order
        var mergeAttr: MergeAttributes = attributes === undefined ? undefined :
            (attributes.length == 1 ? attributes[0] : attributes[pos]);
        variants.push(new Result(newValue[pos]));
        if(mergeAttr)
            variants[i].mergeAttributes = [mergeAttr];
        if(subIdentifiers)
            variants[i].subIdentifiers = [subIdentifiers[pos]];
    }
    return variants;
}

function updateSubPathValue(os: any[], result: Result, position: DataPosition, index: number, mode: WriteMode, pct: PositionChangeTracker): any[] {

    if (position.path.length !== 1) {
        Utilities.warn("Cannot write across paths longer than 1"); // TODO
        return os.slice(index, index + position.length);
    }
    var attr: string = position.path[0];
    var repl: any[] = [];
    var maxIndex: number = Math.min(index + position.length, os.length);
    var oldLength = index == maxIndex ? 0 : 1;
    
    do {
        // insert new entry if adding beyond last replcement index
        var oldValue: any = index < maxIndex ? os[index]: {};
        if (!(oldValue instanceof Object) || oldValue instanceof NonAV) {
            oldValue = {};
        }
        var repl_i: any = shallowCopyMinus(oldValue, attr);
        var subOS: any[] = attr in oldValue? oldValue[attr]: [];
        var posChange: PositionChange =
            pct.markShift(index, oldLength, [{}], true, mode);
        if (posChange !== undefined) {
            var projPositionChangeTracker = posChange.markProjection(attr);
            for (var i: number = 0; i < position.sub.length; i++) {
                var subPos: DataPosition = position.sub[i];
                subOS = updateValue(subOS, result, subPos, mode,
                                    projPositionChangeTracker);
            }
            repl_i[attr] = subOS;
        } else {
            Utilities.warn("versus: " + gWriteAction);
            repl_i = oldValue; // keep the original value
        }
        
        repl.push(repl_i);
        index++;
    } while(index < maxIndex)

    return repl;
}
