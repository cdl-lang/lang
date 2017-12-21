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

/// <reference path="externalTypes.ts" />
/// <reference path="utilities.ts" />
/// <reference path="xdr.ts" />
/// <reference path="../remoting/wsAuth.ts" />
/// <reference path="../remoting/remoteMgr.ts" />

//
// AppStateMgr maintains a flat table, indexed by strings, of moon values.
// the indices are 'appStateIds', intended to be some 1-1 function
//   <persistent-area-id> X <area-data-object-path>  --> string
// such that each unique path in the area-data-object of each unique area
// has its own distinct index string in the table.
//
// AppStateMgr can be deployed locally, such that app-state values are preserved
//  across destroy/create cycles of areas in a given session;
//  or it can be deployed in 'remote=true' mode, where it contacts a remote
//  server, attempts to load the state from a previous session - if there was
//  one, and continues to synchronize the state to the server.
//
// methods:
//  load(): contacts a remote-server an subscribes for app-state updates, so
//         that this agent is notified of app-state changes
//
//  resourceUpdate(obj, ident): callback by which the remoteMgr notifies
//      about changes to the appState received over the wire. The first
//      argument 'obj' is the set of changes, where the attribute in obj denotes
//      a specific app-state element in a specific area, and its value is the
//      up-to-date value it should be changed to.
//      appStateObj[attr] stores the address of the associated EvaluationWrite,
//       if the EvaluationWrite of 'attr' registered to get notifications.
//
//  register(appStateId, appStateObj): this is the method EvaluationWrite nodes
//      use to register themselves with an 'appStateId' string representing the
//      area-id/area-data-object-path they are associated with. 
//      EvaluationWrite nodes are notified by calling their .remoteUpdate()'
//      method
//      AppStateMgr registers back as a watcher with each registering
//       EvaluationWrite by calling its 'addWatcher' method. This ensures that
//       the evaluationWrite node would always be active, so that it would in
//       fact evaluate its value and convey it to AppStateMgr.
//       
//  get(appStateId): this method returns the value currently stored for the
//      given appStateId
//
//  set(appStateId, value): set the value element associated with appStateId to
//      store the value 'value'. If a remote server is connected, schedule
//      a message notifying the remote server of this new value.
//

interface AppStateInfo {
    errorId: number[];
    errorMessage: string[];
    serverAddress: string[];
    serverPort: number[];
    serverPath: string[];
    protocol: string[];
    owner: string[];
    appName: string[];
    connectionState: string[];
    loginStatus: string[];
}

interface AppStateInfoConsumer {
    appStateInfoUpdate(ident: string, appStateInfo: AppStateInfo): void;
}

enum AppStateMgrLoginAction {
    none,
    clearNotPersistedAppState,
    writeCurrentAppState
}

class AppStateMgr implements Watcher, RemoteResourceUpdateClientToServer, ResourceConsumer
{
    // this is the local flat table storing all app-state values indexed by
    //  their appStateId
    appStateDB: {[ident: string]: any} = {};

    // this table stores EvaluationWrite addresses for those EvaluationWrite
    //  ndoes that register()ed to be notified by calling their '.remoteUpdate()
    appStateObj: {[ident: string]: EvaluationWrite} = {};

    // handle to the gRemoteMgr link
    appStateHandle: number = undefined;

    // the appStateInfo is exported to 'appStateInfoConsumers', and is
    //  ultimately made available to the cdl author
    appStateInfo: AppStateInfo = {
        errorId: [1],
        errorMessage: [""],
        connectionState: ["not connected"],
        serverAddress: [],
        serverPort: [],
        serverPath: [],
        protocol: [],
        owner: [],
        appName: [RemoteMgr.getAppName()],
        loginStatus: ["not logged in"]
    };

    nextInfoConsumerId: number = 1;

    appStateInfoConsumer: {
        [consumerId: number]: {
            consumer: AppStateInfoConsumer;
            ident: string;
        }
    } = {};

    watcherId: number;
    dataSourceAware: boolean = false;
    totalUpdateInputTime: number;
    totalAttributedTime: number;
    attributedTime: number;
    loggedIn: boolean = false;

