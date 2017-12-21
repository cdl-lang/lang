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

/// <reference path="paidMgrInterface.ts" />

// This files contains 'PaidMgr', a class that allocates area-ids in a way
//  that allows area-ids to be persistent.
// An area that is destroyed and later recreated within the lifetime of an
//  application would get the same area-id.
//
// an area-id is the string "<pTemplateId>:<pIndexId>"
//
// a 'pTemplateId' (persistent template id) is allocated based on a unique
//   template identifier;
// - global, i.e. not area bound, data, has pTemplateId 0
// - 'screenArea's pTemplateId is always 1
// - for an area 'P' with pTemplateId 'Ptid' and child 'C',
//   ++ if 'C' is a single child in children path 'myChild', the identifier is
//        <Ptid>:single:myChild
//   ++ if 'C' is an area-set member of an area-set 'mySet', the identifier is
//        <Ptid>:set:mySet
//   ++ if 'C' is an intersection area from children section 'myIntersection',
//     and the referred parent 'R' has a pTemplateId 'Rtid', the identifier is
//        <Ptid>:intersection:myIntersection:<Rtid>
//
// a 'pIndexId' (persistent index id) is allocated based on a unique index
//   identifier.
//
// - global data pIndexId is always 0
// - 'screenArea's pIndexId is always 1
// - for an area 'P' with pIndexId 'Piid' and child 'C',
//  ++ if 'C' is a single child, C's pIndexId is equal to P's pIndexId,
//        Ciid := Piid
//  ++ if 'C' is an area-set member, associated with an identity 'paramAttrStr'
//        then the index identifier is
//       <Piid>:<paramAttrStr>
//   ++ if 'C' is an intersection area, and the referred parebt 'R' has a
//       pIndexId 'Riid', then the index identifier is
//       <Piid>;<Riid>
//
// in both cases (template/index), an identifier that does not yet exist on its
//  respective map is added with a newly allocated id
//
// template-ids and index-ids have their components stored in
//  PaidMgr.templateById and PaidMgr.indexById respectively

/// A PaidMgr can work with any object that can provide ids for templated and index
interface PersistenceTemplateIndexProvider {
    getPersistentTemplateId(): number;
    getPersistentIndexId(): number;
}

class PaidMgr implements PaidMgrInterface {

    templateMap: {[templateIdent: string]: number} = {};
    nextTemplateId: number = 2;

    indexMap: {[indexIdent: string]: number} = {};
    nextIndexId: number = 2;

    // map a template-id to its local definition
    //  (arguably the reverse map to 'templateMap')
    templateById: {[id: number]: PaidMgrTemplateEntry} = {
        // initialize with the screen area'a templateId
        1: { parentId: undefined, childType: undefined,
             childName: undefined, referredId: undefined }
    };

    // map an index-id to its local definition
    //  (arguably the reverse map to 'indexMap')
    indexById: {[id: number]: PaidMgrIndexEntry} = {
        // initialize with the screen-area's indexId
        1: { prefixId: undefined }
    };

    getGlobalPersistentTemplateId(): number {
        return 0;
    }

    getScreenAreaTemplateId(): number {
        return 1;
    }

    // return (allocating, if necessary) a template-id appropriate for
    //  the given parameters; these are the parameters commonly available when
    //  constructing a new area etc
    getTemplateId(parent: PersistenceTemplateIndexProvider, childType: string, childName: string,
                  referred: PersistenceTemplateIndexProvider = undefined)
    : number {
        var parentId: number = parent.getPersistentTemplateId();
        var referredTemplateId: number;

        if (childType === "intersection") {
            referredTemplateId = referred.getPersistentTemplateId();
        }

        return this.getTemplateByEntry(parentId, childType, childName,
                                  referredTemplateId);
    }

    getTemplateByEntry(parentId: number, childType: string,
                       childName: string, referredId: number):
    number {
        var templateIdent: string = this.getTemplateIdent(
            parentId, childType, childName, referredId);

        var templateId: number = this.templateMap[templateIdent];
        if (templateId === undefined) {
            templateId = this.addTemplateId(templateIdent, parentId, childType,
                                            childName, referredId);
        }

        return templateId;
    }

    // create an identifier string unique to these template entry components
    getTemplateIdent(parentId: number, childType: string,
                     childName: string, referredId: number): string
    {
        var ident: string = parentId + ":" + childType + ":" + childName;

        if (childType === "intersection") {
            ident += ":" + referredId;
        }
        return ident;
    }

