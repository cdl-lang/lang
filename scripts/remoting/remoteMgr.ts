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

/// <reference path="../feg/externalTypes.basic.d.ts" />
/// <reference path="../feg/taskScheduler.ts" />
/// <reference path="../feg/xdr.ts" />
/// <reference path="remotingLog.ts" />
/// <reference path="networkClient.ts" />

//
// this file contains the remoteMgr code
//
// the remote-manager allows this agent to subscribe to remote resources.
// a resource is identified by a 'hostSpec' - the remote server address,
//  and a 'resourceSpec' - identifying a resource within the server.
//
// a resource is a flat table of attributes and arbitrary moon values.
// a resource element is an object with an 'ident:' attribute and a
//  'value:' attribute. A resource must be equipped with a function that
//  produces a unique identifier-string from an element, and an xdr function,
//  that converts a resource element to a json object ready to be transmitted
//  over the wire.
// (see xdr.ts for additional information about xdr conversion)
//
// The subscription request takes a 'consumer' object; the consumer is notified
//  about the initial elements in the resource, and later of any updates to
//  the resource, by calling its consumer.resourceUpdate() method
//
// The remote-manager maintains a single RemotingClientConnection object per
//  hostSpec
// Each subscription creates a unique resource instance
//
// The actual calls to the consumer's 'resourceUpdate()' method are done by
//  the resources.
//
//
// when a client connection has an error or is closed, the remoteMgr
//  shuts-down the connection, and later attempts to reconnect.
// reconnecting includes re-subscribing to all resources to which the agent
//  requested subscription to, and re-issuing of all write requests that
//  have not been acknowledged.
//
// public methods:
// ==============
//
// subscribe(consumer, hostSpec, resourceSpec, xdrFunc, identStrFunc,
//                                             consumerIdent): resourceId
//
//  the consumer should have a 'consumer.resourceUpdate()' method, which
//  is called with two arguments:
//   consumer.resourceUpdate(elementObj, consumerIdent)
//  where elementObj is an object whose attributes are the updates resource
//  elements, and their values are the up-to-date values.
//  'xdrFunc' defines how an element is to be converted to json for transmission
//    over a connection. This must be done internally, as the conversion may
//    depend on the connection.
//  'identStrFunc' is a function that takes an element and returns a unique
//    string representing the element's identifier
//
// unsubscribe(resourceId): void
//
//  cancel a previous subscription
//
//
// write(resourceId, attr, value): void
//
//  the resource associated with resourceId is to be updated by adding/modifying
//   its element 'attr' to 'value'.
//
//
// flush(): void
//
//    messages to the server are accumulated in the agent, and are only sent
//  after calling flush()
//
//
// 
//
// When the agent calls 'flush()', it creates a single 'write' message for
//  each resource, with the set of elements for which a 'write()' was requested.
// The write message is marked with a sequential 'ackId', and all the
//   element identifiers are marked as 'pending acknowledgement' (this
//   administration is managed per client, in the client object).
// The server should respond to a write request, acknowledging the write.
//
var gRemoteMgr: RemoteMgr;

function createRemoteMgr(): void {
    gRemoteMgr = new RemoteMgr();
    gRemoteDebug = gArgParser.getArg("debugRemote", 0);
}

interface RemoteClientAdminData {
    refCount: number;
    id: number;
    specHash: string;
}

interface ResourceConsumer {
    // Called when resource with identification ident has changed
    resourceUpdate(obj: any, ident: string, revision: number): void;

    resourceUpdateComplete(resourceId: number): void;

    // Change to the connection status
    resourceConnectionStateUpdate(errorId: number, errorMessage: string, ident: string): void;

    // Change to the login status
    loginStatusUpdate(username: string, authenticated: boolean, errorMessage: string): void;
    
    // Signal that all writes have been acknowledged
    allRequestsAcknowledged(resourceId: number): void;

    // handle additional information provided by the write acknowledgement
    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void;

    inboundProgressUpdate?(sequenceNr: number, receivedLen: number, totalLen: number): void;

    outboundProgressUpdate?(identities: any, elementObj: ResourceElementMapByIdent, receivedLen: number, totalLen: number): void;

    getTemplateIndexAdmin(): TemplateIndexInformationChannel;

    getTemplateIndexIdUpdates(): (XDRTemplateDefinition|XDRIndexDefinition)[]|undefined;

    resetTemplateIndexIds(): void;

    defineRemoteTemplateIndexIds(definitionList: any): void;
}

/**
 * Information needed to login, create an account, or change password
 */
interface RemoteAccountInfo {
    loginSeqNr?: number;
    username: string;
    password: string;
    newPassword?: string;
    email?: string;
}

interface RemotingConnection {
    connect(): void;
    destroy(): void;
    subscribe(rid: number, resourceSpec: ResourceSpecification): void;
    unsubscribe(rid: number): void;
    login(accountInfo: RemoteAccountInfo): void;
    createAccount(accountInfo: RemoteAccountInfo): void;
    logout(): void;
    releaseResource(rid: number): void;
    getAdminData(): RemoteClientAdminData;
    write(resourceId: number, elementObj: ResourceElementMapByIdent, ackId: number): void;
    getSubscribedResourceObj(): {[resourceId: number]: ResourceRevisionInfo};
    shutdown(msg: string, attemptReconnect: boolean): void;
    resubscribe(): void;
    resubmitWrite(): void;
    debugForceClose(timeout: number): void;
    debugRemainClosed: boolean;
    debugReleaseForceClose(): void;

    getTemplateIndexAdmin(): TemplateIndexInformationChannel;
    getIdentStrFunc(resourceId: number): IdentFunc;
    resetTemplateIndexIds(): void;
}

class RemoteMgr {

    nextClientId: number = 0;
    clientById: {[id: number]: RemotingConnection} = {};
    clientBySpecHash: {[hash: string]: RemotingConnection} = {};

    nextResourceId: number = 0;
    resourceById: {[id: number]: RemotingResource} = {};

    // when this is an object, remotingTask was scheduled, and the object
    //  elements are the clients that have pending messages that should be
    //  sent over the connection
    pendingWrite: {
        [clientId: number]: {
            [resourceId: number]: {
                [ident: string]: any
            }
        }
    } = undefined;

    pendingResources = new Set();
    
    reconnectScheduled: {[clientId: number]: RemotingConnection} = undefined;
    reconnectDelay: number = 3000;
    terminated: boolean = false;

    loginStatusUpdateClients: {[clientId: number]: RemoteResourceUpdateClientToServer} = {};
    
    hasPendingResources(): boolean {
        return this.pendingResources.size > 0;
    }
    
