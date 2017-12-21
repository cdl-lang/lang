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
/// <reference path="../remotingLog.ts" />
/// <reference path="../resourceMgr.ts" />
/// <reference path="../remotingServerConnection.ts" />

// this file contains a simplistic remoting server
//
// the server maintains a set of resources through a ResourceMgr object.
// each resource is a flat table indexed by strings. values are arbitrary
//  moon values.
//
// each incoming client connection is serviced by
//  a separate 'RemotingServerConnection'.
//
// Options are
// - Connection:
//   - port=<portnr>, 8080 by default
//   - protocol=ws or protocol=wss (default)
//   - mongodb=<dbname> (default cdlpersistence), the name of the database
//     used for storing app data and tables
//   - localMode=<bool> (default false). When true, the server accepts
//     unauthorized connections from 127.0.0.1. It's uncertain if this is
//     protected from spoofing.
//   - addLocalPort=<nr> (by default none) Adds an extra port where this server
//     will listen to unencrypted traffic (ws) in local mode (see above).
//   - debugRemote=<number> (default 1); higher numbers give more log info
//     3 is usually ok for problem solving, 4 prints all messages
// - Certificate:
//   - host=<string>, by default the hostname of the machine
//   - keyFile=<path>, path to the key file, by default
//     "${HOME}/myCertificate/" + host + ".key"
//   - certificateFile=<path>, path to the certificate file, by default
//     "${HOME}/myCertificate/" + host + ".crt"
// - Authorization:
//   - baseAuthDir=<path> (default /var/www); path to the directory where the
//     password scripts are located. The script names are hard-coded.
//   - authRootDir=<path> (default /var/www), same as baseAuthDir
//   - useAuthFiles=bool: when true, read user/email and password hash
//     from file system; when false, read them from the mongo db
//   - allowAddingUsers: bool; when true, requests for new user are accepted
//   - publicDataAccess: bool; when true, access to table and metadata resources
//     is granted to everyone

var fs: typeof FS = require("fs");

class RemotingServer {

    networkServer: NetworkServer;
    authDB: MongoDB; ///< Shared db instance for authentication
    userActionLogDB: MongoDBCollectionHandle; ///< Shared collection for logging

    constructor(
        public serverParam: ServerOptions,
        public dbName: string,
        public resourceMgr: ResourceMgr
    ) {
        var self = this;

        if (!Authorization.useAuthFiles) {
            this.authDB = mongojs("userAdmin");
            this.userActionLogDB = this.authDB.collection("userLog");
        }
        this.networkServer = new NetworkServer(serverParam,
            function(networkServer: NetworkServer, options: any, socket: any, remotingServer: any, connectionAuthenticated: boolean) {
                return new RemotingServerConnection(networkServer, options, socket, remotingServer, self.authDB, connectionAuthenticated);
            }, 
            RemotingServerConnection.validateRequest,
            this);
    }
    
    getResourceMgr(): ResourceMgr {
        return this.resourceMgr;
    }
    
    getDBName(): string {
        return this.dbName;
    }

    shutdown(): void {
        if (this.authDB !== undefined) {
            this.authDB.close();
            this.authDB = undefined;
        }
        this.networkServer.shutdown();
        this.networkServer = undefined;
    }

    logUserAction(type: string, msg: any): void {
        if (this.userActionLogDB) {
            this.userActionLogDB.insert({
                ...msg,
                type: type,
                time: new Date(),
                db: this.dbName
            });
        }
    }
}

function readExternalDataSourceConfig(fileName: string): ExternalDataSourceSpecification[] {
    var configText = fs.readFileSync(fileName).toString();
    var config: ExternalDataSourceSpecification[] = JSON.parse(configText);

    if (!(config instanceof Object) || isNaN(config.length)) {
        throw "not a proper config file";
    }
    return config;
}

