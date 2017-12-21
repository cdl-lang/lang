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
/// <reference path="../memoryXdr.ts" />
/// <reference path="../../feg/xdr.ts" />

interface ResourceUpdate {
    resourceUpdate(elementObj: any, consumerIdent: any, revision: number): void;
    allRequestsAcknowledged(resourceId: number): void;
}

/**
 * Takes a single subscription on a persistence server and repeats the resource
 * updates to all subscribed clients. Assumes all clients have the same paid
 * administration.
 * 
 * @class ServerMultiplexer
 * @implements {RemoteResourceUpdate}
 */
class ServerMultiplexer implements
  RemoteResourceUpdateClientToServer, ResourceConsumer
{
    watcherId: number = getNextWatcherId();
    appStateSpec: ResourceSpecification = undefined;
    serverSpec: HostSpec = undefined;
    serverId: number = undefined;
    exitOnError: boolean = true;

    initAppStateSpec(): void {
        this.appStateSpec = {
            type: "appState",
            app: gArgParser.getArg("appName", "<none>"),
            owner: gArgParser.getArg("owner", "anonymous")
        };
    }
    
    initRemote(defaultOpts: any = {}): void {
        var port =
            gArgParser.getArg("port", defaultOpts.port || 8080);
        var protocol =
            gArgParser.getArg("protocol", defaultOpts.protocol || "wss");
        var serverAddress =
            gArgParser.getArg("server", defaultOpts.server || "127.0.0.1");
        var caPath = gArgParser.getArg("cacert",
                                   defaultOpts.cacert || "certutil/rootCA.pem");
        var caCert: Buffer =
            protocol === "wss"? fs.readFileSync(caPath): undefined;
        var username: string =
            gArgParser.getArg("user", defaultOpts.user || undefined);
        var password: string =
            gArgParser.getArg("password", defaultOpts.password || undefined);

        this.serverSpec = {
            protocol: protocol,
            hostName: serverAddress,
            port: port,
            ca: caCert,
            username: username,
            password: password
        };
        if (defaultOpts.exitOnError === false) {
            this.exitOnError = false;
        }
        this.initAppStateSpec();
    }

    getServerDBStr(): string {
        return this.serverSpec.protocol + "://" + this.appStateSpec.owner +
               "@" + this.serverSpec.hostName + ":" + this.serverSpec.port +
               "/" + this.appStateSpec.app;
    }
    
    subscribeServer(): void {
        this.serverId = gRemoteMgr.subscribe(
            this, this.serverSpec, this.appStateSpec, XDR.xdrAppStateElement,
            CmdClient.getIdentString, "remoteServer");
    }
    
    clients: Map<number, RemoteResourceUpdateClientToServer> = new Map<number, RemoteResourceUpdateClientToServer>();
    nextClientId: number = 1;

    /// This function gets called on a change in app-state and needs to be
    /// implemented in the derived class.
    resourceUpdate(elementObj: any, consumerIdent: any): void {
        this.clients.forEach(client => {
            client.resourceUpdate(elementObj, consumerIdent);
        });
    }

    allRequestsAcknowledged(): void {
        this.clients.forEach(client => {
            client.allRequestsAcknowledged();
        });
    }

    // handle additional information provided by the write acknowledgement
    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void {
    }

    resourceConnectionStateUpdate(errorId: any, errorMessage: string, ident: string): void {
        if (errorId !== 0) {
            console.log("connectionStateUpdate: error(" + errorId + "): " + errorMessage);
            if (this.exitOnError) {
                process.exit(1);
            }
        }
    }

    subscribe(client: RemoteResourceUpdateClientToServer): number {
        var clientId: number = this.nextClientId++;

        if (this.serverId === undefined) {
            this.subscribeServer();
        }
        this.clients.set(clientId, client);
        return clientId;
    }

    set(ident: RemoteIdentifier, value: any): void {
        gRemoteMgr.write(this.serverId, ident, value);
    }

    // Part of the RemoteResourceUpdate interface for the server

    id: number;

    signalTermination(reason: string): void {
        throw new Error('Method not implemented.');
    }

    getTemplateIndexAdmin(): TemplateIndexInformationChannel {
        var tiic: TemplateIndexInformationChannel = undefined;

        this.clients.forEach(function(client: RemoteResourceUpdateClientToServer): void {
            assert(false, "what are we doing here?");
        });
        return tiic;
    }

    getTemplateIndexIdUpdates(): (XDRTemplateDefinition|XDRIndexDefinition)[] {
        return undefined;
    }

    resetTemplateIndexIds(): void {
    }

    defineRemoteTemplateIndexIds(definitionList: any): void {
    }

    loginStatusUpdate(username: string, authenticated: boolean, errorMessage: string): void {
        this.clients.forEach(function(client: RemoteResourceUpdateClientToServer): void {
            client.loginStatusUpdate(username, authenticated, errorMessage);
        });
    }

    resourceUpdateComplete(resourceId: number): void {
        this.clients.forEach(function(client: RemoteResourceUpdateClientToServer): void {
            client.resourceUpdateComplete(resourceId);
        });
    }
}