    subscribe(consumer: ResourceConsumer, hostSpec: HostSpec, resourceSpec: ResourceSpecification,
              xdrFunc: (elem: any, xdr: XDR) => any, identStrFunc: (elem: any) => string, consumerIdent: string): number {
        var clientId = this.getClient(hostSpec);
    
        if (clientId === undefined) {
            return undefined;
        }
    
        var resource = this.createResource(
            clientId, resourceSpec, xdrFunc, identStrFunc, consumer, consumerIdent);
    
        var rId = resource.getId();    
        
        this.pendingResources.add(rId);
    
        var client = this.clientById[clientId];
        client.subscribe(resource.getId(), resource.getSpec());
    
        return resource.getId();
    }
    
    unsubscribe(resourceId: number): void {
    
        this.pendingResources.delete(resourceId);
    
        // calls globalConcludeInitPhaseTask.schedule();
        // in order to move concludeInitiPhaseTask at the end of the queue
        unsubcribeResourceHook();
    
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
        var client = this.clientById[clientId];

        client.unsubscribe(resource.getId());
        this.destroyResource(resource);
        this.releaseClient(clientId);
    }

    loginCounter: number = 0;

    /**
     * Logs in for given parameters. Note that the client is released, so
     * a notification will only be given when there is at least one resource
     * connected.
     */
    login(hostSpec: HostSpec, accountInfo: RemoteAccountInfo): void {
        var clientId = this.getClient(hostSpec);

        this.loginCounter++;
        if (clientId !== undefined) {
            var client = this.clientById[clientId];
            client.login({...accountInfo, loginSeqNr: this.loginCounter});
            this.releaseClient(clientId);
        }
    }

    logout(resourceId: number): void {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
        var client = this.clientById[clientId];

        client.logout();
        this.unsubscribe(resourceId);
    }

    createAccount(hostSpec: HostSpec, accountInfo: RemoteAccountInfo): void {
        var clientId = this.getClient(hostSpec);
    
        this.loginCounter++;
        if (clientId !== undefined) {
            var client = this.clientById[clientId];
            client.createAccount({...accountInfo, loginSeqNr: this.loginCounter});
            this.releaseClient(clientId);
        }
    }

    registerForLoginStatusUpdates(client: RemoteResourceUpdateClientToServer): void {
        this.loginStatusUpdateClients[client.watcherId] = client;
    }

    unregisterForLoginStatusUpdates(client: RemoteResourceUpdateClientToServer): void {
        delete this.loginStatusUpdateClients;
    }

    loginStatusUpdate(username: string, authenticated: boolean, errorMessage: string, loginSeqNr: number): void {
        if (loginSeqNr === this.loginCounter) {
            for (var clientId in this.loginStatusUpdateClients) {
                var client = this.loginStatusUpdateClients[clientId];
                client.loginStatusUpdate(username, authenticated, errorMessage);
            }
        }
    }
    
    releaseResource(resourceId: number): void {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
        var client = this.clientById[clientId];
    
        client.releaseResource(resource.getId());
        this.destroyResource(resource);
        this.releaseClient(clientId);
    }
    
    getRemotingConnectionById(resourceId: number): RemotingConnection {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
    
        return this.clientById[clientId];
    }
    
    getClient(hostSpec: HostSpec): number {
        var hashStr = this.getHostSpecHash(hostSpec);
        var client = this.clientBySpecHash[hashStr];

        if (client === undefined) {
            client = this.clientBySpecHash[hashStr] =
                this.createClient(hostSpec, hashStr);
        }
        if (client === undefined) {
            return undefined;
        }
    
        var clientAdminData = client.getAdminData();
        clientAdminData.refCount++;
    
        return clientAdminData.id;
    }
    
    releaseClient(clientId: number): void {
        var client = this.clientById[clientId];

        if (client !== undefined) {
            var clientAdminData = client.getAdminData();
            clientAdminData.refCount--;
            if (clientAdminData.refCount <= 0) {
                this.destroyClient(client);
            }
        }
    }
    
    getHostSpecHash(hostSpec: HostSpec): string {
        return hostSpec.protocol + "://" + hostSpec.hostName + ":" + hostSpec.port +
               (hostSpec.path === undefined? "/": hostSpec.path);
    }
    
    createClient(hostSpec: HostSpec, specHash: string): RemotingConnection {
        var client = undefined;
     
        if (hostSpec.protocol === "wss" || hostSpec.protocol === "ws") {
            var id = this.nextClientId++;
            var clientAdminData = {
                refCount: 0,
                id: id,
                specHash: specHash
            };
            client = this.createNetworkClient(hostSpec, specHash, clientAdminData);
            this.clientById[id] = client;
        }
        return client;
    }
    
    createNetworkClient(hostSpec: HostSpec, specHash: string, clientAdminData: RemoteClientAdminData): RemotingConnection {
        var options = {
            poolSize: 100,
            poolDelay: 100
        };
    
        return new RemotingClientConnection(hostSpec, options, this,
                                            clientAdminData, gPaidMgr);
    }
    
    destroyClient(client: RemotingConnection): void {
        var clientAdminData = client.getAdminData();
    
        client.destroy();
        delete this.clientById[clientAdminData.id];
        delete this.clientBySpecHash[clientAdminData.specHash];
    }
    
    
    createResource(clientId: number, resourceSpec: ResourceSpecification,
                   xdrFunc: XDRFunc, identStrFunc: IdentFunc,
                   consumer: ResourceConsumer, consumerIdent: string): RemotingResource {
        var rid = this.nextResourceId++;
        var resource = new RemotingResource(
            rid, resourceSpec, clientId, xdrFunc, identStrFunc,
            consumer, consumerIdent);
    
        this.resourceById[rid] = resource;
        return resource;
    }
    
    destroyResource(resource: RemotingResource): void {
        var rid = resource.getId();
    
        delete this.resourceById[rid];
        resource.destroy();
    }
    
    // --------------------------------------------------------------------------
    // updateResource
    //
    // relay an update notification coming from the server to the resource
    //
    // 'updateRevision' is the last revision covered by this update.
    // 'fullSyncRevision' is the revision for which (after this update)
    // the client is fully synchronized (this includes write acknowledgements
    // for its own writes which do not leave gaps in teh revision sequence
    // with updates from the server).
    
    updateResource(resourceId: number, elementObj: ResourceElementMapByIdent,
                   updateRevision: number, fullSyncRevision: number): void {
        this.pendingResources.delete(resourceId);
    
        // calls globalConcludeInitPhaseTask.schedule();
        // in order to move concludeInitiPhaseTesk at the end of the queue
        unsubcribeResourceHook();
        
        var resource = this.resourceById[resourceId];
    
        if (resource === undefined) {
            mMessage("RemoteMgr.updateResource: No such resource " + resourceId);
        } else {
            resource.update(elementObj, updateRevision, fullSyncRevision);
        }
    }

