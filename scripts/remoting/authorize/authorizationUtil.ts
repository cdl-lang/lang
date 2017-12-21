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

/// <reference path="../../feg/externalTypes.basic.d.ts" />
/// <reference path="../../feg/globals.ts" />
/// <reference path="../wsAuth.ts" />
/// <reference path="authorization.ts" />
/// <reference path="../../utils/node.d.ts" />

// this file defines 'authorizationUtil', a node.js utility that allows
//  displaying, modifying  and querying authorization policies.
//
// The various sub-commands (see Usage below) closely match the public APIs of
//  the Authorization class (see authorization.js).
//
// This utility:
//  - demonstrates the APIs of the Authorization class
//  - allows testing and debugging the Authorization class
//  - allows setting up and modifying authorization policies
//  - provide shell/php/python/etc scripts with a way to make authorization
//     queries

var execname: string = "authorizationUtil";

function Usage(): void {
    console.log("Usage: ");
    console.log(execname + " listOwner");
    console.log(execname + " setPerm <owner> <res-type> " +
                "<res-name> <accessor> <perm>");
    console.log(execname + " printRules <owner> <res-type> <res-name>");
    console.log(execname + " showResources <owner>");
    console.log(execname + " isAuthorized <owner> <res-type> " +
                "<res-name> <accessor>");
    console.log("    where <res-type> may be 'appState' and ");
    console.log("          <perm> is 'allow' or 'deny' - or 'DELETE'");
                
    process.exit(1);
}

function printOwnerList(error: any, username: string, ownerList: string[]): void {
    if (error) {
        console.log(execname + ": Failed: " + String(error));
        process.exit(1);
    }
    for (var i = 0; i < ownerList.length; i++) {
        console.log(ownerList[i]);
    }
    process.exit(0);
}

function setPermCB(error: any, username: string, perm: boolean): void {
    if (error) {
        console.log(execname + ": Failed: " + String(error));
        process.exit(1);
    }
    console.log(execname + ": setPerm: OK");
    process.exit(0);
}

function printOwnerResourceList(error: any, username: string, resourceList: any[]): void {
    if (error) {
        console.log(execname + ": Failed: " + String(error));
        process.exit(1);
    }
    for (var i = 0; i < resourceList.length; i++) {
        var resource = resourceList[i];
        console.log("  type: '" + resource.restype +
                    "' name: '" + resource.resname + "'");
    }
    process.exit(0);
}

function printRuleCB(error: any, username: string, ruleSet: {[id: string]: boolean}): void {
    if (error) {
        console.log(execname + ": Failed: " + String(error));
        process.exit(1);
    }
    for (var accessor in ruleSet) {
        var perm = ruleSet[accessor];
        var permStr = (perm === true) ? "allow" : "deny";
        console.log("  accessor: '" + accessor + "' perm: '" +
                    permStr + "'");
    }
    process.exit(0);
}

function isAuthorizedCB(error: any, username: string, verdict: boolean): void {
    if (error) {
        console.log(execname + ": Failed: " + String(error));
        process.exit(1);
    }
    console.log("verdict: " + verdict);
    process.exit(0);
}

var gArgParser = getArgParser();

function authorizationUtilMain(): void {
    var argv = gArgParser.getArgv();
    var owner;
    var restype;
    var resname;
    var accessor;
    var perm;

    gRemoteDebug = 2;
    initializeModeDetection();

    execname = argv[1];
    if (argv.length < 3) {
        Usage();
    }

    var cmd = argv[2];

    var dbName = gArgParser.getArg("mongodb", "cdlpersistence");

    gRemoteDebug = gArgParser.getArg("debugRemote", 1);

    RemotingLog.log(1, "debug is on (" + gRemoteDebug + ")");

    var baseAuthDir = gArgParser.getArg("baseAuthDir", "/var/www");
    WSAuth.wwwRoot = baseAuthDir;
    var authRootDir = gArgParser.getArg("authRootDir", undefined);
    if (typeof(authRootDir) !== "undefined") {
        WSAuth.wwwRoot = authRootDir;
    }
    RemotingLog.log(3, "WSAuth.wwwRoot set to '" + WSAuth.wwwRoot + "'");

    Authorization.useAuthFiles = gArgParser.getArg("useAuthFiles", false);

    var authorization = new Authorization(mongojs(dbName),
                                          WSAuth.wwwRoot + "/auth/user_email");

    if (cmd === "listOwner") {
        if (argv.length !== 3) {
            Usage();
        }
        authorization.getOwnerList(printOwnerList);
    } else if (cmd === "setPerm") {
        if (argv.length !== 8) {
            Usage();
        }

        owner = argv[3];
        restype = argv[4];
        if (restype === '*') {
            restype = Authorization.wildcard;
        }

        resname = argv[5];
        if (resname === '*') {
            resname = Authorization.wildcard;
        }

        accessor = argv[6];
        if (accessor === '*') {
            accessor = Authorization.wildcard;
        }

        if (argv[7] === "allow") {
            perm = true;
        } else if (argv[7] === "deny") {
            perm = false;
        } else if (argv[7] === "DELETE") {
            perm = "DELETE";
        } else {
            Usage();
        }
        authorization.updateRule(owner, restype, resname, accessor,
                                 perm, setPermCB);
    } else if (cmd === "showResources") {
        if (argv.length !== 4) {
            Usage();
        }

        owner = argv[3];
        authorization.getOwnerResourceList(owner, printOwnerResourceList);
    } else if (cmd === "printRules") {
        if (argv.length !== 6) {
            Usage();
        }

        owner = argv[3];
        restype = argv[4];
        if (restype === '*') {
            restype = Authorization.wildcard;
        }

        resname = argv[5];
        if (resname === '*') {
            resname = Authorization.wildcard;
        }
        authorization.getResourcePolicy(owner, restype, resname, printRuleCB);
    } else if (cmd === "isAuthorized") {
        if (argv.length !== 7) {
            Usage();
        }

        owner = argv[3];
        restype = argv[4];

        resname = argv[5];

        accessor = argv[6];

        authorization.isAuthorized(argv[3], argv[4], argv[5], argv[6],
                               isAuthorizedCB);
    } else {
        console.log(execname + ": unknow command '" + cmd + "'");
        Usage();
    }
}

authorizationUtilMain();