    constructor() {

        var argParse: ArgParse = getArgParser();

        this.watcherId = getNextWatcherId();

        // 'doRemote' defaults to true if the agent's url scheme is 'https:',
        //   and to false otherwise. It can be overridden with the 'remote'
        //   url argument
        // The app-state server defaults to the web-server when using https, and
        //  to 'localhost' otherwise
        // the app-state port defaults to '8080', unless the variable
        //  'remoteServerPort' is defined to some other number (which becomes
        //   the default)
        // the app-state (url) path defaults to '/', unless the variable
        //  'webBasePath' is defined (in which case the value of 'webBasePath'
        //  becomes the default)
        // The 'user' for authentication is taken from the 'mauth' cookie, and
        //  (currently) cannot be affected by the agent
        // The 'owner' defaults to 'user', unless the scheme is https and
        //  there's an 'mauth' cookie, in which case the owner defaults
        //  to the user to which the mauth cookie was granted (owner can
        //  be controlled by the url argument 'appStateOwner')
        //
        var doRemoteDefault = false;
        var defaultServer = "127.0.0.1"; // to avoid problems with dns lookup under internet outage
        var defaultPort = 8080;
        var defaultPath = "/";
        var defaultOwner = "anonymous";

        var location = getWindowLocation();
        if (location && location.protocol && (location.protocol === "https:")) {
            doRemoteDefault = true;
            defaultServer = location.hostname;
        }

        var doRemote: any = argParse.getArg("remote", doRemoteDefault);

        if ((doRemote !== true) && (doRemote !== "true") && (doRemote != 1)) {
            return;
        }

        if (location && location.protocol && (location.protocol === "https:")) {
            var cookieUser = CookieAuth.getCookieUserName();
            if (typeof(cookieUser) === "string") {
                defaultOwner = cookieUser;
            }
        }

        // When the environment defines remoteServerPath, traffic is routed via
        // apache
        if (typeof(remoteServerPath) === "string") {
            defaultPort = 443;
            defaultPath = remoteServerPath;
        } else {
            if (typeof(remoteServerPort) === "number") {
                defaultPort = remoteServerPort;
            }
            if (typeof(wwwBaseUrlPath) === "string") {
                defaultPath = wwwBaseUrlPath;
            }
        }

        if (typeof(appStateOwner) === "string") {
            defaultOwner = appStateOwner;
        }

        var port = argParse.getArg("port", defaultPort);
        this.appStateInfo.serverPort =
            [ argParse.getArg("appStatePort", port) ];

        this.appStateInfo.serverPath = [
            argParse.getArg("appStatePath", defaultPath) ];

        this.appStateInfo.owner = [
            argParse.getArg("appStateOwner", defaultOwner) ];

        var server = argParse.getArg("server", defaultServer);
        this.appStateInfo.serverAddress =
            [ argParse.getArg("appStateServer", server) ];

        this.appStateInfo.protocol = [ argParse.getArg("protocol", "wss") ];

        this.appStateInfoNotify();

        if (gProfile) {
            this.totalUpdateInputTime = 0;
            this.attributedTime = 0;
        }
    }

    load() {

        if (this.appStateInfo.serverAddress.length === 0 ||
              typeof(this.appStateInfo.serverAddress[0]) === "undefined") {
            return;
        }

        var hostSpec = {
            protocol: this.appStateInfo.protocol[0],
            hostName: this.appStateInfo.serverAddress[0],
            port: this.appStateInfo.serverPort[0],
            path: this.appStateInfo.serverPath[0]
        };

        var appStateSpec = {
            type: "appState",
            app: this.appStateInfo.appName[0],
            owner: this.appStateInfo.owner[0]
        };

        // should only load once
        assert(typeof(this.appStateHandle) === "undefined",
               "load a single appState");

        // xdrAppStateElement describes how a resource element is to be
        //  marshalled/unmarshalled to/from the connection
        // getIdentString describes how to generate a unique string identifier
        //  out of a resource element
        this.appStateHandle = gRemoteMgr.subscribe(
            this, hostSpec, appStateSpec,
            XDR.xdrAppStateElement, AppStateMgr.getIdentString, "appState");
        gRemoteMgr.registerForLoginStatusUpdates(this);
        
        this.appStateInfo.connectionState = ["connecting"];
        this.appStateInfoNotify();
        
    }

