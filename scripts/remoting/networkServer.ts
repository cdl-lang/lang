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

/// <reference path="../utils/node.d.ts" />
/// <reference path="../feg/externalTypes.basic.d.ts" />
/// <reference path="networkConnection.ts" />

/*
NetworkServer establishes a 'network-server'; when a client connection is
accepted, a new NetworkServerConnection is instantiated for the server side of
the connection.

A short overview of the call structure for opening the connection in the browser
follows. Other events, like messages, are handled in a similar fashion.

- When the websocket is opened, it calls its the function openHandler of its
  owner, a RemotingClientConnection, which has inherited this function from
  NetworkConnection.
- NetworkConnection.openHandler calls the function associated with "open"
  in its eventHandlerObj. The function got there via addEventHandler().
- In this case, the RemotingClientConnection has set its own networkOpenHandler
  as the function, so it is called.
- networkOpenHandler() initializes the id mappings and calls the function
  clientOpenCB of the RemoteMgr object.
- The RemoteMgr object calls resourceConnectionStateUpdate() for all members in
  its clientConsumerList, which are Resources. There are usually 3+: one
  AppStateResource, a TableResource, which corresponds to a [database, ...], and
  a MetaDataResource, which corresponds to [databases], and one TableResource
  for each path that is open.
- None of these is currently interested in the state, so there is no further
  action.

*/

var WebSocketServer = require("websocket").server;
var http: typeof NodeJS.http = require("http");
var https: typeof NodeJS.https = require("https");
var url: typeof NodeJS.url = require("url");
var directoryListingAllowed: boolean = false;

Object.defineProperty(WebSocketServer.prototype, "readyState", {
    get: function () {
        return runtimeEnvironment.nodeWebSocketState((<any>this).state);
    }
});

interface ServerOptions {
    protocol: string;
    port: number;
    localMode: boolean;
    key?: any;
    certificate?: any;
    user?: string;
    fileServer: boolean;
}

/**
 *  options:
 *   - protocol - ws / wss
 *   - port - tcp port to bind
 *   - key - for wss
 *   - certificate - for wss
 *   - other network connection options (poolDelay, poolSize, replyTimeout)
 *   - localMode - true/false - is 'true', skip request validation (all
 *      requests are accepted) but only listen to 127.0.0.1
 *   - fileServer: when true, the http server accepts file requests
 * 
 *  newServerConnection: a function that creates an instance of a derived class
 *    of NetworkServerConnection to be instantiated per each accepted incoming
 *    client connection
 * 
 *  serverConnectionArg - an additional argument to pass to the derived class
 *    constructor (beyond the network-server instance, options and the socket)
 * 
 * @class NetworkServer
 */
class NetworkServer {
    httpServer: NodeJS.http.Server | NodeJS.https.Server;
    webSocketServer: typeof WebSocketServer;

    constructor(
        public options: ServerOptions,
        public newServerConnection: any,
        public validateRequest: (request: any, authDB: MongoDB, cb: (shouldAccept: boolean, user?: string, protocol?: any, reason?: string) => void) => void,
        public serverConnection: RemotingServer)
    {
        var protocol = options.protocol;
        var port = (options.port? options.port: 8080);
        var self = this;
    
        function callHttpRequestListener(
            request: NodeJS.http.IncomingMessage,
            response: NodeJS.http.ServerResponse): void
        {
            self.httpRequestListener(request, response);
        }
    
        function callWebSocketRequestListener(request: any, response: any): void {
            RemotingLog.log(2, "web socket request listener called");
            self.webSocketRequestListener(request, response);
        }
    
        if (protocol === "ws") {
            this.httpServer = http.createServer(callHttpRequestListener);
        } else {
            var serverOptions = {
                key: options.key,
                cert: options.certificate
            };
            this.httpServer = https.createServer(serverOptions,
                                                 callHttpRequestListener);
        }
    
        var hostname = options.localMode? "127.0.0.1": undefined;
        this.httpServer.listen(port, hostname);

        RemotingLog.log(0, "server started at port " + port);
    
        this.webSocketServer = new WebSocketServer(
            {
                httpServer: this.httpServer,
                autoAcceptConnections: false
            }
        );
    
        this.webSocketServer.on("request", callWebSocketRequestListener);
    }
    
    static extensionToMimeType: {[extension: string]: string} = {
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript',
        'svg': 'image/svg+xml',
        'png': 'image/png',
        'gif': 'image/gif',
        'bmp': 'image/bmp',
        'webp': 'image/webp',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg'
    };

