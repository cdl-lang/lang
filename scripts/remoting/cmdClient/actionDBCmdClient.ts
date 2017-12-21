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

/// <reference path="elementWriteCmdClient.ts" />

// ActionDBCmdClient facilitates performing actions such that the state
//  of some things - managed by the actions - would correctly reflect the
//  contents of a table in app-state.
// For example, the app-state table could be
//
// ^serviceTable: o(
//   { name: <user-name>, administrator: true/false },
//   ...
// )
// and the actions could be to add/remove a user-account from the machine,
//  and/or to promote/demote a user from having admin rights
//
// A deriving class should define - as any TableElementCmdClient -
//
//  DClass.prototype.elementConf = {
//      // path to area containing app-state table variable
//     areaLineage: [
//        { name: "childOfScreenArea", type: "single" },
//        { name: "grandsonOfScreenArea", type: "single" }
//     ],
//
//     // context variable name -
//     path: "myContextLabel",
//
//     // unique index attribute within each table entry
//     uniqueId: "name"
//  }
//
//  and the following methods:
//
//    getItemList():
//          return an array of the uniqueIds of the entries as they are
//        known to the 'action' version of the database (e.g. which user
//        accounts are currently defined, referring to the example above)
// 
//    getItem(uniqueId):
//          return a complete entry for the given uniqueId, representing how
//        it is known in the 'action' version of the database (e.g. is that
//        user currently defined with/out admin rights)
//
//    addItem(uniqueId, entry):
//          modify the 'action' version of the database, e.g. define a new
//        user, having admin-rights iff entry.administrator==true
//
//    removeItem(uniqueId):
//          perform the required actions so that the given uniqueId is
//        removed from the 'action' version of the database

//    modifyItem(uniqueId, newValue, oldValue):
//          perform the required actions so as the modify the details of the
//        given uniqueId so that it now reflects 'newValue' (while previously
//        it reflected oldValue), e.g. promote a user so they have admin rights
//
//
// in addition, a deriving class may choose to implement
//    tableUpdateStart()
// and
//    tableUpdateEnd()
//
// which are called w/o arguments just-before/immediately-after a batch of
//  changes to the table are made known
//

abstract class ActionDBCmdClient extends TableElementCmdClient {
    
    // tableValue is an os with objects that have at least attribute uniqIDAttr.
    // It is converted to an associative object where the key is the value of
    // that attribute. This transformed object is also cached and used as basis
    // for comparing updates.
    elementUpdate(tableValue: any[]): void {
        var uniqIDAttr = this.getUniqueIDAttr();
        var i: number;
        var tableByUID: {[id: string]: {[id: string]: any}} = {};

        RemotingLog.log(2, () => "elementUpdate: " + cdlify(tableValue));

        for (i = 0; i < tableValue.length; i++) {
            var tEntry: any = stripArray(tableValue[i], true);
            var uid: any = tEntry[uniqIDAttr];
            if (uid !== undefined) {
                tableByUID[uid] = tEntry;
            }
        }
    
        var actionDBItemList = this.getItemList();
        var actionDBItemObj: {[id: string]: boolean} = {};
        for (i = 0; i < actionDBItemList.length; i++) {
            var itemUID = actionDBItemList[i];
            actionDBItemObj[itemUID] = true;
        }

        this.tableUpdateStart();
    
        try {

            for (var attr in tableByUID) {
                var appStateItem = tableByUID[attr];
                if (attr in actionDBItemObj) {
                    var actionDBItem = this.getItem(attr);
                    if (this.isItemModified(attr, appStateItem, actionDBItem)) {
                        this.modifyItem(attr, appStateItem, actionDBItem);
                    }
                } else {
                    this.addItem(attr, appStateItem);
                }
            }
            for (var attr in actionDBItemObj) {
                if (!(attr in tableByUID)) {
                    this.removeItem(attr, this.getItem(attr));
                }
            }
        } finally {

            // Call this function, exception or not.
            this.tableUpdateEnd();

        }
    }
    
    isItemModified(uniqueId: string, newItem: any, oldItem: any): boolean {
        return !cdlyEqual(newItem, oldItem);
    }
    
    // Functions that must be implemented by the derived class

    abstract tableUpdateStart(): void;
    
    abstract tableUpdateEnd(): void;
    
    abstract getItemList(): string[];
    
    abstract getItem(attr: string): any;
    
    abstract addItem(attr: string, appStateItem: any): void;
    
    abstract removeItem(attr: string, actionDBItem: any): void;
    
    abstract modifyItem(attr: string, appStateItem: any, actionDBItem: any): void;
}

/**
 * FileCachedActionDBCmdClient is a derived class of ActionDBCmdClient. It
 * can be used to load/save one file.
 * 
 * @class FileCachedActionDBCmdClient
 * @extends {ActionDBCmdClient}
 */
abstract class FileCachedActionDBCmdClient extends ActionDBCmdClient {

    fileCache: any = undefined;

    constructor(paidMgr: PaidMgrInterface, filePath: string) {
        super(paidMgr);
        this.initFile(filePath);
        this.creadFile();
    }
    
    creadFile(force: boolean = false): {[id: string]: any} {
        if (force || this.fileCache === undefined) {
            var fileContents: any = this.readFile();
            if (fileContents === undefined) {
                this.fileCache = {};
            } else if (this.checkFileCache(fileContents)) {
                this.fileCache = fileContents;
            } else {
                RemotingLog.log(0, "cache malformed: " + this.fileSpec.path);
                this.fileCache = {};
            }
        }
        return this.fileCache;
    }

    /// Must be implemented to verify that the cache is well-formed.
    abstract checkFileCache(cacheObj: any): boolean;
    
    cwriteFile(writeObj: {[id: string]: any}): void {
        this.writeFile(writeObj);
        this.creadFile(true);
    }
}