    static getIdentString(appStateElem: AppStateElement): string {
        var ident: AppStateIdentifier = appStateElem.ident;

        return AppStateIdentifier.getHashStr(ident);
    }

    // Called by the remoting manager.
    // Push the updates to the writable nodes. Note that these will immediately
    // mark themselves as changed and trigger the content task.
    resourceUpdate(obj: any, ident: string): void {
        assert(ident === "appState", "expecting 'appState' resources");

        if (ident === "appState") {

            if (globalDebugTracingLog !== undefined) {
                globalDebugTracingLog.newCycle(0);
            }        

            for (var eid in obj) {
                var value: any = obj[eid].value;

                // xdrDeleteIdent is a fixed value indicating that this
                // identifier was deleted in the server, and thus should be
                // deleted in this agent too
                if (value === xdrDeleteIdent) {
                    delete this.appStateDB[eid];
                } else {
                    this.appStateDB[eid] = value;
                }

                var evaluationWrite: EvaluationWrite = this.appStateObj[eid];
                if (evaluationWrite !== undefined) {
                    // notify the write evaluation-node that
                    // the value is to be removed/modified
                    if (value === xdrDeleteIdent) {
                        evaluationWrite.remoteDelete();
                    } else {
                        evaluationWrite.remoteUpdate(value);
                    }
                }
            }
        }
    }

    // This callback method is called by the remoting-manager to notify about
    // changes to the state of the remote connection
    resourceConnectionStateUpdate(errorId: number, errorMessage: string,
                                  ident: string): void
    {
        assert(ident === "appState", "expecting 'appState' resources");
        if (errorId !== 0) {
            this.resetTemplateIndexIds();
        }
        this.appStateInfo.errorId = [errorId];
        this.appStateInfo.errorMessage = [errorMessage];
        this.appStateInfo.connectionState = [errorId === 0? "connected": "error"];
        this.appStateInfoNotify();
        if (errorId === 0) {
            this.loggedIn = true;
            globalSystemEvents.notifyHandlers(["login"]);
        } else {
            this.loggedIn = false;
            this.notifyAppStateSubscribersOfError();
            this.appStateInfoNotify();
        }
    }

    getIdentHashStr(ident: AppStateIdentifier): string {
        return AppStateIdentifier.getHashStr(ident);
    }

    get(ident: AppStateIdentifier): any {
        var appStateId = this.getIdentHashStr(ident);

        return this.appStateDB[appStateId];
    }

    set(ident: AppStateIdentifier, value: any): void {
        var appStateId = this.getIdentHashStr(ident);
        this.appStateDB[appStateId] = value;
        if (this.appStateHandle !== undefined && this.loggedIn) {
            gRemoteMgr.write(this.appStateHandle, ident, value);
        }
    }

    register(ident: AppStateIdentifier, appStateObj: EvaluationWrite): void {
        var appStateId = this.getIdentHashStr(ident);
        assert(! (appStateId in this.appStateObj),
               "register each appState element once");
        this.appStateObj[appStateId] = appStateObj;
        appStateObj.addWatcher(this, ident, false, true, false);
    }

    unregister(ident: AppStateIdentifier): void {
        var appStateId = this.getIdentHashStr(ident);
        this.appStateObj[appStateId].removeWatcher(this, true, false);
        delete this.appStateObj[appStateId];
    }

    // called by watched EvaluationWrite nodes when they change
    updateInput(ident: AppStateIdentifier, result: Result): void {
        // perhaps valueOrigin can be moved to a Result label, saving this
        //  additional lookup
        var appStateId = this.getIdentHashStr(ident);
        var appStateObj = this.appStateObj[appStateId];

        // ignore "init" and "remote origin;
        //  "init" - indicates this is the "default" initial value
        //  "remote" - indicates that this value was not written here but is
        //  rather the application of a remote notification
        if (appStateObj.valueOrigin === "write") {
            this.set(ident, result.value);
        }
    }

