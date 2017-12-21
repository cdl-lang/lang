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

/// <reference path="evaluationNode.functions.ts" />

//
// a base class for various debugger*info functions
//
// This class registers with the global DebuggerInfoMgr, and maintains the
//   set of area-references up-to-date within this registration
// 
class EvaluationDebuggerInfo extends EvaluationFunctionApplication
{
    // set by the derived class, which type of info it provides
    infoType: string;

    // the list of area-ids as it is in the internal state
    areaIdList: string[] = [];

    // the list of area-ids as it is reflected in the current  result
    //  (which may lag after the internal state until the call to eval() )
    resultIdList: string[] = [];

    // the list of info's, corresponding to areaIdList
    infoList: DebuggerInfoEN[] = [];

    // the position of each areaId in areaIdList/areaInfoList
    areaIdPos: {[areaId: string]: number} = {};

    // values that were modified since the last eval()
    updatedInfo: {[areaId: string]: boolean} = {};

    // most up-to-date result per area-id
    resultObj: {[areaId: string]: Result} = {};

    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);
        this.result.value = constEmptyOS;
    }

    destroy(): void {
        this.updateAreaList([]);
        super.destroy();
    }

    updateInput(pos: any, result: Result): void {
        // pos 0 is the function argument which defines the set of areas for
        // which debugger-area-info is requested
        if (pos === 0) {
            var areaIdList: string[] = [];

            var value = (typeof(result) === "undefined") ? [] :
                ((result.value instanceof Array) ? result.value : []);

            for (var i = 0; i < value.length; i++) {
                if (typeof(value[i]) === "string") {
                    areaIdList.push(value[i]);
                } else {
                    if (! (value[i] instanceof ElementReference)) {
                        Utilities.warnOnce(
                            "debuggerInfo: expecting area references");
                    } else {
                        var er = <ElementReference>value[i];
                        areaIdList.push(er.getElement());
                    }
                }
            }

            this.updateAreaList(areaIdList);
        } else if (pos instanceof Array) {
            // an array 'pos' has a single element, the areaId string
            // it indicates an update to the debugger-area-info data
            var areaId: string = pos[1];
            this.updatedInfo[areaId] = true;
            this.resultObj[areaId] = result;
            this.markAsChanged();
        }
    }


    // called with the desired list of areaIds, this method creates and
    //  watches the added areaInfo's, and releases and stops watching the
    //  removed areaInfo's
    // it updates the members areaIdList, areaIdPos, areaInfoList
    updateAreaList(areaIdList: string[]) {
        var newAreaIdPos: {[areaId: string]: number} = {};
        var newInfoList: DebuggerInfoEN[] = [];
        var changed = false;
        var areaId: string;

        if (areaIdList.length !== this.areaIdList.length) {
            changed = true;
        }

        for (var i = 0; i < areaIdList.length; i++) {
            areaId = areaIdList[i];
            newAreaIdPos[areaId] = i;
            var info: DebuggerInfoEN;

            var oldPos: number = this.areaIdPos[areaId];
            if (typeof(oldPos) === "undefined") {
                info = gDebuggerInfoMgr.getInfo(this.infoType, areaId);

                // the info for areaId may have already been constructed;
                // hence, force it to inform us once even if it doesn't change
                info.addWatcher(this, ["info", areaId], true, true, false);
                changed = true;
            } else if (oldPos !== i) {
                info = this.infoList[oldPos];
                changed = true;
            } else {
                info = this.infoList[i];
            }

            newInfoList[i] = info;
        }

        if (changed) {
            for (areaId in this.areaIdPos) {
                if (! (areaId in newAreaIdPos)) {
                    var oldPos = this.areaIdPos[areaId];
                    this.infoList[oldPos].removeWatcher(this, true, false);
                    gDebuggerInfoMgr.releaseInfo(this.infoType, areaId);
                    delete this.updatedInfo[areaId];
                    delete this.resultObj[areaId];
                    delete this.areaIdPos[areaId];
                }
            }
            this.areaIdList = areaIdList;
            this.areaIdPos = newAreaIdPos;
            this.infoList = newInfoList;

            this.markAsChanged();
        }
    }

    isConstant(): boolean {
        return false;
    }

    // synchronize this.result with the internal state, namely
    //  this.infoList
    // each index in this.result is replaced with the value in updatedInfo
    //  if either the areaId at that index has changed or if there's a value
    //  at that index in updatedInfo
    // if the index has changed but there is not a value at updatedInfo
    //  (yet), we still want to remove the old value there, corresponding
    //  perhaps to an old areaId that used to be at that index
    eval(): boolean {
        var changed: boolean = false;
        var r: any[] = [];
        var newResultIdList: string[] = [];

        for (var i = 0; i < this.areaIdList.length; i++) {
            var areaId: string = this.areaIdList[i];

            newResultIdList[i] = areaId;
            var bestResult: Result = this.resultObj[areaId];

            // areaId changed it pos, or result was modified
            if ((areaId !== this.resultIdList[i]) ||
                (areaId in this.updatedInfo)) {

                changed = true;
            }

            if (bestResult !== undefined && bestResult.value !== undefined) {
                r.push(bestResult.value);
            }
        }

        this.updatedInfo = {};

        if (changed) {
            this.result = new Result(r);
            this.resultIdList = newResultIdList;
        }

        return changed;
    }

    activateInputs(): void {
        super.activateInputs();
        for (var i = 0; i < this.infoList.length; i++) {
            var info = this.infoList[i];
            info.activate(this, false);
        }
    }

    deactivateInputs(): void {
        super.deactivateInputs();
        for (var i = 0; i < this.infoList.length; i++) {
            var info = this.infoList[i];
            info.deactivate(this, false);
        }
    }

    allInputs(): EvaluationNode[] {
        return this.inputs.concat(this.infoList);
    }

    debugName(): string {
        return "debuggerInfo";
    }
}

//
// [debuggerAreaInfo, <area-reference>]
//
// return a DebuggerAreaInfo structure for each area-reference in its only
//  argument.
//
class EvaluationDebuggerAreaInfo extends EvaluationDebuggerInfo
{
    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);

        this.infoType = "areaInfo";
    }

    debugName(): string {
        return "debuggerAreaInfo";
    }
}
debuggerAreaInfo.classConstructor = EvaluationDebuggerAreaInfo;

//
// [debuggerContextInfo, <area-reference>]
//
// return a DebuggerContextInfo structure for each area-reference in its only
//  argument.
//
class EvaluationDebuggerContextInfo extends EvaluationDebuggerInfo
{

    constructor(prototype: FunctionApplicationNode, area: CoreArea) {
        super(prototype, area);

        this.infoType = "contextInfo";
    }

    debugName(): string {
        return "debuggerContextInfo";
    }
}
debuggerContextInfo.classConstructor = EvaluationDebuggerContextInfo;
