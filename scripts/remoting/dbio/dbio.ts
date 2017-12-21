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

/// <reference path="../../utils/node.d.ts" />
/// <reference path="../cmdClient/appStateCmdClient.ts" />

//
// this file contains a utility for performing some operations on a persistence
//  server: print, clear, export and import.
//
// The class CmdClient provides some functionality which is used by some of
//  the specific commands. The main difference between the commands is in
//  their implementation of the 'resourceUpdate' method, which is called when
//  the persistence server notifies of changes to the named configuration.
//  This always happens immediately after subscribing to a configuration.
//  Some of the commands (clear, import) wait for the 2nd call to this method,
//   so that the connection is not closed before the server has had time to
//   act on the changes requested by the client.
// Error checking is minimal, and it is not guaranteed that the client would
//  notice that the server replied with an error message rather than applying
//  the changes requested by the client.
//
// It is assumed that "certutil/rootCA.pem" (or wherever 'cacert=<ca-path>'
//  points to) contains a ca-certificate with which the persistence-server's
//  certificate was signed.
//

declare var fs: typeof FS;

class ClearCmdClient extends CmdClient {
    updateCount: number = 0;

    resourceUpdate(elementObj: any, resourceIdent: string): void {
        let waitForConfirmation = false;
    
        for (let attr in elementObj) {
            let elem = elementObj[attr];
            let elemIdent = elem.ident;
            let elemVal = elem.value;
            if (elemVal === xdrDeleteIdent) {
                continue;
            }
            console.log("Remove " + elemIdent.templateId + ":" + elemIdent.indexId +
                        ":" + elemIdent.path);
            this.unset(elemIdent);
            waitForConfirmation = true;
        }
        if (!waitForConfirmation) {
            process.exit(0);
        }
    }
    
    allRequestsAcknowledged() {
        process.exit(0);
    }
}

class PrintCmdClient extends CmdClient {
    
