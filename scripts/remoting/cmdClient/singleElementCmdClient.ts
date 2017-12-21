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

/// <reference path="appStateCmdClient.ts" />
/// <reference path="../../feg/paidMgrInterface.ts" />

abstract class SingleElementCmdClient extends CmdClient {

    cachedIdent: AppStateIdentifier = undefined;

    /// assuming a cdl conf of:
    /// var screenArea = {
    ///   ..
    ///   children: {
    ///     childOfScreenArea: {
    ///       ..
    ///       children: {
    ///         grandsonOfScreenArea: {
    ///           ..
    ///           context: {
    ///             "^myContextLabel": o()
    ///             ..
    ///           }
    ///       }
    ///     }
    ///   }
    /// }
    ///
    /// this.elementConf = {
    ///    path: "myContextLabel",
    ///    areaLineage: [
    ///        { name: "childOfScreenArea", type: "single" },
    ///        { name: "grandsonOfScreenArea", type: "single" }
    ///    ]
    /// };
    ///
    /// uniqueId identifies the element within a set, although it seems it
    /// should be part of areaLineage.
    elementConf: {
        path: string;
        areaLineage: {
            name: string;
            type: string;
            index?: string;
        }[];
        uniqueId?: string;
    };

    constructor(public paidMgr: PaidMgrInterface) {
        super();
    }
    
    cacheElementIdent(): void {
        if (this.cachedIdent !== undefined) {
            return;
        }
    
        // successively generate template and index identifiers for the
        //  areas in elementConf.areaLineage[]
    
        var parentTemplateId;
        var parentIndexId;
    
        parentTemplateId = this.paidMgr.getScreenAreaTemplateId();
        parentIndexId = this.paidMgr.getScreenAreaIndexId();
    
        for (var i = 0; i < this.elementConf.areaLineage.length; i++) {
            var entry = this.elementConf.areaLineage[i];
            var childName = entry.name;
            var childType = entry.type;
            var referredId = undefined; // not suppported
    
            var templateId: number = this.paidMgr.getTemplateByEntry(
                parentTemplateId, childType, childName, referredId);
    
            if (childType === "intersection") {
                console.log("SingleElementCmdClient: intersections are not supported");
                return;
            }
    
            if (childType === "set") {
                var dataIdentity = entry["index"];
                var referredIndexId = undefined;
                var indexId: number = this.paidMgr.getIndexByEntry(
                    parentIndexId, dataIdentity, referredIndexId);
            } else {
                indexId = parentIndexId;
            }
    
            parentTemplateId = templateId;
            parentIndexId = indexId;
        }
    
        var appStateIdent = new AppStateIdentifier(
            parentTemplateId, parentIndexId, "context," + this.elementConf.path);
    
        this.cachedIdent = appStateIdent;
    }
    
    resourceUpdate(elementObj: {[id: string]: any}, resourceIdent: string) {
        for (var attr in elementObj) {
            var elem = elementObj[attr];
    
            var ident = elem.ident;
            var value = elem.value;
    
            var templateId = ident.templateId;
            var indexId = ident.indexId;
            var path = ident.path;
    
            if (this.isElementPath(path) &&
                  this.isElementTemplateId(templateId) &&
                  this.isElementIndexId(indexId)) {
                this.elementUpdate(value);
                break;
            }
        }
    }

    // Called when an update for the registered element has been received.
    abstract elementUpdate(value: any): void;
    
    // Called when all messages have been acknowledged. No need for action here.
    allRequestsAcknowledged() {
    }
    
    isElementPath(path: string): boolean {
        this.cacheElementIdent();
        return this.cachedIdent !== undefined && this.cachedIdent.path === path;
    }
    
    isElementTemplateId(templateId: number): boolean {
        this.cacheElementIdent();
        return this.cachedIdent !== undefined && this.cachedIdent.templateId === templateId;
    }
    
    isElementIndexId(indexId: number): boolean {
        this.cacheElementIdent();
        return this.cachedIdent !== undefined && this.cachedIdent.indexId === indexId;
    }
    
    writeElement(elemValue: any): void {
        this.cacheElementIdent();
        if (this.cachedIdent === undefined) {
            console.log("SingleElementCmdClient.writeElement: " +
                        "element identifier unknown (write ignored)");
            return;
        }
        this.set(this.cachedIdent, elemValue);
    }
    
    // add the method 'getUniqueIDAttr' by which the o/s assumed to exist in
    //  the SingleElement base class is made into an indexable table
    abstract getUniqueIDAttr(): string;
}
