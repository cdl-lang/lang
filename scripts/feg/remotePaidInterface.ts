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

/// <reference path="../remoting/remotingLog.ts" />
/// <reference path="paidMgrInterface.ts" />

interface XDRTemplateDefinition {
    templateId: number;
    parentId: number;
    childType: string;
    childName: string;
    referredId?: number;
}

function isXDRTemplateDefinition(d: any): d is XDRTemplateDefinition {
    return d instanceof Object && "templateId" in d &&
           (d.templateId === 1 ||
            (typeof(d.templateId) === "number" && d.templateId > 0 &&
             typeof(d.parentId) === "number" && d.parentId > 0 &&
             typeof(d.childType) === "string" &&
             typeof(d.childName) === "string" &&
             (d.referredId === undefined || typeof(d.referredId) === "number")));
}

interface XDRIndexDefinition {
    indexId: number;
    prefixId: number;
    append?: any;
    compose?: number;
}

function isXDRIndexDefinition(d: any): d is XDRIndexDefinition {
    return d instanceof Object &&
           (d.indexId === 1 ||
            (typeof(d.indexId) === "number" && d.indexId > 0 &&
             typeof(d.prefixId) === "number" && d.prefixId &&
             (d.compose === undefined || typeof(d.compose) === "number")));
}

/**
 * Functionality to ensure that the receiver(s) can interpret the transmitted
 * template and index ids.
 * 
 * @interface TemplateIndexInformationChannel
 */
interface TemplateIndexInformationChannel {
    /**
     * Resets object to state where receivers have no information about ids.
     * 
     * @memberof TemplateIndexInformationChannel
     */
    resetChannel(): void;

    /**
     * Updates information that receivers require about a template.
     * 
     * @param {number} id 
     * 
     * @memberof TemplateIndexInformationChannel
     */
    defineTemplate(id: number): void;

    /**
     * Updates information that receivers require about an index.
     * 
     * @param {number} id 
     * 
     * @memberof TemplateIndexInformationChannel
     */
    defineIndex(id: number): void;