function main(): void {
    var server: RemotingServer = undefined;
    var resourceMgr: ResourceMgr = undefined;
    var addedLocalServerParam: ServerOptions = undefined;
    var localServer: RemotingServer = undefined;
    var edsConfig: ExternalDataSourceSpecification[] = [];

    gArgParser = getArgParser();
    gMaxMessageSize = gArgParser.getArg("gMaxMessageSize", gMaxMessageSize);
    baseDelay = gArgParser.getArg("baseDelay", baseDelay);
    sizeDependentDelay = gArgParser.getArg("sizeDependentDelay", sizeDependentDelay);
    directoryListingAllowed = gArgParser.getArg("directoryListingAllowed", directoryListingAllowed);

    var port: any = gArgParser.getArg("port", 8080);
    var protocol: any = gArgParser.getArg("protocol", "wss");
    var dbName: any = gArgParser.getArg("mongodb", "cdlpersistence");

    gRemoteDebug = gArgParser.getArg("debugRemote", 4);
    if (typeof(gRemoteDebug) !== "number") {
        gRemoteDebug = 0;
    }

    RemotingLog.log(1, "debug is on (" + gRemoteDebug + ")");

    Authorization.allowAddingUsers = gArgParser.getArg("allowAddingUsers", false);
    Authorization.publicDataAccess = gArgParser.getArg("publicDataAccess", false);
    Authorization.useAuthFiles = gArgParser.getArg("useAuthFiles", false);
    RemotingLog.log(1, "auth: addingUsers=" + Authorization.allowAddingUsers +
                       " publicDataAccess=" + Authorization.publicDataAccess +
                       " useAuthFiles=" + Authorization.useAuthFiles);

    // debugging:
    // process.on('beforeExit', function () {
    //     console.log("process.on: beforeExit");
    // } );
    // process.on('exit', function (code) {
    //    console.log("process.on: exit(" + code + ")");
    // } );

    var os: typeof OS = require("os");
    var hostname: any = gArgParser.getArg("host", os.hostname());
    var homeDir: string = process.env.HOME;
    var myCertDir: string = homeDir + "/myCertificate";
    var myKeyPath: string = myCertDir + "/" + hostname + ".key";
    var myCertPath: string = myCertDir + "/" + hostname + ".crt";
    var keyPath: any = gArgParser.getArg("keyFile", myKeyPath);
    var certPath: any = gArgParser.getArg("certificateFile", myCertPath);
    var externalDataSourceConfigFileName = gArgParser.getArg("externalDataSourceConfig", "");

    RemotingLog.log(2, "keyFile = " + keyPath + ", certFile = " + certPath);

    var baseAuthDir: any = gArgParser.getArg("baseAuthDir", "/var/www");
    WSAuth.wwwRoot = baseAuthDir;

    var authRootDir: any = gArgParser.getArg("authRootDir", undefined);
    if (typeof(authRootDir) !== "undefined") {
        WSAuth.wwwRoot = authRootDir;
    }
    RemotingLog.log(3, "WSAuth.wwwRoot set to '" + WSAuth.wwwRoot + "'");

    var serverParam: ServerOptions = {
        protocol: protocol,
        port: port,
        key: protocol === "wss"? fs.readFileSync(keyPath): undefined,
        certificate: protocol === "wss"? fs.readFileSync(certPath): undefined,
        fileServer: gArgParser.getArg("http", true),
        localMode: false
    };

    var localMode: any = gArgParser.getArg("localMode", false);
    if (localMode !== false) {
        if (localMode === true) {
            serverParam.localMode = true;
        } else if (localMode !== false) {
            RemotingLog.log(0, "Please set 'localMode' to 'true' or 'false'");
            process.exit(1);
        }
    }

    if (localMode === false) {
        var addedLocalPort: any = gArgParser.getArg("addLocalPort", undefined);
        if (isNaN(Number(addedLocalPort))) {
            addedLocalPort = undefined;
        } else {
            addedLocalPort = Number(addedLocalPort);
            addedLocalServerParam = {
                protocol: "ws",
                port: addedLocalPort,
                localMode: true,
                fileServer: false
            };
        }
    }

    if (externalDataSourceConfigFileName !== "") {
        edsConfig = readExternalDataSourceConfig(externalDataSourceConfigFileName);
    }

    function startServer(): void {
        resourceMgr = new ResourceMgr(dbName);
        resourceMgr.externalDataSources = edsConfig;
        server = new RemotingServer(serverParam, dbName, resourceMgr);
        if (addedLocalServerParam !== undefined) {
            localServer = new RemotingServer(addedLocalServerParam, dbName, resourceMgr);
        }
    }

    function stopServer(): void {
        if (localServer !== undefined) {
            localServer.shutdown();
            localServer = undefined;
        }
        server.shutdown();
        server = undefined;
        resourceMgr.reinitialize();
        RemotingLog.log(0, "server stopped");
    }

    process.on('uncaughtException', function (err) {
        try {
            RemotingLog.log(1, "uncaughtException(" + String(err) + ")");
            if (err.stack) {
                RemotingLog.log(1, "stack=" + err.stack);
            }
            stopServer();
            // startServer();
            // RemotingLog.log(0, "server restarted");
            RemotingLog.log(0, "cannot restart: TODO !!!");
            process.exit(1);
        } catch (e) {
            RemotingLog.log(0, "unrecoverable error");
            console.error(e);
            process.exit(1);
        }
    });

    // HangUP is the signal sent when the persistence server is killed on
    // purpose. It sends a signal to all connected clients.
    process.on('SIGHUP', function (err) {
        RemotingLog.log(0, "received HUP");
        resourceMgr.signalTermination("manual server shutdown");
        stopServer();
        RemotingLog.log(0, "exiting");
        process.exit(1);
    });

    startServer();
}

main();