    // Signals that the app state is in error
    notifyAppStateSubscribersOfError(): void {
        for (var appStateId in this.appStateObj) {
            this.appStateObj[appStateId].remoteError();
        }
    }

    // a consumer calls this method in order to register with AppStateMgr for
    //  notifications about updates of appStateInfo
    appStateInfoRegister(consumer: AppStateInfoConsumer, ident: string): number {
        var consumerId: number = this.nextInfoConsumerId++;
        this.appStateInfoConsumer[consumerId] = {
            consumer: consumer,
            ident: ident
        };

        return consumerId;
    }

    appStateInfoUnregister(consumerId: number): void {
        delete this.appStateInfoConsumer[consumerId];
    }

    getAppStateInfo(): AppStateInfo {
        return this.appStateInfo;
    }

    // this internal method is called to notify appStateInfo consumers about
    //  changes to appStateInfo
    appStateInfoNotify(): void {
        for (var consumerId in this.appStateInfoConsumer) {
            var entry: {
                consumer: AppStateInfoConsumer;
                ident: string;
            } = this.appStateInfoConsumer[consumerId];
            var consumer: AppStateInfoConsumer = entry.consumer;
            consumer.appStateInfoUpdate(entry.ident, this.appStateInfo);
        }
    }

    // Signal that all writes have been acknowledged
    allRequestsAcknowledged(): void {
    }

    // handle additional information provided by the write acknowledgement
    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void {
    }

    isActive(): boolean {
        return true;
    }

    isReady(): boolean {
        return true;
    }

    isDeferred(): boolean {
        return false;
    }

    defer(): void {
        throw "Should not be called";
    }

    undefer(): void {
        throw "Should not be called";
    }

    debugName(): string {
        return "appStateMgr";
    }

    getDebugOrigin(): string[] {
        return ["appStateMgr"];
    }

    // Part of the RemoteResourceUpdate interface for the server

    id: number;

    signalTermination(reason: string): void {
        throw new Error('Method not implemented.');
    }

    // Object that implements paid translation

    remotePaidInterface = new RemotePaidInterface(gPaidMgr);

    getTemplateIndexAdmin(): TemplateIndexInformationChannel {
        return this.remotePaidInterface;
    }