    /**
     * List of latest updates.
     * 
     * @memberof TemplateIndexInformationChannel
     */
    getTemplateIndexIdUpdates(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined;

    /**
     * List of all templates and indices.
     * 
     * @memberof TemplateIndexInformationChannel
     */
    getAllTemplateIndexIds(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined;

    /**
     * Replaces the sender's template id with the local template id.
     * 
     * @param {number} id 
     * @returns {number} 
     * 
     * @memberof TemplateIndexInformationChannel
     */
    translateTemplate(id: number): number;

    /**
     * Replaces the sender's index id with the local index id.
     * 
     * @param {number} id 
     * @returns {number} 
     * 
     * @memberof TemplateIndexInformationChannel
     */
    translateIndex(id: number): number;
}

class RemotePaidInterface implements TemplateIndexInformationChannel {

    definedTemplates: Set<number> = new Set();
    definedIndices: Set<number> = new Set();
    templatesToTransmit: number[]|undefined;
    indicesToTransmit: number[]|undefined;

    remoteToLocalTemplateId: Map<number, number> = new Map();
    remoteToLocalIndexId: Map<number, number> = new Map();

    constructor(public paidMgr: PaidMgrInterface) {
        this.resetChannel();
    }

    resetChannel(): void {
        this.definedTemplates.clear();
        this.definedTemplates.add(1);

        this.definedIndices.clear();
        this.definedIndices.add(1);

        this.remoteToLocalTemplateId.clear();
        this.remoteToLocalTemplateId.set(1, 1);

        this.remoteToLocalIndexId.clear();
        this.remoteToLocalIndexId.set(1, 1);

        this.templatesToTransmit = undefined;
        this.indicesToTransmit = undefined;
    }

    defineTemplate(id: number): void {
        if (this.definedTemplates.has(id)) {
            return;
        }
        var templateEntry = this.paidMgr.getTemplateEntry(id);
        if (templateEntry === undefined) {
            RemotingLog.log(1, "defineTemplate: templateId: " + id + " lacks a template entry");
            return;
        }
        this.definedTemplates.add(id);
        this.defineTemplate(templateEntry.parentId);
        if (templateEntry.referredId !== undefined && templateEntry.referredId !== null) {
            this.defineTemplate(templateEntry.referredId);
        }
        if (this.templatesToTransmit === undefined) {
            this.templatesToTransmit = [];
        }
        this.templatesToTransmit.push(id);
    }

    defineIndex(id: number): void {
        if (this.definedIndices.has(id)) {
            return;
        }
        var indexEntry = this.paidMgr.getIndexEntry(id);
        if (indexEntry === undefined) {
            RemotingLog.log(1, "defineIndex: indexId: " + id + " lacks a template entry");
            return;
        }
        this.definedIndices.add(id);
        this.defineIndex(indexEntry.prefixId);
        if (indexEntry.compose !== undefined) {
            this.defineIndex(indexEntry.compose);
        }
        if (this.indicesToTransmit === undefined) {
            this.indicesToTransmit = [];
        }
        this.indicesToTransmit.push(id);
    }

    static getXDRTemplateDefinition(paidMgr: PaidMgrInterface, id: number): XDRTemplateDefinition {
        var templateEntry = paidMgr.getTemplateEntry(id);

        var def: XDRTemplateDefinition = {
            templateId: id,
            parentId: templateEntry.parentId,
            childType: templateEntry.childType,
            childName: templateEntry.childName
        };

        if (templateEntry.referredId !== undefined &&
                templateEntry.referredId !== null) {
            def.referredId = templateEntry.referredId;
        }

        return def;
    }

    static getXDRIndexDefinition(paidMgr: PaidMgrInterface, id: number): XDRIndexDefinition {
        var indexEntry = paidMgr.getIndexEntry(id);

        var def: XDRIndexDefinition = {
            indexId: id,
            prefixId: indexEntry.prefixId
        };

        if (indexEntry.append !== undefined) {
            def.append = indexEntry.append;
        }
        if (indexEntry.compose !== undefined &&
                indexEntry.compose !== null) {
            def.compose = indexEntry.compose;
        }

        return def;
    }

    getTemplateIndexIdUpdates(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined {
        if (this.templatesToTransmit === undefined &&
              this.indicesToTransmit === undefined) {
            return undefined;
        }
        var updateList: (XDRTemplateDefinition|XDRIndexDefinition)[];
        if (this.templatesToTransmit !== undefined) {
            var paidMgr = this.paidMgr;
            updateList = this.templatesToTransmit.map(id =>
                RemotePaidInterface.getXDRTemplateDefinition(paidMgr, id)
            );
            this.templatesToTransmit = undefined;
        } else {
            updateList = [];
        }
        if (this.indicesToTransmit !== undefined) {
            var paidMgr = this.paidMgr;
            updateList = updateList.concat(this.indicesToTransmit.map(id =>
                RemotePaidInterface.getXDRIndexDefinition(paidMgr, id)
            ));
            this.indicesToTransmit = undefined;
        }
        return updateList;
    }

    getAllTemplateIndexIds(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined {
        var paidMgr = this.paidMgr;
        var templateIds: number[] = [];
        var indexIds: number[] = [];

        this.definedTemplates.forEach(id => templateIds.push(id));
        templateIds.sort((a, b) => a - b);

        this.definedIndices.forEach(id => indexIds.push(id));
        indexIds.sort((a, b) => a - b);

        return (<(XDRTemplateDefinition|XDRIndexDefinition)[]> templateIds.map(id =>
                    RemotePaidInterface.getXDRTemplateDefinition(paidMgr, id)
                )).concat(indexIds.map(id =>
                    RemotePaidInterface.getXDRIndexDefinition(paidMgr, id)
                )
               );
    }

    translateTemplate(id: number|undefined): number|undefined {
        if (id === undefined) {
            return undefined;
        }
        var translatedId = this.remoteToLocalTemplateId.get(id);
        assert(translatedId !== undefined, "translateTemplate: undefined local template id: " + JSON.stringify(id));
        return translatedId;
    }

    translateIndex(id: number|undefined): number|undefined {
        if (id === undefined) {
            return undefined;
        }
        var translatedId = this.remoteToLocalIndexId.get(id);
        assert(translatedId !== undefined, "translateTemplate: undefined local template id: " + JSON.stringify(id));
        return translatedId;
    }

    addRemoteTemplateDefinition(templateDef: XDRTemplateDefinition): void {
        if (templateDef.templateId !== 1) {
            var localTemplateId: number = this.paidMgr.getTemplateByEntry(
                this.translateTemplate(templateDef.parentId),
                templateDef.childType, templateDef.childName,
                this.translateTemplate(templateDef.referredId));
            this.remoteToLocalTemplateId.set(templateDef.templateId, localTemplateId);
        }
    }

    addRemoteIndexDefinition(indexDef: XDRIndexDefinition): void {
        if (indexDef.indexId !== 1) {
            var localIndexId: number = this.paidMgr.getIndexByEntry(
                this.translateIndex(indexDef.prefixId),
                indexDef.append,
                this.translateIndex(indexDef.compose));
            this.remoteToLocalIndexId.set(indexDef.indexId, localIndexId);
        }
    }
}

/* Implements the TemplateIndexInformationChannel as an identity function;
 * useful when translation isn't needed.
 */
var nopTemplateIndexChannel: TemplateIndexInformationChannel = {
    resetChannel: (): void => {},
    defineTemplate: (id: number) => void {},
    defineIndex: (id: number) => void {},
    getTemplateIndexIdUpdates: function(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined { return undefined; },
    getAllTemplateIndexIds: function(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined { return undefined; },
    translateTemplate: function (id: number): number { return id; },
    translateIndex: function (id: number): number { return id; }
}