    // --------------------------------------------------------------------------
    // httpRequestListener
    //
    // Acts as a simple http server: takes every request as a path to a file
    // relative to the current directory.
    // Allows storing and sending gzip'ed files: if the original URL is not
    // found, it is extended with .gz. When that file is found, it is sent with
    // the extra header Content-Encoding: gzip, or x-gzip, depending on the
    // request header.
    // Also does directory listing if the global variable directoryListingAllowed
    // is true and the URL query is format=json.
    //
    httpRequestListener(request: NodeJS.http.IncomingMessage,
                        response: NodeJS.http.ServerResponse)
    {
        RemotingLog.log(2, "http request: " + request.url + " from: " + request.socket.remoteAddress);
        if (!this.options.fileServer) {
            response.writeHead(404, {'Content-Type': 'text/html'});
            response.end("<html><body>Too bad: not a valid URL for this server</body></html>");
            return;
        }
        try {
            const myURL = url.parse(request.url);
            const fileName: string = "." + myURL.pathname;
            const headerETag = request.headers['if-none-match'];
            const extensionStartPos = myURL.pathname.lastIndexOf(".");
            const extension = extensionStartPos === -1? "":
            myURL.pathname.slice(extensionStartPos + 1).toLowerCase();
            const mimeType = extension in NetworkServer.extensionToMimeType? 
                             NetworkServer.extensionToMimeType[extension]:
                             "application/octet-stream";
            const acceptsGZip = request.headers['accept-encoding'].indexOf("gzip") >= 0;
            const acceptsXGZip = acceptsGZip && request.headers['accept-encoding'].indexOf("x-gzip") >= 0;

            function sendFile(fileName: string, fileETag: string, contentEncoding: string|undefined): void {
                fs.readFile(fileName, (err: any, data: Buffer) => {
                    if (err) {
                        RemotingLog.log(2, "file not readable: " + request.url);
                        response.writeHead(404, {'Content-Type': 'text/html'});
                        response.end("<html><body>Too bad: not a valid URL in these parts</body></html>");
                    } else {
                        let header: any = {
                            'Content-Type': mimeType,
                            'ETag': fileETag
                        }
                        RemotingLog.log(2, () => {
                            let str = "reply: " + request.url + " " + mimeType +
                                      " size=" + data.length;
                            if (contentEncoding !== undefined) {
                                str += " encoding:" + contentEncoding;
                            }
                            return str;
                        });
                        if (contentEncoding !== undefined) {
                            header['Content-Encoding'] = contentEncoding;
                        }
                        response.writeHead(200, header);
                        response.end(data);
                    }
                });
            }

            function findFile(fileName: string, contentEncoding: string|undefined): void {
                // TODO: BLOCK filenames with ./ or ../
                fs.stat(fileName, (err: any, stats: FS.Stats) => {
                    if (err) {
                        if (acceptsGZip && contentEncoding === undefined) {
                            // Look for a gzip'ed file when the original name
                            // cannot be found and the request indicates that
                            // gzip is an accepted encoding.
                            findFile(fileName + ".gz", acceptsXGZip? "x-gzip": "gzip");
                        } else {
                            RemotingLog.log(2, "file not found: " + request.url);
                            response.writeHead(404, {'Content-Type': 'text/html'});
                            response.end("<html><body>Too bad: not a valid URL in these parts</body></html>");
                        }
                        return;
                    }
                    const fileETag = (stats && stats.mtime? stats.mtime.getTime() ^ stats.size: 0).toString();
                    if (fileETag === headerETag) {
                        // Received etag is identical to current state
                        RemotingLog.log(2, "file cached: " + request.url);
                        response.writeHead(304, {
                            'ETag': stats.mtime.getTime().toString()
                        });
                        response.end("");
                    } else if (contentEncoding === undefined && directoryListingAllowed && stats.isDirectory()) {
                        if (myURL.query === "format=json") {
                            // Allow the server to send directory contents in json
                            // format. Could be useful for writing a cdl app that
                            // traverses a directory.
                            fs.readdir(fileName, (err: any, files: string[]): void => {
                                if (err) {
                                    RemotingLog.log(2, "directory not readable: " + request.url);
                                    response.writeHead(404, {'Content-Type': 'text/html'});
                                    response.end("<html><body>Too bad: not a valid URL in this neck of the woods</body></html>");
                                } else {
                                    response.writeHead(200, {
                                        'Content-Type': 'text/json',
                                        'ETag': fileETag
                                    });
                                    RemotingLog.log(2, "sending directory " + request.url);
                                    response.end(JSON.stringify(files.filter(fileName => {
                                        let extPos = fileName.lastIndexOf('.');
                                        return extPos === -1 || fileName.slice(extPos + 1) === 'html';
                                    })));
                                }
                            });
                        } else {
                            fs.readdir(fileName, (err: any, files: string[]): void => {
                                if (err) {
                                    RemotingLog.log(2, "directory not readable: " + request.url);
                                    response.writeHead(404, {'Content-Type': 'text/html'});
                                    response.end("<html><body>'tis in vain to seek a URL here that means not to be found</body></html>");
                                } else {
                                    response.writeHead(200, {
                                        'Content-Type': 'text/html',
                                        'ETag': fileETag
                                    });
                                    RemotingLog.log(2, "sending directory " + request.url);
                                    response.end('<html><body style="font-family: sans-serif;">' + files.map(fn => {
                                        if (fn[0] !== '.') {
                                            const dstats = fs.statSync(fileName + "/" + fn);
                                            if (dstats.isDirectory()) {
                                                return '<a href="' + encodeURIComponent(fn) + "/" + '">' + fn + '</a>';
                                            } else if (fn.endsWith(".html")) {
                                                return fn +
                                                    ':<a href="' + encodeURIComponent(fn) + '">remote</a> ' +
                                                    ' <a href="' + encodeURIComponent(fn) + '?remote=false">local</a>';
                                            }
                                        }
                                        return undefined;
                                    }).filter(p => p !== undefined).join("<p>\n") + "</body></html>");
                                }
                            });
                        }
                    } else if (!stats.isFile) {
                        RemotingLog.log(2, "file found but not a normal file: " + request.url);
                        response.writeHead(404, {'Content-Type': 'text/html'});
                        response.end("<html><body>Too bad: not a valid URL around these parts</body></html>");
                    } else {
                        sendFile(fileName, fileETag, contentEncoding);
                    }
                });
            }

            findFile(fileName, undefined);

        } catch (e) {
            RemotingLog.log(2, "bad url: " + request.url);
            response.writeHead(404, {'Content-Type': 'text/html'});
            response.end("<html><body>Too bad: not a valid URL</body></html>");
        }
    }
    