var serverMultiplexer = new ServerMultiplexer();

/**
 * CmdClient is a class that facilitates connecting to a persistence server,
 * and communicating with it.
 * 
 * @class CmdClient
 */
abstract class CmdClient implements RemoteResourceUpdateClientToServer
{
    watcherId: number = getNextWatcherId();
    fileSpec: FileSpec;
    serverId: number;
    stringifySpacer: number;
    multiplexerId: number;

    initFile(argPath: string|undefined = undefined) {
        var path: string = gArgParser.getArg("path", argPath);
    
        if (!path) {
            console.log("Please specify file path");
            process.exit(0);
        }
        this.fileSpec = {
            path: path
        };
    }
    
    getFileDBStr(): string {
        return this.fileSpec.path;
    }
    
    static getIdentString(appStateElem: any): string {
        return AppStateIdentifier.getHashStr(appStateElem.ident);
    }

    writeFile(obj: any): void {
        var bytes = JSON.stringify(obj, undefined, this.stringifySpacer);
    
        try {
            fs.writeFileSync(this.fileSpec.path, bytes, {encoding: "utf8"});
        } catch (ex) {
            console.error("Writing to file '" + this.fileSpec.path + "' failed");
            console.error(ex);
        }
    }
    
    readFile(): any {
        var obj: any = undefined;
    
        try {
            var bytes = fs.readFileSync(this.fileSpec.path, "utf8");
            if (bytes) {
                obj = JSON.parse(bytes);
            }
        } catch (ex) {
            console.log("Reading from file '" + this.fileSpec.path + "' failed");
            console.error(ex);
        }
        return obj;
    }

    unset(ident: RemoteIdentifier): void {
        this.set(ident, xdrDeleteIdent);
    }
    
    set(ident: RemoteIdentifier, value: any): void {
        serverMultiplexer.set(ident, value);
    }

    subscribeServer(): void {
        this.multiplexerId = serverMultiplexer.subscribe(this);
    }

    abstract resourceUpdate(elementObj: any, consumerIdent: any): void;

    abstract allRequestsAcknowledged(): void;

    // Functions that should be implemented!

    getTemplateIndexAdmin(): TemplateIndexInformationChannel {
        throw new Error("Method not implemented.");
    }

    getTemplateIndexIdUpdates(): (XDRTemplateDefinition|XDRIndexDefinition)[] {
        throw new Error("Method not implemented.");
    }

    resetTemplateIndexIds(): void {
        throw new Error("Method not implemented.");
    }

    defineRemoteTemplateIndexIds(definitionList: any): void {
        throw new Error("Method not implemented.");
    }

    id: number;

    resourceConnectionStateUpdate(errorId: number, errorMessage: string, ident: any): void {
        throw new Error("Method not implemented.");
    }

    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void {
        throw new Error("Method not implemented.");
    }

    signalTermination(reason: string): void {
        throw new Error("Method not implemented.");
    }

    loginStatusUpdate(username: string, authenticated: boolean): void {
    }

    resourceUpdateComplete(resourceId: number): void {
    }
}