    // --------------------------------------------------------------------------
    // write
    //
    // update the element whose identifier is 'ident' to store 'value'
    //
    // the change is noted, and would be affected when the remoting-task is
    //  scheduled, by calling the 'flush()' method
    //
    write(resourceId: number, ident: any, value: any): void {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
    
        if (typeof(this.pendingWrite) === "undefined") {
            this.pendingWrite = {};
            scheduleRemotingTask();
        }
    
        var clientEntry = this.pendingWrite[clientId];
        if (typeof(clientEntry) === "undefined") {
            clientEntry = this.pendingWrite[clientId] = {};
        }
        var resourceEntry = clientEntry[resourceId];
        if (resourceEntry === undefined) {
            resourceEntry = clientEntry[resourceId] = {};
        }
    
        var elem = { ident: ident, value: value };
    
        var client = this.clientById[clientId];
        if (client === undefined) {
            return;
        }
        var getIdentStr = client.getIdentStrFunc(resourceId);
        var identStr = getIdentStr(elem);
    
        RemotingLog.log(4, () => "RemoteMgr.write: " + identStr + "=" + cdlify(value));
        resourceEntry[identStr] = elem;
    }
    
    flush(): void {
        var pendingWrite = this.pendingWrite;
    
        if (pendingWrite === undefined) {
            return;
        }
        this.pendingWrite = undefined;
        for (var clientId in pendingWrite) {
            var client = this.clientById[clientId];
            if (client !== undefined) {
                var clientEntry = pendingWrite[clientId];
                for (var resourceId in clientEntry) {
                    var resourceEntry = clientEntry[resourceId];
                    client.write(Number(resourceId), resourceEntry, undefined);
                }
            }
        }
    }
    
    // --------------------------------------------------------------------------
    // getClientConsumerList
    //
    // return the list of consumers registered with 'client', a remoting client
    //  connection, for the set of resources of this client.
    // the returned list elements are of the form: { consumer:, ident: }
    //
    getClientConsumerList(client: RemotingConnection): {consumer: ResourceConsumer; ident: string;}[] {
        var consumerList = [];
        var resourceObj = client.getSubscribedResourceObj();
    
        for (var rid in resourceObj) {
            var resource = this.resourceById[rid];
            var consumer = resource.getConsumer();
            var consumerIdent = resource.getConsumerIdent();
            consumerList.push({ consumer: consumer, ident: consumerIdent});
        }
        return consumerList;
    }
    
    // --------------------------------------------------------------------------
    // notifyConnectionState
    //
    // notify each of the consumers in 'consumerList' that the connection state
    //  is now 'errorId/errorMessage'
    //
    notifyConnectionState(consumerList: {consumer: ResourceConsumer; ident: string;}[], errorId: number, errorMessage: string): void {
        
        // to do: delete resources affected by this error from this.pendingResources
        
        for (var i = 0; i < consumerList.length; i++) {
            var entry = consumerList[i];
            entry.consumer.resourceConnectionStateUpdate(
                errorId, errorMessage, entry.ident);
        }
    }
    
    /**
     * Called after a resource update and possible connection state notification;
     * informs consumers that the resource update for give resourceId has
     * been completed.
     * 
     * @param consumerList 
     * @param resourceId 
     */
    resourceUpdateComplete(consumerList: {consumer: ResourceConsumer; ident: string;}[], resourceId: number): void {
        for (var i = 0; i < consumerList.length; i++) {
            consumerList[i].consumer.resourceUpdateComplete(resourceId);
        }
    }
    
    clientOpenCB(client: RemotingConnection): void {
        var consumerList = this.getClientConsumerList(client);
    
        this.notifyConnectionState(consumerList, 0, "");
    }
    
    clientCloseCB(client: RemotingConnection, error: any): void {
        if (this.terminated) {
            return;
        }
        var consumerList = this.getClientConsumerList(client);
        this.notifyConnectionState(consumerList, 1, "connection closed: " +
                                   ((typeof(error) === "object") ? error.code : 
                                   "(unknown)"));
        client.shutdown("error", true);
        this.scheduleReconnect(client);
    }
    
    clientErrorCB(client: RemotingConnection, error: any): void {
        var consumerList = this.getClientConsumerList(client);
        this.notifyConnectionState(consumerList, 1, "connection error");
        client.shutdown("connection error", true);
        this.scheduleReconnect(client);
    }
    
    terminate(client: RemotingConnection, reason: string): void {
        if (this.terminated) {
            return;
        }
        this.terminated = true;
        for (var id in this.resourceById) {
            this.resourceById[id].terminate(reason);
        }
        gAppStateMgr.resourceConnectionStateUpdate(2, reason, "appState");
        client.shutdown("terminated", false);
    }

    reloadApplication(client: RemotingConnection, reason: string): void {
        if (this.terminated) {
            return;
        }
        this.terminated = true;
        gAppStateMgr.resourceConnectionStateUpdate(3, reason, "appState");
        client.shutdown("reloadApplication", false);
    }

    // --------------------------------------------------------------------------
    // reconnect
    //
    // reconnectClient is an objects whose values are clients that should be
    //  reconnected
    //
    reconnect(reconnectClient: {[clientId: number]: RemotingConnection}): void {
        for (var clientId in reconnectClient) {
            var client = reconnectClient[clientId];
    
            if (client.debugRemainClosed) {
                // reconnection manually blocked (for debugging)
                this.scheduleReconnect(client);
                return;
            }
            
            // attempt to reestablish connection with the server
            client.connect();
    
            // re-subscribe with the server for all active subscriptions
            client.resubscribe();
    
            // if there are any writes for which no acknowledgement has been
            // received, send them again.
            client.resubmitWrite();
        }
    }
    
    // --------------------------------------------------------------------------
    // scheduleReconnect
    //
    // a RemoteMgr has at most a single active reconnect-timeout; additional
    //  clients which need to reconnect might have reconnection attempted
    //  earlier than they requested
    //
    scheduleReconnect(client: RemotingConnection): void {
        var that = this;
    
        function callReconnect(): void {
            var reconnectClient = that.reconnectScheduled;
            that.reconnectScheduled = undefined;
            that.reconnect(reconnectClient);
        }
    
        if (this.reconnectScheduled === undefined) {
            this.reconnectScheduled = {};
            setTimeout(callReconnect, this.reconnectDelay);
        }
    
        var clientAdminData = client.getAdminData();
        var clientId = clientAdminData.id;
        this.reconnectScheduled[clientId] = client;
    }
    
    // Clears the template and index administration and triggers resend. This is ok
    // as long as the ids cannot have changed, e.g. on reconnect.
    resetTemplateIndexIds(): void {
        for (var resourceId in this.clientById) {
            this.clientById[resourceId].resetTemplateIndexIds();
        }
    }
    