    // --------------------------------------------------------------------------
    // resourceUpdate
    //
    // Print the data, element by element, followed by the set of template-ids
    //  mentioned in the data. FOr each template-id, print its entry, and the
    //  entry for each index-id associated (by the data elements printed) with
    //  the element.
    //
    // The initial set of areas for which a template/index legend is required is
    //  gathered while printing the data elements.
    // Then, for each area for which a legend is required, its 
    //  embedding/intersection-parents are also considered to require a legend.
    //
    resourceUpdate(elementObj: any, resourceIdent: string) {
        let usedAreaId = new Map<number, Set<number>>();
        let changed: boolean = false;

        function addTemplateId(tid: number): void {
            if (typeof(tid) === "number" && tid > 1 && !usedAreaId.has(tid)) {
                usedAreaId.set(tid, new Set<number>());
                changed = true;
            }
        }
    
        function addIndexId(tid: number, iid: any): void {
            if (typeof(tid) !== "number" || tid <= 1 || !usedAreaId.has(tid)) {
                return;
            }
            if (typeof(iid) !== "number" || iid <= 0 || usedAreaId.get(tid).has(iid)) {
                return;
            }
            usedAreaId.get(tid).add(iid);
            changed = true;
        }
    
        function prefixStr(prefixId: number): string {
            return prefixId === undefined? "(root)": String(prefixId);
        }
            
        // prepare an xdr function that would take values into a format
        //  JSON.stringify can handle (e.g. no Infinity and NaN's)
        let agentXdr = new AgentXDR(XDRDirection.Marshal, nopTemplateIndexChannel);
        let xdrFunc = function (cdlObj: any): any {
            return agentXdr.xdrCdlObj(cdlObj);
        };
    
        //
        // print the data elements
        //
        console.log("===========================================================");
        for (let attr in elementObj) {
            let elem: any = elementObj[attr];
            let ident: AppStateIdentifier = elem.ident;
            let value: any = elem.value;
            let templateId = ident.templateId;
            let indexId = ident.indexId;
            let path: string = ident.path;

            if (value !== xdrDeleteIdent) {
                addTemplateId(templateId);
                addIndexId(templateId, indexId);
                // transform to a form which we know JSON.stringify  can handle
                //  (although it's less concise, e.g. arrays are
                //   { type: "orderedSet", os: [1,2,3] }
                //   rather than just [1,2,3]
                //  )
                let xdrValue = xdrFunc(value);
                console.log("@" + templateId + ":" + indexId + "::" + path +
                             "==> " + JSON.stringify(xdrValue, null, 2));
        
                console.log ("");
            }
        }
        console.log("===========================================================");
    
        // collect all area-ids (as usedAreaId[templateId][indexId] which are
        //  required for a full path between screen-area and each area mentioned
        //  while printing data elements
        //
        // XXX should also test for areas used inside values
        do {
            changed = false;
    
            for (let [templateId, indexIds] of usedAreaId) {
                let templateEntry = gPaidMgr.getTemplateEntry(templateId);
    
                if (typeof(templateEntry) !== "object") {
                    console.log("Error: missing template definition for" +
                                " template-id '" + templateId + "'");
                    process.exit(1);
                }
    
                addTemplateId(templateEntry.parentId);
                addTemplateId(templateEntry.referredId);
    
                let childType = templateEntry.childType;
    
                for (let indexId of indexIds) {
                    let indexEntry = gPaidMgr.getIndexEntry(indexId);
                    if (childType === "single") {
                        addIndexId(templateEntry.parentId, Number(indexId));
                    } else if (childType === "set") {
                        addIndexId(templateEntry.parentId, indexEntry.prefixId);
                    } else if (childType === "intersection") {
                        addIndexId(templateEntry.parentId, indexEntry.prefixId);
                        addIndexId(templateEntry.referredId, indexEntry.compose);
                    }
                }
            }
        } while (changed);
    
        console.log("");
        console.log("");
    
        // print all template entries and the indices actually occurring in them
        for (let [templateId, indexIds] of usedAreaId) {
            let templateEntry = gPaidMgr.getTemplateEntry(templateId);
    
            console.log("templateId=" + templateId + ": " +
                        "  parentId=" + templateEntry.parentId +
                        ", name=" + templateEntry.childName +
                        ", type=" + templateEntry.childType +
                        ((typeof(templateEntry.referredId) === "number") ?
                         (", referredParentId=" + templateEntry.referredId) :
                         ("")));
            
            for (let indexId of indexIds) {
                let indexEntry = gPaidMgr.getIndexEntry(indexId);
                console.log("     indexId=" + indexId + ":      " +
                            "prefixId=" + prefixStr(indexEntry.prefixId) +
                            ((typeof(indexEntry.compose) !== "undefined") ?
                             (", referredIndexId=" + indexEntry.compose) :
                             ("")) +
                            ((typeof(indexEntry.append) !== "undefined") ?
                             (", areaSet-value=" + indexEntry.append) :
                             ("")));
            }
    
            console.log("");
        }
    
        process.exit(0);
    }
    
    allRequestsAcknowledged() {
    }
    
}

class ExportCmdClient extends CmdClient {

    constructor() {
        super();
        this.initFile();
    }
    
    // --------------------------------------------------------------------------
    // resourceUpdate
    //
    // while getting the update from the server, xdr defines any template/index -id
    //  used in the data in gPaidMgr.
    //
    // A single object is then written to the export file, with three sections:
    //  - data (an object whose values are { ident: <tid/iid/path>, value: })
    //  - template
    //  - index
    resourceUpdate(elementObj: any, resourceIdent: string): void {
        assert(resourceIdent === "remoteServer",
               "resource update called by remoteServer");
    
        // prepare an xdr object that would convert the elements into a format
        //  that can be safely handled by JSON.stringify, and would also collect
        //  all of the templateIds/indexIds required for the identification of
        //  these app-state elements
        //
        let memoryXdr = new MemoryXDR(gPaidMgr);
        let agentXdr = new AgentXDR(XDRDirection.Marshal, nopTemplateIndexChannel);
        let xdrFunc = function (elem: any): any {
            return XDR.xdrAppStateElement(elem, agentXdr);
        };
    
        let exportList: any[] = [];
        for (let ident in elementObj) {
            let elem = elementObj[ident];
            let xdrElem = xdrFunc(elem);
            exportList.push(xdrElem);
        }
    
        // get the templates and index-ids that should be stored along with the
        //  data
        let templateList = memoryXdr.getTemplateList();
        let indexList = memoryXdr.getIndexList();
    
        let exportObj = {
            template: templateList,
            index: indexList,
            data: exportList
        };
    
        this.writeFile(exportObj);
    
        process.exit(0);
    }
    
