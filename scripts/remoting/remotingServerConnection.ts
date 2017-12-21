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

/// <reference path="networkServer.ts" />
/// <reference path="resourceMgr.ts" />
/// <reference path="wsAuth.ts" />

var emailAddresses: any = require('email-addresses');

interface RemotingServerInterface {
    getResourceMgr(): ResourceMgr;
    getDBName(): string;
}

interface SyncMessage {
    sequenceNr: number;
    cb: () => void;
}

class RemotingServerConnection extends NetworkServerConnection
implements RemoteResourceUpdate
{
    resourceMgr: ResourceMgr;
    dbName: string;
    localMode: boolean;
    connectionAuthenticated: boolean;

    clientResource: {
        [clientResourceId: number]: {
            resourceId: number;
            regId: number;
        }
    } = {};
    clientIdByRegId: {[regId: number]: number} = {};

    // List of functions that execute messages for a resource that does not yet
    // have authorized access (i.e., messages received between the subscribe
    // message and the authorization callback). Stored per client resource id,
    // since the resource id isn't known yet.
    notYetAuthorizedMessage: {
        [clientResourceId: number]: (() => void)[]
    } = {};

    // A paid mapper for incoming template and index ids per resource, exclusive
    // to this connection.
    remotePaidMgr: {[resourceId: number]: RemotePaidInterface} = {};

    constructor(
        networkServer: NetworkServer,
        options: any,
        socket: WebSocketConnection,
        remotingServer: RemotingServerInterface,
        authDB: MongoDB,
        connectionAuthenticated: boolean)
    {
        super(networkServer, options, socket, authDB);

        this.resourceMgr = remotingServer.getResourceMgr();
        this.dbName = remotingServer.getDBName();
        
        this.localMode = !!options.localMode;
        this.user = this.localMode? null: String(options.user);
        this.connectionAuthenticated = connectionAuthenticated;
        
        this.addMessageHandler("subscribe", this.subscribeHandler);
        this.addMessageHandler("unsubscribe", this.unsubscribeHandler);
        this.addMessageHandler("write", this.writeHandler);
        this.addMessageHandler("releaseResource", this.releaseResourceHandler);
        this.addMessageHandler("define", this.defineHandler);
        this.addMessageHandler("login", this.loginHandler);
        this.addMessageHandler("logout", this.logoutHandler);
        this.addMessageHandler("createAccount", this.createAccountHandler);
    }
    
    // --------------------------------------------------------------------------
    // destroy
    //
    // unsubscribe all resources
    //
    destroy(): void {
        for (var clientResourceId in this.clientResource) {
            var resourceEntry = this.clientResource[clientResourceId];
            var resourceId = resourceEntry.resourceId;
            var regId = resourceEntry.regId;
            var resource = this.resourceMgr.getResourceById(resourceId);
            if (typeof(resource) === "undefined") {
                this.dlog(1, "RemotingServerConnection.destroy: no resource for" +
                          " client resourceId " + clientResourceId +
                          " resource Id " + resourceId);
                continue;
            }
            resource.unsubscribe(regId);
            delete this.remotePaidMgr[resource.id];
        }
    }
    
    // --------------------------------------------------------------------------
    // subscribeHandler
    //
    // {
    //   type: "subscribe",
    //   resourceId: <clientResourceId>,
    //   resourceSpec: <spec>
    // }
    //
    // registers for updates for the resource described by <resourceSpec> with
    //  the resource-manager; also, get the current contents of that resource, and
    //  communicate them to the client with a 'resourceUpdate' message
    //
    subscribeHandler(message: NetworkMessage): void {
        var self = this;
        var clientResourceId = Number(message.resourceId);
        var resourceSpec = message.resourceSpec;
    
        function subscribeHandlerCont(error: any, perm: any): void {
            self.subscribeHandlerCont(!error && perm, message, resourceSpec);
        }
    
        if (this.localMode) {
            subscribeHandlerCont(null, true);
        } else {
            var owner = resourceSpec.owner;
            var restype = resourceSpec.type;
            var resname = resourceSpec.app;
            var accessor = this.user;
    
            this.notYetAuthorizedMessage[clientResourceId] = [];
            this.authorize(owner, restype, resname, accessor, subscribeHandlerCont);
        }
    }
    
    // --------------------------------------------------------------------------
    // subscribeHandlerCont
    //
    subscribeHandlerCont(isAllowed: boolean, message: NetworkMessage, resourceSpec: ResourceSpecification): void {
        var self = this;
        var clientResourceId = Number(message.resourceId);
    
        function sendNAck(err: string): void {
            RemotingLog.log(1, "access not authorized");
            self.sendMessage({
                type: "resourceUpdate",
                resourceId: clientResourceId,
                update: [],
                error: true,
                reason: err
            });
        }
    
        if (!isAllowed) {
            delete this.notYetAuthorizedMessage[clientResourceId];
            sendNAck("not authorized");
            return;
        }
    
        assertFalse(isNaN(clientResourceId), "clientResourceId is not a number");
        assertFalse(clientResourceId in this.clientResource, "unknown client resource id");
    
        var resource = this.resourceMgr.getResourceBySpec(resourceSpec);
    
        if (resource !== undefined) {
    
            var resourceId = resource.getId();
    
            var regId = resource.subscribe(this);
            this.clientResource[clientResourceId] = {
                resourceId: resourceId,
                regId: regId
            };
            var resourcePaidMgr = resource.getPaidMgr();
            if (resourcePaidMgr !== undefined) {
                this.remotePaidMgr[resourceId] = new RemotePaidInterface(resourcePaidMgr);
            }
            this.clientIdByRegId[regId] = clientResourceId;

            if (clientResourceId in this.notYetAuthorizedMessage) {
                this.dlog(3, "subscribeHandlerCont: adding now authorized messages");
                var messages = this.notYetAuthorizedMessage[clientResourceId];
                for (var i = 0; i < messages.length; i++) {
                    resource.executeWhenReady(messages[i]);
                }
            }

            // .getAllElement() calls its argument callback function when it
            // has acquired all the resource elements into elementObj - or when
            // an error has occcurred
            resource.getAllElement(message.revision,
                                   function (error, elementObj, revision) {
                if (error === null) {
                    self.sendUpdate(clientResourceId, elementObj, revision, true);
                    return;
                } else {
                    // XXX TBD
                    self.dlog(0,
                      "RemotingServerConnection: getAllElement error " + error);
                    sendNAck(error.toString());
                }
            });
        } else {
            this.dlog(0, "RemotingServerConnection: no such resource");
            sendNAck("no such resource");
        }
        delete this.notYetAuthorizedMessage[clientResourceId];
    }
    
    // --------------------------------------------------------------------------
    // unsubscribeHandler
    //
    // {
    //   type: "unsubscribe",
    //   resourceId: <clientResourceId>
    // }
    //
    unsubscribeHandler(message: NetworkMessage): void {
        var clientResourceId = Number(message.resourceId);
    
        this.dlog(2, function() {
            return "unsubscribeHandler: clientResourceId=" + clientResourceId;
        });
    
        var clientResourceEntry = this.clientResource[clientResourceId];
        if (typeof(clientResourceEntry) === "undefined") {
            this.dlog(1, "unsubscribeHandler: clientResourceEntry '" +
                      clientResourceId + "' not found");
        } else {
            this.unsubscribe(clientResourceEntry);
        }
    }

    /// unsubscribes resourceId/regId.
    unsubscribe(clientResourceEntry: {resourceId: number; regId: number;}): void {
        var resourceId = clientResourceEntry.resourceId;
    
        if (resourceId !== undefined) {
            var regId = clientResourceEntry.regId;
            var resource = this.resourceMgr.getResourceById(resourceId);
            if (resource !== undefined) {
                resource.unsubscribe(regId);
            }
            delete this.remotePaidMgr[resourceId];
        }
    }
    
    // --------------------------------------------------------------------------
    // releaseResourceHandler
    //
    // {
    //   type: "releaseResource",
    //   resourceId: <clientResourceId>
    // }
    //
    releaseResourceHandler(message: NetworkMessage): void {
        var clientResourceId = Number(message.resourceId);
    
        this.dlog(2, () => "releaseResourceHandler: clientResourceId="+clientResourceId);
    
        var clientResourceEntry = this.clientResource[clientResourceId];
        if (clientResourceEntry === undefined) {
            this.dlog(1, () => "releaseResourceHandler: clientResourceEntry '" +
                               clientResourceId + "' not found");
            return;
        }
    
        var resourceId = clientResourceEntry.resourceId;
        if (resourceId === undefined) {
            return;
        }
    
        var regId = clientResourceEntry.regId;
        var resource = this.resourceMgr.getResourceById(resourceId);
        if (resource !== undefined) {
            resource.releaseResource(regId);
        }
        delete this.remotePaidMgr[resourceId];
    }
    
    defineHandler(message: NetworkMessage): void {
        var clientResourceId = Number(message.resourceId);
        var resourceEntry = this.clientResource[clientResourceId];
        var self = this;
    
        function defineTemplateIndexIds(): void {
            var resourceEntry = self.clientResource[clientResourceId];
            var resource = self.resourceMgr.getResourceById(resourceEntry.resourceId);
            var remotePaidInterface = self.remotePaidMgr[resource.id];
            if (remotePaidInterface !== undefined) {
                RemotingServerConnection.defineRemoteTemplateIndexIds(
                    remotePaidInterface, message.list);
            }
        }

        if (resourceEntry === undefined) {
            if (clientResourceId in this.notYetAuthorizedMessage) {
                // Authorization still in progress
                this.dlog(4, () => "defineHandler: clientResourceEntry '" +
                                   clientResourceId + "' waiting for authorization");
                this.notYetAuthorizedMessage[clientResourceId].push(defineTemplateIndexIds);
            } else {
                this.dlog(1, () => "defineHandler: clientResourceEntry '" +
                                   clientResourceId + "' not found");
                self.sendMessage({
                    type: "resourceUpdate",
                    resourceId: clientResourceId,
                    update: [],
                    error: true,
                    reason: "not authorized"
                });
            }
            return;
        }
    
        var resource = this.resourceMgr.getResourceById(resourceEntry.resourceId);
        if (resource === undefined) {
            this.dlog(1, () => "resourceId " + resourceEntry.resourceId +
                               " does not have a resource");
            return;
        }
        // The definition message can be executed now when the BackingStorePaidMgr
        // has finished loading, or must wait until that's done.
        resource.executeWhenReady(defineTemplateIndexIds);
    }
    
    static defineRemoteTemplateIndexIds(remotePaidInterface: RemotePaidInterface, definitionList: any): void {
        if (definitionList instanceof Array) {
            for (var i = 0; i < definitionList.length; i++) {
                var def = definitionList[i];
                if (isXDRTemplateDefinition(def)) {
                    remotePaidInterface.addRemoteTemplateDefinition(def);
                } else if (isXDRIndexDefinition(def)) {
                    remotePaidInterface.addRemoteIndexDefinition(def);
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

    loginHandler(message: NetworkMessage): void {
        var username = message.username;
        var password = message.password;
        var self = this;

        function loginValidated(err: any, username: string, authenticated: boolean): void {
            self.connectionAuthenticated = authenticated;
            self.networkServer.serverConnection.logUserAction("login", {
                user: username,
                from: self.connection.remoteAddress,
                accept: authenticated,
                reason: err === null? undefined: err.toString()
            });
            if (authenticated) {
                self.user = username;
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: true,
                    loginSeqNr: message.loginSeqNr
                });
            } else {
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: false,
                    error: true,
                    reason: err? err.toString(): "unknown error",
                    loginSeqNr: message.loginSeqNr
                });
            }
        }

        RemotingLog.log(1, "login: " + username + "/" + password);
        if (typeof(username) === "string" && typeof(password) === "string") {
            BasicWSAuth.validateLogin(this.authDB, username, password,
                                      loginValidated);
        } else {
            loginValidated("login error", undefined, false);
        }
    }

    /// Deauthenticates the client and unsubscribes all resources that are no
    /// longer authorized. Does not use the authorization functions, as they
    /// require a callback, but only checks publicDataAccess and resource type.
    logoutHandler(message: NetworkMessage): void {
        RemotingLog.log(1, "logout: " + this.user);
        this.connectionAuthenticated = false;
        for (var clientResourceId in this.clientResource) {
            var clientResourceEntry = this.clientResource[clientResourceId];
            var resourceId = clientResourceEntry.resourceId;
            var resType = this.resourceMgr.resourceTypeById[resourceId];
            if (!Authorization.publicDataAccess || (resType !== "table" && resType !== "metadata")) {
                this.unsubscribe(clientResourceEntry);
            }
        }
        this.networkServer.serverConnection.logUserAction("logout", {
            user: this.user,
            from: this.connection.remoteAddress
        });
    }

    createAccountHandler(message: NetworkMessage): void {
        var username = message.username;
        var password = message.password;
        var email = message.email;
        var self = this;

        function accountCreated(err: any, username: string, authenticated: boolean): void {
            RemotingLog.log(1, "createAccount: " + username + ", err = " +
                               (err? err.toString(): "none"));
            self.connectionAuthenticated = authenticated;
            self.networkServer.serverConnection.logUserAction("createAccount", {
                user: username,
                email: email,
                from: self.connection.remoteAddress,
                accept: authenticated,
                reason: err === null? undefined: err.toString()
            });
            if (authenticated && err === null) {
                self.user = username;
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: true,
                    loginSeqNr: message.loginSeqNr
                });
            } else {
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: false,
                    error: true,
                    reason: err? err.toString(): "unknown",
                    loginSeqNr: message.loginSeqNr
                });
            }
        }

        RemotingLog.log(1, "login: " + username + "/" + password);
        if (typeof(username) === "string" && typeof(password) === "string" &&
              isValidPassword(password) && typeof(email) === "string" &&
              isValidEmail(email)) {
            BasicWSAuth.addUserNamePasswordEmail(this.authDB, username,
                password, email.trim(), false, accountCreated);
        } else {
            var errMsgs: string[] = [];
            if (typeof(username) !== "string") {
                errMsgs.push("user name is not a string");
            }
            if (typeof(password) !== "string" || !isValidPassword(password)) {
                errMsgs.push("password is not valid");
            }
            if (typeof(email) !== "string" || !isValidEmail(email)) {
                errMsgs.push("email is not valid");
            }
            accountCreated(errMsgs.join(", and "), undefined, false);
        }
    }

    // --------------------------------------------------------------------------
    // sendUpdate
    //
    sendUpdate(clientResourceId: number, elementObj: ResourceElementMapByIdent, lastRevision: number, sendAllDefinitions: boolean): void {
        var updateList = [];
        var resource = this.getResourceByClientResourceId(clientResourceId);
        var xdr = this.getXDR(resource, XDRDirection.Marshal);
    
        if (typeof(xdr) !== "function") {
            mondriaInternalError("sendUpdate: undefined XDR");
            return;
        }
    
        this.dlog(2, function() {
            return "sendUpdate: clientResourceId=" + clientResourceId;
        });
    
        try {
    
            for (var elementId in elementObj) {
                var element = elementObj[elementId];
                element = xdr(element);
                updateList.push(element);
            }
    
            var templateIndexAdmin = this.remotePaidMgr[resource.id];
            if (templateIndexAdmin !== undefined) {
                var idUpdates = sendAllDefinitions?
                    templateIndexAdmin.getAllTemplateIndexIds():
                    templateIndexAdmin.getTemplateIndexIdUpdates();
                if (idUpdates !== undefined) {
                    // template/index definitions message precede their usage
                    // within a write message
                    this.sendTemplateIndexIds(clientResourceId, idUpdates);
                }
            }

            this.sendMessage({
                type: "resourceUpdate",
                resourceId: clientResourceId,
                revision: lastRevision,
                update: updateList
            });
    
        } catch (ex) {
            console.error(ex);
        }
    }
    
    resourceUpdate(regId: number, elementObj: ResourceElementMapByIdent, lastRevision: number): void {
        var clientResourceId = this.clientIdByRegId[regId];
    
        assert(clientResourceId !== undefined, "resourceUpdate");
        this.sendUpdate(clientResourceId, elementObj, lastRevision, false);
    }
    
    sendTemplateIndexIds(resourceId: number, definitionList: (XDRTemplateDefinition|XDRIndexDefinition)[]): void {
        this.sendMessage({
            type: "define",
            resourceId: resourceId,
            list: definitionList
        });
    }
    
    // --------------------------------------------------------------------------
    // writeHandler
    //
    // {
    //   type: "write",
    //   resourceId: <clientResourceId>,
    //   obj: <set of elements>
    // }
    //
    // the value of the 'write:' attribute is an object whose attributes are
    //  element-ids, each has a value which is the complete value to be assigned
    //  to that element-id
    //
    writeHandler(message: NetworkMessage): void {
        var self = this;
        var clientResourceId = Number(message.resourceId);
        var writeList = message.list;
        var clientResourceEntry = self.clientResource[clientResourceId];
        var resourceId = clientResourceEntry === undefined? undefined:
                         clientResourceEntry.resourceId;
        var resource = resourceId === undefined? undefined:
                       self.resourceMgr.getResourceById(resourceId);

        if (typeof(writeList) !== "object" || typeof(writeList.length) !== "number") {
            return;
        }
        
        function write(): void {
            var clientResourceEntry = self.clientResource[clientResourceId];
            if (clientResourceEntry === undefined) {
                self.dlog(1, "writeHandler: clientResourceEntry '" +
                             clientResourceId + "' not found");
                return;
            }
            var resourceId = clientResourceEntry.resourceId;
            var elementObj: ResourceElementMapByIdent = {};
            var resource = self.resourceMgr.getResourceById(resourceId);
            var xdr = self.getXDR(resource, XDRDirection.Unmarshal);
            var getIdentString = self.getIdentString(clientResourceId);

            try {
    
                for (var i = 0; i < writeList.length; i++) {
                    var elem: any = writeList[i];
                    var xelem: any = xdr(elem);
                    var identStr: string = getIdentString(xelem);
                    elementObj[identStr] = xelem;
                }
        
                self.dlog(3, function() {
                    return "got message resourceId=" + resourceId +
                        " elements: " + Object.keys(elementObj).join(", ");
                });
                self.dlog(5, () => JSON.stringify(elementObj));
        
                resource.write(clientResourceEntry.regId, elementObj,
                                function (error, writeAckInfo, revision) {
                    // the argument 'revision' is the revision assigned to this
                    // write operation.
                    if (error !== null) {
                        // XXX TBD
                        self.dlog(0, "RemotingServerConnection: write error " +
                                    error.toString());
                    } else {
                        var replyMessage = {
                            type: "writeAck",
                            resourceId: clientResourceId,
                            revision: revision,
                            info: writeAckInfo,
                            status: (error === null)
                        };
                        self.sendReplyMessage(replyMessage, message);
                    }
                });
            } catch (ex) {
                self.dlog(0, "ERROR: writeHandler");
                if (ex instanceof Error) {
                    console.error(ex);
                }
            }
        }

        if (resource !== undefined) {
            resource.executeWhenReady(write);
        } else if (clientResourceId in this.notYetAuthorizedMessage) {
                this.dlog(4, () => "writeHandler: clientResourceEntry '" +
                                   resourceId + "' waiting for authorization");
            this.notYetAuthorizedMessage[clientResourceId].push(write);
        } else {
            this.dlog(1, () => "writeHandler: resource '" + resourceId + "' not found");
        }
    }
        
    // --------------------------------------------------------------------------
    // authorize
    //
    // check whether 'accessor' is authorized to access <owner;restype;resname>;
    // 'cb' is called with two arguments: whether an error occurred while
    //   testing authorization, and - if no error - the boolean authorization
    //   result: true->allow, false->deny
    //
    authorize(owner: string, restype: string, resname: string,
              accessor: string, cb: (error: any, perm: any) => void): void
    {
        if (!this.connectionAuthenticated) {
            // Allow every connection acccess to the data when the
            // publicDataAccess flag has been set.
            var permission = Authorization.publicDataAccess &&
                             (restype === "metadata" || restype === "table");
            cb(null, permission);
        } else {
            var authorization = new Authorization(this.authDB,
                                           WSAuth.wwwRoot + "/auth/user_email");
            authorization.isAuthorized(owner, restype, resname, accessor, cb);
        }
    }
    
    // --------------------------------------------------------------------------
    // getXDR
    //
    getXDR(resource: Resource, dir: XDRDirection): (elem: any) => any {
        if (resource === undefined) {
            return undefined;
        } else {
            var xdrFunc = resource.getXDRFunc();
            var templateIndexAdmin = this.remotePaidMgr[resource.id];
            var xdr = new ServerXDR(dir, templateIndexAdmin);
            return function (elem) {
                return xdrFunc(elem, xdr);
            };
        }
    }
    
    // --------------------------------------------------------------------------
    // getIdentString
    //
    getIdentString(clientResourceId: number): IdentFunc {
        var resource = this.getResourceByClientResourceId(clientResourceId);
    
        return resource === undefined? undefined: resource.getIdentStrFunc();
    }
    
    
    // --------------------------------------------------------------------------
    // getResourceByClientResourceId
    //
    getResourceByClientResourceId(clientResourceId: number): Resource {
        var resourceEntry = this.clientResource[clientResourceId];
        if (typeof(resourceEntry) === "undefined") {
            this.dlog(1, () => "no resource entry for client resource id " +
                                clientResourceId);
            return undefined;
        }
    
        var resource = this.resourceMgr.getResourceById(resourceEntry.resourceId);
        if (resource === undefined) {
            this.dlog(1, () => "resourceId " + resourceEntry.resourceId +
                               " does not have a resource");
        }
    
        return resource;
    }
    
    // --------------------------------------------------------------------------
    // closeHandler
    //
    closeHandler(error: any): void {
        super.closeHandler(error);
        this.destroy();
    }
    
    // --------------------------------------------------------------------------
    // errorHandler
    //
    errorHandler(err: any): void {
        super.errorHandler(err);
        this.destroy();
    }
    
    signalTermination(reason: string): void {
        this.flush();
        this.sendMessage({type: "terminate", reason: reason});
    }

    // --------------------------------------------------------------------------
    // validateRequest (static)
    //
    // called as part of new web-socket client-connection initiation;
    //  should call the 2nd arg with 'true' if the client should be accepted,
    //   'false' otherwise
    //
    // 'cb' takes two arguments: 'shouldAccept' and 'username'
    //   'username' may be undefined (whether 'shouldAccept' is true or false)
    //
    // authenticate the client:
    //
    // 1. if the client has provided a 'user/password' as an
    //    'AUTHORIZATION' header use this to verify the user's identity
    // 2. otherwise, if the client has sent an 'mauth' cookie, use it to verify
    //    the user's identity
    // 4. otherwise, reject the request
    //
    static validateRequest(request: any, authDB: MongoDB, cb: (shouldAccept: boolean, user: string, protocol: string, reason: string) => void): void {
        function addProtocolCB(err: any, user: string, shouldAccept: boolean): void {
            cb(shouldAccept, user, "json", err === null? undefined: err.toString());
        }

        var httpRequest = request.httpRequest;
        var headers = httpRequest.headers;
        var cookieList = request.cookies ? request.cookies : [];

        WSAuth.validate(headers, cookieList, authDB, addProtocolCB, undefined);
    }

    // --------------------------------------------------------------------------
    // seqComp1 (static)
    //
    static seqComp1(a: number, b: number): number {
        return a - b;
    }

    // --------------------------------------------------------------------------
    // seqComp2 (static)
    //
    static seqComp2(a: SyncMessage, b: number): number {
        return a.sequenceNr - b;
    }

    // RemoteResourceUpdate interface

    id: number;

    resourceConnectionStateUpdate(errorId: number, errorMessage: string, ident: any): void {
        throw new Error("Method not implemented.");
    }

    allRequestsAcknowledged(resourceId: number): void {
        throw new Error("Method not implemented.");
    }

    writeAckInfoUpdate(resourceId: number, writeAckInfo: any): void {
        throw new Error("Method not implemented.");
    }
}

/// Passwords must be at least 8 characters long
function isValidPassword(pwd: string): boolean {
    return pwd.length >= 8;
}

/// Parses email address using external lib, and verifies there is at least
/// one dot in the domain name (e.g. root@com is forbidden).
function isValidEmail(email: string): boolean {
    try {
        var emailObj = emailAddresses.parseOneAddress(email);
        return emailObj !== null && emailObj.domain.indexOf(".") > 0;
    } catch (e) {
        return false;
    }
}