    //
    // Debugging
    //
    
    // This forces the closure of all client connections (of this remoting
    // manager). This is for debugging purposes only.
    // If 'timeout' is specified then it should be the time (in milliseconds)
    // until the connection is allowed to be established again (it may take
    // a little longer to establish the connection). If timeout is 0 or
    // undefined, the connection will remain closed until
    // debugReleaseForceClose() is called.
    
    debugForceClose(timeout: number): void {
        if (!this.clientById) {
            return;
        }
        for (var clientId in this.clientById) {
            this.clientById[clientId].debugForceClose(timeout);
        }
    }
    
    // This releases the forced closure of all client connections (of this
    // remoting manager). The clients then try to reconnect. 
    
    
    debugReleaseForceClose(): void {
        if (!this.clientById) {
            return;
        }
        for (var clientId in this.clientById) {
            this.clientById[clientId].debugReleaseForceClose();
        }
    }

    // getAppName (static)
    //
    // parse the application name out of the url
    //
    // from this:
    // http://host/p1/p2/p3/app.html?query-string
    // extract just 'app' .
    //
    // this arguably makes too many assumptions on how a url looks like and what is
    //  the correct identifier of an application; it also doesn't really belong in
    //  this file
    //
    static appName: string = undefined;

    static getAppName(): string {
        if (RemoteMgr.appName === undefined) {
            var argParser = getArgParser();
            var appName = argParser.getAppName();

            var slashIdx = Math.max(appName.lastIndexOf("/"),
                                    appName.lastIndexOf("\\"));
            if (slashIdx >= 0) {
                appName = appName.slice(slashIdx + 1);
            }

            if (appName.slice(-8) === ".node.js") {
                appName = appName.slice(0, -8);
            } else if (appName.slice(-5) === ".html") {
                appName = appName.slice(0, -5);
            } else if (appName.slice(-4) === ".htm") {
                appName = appName.slice(0, -4);
            }

            RemoteMgr.appName = argParser.getArg("appName", appName);
        }

        return RemoteMgr.appName;
    }
}

// RemotingClientConnection is instantiated per unique server to which
//  remoting needs to connect. The single message type it expects is
//  'resourceUpdate', notifying of modifications to a subscribed resource.
//
// Write acknowledgements are handled by the RemotingClientConnection.
//  This object tracks which writes are awaiting acknowledgement.
// A resource element may be written several times before receiving the first
//  server acknowledgement. Hence each resource identifier is stored in the
//  'pending-acknowledgement' table alongside the latest ackId it is waiting
//  for. An ackId received from the server removes an element identifier from
//  the pending state only if the ackId sent by the server matches the ackId
//  stored in the 'pending' table with the element's identifier.

interface ResourceRevisionInfo {
    spec: ResourceSpecification;
    revision: number|undefined;
    ackRevision: number[];
    ackRevisionByIdent: any;
}

