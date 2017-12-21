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

/// <reference path="../feg/elementReference.ts" />
/// <reference path="../feg/utilities.ts" />
/// <reference path="remotingLog.ts" />
/// <reference path="../feg/paidMgrInterface.ts" />

//  this file implements xdr'ing from/into a memory buffer. this can be used
//   to alllow xdr'ing from/into a file.
//
// A MemoryXDR implements the interface 'RemotingConnectionDefinition'.
// It may be used as a substitute for the connection when constructing an XDR
//  object.
// When marshallilng, the templates and indices are available using
//  MemoryXDR.getTemplateList() and MemoryXDR.getIndexList(), following
//  data conversion.
//
// When unmarshalling, MemoryXDR.templateDefinitionHandler and
//  MemoryXDR.indexDefinitionHandler should be called with the respective
//  list prior to actual data conversion.
//
// MemoryXDR reads (while marshalling) or reads and writes (while unmarshalling)
//  paidMgr tables.

class MemoryXDR {

    templateById: PaidMgrTemplateEntry[] = [undefined];
    indexById: PaidMgrIndexEntry[] = [undefined];
    templateMap: {[id: number]: number} = { 0 : 1 };
    indexMap: {[id: number]: number} = { 0 : 1 };

    constructor(public paidMgr: PaidMgrInterface) {
    }
    
    /// return the list of templates found to be required for the data marshalled
    /// into this MemoryXDR
    getTemplateList(): PaidMgrTemplateEntry[] {
        return this.templateById;
    }
    
    /// return the list of indices found to be required for the data marshalled
    /// into this MemoryXDR
    getIndexList(): PaidMgrIndexEntry[] {
        return this.indexById;
    }
    
    /// a template-id was encountered while marshalling, add it to the
    /// 'required templates' list
    defineTemplate(templateId: number): number|undefined {
        if (templateId === 1) {
            return 0;
        }

        if (! (templateId in this.templateMap)) {
            var templateEntry = this.paidMgr.getTemplateEntry(templateId);
            if (templateEntry === undefined) {
                RemotingLog.log(1, function() {
                    return "defineTemplate: templateId " +
                           templateId + " lacks a template entry";
                });
                return undefined;
            }
    
            var parentId: number = this.defineTemplate(templateEntry.parentId);
            var referredId: number|null|undefined;

            if (templateEntry.referredId !== undefined &&
                  templateEntry.referredId !== null) {
                referredId = this.defineTemplate(templateEntry.referredId);
            }
    
            var def = {
                parentId: parentId,
                childType: templateEntry.childType,
                childName: templateEntry.childName,
                referredId: referredId
            };
            var mxTemplateId = this.templateById.length;
            this.templateById.push(def);
            this.templateMap[templateId] = mxTemplateId;
        }
    
        return this.templateMap[templateId];
    }
    
    /// an index-id was encountered while marshalling, add it to the
    /// 'required indices' list
    defineIndex(indexId: number): number {
        if (indexId === 1) {
            return 0;
        }
    
        if (!(indexId in this.indexMap)) {
    
            var indexEntry: PaidMgrIndexEntry = this.paidMgr.getIndexEntry(indexId);
            if (indexEntry === undefined) {
                RemotingLog.log(1, function() {
                    return "defineIndex: indexId " +
                           indexId + " lacks an index entry";
                });
                return undefined;
            }
    
            var prefixId: number = this.defineIndex(indexEntry.prefixId);
            var compose: number|undefined = undefined;
            if (indexEntry.compose !== undefined) {
                compose = this.defineIndex(indexEntry.compose);
            }
    
            var def = {
                prefixId: prefixId,
                append: indexEntry.append,
                compose: compose
            };
            var mxIndexId = this.indexById.length;
            this.indexById.push(def);
            this.indexMap[indexId] = mxIndexId;
        }

        return this.indexMap[indexId];
    }
    