    // --------------------------------------------------------------------------
    // shutdown
    //
    shutdown() {
        this.webSocketServer.shutDown();
        this.httpServer.close();
    }
    
    // --------------------------------------------------------------------------
    // webSocketRequestListener
    //
    // this method is called when a new webSocket connection is pending;
    // it uses this.validateRequest() to decide whether the
    //  webSocket connection should be accepted or rejected.
    // if it is accepted, a new ServerConnection is generated
    //
    // this.validateRequest should be a function taking two
    //  arguments: the request, and the validationCB.
    // The validationCB should be called by this.validateRequest
    //  when it has decided about the fate of the candidate webSocket connection:
    //  if it is to be rejected, the first argument should be 'false', and then
    //   no additional arguments are required.
    //  if it is to be accepted, then the first argument should be 'true', the
    //   second should be the authenticated user's name (a string), and the third
    //   should be the webSocket sub-protocol.
    //  The user name may also be 'undefined', if no authentication of the user
    //   was performed but the connection should nonetheless be admitted
    //
    webSocketRequestListener(request: any, response: any): void {
        var self = this;
        // True when validationCB can only be called with shouldAccept === true
        // after authentication.
        var connectionAuthenticated: boolean = false;
    
        RemotingLog.log(1, "got connection from '" + request.remoteAddress + "'");
        this.serverConnection.logUserAction("connect", {from: request.remoteAddress});
    
        function validationCB(shouldAccept: boolean, user?: string, protocol?: any, reason?: string) {
            var socket: WebSocketConnection;
            self.serverConnection.logUserAction("requestValidation", {
                from: request.remoteAddress,
                user: user,
                accept: shouldAccept,
                reason: reason
            });
            if (shouldAccept === true) {
                try {
                    socket = request.accept(protocol, request.origin);
                } catch (e) {
                    RemotingLog.log(0, "exception in request.accept: " + e.toString());
                    return;
                }
                Object.defineProperty(
                    socket, "readyState", {
                        get: function() {
                            return runtimeEnvironment.nodeWebSocketState(
                                socket.state);
                        }
                    }
                );
    
                self.options.user = user;
    
                self.newServerConnection(self, self.options, socket,
                                self.serverConnection, connectionAuthenticated);
    
            } else {
                request.reject(401, "Authentication Failure");
            }
        }
    
        // localMode - no validation, only allow connection from the local machine
        if (this.options.localMode) {
            if (request.remoteAddress === "127.0.0.1") {
                connectionAuthenticated = true;
                validationCB(true, undefined, "json", "local mode");
            } else {
                RemotingLog.log(0, "unexpected remote address in local mode");
                validationCB(false, undefined, undefined, "remote connection to local server");
            }
        } else if (!Authorization.allowAddingUsers && !Authorization.publicDataAccess) {
            connectionAuthenticated = true;
            this.validateRequest(request, this.serverConnection.authDB, validationCB);
        } else {
            validationCB(true, undefined, "json", "no authentication required");
        }
    }
}

abstract class NetworkServerConnection extends NetworkConnection {
    user: string;

    constructor(
        public networkServer: NetworkServer,
        options: any,
        public connection: WebSocketConnection,
        public authDB: MongoDB)
    {
        super(options);

        var self: NetworkServerConnection = this;
    
        RemotingLog.log(1, "New Server Connection");
    
        function callMessageHandler(message: any): void {
            self.messageHandler(message.utf8Data);
        }
        function callCloseHandler() {
            self.networkServer.serverConnection.logUserAction("disconnect", {
                user: self.user,
                from: self.connection === undefined? "unknown":
                      self.connection.remoteAddress
            });
            self.closeHandler(undefined);
        }
    
        this.connection.on("message", callMessageHandler);
        this.connection.on("close", callCloseHandler);

        this.openHandler();
    }
}