class RemotingClientConnection extends NetworkClientConnection
implements RemotingConnection {

    // indexed by resource-ids;
    // each resource entry is indexed by elements;
    // each resource-element entry stores the sequence-id that is waiting
    //  remote-server acknowledgedment; the value is the latest 'ackId'
    pendingAcknowledge: {
        [resourceId: number]: {
            [element: string]: {
                ackId: number;
                entry: any;
                queuedUpdate?: any // TODO: CHECK TYPE !!!
            }
        }
    } = {};
    // stores the number of elements awaiting acknowledgement (for each
    // resource separately)
    nPendingAcknowledge: {[resourceId: number]: number} = {};

    nextAckId: number = 1;

    // ClientConnection
    subscribedResource: {[resourceId: number]: ResourceRevisionInfo} = {};

    // persistent area and index id translation per connection
    remotePaidMgr: RemotePaidInterface;

    constructor(
        hostSpec: HostSpec,
        options: any,
        public remoteMgr: RemoteMgr,
        public adminData: RemoteClientAdminData,
        public paidMgr: PaidMgrInterface
    ) {
        super(hostSpec, options);

        this.remotePaidMgr = new RemotePaidInterface(paidMgr);
        
        this.addMessageHandler("resourceUpdate", this.resourceUpdateHandler);
        this.addMessageHandler("terminate", this.terminationHandler);
        this.addMessageHandler("reloadApplication", this.reloadHandler);
        this.addMessageHandler("define", this.defineHandler);
        this.addMessageHandler("loginStatus", this.loginStatusHandler);
    
        this.setOutboundProgressHandler(this.resourceOutboundProgressHandler);
        this.setInboundProgressHandler(this.resourceInboundProgressHandler);
        
        this.addEventHandler("error", this.networkErrorHandler);
        this.addEventHandler("close", this.networkCloseHandler);
        this.addEventHandler("open", this.networkOpenHandler);
    }

    destroy(): void {
        this.pendingAcknowledge = undefined;
        this.nPendingAcknowledge = undefined;
        this.subscribedResource = undefined;
        this.remoteMgr = undefined;
        super.destroy();
    }

    connect(): void {
        this.initDef();
        super.connect();
    }

    // --------------------------------------------------------------------------
    // subscribe
    //
    // subscribe with the remote manager for updates on the resource identified by
    //  'resourceSpec', which this client is going to refer to as 'rid'
    //
    subscribe(rid: number, resourceSpec: ResourceSpecification): void {
        var subReqObj = this.subscribedResource[rid] = {
            spec: resourceSpec,
            // revision for which full update was received
            revision: <number>undefined,
            // revision(s) for which write acknowledgements were received
            // but where there are gaps with the update revision.
            // Stored as a array decribing a sequence of ranges.
            // See updateSubscribedResourceRevision() for details
            ackRevision: <number[]>undefined,
            // When there are acknowledgement revisions in 'ackRevision',
            // the 'ackRevisionByIdent' stores as attributes the identifiers
            // of the objects for which the acknowledgements were received and
            // under each such attribute the highest revision for which it
            // was received. Entries in this table are cleared once 'ackRevision'
            // is cleared (or when an update for a specific identity is
            // received with a higher revision number).
            ackRevisionByIdent: <any>undefined
        };
    
        this.sendSubscriptionRequest(rid, subReqObj);
    }
    
    unsubscribe(rid: number): void {
        this.sendUnsubscribeRequest(rid);
        delete this.subscribedResource[rid];
    }
    
    login(accountInfo: RemoteAccountInfo): void {
        this.sendMessage({
            type: "login",
            username: accountInfo.username,
            password: accountInfo.password,
            loginSeqNr: accountInfo.loginSeqNr
        });
    }

    logout(): void {
        this.sendMessage({type: "logout"});
    }

    createAccount(accountInfo: RemoteAccountInfo): void {
        this.sendMessage({
            type: "createAccount",
            username: accountInfo.username,
            password: accountInfo.password,
            email: accountInfo.email,
            loginSeqNr: accountInfo.loginSeqNr
        });
    }

    releaseResource(rid: number): void {
        this.sendReleaseResourceRequest(rid);
        delete this.subscribedResource[rid];
    }
    
    sendSubscriptionRequest(rid: number, subReqObj: ResourceRevisionInfo): void {
        this.sendMessage({
            type: "subscribe",
            resourceId: rid,
            resourceSpec: subReqObj.spec,
            revision: subReqObj.revision
        });
    }
    
    sendUnsubscribeRequest(rid: number): void {
        this.sendMessage({
            type: "unsubscribe",
            resourceId: rid
        });
    }
    
    sendReleaseResourceRequest(rid: number): void {
        this.sendMessage({
            type: "releaseResource",
            resourceId: rid
        });
    }
    
    
    // --------------------------------------------------------------------------
    // resubscribe
    //
    // this method should be called after reconnecting a client
    // it sends subscription requests to all the subscribed resources, as recorded
    //  in this.subscribedResource
    //
    resubscribe(): void {
        this.remoteMgr.resetTemplateIndexIds();
        for (var rid in this.subscribedResource) {
            this.sendSubscriptionRequest(Number(rid), this.subscribedResource[rid]);
        }
    }
    
    getNextAckId(): number {
        return this.nextAckId++;
    }
    
    // --------------------------------------------------------------------------
    // resubmitWrite
    //
    // this function is called as part of re-establishing a connection with
    //  a server. Its role is to resend all write requests that were not yet
    //  acknowledged by the server.
    // The function goes over the list of pending writes (those that did not
    //  receive an acknowledgement) and resends them (thy are then each assigned
    //  a new (and higher) ack ID.
    //
    resubmitWrite(): void {
    
        for (var resourceId in this.pendingAcknowledge) {
    
            if (this.nPendingAcknowledge[resourceId] === 0) {
                continue;
            }
            var resourceEntry = this.pendingAcknowledge[resourceId];
    
            var resourceWriteEntry: {[id: string]: ResourceElementMapByIdent} = {};
            for (var elementId in resourceEntry) {
                var elem = resourceEntry[elementId];
                resourceWriteEntry[elementId] = elem.entry;
            }
    
            this.write(Number(resourceId), resourceWriteEntry, undefined);
        }
    }
    
    // --------------------------------------------------------------------------
    // write
    //
    // request the server to apply the modifications described in elementObj to
    //  the (previously subscribed) resource 'rid'. 'ackId' is the acknowledgement
    //  number assigned to this request. If this is not provided, a new one
    //  will be generated by the client (an ackId is provided, for example, if
    //  this is a re-send of the write).
    //
    // when an ack is received, the <client>.writeAckHandler is called
    //
    // when a nack is recieved, notify the remoteMgr of an error
    //
    // the elements of 'elementObj' undergo 'xdr' to format their value in a way
    //  appropriate for output ('Marshal'ing) to this connection
    //
    write(resourceId: number, elementObj: ResourceElementMapByIdent, ackId: number): void {
        var writeList = [];
    
        // get the xdr function appropriate for marshalling elements for this
        //  resource of this connection
        var xdr = this.getXDRFunc(XDRDirection.Marshal, resourceId);
    
        for (var elementId in elementObj) {
            var element = elementObj[elementId];
            writeList.push(xdr(element));
        }
    
        // template/index definitions message precede their usage within
        //  a write message
        var idUpdates = this.remotePaidMgr.getTemplateIndexIdUpdates();
        if (idUpdates !== undefined) {
            this.sendMessage({
                type: "define",
                resourceId: resourceId,
                list: idUpdates
            });
        }
    
        if (ackId === undefined) {
            ackId = this.getNextAckId();
        }
        this.markWaitingAck(resourceId, elementObj, ackId);
        
        // request that the server ack/nack for this message would be delivered
        //  to 'this.writeAckHandler'
        this.sendMessage(
            {
                type: "write",
                resourceId: resourceId,
                list: writeList
            },
            this.writeAckHandler,
            { resourceId: resourceId, elementObj: elementObj, ackId: ackId }
        );
    }
    
    // --------------------------------------------------------------------------
    // markWaitingAck
    //
    // mark all of the elements in resourceObj as 'waiting for server ack' with
    //  the specified ackId;
    // for those elements that were not already in that state (because of a previous
    // request that was not yet acknowledged), increment the ack counter
    //
    markWaitingAck(resourceId: number, resourceObj: ResourceElementMapByIdent, ackId: number): void {
        var resourceEntry = this.pendingAcknowledge[resourceId];

        if (resourceEntry=== undefined) {
            resourceEntry = this.pendingAcknowledge[resourceId] = {};
            this.nPendingAcknowledge[resourceId] = 0;
        }
    
        for (var elemId in resourceObj) {
            if (!(elemId in resourceEntry)) {
                this.nPendingAcknowledge[resourceId]++;
            }
            var elemEntry = resourceObj[elemId];
            resourceEntry[elemId] = {
                ackId: ackId,
                entry: elemEntry
            };
        }
    }
    
    
    // --------------------------------------------------------------------------
    // writeAckHandler
    //
    // an 'ack' from the server should remove elements heretofore in the pending
    //  list
    //
    // a 'nack' from the server is considered an error (and would shutdown the
    //  connection)
    //
    writeAckHandler(arg: any, status: any, message: any): void {
        if (status === true) {
            var fullSyncRevision =
                this.updateSubscribedResourceRevision(arg.resourceId,
                                                      arg.elementObj,
                                                      message.revision, true);
            this.writeAcknowledgmentReceived(arg.resourceId, arg.elementObj,
                                             arg.ackId, message.info,
                                             message.revision,
                                             fullSyncRevision);
        } else {
            this.remoteMgr.clientErrorCB(this, "nack received");
        }
    }
    
    // --------------------------------------------------------------------------
    // writeAcknowledgmentReceived
    //
    // acknowledgments may arrive out-of-order, resulting in an empty
    //  this.pendingAcknowledge (when the same resource-element was written to
    //   several times, and the significant ack - to the last write - precedes
    //   other, insignificant acks)
    //   'writeAckInfo' is optional information sent by the server together
    //   with the write acknowledgement (e.g. the ID assigned to the written
    //   entry on the server).
    // 'updateRevision' is the last revision covered by this update.
    // 'fullSyncRevision' is the revision for which (after this update)
    // the client is fully synchronized (this includes write acknowledgements
    // for its own writes which do not leave gaps in teh revision sequence
    // with updates from the server).
    //
    writeAcknowledgmentReceived(resourceId: number, resourceObj: any,
                                ackId: number, writeAckInfo: any,
                                updateRevision: number,
                                fullSyncRevision: number): void {
        var resourceEntry = this.pendingAcknowledge[resourceId];
        if (resourceEntry === undefined) {
            return;
        }

        var queuedUpdates: any = undefined;
        var resource = this.remoteMgr.resourceById[resourceId];
        var consumer = resource.getConsumer();
        
        // remove elements pending-acknowledgement iff the ackIds match
        for (var elemId in resourceObj) {
            if (!(elemId in resourceEntry)) {
                continue;
            }
            var pendingEntry = resourceEntry[elemId];
            if (pendingEntry.ackId !== ackId) {
                continue;
            }
            if (pendingEntry.queuedUpdate !== undefined &&
               (updateRevision === undefined ||
                pendingEntry.queuedUpdate.revision > updateRevision)) {
                // the queued update has a higher revision than this write,
                // so the resource should be updated
                if (queuedUpdates === undefined) {
                    queuedUpdates = {};
                }
                queuedUpdates[elemId] = pendingEntry.queuedUpdate; 
            }
            
            delete resourceEntry[elemId];
            if (--this.nPendingAcknowledge[resourceId] === 0) {
                consumer.allRequestsAcknowledged(resourceId);
            }
        }
    
        // update the consumer with any additional information sent on the
        // write acknowledgement.
        consumer.writeAckInfoUpdate(resourceId, writeAckInfo);
        
        if (queuedUpdates !== undefined) {
            RemotingLog.log(5,
                            () => "updating resource " + resourceId +
                            " after write acknowledgement from client " +
                            this.adminData.id + " with full sync revision " +
                            fullSyncRevision);
            // use undefined revision, since these updates may have revisions
            // lower than the last revision received
            this.remoteMgr.updateResource(resourceId, queuedUpdates, undefined,
                                          fullSyncRevision);
        }
    }
    
    // --------------------------------------------------------------------------
    // resourceUpdateHandler
    //
    // a message-handler; notify remote-mgr of the changes
    //
    resourceUpdateHandler(message: NetworkMessage): void {
        var resourceId = message.resourceId;
        // the last revision this message covers
        var updateRevision = message.revision;
        
        var jselement = message.update;
        var elementObj: ResourceElementMapByIdent = {};
        var xdr = this.getXDRFunc(XDRDirection.Unmarshal, resourceId);
    
        if (typeof(xdr) !== "function") {
            this.dlog(1, "resourceUpdateHandler: no xdr, message ignored");
            return;
        }
    
        var getIdentStr = this.getIdentStrFunc(resourceId);
    
        var pending;
        var ackRevisionByIdent;
        
        if (resourceId in this.nPendingAcknowledge &&
             this.nPendingAcknowledge[resourceId] > 0) {
            pending = this.pendingAcknowledge[resourceId];
        }
        if (resourceId in this.subscribedResource) {
            ackRevisionByIdent =
                this.subscribedResource[resourceId].ackRevisionByIdent;
        }
        
        for (var eid in jselement) {
            var jselem = jselement[eid];
    
            var elem = xdr(jselem);
            var identStr = getIdentStr(elem);
    
            if (pending !== undefined && (identStr in pending)) {
                // still pending, so don't update the resource but queue
                // until the acknowledgement is received.
                var queuedUpdate = pending[identStr].queuedUpdate;
                if (queuedUpdate === undefined) {
                    pending[identStr].queuedUpdate = elem;
                } else if (elem.revision !== undefined &&
                           (queuedUpdate.revision === undefined ||
                            queuedUpdate.revision < elem.revision)) {
                    pending[identStr].queuedUpdate = elem;
                }
            } else if (ackRevisionByIdent !== undefined &&
                      (identStr in ackRevisionByIdent)) {
                var ackRevision = ackRevisionByIdent[identStr];
                if (elem.revision === undefined || elem.revision <= ackRevision) {
                    continue; // local version more up to date
                } else { // updated revision more up to date
                    delete ackRevisionByIdent[identStr];
                    elementObj[identStr] = elem;
                }
            } else {
                elementObj[identStr] = elem;
            }
        }

        // 'updateRevision' is the last revision on the server at the time the
        // update was sent. 'fullSyncRevision' is the last revision for which
        // the client is fully synchronized (this includes write
        // acknowledgements for its own writes which do not leave gaps in the
        // revision sequence with updates from the server).
        var fullSyncRevision =
            this.updateSubscribedResourceRevision(resourceId, elementObj,
                                                  updateRevision, false);
    
        RemotingLog.log(5,
                        () => "updating resource " + resourceId +
                        " from client " + this.adminData.id +
                        " with update revision " + updateRevision +
                        " and full sync revision " + fullSyncRevision);
        this.remoteMgr.updateResource(resourceId, elementObj, updateRevision,
                                      fullSyncRevision);
        var consumerList = this.remoteMgr.getClientConsumerList(this);
        if (message.error) {
            this.remoteMgr.notifyConnectionState(consumerList, 1, message.reason);
        }
        this.remoteMgr.resourceUpdateComplete(consumerList, resourceId);
    }
    
    // --------------------------------------------------------------------------
    // resourceInboundProgressHandler
    //
    // This function handles the network level progress notifications received
    //   from the network layer. This is called for each buffer received.
    //   As a single message may be transferred in multiple buffers, this
    //   allows one to track the progress of the transfer even before the full
    //   message has been received.
    //   This function receives the resource ID and message sequence number
    //   (assigned by the other side) which identify the message and
    //   two number defining the progress of the messsge transfer: 'receivedLen'
    //   (the total size received so far) and 'totalLen' (the total size of
    //   the message).
    //   This function is not called on network acknowledgement messages
    //   (those are handled by the function resourceNetworkAckMessageHandler())
    //   so this function provides information about messages being received
    //   while resourceNetworkAckMessageHandler() provides information about
    //   messages being sent.
    //
    resourceInboundProgressHandler(resourceId: number, sequenceNr: number, receivedLen: number, totalLen: number): void {
        // each resource should define its own (optional) handler for
        // the inbound progress
    
        var resource = this.remoteMgr.resourceById[resourceId];
    
        if (resource === undefined) {
            this.dlog(2,"RemotingClientConnection."+
                      "resourceInboundProgressHandler: " +
                      "No such resource " + resourceId);
            return;
        }
    
        // if the resource has a progress tracking function, call this function
        // with the relevant progress information.
    
        if (resource.inboundProgressUpdate !== undefined) {
            resource.inboundProgressUpdate(sequenceNr, receivedLen, totalLen);
        }
    }
    
    // --------------------------------------------------------------------------
    // resourceOutboundProgressHandler
    //
    // This function is called each time a network level acknowledgement
    //   messages is received by this client. These messages are sent by the
    //   other side when a buffer (partial message) is received from this client.
    //   These acknowledgement messages therefore provide information about the
    //   progress of the transfer of a message sent by this client.
    //   This function is called with arguments extracted from the acknowledgement
    //   message received. These currently include:
    //   'resourceId': the ID of the resource for which the message was sent
    //   'sequenceNr': the sequence number assigned to the message sent.
    //   'replyArgs': if a reply argument object was provided when sending
    //       the message, the argument object is provided here (as it may store
    //       any information which may identify the message for which this is
    //       an update).
    //   'receivedLen': total number of bytes of the message received so far
    //       by the other side.
    //   'totalLen': the total length of the message sent.
    //
    resourceOutboundProgressHandler(resourceId: number, sequenceNr: number, replyArgs: any, receivedLen: number, totalLen: number): void {
    
        // each resource should define its own (optional) handler for
        // the outbound progress
    
        var resource = this.remoteMgr.resourceById[resourceId];
    
        if (resource === undefined) {
            this.dlog(2,"RemotingClientConnection."+
                      "resourceOutboundProgressHandler: " +
                      "No such resource " + resourceId);
            return;
        }
    
        // if the resource has a progress tracking function, call this function
        // with the relevant progress information.
    
        if (resource.outboundProgressUpdate === undefined) {
            return;
        }
        var elementObj;
        var identities;
    
        if (replyArgs !== undefined && replyArgs.elementObj !== undefined) {
            // this is the original object from which the message was generated
            elementObj = replyArgs.elementObj;
            // get the list of identities of elements which were included in this
            // outbound message.
            identities = Object.keys(elementObj);
        }
        
        resource.outboundProgressUpdate(identities, elementObj, receivedLen,
                                        totalLen);
    }
    
    // --------------------------------------------------------------------------
    // networkErrorHandler
    //
    // an event handler for 'error'
    //
    networkErrorHandler(error: string): void {
        this.remoteMgr.clientErrorCB(this, error);
    }
    
    // --------------------------------------------------------------------------
    // networkCloseHandler
    //
    // an event handler for 'close'
    //
    networkCloseHandler(error: string): void {
        this.remoteMgr.clientCloseCB(this, error);
    }
    
    networkOpenHandler(): void {
        this.remoteMgr.clientOpenCB(this);
    }
    
    getSubscribedResourceObj(): {[resourceId: number]: ResourceRevisionInfo} {
        return this.subscribedResource;
    }
    
    terminationHandler(message: NetworkMessage): void {
        this.remoteMgr.terminate(this, message.reason);
    }

    reloadHandler(message: NetworkMessage): void {
        this.remoteMgr.reloadApplication(this, message.reason);
    }

    defineHandler(message: NetworkMessage): void {
        var definitionList = message.list;
    
        if (definitionList instanceof Array) {
            for (var i = 0; i < definitionList.length; i++) {
                var def = definitionList[i];
                if (isXDRTemplateDefinition(def)) {
                    this.remotePaidMgr.addRemoteTemplateDefinition(def);
                } else if (isXDRIndexDefinition(def)) {
                    this.remotePaidMgr.addRemoteIndexDefinition(def);
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

    loginStatusHandler(message: NetworkMessage): void {
        this.remoteMgr.loginStatusUpdate(
            message.username, message.authenticated, message.reason, message.loginSeqNr);
    }

    // Called upon (re)connection; should clear transmitted ids?
    initDef(): void {
    }
    
    // This function updates the (last) revision of the resource data (of
    // the resource given by 'resourceId') which was received by the
    // client. This is updated in the table of subscribed resources.  The
    // function needs to distinguish between the revision of updates from
    // the server and the revision of writes performed by the client and
    // acknowledged by the server. The mechanism allows for write
    // acknowledgement and updates to be received out of order. In that
    // case there may be a gap between the last revision for which an
    // update was received and the revisions for which a write
    // acknowledgement has been received (e.g. updates were received up to
    // revision 26 and then a write acknowledgement revision fo 28, which
    // means that update with revision 27 has not yet been received). If
    // such a gap exists, we must keep track of it, as resubscription
    // would have to fetch data from the last revision for which full
    // updates and acknowledgements were received. Tracking these gaps is
    // implemented by the function below. In case of gaps between the
    // updates from the server and the acknowledgement revision, this function
    // also tracks the identifiers of the objects for which the write
    // acknowledgements were received so that when updates are received we know
    // whether the update received has a higher or lower version than the local
    // version of this object. This needs to take place only when a gap exists,
    // since where there are no gas we know that the client and the server are
    // in sync.
    // The function returns the revision up to which we know that a continuous
    // update has been received. This includes write acknowledgements which
    // do not leave gaps with the update revisions received.
    
    updateSubscribedResourceRevision(resourceId: number, elementObj: ResourceElementMapByIdent,
                                     revision: number, isWriteAck: boolean): number {
        if (revision === undefined || !(resourceId in this.subscribedResource)) {
            return undefined;
        }
        // add the last revision updated to the subscribed resource
        var resourceSpec = this.subscribedResource[resourceId];
        var elemId: string;
        
        if (isWriteAck) {
            var ackRevision = resourceSpec.ackRevision;
            if (ackRevision === undefined) {
                if (resourceSpec.revision !== undefined &&
                   resourceSpec.revision >= revision - 1) {
                    // full update received up to the acknowledged write revision
                    // (possibly need to advance to acknowledged revision)
                    if (resourceSpec.revision === revision - 1) {
                        resourceSpec.revision = revision;
                    }
                } else {
                    // first acknowledged revision after gap, store separately
                    resourceSpec.ackRevision = [revision, revision];
                    // store the identifiers for which the write acknowledgement
                    // was received (in case we later receive a lower version
                    // update for them).
                    resourceSpec.ackRevisionByIdent = {};
                    for (elemId in elementObj) {
                        resourceSpec.ackRevisionByIdent[elemId] = revision;
                    }
                }
            } else {
                // there is a gap, add revision at end of write acknowledged
                // revision list
                var lastAckRevisionPos = ackRevision.length - 1;
                if (revision - 1 === ackRevision[lastAckRevisionPos]) {
                    ackRevision[lastAckRevisionPos] = revision;
                } else if (revision > ackRevision[lastAckRevisionPos]) {
                    ackRevision.push(revision, revision);
                }
                for (elemId in elementObj) {
                    if (!(elemId in resourceSpec.ackRevisionByIdent) ||
                          revision > resourceSpec.ackRevisionByIdent[elemId]) {
                        resourceSpec.ackRevisionByIdent[elemId] = revision;
                    }
                }
            }
            return resourceSpec.revision;
        }
        
        if (resourceSpec.revision !== undefined && resourceSpec.revision >= revision) {
            return resourceSpec.revision; // revision is not advanced
        }
        // update revision
        resourceSpec.revision = revision;
    
        if (resourceSpec.ackRevision === undefined) {
            return resourceSpec.revision;
        }
        // loop backward over acknowledged revision numbers until the
        // first range overlapping the new revision is found (this
        // and all previous ranges can be removed).
        for(var i = resourceSpec.ackRevision.length - 2 ; i >= 0 ; i -= 2) {
            if (resourceSpec.ackRevision[i] >= revision - 1) {
                // revision update reached this acknowledgement revision range,
                // so up to date up to the end of this range
                resourceSpec.revision = resourceSpec.ackRevision[i+1];
                // and can remove this range (including all preceeding ranges)
                if (i === resourceSpec.ackRevision.length - 2) {
                    resourceSpec.ackRevision = undefined;
                    resourceSpec.ackRevisionByIdent = undefined;
                } else {
                    resourceSpec.ackRevision.splice(0, i + 2);
                }
                break;
            }
        }

        return resourceSpec.revision;                                 
    }

    getAdminData(): RemoteClientAdminData {
        return this.adminData;
    }

    getTemplateIndexAdmin(): TemplateIndexInformationChannel {
        return this.remotePaidMgr;
    }

    getXDRFunc(dir: XDRDirection, resourceId: number): (elem: any) => any  {
        var resource = this.remoteMgr.resourceById[resourceId];
        var xdrFunc = resource.getXdrFunc();
        var xdr = new AgentXDR(dir, this.remotePaidMgr);

        return function (elem: any): any {
            return xdrFunc(elem, xdr);
        };
    }

    getIdentStrFunc(resourceId: number): IdentFunc {
        var resource = this.remoteMgr.resourceById[resourceId];

        return resource === undefined? undefined: resource.getIdentStrFunc();
    }

    resetTemplateIndexIds(): void {
        this.remotePaidMgr.resetChannel();
    }

    //
    // Debugging
    //

    debugRemainClosed: boolean;

    // forces the connection to close, as if it was closed as a result of
    // communication loss or the server dying.
    debugForceClose(timeout: number): void {
        this.debugRemainClosed = true;
        this.closeHandler({ code: "debug forced close" });
        if(timeout) {
            var _self = this;
            function releaseForceClose() {
                _self.debugReleaseForceClose();
            }
            setTimeout(releaseForceClose, timeout);
        }
    }

    // Releases the forced closure of the connection (when forced by the function
    // above).
    debugReleaseForceClose(): void {
        if (this.debugRemainClosed) {
            this.debugRemainClosed = false;
        }
    }
}

// This forces the closure of all client connections (of the global remoting
// manager). This is for debugging purposes only.
// If 'timeout' is specified then it should be the time (in milliseconds)
// until the connection is allowed to be established again (it may take
// a little longer to establish the connection). If timeout is 0 or
// undefined, the connection will remain closed until debugReleaseForceClose()
// is called.

function debugForceClose(timeout: number): void {
    if (gRemoteMgr !== undefined) {
        gRemoteMgr.debugForceClose(timeout);
    }
}

// This releases the forced closure of all client connections (of the global
// remoting manager). The clients then try to reconnect. 

function debugReleaseForceClose() {
    if (gRemoteMgr !== undefined) {
        gRemoteMgr.debugReleaseForceClose();
    }
}

/**
 * This class is instantiated by RemoteMgr for each resource it synchronizes
 *  with a remote-server
 * a resource is a flat table indexed by strings, holding arbitrary moon values
 *
 * the resource replica is maintained at 'this.element'
 *
 * this.consumer elements are { obj: consumer, ident: string }
 * a consumer is notified by calling consumer.resourceUpdate(elementObj, ident)
 *  where 'elementObj' is the set of attributes in this.element that were
 *  changed
 * 
 * @class RemotingResource
 */
class RemotingResource {
    /**
     * last revision of the resource received
     * 
     * @type {number}
     * @memberof RemotingResource
     */
    revision: number|undefined = undefined;

    element: ResourceElementMapByIdent;

    constructor(
        public id: number,
        public spec: ResourceSpecification,
        public clientId: number,
        public xdrFunc: XDRFunc,
        public identStrFunc: IdentFunc,
        public consumer: ResourceConsumer,
        public consumerIdent: any) {
    }
    
    destroy(): void {
    }
    
    getId(): number {
        return this.id;
    }
    
    getSpec(): ResourceSpecification {
        return this.spec;
    }
    
    update(elementObj: ResourceElementMapByIdent, updateRevision: number,
           fullSyncRevision: number): void {
        if (updateRevision !== undefined) {
            if (this.revision !== undefined &&
                updateRevision <= this.revision) {
                // this revision was already updated
                RemotingLog.log(5, "update ignored, revision already updated");
                if (fullSyncRevision !== undefined &&
                    fullSyncRevision > this.revision) {
                    this.revision = fullSyncRevision;
                }
                return;
            } else if (fullSyncRevision !== undefined &&
                       fullSyncRevision > updateRevision) {
                this.revision = fullSyncRevision;
            } else {
                this.revision = updateRevision;
            }
        }

        this.consumer.resourceUpdate(elementObj, this.consumerIdent,
                                     updateRevision);
    }
    
    inboundProgressUpdate(sequenceNr: number, receivedLen: number, totalLen: number): void {
        if (this.consumer.inboundProgressUpdate !== undefined) {
            this.consumer.inboundProgressUpdate(sequenceNr, receivedLen, totalLen);
        }
    }
    
    // 'identities' is an array containing the identities of the objects
    // sent in the outbound message. These are the attributes of the object
    // 'elementObj' which is the original object from which the message was
    // created.
    
    outboundProgressUpdate(identities: any, elementObj: ResourceElementMapByIdent, receivedLen: number, totalLen: number): void {
        if (this.consumer.outboundProgressUpdate !== undefined) {
            this.consumer.outboundProgressUpdate(identities, elementObj,
                                                 receivedLen, totalLen);
        }
    }
    
    getElement(eid: string): any {
        return this.element[eid];
    }
    
    getClientId(): number {
        return this.clientId;
    }
    
    getXdrFunc(): XDRFunc {
        return this.xdrFunc;
    }
    
    getIdentStrFunc(): IdentFunc {
        return this.identStrFunc;
    }
    
    getConsumer(): ResourceConsumer {
        return this.consumer;
    }
    
    getConsumerIdent(): string {
        return this.consumerIdent;
    }
    
    terminate(reason: string): void {
        this.consumer.resourceConnectionStateUpdate(2, reason, this.consumerIdent);
    }
}