    getTemplateIndexIdUpdates(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined {
        return this.remotePaidInterface.getTemplateIndexIdUpdates();
    }

    resetTemplateIndexIds(): void {
        this.remotePaidInterface.resetChannel();
    }

    defineRemoteTemplateIndexIds(definitionList: any): void {
        if (definitionList instanceof Array) {
            for (var i = 0; i < definitionList.length; i++) {
                var def = definitionList[i];
                if (isXDRTemplateDefinition(def)) {
                    this.remotePaidInterface.addRemoteTemplateDefinition(def);
                } else if (isXDRIndexDefinition(def)) {
                    this.remotePaidInterface.addRemoteIndexDefinition(def);
                } else {
                    RemotingLog.log(4, function() {
                        return "not an XDR template or index definition: " + JSON.stringify(def);
                    });
                }
            }
        } else {
            RemotingLog.log(4, function() {
                return "not an XDR template or index definition list: " + JSON.stringify(definitionList);
            });
        }
    }

    logout(): void {
        this.loginAction = AppStateMgrLoginAction.none;
        if (this.appStateHandle !== undefined) {
            this.resetTemplateIndexIds();
            gRemoteMgr.logout(this.appStateHandle);
            this.appStateHandle = undefined;
        }
        this.appStateDB = {};
        if (this.loggedIn) {
            this.loggedIn = false;
            globalSystemEvents.notifyHandlers(["logout"]);
        }
        this.appStateInfo.owner = ["anonymous"];
        if (this.appStateInfo.errorId[0] === 0) {
            this.appStateInfo.errorId = [1];
            this.appStateInfo.errorMessage = [""];
            this.appStateInfo.connectionState = ["not authenticated"];
            this.appStateInfo.loginStatus = ["not logged in"];
            this.appStateInfoNotify();
        }
    }

    loginAction: AppStateMgrLoginAction = AppStateMgrLoginAction.none;

    login(username: any, password: any): void {
        var hostSpec = {
            protocol: this.appStateInfo.protocol[0],
            hostName: this.appStateInfo.serverAddress[0],
            port: this.appStateInfo.serverPort[0],
            path: this.appStateInfo.serverPath[0]
        };

        this.logout();
        this.loginAction = AppStateMgrLoginAction.clearNotPersistedAppState;
        gRemoteMgr.login(hostSpec, {username: username, password: password});
    }

    createAccount(username: any, password: any, email: string): void {
        var hostSpec = {
            protocol: this.appStateInfo.protocol[0],
            hostName: this.appStateInfo.serverAddress[0],
            port: this.appStateInfo.serverPort[0],
            path: this.appStateInfo.serverPath[0]
        };

        this.logout();
        this.loginAction = AppStateMgrLoginAction.writeCurrentAppState;
        gRemoteMgr.createAccount(hostSpec, {username: username, password: password, email: email});
    }

    loginStatusUpdate(username: string, authenticated: boolean, errorMessage: string): void {
        this.appStateInfo.owner = [username];
        if (authenticated) {
            if (this.appStateHandle === undefined) {
                this.load();
                this.resourceConnectionStateUpdate(0, "", "appState");
            }
            this.appStateInfo.loginStatus = ["logged in"];
        } else if (!authenticated) {
            this.appStateInfo.errorId = [1];
            this.appStateInfo.errorMessage = ["error logging in"];
            this.appStateInfo.connectionState = ["not connected"];
            this.appStateInfo.loginStatus = [errorMessage];
        }
        this.appStateInfoNotify();
    }

    resourceUpdateComplete(resourceId: number): void {
        if (resourceId === this.appStateHandle) {
            switch (this.loginAction) {
                case AppStateMgrLoginAction.clearNotPersistedAppState:
                    this.clearNotPersistedAppState();
                    break;
                case AppStateMgrLoginAction.writeCurrentAppState:
                    this.writeCurrentAppState();
                    break;
            }
            this.loginAction = AppStateMgrLoginAction.none;
        }
    }

    /// Removes the app state that was not on the server
    clearNotPersistedAppState(): void {
        for (var elemId in this.appStateObj) {
            if (this.appStateDB[elemId] === undefined) {
                var node = this.appStateObj[elemId];
                if (node.valueOrigin === "write") {
                    node.reinitialize();
                }
            }
        }
    }

    /// Forces all changes to be written to the persistence server
    writeCurrentAppState(): void {
        for (var elemId in this.appStateObj) {
            var node = this.appStateObj[elemId];
            this.updateInput(node.appStateIdentifier, node.result);
        }
    }
}

var gAppStateMgr: AppStateMgr = new AppStateMgr();

function printAppStateChanges(appStateChangeList: typeof gAppStateChangeList): void {
    var prevAppState: {[id: string]: any} = {};

    function analyzeDiff(prev: any, curr: any): any {
        var prevArr = ensureOS(prev);
        var currArr = ensureOS(curr);
        var rem = prevArr.filter(prevElt => currArr.every(currElt => !objectEqual(prevElt, currElt)));
        var add = currArr.filter(currElt => prevArr.every(prevElt => !objectEqual(prevElt, currElt)));
        
        return cdlify({add: add, remove: rem});
    }

    for (var i = 0; i < appStateChangeList.length; i++) {
        var appStateChange = appStateChangeList[i];
        var id: string = appStateChange.areaId + "." + appStateChange.path.join(".");
        var value: any = appStateChange.value;
        var diff: any = id in prevAppState? analyzeDiff(prevAppState[id], value): cdlify({init: value});
        console.log(id, diff);
        prevAppState[id] = appStateChange.value;
    }
}