    // create a new template-entry with the given components, and return its
    //  templateId
    addTemplateId(templateIdent: string, parentId: number, childType: string,
                  childName: string, referredId: number): number
    {
        var templateId: number = this.nextTemplateId++;
    
        this.addTemplateWithId(templateId, templateIdent, parentId, childType,
                               childName, referredId);
        return templateId;
    }

    // create a new template-entry with the given components and the given
    //  template-id
    addTemplateWithId(templateId: number, templateIdent: string,
                      parentId: number, childType: string,
                      childName: string, referredId: number): void
    {
        this.templateMap[templateIdent] = templateId;

        this.templateById[templateId] = {
            parentId: parentId,
            childType: childType,
            childName: childName,
            referredId: referredId
        };
    }

    getTemplatePath(localTemplateId: number): string {
        var templateId: number = localTemplateId;
        var names: string[] = [];

        while (templateId > 1) {
            names.push(this.templateById[templateId].childName);
            templateId = this.templateById[templateId].parentId;
        }
        return names.reverse().join(".");
    }

    getGlobalPersistentIndexId(): number {
        return 0;
    }

    getScreenAreaIndexId(): number {
        return 1;
    }

    // return (allocating, if necessary) an indexId whose entry is associated
    //  with the given arguments; these are the arguments that are available
    //  in area construction code etc
    getIndexId(parent: PersistenceTemplateIndexProvider, type: string, paramAttrStr: string = undefined,
               referred: PersistenceTemplateIndexProvider = undefined) {
        var prefixId = parent.getPersistentIndexId();
        var dataIdent: string;
        var referredIndexId: number;

        if (type === "single") {
            return prefixId;
        } else if (type === "set") {
            dataIdent = encodeURIComponent(paramAttrStr);
        } else {
            assert(type === "intersection", "type '" + type +
                   "' is not a known type");
            referredIndexId = referred.getPersistentIndexId();
        }

        return this.getIndexByEntry(prefixId, dataIdent, referredIndexId);
    }

    getIndexByEntry(prefixId: number, dataIdent: string, referredId: number): number {
        var indexIdent = this.getIndexIdent(prefixId, dataIdent, referredId);
        var indexId = this.indexMap[indexIdent];

        if (indexId === undefined) {
            indexId = this.addIndexId(indexIdent, prefixId, dataIdent, referredId);
        }
        return indexId;
    }

    // return a string unique to the given index-entry components
    getIndexIdent(prefixId: number, dataIdent: string, referredId: number):
    string {
        var indexIdent: string;
        if (typeof(dataIdent) !== "undefined") {
            indexIdent = prefixId + ":" + dataIdent;
        } else if (typeof(referredId) !== "undefined") {
            indexIdent = prefixId + ";" + referredId;
        } else {
            Utilities.error("getIndexIdent: unexpected identifier");
        }

        return indexIdent;
    }

    // create a new index-entry with the given components, and return its id
    addIndexId(indexIdent: string, prefixId: number, dataIdent: string,
               referredId: number): number
    {
        var indexId: number = this.nextIndexId++;

        this.addIndexWithId(indexId, indexIdent, prefixId, dataIdent, referredId);
        return indexId;
    }

    // create a new index-entry with the given components and the given id
    addIndexWithId(indexId: number, indexIdent: string, prefixId: number,
                   dataIdent: string, referredId: number): void
    {
        this.indexMap[indexIdent] = indexId;

        var entry: PaidMgrIndexEntry = this.indexById[indexId] = {
            prefixId: prefixId
        }
        assert((referredId === undefined) !== (dataIdent === undefined),
               "exactly one of 'referredId' and 'dataIdent' should be undefined");

        if (dataIdent !== undefined) {
            entry.append = dataIdent;
        } else {
            entry.compose = referredId;
        }
    }

    getScreenAreaId(): string {
        return "1:1";
    }

    // return the area-id for an area with the given template/index ids
    getAreaId(templateId: number, indexId: number): string {
        var areaId: string = templateId + ":" + indexId;
        return areaId;
    }

