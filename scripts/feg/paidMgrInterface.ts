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

interface PaidMgrAreaEntry {
    templateId: number;
    indexId: number;
}

// a template id's definition;
//  referredId should be defined only if 'childType' is 'intersection'
interface PaidMgrTemplateEntry {
    parentId: number;
    childType: string;
    childName: string;
    referredId: number|null|undefined;
}

/**
 * An index id's definition. Exactly one of 'append' and 'compose' should be
 * defined;
 * 
 * @interface PaidMgrIndexEntry
 */
interface PaidMgrIndexEntry {
    prefixId: number;

    /**
     * defined for area-set members: the area-set embedding's index is to be
     * appended with the area-set member's identity
     * 
     * @type {any}
     * @memberOf PaidMgrIndexEntry
     */
    append?: any;

    /**
     * defined for intersections: the expression parent's index is composed
     * with the referred parent's index
     * 
     * @type {number}
     * @memberOf PaidMgrIndexEntry
     */
    compose?: number;
}

interface PaidMgrInterface {

    getScreenAreaTemplateId(): number;

    getScreenAreaIndexId(): number;
    
    getTemplateEntry(templateId: number): PaidMgrTemplateEntry|undefined;

    getIndexEntry(indexId: number): PaidMgrIndexEntry|undefined;

    /// return (allocating, if necessary) a template-id associated with the
    /// given template-entry elements
    getTemplateByEntry(parentId: number, childType: string, childName: string, referredId: number): number;

    /// return the path for a template; debugging only
    getTemplatePath(localTemplateId: number): string;

    /// return (allocating, if necessary) an indexId matching the given
    /// index-entry components
    getIndexByEntry(prefixId: number, dataIdent: string, referredId: number): number;

    /// load the template and index maps with the given data;
    /// this is currently used by the server, as it reads its
    /// template and index tables from persistent storage at server start-up
    preload(templateObj: PaidMgrTemplateEntry[], indexObj: PaidMgrIndexEntry[]): void;
}

interface PaidMgrBackingStore {
    addTemplate(id: number, entry: PaidMgrTemplateEntry): void;
    addIndex(id: number, entry: PaidMgrIndexEntry): void;
}
