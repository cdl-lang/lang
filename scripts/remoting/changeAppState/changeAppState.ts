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
/// <reference path="../../feg/externalTypes.basic.d.ts" />
/// <reference path="../../feg/xdr.ts" />
/// <reference path="../../feg/stringparser.ts" />
/// <reference path="../cmdClient/appStateCmdClient.ts" />
/// <reference path="../cmdClient/elementWriteCmdClient.ts" />

/*
 * Command line utility for app state. Usage: node changeAppState.node.js ...
 * set <lineage> <label> <value>
 *   changes an app state value
 * delete <lineage> <label>
 *   deletes an app state value
 * print <lineage> <label>
 *   prints an app state value
 * 
 * <label> is the name of the context label
 * <lineage> is single string describing the area where the app state value is
 *   located from the screen area by child names, separated by a period. E.g.
 *     app.abController.showControl
 *   An index can be specified with a colon, e.g.
 *     app.line:12.header
 * <value> is a CDL string representation of the value (see {StringParseCDLValue}).
 * 
 * The server must be identified via the usual variable settings:
 * - port (default: 8080)
 * - protocol (default: "wss")
 * - server (default "127.0.0.1")
 * - cacert (default: "certutil/rootCA.pem")
 * - user (no default)
 * - password (no default)
 */

class SingleValueClient extends SingleElementCmdClient
{
    expectNrUpdates: number;

    constructor(
        public action: string,
        public label: string,
        public lineage: string[],
        public updateValue: any
    ) {
        super(gPaidMgr);
        this.elementConf = {
            path: label,
            areaLineage: lineage.map((childName: string) => {
                var components = childName.split(":");
                return components.length === 1? {
                    name: childName,
                    type: "single"
                }: {
                    name: components[0],
                    type: "set",
                    index: components[1]
                };
            })
        };
        this.expectNrUpdates = action === "print"? 1: 2;
    }
    
    elementUpdate(value: any): void {
        if (this.action === "print") {
            console.log(cdlify(value, ""));
            process.exit(0);
        } else {
            // console.log("value of", this.label, "was", cdlify(value));
            this.writeElement(
                this.updateValue === undefined? []: ensureOS(this.updateValue));
        }
    }

    allRequestsAcknowledged(): void {
        process.exit(0);
    }

    getUniqueIDAttr(): string {
        throw new Error('Method not implemented.');
    }
}

var gArgParser = getArgParser();

function usage(): void {
    console.error("usage:", gArgParser.getAppName(),
                  "set|delete|print lineage label [value]");
    process.exit(1);
}

function updateAppState(action: string, lineage: string[], label: string, value: any): void {
    var updateValue = action === "delete"? xdrDeleteIdent: value;
    
    // Object stays alive until end of execution.
    var singleValueClient = new SingleValueClient(action, label, lineage, updateValue);
    singleValueClient.subscribeServer();
}

function changeAppStateAndMain(): void {
    var argv = gArgParser.getArgv();
    var action: string = argv[2];

    if (!((action === "set" && argv.length === 6) ||
          (action === "print" && argv.length === 5) ||
          (action === "delete" && argv.length === 5))) {
        usage();
    }

    var lineage: string[] = argv[3].split(".");
    var label: string = argv[4];
    var parser = new StringParseCDLValue();
    var parseResult = argv[5] !== undefined? parser.parse(argv[5]): undefined;
    var value: any = parseResult !== undefined? parseResult.tree.result: undefined;

    if (label === "") {
        usage();
    }
    if (value !== undefined && value.error !== undefined) {
        console.log("error in cdl value:", value.error);
        process.exit(1);
    }

    createRemoteMgr();

    serverMultiplexer.initRemote({ exitOnError: true });

    updateAppState(action, lineage, label, value);
}

changeAppStateAndMain(); // The Old Mill.
