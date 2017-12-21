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

/// <reference path="networkConnection.ts" />
/// <reference path="wsAuth.ts" />


//
// a NetworkClient is the way a 'client' creates a NetworkConnection;
// a 'client' is the entity initiating the connection
//
// the intended use pattern is to derive this class, and call
//  addMessageHandler(messageType, handler)
// for each message type the client is meant to handle.
//
// see networkConnection.js for description of the base class
//
//
//
// constructor arguments:
//    serverOptions: an object with the following properties:
//       protocol: either "ws" or "wss" (optional, defaults to "wss")
//       hostname: the server's hostname (mandatory)
//       port: the tcp port on the server (optional, defaults to 8080)
//
//    connectionOptions: an object passed to the base class constructor
//      
//

class NetworkClientConnection extends NetworkConnection {
    requestOptions: any;
    url: string;

    constructor(serverOptions: HostSpec, connectionOptions: HostSpec) {
        super(connectionOptions);

        var protocol: string = serverOptions.protocol === "ws"? "ws": "wss";
        var hostName: string = serverOptions.hostName;
        var port: number = serverOptions.port === undefined? 8080: serverOptions.port;
        var path: string = serverOptions.path === undefined? "/": serverOptions.path;
    
        var requestOptions: any = {};
        for (var attr in serverOptions) {
            if (attr === "protocol") {
                requestOptions.protocol = (protocol === "ws") ? "http:" : "https:";
            } else {
                requestOptions[attr] = (<any>serverOptions)[attr];
            }
        }
    
        this.url = protocol + "://" + hostName + ":" + port + path;
    
        requireWebSockets();
        requireBtoaAtob(); // base64 <-> ascii
    
        //
        // if options include a username and a password, generate an
        // 'authorization' header
        //
        if ((typeof(serverOptions.username) === "string") &&
              (typeof(serverOptions.password) === "string")) {
            var authStr = BasicWSAuth.getAuthStr(serverOptions.username,
                                                 serverOptions.password);
            if (typeof(requestOptions.headers) === "undefined") {
                requestOptions.headers = {};
            }
            requestOptions.headers["authorization"] = authStr;
        }
    
        requestOptions.protocols = ["json"];
    
        this.requestOptions = requestOptions;
    
        try {
            RemotingLog.log(1, "new web socket to url: '" + this.url + "'");
            this.connect();
        } catch (e) {
            this.connection = undefined;
        }
    
    }
    
    destroy(): void {
        this.disconnect();
    }

    // --------------------------------------------------------------------------
    // connect
    //
    connect(): void {
        this.connection = runtimeEnvironment.newWebSocket(this, this.url,
                                                          this.requestOptions);
        this.messageQueue = [];
    }

    disconnect(): void {
        this.connection.close();
        this.connection = undefined;
    }
}