    /// an 'external' mxTemplateId was encountered  in the data while unmarshalling,
    /// get its local id (the one in use by this.paidMgr)
    translateTemplate(mxTemplateId: number): number {
        if (mxTemplateId === 0) {
            return 1;
        }
    
        assert(mxTemplateId in this.templateMap,
               "templateId must already be known");
        return this.templateMap[mxTemplateId];
    }
    
    /// an 'external' mxIndexId was encountered  in the data while unmarshalling,
    /// get its local id (the one in use by this.paidMgr)
    translateIndex(mxIndexId: number): number {
        if (mxIndexId === 0) {
            return 1;
        }
        assert(mxIndexId in this.indexMap, "indexId must already be known");
        return this.indexMap[mxIndexId];
    }
    
    // for each element of 'templateById', find the id used for it by this.paidMgr
    // (might extend this.paidMgr with a new template if it does not yet exist)
    templateDefinitionHandler(templateById: PaidMgrTemplateEntry[]): void {
        for (var mxTemplateId = 1; mxTemplateId < templateById.length; mxTemplateId++) {
            assert(!(mxTemplateId in this.templateMap), "templateDefinitionHandler1");
    
            var def = templateById[mxTemplateId];
            var mxParentId = Number(def.parentId);
            var childType = def.childType;
            var childName = def.childName;
            var referredId = def.referredId;
    
            if (referredId === null) {
                referredId = undefined;
            } else if (referredId !== undefined) {
                referredId = Number(referredId);
            }
    
            var parentId = this.templateMap[mxParentId];
            if (parentId === undefined) {
                RemotingLog.log(1, function() {
                    return "TemplateDefinitionHandler: parentId '" +
                           mxParentId + "' lacks a definition";
                });
                continue;
            }
    
            var templateId = this.paidMgr.getTemplateByEntry(
                                    parentId, childType, childName, referredId);
            this.templateMap[mxTemplateId] = templateId;
    
            RemotingLog.log(3, function() {
                return "MemoryXDR.TemplateDefinitionHandler: mapping " +
                       "<" + parentId + ":" + childType + ":" +
                      childName + ":" + referredId + "> to " + mxTemplateId
            });
        }
    }
    
    /// for each element of 'indexById', find the id used for it by this.paidMgr
    /// (might extend this.paidMgr with a new index if it does not yet exist)
    indexDefinitionHandler(indexById: PaidMgrIndexEntry[]): void {
        for (var mxIndexId = 1; mxIndexId < indexById.length; mxIndexId++) {
            assert(!(mxIndexId in this.indexMap), "indexDefinitionHandler");
    
            var def = indexById[mxIndexId];
            var mxPrefixId = Number(def.prefixId);
            var dataIdentity = def.append;
            var mxReferredIndexId = def.compose;
    
            if (dataIdentity === null) {
                dataIdentity = undefined;
            }
    
            var prefixId = this.indexMap[mxPrefixId];
            if (typeof(prefixId) === "undefined") {
                RemotingLog.log(1, () => "addIndexDef: indexId '" + mxPrefixId + "' lacks a definition");
                continue;
            }
    
            var referredIndexId: number = undefined;
            if (mxReferredIndexId !== null && mxReferredIndexId !== undefined) {
                mxReferredIndexId = Number(mxReferredIndexId);
                referredIndexId = this.indexMap[mxReferredIndexId];
                if (typeof(referredIndexId) === "undefined") {
                    RemotingLog.log(1, () => "addIndexDef: indexId '" + mxReferredIndexId + "' lacks a definition");
                    continue;
                }
            }
    
            try {
                var indexId = this.paidMgr.getIndexByEntry(
                    prefixId, dataIdentity, referredIndexId);
                this.indexMap[mxIndexId] = indexId;
            } catch (e) {
                RemotingLog.log(0, "error in mxIndexId = " + mxIndexId + ", entry =" + JSON.stringify(def));
                throw e;
            }
        }
    }
}