    preload(templateList: PaidMgrTemplateEntry[], indexList: PaidMgrIndexEntry[]): void {
        var maxTemplateId = this.nextTemplateId - 1;

        for (var templateId = 2; templateId < templateList.length; templateId++) {
            var tEntry = templateList[templateId];
            if (tEntry === undefined) {
                // only 0 and 1 are expected to be undefined, since 0 doesn't exist
                // and 1 is the screen area, but you never know
                continue;
            }
            var parentId = tEntry.parentId;
            var childType = tEntry.childType;
            var childName = tEntry.childName;
            var referredId = tEntry.referredId;
            var tIdent = this.getTemplateIdent(parentId, childType, childName,
                                               referredId);

            assert(!(tIdent in this.templateMap) || templateId === this.templateMap[tIdent],
                   "templateId must not change: ident=" + tIdent + ", " +
                   templateId + "(" + typeof(templateId) + ")" + "!=" +
                   this.templateMap[tIdent] + "(" +
                   typeof(this.templateMap[tIdent]) + ")");

            this.addTemplateWithId(templateId, tIdent, parentId,
                                   childType, childName, referredId);

            maxTemplateId = Math.max(maxTemplateId, templateId);
        }

        this.nextTemplateId = maxTemplateId + 1;

        var maxIndexId = this.nextIndexId - 1;
        for (var indexId = 2; indexId < indexList.length; indexId++) {
            var iEntry = indexList[indexId];
            if (iEntry === undefined) {
                // screenArea index
                continue;
            }
            var prefixId = iEntry.prefixId;
            var append: string = iEntry.append;
            var compose: number = iEntry.compose;
            var iIdent = this.getIndexIdent(prefixId, append, compose);

            assert(!(iIdent in this.indexMap) || indexId === this.indexMap[iIdent],
                   "indexId must not change");
            this.addIndexWithId(indexId, iIdent, prefixId, append, compose);

            maxIndexId = Math.max(maxIndexId, indexId);
        }

        this.nextIndexId = maxIndexId + 1;
    }

    // return an the template-id/index-id given an area-id (aka a paid)
    // this uses string parsing rather than a map - my uneducated guess is that
    //  this is more efficient, given that the strings are short
    getAreaEntry(paid: string): PaidMgrAreaEntry|undefined {
        var colonIdx = paid.indexOf(":");

        return colonIdx < 0? undefined: {
            templateId: Number(paid.slice(0, colonIdx)),
            indexId: Number(paid.slice(colonIdx + 1))
        };
    }

    getTemplateEntry(templateId: number): PaidMgrTemplateEntry|undefined {
        return this.templateById[templateId];
    }

    getIndexEntry(indexId: number): PaidMgrIndexEntry|undefined {
        return this.indexById[indexId];
    }

}

var gPaidMgr: PaidMgr = new PaidMgr();

// BackingStorePaidMgr is a derived class of PaidMgr instantiated in the server
//
// its uses a PaidMgrBackingStore for the persistent storage if template/index
//  entries. The implementation is expected to call BackingStorePaidMgr's
//  'preload()' method on start-up, passing the template and index tables
//  as they were read from the backing store.
//
// the implementation below is not quite correct, as it does not guarantee that
//  a template/index added to the respective tables was actually written
//  succesfully, which ought to use a call-back mechanism. the acknowledge
//  for a write request that made use of the added template/index should be
//  made dependent on that callback too.
// instead, the optimistic approach is taken, and template/index writes are
//  assumed to always succeed

class BackingStorePaidMgr extends PaidMgr {
    backingStore: PaidMgrBackingStore;

    constructor(backingStore: PaidMgrBackingStore) {
        super();
        this.backingStore = backingStore;
    }

    addTemplateId(templateIdent: string, parentId: number, childType: string,
                  childName: string, referredId: number) :
    number {
        var templateId: number = super.addTemplateId(
            templateIdent, parentId, childType, childName, referredId);

        var entry: PaidMgrTemplateEntry = this.templateById[templateId];

        // XXX TBD - should use a callback to report backing-store write status
        this.backingStore.addTemplate(templateId, entry);

        return templateId;
    }

    addIndexId(indexIdent: string, prefixId: number, dataIdent: string,
               referredId: number):
    number {
        var indexId: number = super.addIndexId(indexIdent, prefixId, dataIdent,
                                               referredId);

        var entry: PaidMgrIndexEntry = this.indexById[indexId];

        // XXX TBD - should use a callback to report backing-store write status
        this.backingStore.addIndex(indexId, entry);

        return indexId;
    }
}
