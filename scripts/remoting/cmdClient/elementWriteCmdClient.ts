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

/// <reference path="singleElementCmdClient.ts" />

/**
 *
 * ElementWriteCmdClient is a derived class of SingleElementCmdClient, meant
 *  to be a super-class for classes writing back to app-state
 *
 * It (merely) caches the value of the app-state element - described using
 *  elementConf, as expected by SingleElementCmdClient - in this.elementValue .
 * Thus, the deriving class can reference that value as a basis for modifying
 *  it, presumably calling 'this.writeElement(value)' eventually (which is,
 *  somewhat surprisingly, a SingleElementCmdClient method)
 *
 * @class ElementWriteCmdClient
 * @extends {SingleElementCmdClient}
 */
abstract class ElementWriteCmdClient extends SingleElementCmdClient {

    elementValue: any = undefined;

    elementUpdate(elementValue: any): void {
        this.elementValue = elementValue;
    }
}

abstract class TableElementCmdClient extends ElementWriteCmdClient {
    getUniqueIDAttr(): string {
        return this.elementConf.uniqueId;
    }
}

// TableWriteCmdClient derives TableElementCmdClient and ElementWriteCmdClient.
//
// It is thus meant to be derived by classes that wish to modify an app-state
//  table. The table is assumed  to be hosted in the single context label
//  described by ElementWriteCmdClient / SingleElementCmdClient using
//  the values in this.elementConf .
// The table is assumed to be maintained as an o/s, indexed by a uniqueId
//  which is a member of each o/s member, defined in this.elementConf.uniqueId
//
// When a derived class wishes to modify the existing table value, it should
//  call 'this.modifyTable(updateObj)'.
// updateObj is asssumed to be an a/v indexed by unique-ids. If the value of an
//  a/v is 'undefined' then that uniqueId is removed from the app-state table.
// Otherwise, that uniqueId is modified so that its value becomes the value
//  defined for that uniqueId in updateObj.
// Note that eventually the complete table is written to the persistence server
//  based on the last value reported, so that race conditions are entirely
//  plausible, e.g. when one client modifies uniqueId_1, the other client
//  modifies uniqueId_2, yet only one of the two updates survives
class TableWriteCmdClient extends TableElementCmdClient {

    elementValue: any[]= [];

    modifyTable(updateObj: any): void {
        var uniqIDAttr = this.getUniqueIDAttr();
    
        function addUid(uid: string, entry: {[id: string]: any}): {[id: string]: any} {
            var uobj: {[id: string]: any} = {};

            for (var attr in entry) {
                uobj[attr] = entry[attr];
            }
            uobj[uniqIDAttr] = [uid];
            return uobj;
        }
    
        var updatedTable: {[id: string]: any}[] = [];
        var knownUid: {[uid: string]: boolean} = {};
        var uid: string;
    
        for (var i = 0; i < this.elementValue.length; i++) {
            var tEntry = this.elementValue[i];
            uid = singleton(tEntry[uniqIDAttr]);
    
            knownUid[uid] = true;
            if (uid in updateObj) {
                if (typeof(updateObj[uid]) === "undefined") {
                    // delete uid from table
                    continue;
                }
                updatedTable.push(addUid(uid, updateObj[uid]));
            } else {
                updatedTable.push(tEntry);
            }
        }
    
        // handle new uid's
        for (uid in updateObj) {
            if (!(uid in knownUid)) {
                updatedTable.push(addUid(uid, updateObj[uid]));
            }
        }
    
        this.elementValue = updatedTable;

        this.writeElement(this.elementValue);
    }
}