    allRequestsAcknowledged() {
    }
}

// read the import file, and preload gPaidMgr with the templates/indices in it,
//  so that while xdr'ing the data gPaidMgr can define each template/index used
//  by the data (either as an ident or as an element-reference data) for the
//  server
class ImportCmdClient extends CmdClient {

    updateCount: number = 0;
    importList: AppStateElement[] = [];

    constructor() {
        super();
        this.initFile();
    
        let importObj = this.readFile();
    
        let templateTable = importObj.template;
        let indexTable = importObj.index;
        let elementList = importObj.data;
    
        // create a memory-xdr that would convert data back into an agent format,
        //  and would also handle coordinating with the PaidMgr all of the templates
        //  and indices used within these app-states
        let memoryXdr = new MemoryXDR(gPaidMgr);
        let agentXdr = new AgentXDR(XDRDirection.Unmarshal, nopTemplateIndexChannel);
        let xdrFunc = function (elem: any): any {
            return XDR.xdrAppStateElement(elem, agentXdr);
        };
    
        // define all templates and indices with the paidMgr
        memoryXdr.templateDefinitionHandler(templateTable);
        memoryXdr.indexDefinitionHandler(indexTable);
    
        // convert from xdr format to agent format
        for (let i = 0; i < elementList.length; i++) {
            let xdrElem = elementList[i];
            let elem = xdrFunc(xdrElem);
            this.importList.push(elem);
        }
    }
    
    // --------------------------------------------------------------------------
    // resourceUpdate
    //
    resourceUpdate(elementObj: {[id: string]: AppStateElement}, resourceIdent: string) {
        let isClearing: boolean = false;
        let isEmpty: boolean = true;
    
        for (let attr in elementObj) {
            let elem = elementObj[attr];
            let elemVal = elem.value;
            if (elemVal !== xdrDeleteIdent) {
                isEmpty = false;
                break;
            }
        }

        if (!isEmpty) {
    
            // current configuration is not empty
            if (gArgParser.getArg<boolean>("override", false) === true) {
    
                // user requested override - clear all existing elements
                for (let attr in elementObj) {
                    let elem = elementObj[attr];
                    let elemIdent = elem.ident;
                    let elemVal = elem.value;
                    if (elemVal === xdrDeleteIdent) {
                        continue;
                    }
                    isClearing = true;
                    this.unset(elemIdent);
                }
            } else {
                // user did not specify override - preserve
                //  existing configuration
                console.log("Cannot import into a non-empty configuration");
                process.exit(1);
            }
        }
    
        isEmpty = true;
        for (let i = 0; i < this.importList.length; i++) {
            let elem = this.importList[i];
            this.set(elem.ident, elem.value);
            isEmpty = false;
        }
    
        if (isEmpty) {
            console.log("Configuration is empty");
            if (!isClearing) {
                process.exit(0);
            }
        }
    }
    
    allRequestsAcknowledged(): void {
        process.exit(0);
    }
}

function dbioMain() {
    initializeModeDetection();

    gArgParser = getArgParser();

    createRemoteMgr();
    serverMultiplexer.initRemote();

    let argv = gArgParser.getArgv();

    let cmd = argv[2];

    if (cmd === "clear") {
        let cmdClient = new ClearCmdClient();

        console.log("clear DB: " + serverMultiplexer.getServerDBStr());

        cmdClient.subscribeServer();
    } else if (cmd === "print") {
        let cmdClient = new PrintCmdClient();
        cmdClient.subscribeServer();
    } else if (cmd === "export") {
        let cmdClient = new ExportCmdClient();

        console.log("export DB:");
        console.log("\t from: " + serverMultiplexer.getServerDBStr());
        console.log("\t to: " + cmdClient.getFileDBStr());

        cmdClient.subscribeServer();
    } else if (cmd === "import") {
        let cmdClient = new ImportCmdClient();

        console.log("import DB:");
        console.log("\t from: " + cmdClient.getFileDBStr());
        console.log("\t to: " + serverMultiplexer.getServerDBStr());

        cmdClient.subscribeServer();
    } else {
        if (typeof(cmd) === "string") {
            console.log("Unknown dbio command '" + cmd + "'");
        } else {
            console.log("Available dbio commands are: " +
                        "'clear', 'print', 'import' and 'export'");
        }
        process.exit(1);
    }

}

dbioMain();
