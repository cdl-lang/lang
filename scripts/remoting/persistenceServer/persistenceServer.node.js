//# persistenceServer.template:1
var packageParameters_str = "{}";
var profileParameters_str = "{}";

//# ../../feg/systemEvents.js:1
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
class SystemEventHandler {
}
/**
 * A dispatcher for events between unrelated modules.
 *
 * If you are interested in event x, you register yourself as a handler via
 * addHandler(x, cb, userInfo?); cb is a callback function that will be called
 * every time event x occurs. It gets passed the handler's id, the optional user
 * info, and event info (if the event provides it). Unregistering is done via
 * removeHandler(x, id), using the id returned by addHandler.
 *
 * The latest info of event x can be obtained via getLatestEventInfo(x), and the
 * number of times event x has been seen via getEventCount(x).
 *
 * When an event occurs, notifyHandlers() should be called with a list of all
 * relevant event names. Having a list of events makes it a bit easier to
 * register a general "error" handler and more specialized handlers e.g. for
 * "connection error".
 *
 * @class SystemEvents
 */
class SystemEvents {
    constructor() {
        this.nextSystemEventHandlerId = 0;
        this.eventHandlers = new Map();
        this.lastEventInfo = new Map();
    }
    addHandler(event, handler, userInfo) {
        var id = this.nextSystemEventHandlerId++;
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Map());
        }
        this.eventHandlers.get(event).set(id, {
            id: id,
            handler: handler,
            userInfo: userInfo
        });
        return id;
    }
    removeHandler(event, id) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).delete(id);
        }
    }
    /**
     * Notifies the handlers for the list of events.
     *
     * @param {string[]} events
     * @param {*} [eventInfo]
     *
     * @memberof SystemEvents
     */
    notifyHandlers(events, eventInfo) {
        for (var i = 0; i < events.length; i++) {
            var event = events[i];
            if (this.eventHandlers.has(event)) {
                this.eventHandlers.get(event).forEach(function (systemEventHandler) {
                    systemEventHandler.handler(systemEventHandler.id, eventInfo === undefined ? undefined : eventInfo[i], systemEventHandler.userInfo);
                });
            }
        }
        this.lastEventInfo.set(event, {
            count: this.getEventCount(event) + 1,
            eventInfo: eventInfo
        });
    }
    getEventCount(event) {
        return this.lastEventInfo.has(event) ? this.lastEventInfo.get(event).count : 0;
    }
    getLatestEventInfo(event) {
        return this.lastEventInfo.has(event) ?
            this.lastEventInfo.get(event).eventInfo : undefined;
    }
}
var globalSystemEvents = new SystemEvents();

//# ../../utils/inheritance.js:1
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


// This file provides a simple mechanism for allowing one class to inherit from
// another.
//
//
// Members of A that are not defined in B will be copied to B's prototype,
//  so that they can be used directly: A.aMemberFunc() -> B.aMemberFunc()
//
// All members of A are also copied to B with a prefix of 'A_', like
//  this: A.aMemberFunc() -> B.A_aMemberFunc()
//
// As hinted above, the base constructor is also copied to the derived
//  class with the base name: A.constructor -> B.A

// some of this was inspired by http://mckoss.com/jscript/object.htm
// some more from http://www.golimojo.com/etc/js-subclass.html

// don't derive the same couple "<base>::<derived>" twice
var copiedPrototypeHash = {};

function getConstructorName(constructor) {
    function getFnName(fn) {
        var f = typeof fn == 'function';
        var s = f && ((fn.name && ['', fn.name]) ||
                      fn.toString().match(/function ([^\(]+)/));
        return (!f && 'not a function') || (s && s[1] || 'anonymous');
    }

    if (constructor.name === undefined) {
        return getFnName(constructor);
    } else {
        return constructor.name;
    }
}

function inherit(derived, base) {

    var baseConst;
    var baseName;

    var baseMemberName;

    baseName = getConstructorName(base.prototype.constructor);
    var derivedName = getConstructorName(derived.prototype.constructor);
    var hashStr = baseName + "::" + derivedName;

    // was this already done?
    if (hashStr in copiedPrototypeHash) {
        return;
    }
    copiedPrototypeHash[hashStr] = true;

    function BaseConstructor(){}
    BaseConstructor.prototype = base.prototype;
    var derivedPrototype = new BaseConstructor();
    derivedPrototype.constructor = derived;

    var derivedPrototypeCopy = derived.prototype;
    derived.prototype = derivedPrototype;

    var f;
    for (f in derivedPrototypeCopy) {
        derived.prototype[f] = derivedPrototypeCopy[f];
    }


    // derived may well have not been initialized yet, so we're not sure which
    //  methods it will eventually override; hence, we can no longer copy only
    //  the methods that were overridden, but rather must copy all
    // (in the past, prototype copying was executed after reading all javascript
    //  so that only the methods that were actually overridden could be
    //  copied)
    for (f in base.prototype) {
        // copy overridden method 'mthd' to derived.base_mthd()
        baseMemberName = baseName + '_' + f;
        derived.prototype[baseMemberName] = base.prototype[f];
    }
    derived.prototype[baseName] = base.prototype.constructor;
}
//# ../../feg/pathFunctions.js:1
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
class ResourcePath {
    constructor(hierarchy, baseName, extension) {
        this.hierarchy = hierarchy;
        this.baseName = baseName;
        this.extension = extension;
    }
    up() {
        var resPath = this.clone();
        resPath.hierarchy.pop();
        return resPath;
    }
    down(subHier) {
        var resPath = this.clone();
        resPath.hierarchy = resPath.hierarchy.concat(subHier);
        return resPath;
    }
    replaceExtension(extension) {
        var resPath = this.clone();
        resPath.extension = extension;
        return resPath;
    }
}
class PathFunctions {
}
class URLResourcePath extends ResourcePath {
    constructor(protocol, hierarchy, baseName, extension, args) {
        super(hierarchy, baseName, extension);
        this.protocol = protocol;
        this.args = args;
    }
    getResourceString() {
        return this.protocol + "://" +
            (this.hierarchy.length === 0 ? "" : this.hierarchy.map(encodeURIComponent).join("/") + "/") +
            this.baseName + (this.extension === undefined ? "" : "." + this.extension) +
            (this.args === undefined ? "" : "?" + this.args);
    }
    clone() {
        return new URLResourcePath(this.protocol, this.hierarchy.map(decodeURIComponent), this.baseName, this.extension, this.args);
    }
    getURLResourcePath() {
        return this;
    }
}
class URLPathFunctions extends PathFunctions {
    getPath(path) {
        var matches = path.match(/^[a-z]+:\/\//);
        var protocol;
        var hierarchy;
        var baseName;
        var extension;
        var args;
        var qIndex;
        var dotIndex;
        if (matches === null) {
            return undefined;
        }
        protocol = matches[0].slice(0, -3);
        path = path.slice(matches[0].length);
        qIndex = path.indexOf("?");
        if (qIndex >= 0) {
            args = path.slice(qIndex + 1);
            path = path.slice(0, qIndex);
        }
        hierarchy = path.split("/");
        baseName = hierarchy.pop();
        dotIndex = baseName === undefined ? -1 : baseName.lastIndexOf(".");
        if (dotIndex >= 0) {
            extension = baseName.slice(dotIndex + 1);
            baseName = baseName.slice(0, dotIndex);
        }
        return new URLResourcePath(protocol, hierarchy, baseName, extension, args);
    }
}
class OSResourcePath extends ResourcePath {
    constructor(isWindows, hierarchy, baseName, extension) {
        super(hierarchy, baseName, extension);
        this.isWindows = isWindows;
    }
    getResourceString() {
        var sep = this.isWindows ? "\\" : "/";
        return (this.hierarchy.length === 0 ? "" : this.hierarchy.join(sep) + sep) +
            this.baseName + (this.extension === undefined ? "" : "." + this.extension);
    }
    clone() {
        return new OSResourcePath(this.isWindows, this.hierarchy, this.baseName, this.extension);
    }
    getURLResourcePath() {
        return new URLResourcePath("file", this.hierarchy, this.baseName, this.extension, undefined);
    }
}
class OSPathFunctions extends PathFunctions {
    constructor(isWindows) {
        super();
        this.isWindows = isWindows;
    }
    getPath(path) {
        var hierarchy;
        var baseName;
        var extension;
        hierarchy = path.split(this.isWindows ? /\\\\|\// : /\//);
        baseName = hierarchy.pop();
        var dotIndex = baseName === undefined ? -1 : baseName.lastIndexOf(".");
        if (dotIndex >= 0) {
            extension = baseName.slice(dotIndex + 1);
            baseName = baseName.slice(0, dotIndex);
        }
        return new OSResourcePath(this.isWindows, hierarchy, baseName, extension);
    }
}
//# ../../utils/environment.js:1
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

var runtimeEnvironment = {};
var performance; // declares alternative to window.performance in nodejs

if (typeof window !== "undefined") {
    runtimeEnvironment.appName = window.location.href;
    var endOfURL = runtimeEnvironment.appName.indexOf('?');
    if (endOfURL === -1) {
        endOfURL = runtimeEnvironment.appName.length;
    }
    runtimeEnvironment.name = "browser";
    runtimeEnvironment.dirName = runtimeEnvironment.appName.slice(
        0, runtimeEnvironment.appName.lastIndexOf('/', endOfURL) + 1);
    runtimeEnvironment.appName = runtimeEnvironment.appName.slice(
        runtimeEnvironment.dirName.length, endOfURL);
    runtimeEnvironment.appName = runtimeEnvironment.appName.slice(
        0, Math.min(runtimeEnvironment.appName.length,
                    runtimeEnvironment.appName.lastIndexOf('.')));
    runtimeEnvironment.pathFunctions = new URLPathFunctions();
    var require = function () {};
} else if (typeof process !== "undefined") {
    runtimeEnvironment.appName = process.argv[1];
    runtimeEnvironment.name = "nodejs";
    runtimeEnvironment.dirName = "file://" +
        (process.platform.startsWith("win")? __dirname.replace(/\\/g, "/"): __dirname) +
        "/";
    runtimeEnvironment.pathFunctions = new OSPathFunctions(process.platform.startsWith("win"));
}

function requireDom() {
    if (runtimeEnvironment.name === "nodejs" && !runtimeEnvironment.jsdom) {
        createBasicMondriaDocument();
        window = new DOMWindow(document);
        navigator = {};
        runtimeEnvironment.jsdom = true;
    }
}

//
// fix the display-query (aka survey) engine
//
// in a nodejs environment, estimate
// in a browser, use the browser, unless 'surveyMode' is set to estimate,
// or running tests.
//
function requireSurveyMode() {
    if (runtimeEnvironment.surveyMode) {
        return;
    }

    var argParser = getArgParser();

    if (runtimeEnvironment.name === "nodejs") {
        runtimeEnvironment.surveyMode = "estimate";
    }

    else if (argParser.getArg("surveyMode")) {
        runtimeEnvironment.surveyMode = argParser.getArg("surveyMode");
    }

    else {
        runtimeEnvironment.surveyMode = runTests? "estimate": "browser";
    }

}

runtimeEnvironment.nodeWebSocketState =  function(strState) {
    switch (strState) {
      case 'open': return 1;
      case 'closing': return 2;
      case 'closed': return 3;
      default: return -2;
    }
}

function requireWebSockets() {
    if (runtimeEnvironment.newWebSocket) {
        return;
    }
    var WebSocket;
    if (runtimeEnvironment.name === "browser") {
        WebSocket = window.WebSocket || window.MozWebSocket;
        if (! WebSocket) {
            throw "No WebSockets";
        }
    } else if (runtimeEnvironment.name === "nodejs") {
        WebSocket = require("websocket").w3cwebsocket;
    }
    runtimeEnvironment.newWebSocket = function (owner, url, options) {
        var headers;
        var protocols;
        if (options) {
            headers = options.headers;
            protocols = options.protocols;
        }
        var webSocket = new WebSocket(url, protocols);
        webSocket.onopen = function () {
            owner.openHandler();
        };
        webSocket.onerror = function (error) {
            owner.errorHandler(error);
        };
        webSocket.onmessage = function (message) {
            owner.messageHandler(message.data);
        };
        webSocket.onclose = function (error) {
            owner.closeHandler(error);
        };
        owner.state = function() {
            return webSocket.readyState;
        };
        return webSocket;
    };
}

function requirePerformanceNow() {
    if (runtimeEnvironment.name === "nodejs" && !performance) {
        performance = {
            now: require("performance-now")
        };
        runtimeEnvironment.performance = performance;
    }
}

var btoa, atob;
function requireBtoaAtob() {
    if (runtimeEnvironment.name === "nodejs") {

        if (typeof(btoa) === "undefined") {
            btoa = function (str) { 
                return (new Buffer(str || "", "base64")).toString("ascii");
            };
        }

        if (typeof(atob) === "undefined") {
            atob = function (str) {
                return  (new Buffer(str || "", "ascii")).toString("base64");
            };
        }
    }
}

function requireFS() {
    if (runtimeEnvironment.name === "nodejs") {
        if (runtimeEnvironment.fs === undefined) {
            runtimeEnvironment.fs = require("fs");
        }
        return runtimeEnvironment.fs;
    } else {
        return undefined;
    }
}

function requirePath() {
    if (runtimeEnvironment.name === "nodejs") {
        if (runtimeEnvironment.path === undefined) {
            runtimeEnvironment.path = require("path");
        }
        return runtimeEnvironment.path;
    } else {
        return undefined;
    }
}

function requireXMLHttpRequest() {
    if (runtimeEnvironment.name === "nodejs") {
        if (runtimeEnvironment.xmlhttprequest === undefined) {
            runtimeEnvironment.xmlhttprequest =
                require("xmlhttprequest").XMLHttpRequest;
        }
        return runtimeEnvironment.xmlhttprequest;
    } else {
        return undefined;
    }
}

// Environment (browser) support for various features

var isJSONSupported;
var isSVGSupported;
var isSvgweb;
var svgNS;
var isInternetExplorer;

var useConsoleLog;
var useConsoleLogApply;
var useOperaPostError;
var useSetAttribute;
var userLocale;
// If you use secondModifierKey in your cdl, it maps to control on a pc,
// and cmd on a mac.
var secondModifierKey = typeof(navigator) !== "undefined" &&
                        navigator.platform == "MacIntel"? "meta": "control";

// Main initialization function

// This function checks which features are supported by the environment
// (the browser) and sets the corresponding global mode flags.

function initializeModeDetection()
{
    // JSON
    
    isJSONSupported = (typeof(JSON) == 'undefined' ? false : true);

    // SVG
    
    isSvgweb = (typeof(svgweb) != 'undefined');
    isSVGSupported =
        (typeof(document) !== "undefined" &&
         ((document.xmlVersion && typeof(document.xmlVersion) == 'string') ||
          (document.URL.match(/xhtml$/)))) ||
        (isSvgweb);

    svgNS =
        (typeof(svgns) != 'undefined' ? svgns : "http://www.w3.org/2000/svg");

    if ((typeof(console) != 'undefined') && (console.log)) {
        useConsoleLog = true;
        if (('function' == typeof(console.log)) && (console.log.prototype) &&
            (console.log.prototype.constructor) &&
            (console.log.prototype.constructor.
             toString().indexOf("[native code]") < 0)) {
            useConsoleLogApply = true;
        }
    } else if ((typeof(opera) != 'undefined') && opera.postError) {
        useOperaPostError = true;
    }

    // setProperty()
    if (typeof(document) !== "undefined" && document.body && document.body.style &&
        document.body.style.setAttribute) {
        useSetAttribute = true;
    }

    // internet explorer
    if (typeof(bowser) === "undefined") {
        userLocale = "en-US"; // World dominance, baby.
    } else if (bowser.msie) {
        isInternetExplorer = true;
        userLocale = navigator.browserLanguage;
    } else {
        userLocale = navigator.language;
        if (userLocale === undefined) {
            userLocale = "en-US";
        }
    }

    // Test via a getter in the options object to see if the passive property is accessed
    // from: https://github.com/WICG/EventListenerOptions/blob/gh-pages/explainer.md
    runtimeEnvironment.supportsPassiveListeners = false;
    try {
        var opts = Object.defineProperty({}, 'passive', {
            get: function () {
                runtimeEnvironment.supportsPassiveListeners = true;
            }
        });
        window.addEventListener("test", null, opts);
    } catch (e) {
    }
}

function getWindowLocation()
{
    return typeof(window) === "undefined"? undefined: window.location;
}

// Polyfills: add functions that may not exist in certain browsers to standard
// objects.

if (!("log10" in Math)) {
    Math.log10 = function(x) { return Math.log(x) / Math.LN10; };
}

if (typeof(navigator) !== "undefined" && typeof(navigator.getBattery) === "function") {
    navigator.getBattery().then(function(battery) {
        globalSystemEvents.notifyHandlers(["power disconnected"], [!battery.charging]);
        battery.addEventListener('chargingchange', function() {
            globalSystemEvents.notifyHandlers(["power disconnected"], [!battery.charging]);
        });
    });
}
//# ../../utils/argParse.js:1
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

"use strict";

//
// arg parsing
//
// getArgParser returns an arg-parsing instance appropriate for the
//  current host environment:
// - for node.js, that would be an 'ArgvParser'
// - for a browser, a 'UrlParser'
//
// an argv-parser collects the arguments of the form 'x=y' from
//  node app.js x1=y1 x2=y2
//  an argument '--' forces this parsing to stop, so that even if an argument
//  following the '--' has an 'equal' sign it is not parsed.
//
// a url parser takes the set of query-strings at the end of a url, following
//  the '?' mark: http://server/a1/a2?x1=y1&x2=y2'
//
// Both parsers support a similar interface:
//
// getArg(name, defVal) - if name appears in the set of parsed arguments, then
//  return its value, otherwise return 'defVal'
//
// hasArg(name) - boolean valued - was 'name' a parsed argument?
//
// getArgList() - returns an array of all of the parsed argument names
//
// getAppName() - returns the name of the application being executed;
//  this is argv[1] in node.js, and the full url up to (and excluding) the
//  query string in html mode
//

var gArgParser = undefined;

function getArgParser() {
    if (gArgParser === undefined) {
        if (typeof(process) === "undefined" ||
              typeof(process.argv) === "undefined") {
            gArgParser = new UrlArgParser(window.location.search.substring(1));
        } else {
            gArgParser = new ArgvParser(process.argv);
        }
    }
    return gArgParser;
}

function addProfileParameters(parsed) {
    try {
        var appParamVals =
            new StringParseCDLValue().parse(packageParameters_str).tree.result;
        if (typeof(appParamVals) === "object") {
            for (var name in appParamVals) {
                parsed[name] = appParamVals[name];
            }
        }
        appParamVals =
            new StringParseCDLValue().parse(profileParameters_str).tree.result;
        if (typeof(appParamVals) === "object") {
            for (var name in appParamVals) {
                parsed[name] = appParamVals[name];
            }
        }
    } catch (e) {
    }
}

function ArgvParser(argv)
{
    this.argv = argv;
    this.parsed = {};
    this.unparsed = [];
    this.appName = argv[1];

    for (var i = 0; i < argv.length; i++) {
        var arg = argv[i];

        // all the rest of the args are unprocessed
        if (arg === "--") {
            this.unparsed.push.apply(this.unparsed, argv.slice(i+1));
            break;
        }

        var eqIdx = arg.indexOf("=");
        if (eqIdx > 0) {
            var name = arg.substring(0, eqIdx);
            var val = arg.substring(eqIdx + 1);
            this.parsed[name] = argvConvertString(val);
        } else {
            this.unparsed.push(arg);
        }
    }
    addProfileParameters(this.parsed);
}

function argvConvertString(str) {
    if (str === "true") {
        return true;
    } else if (str === "false") {
        return false;
    } else if (str !== "" && !isNaN(Number(str))) {
        return Number(str);
    } else {
        return str;
    }
}

var actualArgumentValues = {};
// --------------------------------------------------------------------------
// getArg
//
ArgvParser.prototype.getArg = argvParserGetArg;
function argvParserGetArg(name, defVal) {
    return (name in this.parsed) ? this.parsed[name] : defVal;
}

// --------------------------------------------------------------------------
// hasArg
//
ArgvParser.prototype.hasArg = argvParserHasArg;
function argvParserHasArg(name)
{
    return (name in this.parsed);
}

// --------------------------------------------------------------------------
// getArgv
//
ArgvParser.prototype.getArgv = argvParserGetArgv;
function argvParserGetArgv()
{
    return this.unparsed;
}

// --------------------------------------------------------------------------
// getRawArgv
//
ArgvParser.prototype.getRawArgv = argvParserGetRawArgv;
function argvParserGetRawArgv()
{
    return this.argv();
}

// --------------------------------------------------------------------------
// getArgList
//
ArgvParser.prototype.getArgList = argvParserGetArgList;
function argvParserGetArgList()
{
    return Object.keys(this.parsed);
}

// --------------------------------------------------------------------------
// getAppName
//
ArgvParser.prototype.getAppName = argvParserGetAppName;
function argvParserGetAppName()
{
    return this.appName;
}


function UrlArgParser(queryString)
{
    this.queryString = queryString;
    this.queryList = this.queryString.split("&");
    this.appName = undefined;

    if ((typeof(window) !== "undefined") &&
        (typeof(window.location) !== "undefined")) {

        var appName = window.location.href;
        var qryIdx = appName.indexOf("?");
        if (qryIdx >= 0) {
            appName = appName.slice(0, qryIdx);
        }
        this.appName = appName;
    }

    this.variable = {};
    for (var i = 0; i < this.queryList.length; i++) {
        var queryItem = this.queryList[i];
        var nameAndValue = queryItem.split("=");
        var name = decodeURIComponent(nameAndValue[0]);
        var val = decodeURIComponent(nameAndValue[1]);
        this.variable[name] = argvConvertString(val);
    }
    addProfileParameters(this.variable);
}

// --------------------------------------------------------------------------
// getArg
//
UrlArgParser.prototype.getArg = urlArgParserGetArg;
function urlArgParserGetArg(name, defVal)
{
    return (name in this.variable) ? this.variable[name] : defVal;
}

// --------------------------------------------------------------------------
// hasArg
//
UrlArgParser.prototype.hasArg = urlArgParserHasArg;
function urlArgParserHasArg(name)
{
    return (name in this.variable);
}

// --------------------------------------------------------------------------
// getArgv
//
UrlArgParser.prototype.getArgv = urlArgParserGetArgv;
function urlArgParserGetArgv()
{
    return [];
}

// --------------------------------------------------------------------------
// getRawArgv
//
UrlArgParser.prototype.getRawArgv = urlArgParserGetRawArgv;
function urlArgParserGetRawArgv()
{
    return [];
}

// --------------------------------------------------------------------------
// getArgList
//
UrlArgParser.prototype.getArgList = urlArgParserGetArgList;
function urlArgParserGetArgList()
{
    return Object.keys(this.variable);
}

// --------------------------------------------------------------------------
// getAppName
//
UrlArgParser.prototype.getAppName = urlArgParserGetAppName;
function urlArgParserGetAppName()
{
    return this.appName;
}
//# ../../utils/binsearch.js:1
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

// =======================================================================
// binarySearch
//
// search for val inside the sorted array 'arr', where 'comp' is a function
// called as "comp(arr[x], val) ", that should return negative, 0, positive if
// arr[x] is less-than, equals-to, greater than 'val', respectively.
// The return value is the non-negative index i of 'arr' for which
//  comp(arr[i], val) == 0), or if none exists the negative integer i such that
//  comp(arr[-(i+1)], val) < 0) && comp(arr[-(i+2)], val) > 0) (with the
//  appropriate adjustments for the two boundary conditions).
// This can be used with:
// i = binarySearch(arr, val, comp);
// if (i < 0) {
//   i = -(i + 1);
//   arr.splice(i, 0, newElementFor(val));
// }
// and now 'i' is the correct index for 'val'.
//
function binarySearch(arr, val, comp, from, to, compInfo)
{
    from = typeof(from) === "undefined" ? 0 : from;
    to = (typeof(to) === "undefined") ? arr.length - 1 : to;

    var i = 0;

    var res;

    if (from > to)
        return -1;

    while (from < to) {
        i = Math.floor((to + from) / 2);
        res = comp(arr[i], val, compInfo);
        if (res < 0) {
            from = i + 1;
        } else if (res > 0) {
            to = i - 1;
        } else {
            return i;
        }
    }

    res = comp(arr[from], val, compInfo);
    if (res < 0) {
        return - (from + 2);
    } else if (res > 0) {
        return - (from + 1);
    } else {
        return from;
    }
}

// This function is very similar to binarySearch() above. There are two
// differences, however:
// 1. In case the 'k' being searched is equal (as defined by the 'comp'
//    function) to multiple elements in the array 'arr', the position of
//    the first of these equal values is returned (rather than an arbitrary
//    one of these values, as is returned by binarySearch()).
// 2. The return value of this function does not distinguish between
//    the case where there is an existing entry in the array which is
//    equal (by 'comp') to the searched 'val' and the case where there
//    is no such existing entry in the array. In either case, the function
//    returns a non-negative integer which is the position of the
//    first element in the array which is larger or equal to 'val'.
//    If all values in the array are smaller, the position returned is
//    the length of the array (the first position after the end of the
//    array).
// 3. Skips undefined values in a by moving down to the lower bound of the
//    current iteration until it finds a defined value. If it doesn't, the
//    lower bound is set the initial undefined value
function binarySearch2(a, k, comp, start, end) {
    start = start === undefined? 0: start;
    end = end === undefined? a.length - 1: end;
    var l = start - 1, h = end + 1; 

    // we consider a[start-1] = -inf, a[end+1] = +inf, so a[l] < k <= a[h]
    while (l + 1 < h) {
        var m = Math.floor((l + h) / 2);
        var m2 = m; // l < m == m2 < h
        while (m > l && a[m] === undefined) m--;
        if (a[m] === undefined || comp(a[m], k) < 0)
            l = m2;
        else
            h = m;
        // distance between l and h has decreased and still a[l] < k <= a[h]
    }
    // l + 1 >= h && a[l] < k <= a[h]
    // l + 1 == h => l + 1 is the answer
    // l + 1 > h => empty array => l + 1 == end => l + 1 is the answer
    return l + 1;
}

//# ../../feg/utilities.js:1
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
var mode;
var showResolution;
var Utilities;
(function (Utilities) {
    class AssertException {
        constructor(msg) {
            this.msg = msg;
        }
        toString() {
            return this.msg;
        }
    }
    Utilities.AssertException = AssertException;
    function isEmptyObj(obj) {
        return Object.keys(obj).length === 0;
    }
    Utilities.isEmptyObj = isEmptyObj;
    function firstAttribute(obj) {
        return Object.keys(obj)[0];
    }
    Utilities.firstAttribute = firstAttribute;
    function filterObj(obj, f) {
        var nObj = {};
        for (var attr in obj) {
            if (f(attr, obj[attr])) {
                nObj[attr] = obj[attr];
            }
        }
        return nObj;
    }
    Utilities.filterObj = filterObj;
    // Applies a function to all attribute-value pairs, and stores the result under
    // the same attribute
    function mapObj(obj, f) {
        var nObj = {};
        for (var attr in obj) {
            nObj[attr] = f(attr, obj[attr]);
        }
        return nObj;
    }
    Utilities.mapObj = mapObj;
    function addAssociationPath(obj, path, value) {
        var ptr = obj;
        for (var i = 0; i < path.length - 1; i++) {
            if (!(path[i] in ptr) || !ptr[path[i]] ||
                !(ptr[path[i]] instanceof Object)) {
                ptr[path[i]] = {};
            }
            ptr = ptr[path[i]];
        }
        ptr[path[path.length - 1]] = value;
    }
    Utilities.addAssociationPath = addAssociationPath;
    function getAssociationPath(obj, path, start = 0) {
        var i;
        var ptr = obj;
        for (i = (start === undefined ? 0 : start); i < path.length; i++) {
            if (!(ptr instanceof Object) || !(path[i] in ptr)) {
                return undefined;
            }
            ptr = ptr[path[i]];
        }
        return ptr;
    }
    Utilities.getAssociationPath = getAssociationPath;
    function hasAssociationPath(obj, path, start = 0) {
        return getAssociationPath(obj, path, start) !== undefined;
    }
    Utilities.hasAssociationPath = hasAssociationPath;
    function warnMessage(msg) {
        console.log(msg);
    }
    Utilities.warnMessage = warnMessage;
    function errorMessage(msg) {
        console.log(msg);
        debugger;
    }
    Utilities.errorMessage = errorMessage;
    function dupObjSafe(obj) {
        if (obj instanceof ElementReference) {
            return new ElementReference(obj.getElement());
        }
        if (obj instanceof Array) {
            var arr = [];
            arr.length = obj.length;
            for (var i = 0; i !== obj.length; i++) {
                arr[i] = dupObjSafe(obj[i]);
            }
            return arr;
        }
        if (obj instanceof Object) {
            var cl = {};
            for (var attr in obj) {
                cl[attr] = dupObjSafe(obj[attr]);
            }
            return cl;
        }
        return obj;
    }
    Utilities.dupObjSafe = dupObjSafe;
    function error(msg) {
        var context = gErrContext.getErrorContext();
        if (context !== undefined) {
            msg += " at " + context;
        }
        errorMessage("error: " + msg);
        throw new AssertException(msg);
    }
    Utilities.error = error;
    Utilities.hasSyntaxError = false;
    function syntaxError(msg, fullContext = false, contextLine = undefined) {
        var context = gErrContext.getErrorContext(fullContext);
        if (context !== undefined) {
            msg += " at " + context;
        }
        if (contextLine !== undefined) {
            msg += "\n" + (mode === "dump" ? "" : "// error: ") + contextLine;
        }
        if (msg in oldWarnings) {
            return;
        }
        oldWarnings[msg] = true;
        if (mode === "dump") {
            console.log("error: " + msg);
        }
        else {
            console.log("// error: " + msg);
        }
        Utilities.hasSyntaxError = true;
    }
    Utilities.syntaxError = syntaxError;
    function semanticWarning(msg, level) {
        var context = gErrContext.getErrorContext();
        if (context !== undefined) {
            msg += " at " + context;
        }
        if (!(msg in oldWarnings)) {
            oldWarnings[msg] = true;
            if (level < strictnessLevel) {
                console.log("// error: " + msg);
            }
            else {
                console.log("// warning: " + msg);
            }
        }
    }
    Utilities.semanticWarning = semanticWarning;
    var typeErrors;
    function typeError(msg) {
        var context = gErrContext.getErrorContext();
        if (context !== undefined) {
            msg += " at " + context;
        }
        if (msg in typeErrors) {
            return;
        }
        typeErrors[msg] = true;
    }
    Utilities.typeError = typeError;
    function resetAllTypeErrors() {
        typeErrors = {};
    }
    Utilities.resetAllTypeErrors = resetAllTypeErrors;
    // Type errors should be printed once all value types have stabilized.
    function printAllTypeErrors() {
        for (var msg in typeErrors) {
            if (mode === "dump") {
                console.log("error: type error: " + msg);
            }
            else {
                console.log("// error: type error: " + msg);
            }
        }
    }
    Utilities.printAllTypeErrors = printAllTypeErrors;
    var oldWarnings = {};
    function warn(msg) {
        var context = gErrContext.getErrorContext();
        if (context !== undefined) {
            msg += " at " + context;
        }
        if (mode === "dump") {
            warnMessage("warning: " + msg);
        }
        else {
            warnMessage("// warning: " + msg);
        }
    }
    Utilities.warn = warn;
    function warnOnce(msg) {
        if (!(msg in oldWarnings)) {
            warn(msg);
            oldWarnings[msg] = true;
        }
    }
    Utilities.warnOnce = warnOnce;
    function log(msg) {
        console.log(msg);
    }
    Utilities.log = log;
    function runtimeWarning(msg) {
        if (showRuntimeWarnings) {
            warnMessage("warning: " + msg);
        }
    }
    Utilities.runtimeWarning = runtimeWarning;
})(Utilities || (Utilities = {}));
function arrayEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    for (var i = 0; i !== a.length; i++) {
        if (!a[i].isEqual(b[i])) {
            return false;
        }
    }
    return true;
}
function array2Equal(a, b) {
    if (a === undefined || b === undefined) {
        return a === b;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (var i = 0; i !== a.length; i++) {
        if (!arrayEqual(a[i], b[i])) {
            return false;
        }
    }
    return true;
}
function assert(condition, msg) {
    if (!condition) {
        Utilities.error("assert failure: " + msg);
    }
}
function assertFalse(condition, msg) {
    assert(!condition, msg);
}
function setUnion(a, b) {
    if (a === undefined) {
        return b;
    }
    else if (b === undefined) {
        return a;
    }
    else {
        var union = {};
        for (var elem in a) {
            union[elem] = a[elem];
        }
        for (var elem in b) {
            if (!(elem in union)) {
                union[elem] = b[elem];
            }
        }
        return union;
    }
}
function subsetOf(a, b) {
    for (var k of a.keys()) {
        if (!b.has(k)) {
            return false;
        }
    }
    return true;
}
function identicalSets(a, b, eq) {
    if (a === b) {
        return true;
    }
    else if (a === undefined || b === undefined) {
        return false;
    }
    else {
        for (var k of a.keys()) {
            if (!b.has(k)) {
                return false;
            }
            if (eq !== undefined && !eq(a.get(k), b.get(k))) {
                return false;
            }
        }
        for (var k of b.keys()) {
            if (!a.has(k)) {
                return false;
            }
        }
        return true;
    }
}
function objectEqual(q1, q2) {
    if (q1 === q2)
        return true;
    var t1 = typeof (q1), t2 = typeof (q2);
    if (t1 !== t2)
        return false;
    if (t1 !== "object")
        return false; // q1 and q2 aren't objects and q1 !== q2
    if (q1 instanceof NonAV)
        return q1.isEqual(q2);
    if (q1 instanceof RegExp || q2 instanceof RegExp)
        return q1 instanceof RegExp && q2 instanceof RegExp &&
            q1.toString() === q2.toString();
    if (q1 instanceof Array) {
        if (!(q2 instanceof Array))
            return false;
        if (q1.length !== q2.length)
            return false;
        for (var i = 0; i !== q1.length; i++)
            if (!objectEqual(q1[i], q2[i]))
                return false;
    }
    else if (q2 instanceof NonAV || q2 instanceof Array) {
        return false;
    }
    else {
        if (q1 === null || q2 === null)
            return q1 === q2;
        for (var attr in q1)
            if (!(attr in q2) || !objectEqual(q1[attr], q2[attr]))
                return false;
        for (var attr in q2)
            if (!(attr in q1))
                return false;
    }
    return true;
}
// Like objectEqual, but o(x) == x.
function cdlyEqual(q1, q2) {
    while (q1 instanceof Array && q1.length === 1) {
        q1 = q1[0];
    }
    while (q2 instanceof Array && q2.length === 1) {
        q2 = q2[0];
    }
    if (q1 === q2)
        return true;
    var t1 = typeof (q1), t2 = typeof (q2);
    if (t1 !== t2)
        return false;
    if (t1 !== "object")
        return false; // q1 and q2 aren't objects and q1 !== q2
    if (q1 instanceof NonAV)
        return q1.isEqual(q2);
    if (q1 instanceof RegExp || q2 instanceof RegExp)
        return q1 instanceof RegExp && q2 instanceof RegExp &&
            q1.toString() === q2.toString();
    if (q1 instanceof Array) {
        if (!(q2 instanceof Array)) {
            return false;
        }
        if (q1.length !== q2.length)
            return false;
        for (var i = 0; i !== q1.length; i++)
            if (!cdlyEqual(q1[i], q2[i]))
                return false;
    }
    else if (q2 instanceof NonAV || q2 instanceof Array) {
        return false;
    }
    else {
        if (q1 === null || q2 === null)
            return q1 === q2;
        for (var attr in q1)
            if (!(attr in q2) || !cdlyEqual(q1[attr], q2[attr]))
                return false;
        for (var attr in q2)
            if (!(attr in q1))
                return false;
    }
    return true;
}
/**
 * Checks if two objects have values that conflict in a merge
 *
 * @param {*} q1
 * @param {*} q2
 * @returns {boolean} [merge, q1, q2] === [merge, q2, q1]
 */
function objectCompatible(q1, q2) {
    if (q1 === q2)
        return true;
    var t1 = typeof (q1), t2 = typeof (q2);
    if (t1 !== t2)
        return false;
    if (t1 !== "object")
        return false; // q1 and q2 aren't objects and q1 !== q2
    if (q1 instanceof NonAV)
        return q1.isEqual(q2);
    if (q1 instanceof RegExp || q2 instanceof RegExp)
        return q1 instanceof RegExp && q2 instanceof RegExp &&
            q1.toString() === q2.toString();
    if (q1 instanceof Array) {
        if (!(q2 instanceof Array))
            return false;
        for (var i = 0; i < q1.length && i < q2.length; i++)
            if (!objectCompatible(q1[i], q2[i]))
                return false;
    }
    else if (q2 instanceof NonAV || q2 instanceof Array) {
        return false;
    }
    else {
        if (q1 === null || q2 === null)
            return q1 === q2;
        for (var attr in q1)
            if (attr in q2 && !objectCompatible(q1[attr], q2[attr]))
                return false;
    }
    return true;
}
// Like objectEqual, but slightly optimized for normalized values
function valueEqual(v1, v2) {
    if (v1 === v2)
        return true;
    if (v1 === undefined || v2 === undefined)
        return false;
    if (v1.length !== v2.length)
        return false;
    for (var i = 0; i < v1.length; i++) {
        var a = v1[i];
        var b = v2[i];
        if (a !== b) {
            var ta = typeof (a);
            var tb = typeof (b);
            if (ta !== tb)
                return false;
            if (ta !== "object") {
                return false; // not objects and a !== b
            }
            else if (a instanceof NonAV) {
                if (!a.isEqual(b))
                    return false;
            }
            else if (b instanceof NonAV) {
                return false;
            }
            else {
                for (var attr in a)
                    if (!(attr in b) || !valueEqual(a[attr], b[attr]))
                        return false;
                for (var attr in b)
                    if (!(attr in a))
                        return false;
            }
        }
    }
    return true;
}
// SimpleValueEquals: called with a runtime value and a simple value (which can
// be compared using ===). Used for comparing to simple values in compiled
// queries.
function sveq(cdlValue, simpleValue) {
    if (cdlValue instanceof Array) {
        for (var i = 0; i < cdlValue.length; i++) {
            if (cdlValue[i] === simpleValue ||
                (cdlValue[i] instanceof RangeValue &&
                    cdlValue[i].match(simpleValue))) {
                return true;
            }
        }
        return false;
    }
    else {
        return cdlValue === simpleValue ||
            (cdlValue instanceof RangeValue && cdlValue.match(simpleValue));
    }
}
// Simple Value Not Equals
function svne(cdlValue, simpleValue) {
    if (cdlValue instanceof Array) {
        for (var i = 0; i < cdlValue.length; i++) {
            if (cdlValue[i] !== simpleValue &&
                !(cdlValue[i] instanceof RangeValue &&
                    cdlValue[i].match(simpleValue))) {
                return true;
            }
        }
        return cdlValue.length === 0;
    }
    else {
        return cdlValue !== simpleValue &&
            !(cdlValue instanceof RangeValue && cdlValue.match(simpleValue));
    }
}
// Simple Value In Range, closed, closed
function svircc(r, sv) {
    var rv;
    var v = sv instanceof Array && sv.length === 1 ? sv[0] : sv;
    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        }
        else {
            return false;
        }
    }
    else {
        rv = r;
    }
    return rv.min <= v && v <= rv.max;
}
// Simple Value In Range, closed, open
function svirco(r, sv) {
    var rv;
    var v = sv instanceof Array && sv.length === 1 ? sv[0] : sv;
    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        }
        else {
            return false;
        }
    }
    else {
        rv = r;
    }
    return rv.min <= v && v < rv.max;
}
// Simple Value In Range, open, closed
function sviroc(r, sv) {
    var rv;
    var v = sv instanceof Array && sv.length === 1 ? sv[0] : sv;
    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        }
        else {
            return false;
        }
    }
    else {
        rv = r;
    }
    return rv.min < v && v <= rv.max;
}
// Simple Value In Range, open, open
function sviroo(r, sv) {
    var rv;
    var v = sv instanceof Array && sv.length === 1 ? sv[0] : sv;
    if (r instanceof Array) {
        if (r.length === 1) {
            rv = r[0];
        }
        else {
            return false;
        }
    }
    else {
        rv = r;
    }
    return rv.min < v && v < rv.max;
}
/* Lexicographical comparison of JSON objects q1 and q2. Returns -1 when
   q1 < q2, 0 when q1 == q2, and 1 when q1 > q2.
   Comparing attributes of two objects is expensive, due to the call to
   Object.keys(). If this becomes a performance bottleneck, consider the
   following:
   1. Reserve an attribute, e.g. "_#" in all avs. Do not allow this attribute
      in the cdl.
   2. Cache in that attribute the sorted list of attribute names of the
      object. I.e., if it's not present, do obj["_#"] = Object.keys(obj).sort()
   3. Use that list for comparison
   4. Make sure all functions that modify or create avs respect this, either
      by removing the attribute when it's not present, or by updating it
*/
function objectCompare(q1, q2) {
    var t1 = typeof (q1), t2 = typeof (q2);
    if (t1 !== t2) {
        return t1 < t2 ? -1 : 1;
    }
    if (typeof (q1) !== "object") {
        return q1 === q2 ? 0 : q1 < q2 ? -1 : 1;
    }
    if (q1 instanceof Array || q2 instanceof Array) {
        if (!(q1 instanceof Array && q2 instanceof Array)) {
            return q1 instanceof Array ? 1 : -1;
        }
        if (q1.length !== q2.length) {
            return q1.length < q2.length ? -1 : 1;
        }
        for (var i = 0; i !== q1.length; i++) {
            var cmp = objectCompare(q1[i], q2[i]);
            if (cmp !== 0) {
                return cmp;
            }
        }
    }
    else {
        var a1 = Object.keys(q1);
        var a2 = Object.keys(q2);
        // q1 < q2 if q1 has less attributes than q2
        if (a1.length !== a2.length)
            return a1.length < a2.length ? -1 : 1;
        a1.sort();
        a2.sort();
        // otherwise, compare attributes lexicographically
        for (var i = 0; i !== a1.length; i++) {
            if (a1[i] !== a2[i]) {
                return a1[i] < a2[i] ? -1 : 1;
            }
        }
        // if they are all equal, compare values lexicographically
        for (var i = 0; i !== a1.length; i++) {
            var attr = a1[i];
            var cmp = objectCompare(q1[attr], q2[attr]);
            if (cmp !== 0) {
                return cmp;
            }
        }
    }
    return 0;
}
// Create a shallow copy of the object, leaving out attr
function shallowCopyMinus(obj, excl) {
    var dup = {};
    for (var attr in obj)
        if (attr !== excl)
            dup[attr] = obj[attr];
    return dup;
}
// excl is an object. if an attribute in excl has value true, it's suppressed.
// if an attribute has a deeper object, the attribute is copied minus the
// exclusions mentioned under attr.
function shallowCopyMinusTree(obj, excl) {
    function intDup(obj, excl, dup) {
        for (var attr in obj) {
            if (attr in excl) {
                if (excl[attr] !== true) {
                    var adup = intDup(obj[attr], excl[attr], undefined);
                    if (adup !== undefined) {
                        if (dup === undefined) {
                            dup = {};
                        }
                        dup[attr] = adup;
                    }
                }
            }
            else {
                if (dup === undefined) {
                    dup = {};
                }
                dup[attr] = obj[attr];
            }
        }
        return dup;
    }
    return intDup(obj, excl, {});
}
function safeJSONStringify(val) {
    return val === -Infinity ? "-Infinity" :
        val === Infinity ? "Infinity" :
            typeof (val) === "number" && isNaN(val) ? '"NaN"' :
                JSON.stringify(val);
}
// Returns first element of an os if it contains precisely one element,
// otherwise the whole os.
function singleton(v) {
    return v instanceof Array && v.length === 1 ? v[0] : v;
}
// Returns v as a normalized value, guaranteed to an os.
function ensureOS(v) {
    return v === undefined ? [] : v instanceof Array ? v : [v];
}
// Returns an os interpreted as a single value if possible.
// So o(x) becomes x. Note that o() becomes false.
function getDeOSedValue(v) {
    return v instanceof Array ?
        (v.length === 0 ? false : v.length === 1 ? v[0] : v) : v;
}
function objMap(obj, f) {
    var mappedObj = {};
    for (var attr in obj) {
        mappedObj[attr] = f(obj[attr], attr);
    }
    return mappedObj;
}
function objFilter(obj, f) {
    var filteredObj = {};
    for (var attr in obj) {
        if (f(obj[attr], attr)) {
            filteredObj[attr] = obj[attr];
        }
    }
    return filteredObj;
}
function objValues(obj) {
    var arr = [];
    for (var attr in obj) {
        arr.push(obj[attr]);
    }
    return arr;
}
function levenshtein(str1, str2, maxd) {
    var cost = new Array(), n = str1.length, m = str2.length, i, j;
    function minimum(a, b, c) {
        var min = a < b ? a : b;
        return min < c ? min : c;
    }
    if (str1 == str2)
        return 0;
    if (str1.length == 0)
        return str2.length;
    if (str2.length == 0)
        return str1.length;
    for (i = 0; i <= n; i++) {
        cost[i] = new Array();
    }
    for (i = 0; i <= n; i++) {
        cost[i][0] = i;
    }
    for (j = 0; j <= m; j++) {
        cost[0][j] = j;
    }
    for (i = 1; i <= n; i++) {
        var x = str1.charAt(i - 1);
        var mind = str1.length + str2.length;
        for (j = 1; j <= m; j++) {
            var y = str2.charAt(j - 1);
            if (x === y) {
                cost[i][j] = cost[i - 1][j - 1];
            }
            else if (x.toLowerCase() === y.toLowerCase()) {
                cost[i][j] = minimum(0.1 + cost[i - 1][j - 1], 1 + cost[i][j - 1], 1 + cost[i - 1][j]);
            }
            else if (j > 1 && i > 1 && x === str2.charAt(j - 2) &&
                y === str1.charAt(i - 2)) {
                cost[i][j] = 1 + minimum(cost[i - 2][j - 2], cost[i][j - 1], cost[i - 1][j]);
            }
            else {
                cost[i][j] = 1 + minimum(cost[i - 1][j - 1], cost[i][j - 1], cost[i - 1][j]);
            }
            if (cost[i][j] < mind) {
                mind = cost[i][j];
            }
        }
        if (mind >= maxd) {
            return mind;
        }
    }
    return cost[n][m];
}
function runtimeValueToCdlExpression(v) {
    if (v instanceof Array) {
        return v.length === 1 ? runtimeValueToCdlExpression(v[0]) :
            new MoonOrderedSet(v.map(runtimeValueToCdlExpression));
    }
    if (v === _) {
        return v;
    }
    if (v instanceof NonAV) {
        // Doesn't yield a good cdl expression for ElementReference, but is useful for debugNodeToStr
        return v.toCdl();
    }
    if (v instanceof Object) {
        var o = {};
        for (var attr in v) {
            o[attr] = runtimeValueToCdlExpression(v[attr]);
        }
        return o;
    }
    return v;
}
//
// merge 'a' and 'b' which are assumed to be deO/Sed, aka set-suppressed,
//  aka 'stripArray'ed
//
function deOsedMerge(a, b) {
    a = singleton(a);
    b = singleton(b);
    if (typeof (a) === "undefined") {
        return b;
    }
    if (typeof (a) !== "object" || typeof (b) !== "object" ||
        a instanceof Array || b instanceof Array) {
        return a;
    }
    var res = {};
    for (var attr in a) {
        var repl = attr in b ? deOsedMerge(a[attr], b[attr]) : a[attr];
        if (repl !== undefined &&
            !(repl instanceof Array && repl.length === 0)) {
            res[attr] = repl;
        }
    }
    for (var attr in b) {
        if (!(attr in a)) {
            var repl = b[attr];
            if (repl !== undefined &&
                !(repl instanceof Array && repl.length === 0)) {
                res[attr] = repl;
            }
        }
    }
    return res;
}
// Break up an os into an array of os'es with the same identity. The identity
// of the elements of each os[i] is stored in sids[i] (single id).
function groupResultById(result, values, sids) {
    if (result !== undefined && result.value !== undefined && result.value.length !== 0) {
        var i = 0;
        var v = result.value;
        var ids = result.identifiers;
        while (i < ids.length) {
            var nextId = ids[i];
            if (v[i] === undefined) {
                values.push(undefined);
                i++; // there cannot be multiple undefineds with the same id
                while (i < ids.length && ids[i] === nextId) {
                    i++;
                }
            }
            else {
                var nextVal = [];
                while (i < ids.length && ids[i] === nextId) {
                    nextVal.push(v[i]);
                    i++;
                }
                values.push(nextVal);
            }
            if (sids !== undefined) {
                sids.push(nextId);
            }
        }
    }
}
function repeatId(ids, id, nr) {
    for (var i = 0; i < nr; i++) {
        ids.push(id);
    }
}
// Track the elements in the different arguments to expressions like r(v1, v2,
// ...) by identity.
function mapByIdentity(elements) {
    var values = new Map();
    for (var i = 0; i !== elements.length; i++) {
        var v_i = elements[i].value;
        var id_i = elements[i].identifiers;
        for (var j = 0; j < v_i.length; j++) {
            if (!values.has(id_i[j])) {
                values.set(id_i[j], []);
            }
            values.get(id_i[j]).push(v_i[j]);
        }
    }
    return values;
}
// Mapping from id to the elements in the results with that id
function splitByIdentity(elements) {
    var values = new Map();
    for (var i = 0; i !== elements.length; i++) {
        var v_i = elements[i].value;
        var id_i = elements[i].identifiers;
        for (var j = 0; j < v_i.length; j++) {
            if (!values.has(id_i[j])) {
                values.set(id_i[j], elements.map(function (r) { return []; }));
            }
            values.get(id_i[j])[i].push(v_i[j]);
        }
    }
    return values;
}
function normalizeObject(v) {
    var res;
    if (!(v instanceof Array)) {
        v = [v];
    }
    res = [];
    for (var i = 0; i !== v.length; i++) {
        if (v[i] instanceof MoonRange) {
            res.push(new RangeValue(v[i].os, v[i].closedLower, v[i].closedUpper));
        }
        else if (v[i] instanceof MoonComparisonFunction) {
            res.push(new ComparisonFunctionValue(v[i].elements));
        }
        else if (v[i] instanceof MoonOrderedSet) {
            res = cconcat(res, v[i].os.map(normalizeObject));
        }
        else if (v[i] instanceof Array) {
            res = cconcat(res, v[i].map(normalizeObject));
        }
        else if (v[i] instanceof NonAV) {
            res.push(v[i]);
        }
        else if (v[i] instanceof Object) {
            var normalizedObj = undefined;
            for (var attr in v[i]) {
                var normalizedValue = normalizeObject(v[i][attr]);
                if (normalizedValue.length !== 0) {
                    if (normalizedObj === undefined) {
                        normalizedObj = {};
                    }
                    normalizedObj[attr] = normalizedValue;
                }
            }
            if (normalizedObj !== undefined) {
                res.push(normalizedObj);
            }
        }
        else if (v[i] !== undefined) {
            res.push(v[i]);
        }
    }
    return res;
}
function binarySearchMin(arr, val, comp) {
    var i = binarySearch(arr, val, comp);
    while (i > 0 && comp(arr[i - 1], val) === 0) {
        i--;
    }
    return i;
}
function binarySearchMax(arr, val, comp) {
    var i = binarySearch(arr, val, comp);
    if (i >= 0) {
        while (i < arr.length - 1 && comp(arr[i + 1], val) === 0) {
            i++;
        }
    }
    return i;
}
function countObjSize(v, recursive) {
    if (v === undefined) {
        return 0;
    }
    else if (typeof (v) !== "object" || v instanceof NonAV || v instanceof RegExp) {
        return 1;
    }
    else if (v instanceof Array) {
        if (recursive) {
            var sum = 0;
            for (var i = 0; i !== v.length; i++) {
                sum += countObjSize(v[i], true);
            }
            return sum;
        }
        else {
            return v.length;
        }
    }
    else {
        if (recursive) {
            var prod = 1;
            for (var attr in v) {
                prod *= countObjSize(v[attr], true);
            }
            return prod;
        }
        else {
            return 1;
        }
    }
}
function printObjAsTree(obj, indent = "", maxWidth = 999999) {
    if (obj instanceof Array || obj instanceof NonAV) {
        return obj.toString() + "\n";
    }
    if (!(obj instanceof Object)) {
        return String(obj) + "\n";
    }
    var attributes = Object.keys(obj).sort((a, b) => {
        var an = Number(a);
        var bn = Number(b);
        if (!isNaN(an) && !isNaN(bn)) {
            return an - bn;
        }
        else if (!isNaN(an)) {
            return -1;
        }
        else if (!isNaN(bn)) {
            return 1;
        }
        else {
            return a < b ? -1 : a === b ? 0 : 1;
        }
    });
    var str = "";
    var nIndent;
    for (var i = 0; i < attributes.length; i++) {
        var attr = attributes[i];
        var val = obj[attr];
        var nextTerm = i < attributes.length - 1 ? "├── " : "└── ";
        if (val instanceof Array || val instanceof NonAV) {
            str += indent + nextTerm + attr + ":" + val.toString() + "\n";
        }
        else if (!(val instanceof Object)) {
            str += indent + nextTerm + attr + ":" + String(val) + "\n";
        }
        else {
            if (i === attributes.length - 1) {
                nIndent = indent + "    ";
            }
            else if (nIndent === undefined) {
                nIndent = indent + "|   ";
            }
            var indentWidth = indent.length + 4;
            if (indentWidth + attr.length < maxWidth) {
                str += indent + nextTerm + attr;
            }
            else {
                var attrMaxLen = Math.max(25, maxWidth - indentWidth);
                str += indent + nextTerm + attr.slice(0, attrMaxLen);
            }
            str += "\n" + printObjAsTree(val, nIndent, maxWidth);
        }
    }
    return str;
}
function extractBaseName(n) {
    var slashPos = n.lastIndexOf('/');
    if (slashPos === -1) {
        slashPos = n.lastIndexOf('\\');
    }
    if (slashPos !== -1) {
        n = n.substr(slashPos + 1);
    }
    var match = n.match(/\.[a-z]+$/);
    if (match !== null) {
        n = n.substr(0, n.length - match[0].length);
    }
    return n;
}
function extractExtension(n) {
    var lastDotPos = n.lastIndexOf('.');
    return lastDotPos === -1 ? "" : n.slice(lastDotPos + 1);
}
// Adds a base path and a file name to a file URL (minus the URL encoding).
// Assumes baseDir ends in /.
function combineFilePath(baseDir, fileName) {
    if (fileName.charAt(0) === '/') {
        return "file://" + fileName;
    }
    var fullName = baseDir;
    var restName = fileName;
    while (restName.charAt(0) === '.') {
        if (restName.charAt(1) === '.' && restName.charAt(2) === '/') {
            var lsp = fullName.lastIndexOf('/', fullName.length - 2);
            restName = restName.slice(3);
            fullName = fullName.slice(0, lsp + 1);
        }
        else if (restName.charAt(1) === '/') {
            restName = restName.slice(2);
        }
        else {
            break;
        }
    }
    return fullName + restName;
}
// Removes attributes with o() values
function removeEmptyOSFromAV(v) {
    if (v instanceof Array) {
        return v.map(removeEmptyOSFromAV);
    }
    if (typeof (v) !== "object" || v === null || v instanceof NonAV) {
        return v;
    }
    var repl = {};
    for (var attr in v) {
        var v_attr = v[attr];
        if (v_attr !== undefined && !(v_attr instanceof Array && v_attr.length === 0)) {
            repl[attr] = removeEmptyOSFromAV(v_attr);
        }
    }
    return repl;
}
function allValuesIdentical(values) {
    for (var i = 1; i < values.length; i++) {
        if (values[i] !== values[0]) {
            return false;
        }
    }
    return true;
}
function compareSimpleValues(a, b) {
    var t_a = typeof (a);
    var t_b = typeof (b);
    if (t_a !== t_b) {
        return t_a < t_b ? -1 : t_a === t_b ? 0 : 1;
    }
    else if (t_a === "number") {
        return a - b;
    }
    else {
        return a < b ? -1 : a === b ? 0 : 1;
    }
}
// Returns a sorted list of all unique simple values in data, if it can be
// expected to reduce the size of the transmitted data
function getUniqueValues(data) {
    var uniqueElements = new Map();
    var estCompressedSize = 0;
    var estUncompressedSize = 0;
    // Estimation for uniform distribution of all digits between 0 and nrElts-1
    // based on sum_(n=0)^m n (10^n - 10^(n-1)) = 1/9 (9 10^m m - 10^m + 1)
    function averageNrDigits(nrElts) {
        var log = Math.log10(nrElts);
        var m = Math.floor(log);
        var sumNrDigits = (Math.pow(10, m) * (9 * m - 1) + 1) / 9 + 1;
        return ((nrElts - Math.pow(10, m)) * Math.ceil(log) + sumNrDigits) / nrElts;
    }
    for (var i = 0; i < data.length; i++) {
        var element = data[i];
        var count = uniqueElements.get(element);
        uniqueElements.set(element, count === undefined ? 1 : count + 1);
    }
    if (2 * uniqueElements.size >= data.length) {
        // Note: this includes arrays of length <= 1
        return undefined;
    }
    uniqueElements.forEach((count, key) => {
        var keySize = String(key).length;
        estCompressedSize += keySize + 1;
        estUncompressedSize += keySize * count;
    });
    estCompressedSize += data.length * (averageNrDigits(uniqueElements.size) + 1);
    if (estCompressedSize >= estUncompressedSize) {
        return undefined;
    }
    var keys = [];
    uniqueElements.forEach((count, key) => {
        keys.push(key);
    });
    return keys.sort(compareSimpleValues);
}
function compressRawData(data, indexedValues) {
    var ranges = [];
    var lastDefined = 0;
    var lastOffset = 0;
    var lastRange = undefined;
    for (var i = 0; i < data.length; i++) {
        var data_i = data[i];
        if (data_i !== undefined) {
            if (indexedValues !== undefined) {
                data_i = binarySearch(indexedValues, data_i, compareSimpleValues);
            }
            if (lastRange === undefined || i - 3 > lastDefined) {
                lastRange = [];
                ranges.push({
                    o: i,
                    v: lastRange
                });
                lastOffset = i;
            }
            else if (i - 1 !== lastDefined) {
                while (i - 1 !== lastDefined) {
                    lastRange.push(null);
                    lastDefined++;
                }
            }
            lastRange[i - lastOffset] = data_i;
            lastDefined = i;
        }
    }
    return ranges;
}
function decompressRawData(compressedData, indexedValues) {
    var data = [];
    if (indexedValues === undefined) {
        for (var i = 0; i < compressedData.length; i++) {
            var offset = compressedData[i].o;
            var values = compressedData[i].v;
            for (var j = 0; j < values.length; j++) {
                var v = values[j];
                if (v !== undefined && v !== null) {
                    data[offset + j] = v;
                }
            }
        }
    }
    else {
        for (var i = 0; i < compressedData.length; i++) {
            var offset = compressedData[i].o;
            var values = compressedData[i].v;
            for (var j = 0; j < values.length; j++) {
                var v = values[j];
                if (v !== undefined && v !== null) {
                    data[offset + j] = indexedValues[v];
                }
            }
        }
    }
    return data;
}
//# ../../feg/watcherProducer.js:1
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
/// <reference path="result.ts" />
var nextWatcherId = 1025;
function getNextWatcherId() {
    return nextWatcherId++;
}
//# ../../feg/cdl.js:1
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
// Constant normalized values that are used often.
var constEmptyOS = [];
var constTrueOS = [true];
var constFalseOS = [false];
var constEmptyObject = {};
;
function getPathAssociation(path, tree) {
    var ptr = tree;
    for (var i = 0; i < path.length; i++) {
        if ("next" in ptr && path[i] in ptr.next) {
            ptr = ptr.next[path[i]];
        }
        else {
            return undefined;
        }
    }
    return ptr.value;
}
function addPathAssociation(path, value, tree) {
    var ptr = tree;
    for (var i = 0; i < path.length; i++) {
        if (!("next" in ptr)) {
            ptr.next = {};
        }
        if (!(path[i] in ptr.next)) {
            ptr.next[path[i]] = {};
        }
        ptr = ptr.next[path[i]];
    }
    ptr.value = value;
}
class EFNop {
    static make(local, en) {
        return EFNop.singleton;
    }
    destroy() {
    }
    execute(args) {
        return constEmptyOS;
    }
    executeOS(args, setMode) {
        return constEmptyOS;
    }
    undefinedSignalsNoChange() {
        return false;
    }
}
EFNop.singleton = new EFNop();
// Empty class that should be inherited by all objects that should not be
// split in attribute-values during comparison or querying.
class NonAV {
}
class Projector extends NonAV {
    copy() {
        return this;
    }
    typeName() {
        return "projector";
    }
    toString() {
        return "_";
    }
    stringify() {
        return "_";
    }
    toJSON() {
        return "_";
    }
    toCdl() {
        return _;
    }
    isEqual(v) {
        return v === _;
    }
    match(v) {
        return true;
    }
    // marshalling a projector requires just the type - all projectors are
    //  the same
    marshalValue(xdr) {
        return { type: "projector" };
    }
    static unmarshalValue(obj, xdr) {
        return _;
    }
}
class TerminalSymbol extends NonAV {
    constructor(name) {
        super();
        this.name = name;
    }
    copy() {
        return this;
    }
    typeName() {
        return "terminalSymbol";
    }
    toCdl() {
        return this.name;
    }
    toString() {
        return this.name; // denotation is identical to name
    }
    stringify() {
        return this.name;
    }
    toJSON() {
        return this.name;
    }
    isEqual(v) {
        return this === v; // there is only one of each terminal symbol
    }
    match(v) {
        return this === v;
    }
    marshalValue(xdr) {
        return { type: "terminalSymbol", name: this.name };
    }
    static unmarshalValue(obj, xdr) {
        switch (obj.name) {
            case "unmatched":
                return unmatched;
        }
        return undefined;
    }
}
class BuiltInFunction extends NonAV {
    constructor(name, minNrArguments, maxNrArguments, valueType, isLocalWithoutArguments = false, depOnImplArgs = false, transientResult = false) {
        super();
        this.name = name;
        this.minNrArguments = minNrArguments;
        this.maxNrArguments = maxNrArguments;
        this.factory = EFNop.make;
        this.isLocalWithoutArguments = isLocalWithoutArguments;
        this.dependingOnImplicitArguments = depOnImplArgs;
        this.transientResult = transientResult;
        this.valueType = valueType;
    }
    copy() {
        return this;
    }
    typeName() {
        return "builtInFunction";
    }
    stringify() {
        return this.name;
    }
    toJSON() {
        return this.name;
    }
    toCdl() {
        return this;
    }
    isEqual(v) {
        return v instanceof BuiltInFunction && this.name === v.name;
    }
    match(v) {
        return v instanceof BuiltInFunction && this.name === v.name;
    }
    // create a json object representing this built-in function
    marshalValue(xdr) {
        return {
            type: "builtInFunction",
            name: this.name,
            isLocalWithoutArguments: this.isLocalWithoutArguments,
            dependingOnImplicitArguments: this.dependingOnImplicitArguments,
            transientResult: this.transientResult
        };
    }
    static unmarshalValue(obj, xdr) {
        return new BuiltInFunction(obj.name, obj.isLocalWithoutArguments, obj.depOnImplArgs, obj.transientResult);
    }
}
;
// The following symbols are used as Javascript functions
// in the cdl.
class JavascriptFunction {
    constructor(name, functionArguments) {
        this.name = name;
        this.arguments = functionArguments;
    }
}
;
function atomic(...args) {
    return new JavascriptFunction("atomic", args);
}
function apply(...args) {
    return new JavascriptFunction("apply", args);
}
function push(...args) {
    return new JavascriptFunction("push", args);
}
function erase(...args) {
    return new JavascriptFunction("erase", args);
}
class MoonOrderedSetBase extends NonAV {
    constructor(elts) {
        super();
        this.os = elts;
    }
    copy() {
        assert(false, "implement in derived class");
        return undefined;
    }
    makeNew(elts) {
        assert(false, "implement in derived class");
        return undefined;
    }
    toString() {
        assert(false, "implement in derived class");
        return undefined;
    }
    isEqual(v) {
        assert(false, "implement in derived class");
        return undefined;
    }
    typeName() {
        assert(false, "implement in derived class");
        return undefined;
    }
    // create a json representation of this ordered-set
    marshalValue(xdr) {
        return MoonOrderedSetBase.marshalValue(this.typeName(), this.os, xdr);
    }
    static marshalValue(type, os, xdr) {
        var marshalledOS = [];
        for (var i = 0; i < os.length; i++) {
            marshalledOS[i] = xdr.xdrCdlObj(os[i]);
        }
        return { type: type, os: marshalledOS };
    }
    static unmarshalOS(obj, xdr) {
        var marshalledOS = obj.os;
        if (typeof (marshalledOS) === "undefined") {
            return [];
        }
        var os = [];
        for (var i = 0; i < marshalledOS.length; i++) {
            os[i] = xdr.xdrCdlObj(marshalledOS[i]);
        }
        return os;
    }
    // create an array as the internal representation of an o/s
    static unmarshalValue(obj, xdr) {
        var os = MoonOrderedSetBase.unmarshalOS(obj, xdr);
        return os;
    }
}
class MoonOrderedSet extends MoonOrderedSetBase {
    copy() {
        return new MoonOrderedSet(this.os);
    }
    makeNew(elts) {
        return new MoonOrderedSet(elts);
    }
    toString() {
        return "o(" + this.os.map(flatcdlify).join(",") + ")";
    }
    stringify() {
        return this.toString();
    }
    toJSON() {
        return "o(" + this.os.map(cstringify).join(", ") + ")";
    }
    toCdl() {
        return this;
    }
    // Should only be called for os of simple values
    match(v) {
        if (v instanceof Array) {
            return this.os.some(elt => v.indexOf(elt) >= 0);
        }
        else {
            return this.os.indexOf(v) >= 0;
        }
    }
    isEqual(v) {
        if (v instanceof MoonOrderedSet) {
            if (this.os.length !== v.os.length) {
                return false;
            }
            for (var i = 0; i < this.os.length; i++) {
                if (!objectEqual(this.os[i], v.os[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    typeName() {
        return "orderedSet";
    }
}
// Constructs an os in the cdl
function o(...args) {
    return new MoonOrderedSet(args);
}
class MoonRange extends MoonOrderedSetBase {
    constructor(elts, closedLower, closedUpper) {
        super(elts);
        this.closedLower = closedLower;
        this.closedUpper = closedUpper;
    }
    copy() {
        return new MoonRange(this.os, this.closedLower, this.closedUpper);
    }
    makeNew(elts) {
        return new MoonRange(elts, true, true);
    }
    min() {
        return Math.min.apply(null, this.os);
    }
    max() {
        return Math.max.apply(null, this.os);
    }
    typeName() {
        return "range";
    }
    match(v) {
        throw "not implemented";
    }
    // a range is equal to another range if its open/closed statuses are
    // identical, and all elements can be found in the other in arbitrary order.
    isEqual(v) {
        if (v instanceof MoonRange && this.closedLower === v.closedLower &&
            this.closedUpper === v.closedUpper) {
            if (this.os.every((v) => { return isSimpleType(v); }) &&
                v.os.every((v) => { return isSimpleType(v); })) {
                return this.min() === v.min() && this.max() === v.max();
            }
            for (var i = 0; i < this.os.length; i++) {
                var match_i = false;
                for (var j = 0; !match_i && j < v.os.length; j++) {
                    match_i = objectEqual(this.os[i], v.os[i]);
                }
                if (!match_i) {
                    return false;
                }
            }
            for (var j = 0; j < v.os.length; j++) {
                var match_j = false;
                for (var i = 0; !match_j && i < this.os.length; i++) {
                    match_j = objectEqual(this.os[i], v.os[i]);
                }
                if (!match_j) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    toString() {
        var os = this.os.map(safeJSONStringify).join(",");
        return this.closedLower ?
            (this.closedUpper ? "r(" + os + ")" : "Rco(" + os + ")") :
            (this.closedUpper ? "Roc(" + os + ")" : "Roo(" + os + ")");
    }
    stringify() {
        return this.toString();
    }
    toJSON() {
        return this.toString();
    }
    toCdl() {
        return this;
    }
    // Returns true when this range contains v, false when it doesn't and
    // undefined when the range consists of anything else than simple values.
    containsSimpleValue(v) {
        var hasLower = false;
        var hasUpper = false;
        for (var i = 0; i < this.os.length; i++) {
            var elt_i = this.os[i];
            if (typeof (elt_i) in simpleTypes) {
                if ((elt_i === -Infinity && typeof (v) === "number") ||
                    elt_i < v || (elt_i === v && this.closedLower)) {
                    hasLower = true;
                }
                if ((elt_i === Infinity && typeof (v) === "number") ||
                    elt_i > v || (elt_i === v && this.closedUpper)) {
                    hasUpper = true;
                }
            }
            else {
                return undefined;
            }
        }
        return hasLower && hasUpper;
    }
    // Returns true when this range overlaps v, false when it doesn't and
    // undefined when either range consists of anything else than simple values.
    rangesOverlap(v) {
        for (var i = 0; i < v.os.length; i++) {
            var overlap_i = typeof (v.os[i]) in simpleTypes ?
                this.containsSimpleValue(v.os[i]) : undefined;
            if (overlap_i === undefined) {
                return undefined;
            }
            else if (overlap_i === true) {
                return true;
            }
        }
        return false;
    }
    // marshalling a range is the same as marshalling an o/s (the base-class)
    // unmarshalValue - create the unmarshalled array and construct
    // a range object with it.
    // returns a RangeValue, which is the runtime variant of the MoonRange.
    static unmarshalValue(obj, xdr) {
        return RangeValue.unmarshalRange(obj, xdr);
    }
}
// Constructs a MoonRange in the cdl
function r(...args) {
    return new MoonRange(args, true, true);
}
function Rcc(...args) {
    return new MoonRange(args, true, true);
}
function Rco(...args) {
    return new MoonRange(args, true, false);
}
function Roc(...args) {
    return new MoonRange(args, false, true);
}
function Roo(...args) {
    return new MoonRange(args, false, false);
}
// A range with actual values
class RangeValue extends NonAV {
    // The current code immediately evaluates min and max, so they're computed
    // in the constructor instead of delayed
    constructor(values, closedLower, closedUpper) {
        var min = values[0] instanceof Array ? values[0][0] : values[0];
        var max = min;
        super();
        this.closedLower = closedLower;
        this.closedUpper = closedUpper;
        for (var i = 1; i < values.length; i++) {
            if (values[i] instanceof Array) {
                var vi = values[i];
                for (var j = 0; j < vi.length; j++) {
                    if (min > vi[j]) {
                        min = vi[j];
                    }
                    if (max < vi[j]) {
                        max = vi[j];
                    }
                }
            }
            else {
                if (min > values[i]) {
                    min = values[i];
                }
                if (max < values[i]) {
                    max = values[i];
                }
            }
        }
        this.min = min;
        this.max = max;
    }
    copy() {
        var rv = new RangeValue([], this.closedLower, this.closedUpper);
        rv.min = this.min;
        rv.max = this.max;
        return rv;
    }
    isEqual(v) {
        if (v instanceof RangeValue) {
            return this.min === v.min && this.max === v.max;
        }
        return false;
    }
    match(v) {
        if (v instanceof RangeValue) {
            var min = this.min < v.min ? v.min : this.min;
            var max = this.max < v.max ? this.max : v.max;
            return min < max || (min === max && this.match(min) && v.match(min));
        }
        else {
            return this.closedLower && this.closedUpper ?
                this.min <= v && v <= this.max :
                this.closedLower && !this.closedUpper ?
                    this.min <= v && v < this.max :
                    !this.closedLower && this.closedUpper ?
                        this.min < v && v <= this.max :
                        this.min < v && v < this.max;
        }
    }
    isLessThanOrEqualTo(v) {
        if (v instanceof RangeValue) {
            return (this.closedLower && this.min <= v.min) ||
                (v.min > this.min);
        }
        else {
            return v > this.min;
        }
    }
    isGreaterThanOrEqualTo(v) {
        if (v instanceof RangeValue) {
            return (this.closedUpper && this.max >= v.max) ||
                (v.max < this.max);
        }
        else {
            return v < this.max;
        }
    }
    lower(v) {
        return this.isLessThanOrEqualTo(v) ? this : v;
    }
    upper(v) {
        return this.isGreaterThanOrEqualTo(v) ? this : v;
    }
    intMin() {
        return this.closedLower ? this.min : this.min + 1;
    }
    intMax() {
        return this.closedUpper ? this.max : this.max - 1;
    }
    intConnectsWith(v) {
        var inf1 = this.closedLower ? this.min - 1 : this.min;
        var sup1 = this.closedUpper ? this.max + 1 : this.max;
        if (v instanceof RangeValue) {
            var vinf = v.closedLower ? v.min : v.min + 1;
            var vsup = v.closedUpper ? v.max : v.max - 1;
            return vinf === sup1 || vsup === inf1;
        }
        else {
            return v === inf1 || v === sup1;
        }
    }
    // Extends this to contain v
    merge(v) {
        if (v instanceof RangeValue) {
            return new RangeValue([this.min, this.max, v.min, v.max], this.min < v.min ? this.closedLower :
                v.min < this.min ? v.closedLower :
                    this.closedLower || v.closedLower, this.max > v.max ? this.closedUpper :
                v.max > this.max ? v.closedUpper :
                    this.closedUpper || v.closedUpper);
        }
        else {
            if ((this.closedLower && v < this.min) ||
                (!this.closedLower && v <= this.min)) {
                return new RangeValue([v, this.max], true, this.closedUpper);
            }
            else if ((this.closedUpper && v > this.max) ||
                (!this.closedUpper && v >= this.max)) {
                return new RangeValue([this.min, v], this.closedLower, true);
            }
        }
        return this;
    }
    typeName() {
        return "range";
    }
    stringify() {
        return "r(" + safeJSONStringify(this.min) + "," +
            safeJSONStringify(this.max) + ")";
    }
    toJSON() {
        return "R" + (this.closedLower ? "c" : "o") + (this.closedUpper ? "c" : "o") +
            "(" + safeJSONStringify(this.min) + "," + safeJSONStringify(this.max) + ")";
    }
    toCdl() {
        return new MoonRange([this.min, this.max], this.closedLower, this.closedUpper);
    }
    // create a json representation of this range
    marshalValue(xdr) {
        var marshalledOS = [];
        marshalledOS.push(xdr.xdrCdlObj(this.min));
        marshalledOS.push(xdr.xdrCdlObj(this.max));
        var marshalledClosedLower = xdr.xdrCdlObj(this.closedLower);
        var marshalledClosedUpper = xdr.xdrCdlObj(this.closedUpper);
        return {
            type: this.typeName(),
            os: marshalledOS,
            closedLower: marshalledClosedLower,
            closedUpper: marshalledClosedUpper
        };
    }
    static unmarshalValue(obj, xdr) {
        return RangeValue.unmarshalValue(obj, xdr);
    }
    static unmarshalRange(obj, xdr) {
        var marshalledOS = obj.os;
        var marshalledClosedLower = obj.closedLower;
        var marshalledClosedUpper = obj.closedUpper;
        if (typeof (marshalledOS) === "undefined") {
            return [];
        }
        var os = [];
        for (var i = 0; i < marshalledOS.length; i++) {
            os[i] = xdr.xdrCdlObj(marshalledOS[i]);
        }
        return new RangeValue(os, marshalledClosedLower, marshalledClosedUpper);
    }
}
function _r(low, high) {
    return new RangeValue([low, high], low !== -Infinity, high !== Infinity);
}
class Negation extends NonAV {
    constructor(queries) {
        super();
        this.queries = queries;
    }
    copy() {
        return new Negation(deepCopy(this.queries));
    }
    match(v) {
        throw "not implemented";
    }
    isEqual(v) {
        if (v instanceof Negation) {
            if (this.queries.length !== v.queries.length) {
                return false;
            }
            for (var i = 0; i < this.queries.length; i++) {
                if (!objectEqual(this.queries[i], v.queries[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    toJSON() {
        return "n(" + this.queries.map(cstringify).join(", ") + ")";
    }
    typeName() {
        assert(false, "it doesn't make sense to see negation as a constant");
        return "negation";
    }
    toCdl() {
        return new Negation(this.queries.map(runtimeValueToCdlExpression));
    }
    stringify() {
        return "n(" + this.queries.map(cstringify).join(", ") + ")";
    }
    // create a json representation of this object
    // a negation is defined by its 'queries' array
    marshalValue(xdr) {
        return {
            type: this.typeName(),
            queries: xdr.xdrCdlObj(this.queries)
        };
    }
    // create a new Negation instance based on the json 'obj'
    static unmarshalValue(obj, xdr) {
        var queries = xdr.xdrCdlObj(obj.queries);
        return new Negation(queries);
    }
}
function n(...args) {
    return new Negation(args);
}
// Substring query in cdl
class MoonSubstringQuery extends MoonOrderedSetBase {
    copy() {
        return new MoonSubstringQuery(this.os);
    }
    makeNew(elts) {
        return new MoonSubstringQuery(elts);
    }
    toString() {
        return "s(" + this.os.map(function (e) { return e.toString(); }) + ")";
    }
    stringify() {
        return "s(" + this.os.map(cstringify).join(", ") + ")";
    }
    toJSON() {
        return "s(" + this.os.map(cstringify).join(", ") + ")";
    }
    toCdl() {
        return this;
    }
    typeName() {
        return "substringQuery";
    }
    match(v) {
        throw "not implemented";
    }
}
// Substring query in runtime
class SubStringQuery extends NonAV {
    // The current code immediately evaluates min and max, so they're computed
    // in the constructor instead of delayed
    constructor(strings) {
        super();
        if (strings.some(a => a === "" || (a instanceof Array && a.length === 0))) {
            // One of the arguments matches every string, so turn it into s()
            this.strings = constEmptyOS;
            this.regexps = constEmptyOS;
            return;
        }
        this.strings = strings;
        this.regexps = strings.map(function (s) {
            if (s instanceof RegExp) {
                return s;
            }
            var escapedString = typeof (s) === "string" ?
                s.replace(/[[\]\\()*+?.|^${}]/g, "\\$&") : safeJSONStringify(s);
            if (SubStringQuery.testWordCharStart.test(escapedString)) {
                return new RegExp("\\b" + escapedString, "i");
            }
            else {
                return new RegExp(escapedString, "i");
            }
        });
    }
    copy() {
        return new SubStringQuery(this.strings);
    }
    isEqual(v) {
        if (v instanceof SubStringQuery) {
            var s1 = this.strings;
            var s2 = v.strings;
            return s1.every(e => s2.indexOf(e) !== -1) &&
                s2.every(e => s1.indexOf(e) !== -1);
        }
        return false;
    }
    match(v) {
        if (typeof (v) === "number") {
            v = String(v);
        }
        if (typeof (v) === "string") {
            if (this.regexps.length === 0) {
                return true;
            }
            for (var i = 0; i < this.regexps.length; i++) {
                if (this.regexps[i].test(v)) {
                    return true;
                }
            }
        }
        return false;
    }
    // Assuming this.match(v) is true
    matchValue(v) {
        assert(false, "TODO");
        return false;
    }
    typeName() {
        return "subStringQuery";
    }
    stringify() {
        return "s(" + this.strings.map(safeJSONStringify).join(", ") + ")";
    }
    toJSON() {
        return "s(" + this.strings.map(cstringify).join(", ") + ")";
    }
    toCdl() {
        return new MoonSubstringQuery(this.strings);
    }
    marshalValue(xdr) {
        return {
            type: this.typeName(),
            strings: xdr.xdrCdlObj(this.strings)
        };
    }
    // create a new Negation instance based on the json 'obj'
    static unmarshalValue(obj, xdr) {
        var strings = xdr.xdrCdlObj(obj.strings);
        return new SubStringQuery(strings);
    }
}
SubStringQuery.testWordCharStart = /^\w/;
function s(...args) {
    return new MoonSubstringQuery(args);
}
class MoonComparisonFunction extends MoonOrderedSetBase {
    copy() {
        return new MoonComparisonFunction(this.os);
    }
    makeNew(elts) {
        return new MoonComparisonFunction(elts);
    }
    toString() {
        return "c(" + this.os.map(flatcdlify).join(",") + ")";
    }
    stringify() {
        return "c(" + this.os.map(cstringify).join(", ") + ")";
    }
    toCdl() {
        return this;
    }
    toJSON() {
        return "c(" + this.os.map(cstringify).join(", ") + ")";
    }
    match(v) {
        throw "not implemented";
    }
    isEqual(v) {
        if (v instanceof MoonComparisonFunction) {
            if (this.os.length !== v.os.length) {
                return false;
            }
            for (var i = 0; i < this.os.length; i++) {
                if (!objectEqual(this.os[i], v.os[i])) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }
    typeName() {
        return "comparisonFunction";
    }
}
// Constructs an elements in the cdl
function c(...args) {
    return new MoonComparisonFunction(args);
}
// A comparison function consisting of a sequence of queries, or one query and
// the string "ascending" or "descending".
class ComparisonFunctionValue extends NonAV {
    constructor(elements) {
        super();
        this.elements = elements;
    }
    copy() {
        return new ComparisonFunctionValue(this.elements);
    }
    isEqual(v) {
        if (v instanceof ComparisonFunctionValue) {
            return objectEqual(this.elements, v.elements);
        }
        return false;
    }
    match(v) {
        if (v instanceof ComparisonFunctionValue) {
            if (v.elements.length >= this.elements.length) {
                for (var i = 0; i < this.elements.length; i++) {
                    if (!interpretedBoolMatch(this.elements[i], v.elements[i])) {
                        return false;
                    }
                }
                return true;
            }
        }
        return false;
    }
    typeName() {
        return "comparisonFunction";
    }
    stringify() {
        return "c(" + this.elements.map(safeJSONStringify).join(", ") + ")";
    }
    toCdl() {
        return this;
    }
    toJSON() {
        return "c(" + this.elements.map(safeJSONStringify).join(", ") + ")";
    }
    // The default is ascending.
    // c() and c(ascending/descending) are considered erroneous.
    inAscendingOrder() {
        var n = this.elements.length;
        if (n === 0) {
            Utilities.warn("empty comparison function");
            return true;
        }
        return getDeOSedValue(this.elements[n - 1]) !== descending;
    }
    orderByValue() {
        var n = this.elements.length;
        return n === 1 ||
            (n === 2 && (getDeOSedValue(this.elements[1]) === ascending ||
                getDeOSedValue(this.elements[1]) === descending));
    }
    // create a json representation of this range
    marshalValue(xdr) {
        return {
            type: this.typeName(),
            os: this.elements.map(xdr.xdrCdlObj)
        };
    }
    static unmarshalValue(obj, xdr) {
        var marshalledOS = obj.os;
        return new ComparisonFunctionValue(marshalledOS === undefined ? [] :
            marshalledOS.map(xdr.xdrCdlObj));
    }
}
// Serves as a wrapper around argument index in a query object. E.g. {a: 1, b:
// [{...}, [me]]} is represented as {a: 1, b: new RuntimeArgument(0)} in the
// debugger, in order to avoid that it looks like a selection query or some
// arbitrary object.
class RuntimeArgument extends NonAV {
    constructor(index) {
        super();
        this.index = index;
    }
    copy() {
        return this;
    }
    typeName() {
        throw "do not call"; // see marshalValue
    }
    stringify() {
        return "new RuntimeArgument(" + String(this.index) + ")";
    }
    toCdl() {
        return this;
    }
    toJSON() {
        return "$" + String(this.index);
    }
    match(v) {
        throw "not implemented";
    }
    isEqual(v) {
        return v instanceof RuntimeArgument && v.index === this.index;
    }
    marshalValue(xdr) {
        throw "cannot be called"; // RuntimeArgument cannot be part of app-state
    }
}
class NativeObjectWrapper extends NonAV {
    // Note that the path to the file is unknown, so we stay on the safe side
    // and declare files differently if they are not exactly the same object.
    // This may trigger unnecessary computation, but that's unlikely to happen
    // (it requires dropping the same file twice and a bug in the browser).
    isEqual(v) {
        if (v instanceof NativeObjectWrapper) {
            return this.file === v.file &&
                this.foreignInterfaceConstructor === v.foreignInterfaceConstructor;
        }
        return false;
    }
    match(v) {
        if (v instanceof NativeObjectWrapper) {
            if (v.file !== undefined && this.file !== undefined) {
                return this.file.name === v.file.name &&
                    this.file.size === v.file.size &&
                    this.file.lastModified === v.file.lastModified;
            }
            if (v.foreignInterfaceConstructor !== undefined && this.foreignInterfaceConstructor !== undefined) {
                return this.foreignInterfaceConstructor === v.foreignInterfaceConstructor;
            }
        }
        return false;
    }
    copy() {
        var now = new NativeObjectWrapper();
        if ("file" in this) {
            now.file = this.file;
        }
        if ("foreignInterfaceConstructor" in this) {
            now.foreignInterfaceConstructor = this.foreignInterfaceConstructor;
        }
        return now;
    }
    typeName() {
        return "NativeObjectWrapper";
    }
    stringify() {
        return "file" in this && this.file !== undefined ?
            "File(" + this.file.name + ")" :
            "foreignInterfaceConstructor" in this ?
                "foreignInterfaceConstructor" :
                "unknown";
    }
    toCdl() {
        return this;
    }
    toJSON() {
        return "file" in this && this.file !== undefined ?
            JSON.stringify(this.file.name) :
            "foreignInterfaceConstructor" in this ?
                '"foreignInterfaceConstructor"' :
                '"unknown"';
    }
    toString() {
        return "file" in this && this.file !== undefined ? this.file.name : "";
    }
    marshalValue(xdr) {
        return { type: "undefined" };
    }
    static unmarshalValue(obj, xdr) {
        return undefined;
    }
    createForeignInterface() {
        return "foreignInterfaceConstructor" in this ?
            new this.foreignInterfaceConstructor() : undefined;
    }
}
var jsIdentifierRegExp = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
//
// classDefinitions in indexed first by class-name, then by confLib-name.
// For example, if there are three confLibs: the application (''),
//   'FacetedSearch' and 'Core', and all define class 'Cell', then
// classDefinitions['Cell]'] == {
//     '': <app def of Cell>,
//     'FacetedSearch': <FacetedSearch def of Cell>,
//     'Core': <Core def of Cell>
// }
//
var classDefinitions = {};
var simpleTypes = { "string": true, "number": true, "boolean": true };
function isSimpleType(v) {
    var t = typeof (v);
    return t === "number" || t === "string" || t === "boolean" || t === "undefined";
}
function isSimpleValue(v) {
    return v instanceof Array ?
        v.length === 0 || (v.length === 1 && isSimpleType(v[0])) :
        isSimpleType(v);
}
function isEmptyOS(v) {
    return v === undefined || (v instanceof Array && v.length === 0);
}
// Returns true when a runtime value is false
function isFalse(v) {
    return v === undefined || v === false ||
        (v instanceof Array && isFalseValue(v));
}
// Returns true when a runtime value is true
function isTrue(v) {
    return v !== undefined && v !== false &&
        !(v instanceof Array && isFalseValue(v));
}
// Returns true when a normalized runtime value is false
function isFalseValue(v) {
    if (v !== undefined) {
        for (var i = 0; i < v.length; i++) {
            if (v[i] !== undefined && v[i] !== false) {
                return false;
            }
        }
    }
    return true;
}
// Returns true when a normalized runtime value is true
function isTrueValue(v) {
    if (v !== undefined) {
        for (var i = 0; i < v.length; i++) {
            if (v[i] !== undefined && v[i] !== false) {
                return true;
            }
        }
    }
    return false;
}
// Returns true when a cdl value is guaranteed to evalaute to false, i.e. o(),
// false, or any combination
function isCDLFalse(v) {
    return v === undefined || v === false ||
        (v instanceof MoonOrderedSet &&
            v.os.every(function (e) { return isCDLFalse(e); }));
}
// Returns true when a cdl value is guaranteed to evaluate to true
function isCDLTrue(v) {
    if (isSimpleType(v)) {
        return v !== undefined && v !== false;
    }
    else if (v instanceof Array) {
        return false; // function applications are unknown
    }
    else if (v instanceof MoonOrderedSet) {
        return v.os.some(function (e) { return isCDLTrue(e); });
    }
    else {
        // Projector, ranges, substring queries etc. are all true
        return true;
    }
}
// Turns a bool into a [true]/[] normalized value
function boolValue(b) {
    return b ? constTrueOS : constFalseOS;
}
function toSimpleValue(v) {
    if (v instanceof Array) {
        return v.length === 0 ? false : v.length === 1 ? v[0] : v;
    }
    return v;
}
// Create a shallow copy of the value
function shallowCopy(val) {
    if (val instanceof Array) {
        return val.slice(0);
    }
    else if (val instanceof NonAV) {
        return val.copy();
    }
    else if (typeof (val) === "object") {
        var obj = {};
        for (var attr in val)
            obj[attr] = val[attr];
        return obj;
    }
    return val;
}
var dbglvl = 0;
function deepCopy(obj) {
    if (dbglvl > 15)
        debugger;
    if (obj instanceof NonAV) {
        return obj.copy();
    }
    if (obj instanceof Array) {
        dbglvl++;
        var r = obj.map(deepCopy);
        dbglvl--;
        return r;
    }
    if (obj instanceof Object) {
        dbglvl++;
        var cl = {};
        for (var attr in obj) {
            cl[attr] = deepCopy(obj[attr]);
        }
        dbglvl--;
        return cl;
    }
    return obj;
}
// True when run-time value is a real attribute value, and not a "closed" object
function isAV(v) {
    return v instanceof Object && !(v instanceof NonAV);
}
function stripArray(v, deep = false) {
    var v0 = v instanceof Array && v.length === 1 ? v[0] : v;
    var repl = undefined;
    var subst = false;
    if (v0 instanceof Array) {
        if (deep) {
            for (var i = 0; i < v0.length; i++) {
                var repl_i = stripArray(v0[i], true);
                if (repl_i !== v0[i]) {
                    subst = true;
                    if (repl === undefined) {
                        repl = v0.slice(0, i);
                    }
                }
                if (subst) {
                    repl[i] = repl_i;
                }
            }
            return subst ? repl : v0;
        }
        return v0;
    }
    if (!isAV(v0)) {
        return v0;
    }
    repl = undefined;
    for (var attr in v0) {
        var repl_attr = stripArray(v0[attr], deep);
        if (repl_attr !== v0[attr]) {
            subst = true;
            if (repl === undefined) {
                repl = shallowCopy(v0);
            }
        }
        if (subst) {
            repl[attr] = repl_attr;
        }
    }
    return subst ? repl : v0;
}
// Replaces any os with
function suppressSet(v) {
    var v0 = v instanceof Array ? v[0] : v; // Note: [] => undefined
    if (!isAV(v0)) {
        return v0;
    }
    var repl = undefined;
    for (var attr in v0) {
        var v0_attr = v0[attr];
        var repl_attr = suppressSet(v0_attr);
        if (repl_attr !== v0_attr && repl === undefined) {
            repl = shallowCopy(v0);
        }
        if (repl_attr !== undefined && repl !== undefined) {
            repl[attr] = repl_attr;
        }
    }
    return repl !== undefined ? repl : v0;
}
// Checks if q matches v. Returns true or false.
function interpretedBoolMatch(q, v) {
    var i;
    if (v instanceof Array) {
        if ((!(q instanceof Array) || q.length > 0) && isFalse(q)) {
            return isFalse(v);
        }
        else {
            for (i = 0; i < v.length; i++) {
                if (interpretedBoolMatch(q, v[i])) {
                    return true;
                }
            }
            return false;
        }
    }
    else {
        switch (typeof (q)) {
            case "object":
                if (q instanceof Array) {
                    for (i = 0; i !== q.length; i++) {
                        if (interpretedBoolMatch(q[i], v)) {
                            return true;
                        }
                    }
                    return q.length === 0 && isFalse(v); // o() matches false
                }
                if (q === _) {
                    return !isFalse(v);
                }
                if (q instanceof NonAV) {
                    if (q instanceof Negation) {
                        for (i = 0; i !== q.queries.length; i++) {
                            if (interpretedBoolMatch(q.queries[i], v)) {
                                return false;
                            }
                        }
                        return true;
                    }
                    else {
                        return q.match(v);
                    }
                }
                if (!(v instanceof Object)) {
                    return false;
                }
                for (var attr in q) {
                    if (!(attr in v) || !interpretedBoolMatch(q[attr], v[attr])) {
                        return false;
                    }
                }
                return true;
            case "string":
            case "number":
                return q === v || (v instanceof RangeValue && v.match(q));
            case "boolean":
                return q ? isTrue(v) : isFalse(v);
            default:
                return false;
        }
    }
}
// Can't mix selections and projections in an os.
function interpretedQuery(q, v) {
    // Returns object that describes match
    // - sel: result is selection
    // - res: the resulting values
    // - or undefined when there is no match
    // So lmatch({x: 1}, [{x:1},{x:2},{y:1}]) returns { sel: true,
    // res: [{x:1}]}, and lmatch({x: _}, [{x:1},{x:2},{y:1}]) returns
    // {sel: false, res: [1, 2]}.
    function lmatch(q, v) {
        var arres;
        var isSel;
        var m, m1, i;
        if (q === _) {
            return { sel: false, res: v };
        }
        if (v instanceof Array) {
            arres = [];
            if (v.length === 0) {
                if ((!(q instanceof Array) || q.length > 0) && isFalse(q)) {
                    isSel = true;
                }
            }
            else {
                for (i = 0; i !== v.length; i++) {
                    m1 = lmatch(q, v[i]);
                    if (m1 !== undefined) {
                        arres = arres.concat(m1.res);
                        isSel = m1.sel; // Only last one...
                    }
                }
            }
            return isSel !== undefined ? { sel: isSel, res: arres } : undefined;
        }
        switch (typeof (q)) {
            case "object":
                if (q instanceof Array) {
                    if (q.length === 0) {
                        return isFalse(v) ? { sel: true, res: v } : undefined;
                    }
                    if (q.length === 1 && q[0] === _) {
                        return { sel: false, res: v };
                    }
                    arres = [];
                    for (i = 0; i !== q.length; i++) {
                        m = lmatch(q[i], v);
                        if (m !== undefined) {
                            if (m.sel) {
                                return { sel: true, res: v };
                            }
                            arres = arres.concat(m.res);
                        }
                    }
                    return arres.length !== 0 ? { sel: false, res: arres } : undefined;
                }
                if (q instanceof NonAV) {
                    if (q instanceof Negation) {
                        return interpretedBoolMatch(q, v) ?
                            { sel: true, res: v } : undefined;
                    }
                    return q.match(v) ? { sel: true, res: v } : undefined;
                }
                if (!(v instanceof Object)) {
                    return undefined;
                }
                var res = { sel: true, res: v };
                var nrMatchingAttributes = 0;
                var prevMatchingAttribute;
                for (var attr in q) {
                    if (!(attr in v)) {
                        return undefined;
                    }
                    if (q[attr] !== undefined) {
                        // undefined attribute values should be treated as non-existent
                        m = lmatch(q[attr], v[attr]);
                        if (m === undefined) {
                            return undefined;
                        }
                        if (!m.sel) {
                            nrMatchingAttributes++;
                            if (nrMatchingAttributes === 1) {
                                res.sel = false;
                                res.res = m.res;
                                prevMatchingAttribute = attr;
                            }
                            else if (nrMatchingAttributes === 2) {
                                var obj = {};
                                obj[prevMatchingAttribute] = res.res;
                                obj[attr] = m.res;
                                res.res = obj;
                            }
                            else {
                                res.res[attr] = m;
                            }
                        }
                    }
                }
                return res;
            case "string":
            case "number":
                return q === v || (v instanceof RangeValue && v.match(q)) ? { sel: true, res: v } : undefined;
            case "boolean":
                return (q ? isTrue(v) : isFalse(v)) ? { sel: true, res: v } : undefined;
            default:
                return undefined;
        }
    }
    var m;
    if (v instanceof Array) {
        var res = [];
        for (var i = 0; i !== v.length; i++) {
            m = lmatch(q, v[i]);
            if (m !== undefined) {
                res = res.concat(m.res);
            }
        }
        return res;
    }
    else {
        m = lmatch(q, v);
        return m === undefined ? undefined : m.res;
    }
}
function interpretedQueryWithIdentifiers(q, v, allIds, selectedIds) {
    var res = [];
    if (!(v instanceof Array)) {
        v = [v];
    }
    for (var i = 0; i !== v.length; i++) {
        var m = interpretedQuery(q, v[i]);
        if (m !== undefined) {
            res.push(m);
            selectedIds.push(allIds[i]);
        }
    }
    return res;
}
function nrProjSitesInQuery(query) {
    if (query === _) {
        return 1;
    }
    if (query instanceof Array) {
        if (query.length === 1) {
            return nrProjSitesInQuery(query[0]);
        }
        return 0; // assume that an os in a query is a selection
    }
    if (!(query instanceof Object) || query instanceof NonAV) {
        return 0;
    }
    var nr = 0;
    for (var attr in query) {
        nr += nrProjSitesInQuery(query[attr]);
    }
    return nr;
}
function queryIsSelection(query) {
    if (query === _) {
        return false;
    }
    if (query instanceof Array) {
        if (query.length === 1) {
            return queryIsSelection(query[0]);
        }
        return true; // assume that an os in a query is a selection
    }
    if (!(query instanceof Object) || query instanceof NonAV) {
        return true;
    }
    for (var attr in query) {
        if (queryIsSelection(query[attr])) {
            return true;
        }
    }
    return false;
}
function extractProjectionPaths(query) {
    var paths = [];
    if (query === _) {
        return [[]];
    }
    if (query instanceof Array) {
        if (query.length === 1) {
            return extractProjectionPaths(query[0]);
        }
        return undefined;
    }
    if (!(query instanceof Object) || query instanceof NonAV) {
        return undefined;
    }
    for (var attr in query) {
        var aPaths = extractProjectionPaths(query[attr]);
        if (aPaths !== undefined) {
            paths = paths.concat(aPaths.map(function (p) {
                return [attr].concat(p);
            }));
        }
    }
    return paths;
}
// Returns a string representation of v that is Javascript readable
function vstringify(v) {
    if (v instanceof Projector) {
        return "_";
    }
    else if (v instanceof ChildInfo) {
        return v.toString();
    }
    else if (v instanceof BuiltInFunction) {
        return v.name;
    }
    else if (v instanceof MoonRange) {
        return "r(" + v.os.map(vstringify).join(", ") + ")";
    }
    else if (v instanceof MoonSubstringQuery) {
        return "s(" + v.os.map(vstringify).join(", ") + ")";
    }
    else if (v instanceof MoonOrderedSet) {
        return "[" + v.os.map(vstringify).join(", ") + "]";
    }
    else if (v instanceof Negation) {
        return "n(" + v.queries.map(vstringify).join(", ") + ")";
    }
    else if (v instanceof RegExp) {
        return v.toString();
    }
    else if (v instanceof NonAV) {
        return v.stringify();
    }
    else if (v instanceof Array) {
        return "[" + v.map(vstringify).join(", ") + "]";
    }
    else if (v instanceof Object) {
        var str = "";
        for (var attr in v) {
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class" ?
                attr : JSON.stringify(attr);
            if (str.length !== 0)
                str += ", ";
            str += attrStr + ": " + vstringify(v[attr]);
        }
        return "{" + str + "}";
    }
    else {
        return safeJSONStringify(v);
    }
}
function vstringifyLim(v, maxNrChar) {
    function vstringify2(v) {
        if (v instanceof Array) {
            var str1 = "";
            var str2 = "";
            for (var i = 0; i < v.length / 2 && str1.length + str2.length < maxNrChar; i++) {
                str1 = i === 0 ? String(vstringify(v[i])) : str1 + ", " + vstringify(v[i]);
                if (i !== v.length - i - 1) {
                    str2 = i === 0 ? String(vstringify(v[v.length - i - 1])) :
                        vstringify(v[v.length - i - 1]) + ", " + str2;
                }
            }
            return v.length === 0 ? "[]" :
                v.length === 1 ? "[" + str1 + "]" :
                    "[" + str1 + ", " + str2 + "]";
        }
        else {
            return vstringify(v);
        }
    }
    var str = vstringify2(v);
    return str === undefined ? "undefined" :
        str.length <= maxNrChar ? str :
            str.slice(0, Math.ceil(maxNrChar / 2)) + ".." +
                str.slice(str.length - Math.floor(maxNrChar / 2));
}
class Unquote {
    constructor(str) {
        this.str = str;
    }
    compare(u) {
        return this.str === u.str ? 0 : this.str < u.str ? -1 : 1;
    }
}
// Like vstringify, but can return a value that must be interpreted at runtime
function cstringify(v) {
    if (v instanceof Projector) {
        return "_";
    }
    else if (v instanceof ChildInfo) {
        return v.toString();
    }
    else if (v instanceof BuiltInFunction) {
        return v.name;
    }
    else if (v instanceof MoonOrderedSet) {
        return "[" + v.os.map(cstringify).join(", ") + "]";
    }
    else if (v instanceof RegExp) {
        return v.toString();
    }
    else if (v instanceof NonAV) {
        return v.toJSON();
    }
    else if (v instanceof Array) {
        return "[" + v.map(cstringify).join(", ") + "]";
    }
    else if (v instanceof Object) {
        var str = "";
        for (var attr in v) {
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class" ?
                attr : JSON.stringify(attr);
            if (str.length !== 0)
                str += ", ";
            str += attrStr + ": " + cstringify(v[attr]);
        }
        return "{" + str + "}";
    }
    else {
        return safeJSONStringify(v);
    }
}
function flatcdlify(v) {
    return cdlify(v);
}
// Returns a string representation for v that can be pasted in a cdl file
function cdlify(v, indent = undefined) {
    var type = typeof (v);
    if (type === "number" || type === "string" || type === "boolean") {
        return safeJSONStringify(v);
    }
    else if (v instanceof Projector) {
        return "_";
    }
    else if (v instanceof ChildInfo) {
        return v.toString();
    }
    else if (v instanceof BuiltInFunction) {
        return v.name;
    }
    else if (v instanceof RegExp) {
        return v.toString();
    }
    var nextIndent = indent === undefined ? undefined : indent + "  ";
    function innerCdlify(v) {
        return cdlify(v, nextIndent);
    }
    if (v instanceof MoonRange) {
        return "r(" + v.os.map(innerCdlify).join(", ") + ")";
    }
    else if (v instanceof MoonOrderedSet) {
        return v.os.length === 1 ? cdlify(v.os[0]) :
            "o(" + v.os.map(innerCdlify).join(", ") + ")";
    }
    else if (v instanceof Negation) {
        return "n(" + v.queries.map(innerCdlify).join(", ") + ")";
    }
    else if (v instanceof NonAV) {
        return v.stringify();
    }
    else if (v instanceof Array) {
        return v.length === 1 ? cdlify(v[0], indent) :
            "o(" + v.map(innerCdlify).join(", ") + ")";
    }
    else if (v instanceof Unquote) {
        return v.str;
    }
    else if (v instanceof Object) {
        var str = "";
        for (var attr in v) {
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class" ?
                attr : JSON.stringify(attr);
            if (str.length !== 0) {
                str += nextIndent === undefined ? ", " : ",\n" + nextIndent;
            }
            else if (nextIndent !== undefined) {
                str += "\n" + nextIndent;
            }
            str += attrStr + ": " + cdlify(v[attr], nextIndent);
        }
        return indent === undefined ? "{" + str + "}" : "{" + str + "\n" + indent + "}";
    }
    else {
        return safeJSONStringify(v);
    }
}
function cdlifyLim(v, maxNrChar) {
    if (v instanceof Projector || v instanceof ChildInfo ||
        v instanceof BuiltInFunction || v instanceof Negation ||
        v instanceof NonAV || v instanceof Unquote ||
        !(v instanceof Object)) {
        var str = cdlify(v);
        return str === undefined ? undefined :
            str.length <= maxNrChar ? str :
                str.slice(0, Math.ceil(maxNrChar / 2)) + ".." +
                    str.slice(str.length - Math.floor(maxNrChar / 2));
    }
    else if (v instanceof Array) {
        var str1 = "";
        var str2 = "";
        for (var i = 0; i < v.length / 2 && str1.length + str2.length < maxNrChar; i++) {
            str1 = i === 0 ? cdlifyLim(v[i], maxNrChar / 2) : str1 + ", " + cdlifyLim(v[i], maxNrChar / 2);
            if (i !== v.length - i - 1) {
                str2 = i === 0 ? cdlifyLim(v[v.length - i - 1], maxNrChar / 2) :
                    cdlifyLim(v[v.length - i - 1], maxNrChar / 2) + ", " + str2;
            }
        }
        return v.length === 0 ? "[]" :
            v.length === 1 ? str1 :
                i < v.length / 2 ? "o(" + str1 + ", ..., " + str2 + ")" :
                    "o(" + str1 + ", " + str2 + ")";
    }
    else {
        var str1 = "";
        var str2 = "";
        var keys = Object.keys(v);
        for (var i = 0; i < keys.length / 2 && str1.length + str2.length < maxNrChar; i++) {
            var attr = keys[i];
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class" ?
                attr : JSON.stringify(attr);
            if (i !== 0)
                str1 += ", ";
            str1 += attrStr + ": " + cdlifyLim(v[attr], maxNrChar / 2);
            if (i !== keys.length - i - 1) {
                attr = keys[keys.length - i - 1];
                attrStr = jsIdentifierRegExp.test(attr) && attr !== "class" ?
                    attr : JSON.stringify(attr);
                if (i !== 0)
                    str2 = ", " + str2;
                str2 = attrStr + ": " + cdlifyLim(v[attr], maxNrChar / 2) + str2;
            }
        }
        return keys.length === 0 ? "{}" :
            keys.length === 1 ? "{" + str1 + "}" :
                i < keys.length / 2 ? "{" + str1 + ", ..., " + str2 + "}" :
                    "{" + str1 + ", " + str2 + "}";
    }
}
// Numerical comparison on two runtime expressions
function cdlCompare(a, b) {
    function cdlType(v) {
        if (v instanceof Projector) {
            return 0;
        }
        else if (v instanceof BuiltInFunction) {
            return 1;
        }
        else if (v instanceof Negation) {
            return 2;
        }
        else if (v instanceof RangeValue) {
            return 3;
        }
        else if (v instanceof SubStringQuery) {
            return 4;
        }
        else if (v instanceof ValueReference || v instanceof Unquote) {
            return 5;
        }
        else if (v instanceof Array) {
            return 6;
        }
        else if (v instanceof Object) {
            return 7;
        }
        else {
            return 8;
        }
    }
    function lexicalComparison(a, b) {
        if (a.length !== b.length) {
            return a.length - b.length;
        }
        for (var i = 0; i < a.length; i++) {
            var cmp = cdlCompare(a[i], b[i]);
            if (cmp !== 0) {
                return cmp;
            }
        }
        return 0;
    }
    function sortedLexicalComparison(a, b) {
        if (a.length !== b.length) {
            return a.length - b.length;
        }
        var sortedA = a.slice(0).sort(cdlCompare);
        var sortedB = b.slice(0).sort(cdlCompare);
        return lexicalComparison(sortedA, sortedB);
    }
    a = getDeOSedValue(a);
    b = getDeOSedValue(b);
    var typeA = cdlType(a);
    var typeB = cdlType(b);
    if (typeA !== typeB) {
        return typeA - typeB;
    }
    switch (typeA) {
        case 0:
            return 0;
        case 1:
            return a.name === b.name ? 0 : a.name < b.name ? -1 : 1;
        case 2:
            return sortedLexicalComparison(a.queries, b.queries);
        case 3:
            return lexicalComparison([a.closedLower, a.closedUpper, a.min, a.max], [b.closedLower, b.closedUpper, b.min, b.max]);
        case 4:
            return sortedLexicalComparison(a.strings, b.strings);
        case 5:
            return a.compare(b);
        case 6:
            return lexicalComparison(a, b);
        case 7:
            var aAttrs = Object.keys(a).sort();
            var bAttrs = Object.keys(b).sort();
            var cmp = lexicalComparison(aAttrs, bAttrs);
            if (cmp !== 0) {
                return cmp;
            }
            for (var i = 0; i < aAttrs.length; i++) {
                var attr = aAttrs[i];
                cmp = cdlCompare(a[attr], b[attr]);
                if (cmp !== 0) {
                    return cmp;
                }
            }
            return 0;
        case 8:
            return a === b ? 0 : a < b ? -1 : 1;
    }
    return 0;
}
/// Like cdlify, but normalizes all unordered multiple values, so
/// {a:1,b:1} and {b:1,a:1} or r(1,2) and r(2,1) come out identically.
function cdlifyNormalized(v) {
    if (v instanceof Projector) {
        return "_";
    }
    else if (v instanceof ChildInfo) {
        return v.toString();
    }
    else if (v instanceof BuiltInFunction) {
        return v.name;
    }
    else if (v instanceof MoonRange) {
        var sortedOs = v.os.slice(0).sort(cdlCompare);
        return "r(" + sortedOs.map(flatcdlify).join(", ") + ")";
    }
    else if (v instanceof MoonOrderedSet) {
        return v.os.length === 1 ? cdlify(v.os[0]) :
            "o(" + v.os.map(flatcdlify).join(", ") + ")";
    }
    else if (v instanceof Negation) {
        var sortedQueries = v.queries.slice(0).sort(cdlCompare);
        return "n(" + sortedQueries.map(flatcdlify).join(", ") + ")";
    }
    else if (v instanceof NonAV) {
        return v.stringify();
    }
    else if (v instanceof Array) {
        return v.length === 1 ? cdlify(v[0]) :
            "o(" + v.map(flatcdlify).join(", ") + ")";
    }
    else if (v instanceof Unquote) {
        return v.str;
    }
    else if (v instanceof Object) {
        var sortedKeys = Object.keys(v).sort();
        var str = "";
        for (var i = 0; i < sortedKeys.length; i++) {
            var attr = sortedKeys[i];
            var attrStr = jsIdentifierRegExp.test(attr) && attr !== "class" ?
                attr : JSON.stringify(attr);
            if (str.length !== 0)
                str += ", ";
            str += attrStr + ": " + cdlify(v[attr]);
        }
        return "{" + str + "}";
    }
    else {
        return safeJSONStringify(v);
    }
}
// Unmergeable values are: strings, numbers, booleans, arrays of length != 1,
// references ranges, and arrays of length 1 with an unmergeable value. The ugly
// logic comes from the fact that an array is instanceof Object.
function isUnmergeable(v) {
    return v !== undefined &&
        (!(v instanceof Object) || (!(v instanceof Array) && !isAV(v)) ||
            (v instanceof Array && (v.length !== 1 || isUnmergeable(v[0]))));
}
function mergeConst(a, b) {
    if (a instanceof Array) {
        if (a.length === 0) {
            return a;
        }
        if (a.length !== 1 || b === undefined || (b instanceof Array && b.length !== 1)) {
            return a;
        }
    }
    else if (b instanceof Array && b.length !== 1) {
        return a;
    }
    else if (a === undefined) {
        return b;
    }
    var a0 = a instanceof Array ? a[0] : a;
    var b0 = b instanceof Array ? b[0] : b;
    if (!isAV(a0) || !isAV(b0)) {
        return a;
    }
    var a0Empty = true;
    var o = {};
    for (var attr in a0) {
        a0Empty = false;
        if (attr in b0) {
            var repl = mergeConst(a0[attr], b0[attr]);
            if (repl !== undefined) {
                o[attr] = repl;
            }
        }
        else {
            o[attr] = a0[attr];
        }
    }
    if (a0Empty) {
        return b;
    }
    for (var attr in b0) {
        if (!(attr in a0)) {
            o[attr] = b0[attr];
        }
    }
    return a instanceof Array ? [o] : o;
}
// Returns the merge of a and b, trying to use as much of the original
// objects as possible; if the result differs from a and b, it is a
// new object, otherwise it's the original parameter.
// If push is true, a is appended to b. If push is an object, it describes at
// which paths the data under b should be pushed onto that under a. Note: this
// function is not completely compatible with the classic [merge], as [merge,
// o(), x] = x in classic, but here it is o(). The implementation here is
// compatible with the idea that o() === false.
function mergeCopyValue(a, b, attributes) {
    var a0, b0;
    if (a === undefined) {
        return b;
    }
    if (b === undefined) {
        return a;
    }
    if (attributes !== undefined) {
        if (attributes.push === true) {
            return b instanceof Array ? b.concat(a) : [b].concat(a);
        }
    }
    if (a instanceof Array && b instanceof Array) {
        if (a.length !== 1 || b.length !== 1) {
            // Cannot merge ordered sets with length !== 1
            return a;
        }
        a0 = a[0];
        b0 = b[0];
    }
    else if (b instanceof Array) {
        if (b.length !== 1) {
            return a;
        }
        a0 = a;
        b0 = b[0];
    }
    else if (a instanceof Array) {
        if (a.length !== 1) {
            return a;
        }
        a0 = a[0];
        b0 = b;
    }
    else {
        a0 = a;
        b0 = b;
    }
    if (!isAV(a0) || !isAV(b0)) {
        // This is also the case when b = o()
        return a;
    }
    var o = mergeCopyAV(a0, b0, attributes);
    return o === a0 ? a : [o];
}
function mergeCopyAV(a0, b0, attributes) {
    if (!isAV(a0) || !isAV(b0) ||
        (attributes !== undefined && attributes.atomic === true)) {
        return a0 !== undefined ? a0 : b0;
    }
    var o = {};
    var a0Empty = true; // When true, a0 is an empty AV
    var a0Repl = false; // when true, at least one attribute of a[0] has been replaced
    for (var attr in a0) {
        a0Empty = false;
        if (attr in b0) {
            var mAttr2 = attributes === undefined ? undefined :
                attributes.popPathElement(attr);
            var repl = mergeCopyValue(a0[attr], b0[attr], mAttr2);
            if (repl !== undefined) {
                o[attr] = repl;
                if (repl !== a0[attr]) {
                    a0Repl = true;
                }
            }
            else {
                a0Repl = true;
            }
        }
        else {
            o[attr] = a0[attr];
        }
    }
    if (a0Empty) {
        return b0;
    }
    for (var attr in b0) {
        if (!(attr in a0)) {
            o[attr] = b0[attr];
            a0Repl = true;
        }
    }
    return a0Repl ? o : a0;
}
// Returns the merge of a and b, trying to use as much of the original
// objects as possible; if the result differs from a and b, it is a
// new object, otherwise it's the original parameter.
// If push is true, a is appended to b. If push is an object, it describes at
// which paths the data under b should be pushed onto that under a. Note: this
// function treats o() as transparent.
function mergeThroughEmptyOCopyValue(a, b, attributes) {
    var a0, b0;
    function mergeThroughEmptyOCopyAV(a0, b0, attributes) {
        if (!isAV(a0) || !isAV(b0) ||
            (attributes !== undefined && attributes.atomic === true)) {
            return a0 !== undefined ? a0 : b0;
        }
        var o = {};
        var a0Empty = true; // When true, a0 is an empty AV
        var a0Repl = false; // when true, at least one attribute of a[0] has been replaced
        for (var attr in a0) {
            a0Empty = false;
            if (attr in b0) {
                var mAttr2 = attributes === undefined ? undefined :
                    attributes.popPathElement(attr);
                var repl = mergeThroughEmptyOCopyValue(a0[attr], b0[attr], mAttr2);
                if (repl !== undefined) {
                    o[attr] = repl;
                    if (repl !== a0[attr]) {
                        a0Repl = true;
                    }
                }
                else {
                    a0Repl = true;
                }
            }
            else {
                o[attr] = a0[attr];
            }
        }
        if (a0Empty) {
            return b0;
        }
        for (var attr in b0) {
            if (!(attr in a0)) {
                o[attr] = b0[attr];
                a0Repl = true;
            }
        }
        return a0Repl ? o : a0;
    }
    if (a === undefined || (a instanceof Array && a.length === 0)) {
        return b;
    }
    if (b === undefined || (b instanceof Array && b.length === 0)) {
        return a;
    }
    if (attributes !== undefined) {
        if (attributes.push === true) {
            return b instanceof Array ? b.concat(a) : [b].concat(a);
        }
    }
    if (a instanceof Array && b instanceof Array) {
        if (a.length !== 1 || b.length !== 1) {
            // Cannot merge ordered sets with length > 1
            return a;
        }
        a0 = a[0];
        b0 = b[0];
    }
    else if (b instanceof Array) {
        if (b.length > 1) {
            return a;
        }
        a0 = a;
        b0 = b[0];
    }
    else if (a instanceof Array) {
        if (a.length > 1) {
            return a;
        }
        a0 = a[0];
        b0 = b;
    }
    else {
        a0 = a;
        b0 = b;
    }
    if (!isAV(a0) || !isAV(b0)) {
        // This is also the case when b = o()
        return a;
    }
    var o = mergeThroughEmptyOCopyAV(a0, b0, attributes);
    return o === a0 ? a : [o];
}
// Returns a normalized path for an area query, i.e. it prefixes a query path
// with context if the path does not start with one of the four allowed
// query paths.
function normalizePath(path) {
    return path[0] in { children: 1, context: 1, content: 1, param: 1 } ?
        path : ["context"].concat(path);
}
// Sets the end of path in obj to v
function updateNormalizedValue(obj, path, v) {
    var ptr = obj;
    var attr;
    for (var i = 0; i < path.length; i++) {
        if (ptr.length !== 1) {
            ptr[0] = {};
        }
        if (typeof (ptr[0]) !== "object" || ptr[0] instanceof NonAV) {
            Utilities.error("cannot set " + path.join("."));
            return;
        }
        var aPtr = ptr[0];
        attr = path[i];
        if (aPtr[attr] === undefined) {
            aPtr[attr] = [{}];
        }
        ptr = aPtr[attr];
    }
    ptr.length = 0;
    Array.prototype.push.apply(ptr, v);
}
/// @class ChildInfo
/// Stored as values under the description, where they represent information
/// about existence and class membership.
class ChildInfo {
}
class ValueTypeDescription {
    constructor(type, av, elements) {
        this.type = type;
        this.av = av;
        this.elements = elements;
    }
    matches(v) {
        if (this.type === "any" && v !== undefined) {
            return true;
        }
        var t = typeof (v);
        if (t !== "object") {
            return t === this.type; // number, boolean, string, undefined
        }
        if (v instanceof Array) {
            if (this.type !== "os") {
                return v.length <= 1 && this.matches(v[0]); // matches singletons, but o() also matches undefined
            }
            for (var i = 0; i < v.length; i++) {
                var v_i = v[i];
                for (var j = 0; j < this.elements.length; j++) {
                    if (this.elements[j].matches(v_i)) {
                        break;
                    }
                }
                if (j === this.elements.length) {
                    return false;
                }
            }
            return true;
        }
        if (v instanceof Projector) {
            return this.type === "projector";
        }
        if (v instanceof RegExp) {
            return this.type === "regexp";
        }
        if (v instanceof RangeValue) {
            return this.type === "range";
        }
        if (v instanceof NonAV) {
            return false;
        }
        for (var attr in v) {
            var subTypes = this.av[attr];
            if (subTypes === undefined) {
                subTypes = this.av["_"]; // wild card with default types for all unmentioned attrs
                if (subTypes === undefined) {
                    return false;
                }
            }
            for (var j = 0; j < subTypes.length; j++) {
                if (subTypes[j].matches(v[attr])) {
                    break;
                }
            }
            if (j === subTypes.length) {
                return false;
            }
        }
        // Check undefined attributes
        for (var attr in this.av) {
            if (!(attr in v) && attr !== "_") {
                var subTypes = this.av[attr];
                for (var j = 0; j < subTypes.length; j++) {
                    if (subTypes[j].matches(undefined)) {
                        break;
                    }
                }
                if (j === subTypes.length) {
                    return false;
                }
            }
        }
        return true;
    }
}
// Shorthand for creating a ValueTypeDescription
function vtd(type, arg) {
    if (arg === undefined) {
        return new ValueTypeDescription(type, undefined, undefined);
    }
    if (arg instanceof ValueTypeDescription) {
        return new ValueTypeDescription(type, undefined, [arg]);
    }
    if (arg instanceof Array) {
        return new ValueTypeDescription(type, undefined, arg);
    }
    var objVTD = {};
    for (var attr in arg) {
        objVTD[attr] = arg[attr] instanceof ValueTypeDescription ?
            [arg[attr]] : arg[attr];
    }
    return new ValueTypeDescription(type, objVTD, undefined);
}
class ForeignInterface {
    constructor() {
        this.hasDivSet = false;
    }
    destroy() {
    }
    setArgument(i, arg) {
        if (this.arguments === undefined) {
            this.arguments = [];
        }
        this.arguments[i] = arg;
        return true;
    }
    setDiv(area, div) {
        this.displayOfArea = area;
        this.hasDivSet = true;
        return undefined;
    }
    /**
     * returning true allows children to be embedded as normal divs, but loses
     * events to the foreign div.
     */
    allowsEmbedding() {
        return true;
    }
    releaseDiv() {
        this.displayOfArea = undefined;
        this.hasDivSet = false;
    }
    wrapUpVisuals() {
    }
    displayElementVisible() {
    }
    write(result, mode, attributes, positions) {
        Utilities.warn("dead-ended write: cannot write through foreign function: " + gWriteAction);
    }
    isDisplay() {
        return this.hasDivSet;
    }
    getDisplayArea() {
        return this.displayOfArea;
    }
    addChildArea(areaReference, displayData, areaController) {
    }
    removeChildArea(areaReference, areaController) {
    }
}
// A normalized value containing values of type ForeignInterface at end
// points. All functions must be added before use.
var foreignInterfaceObjects = [];
function addForeignInterface(foreignInterfaceObject) {
    foreignInterfaceObjects = foreignInterfaceObjects.concat(normalizeObject(foreignInterfaceObject));
}
function wrapForeignInterface(fic) {
    var now = new NativeObjectWrapper();
    now.foreignInterfaceConstructor = fic;
    return now;
}
var isFeg = true;
//# ../../feg/xdr.js:1
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
/// <reference path="remotePaidInterface.ts" />
// xdr (external data representation) converts a local data-structure to an
//  alternate format, appropriate to transmitting it over a connection 
//  to a peer.
//
// the conversion can be seen as containing two parts:
//
// 1. data-format conversion
// 2. table-indexing adaptation
//
// data-format conversion:
// ----------------------
// the 'xdr' format is as follows:
//  - strings and booleans - their json representation
//
//  - numbers - their json representation, with a couple of exceptions:
//              if 'num' is one of { Infinity, -Infinity, NaN }, the xdr
//              representation of 'num' is{ type: "number", value: String(num) }
//
//  - null - its json representation
//
//  - undefined - { type: "undefined" }
//
//  - o/s - { type: "orderedSet", os: <array of xdr-formatted elements> }
//
//  - range - { type: "range", os: <array of xdr-formatted elements> }
//
//  - comparisonFunction - { type: "comparisonFunction", elements: <array of xdr-formatted elements> }
//
//  - a/v - { type: "attributeValue", value: <object of xdr-formatted elements>
//
//  - projector - { type: "projector" }
//
//  - predefined function (built-in function) -
//          { type: "builtInFunction", name: , isLocalWithoutArguments,
//            dependingOnImplicitArguments: , transientResult: }
//
//  - negation - { type: "negation",
//                    queries: <array of xdr-formatted elements> }
//
//  - elementReference - { type: "elementReference", templateId: , indexId: }
//
//
// table-indexing adaptation:
// -------------------------
// this currently only pertains to elementReferences; the templateId and
//  indexId attributes of an elementReference have a value which is an index
//  into the local template and index tables, respectively. The associated
//  index at the peer may have a different integer value, or may be completely
//  missing from the peer's tables. Hence, xdr'ing of a templateId/indexId
//  in the 'Marshal' direction is done by making sure the current connection
//  provides a definition of the templateId/indexId by its local definition.
//  this definition should reach the peer prior to the peer stumbling upon an
//  actual use of this templateId/indexId.
//  The definition is done 'recursively'; as a templateId/indexId is defined
//   based on other templateIds/indexIds, the building blocks are defined
//   prior to using them in a definition.
//  The embrionic case are the screen-area template-id and index-id, which are
//   assumed to always be '1'.
//  On the receiving end, at the 'Unmarshal' direction, a templateId read from
//   a connection is used to look-up the local id associated with that
//   remote-id.
//
//
// On a standard agent, the internal format is quite different from the 'xdr'
//  format for many objects, e.g. o/ses, a/vs, element-references. The
//  internal representation of some of these objects supports the conversion
//  to/from xdr format.
//
// On the server, the internal representation is identical to the xdr format,
//  so that the only conversions required are 'table-indexing adaptation'.
//
// The implementation splits xdr'ing to two parts;
//  -- one part is thge part that implements the 'XDR' interface, which includes
//  all the basic data types. The implementation of the XDR interface depends
//  on the internal representation of the data, and is thus quite different
//  between agent (AgentXDR) and server (ServerXDR). The code common to agent
//  and server is implemented in BaseXDR.
//
//  -- the other part describes higher level data-structures as combinations
//  of the basic data types. This part does not depend on the internal
//  representation, as it rather takes an instance of an XDR interface, that
//  makes the correct conversions to/from internal representation.
//  For example, a structure with two members, a 'value:' which is a number and
//   a 'templateId:' which is a templateId could be described as follows:
//
//   interface ValueAndTemplateID { value: number; templateId: number }
//   function xdrValueAndTemplateId(vat: ValueAndTemplateID, xdr: XDR):
//                                                     ValueAndTemplateID {
//        var value: number = xdr.xdrNumber(var.value);
//        var templateId: number = xdr.xdrTemplateId(vat.templateId);
//
//        return { value: value, templateId: templateId };
//   }
//
//  this function, 'xdrValueAndTemplateId', can then be used for both
//   marshalling and unmarshalling the structure (based on the direction with
//   which the XDR implementation was constructed) and on both agent and server
//   (depending on whether the XDR implementation is AgentXDR or ServerXDR)
//   
/// <reference path="utilities.ts" />
/// <reference path="elementReference.ts" />
var XDRDirection;
(function (XDRDirection) {
    XDRDirection[XDRDirection["Marshal"] = 0] = "Marshal";
    XDRDirection[XDRDirection["Unmarshal"] = 1] = "Unmarshal";
})(XDRDirection || (XDRDirection = {}));
;
var xdrDeleteIdent = {
    type: "xdrDelete",
    typeName: function () { return "xdrDelete"; }
};
class BaseXDR {
    constructor(dir, templateInfoChannel) {
        this.dir = dir;
        this.templateInfoChannel = templateInfoChannel;
    }
    xdrString(val) {
        return val;
    }
    xdrBoolean(val) {
        return val;
    }
    xdrNull() {
        return null;
    }
    xdrUndefined() {
        if (this.dir === XDRDirection.Marshal) {
            return {
                type: "undefined"
            };
        }
        else {
            return undefined;
        }
    }
    xdrDelete(obj) {
        if (this.dir === XDRDirection.Marshal) {
            return { type: "xdrDelete" };
        }
        else {
            return xdrDeleteIdent;
        }
    }
    xdrNumber(obj) {
        if (this.dir === XDRDirection.Marshal) {
            if (obj === Infinity || obj === -Infinity || isNaN(obj)) {
                return {
                    type: "number",
                    value: String(obj)
                };
            }
        }
        else {
            if (obj instanceof Object) {
                return Number(obj.value);
            }
        }
        return obj;
    }
    xdrTemplateId(templateId) {
        var xdrTemplateId = templateId;
        if (this.dir === XDRDirection.Marshal) {
            this.templateInfoChannel.defineTemplate(xdrTemplateId);
        }
        xdrTemplateId = this.xdrNumber(xdrTemplateId);
        if (this.dir === XDRDirection.Unmarshal) {
            xdrTemplateId =
                this.templateInfoChannel.translateTemplate(xdrTemplateId);
        }
        if (xdrTemplateId === undefined) {
            RemotingLog.log(1, "internal error: xdrTemplateId is undefined: " + JSON.stringify(templateId) + " " + XDRDirection[this.dir]);
        }
        return xdrTemplateId;
    }
    xdrIndexId(indexId) {
        var xdrIndexId = indexId;
        if (this.dir === XDRDirection.Marshal) {
            this.templateInfoChannel.defineIndex(xdrIndexId);
        }
        var xdrIndexId = this.xdrNumber(xdrIndexId);
        if (this.dir === XDRDirection.Unmarshal) {
            xdrIndexId = this.templateInfoChannel.translateIndex(xdrIndexId);
        }
        if (xdrIndexId === undefined) {
            RemotingLog.log(1, "internal error: xdrIndexId is undefined: " + JSON.stringify(indexId));
        }
        return xdrIndexId;
    }
    xdrCdlObj(obj) {
        var t = typeof (obj);
        switch (t) {
            case "string":
                return this.xdrString(obj);
            case "number":
                return this.xdrNumber(obj);
            case "boolean":
                return this.xdrBoolean(obj);
            case "undefined":
                return this.xdrUndefined();
            case "object":
                if (obj === null) {
                    return this.xdrNull();
                }
                else if (obj instanceof Array) {
                    return this.xdrOS(obj);
                }
                else {
                    var type;
                    if (this.dir === XDRDirection.Unmarshal) {
                        assert(("type" in obj) && (typeof (obj.type) === "string"), "XDR.unmarshal: must have a string 'type'");
                        type = obj.type;
                    }
                    else {
                        type = this.xdrGetMarshalType(obj);
                    }
                    return this.xdrObjByType(obj, type);
                }
            default:
                Utilities.warn("XDR: unexpected type '" + t + "'");
                return undefined;
        }
    }
    xdrObjByType(obj, type) {
        switch (type) {
            case "number":
                return this.xdrNumber(obj);
            case "undefined":
                return this.xdrUndefined();
            case "attributeValue":
                return this.xdrAV(obj);
            case "xdrDelete":
                return this.xdrDelete(obj);
            case "orderedSet":
                return this.xdrOS(obj);
            case "range":
                return this.xdrRange(obj);
            case "comparisonFunction":
                return this.xdrComparisonFunction(obj);
            case "negation":
                return this.xdrNegation(obj);
            case "elementReference":
                return this.xdrElementReference(obj);
            default:
                Utilities.warn("XDR: unexpected type '" + type + "'");
                return undefined;
        }
    }
}
//
// the agent translates 'NonAV's between their xdr representation and its native
//  representation
//
class AgentXDR extends BaseXDR {
    xdrOS(obj) {
        if (this.dir === XDRDirection.Unmarshal) {
            return MoonOrderedSet.unmarshalValue(obj, this);
        }
        else {
            var arr;
            if (obj instanceof Array) {
                arr = obj;
                return MoonOrderedSet.marshalValue("orderedSet", arr, this);
            }
            else {
                assert(typeof (obj.marshalValue) === "function", "XDR: object must have a 'marshalValue' method");
                return obj.marshalValue(this);
            }
        }
    }
    xdrRange(obj) {
        if (this.dir === XDRDirection.Unmarshal) {
            return MoonRange.unmarshalValue(obj, this);
        }
        else {
            var arr;
            if (obj instanceof Array) {
                arr = obj;
                return MoonRange.marshalValue("range", arr, this);
            }
            else {
                assert(typeof (obj.marshalValue) === "function", "XDR: object must have a 'marshalValue' method");
                return obj.marshalValue(this);
            }
        }
    }
    xdrComparisonFunction(obj) {
        if (this.dir === XDRDirection.Marshal) {
            return obj.marshalValue(this);
        }
        else {
            return ComparisonFunctionValue.unmarshalValue(obj, this);
        }
    }
    xdrAV(obj) {
        var iObj;
        var oObj = {};
        if (this.dir === XDRDirection.Marshal) {
            iObj = obj;
        }
        else {
            iObj = obj.value;
        }
        for (var attr in iObj) {
            var attrValue = this.xdrCdlObj(iObj[attr]);
            if (attrValue !== undefined) {
                oObj[attr] = attrValue;
            }
        }
        if (this.dir === XDRDirection.Marshal) {
            return { type: "attributeValue", value: oObj };
        }
        else {
            return oObj;
        }
    }
    xdrNegation(obj) {
        if (this.dir === XDRDirection.Marshal) {
            return obj.marshalValue(this);
        }
        else {
            return Negation.unmarshalValue(obj, this);
        }
    }
    xdrElementReference(obj) {
        if (this.dir === XDRDirection.Marshal) {
            return obj.marshalValue(this);
        }
        else {
            return ElementReference.unmarshalValue(obj, this);
        }
    }
    xdrGetMarshalType(obj) {
        var type;
        if (typeof (obj.typeName) === "function") {
            type = obj.typeName();
        }
        else {
            type = "attributeValue";
        }
        return type;
    }
}
//
// in the server, the 'internal' representation is much the same as the xdr
//  representation;
// objects must still be traversed, mostly for element-reference translation,
//  and also for 'special values', such as xdrDelete, Infinity/NaN
//
class ServerXDR extends BaseXDR {
    xdrOS(obj) {
        return this.xdrOSorRange(obj, "orderedSet");
    }
    xdrRange(obj) {
        return this.xdrOSorRange(obj, "range");
    }
    xdrComparisonFunction(obj) {
        var queries = this.xdrCdlObj(obj.elements);
        return queries !== undefined ?
            { type: "comparisonFunction", queries: queries } :
            undefined;
    }
    xdrOSorRange(obj, type) {
        var valueOS = [];
        for (var i = 0; i < obj.os.length; i++) {
            var elem = this.xdrCdlObj(obj.os[i]);
            if (elem !== undefined) {
                valueOS.push(elem);
            }
        }
        return {
            type: type,
            os: valueOS
        };
    }
    xdrAV(obj) {
        return {
            type: "attributeValue",
            value: this.xdrAllObjAttr(obj.value)
        };
    }
    xdrNegation(obj) {
        return {
            type: "negation",
            queries: this.xdrCdlObj(obj.queries)
        };
    }
    xdrAllObjAttr(obj) {
        var xobj = {};
        for (var attr in obj) {
            var attrValue = this.xdrCdlObj(obj[attr]);
            if (attrValue !== undefined) {
                xobj[attr] = attrValue;
            }
        }
        return xobj;
    }
    xdrElementReference(obj) {
        var templateId = this.xdrTemplateId(obj.templateId);
        var indexId = this.xdrIndexId(obj.indexId);
        return {
            type: "elementReference",
            templateId: templateId,
            indexId: indexId
        };
    }
    xdrGetMarshalType(obj) {
        assert(obj instanceof Object && typeof (obj.type) === "string", "marshalled object must have a string type");
        return obj.type;
    }
}
class AppStateIdentifier {
    constructor(templateId, indexId, path) {
        this.templateId = templateId;
        this.indexId = indexId;
        this.path = path;
    }
    toString() {
        return AppStateIdentifier.getHashStr(this);
    }
    static getHashStr(appSId) {
        return appSId.templateId + ":" + appSId.indexId + ":" + appSId.path;
    }
}
class AppStateElement {
}
// metadata entries are similar to app state entries except for the identifier
// (which is app state refers to the area to which the app state belongs,
// while for the metadata this is a string storing the table ID (metadata
// is identified by the server, not the client).
class MetadataElement {
}
var XDR;
(function (XDR) {
    function xdrAppStateIdentifier(appStateIdent, xdr) {
        var templateId = xdr.xdrTemplateId(appStateIdent.templateId);
        var indexId = xdr.xdrIndexId(appStateIdent.indexId);
        var path = xdr.xdrString(appStateIdent.path);
        return {
            templateId: templateId,
            indexId: indexId,
            path: path
        };
    }
    XDR.xdrAppStateIdentifier = xdrAppStateIdentifier;
    function xdrCdlValue(cdlValue, xdr) {
        return xdr.xdrCdlObj(cdlValue);
    }
    XDR.xdrCdlValue = xdrCdlValue;
    function xdrAppStateElement(appStateElem, xdr) {
        var ident = xdrAppStateIdentifier(appStateElem.ident, xdr);
        var revision = appStateElem.revision;
        var value = xdrCdlValue(appStateElem.value, xdr);
        return (revision === undefined || revision === null) ?
            { ident: ident, value: value } :
            { ident: ident, revision: revision, value: value };
    }
    XDR.xdrAppStateElement = xdrAppStateElement;
    function xdrMetadataElement(metadataElem, xdr) {
        var ident = metadataElem.ident;
        var revision = metadataElem.revision;
        var value = xdrCdlValue(metadataElem.value, xdr);
        return (revision === undefined || revision === null) ?
            { ident: ident, value: value } :
            { ident: ident, revision: revision, value: value };
    }
    XDR.xdrMetadataElement = xdrMetadataElement;
    // Table data is not xdr'ed: it's no cdl, just JSON.
    function xdrTableElement(tableElem, xdr) {
        return tableElem;
    }
    XDR.xdrTableElement = xdrTableElement;
    // Test if an xdr represents an empty os.
    function isEmptyOS(data) {
        return data instanceof Object && data.type === "orderedSet" &&
            (data.os === undefined || data.os.length === 0);
    }
    XDR.isEmptyOS = isEmptyOS;
    // Test if an xdr value represents false: undefined, false or an os that
    // does not contain any true value.
    function isFalse(data) {
        return data === undefined || data === false ||
            (data instanceof Object && data.type === "orderedSet" &&
                (data.os === undefined || data.os.every(isFalse)));
    }
    XDR.isFalse = isFalse;
    function isTrue(data) {
        return !isFalse(data);
    }
    XDR.isTrue = isTrue;
    function mergeXDRValues(a, b, changes) {
        var a0 = a;
        var b0 = b;
        if (a === undefined) {
            if (b !== undefined && changes !== undefined)
                changes.changed = true;
            return b;
        }
        if (b === undefined) {
            return a;
        }
        if (a instanceof Object && a.type === "orderedSet") {
            if (a.os.length !== 1) {
                return a;
            }
            a0 = a.os[0];
        }
        if (b instanceof Object && b.type === "orderedSet") {
            if (b.os.length !== 1) {
                return a;
            }
            b0 = b.os[0];
        }
        // Simple values cannot be merged
        if (!(a0 instanceof Object) || a0.type !== "attributeValue" ||
            !(b0 instanceof Object) || b0.type !== "attributeValue") {
            return a;
        }
        // Left with two attribute value objects
        var merge = { type: "attributeValue", value: {} };
        for (var attr in a0.value) {
            merge.value[attr] = mergeXDRValues(a0.value[attr], b0.value[attr], changes);
        }
        for (var attr in b0.value) {
            if (!(attr in a0.value)) {
                if (changes !== undefined)
                    changes.changed = true;
                merge.value[attr] = b0.value[attr];
            }
        }
        return a.type === "orderedSet" ?
            { type: "orderedSet", os: [merge] } : merge;
    }
    XDR.mergeXDRValues = mergeXDRValues;
})(XDR || (XDR = {}));
//# ../../feg/paidMgr.js:1
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
/// <reference path="paidMgrInterface.ts" />
class PaidMgr {
    constructor() {
        this.templateMap = {};
        this.nextTemplateId = 2;
        this.indexMap = {};
        this.nextIndexId = 2;
        // map a template-id to its local definition
        //  (arguably the reverse map to 'templateMap')
        this.templateById = {
            // initialize with the screen area'a templateId
            1: { parentId: undefined, childType: undefined,
                childName: undefined, referredId: undefined }
        };
        // map an index-id to its local definition
        //  (arguably the reverse map to 'indexMap')
        this.indexById = {
            // initialize with the screen-area's indexId
            1: { prefixId: undefined }
        };
    }
    getGlobalPersistentTemplateId() {
        return 0;
    }
    getScreenAreaTemplateId() {
        return 1;
    }
    // return (allocating, if necessary) a template-id appropriate for
    //  the given parameters; these are the parameters commonly available when
    //  constructing a new area etc
    getTemplateId(parent, childType, childName, referred = undefined) {
        var parentId = parent.getPersistentTemplateId();
        var referredTemplateId;
        if (childType === "intersection") {
            referredTemplateId = referred.getPersistentTemplateId();
        }
        return this.getTemplateByEntry(parentId, childType, childName, referredTemplateId);
    }
    getTemplateByEntry(parentId, childType, childName, referredId) {
        var templateIdent = this.getTemplateIdent(parentId, childType, childName, referredId);
        var templateId = this.templateMap[templateIdent];
        if (templateId === undefined) {
            templateId = this.addTemplateId(templateIdent, parentId, childType, childName, referredId);
        }
        return templateId;
    }
    // create an identifier string unique to these template entry components
    getTemplateIdent(parentId, childType, childName, referredId) {
        var ident = parentId + ":" + childType + ":" + childName;
        if (childType === "intersection") {
            ident += ":" + referredId;
        }
        return ident;
    }
    // create a new template-entry with the given components, and return its
    //  templateId
    addTemplateId(templateIdent, parentId, childType, childName, referredId) {
        var templateId = this.nextTemplateId++;
        this.addTemplateWithId(templateId, templateIdent, parentId, childType, childName, referredId);
        return templateId;
    }
    // create a new template-entry with the given components and the given
    //  template-id
    addTemplateWithId(templateId, templateIdent, parentId, childType, childName, referredId) {
        this.templateMap[templateIdent] = templateId;
        this.templateById[templateId] = {
            parentId: parentId,
            childType: childType,
            childName: childName,
            referredId: referredId
        };
    }
    getTemplatePath(localTemplateId) {
        var templateId = localTemplateId;
        var names = [];
        while (templateId > 1) {
            names.push(this.templateById[templateId].childName);
            templateId = this.templateById[templateId].parentId;
        }
        return names.reverse().join(".");
    }
    getGlobalPersistentIndexId() {
        return 0;
    }
    getScreenAreaIndexId() {
        return 1;
    }
    // return (allocating, if necessary) an indexId whose entry is associated
    //  with the given arguments; these are the arguments that are available
    //  in area construction code etc
    getIndexId(parent, type, paramAttrStr = undefined, referred = undefined) {
        var prefixId = parent.getPersistentIndexId();
        var dataIdent;
        var referredIndexId;
        if (type === "single") {
            return prefixId;
        }
        else if (type === "set") {
            dataIdent = encodeURIComponent(paramAttrStr);
        }
        else {
            assert(type === "intersection", "type '" + type +
                "' is not a known type");
            referredIndexId = referred.getPersistentIndexId();
        }
        return this.getIndexByEntry(prefixId, dataIdent, referredIndexId);
    }
    getIndexByEntry(prefixId, dataIdent, referredId) {
        var indexIdent = this.getIndexIdent(prefixId, dataIdent, referredId);
        var indexId = this.indexMap[indexIdent];
        if (indexId === undefined) {
            indexId = this.addIndexId(indexIdent, prefixId, dataIdent, referredId);
        }
        return indexId;
    }
    // return a string unique to the given index-entry components
    getIndexIdent(prefixId, dataIdent, referredId) {
        var indexIdent;
        if (typeof (dataIdent) !== "undefined") {
            indexIdent = prefixId + ":" + dataIdent;
        }
        else if (typeof (referredId) !== "undefined") {
            indexIdent = prefixId + ";" + referredId;
        }
        else {
            Utilities.error("getIndexIdent: unexpected identifier");
        }
        return indexIdent;
    }
    // create a new index-entry with the given components, and return its id
    addIndexId(indexIdent, prefixId, dataIdent, referredId) {
        var indexId = this.nextIndexId++;
        this.addIndexWithId(indexId, indexIdent, prefixId, dataIdent, referredId);
        return indexId;
    }
    // create a new index-entry with the given components and the given id
    addIndexWithId(indexId, indexIdent, prefixId, dataIdent, referredId) {
        this.indexMap[indexIdent] = indexId;
        var entry = this.indexById[indexId] = {
            prefixId: prefixId
        };
        assert((referredId === undefined) !== (dataIdent === undefined), "exactly one of 'referredId' and 'dataIdent' should be undefined");
        if (dataIdent !== undefined) {
            entry.append = dataIdent;
        }
        else {
            entry.compose = referredId;
        }
    }
    getScreenAreaId() {
        return "1:1";
    }
    // return the area-id for an area with the given template/index ids
    getAreaId(templateId, indexId) {
        var areaId = templateId + ":" + indexId;
        return areaId;
    }
    preload(templateList, indexList) {
        var maxTemplateId = this.nextTemplateId - 1;
        for (var templateId = 2; templateId < templateList.length; templateId++) {
            var tEntry = templateList[templateId];
            if (tEntry === undefined) {
                // only 0 and 1 are expected to be undefined, since 0 doesn't exist
                // and 1 is the screen area, but you never know
                continue;
            }
            var parentId = tEntry.parentId;
            var childType = tEntry.childType;
            var childName = tEntry.childName;
            var referredId = tEntry.referredId;
            var tIdent = this.getTemplateIdent(parentId, childType, childName, referredId);
            assert(!(tIdent in this.templateMap) || templateId === this.templateMap[tIdent], "templateId must not change: ident=" + tIdent + ", " +
                templateId + "(" + typeof (templateId) + ")" + "!=" +
                this.templateMap[tIdent] + "(" +
                typeof (this.templateMap[tIdent]) + ")");
            this.addTemplateWithId(templateId, tIdent, parentId, childType, childName, referredId);
            maxTemplateId = Math.max(maxTemplateId, templateId);
        }
        this.nextTemplateId = maxTemplateId + 1;
        var maxIndexId = this.nextIndexId - 1;
        for (var indexId = 2; indexId < indexList.length; indexId++) {
            var iEntry = indexList[indexId];
            if (iEntry === undefined) {
                // screenArea index
                continue;
            }
            var prefixId = iEntry.prefixId;
            var append = iEntry.append;
            var compose = iEntry.compose;
            var iIdent = this.getIndexIdent(prefixId, append, compose);
            assert(!(iIdent in this.indexMap) || indexId === this.indexMap[iIdent], "indexId must not change");
            this.addIndexWithId(indexId, iIdent, prefixId, append, compose);
            maxIndexId = Math.max(maxIndexId, indexId);
        }
        this.nextIndexId = maxIndexId + 1;
    }
    // return an the template-id/index-id given an area-id (aka a paid)
    // this uses string parsing rather than a map - my uneducated guess is that
    //  this is more efficient, given that the strings are short
    getAreaEntry(paid) {
        var colonIdx = paid.indexOf(":");
        return colonIdx < 0 ? undefined : {
            templateId: Number(paid.slice(0, colonIdx)),
            indexId: Number(paid.slice(colonIdx + 1))
        };
    }
    getTemplateEntry(templateId) {
        return this.templateById[templateId];
    }
    getIndexEntry(indexId) {
        return this.indexById[indexId];
    }
}
var gPaidMgr = new PaidMgr();
// BackingStorePaidMgr is a derived class of PaidMgr instantiated in the server
//
// its uses a PaidMgrBackingStore for the persistent storage if template/index
//  entries. The implementation is expected to call BackingStorePaidMgr's
//  'preload()' method on start-up, passing the template and index tables
//  as they were read from the backing store.
//
// the implementation below is not quite correct, as it does not guarantee that
//  a template/index added to the respective tables was actually written
//  succesfully, which ought to use a call-back mechanism. the acknowledge
//  for a write request that made use of the added template/index should be
//  made dependent on that callback too.
// instead, the optimistic approach is taken, and template/index writes are
//  assumed to always succeed
class BackingStorePaidMgr extends PaidMgr {
    constructor(backingStore) {
        super();
        this.backingStore = backingStore;
    }
    addTemplateId(templateIdent, parentId, childType, childName, referredId) {
        var templateId = super.addTemplateId(templateIdent, parentId, childType, childName, referredId);
        var entry = this.templateById[templateId];
        // XXX TBD - should use a callback to report backing-store write status
        this.backingStore.addTemplate(templateId, entry);
        return templateId;
    }
    addIndexId(indexIdent, prefixId, dataIdent, referredId) {
        var indexId = super.addIndexId(indexIdent, prefixId, dataIdent, referredId);
        var entry = this.indexById[indexId];
        // XXX TBD - should use a callback to report backing-store write status
        this.backingStore.addIndex(indexId, entry);
        return indexId;
    }
}
//# ../../feg/remotePaidInterface.js:1
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
/// <reference path="../remoting/remotingLog.ts" />
/// <reference path="paidMgrInterface.ts" />
function isXDRTemplateDefinition(d) {
    return d instanceof Object && "templateId" in d &&
        (d.templateId === 1 ||
            (typeof (d.templateId) === "number" && d.templateId > 0 &&
                typeof (d.parentId) === "number" && d.parentId > 0 &&
                typeof (d.childType) === "string" &&
                typeof (d.childName) === "string" &&
                (d.referredId === undefined || typeof (d.referredId) === "number")));
}
function isXDRIndexDefinition(d) {
    return d instanceof Object &&
        (d.indexId === 1 ||
            (typeof (d.indexId) === "number" && d.indexId > 0 &&
                typeof (d.prefixId) === "number" && d.prefixId &&
                (d.compose === undefined || typeof (d.compose) === "number")));
}
class RemotePaidInterface {
    constructor(paidMgr) {
        this.paidMgr = paidMgr;
        this.definedTemplates = new Set();
        this.definedIndices = new Set();
        this.remoteToLocalTemplateId = new Map();
        this.remoteToLocalIndexId = new Map();
        this.resetChannel();
    }
    resetChannel() {
        this.definedTemplates.clear();
        this.definedTemplates.add(1);
        this.definedIndices.clear();
        this.definedIndices.add(1);
        this.remoteToLocalTemplateId.clear();
        this.remoteToLocalTemplateId.set(1, 1);
        this.remoteToLocalIndexId.clear();
        this.remoteToLocalIndexId.set(1, 1);
        this.templatesToTransmit = undefined;
        this.indicesToTransmit = undefined;
    }
    defineTemplate(id) {
        if (this.definedTemplates.has(id)) {
            return;
        }
        var templateEntry = this.paidMgr.getTemplateEntry(id);
        if (templateEntry === undefined) {
            RemotingLog.log(1, "defineTemplate: templateId: " + id + " lacks a template entry");
            return;
        }
        this.definedTemplates.add(id);
        this.defineTemplate(templateEntry.parentId);
        if (templateEntry.referredId !== undefined && templateEntry.referredId !== null) {
            this.defineTemplate(templateEntry.referredId);
        }
        if (this.templatesToTransmit === undefined) {
            this.templatesToTransmit = [];
        }
        this.templatesToTransmit.push(id);
    }
    defineIndex(id) {
        if (this.definedIndices.has(id)) {
            return;
        }
        var indexEntry = this.paidMgr.getIndexEntry(id);
        if (indexEntry === undefined) {
            RemotingLog.log(1, "defineIndex: indexId: " + id + " lacks a template entry");
            return;
        }
        this.definedIndices.add(id);
        this.defineIndex(indexEntry.prefixId);
        if (indexEntry.compose !== undefined) {
            this.defineIndex(indexEntry.compose);
        }
        if (this.indicesToTransmit === undefined) {
            this.indicesToTransmit = [];
        }
        this.indicesToTransmit.push(id);
    }
    static getXDRTemplateDefinition(paidMgr, id) {
        var templateEntry = paidMgr.getTemplateEntry(id);
        var def = {
            templateId: id,
            parentId: templateEntry.parentId,
            childType: templateEntry.childType,
            childName: templateEntry.childName
        };
        if (templateEntry.referredId !== undefined &&
            templateEntry.referredId !== null) {
            def.referredId = templateEntry.referredId;
        }
        return def;
    }
    static getXDRIndexDefinition(paidMgr, id) {
        var indexEntry = paidMgr.getIndexEntry(id);
        var def = {
            indexId: id,
            prefixId: indexEntry.prefixId
        };
        if (indexEntry.append !== undefined) {
            def.append = indexEntry.append;
        }
        if (indexEntry.compose !== undefined &&
            indexEntry.compose !== null) {
            def.compose = indexEntry.compose;
        }
        return def;
    }
    getTemplateIndexIdUpdates() {
        if (this.templatesToTransmit === undefined &&
            this.indicesToTransmit === undefined) {
            return undefined;
        }
        var updateList;
        if (this.templatesToTransmit !== undefined) {
            var paidMgr = this.paidMgr;
            updateList = this.templatesToTransmit.map(id => RemotePaidInterface.getXDRTemplateDefinition(paidMgr, id));
            this.templatesToTransmit = undefined;
        }
        else {
            updateList = [];
        }
        if (this.indicesToTransmit !== undefined) {
            var paidMgr = this.paidMgr;
            updateList = updateList.concat(this.indicesToTransmit.map(id => RemotePaidInterface.getXDRIndexDefinition(paidMgr, id)));
            this.indicesToTransmit = undefined;
        }
        return updateList;
    }
    getAllTemplateIndexIds() {
        var paidMgr = this.paidMgr;
        var templateIds = [];
        var indexIds = [];
        this.definedTemplates.forEach(id => templateIds.push(id));
        templateIds.sort((a, b) => a - b);
        this.definedIndices.forEach(id => indexIds.push(id));
        indexIds.sort((a, b) => a - b);
        return templateIds.map(id => RemotePaidInterface.getXDRTemplateDefinition(paidMgr, id)).concat(indexIds.map(id => RemotePaidInterface.getXDRIndexDefinition(paidMgr, id)));
    }
    translateTemplate(id) {
        if (id === undefined) {
            return undefined;
        }
        var translatedId = this.remoteToLocalTemplateId.get(id);
        assert(translatedId !== undefined, "translateTemplate: undefined local template id: " + JSON.stringify(id));
        return translatedId;
    }
    translateIndex(id) {
        if (id === undefined) {
            return undefined;
        }
        var translatedId = this.remoteToLocalIndexId.get(id);
        assert(translatedId !== undefined, "translateTemplate: undefined local template id: " + JSON.stringify(id));
        return translatedId;
    }
    addRemoteTemplateDefinition(templateDef) {
        if (templateDef.templateId !== 1) {
            var localTemplateId = this.paidMgr.getTemplateByEntry(this.translateTemplate(templateDef.parentId), templateDef.childType, templateDef.childName, this.translateTemplate(templateDef.referredId));
            this.remoteToLocalTemplateId.set(templateDef.templateId, localTemplateId);
        }
    }
    addRemoteIndexDefinition(indexDef) {
        if (indexDef.indexId !== 1) {
            var localIndexId = this.paidMgr.getIndexByEntry(this.translateIndex(indexDef.prefixId), indexDef.append, this.translateIndex(indexDef.compose));
            this.remoteToLocalIndexId.set(indexDef.indexId, localIndexId);
        }
    }
}
/* Implements the TemplateIndexInformationChannel as an identity function;
 * useful when translation isn't needed.
 */
var nopTemplateIndexChannel = {
    resetChannel: () => { },
    defineTemplate: (id) => void {},
    defineIndex: (id) => void {},
    getTemplateIndexIdUpdates: function () { return undefined; },
    getAllTemplateIndexIds: function () { return undefined; },
    translateTemplate: function (id) { return id; },
    translateIndex: function (id) { return id; }
};

//# ../serverRuntime.js:1
function scheduleRemotingTask() {
    setImmediate(() => { gRemoteMgr.flush(); });
}

var gErrContext = {
    getErrorContext: function() { return undefined; }
}

var fs = require("fs");
//# ../remotingLog.js:1
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
/// <reference path="../feg/globals.ts" />
var gRemoteDebug = 0;
class RemotingLog {
    static shouldLog(severity) {
        return gRemoteDebug >= severity;
    }
    static log(severity, msg) {
        if (RemotingLog.shouldLog(severity)) {
            var dt = new Date().toString() + ":";
            if (typeof (msg) === "function") {
                console.log(dt, msg());
            }
            else {
                console.log(dt, msg);
            }
        }
    }
}
//# ../networkConnection.js:1
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
/// <reference path="../feg/utilities.ts" />
/// <reference path="../feg/systemEvents.ts" />
/// <reference path="remotingLog.ts" />
//
// a NetworkConnection is the common base-class for both NetworkClient and
//  NetworkServerConnection
// 
// A NetworkConnection allows its owner to define message callbacks for
//   various message types by calling 'addMessageHandler()'
//
// A NetworkConnection also allows its owner to define callbacks to receive
//   notifications of the progress of an inbound message. Since a single
//   message may be split into several buffers, this callback is called
//   with each buffer received to allow tracking the progress of the
//   transfer (even though, until the transfer is completed the message
//   itslef cannot be read).
//   The callback function can be set by calling setInboundProgressHandler().
//   The callback function is called with the following arguments:
//   <resource ID>, <sequenc number>, <length received>, <total length>
//   where <resource ID> is the ID of the resource, <sequence number> is the
//   sequence number assigned by the network layer to this message,
//   <length received> is the total number of bytes received for the message
//   so far and <total length> is the total length of the message.
// For tracking the progress of outbound messages, one should use the handler
//   set by setOutboundProgressHandler(). It is called when acknowledgements
//   are received form the other side for an outbound message. It is
//   called with the same arguments as the inbound progress handler
//   together with any reply object set by the client when sending the message.
//
// A NetworkConnection provides a 'sendMessage(msg)' method.
//
// Outgoing messages may be queued; there's a 'flush()' method to request
//  the message-queue to be flushed; otherwise, the queue is flushed when
//  queueDelay miliseconds have elapsed, or when queueSize message were
//  accumulated.
//
// A NetworkConnection owner may use 'sendReplyMessage()' rather than
//  'sendMessage()', quoting the message-id of the 'request' in the reply's
//  'inReplyTo:' attribute.
// A NetworkConnection owner may request a method to be called when a reply is
//  received for a specified request.
//
// All messages must be JSON objects. If a message starts with a [, + or ], it's
// understood to be a multi-part message, split up because of length reasons.
// '[' starts a multi-part message, '+' continues it, and ']' closes it. They
// need to be sent in order.
// Message Headers
// ---------------
//
// All modules making use of the NetworkConnection class send and receive
// full messages. Only when the full message has been received can the
// JSON object be parsed and passed on to the receiving module. Internally,
// however, the sending of a large JSON object (after being stringified)
// may be split into multiple buffers. To allow tracking the transfer of
// data (both on the receiving and the sending side) headers are added
// to each buffer sent. These headers identify the message and provide
// the total length of the message (as each buffer received may only
// store part of the total message). In addition, an acknowledgement
// mechanism is built into the network connection layer so that the
// sending client can track how much of the data it sent has already been
// received by the other side.
//
// We will refer to any message sent by some other module through the
// NetworkConnection class as a "data message" and to messages generated
// by the NetworkConnection class itself as "service messages". 
//
// Every message, whether a data message or a service message has a header.
// The header consists of several fields. Each field in the header
// is allocated a fixed number of characters. Header fields containing numbers
// are padded with zeros (on the left) to fill the required number of
// characters.
//
// The header fields are as follows (in the given order):
// <header version number>: the version number of the header protocol.
//   Two digits are reserved for this. If the buffer does nto start
//   with two digits, it is assumed to be of an older version (without
//   headers) and the connection is terminated.
// <segmentation indicator>: (1 character) "0", "[", "+" or "]"
//   "-": the whole message is contained in this buffer
//   "[": this is the first buffer in a message spanning multiple buffers.
//   "+": this is neither the first or the last buffer in a message
//        spanning multiple buffers.
//   "]": this is the last buffer in a message spanning multiple buffers.
// <resource ID>: this is the ID of the resource to which the message
//   belongs. This is a number. The number of digits allocated to
//   the resource ID is 'gNumResourceIdChars' (defined below). All buffers
//   sent must have a valid resource ID in this field.
// <sequence number>: every data message sent is assigned a sequence number
//   (sequentially, beginning with 1, for all messages sent by an application).
//   Service messages (acknowledgement messages and possibly other future
//   messages) generated by the NetworkConnection class itself are not assigned
//   a sequence number and are sent with 0 in this field.
//   The number of digits allocated to the sequence number is
//   'gNumSequenceNrChars' (defined below).
// <total message length>: this is the total length of the message (in
//   characters). This does not include the headers. For a message
//   split over multiple buffers, this is the total length of all these
//   buffers together (excluding the headers lengths). This is included with
//   every message (whether split over multiple buffers or not).
//   The number of digits allocated to the sequence number is
//   'gNumMessageLengthChars' (defined below).
//
// Received Length Acknowledgement Messages
// ----------------------------------------
//
// Whenever this module receives a buffer which is part of a data message
// (that is, sent by some higher level module through this class), it
// replies with a service message acknowledging the receipt of that message
// and the total number of characters received so far for this message
// (that is, including characters received in previous buffers for the same
// message).
//
// The acknowledgement message has the standard headers, with the resource ID
// of the message being acknowledged, a zero sequence number and the total
// length of the body of the acknowledgement message. The body of the
// acknowledgement message consists of the following fields (in order):
// <sequence number>: this is the seuqnece number of the message being
//    acknowledged. This has a fixed number of digits (with padding
//    zeros on the left). The number of digits allocated for this field is
//    'gNumSequenceNrChars' (same as in the header).
// <received length>: the total number of characters received so far for
//    this message. This has a fixed number of digits (with padding
//    zeros on the left). The number of digits allocated for this field is
//    'gNumMessageLengthChars'.
// <total length>: this is the total length of the message whose receipt
//    is being acknowledged. This is the length sent in the 'total length'
//    header field of that message.
//
// Header definitions
//
// number of characters reserved for the version of the headers.
var gNumHeaderVersionChars = 2;
// number of characters reserved for the resource ID at the beginning of
// each message buffer sent
var gNumResourceIdChars = 8;
// number of characters reserved for the sequence number at the beginning of
// each message buffer sent
var gNumSequenceNrChars = 10;
// number of characters reserved for the message length at the beginning of
// each message buffer sent
var gNumMessageLengthChars = 12;
// at least as many zeros as the largest number of digits assigned to a field
var gNetworkPaddingZeros = "00000000000000000";
var gNetworkHeaderLength = 1 + gNumResourceIdChars + gNumSequenceNrChars +
    gNumMessageLengthChars;
var gHeaderVersion = 1; // current version
var networkConnectionId = 1;
var gMaxMessageSize = 16000 - gNetworkHeaderLength;
// Settings for delaying messages
var baseDelay = 0;
var sizeDependentDelay = 0;
;
;
;
class NetworkConnection {
    constructor(options) {
        this.options = options;
        this.sequenceNr = 1;
        this.id = networkConnectionId++;
        // queue of outgoing messages, waiting to be flushed
        this.messageQueue = [];
        // Guard for flush()
        this.flushing = false;
        // this table is indexed by sequence-ids, holding the handlers that
        //  are awaiting reply, and an optional extra argument to pass:
        //    this.onReply[<seqId>] = { handler: <function>, arg: <any> }
        this.onReply = {};
        // if a reply timeout is set in the connection options:
        //this holds the time in which the first reply-timeout might occur
        this.replyTimeoutTime = undefined;
        // this holds the seq-nr of the message which would be the first to
        //  time-out waiting for a reply
        this.replyTimeoutSequenceNr = undefined;
        // this holds the timeout-id for the reply-timeout
        this.replyTimeoutId = undefined;
        // this holds the queue timeout-id, the timeout that would flush the
        //  message-queue once a message has been sitting there longer than
        //  this.poolDelay miliseconds
        this.queueTimeoutId = undefined;
        // this stores event handlers for events such as 'error', 'open' and 'close'
        this.eventHandlerObj = {};
        // this stores message handlers by message types
        //  (to be set by a derived class)
        this.messageHandlerObj = {};
        // this stores an optional handler (to be set by a derived class) which
        //   handles notifications of the progress of inbound messages
        //   (see the documentation of setInboundProgressHandler() above for
        //   more details).
        this.inboundProgressHandler = undefined;
        // this stores an optional handler (to be set by a derived class) which
        //   handles notifications of the progress of outbound messages
        //   (based on network level acknowledgement messages received
        //   from the other side).
        //   The handler should be a function which receives the following
        //   arguments:
        //   ackMessageHandler(<resourceId>:number,
        //                     <sequence no. of acknowledged message>:number,
        //                     <number of bytes received so far>:number,
        //                     <total number of bytes in the message>:number)
        this.outboundProgressHandler = undefined;
        this.messageBuffer = undefined;
        this.delayedMessageQueue = [];
        this.delayedSendTaskId = undefined;
        // errorStatus is true when there is a connection error; used to send the
        // correct global system event
        this.errorStatus = undefined;
        this.options = options;
        this.poolSize = (typeof (this.options.poolSize) === "number") ?
            options.poolSize : NetworkConnection.defaultPoolSize;
        this.poolDelay = (typeof (options.poolDelay) === "number") ?
            options.poolDelay : NetworkConnection.defaultPoolDelay;
    }
    // --------------------------------------------------------------------------
    // sendMessage
    //
    // send 'message' over the wire. 'message' should be a json object.
    //
    // if 'replyHandler' is defined, it should be a function that would be called
    //  when a reply to this message is accepted; if replyArg is also defined,
    //  replyHandler would get it as an extra argument
    //
    sendMessage(message, replyHandler, replyArg) {
        if (typeof (this.messageQueue) === "undefined") {
            // connection is currently shut-down
            this.dlog(1, "sendMessage: queue undefined");
            return;
        }
        message.sequenceNr = this.sequenceNr++;
        if (replyHandler !== undefined) {
            this.dlog(5, "sendMessage: waitForReply");
            this.waitForReply(replyHandler, replyArg, message.sequenceNr);
        }
        this.messageQueue.push(message);
        this.flushIfNeeded();
    }
    // --------------------------------------------------------------------------
    // sendReplyMessage
    //
    // send 'replyMessage' as a reply to the received message 'requestMessage'
    //
    sendReplyMessage(replyMessage, requestMessage) {
        replyMessage.inReplyTo = requestMessage.sequenceNr;
        this.sendMessage(replyMessage);
    }
    // --------------------------------------------------------------------------
    // flushIfNeeded
    //
    // this private method tests if the connection should be flushed and/or if
    // the queue-timeout needs to be set
    //
    flushIfNeeded() {
        if (typeof (this.connection) === "undefined") {
            this.dlog(1, "flushIfNeeded: connection undefined");
            return;
        }
        if (this.getConnectionState() !== "open") {
            this.dlog(1, "flushIfNeeded: connection not open");
            return;
        }
        if (this.messageQueue.length > this.poolSize) {
            this.flush();
        }
        if (this.messageQueue.length > 0 && this.queueTimeoutId === undefined) {
            this.setQueueTimeout();
        }
    }
    // --------------------------------------------------------------------------
    // setQueueTimeout
    //
    setQueueTimeout() {
        var self = this;
        function callQueueTimeoutHandler() {
            self.queueTimeoutHandler();
        }
        if (typeof (this.queueTimeoutId) === "undefined") {
            this.queueTimeoutId =
                setTimeout(callQueueTimeoutHandler, this.poolDelay);
        }
    }
    // --------------------------------------------------------------------------
    // queueTimeoutHandler
    //
    // called when queue-timeout was triggered, flushes messageQueue
    //
    queueTimeoutHandler() {
        this.queueTimeoutId = undefined;
        this.flush();
    }
    delayedSendTask() {
        this.delayedSendTaskId = undefined;
        while (this.delayedMessageQueue.length > 0 &&
            Date.now() >= this.delayedMessageQueue[0].transmissionTime) {
            this.connection.send(this.delayedMessageQueue.shift().message);
        }
        this.scheduleDelayedSendTask();
    }
    scheduleDelayedSendTask() {
        if (this.delayedSendTaskId === undefined && this.delayedMessageQueue.length > 0) {
            var delay = this.delayedMessageQueue[0].transmissionTime - Date.now();
            if (delay > 0) {
                var self = this;
                this.delayedSendTaskId = setTimeout(function () {
                    self.delayedSendTask();
                }, delay);
            }
            else {
                this.delayedSendTask();
            }
        }
    }
    queueSendBuffer(lastBufferTime, buf) {
        var transmissionTime = lastBufferTime === undefined ?
            Date.now() : lastBufferTime;
        transmissionTime += baseDelay + sizeDependentDelay * buf.length / 1000000;
        this.delayedMessageQueue.push({
            transmissionTime: transmissionTime,
            message: buf
        });
        this.scheduleDelayedSendTask();
        return transmissionTime;
    }
    // --------------------------------------------------------------------------
    // flush
    //
    // send the queued messages to the connection
    //
    flush() {
        if (this.flushing) {
            return;
        }
        this.flushing = true;
        if (typeof (this.queueTimeoutId) !== "undefined") {
            clearTimeout(this.queueTimeoutId);
            this.queueTimeoutId = undefined;
        }
        if (this.connection === undefined || this.getConnectionState() !== "open") {
            return;
        }
        var debugLastBufferTime = undefined;
        try {
            for (var i = 0; i < this.messageQueue.length; i++) {
                var msg = this.messageQueue[i];
                var msgStr = JSON.stringify(msg);
                this.dlog(6, function () { return "sending '" + msgStr + "'"; });
                if (msgStr.length <= gMaxMessageSize) {
                    // fits in single buffer
                    msgStr = this.addHeader("-", msg.resourceId, msg.sequenceNr, msgStr.length, msgStr);
                    if (baseDelay === 0 && sizeDependentDelay === 0) {
                        this.connection.send(msgStr);
                    }
                    else {
                        debugLastBufferTime =
                            this.queueSendBuffer(debugLastBufferTime, msgStr);
                    }
                }
                else {
                    for (var j = 0; j < msgStr.length; j += gMaxMessageSize) {
                        // character to indicate which part of the message this is
                        var segmentIndicator = j === 0 ? '[' :
                            j + gMaxMessageSize >= msgStr.length ? ']' : '+';
                        var subMsg = this.addHeader(segmentIndicator, msg.resourceId, msg.sequenceNr, msgStr.length, msgStr.slice(j, j + gMaxMessageSize));
                        if (baseDelay === 0 && sizeDependentDelay === 0) {
                            this.connection.send(subMsg);
                            if (j > 0 && j % (100 * gMaxMessageSize) === 0) {
                                this.dlog(4, function () {
                                    return "sent " + j + " bytes";
                                });
                            }
                        }
                        else {
                            debugLastBufferTime =
                                this.queueSendBuffer(debugLastBufferTime, subMsg);
                        }
                    }
                }
            }
        }
        catch (ex) {
            this.dlog(0, "ERROR: flush " + ex.toString());
        }
        this.messageQueue = [];
        this.flushing = false;
    }
    // --------------------------------------------------------------------------
    // waitForReply
    //
    // call handler, adding 'arg' as an extra argument, when a reply to message
    //  with seq-nr 'sequenceNr' is received (or when reply-timeout has elapsed)
    //
    waitForReply(handler, arg, sequenceNr) {
        var onReplyObj = { handler: handler, arg: arg };
        this.onReply[sequenceNr] = onReplyObj;
        if (this.options.replyTimeout > 0) {
            onReplyObj.timeoutTime = Date.now() + this.options.replyTimeout;
            this.setReplyTimeout();
        }
    }
    // --------------------------------------------------------------------------
    // setReplyTimeout
    //
    // set reply-timeout according to the first message awaiting reply;
    // this is linear in the number of such messages, as the assumption is that
    // waiting for a reply would be rare
    //
    setReplyTimeout() {
        var self = this;
        function callTimeoutHandler() {
            self.replyTimeoutHandler();
        }
        var minSequenceNr = undefined;
        var minTime = undefined;
        for (var sequenceNr in this.onReply) {
            var onReplyObj = this.onReply[sequenceNr];
            var curTT = onReplyObj.timeoutTime;
            if (typeof (curTT) === "undefined") {
                continue;
            }
            if (minTime === undefined || minTime > curTT) {
                minTime = curTT;
                minSequenceNr = sequenceNr;
            }
        }
        if (minTime < Date.now()) {
            // XXX TBD: should call reply handler of those waiting too long, rather
            // XXX  than shutdown..
            this.shutdown("setReplyTimeout: min time has passed", true);
            return;
        }
        if (minTime === undefined || minTime < this.replyTimeoutTime) {
            this.clearReplyTimeout();
        }
        if (typeof (minTime) === "number" && this.replyTimeoutTime === undefined) {
            this.replyTimeoutTime = minTime;
            this.replyTimeoutSequenceNr = minSequenceNr;
            var tmo = Math.max(1, minTime - Date.now());
            this.replyTimeoutId = setTimeout(callTimeoutHandler, tmo);
        }
    }
    // --------------------------------------------------------------------------
    // clearReplyTimeout
    //
    clearReplyTimeout() {
        if (this.replyTimeoutId !== undefined) {
            clearTimeout(this.replyTimeoutId);
            this.replyTimeoutId = undefined;
            this.replyTimeoutTime = undefined;
            this.replyTimeoutSequenceNr = undefined;
        }
    }
    // --------------------------------------------------------------------------
    // replyTimeoutHandler
    //
    // called when the reply timeout was triggered
    // it is enough to call 'setReplyTimeout' as this method both sets the
    //  timeout for the next reply-message, and calls reply-handlers for those
    //  waiters whose wait-time has elapsed
    //
    replyTimeoutHandler() {
        this.setReplyTimeout();
    }
    // --------------------------------------------------------------------------
    // errorHandler
    //
    errorHandler(error) {
        if (this.eventHandlerObj["error"] !== undefined) {
            this.eventHandlerObj["error"].call(this, error);
        }
        if (!this.errorStatus) {
            globalSystemEvents.notifyHandlers(["error", "connection error"]);
            this.errorStatus = true;
        }
        this.shutdown("errorHandler: error=" + error, true);
    }
    // --------------------------------------------------------------------------
    // closeHandler
    //
    closeHandler(error) {
        if (this.eventHandlerObj["close"] !== undefined) {
            this.eventHandlerObj["close"].call(this, error);
        }
        if (this.errorStatus === undefined) {
            globalSystemEvents.notifyHandlers(["connection closed"]);
        }
        this.shutdown("closeHandler", true);
    }
    // --------------------------------------------------------------------------
    // openHandler
    //
    openHandler() {
        this.messageBuffer = undefined;
        if (this.eventHandlerObj["open"] !== undefined) {
            this.eventHandlerObj["open"].call(this);
        }
        if (this.errorStatus === undefined) {
            globalSystemEvents.notifyHandlers(["connection opened"]);
        }
        this.flushIfNeeded();
    }
    // --------------------------------------------------------------------------
    // messageHandler
    //
    messageHandler(messageString) {
        var headersAndBody = this.readHeader(messageString);
        if (headersAndBody === undefined) {
            // indication of message with different header version, this was
            // already handled when the headers were read and there is nothing
            // more to do.
            return;
        }
        this.dlog(6, "received " + headersAndBody.buffer.length +
            " characters of " + headersAndBody.msgLength +
            " for resource " + headersAndBody.resourceId +
            " sequence nr. " + headersAndBody.sequenceNr);
        if (headersAndBody.sequenceNr === 0) {
            // this is an acknowledgement message
            this.handleAcknowledgement(headersAndBody);
            return;
        }
        // First check if it's a split message
        switch (headersAndBody.segmentIndicator) {
            case '[':
                if (this.messageBuffer !== undefined) {
                    this.dlog(0, "message out of order");
                }
                this.messageBuffer = headersAndBody.buffer;
                break;
            case '+':
                if (this.messageBuffer === undefined) {
                    this.dlog(0, "message out of order");
                    return;
                }
                this.messageBuffer += headersAndBody.buffer;
                break;
            case ']':
                if (this.messageBuffer === undefined) {
                    this.dlog(0, "message out of order");
                    return;
                }
                else {
                    messageString = this.messageBuffer + headersAndBody.buffer;
                    this.messageBuffer = undefined;
                }
                break;
            default:
                if (this.messageBuffer !== undefined) {
                    this.dlog(0, "message out of order");
                    this.messageBuffer = undefined;
                }
                messageString = headersAndBody.buffer;
                break;
        }
        // notify of message progress
        if (this.inboundProgressHandler !== undefined) {
            var legnthReceived = this.messageBuffer !== undefined ?
                this.messageBuffer.length : messageString.length;
            this.inboundProgressHandler(headersAndBody.resourceId, headersAndBody.sequenceNr, legnthReceived, headersAndBody.msgLength);
        }
        if (this.messageBuffer !== undefined) {
            this.sendAcknowledgement(headersAndBody.resourceId, headersAndBody.sequenceNr, this.messageBuffer.length, headersAndBody.msgLength);
            return;
        }
        else {
            this.sendAcknowledgement(headersAndBody.resourceId, headersAndBody.sequenceNr, messageString.length, headersAndBody.msgLength);
        }
        try {
            var message = JSON.parse(messageString);
            this.dlog(6, function () {
                return "got message " + messageString;
            });
            if (typeof (message.inReplyTo) !== "undefined") {
                this.handleReply(message);
                return;
            }
            var messageType = this.getMessageType(message);
            var handler = this.messageHandlerObj[messageType];
            this.dlog(5, "message of type " + messageType + " for resource " +
                headersAndBody.resourceId +
                (message.revision ? " with revision " + message.revision :
                    " without revision"));
            if (typeof (handler) !== "function" && messageType !== "error") {
                this.dlog(1, function () {
                    return "NetworkConnection: no handler for '" + messageType + "'";
                });
                this.sendReplyMessage({
                    type: "error",
                    description: "no handler for message type '" + messageType + "'"
                }, message);
                return;
            }
            handler.call(this, message);
            if (this.errorStatus !== undefined) {
                globalSystemEvents.notifyHandlers(["connection error cleared"]);
                this.errorStatus = undefined;
            }
        }
        catch (ex) {
            this.dlog(0, "ERROR: messageHandler " + ex.toString());
            console.error(ex);
            this.sendReplyMessage({
                type: "error",
                description: "exception while handling message"
            }, message);
            this.sendMessage({
                type: "reloadApplication",
                reason: "exception: " + ex.toString()
            });
            this.flush();
            this.shutdown("exception: " + ex.toString(), false);
        }
    }
    // --------------------------------------------------------------------------
    // handleReply
    //
    handleReply(message) {
        var inReplyTo = message.inReplyTo;
        var onReplyObj = this.onReply[inReplyTo];
        if (onReplyObj === undefined) {
            this.dlog(0, "handleReply: reply not found");
            return;
        }
        delete this.onReply[inReplyTo];
        this.setReplyTimeout();
        onReplyObj.handler.call(this, onReplyObj.arg, true, message);
    }
    // --------------------------------------------------------------------------
    // addMessageHandler
    //
    addMessageHandler(type, handler) {
        this.messageHandlerObj[type] = handler;
    }
    // --------------------------------------------------------------------------
    // setInboundProgressHandler
    //
    setInboundProgressHandler(handler) {
        this.inboundProgressHandler = handler;
    }
    // --------------------------------------------------------------------------
    // setOutboundProgressHandler
    //
    setOutboundProgressHandler(handler) {
        this.outboundProgressHandler = handler;
    }
    // --------------------------------------------------------------------------
    // addEventHandler
    //
    addEventHandler(type, handler) {
        switch (type) {
            case "open":
            case "close":
            case "error":
                this.eventHandlerObj[type] = handler;
                break;
            default:
                mondriaInternalError("NetworkConnection.addEventHandler: " +
                    "unknown event type '" + type + "'");
                break;
        }
    }
    // --------------------------------------------------------------------------
    // getMessageType
    //
    getMessageType(message) {
        return message.type;
    }
    // --------------------------------------------------------------------------
    // shutdown
    //
    shutdown(msg, attemptReconnect) {
        if (this.messageQueue === undefined) {
            // already done
            return;
        }
        this.dlog(1, "Shutting down connection: " + msg);
        this.clearMessageQueue();
        this.clearReplyTimeout();
        if (typeof (this.connection) !== "undefined") {
            this.connection.close();
            this.connection = undefined;
        }
        if (attemptReconnect) {
            this.clearReplyQueue();
        }
    }
    // --------------------------------------------------------------------------
    // clearMessageQueue
    //
    clearMessageQueue() {
        this.messageQueue = undefined;
    }
    // --------------------------------------------------------------------------
    // clearReplyQueue
    //
    clearReplyQueue() {
        for (var sequenceNr in this.onReply) {
            var onReplyObj = this.onReply[sequenceNr];
            delete this.onReply[sequenceNr];
            onReplyObj.handler.call(this, onReplyObj.arg, false);
        }
        this.setReplyTimeout();
    }
    // --------------------------------------------------------------------------
    // getConnectionState
    //
    getConnectionState() {
        if (typeof (this.connection) === "undefined") {
            return "error";
        }
        var readyState = this.connection.readyState;
        assert(typeof (readyState) === "number", "typecheck");
        var state = ["connecting", "open", "closing", "closed"][readyState];
        if (typeof (state) === "undefined") {
            state = "error";
        }
        assert(typeof (state) === "string", "getConnectionState");
        return state;
    }
    // --------------------------------------------------------------------------
    // getMessageSequenceNr
    //
    getMessageSequenceNr(message) {
        return message.sequenceNr;
    }
    // --------------------------------------------------------------------------
    // dlog
    //
    dlog(severity, msg) {
        if (RemotingLog.shouldLog(severity)) {
            if (typeof (msg) === "function") {
                // msg should then be a parameterless function that returns a string
                msg = msg();
            }
            var connDesc = "(cid:" + String(this.id) + ")";
            if (this.connection && this.connection.url) {
                connDesc += "(" + this.connection.url + ":" +
                    this.getConnectionState() + ")";
            }
            RemotingLog.log(severity, String(msg) + connDesc);
        }
    }
    // Given the string of a buffer to be sent, together with the resource ID,
    // sequence number and total length of the message (the buffer may be
    // just part of the message) this function adds the headers for this buffer
    // and returns a string for the headers + buffer.
    // 'segmentIndicator' should be the character which should appear in the
    // <segmentation indicator> header field (see introduction).
    addHeader(segmentIndicator, resourceId, sequenceNr, msgLength, buffer) {
        var headerVersion = (gNetworkPaddingZeros + gHeaderVersion).slice(-gNumHeaderVersionChars);
        var resourceIdStr = (gNetworkPaddingZeros + resourceId).slice(-gNumResourceIdChars);
        var sequenceNrStr = (gNetworkPaddingZeros + sequenceNr).slice(-gNumSequenceNrChars);
        var msgLengthStr = (gNetworkPaddingZeros + msgLength).slice(-gNumMessageLengthChars);
        return headerVersion + segmentIndicator + resourceIdStr + sequenceNrStr +
            msgLengthStr + buffer;
    }
    // Given the string of buffer just received, this function strips the
    // headers off this buffer. It returns an object of the form:
    // {
    //     segmentIndicator: "-" | "[" | "+" | "]" // value of segmentation header
    //     resourceId: <number>  // value of resource ID header
    //     sequenceNr: <number>  // value of resource ID header
    //     msgLength: <number> // value of message length header
    //     buffer: <string>  // message buffer without the headers
    // }
    //
    // If no revision number is detected at the beginning of the buffer, it is
    // assumed the other side is of an older version and this function
    // returns undefined.
    readHeader(buffer) {
        var pos = 0; // position of current header being read
        // get the header version
        var headerVersion = Number(buffer.substr(pos, gNumHeaderVersionChars));
        if (isNaN(headerVersion)) {
            this.signalTerminationToNoHeader();
            return undefined;
        }
        else if (headerVersion !== gHeaderVersion) {
            this.signalTerminationOtherHeaderVersion(headerVersion);
            return undefined;
        }
        pos += gNumHeaderVersionChars;
        var segmentIndicator = buffer.charAt(pos);
        pos += 1;
        var resourceId = Number(buffer.substr(pos, gNumResourceIdChars));
        pos += gNumResourceIdChars;
        var sequenceNr = Number(buffer.substr(pos, gNumSequenceNrChars));
        pos += gNumSequenceNrChars;
        var msgLength = Number(buffer.substr(pos, gNumMessageLengthChars));
        pos += gNumMessageLengthChars;
        return {
            segmentIndicator: segmentIndicator,
            resourceId: resourceId,
            sequenceNr: sequenceNr,
            msgLength: msgLength,
            buffer: buffer.slice(pos)
        };
    }
    // This function is called when 'receivedLength' characters were received
    // for a message of resource 'resouceId' (a number) with sequence number
    // 'sequenceNr' (this must be a data message, so 'sequenceNr' should not
    // be zero). 'totalLength' is the total length of the message
    // (as read from the headers of the last buffer received for this message).
    // This function sends an acknowledgement message for the receipt of
    // 'receivedLength' charcter for this message. For the structure of this
    // message, see the introduction.
    sendAcknowledgement(resourceId, sequenceNr, receivedLength, totalLength) {
        // construct the message
        var sequenceNrStr = (gNetworkPaddingZeros + sequenceNr).slice(-gNumSequenceNrChars);
        var receivedLengthStr = (gNetworkPaddingZeros + receivedLength).slice(-gNumMessageLengthChars);
        var totalLengthStr = (gNetworkPaddingZeros + totalLength).slice(-gNumMessageLengthChars);
        var ackMessage = sequenceNrStr + receivedLengthStr + totalLengthStr;
        var ackMessageWithHeader = this.addHeader("-", resourceId, 0, ackMessage.length, ackMessage);
        try {
            this.connection.send(ackMessageWithHeader);
        }
        catch (ex) {
            this.dlog(0, "ERROR: send ack " + ex.toString());
        }
    }
    // This function receives an object describing a message buffer received, as
    // returned by the function readHeader. It is assumed this function is
    // called only if this message was an acknowledgement message. This function
    // then handles this acknowledgement (currently, this only prints a log
    // message).
    handleAcknowledgement(headersAndBody) {
        var pos = 0; // position inside message body 
        var sequenceNr = Number(headersAndBody.buffer.substr(pos, gNumSequenceNrChars));
        pos += gNumSequenceNrChars;
        var receivedLen = Number(headersAndBody.buffer.substr(pos, gNumMessageLengthChars));
        pos += gNumMessageLengthChars;
        var totalLen = Number(headersAndBody.buffer.substr(pos, gNumMessageLengthChars));
        pos += gNumMessageLengthChars;
        this.dlog(6, "received acknowledgement for " + receivedLen +
            " characters of " + totalLen + " for message nr. " +
            sequenceNr + " for resource " + headersAndBody.resourceId);
        // get the (optional) arguments stored by the client when the message
        // was sent (this can allow the consumer identify the message for which
        // this is an acknowledgement).
        var replyArgs;
        if (sequenceNr in this.onReply) {
            replyArgs = this.onReply[sequenceNr].arg;
        }
        if (this.outboundProgressHandler !== undefined) {
            this.outboundProgressHandler(headersAndBody.resourceId, sequenceNr, replyArgs, receivedLen, totalLen);
        }
    }
    /// This function is used to signal termination in case the message received
    /// from the other side has no headers. In this case, the standard send
    /// functions cannot be used, as they add headers. Therefore, this function
    /// directly implements the old protocol.
    signalTerminationToNoHeader() {
        if (this.connection === undefined || this.getConnectionState() !== "open") {
            return;
        }
        try {
            var msgStr = JSON.stringify({
                type: "terminate",
                reason: "incompatible version (reload application)"
            });
            this.connection.send(msgStr);
        }
        catch (ex) {
            this.dlog(0, "ERROR: signalTerminationToNoHeader " + ex.toString());
        }
    }
    // This function is used to signal termination when a message is received
    // from the other side with a different header version than the one
    // used by this client. Currently, this does nothing, as no other version
    // is possible. 'version' is the version of the headers received.
    signalTerminationOtherHeaderVersion(version) {
        this.dlog(0, "message with header version " + version + " received");
    }
}
NetworkConnection.defaultPoolSize = 10;
NetworkConnection.defaultPoolDelay = 10;
//# ../networkServer.js:1
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
var http = require("http");
var https = require("https");
var url = require("url");
var directoryListingAllowed = false;
Object.defineProperty(WebSocketServer.prototype, "readyState", {
    get: function () {
        return runtimeEnvironment.nodeWebSocketState(this.state);
    }
});
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
    constructor(options, newServerConnection, validateRequest, serverConnection) {
        this.options = options;
        this.newServerConnection = newServerConnection;
        this.validateRequest = validateRequest;
        this.serverConnection = serverConnection;
        var protocol = options.protocol;
        var port = (options.port ? options.port : 8080);
        var self = this;
        function callHttpRequestListener(request, response) {
            self.httpRequestListener(request, response);
        }
        function callWebSocketRequestListener(request, response) {
            RemotingLog.log(2, "web socket request listener called");
            self.webSocketRequestListener(request, response);
        }
        if (protocol === "ws") {
            this.httpServer = http.createServer(callHttpRequestListener);
        }
        else {
            var serverOptions = {
                key: options.key,
                cert: options.certificate
            };
            this.httpServer = https.createServer(serverOptions, callHttpRequestListener);
        }
        var hostname = options.localMode ? "127.0.0.1" : undefined;
        this.httpServer.listen(port, hostname);
        RemotingLog.log(0, "server started at port " + port);
        this.webSocketServer = new WebSocketServer({
            httpServer: this.httpServer,
            autoAcceptConnections: false
        });
        this.webSocketServer.on("request", callWebSocketRequestListener);
    }
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
    httpRequestListener(request, response) {
        RemotingLog.log(2, "http request: " + request.url + " from: " + request.socket.remoteAddress);
        if (!this.options.fileServer) {
            response.writeHead(404, { 'Content-Type': 'text/html' });
            response.end("<html><body>Too bad: not a valid URL for this server</body></html>");
            return;
        }
        try {
            const myURL = url.parse(request.url);
            const fileName = "." + myURL.pathname;
            const headerETag = request.headers['if-none-match'];
            const extensionStartPos = myURL.pathname.lastIndexOf(".");
            const extension = extensionStartPos === -1 ? "" :
                myURL.pathname.slice(extensionStartPos + 1).toLowerCase();
            const mimeType = extension in NetworkServer.extensionToMimeType ?
                NetworkServer.extensionToMimeType[extension] :
                "application/octet-stream";
            const acceptsGZip = request.headers['accept-encoding'].indexOf("gzip") >= 0;
            const acceptsXGZip = acceptsGZip && request.headers['accept-encoding'].indexOf("x-gzip") >= 0;
            function sendFile(fileName, fileETag, contentEncoding) {
                fs.readFile(fileName, (err, data) => {
                    if (err) {
                        RemotingLog.log(2, "file not readable: " + request.url);
                        response.writeHead(404, { 'Content-Type': 'text/html' });
                        response.end("<html><body>Too bad: not a valid URL in these parts</body></html>");
                    }
                    else {
                        let header = {
                            'Content-Type': mimeType,
                            'ETag': fileETag
                        };
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
            function findFile(fileName, contentEncoding) {
                fs.stat(fileName, (err, stats) => {
                    if (err) {
                        if (acceptsGZip && contentEncoding === undefined) {
                            // Look for a gzip'ed file when the original name
                            // cannot be found and the request indicates that
                            // gzip is an accepted encoding.
                            findFile(fileName + ".gz", acceptsXGZip ? "x-gzip" : "gzip");
                        }
                        else {
                            RemotingLog.log(2, "file not found: " + request.url);
                            response.writeHead(404, { 'Content-Type': 'text/html' });
                            response.end("<html><body>Too bad: not a valid URL in these parts</body></html>");
                        }
                        return;
                    }
                    const fileETag = (stats && stats.mtime ? stats.mtime.getTime() ^ stats.size : 0).toString();
                    if (fileETag === headerETag) {
                        // Received etag is identical to current state
                        RemotingLog.log(2, "file cached: " + request.url);
                        response.writeHead(304, {
                            'ETag': stats.mtime.getTime().toString()
                        });
                        response.end("");
                    }
                    else if (contentEncoding === undefined && directoryListingAllowed &&
                        stats.isDirectory && myURL.query === "format=json") {
                        // Allow the server to send directory contents in json
                        // format. Could be useful for writing a cdl app that
                        // traverses a directory.
                        fs.readdir(fileName, (err, files) => {
                            if (err) {
                                RemotingLog.log(2, "directory not readable: " + request.url);
                                response.writeHead(404, { 'Content-Type': 'text/html' });
                                response.end("<html><body>Too bad: not a valid URL in this neck of the woods</body></html>");
                            }
                            else {
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
                    }
                    else if (!stats.isFile) {
                        RemotingLog.log(2, "file found but not a normal file: " + request.url);
                        response.writeHead(404, { 'Content-Type': 'text/html' });
                        response.end("<html><body>Too bad: not a valid URL around these parts</body></html>");
                    }
                    else {
                        sendFile(fileName, fileETag, contentEncoding);
                    }
                });
            }
            findFile(fileName, undefined);
        }
        catch (e) {
            RemotingLog.log(2, "bad url: " + request.url);
            response.writeHead(404, { 'Content-Type': 'text/html' });
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
    webSocketRequestListener(request, response) {
        var self = this;
        // True when validationCB can only be called with shouldAccept === true
        // after authentication.
        var connectionAuthenticated = false;
        RemotingLog.log(1, "got connection from '" + request.remoteAddress + "'");
        this.serverConnection.logUserAction("connect", { from: request.remoteAddress });
        function validationCB(shouldAccept, user, protocol, reason) {
            var socket;
            self.serverConnection.logUserAction("requestValidation", {
                from: request.remoteAddress,
                user: user,
                accept: shouldAccept,
                reason: reason
            });
            if (shouldAccept === true) {
                try {
                    socket = request.accept(protocol, request.origin);
                }
                catch (e) {
                    RemotingLog.log(0, "exception in request.accept: " + e.toString());
                    return;
                }
                Object.defineProperty(socket, "readyState", {
                    get: function () {
                        return runtimeEnvironment.nodeWebSocketState(socket.state);
                    }
                });
                self.options.user = user;
                self.newServerConnection(self, self.options, socket, self.serverConnection, connectionAuthenticated);
            }
            else {
                request.reject(401, "Authentication Failure");
            }
        }
        // localMode - no validation, only allow connection from the local machine
        if (this.options.localMode) {
            if (request.remoteAddress === "127.0.0.1") {
                connectionAuthenticated = true;
                validationCB(true, undefined, "json", "local mode");
            }
            else {
                RemotingLog.log(0, "unexpected remote address in local mode");
                validationCB(false, undefined, undefined, "remote connection to local server");
            }
        }
        else if (!Authorization.allowAddingUsers && !Authorization.publicDataAccess) {
            connectionAuthenticated = true;
            this.validateRequest(request, this.serverConnection.authDB, validationCB);
        }
        else {
            validationCB(true, undefined, "json", "no authentication required");
        }
    }
}
NetworkServer.extensionToMimeType = {
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
class NetworkServerConnection extends NetworkConnection {
    constructor(networkServer, options, connection, authDB) {
        super(options);
        this.networkServer = networkServer;
        this.connection = connection;
        this.authDB = authDB;
        var self = this;
        RemotingLog.log(1, "New Server Connection");
        function callMessageHandler(message) {
            self.messageHandler(message.utf8Data);
        }
        function callCloseHandler() {
            self.networkServer.serverConnection.logUserAction("disconnect", {
                user: self.user,
                from: self.connection === undefined ? "unknown" :
                    self.connection.remoteAddress
            });
            self.closeHandler(undefined);
        }
        this.connection.on("message", callMessageHandler);
        this.connection.on("close", callCloseHandler);
        this.openHandler();
    }
}
//# ../remotingServerConnection.js:1
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
var emailAddresses = require('email-addresses');
class RemotingServerConnection extends NetworkServerConnection {
    constructor(networkServer, options, socket, remotingServer, authDB, connectionAuthenticated) {
        super(networkServer, options, socket, authDB);
        this.clientResource = {};
        this.clientIdByRegId = {};
        // List of functions that execute messages for a resource that does not yet
        // have authorized access (i.e., messages received between the subscribe
        // message and the authorization callback). Stored per client resource id,
        // since the resource id isn't known yet.
        this.notYetAuthorizedMessage = {};
        // A paid mapper for incoming template and index ids per resource, exclusive
        // to this connection.
        this.remotePaidMgr = {};
        this.resourceMgr = remotingServer.getResourceMgr();
        this.dbName = remotingServer.getDBName();
        this.localMode = !!options.localMode;
        this.user = this.localMode ? null : String(options.user);
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
    destroy() {
        for (var clientResourceId in this.clientResource) {
            var resourceEntry = this.clientResource[clientResourceId];
            var resourceId = resourceEntry.resourceId;
            var regId = resourceEntry.regId;
            var resource = this.resourceMgr.getResourceById(resourceId);
            if (typeof (resource) === "undefined") {
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
    subscribeHandler(message) {
        var self = this;
        var clientResourceId = Number(message.resourceId);
        var resourceSpec = message.resourceSpec;
        function subscribeHandlerCont(error, perm) {
            self.subscribeHandlerCont(!error && perm, message, resourceSpec);
        }
        if (this.localMode) {
            subscribeHandlerCont(null, true);
        }
        else {
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
    subscribeHandlerCont(isAllowed, message, resourceSpec) {
        var self = this;
        var clientResourceId = Number(message.resourceId);
        function sendNAck(err) {
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
            resource.getAllElement(message.revision, function (error, elementObj, revision) {
                if (error === null) {
                    self.sendUpdate(clientResourceId, elementObj, revision, true);
                    return;
                }
                else {
                    // XXX TBD
                    self.dlog(0, "RemotingServerConnection: getAllElement error " + error);
                    sendNAck(error.toString());
                }
            });
        }
        else {
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
    unsubscribeHandler(message) {
        var clientResourceId = Number(message.resourceId);
        this.dlog(2, function () {
            return "unsubscribeHandler: clientResourceId=" + clientResourceId;
        });
        var clientResourceEntry = this.clientResource[clientResourceId];
        if (typeof (clientResourceEntry) === "undefined") {
            this.dlog(1, "unsubscribeHandler: clientResourceEntry '" +
                clientResourceId + "' not found");
        }
        else {
            this.unsubscribe(clientResourceEntry);
        }
    }
    /// unsubscribes resourceId/regId.
    unsubscribe(clientResourceEntry) {
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
    releaseResourceHandler(message) {
        var clientResourceId = Number(message.resourceId);
        this.dlog(2, () => "releaseResourceHandler: clientResourceId=" + clientResourceId);
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
    defineHandler(message) {
        var clientResourceId = Number(message.resourceId);
        var resourceEntry = this.clientResource[clientResourceId];
        var self = this;
        function defineTemplateIndexIds() {
            var resourceEntry = self.clientResource[clientResourceId];
            var resource = self.resourceMgr.getResourceById(resourceEntry.resourceId);
            var remotePaidInterface = self.remotePaidMgr[resource.id];
            if (remotePaidInterface !== undefined) {
                RemotingServerConnection.defineRemoteTemplateIndexIds(remotePaidInterface, message.list);
            }
        }
        if (resourceEntry === undefined) {
            if (clientResourceId in this.notYetAuthorizedMessage) {
                // Authorization still in progress
                this.dlog(4, () => "defineHandler: clientResourceEntry '" +
                    clientResourceId + "' waiting for authorization");
                this.notYetAuthorizedMessage[clientResourceId].push(defineTemplateIndexIds);
            }
            else {
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
    static defineRemoteTemplateIndexIds(remotePaidInterface, definitionList) {
        if (definitionList instanceof Array) {
            for (var i = 0; i < definitionList.length; i++) {
                var def = definitionList[i];
                if (isXDRTemplateDefinition(def)) {
                    remotePaidInterface.addRemoteTemplateDefinition(def);
                }
                else if (isXDRIndexDefinition(def)) {
                    remotePaidInterface.addRemoteIndexDefinition(def);
                }
                else {
                    RemotingLog.log(4, function () {
                        return "not an XDR template or index definition: " + JSON.stringify(def);
                    });
                }
            }
        }
        else {
            RemotingLog.log(4, function () {
                return "not an XDR template or index definition list: " + JSON.stringify(definitionList);
            });
        }
    }
    loginHandler(message) {
        var username = message.username;
        var password = message.password;
        var self = this;
        function loginValidated(err, username, authenticated) {
            self.connectionAuthenticated = authenticated;
            self.networkServer.serverConnection.logUserAction("login", {
                user: username,
                from: self.connection.remoteAddress,
                accept: authenticated,
                reason: err === null ? undefined : err.toString()
            });
            if (authenticated) {
                self.user = username;
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: true,
                    loginSeqNr: message.loginSeqNr
                });
            }
            else {
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: false,
                    error: true,
                    reason: err ? err.toString() : "unknown error",
                    loginSeqNr: message.loginSeqNr
                });
            }
        }
        RemotingLog.log(1, "login: " + username + "/" + password);
        if (typeof (username) === "string" && typeof (password) === "string") {
            BasicWSAuth.validateLogin(this.authDB, username, password, loginValidated);
        }
        else {
            loginValidated("login error", undefined, false);
        }
    }
    /// Deauthenticates the client and unsubscribes all resources that are no
    /// longer authorized. Does not use the authorization functions, as they
    /// require a callback, but only checks publicDataAccess and resource type.
    logoutHandler(message) {
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
    createAccountHandler(message) {
        var username = message.username;
        var password = message.password;
        var email = message.email;
        var self = this;
        function accountCreated(err, username, authenticated) {
            RemotingLog.log(1, "createAccount: " + username + ", err = " +
                (err ? err.toString() : "none"));
            self.connectionAuthenticated = authenticated;
            self.networkServer.serverConnection.logUserAction("createAccount", {
                user: username,
                email: email,
                from: self.connection.remoteAddress,
                accept: authenticated,
                reason: err === null ? undefined : err.toString()
            });
            if (authenticated && err === null) {
                self.user = username;
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: true,
                    loginSeqNr: message.loginSeqNr
                });
            }
            else {
                self.sendMessage({
                    type: "loginStatus",
                    username: username,
                    authenticated: false,
                    error: true,
                    reason: err ? err.toString() : "unknown",
                    loginSeqNr: message.loginSeqNr
                });
            }
        }
        RemotingLog.log(1, "login: " + username + "/" + password);
        if (typeof (username) === "string" && typeof (password) === "string" &&
            isValidPassword(password) && typeof (email) === "string" &&
            isValidEmail(email)) {
            BasicWSAuth.addUserNamePasswordEmail(this.authDB, username, password, email.trim(), false, accountCreated);
        }
        else {
            var errMsgs = [];
            if (typeof (username) !== "string") {
                errMsgs.push("user name is not a string");
            }
            if (typeof (password) !== "string" || !isValidPassword(password)) {
                errMsgs.push("password is not valid");
            }
            if (typeof (email) !== "string" || !isValidEmail(email)) {
                errMsgs.push("email is not valid");
            }
            accountCreated(errMsgs.join(", and "), undefined, false);
        }
    }
    // --------------------------------------------------------------------------
    // sendUpdate
    //
    sendUpdate(clientResourceId, elementObj, lastRevision, sendAllDefinitions) {
        var updateList = [];
        var resource = this.getResourceByClientResourceId(clientResourceId);
        var xdr = this.getXDR(resource, XDRDirection.Marshal);
        if (typeof (xdr) !== "function") {
            mondriaInternalError("sendUpdate: undefined XDR");
            return;
        }
        this.dlog(2, function () {
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
                var idUpdates = sendAllDefinitions ?
                    templateIndexAdmin.getAllTemplateIndexIds() :
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
        }
        catch (ex) {
            console.error(ex);
        }
    }
    resourceUpdate(regId, elementObj, lastRevision) {
        var clientResourceId = this.clientIdByRegId[regId];
        assert(clientResourceId !== undefined, "resourceUpdate");
        this.sendUpdate(clientResourceId, elementObj, lastRevision, false);
    }
    sendTemplateIndexIds(resourceId, definitionList) {
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
    writeHandler(message) {
        var self = this;
        var clientResourceId = Number(message.resourceId);
        var writeList = message.list;
        var clientResourceEntry = self.clientResource[clientResourceId];
        var resourceId = clientResourceEntry === undefined ? undefined :
            clientResourceEntry.resourceId;
        var resource = resourceId === undefined ? undefined :
            self.resourceMgr.getResourceById(resourceId);
        if (typeof (writeList) !== "object" || typeof (writeList.length) !== "number") {
            return;
        }
        function write() {
            var clientResourceEntry = self.clientResource[clientResourceId];
            if (clientResourceEntry === undefined) {
                self.dlog(1, "writeHandler: clientResourceEntry '" +
                    clientResourceId + "' not found");
                return;
            }
            var resourceId = clientResourceEntry.resourceId;
            var elementObj = {};
            var resource = self.resourceMgr.getResourceById(resourceId);
            var xdr = self.getXDR(resource, XDRDirection.Unmarshal);
            var getIdentString = self.getIdentString(clientResourceId);
            try {
                for (var i = 0; i < writeList.length; i++) {
                    var elem = writeList[i];
                    var xelem = xdr(elem);
                    var identStr = getIdentString(xelem);
                    elementObj[identStr] = xelem;
                }
                self.dlog(3, function () {
                    return "got message resourceId=" + resourceId +
                        " elements: " + Object.keys(elementObj).join(", ");
                });
                self.dlog(5, () => JSON.stringify(elementObj));
                resource.write(clientResourceEntry.regId, elementObj, function (error, writeAckInfo, revision) {
                    // the argument 'revision' is the revision assigned to this
                    // write operation.
                    if (error !== null) {
                        // XXX TBD
                        self.dlog(0, "RemotingServerConnection: write error " +
                            error.toString());
                    }
                    else {
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
            }
            catch (ex) {
                self.dlog(0, "ERROR: writeHandler");
                if (ex instanceof Error) {
                    console.error(ex);
                }
            }
        }
        if (resource !== undefined) {
            resource.executeWhenReady(write);
        }
        else if (clientResourceId in this.notYetAuthorizedMessage) {
            this.dlog(4, () => "writeHandler: clientResourceEntry '" +
                resourceId + "' waiting for authorization");
            this.notYetAuthorizedMessage[clientResourceId].push(write);
        }
        else {
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
    authorize(owner, restype, resname, accessor, cb) {
        if (!this.connectionAuthenticated) {
            // Allow every connection acccess to the data when the
            // publicDataAccess flag has been set.
            var permission = Authorization.publicDataAccess &&
                (restype === "metadata" || restype === "table");
            cb(null, permission);
        }
        else {
            var authorization = new Authorization(this.authDB, WSAuth.wwwRoot + "/auth/user_email");
            authorization.isAuthorized(owner, restype, resname, accessor, cb);
        }
    }
    // --------------------------------------------------------------------------
    // getXDR
    //
    getXDR(resource, dir) {
        if (resource === undefined) {
            return undefined;
        }
        else {
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
    getIdentString(clientResourceId) {
        var resource = this.getResourceByClientResourceId(clientResourceId);
        return resource === undefined ? undefined : resource.getIdentStrFunc();
    }
    // --------------------------------------------------------------------------
    // getResourceByClientResourceId
    //
    getResourceByClientResourceId(clientResourceId) {
        var resourceEntry = this.clientResource[clientResourceId];
        if (typeof (resourceEntry) === "undefined") {
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
    closeHandler(error) {
        super.closeHandler(error);
        this.destroy();
    }
    // --------------------------------------------------------------------------
    // errorHandler
    //
    errorHandler(err) {
        super.errorHandler(err);
        this.destroy();
    }
    signalTermination(reason) {
        this.flush();
        this.sendMessage({ type: "terminate", reason: reason });
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
    static validateRequest(request, authDB, cb) {
        function addProtocolCB(err, user, shouldAccept) {
            cb(shouldAccept, user, "json", err === null ? undefined : err.toString());
        }
        var httpRequest = request.httpRequest;
        var headers = httpRequest.headers;
        var cookieList = request.cookies ? request.cookies : [];
        WSAuth.validate(headers, cookieList, authDB, addProtocolCB, undefined);
    }
    // --------------------------------------------------------------------------
    // seqComp1 (static)
    //
    static seqComp1(a, b) {
        return a - b;
    }
    // --------------------------------------------------------------------------
    // seqComp2 (static)
    //
    static seqComp2(a, b) {
        return a.sequenceNr - b;
    }
    resourceConnectionStateUpdate(errorId, errorMessage, ident) {
        throw new Error("Method not implemented.");
    }
    allRequestsAcknowledged(resourceId) {
        throw new Error("Method not implemented.");
    }
    writeAckInfoUpdate(resourceId, writeAckInfo) {
        throw new Error("Method not implemented.");
    }
}
/// Passwords must be at least 8 characters long
function isValidPassword(pwd) {
    return pwd.length >= 8;
}
/// Parses email address using external lib, and verifies there is at least
/// one dot in the domain name (e.g. root@com is forbidden).
function isValidEmail(email) {
    try {
        var emailObj = emailAddresses.parseOneAddress(email);
        return emailObj !== null && emailObj.domain.indexOf(".") > 0;
    }
    catch (e) {
        return false;
    }
}
//# ../resourceMgr.js:1
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
/// <reference path="../feg/utilities.ts" />
/// <reference path="../feg/externalTypes.basic.d.ts" />
/// <reference path="remotingLog.ts" />
/// <reference path="mongojs.d.ts" />
/// <reference path="../feg/paidMgr.ts" />
/// <reference path="../feg/xdr.ts" />
/// <reference path="formatUpgrade.ts" />
/// <reference path="externalDataSourceAPI.ts" />
// Removes ambiguity when concatenating strings that potentially contain
// a period: replaces a period by _._, and _ by __. This results in a
// unique string that is also a legal mongodb collection name.
function escapeMongoName(str) {
    return str.replace(/_/g, "__").replace(/\./g, "_._");
}
/**
* A ResourceManager maintains a set of resources. The current persistence
* server has precisely one, which manages the resources of a specific profile.
* Resources are identified by a 'spec': an a/v describing resource properties.
*
* A resource has a unique numerical id, and an unfortunately named "resource
* identifier", which have a one-to-one relation. The resource identifier,
* however, is a string which is derived from the resource spec, and also
* indicates the name of table in the mongodb that holds the corresponding data.
* There are three types of resources, and their resource identifiers are
* composed as follows:
* - appState: "rrm.${stem}.${ownerName}.${appName}"
* - table: "table.${databaseid}"
* - metadata: "metadata" (i.e., there is only one such resource)
* The three types have their own class, derived from class Resource, to manage
* the data: AppStateResource, TableResource, and MetaDataResource. The latter
* two both map to a single mongodb table, but AppStateResource uses three
* mongodb tables: one for the actual data, one for indices, and one for
* templates.
*
* Note that table here corresponds to [database, <id>] in cdl, and metadata
* corresponds to [databases]. Also note that the app state's table name
* structure has a meaning in authorization.js.
*
* For more information about templates and indices: see paidMgr.ts
*
* @class ResourceMgr
*/
class ResourceMgr {
    constructor(
        /**
         * The name of the database (not used)
         *
        * @type {string}
        * @memberof ResourceMgr
         */
        dbName) {
        this.dbName = dbName;
        /**
         * Maps each resource identifier to a Resource. Same resources as
         * resourceById.
         *
         * @type {{[ident: string]: Resource}}
         * @memberof ResourceMgr
         */
        this.resourceByIdent = {};
        /**
         * maps each numeric resource id to a Resource. Same resources as
         * resourceByIdent.
         *
         * @type {{[id: number]: Resource}}
         * @memberof ResourceMgr
         */
        this.resourceById = {};
        /**
         * maps each numeric resource id to a resource type.
         *
         * @memberof ResourceMgr
         */
        this.resourceTypeById = {};
        /**
         * A counter for assigning a unique id to each resource
         *
         * @type {number}
         * @memberof ResourceMgr
         */
        this.nextResourceId = 1;
        /**
         * List of the external data sources. Currently set by the persistence
         * server.
         */
        this.externalDataSources = [];
        var mongojs = require("mongojs");
        this.db = mongojs(this.dbName);
    }
    destroy() {
        if (this.db !== undefined) {
            this.db.close();
            this.db = undefined;
        }
        this.resourceByIdent = undefined;
        this.resourceById = undefined;
        this.resourceTypeById = undefined;
    }
    /**
     * Meant to clear the resource manager when restarting the persistence
     * server
     *
     * @memberOf ResourceMgr
     */
    reinitialize() {
        this.nextResourceId = 1;
        this.resourceByIdent = {};
        this.resourceById = {};
        this.resourceTypeById = {};
    }
    /**
     * Returns the indicated Resource. Creates it if necessary.
     *
     * @param spec an A/V describing the resource
     * @returns the Resource corrresponding to the spec
     *
     * @memberOf ResourceMgr
     */
    getResourceBySpec(spec) {
        if (typeof (spec) !== "object" || typeof (spec.type) !== "string") {
            return undefined;
        }
        switch (spec.type) {
            case "appState":
                return this.getAppStateResourceBySpec(spec);
            case "table":
                if (this.externalDataSourceIds === undefined) {
                    this.externalDataSourceIds = {};
                    for (var i = 0; i < this.externalDataSources.length; i++) {
                        var eds = this.externalDataSources[i];
                        this.externalDataSourceIds[eds.id] = eds;
                    }
                }
                if (spec.app in this.externalDataSourceIds) {
                    return this.getExternalResourceBySpec(spec, this.externalDataSourceIds[spec.app]);
                }
                else {
                    return this.getDatabaseResourceBySpec(spec);
                }
            case "metadata":
                return this.getMetaDataResourceBySpec(spec);
        }
        RemotingLog.log(0, "ERROR in spec " + JSON.stringify(spec));
        return undefined;
    }
    // Returns the resource identifier for the app state in this.resourceByIdent.
    static makeAppStateResIdent(spec) {
        return "rrm." + spec.type + "." + escapeMongoName(spec.owner) + "." +
            escapeMongoName(spec.app);
    }
    /**
     * Creates (if needed) the AppStateResource for given ownerName and appName.
     * Sets up the connection to the three mongodb tables.
     *
     * @param spec An A/V with type: "appState", and an ownerName and appName
     *             field of type string.
     * @returns the AppStateResource corresponding to the spec
     *
     * @memberOf ResourceMgr
     */
    getAppStateResourceBySpec(spec) {
        function mkname(stem) {
            return "rrm." + stem + "." + ownerName + "." + appName;
        }
        var ownerName = escapeMongoName(spec.owner);
        var appName = escapeMongoName(spec.app);
        var resIdent = ResourceMgr.makeAppStateResIdent(spec);
        if (typeof (ownerName) !== "string" || typeof (appName) !== "string" ||
            typeof (resIdent) !== "string") {
            RemotingLog.log(0, "ERROR in appState resourceSpec");
            return undefined;
        }
        var templateIdent = mkname(spec.type + ".template");
        var indexIdent = mkname(spec.type + ".index");
        var resource = this.resourceByIdent[resIdent];
        if (resource === undefined) {
            var id = this.nextResourceId++;
            var dataCollection = this.getCollectionHandle(resIdent);
            var templateCollection = this.getCollectionHandle(templateIdent);
            var indexCollection = this.getCollectionHandle(indexIdent);
            resource = new AppStateResource(resIdent, id, this.db, dataCollection, templateCollection, indexCollection);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }
    // Returns the table resource according to specification; creates it if it
    // doesn't exist yet.
    getDatabaseResourceBySpec(spec) {
        if (typeof (spec.app) !== "string") {
            RemotingLog.log(0, "ERROR in table resourceSpec " + JSON.stringify(spec.app));
            return undefined;
        }
        // Make sure that each path has a unique string, [] should not yield the
        // same id as [""], ["a,b"] not the same as ["a", "b"], etc.
        var pathAsString = spec.path.map(attr => "/" + encodeURIComponent(attr));
        var resIdent = "tables." + spec.app + "." + pathAsString; // resource identifier, table name and path
        var resource = this.resourceByIdent[resIdent];
        if (resource === undefined) {
            var id = this.nextResourceId++;
            var dataCollection = this.getCollectionHandle("tables." + spec.app);
            var shadowCollection = this.getCollectionHandle("shadow." + spec.app); // TESTING
            resource = new TableResource(resIdent, id, this.db, dataCollection, spec.app, spec.path, shadowCollection);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }
    // Returns the external data resource according to specification; creates it
    // if it doesn't exist yet. Similar to TableResource
    // Query parameters are converted from an arbitrary os to an array of
    // values following the order in ExternalDataSourceSpecification.queryParameters
    getExternalResourceBySpec(spec, eds) {
        var pathAsString = spec.path.map(attr => "/" + encodeURIComponent(attr));
        var resIdent = "external." + spec.app + "." + pathAsString; // resource identifier, table name and path
        var specParams = ensureOS(spec.params);
        var paramMap = undefined;
        var queryParameters = undefined;
        var parameterError = false;
        // Copy valid parameters into a single object
        for (var i = 0; i < specParams.length; i++) {
            var specParam = specParams[i];
            if (isAV(specParam)) {
                for (var paramName in specParam) {
                    if (paramMap === undefined) {
                        paramMap = {};
                    }
                    paramMap[paramName] = mergeConst(specParam[paramName], paramMap[paramName]);
                }
            }
        }
        if (paramMap !== undefined && eds.queryParameters !== undefined) {
            // Check parameters for completeness and defaults, and put them in a list
            queryParameters = [];
            for (i = 0; i < eds.queryParameters.length; i++) {
                var qpd = eds.queryParameters[i];
                if (qpd.id in paramMap) {
                    queryParameters[i] = paramMap[qpd.id];
                }
                else if ("defaultValue" in qpd) {
                    queryParameters[i] = qpd.defaultValue;
                }
                else if (!qpd.optional) {
                    parameterError = true;
                    break;
                }
            }
            if (queryParameters !== undefined && queryParameters.length > 0) {
                resIdent += "?" + JSON.stringify(queryParameters);
            }
            else {
                queryParameters = undefined;
            }
        }
        var resource = this.resourceByIdent[resIdent];
        if (resource === undefined && !parameterError) {
            var id = this.nextResourceId++;
            resource = new ExternalResource(resIdent, id, eds, queryParameters, spec.path);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }
    // Returns the (unique) metadata resource; creates it if it doesn't exist.
    getMetaDataResourceBySpec(spec) {
        var resIdent = "metadata"; // resource identifier and table name
        var resource = this.resourceByIdent[resIdent];
        if (resource === undefined) {
            var id = this.nextResourceId++;
            var dataCollection = this.getCollectionHandle(resIdent);
            resource = new MetaDataResource(resIdent, id, this.db, dataCollection, this);
            this.storeResourceById(id, resIdent, spec.type, resource);
        }
        return resource;
    }
    /**
     * Get the interface to a mongodb table
     *
     * @param {string} ident name of the mongodb table
     * @returns the collection object
     *
     * @memberOf ResourceMgr
     */
    getCollectionHandle(ident) {
        return this.db.collection(ident);
    }
    /**
     * Returns resource with given numeric id
     *
     * @param {number} id resource id
     * @returns {Resource}
     *
     * @memberOf ResourceMgr
     */
    getResourceById(id) {
        return this.resourceById[id];
    }
    /**
     * Stores resource under given ids
     *
     * @param {number} id the numeric resource id
     * @param {string} resIdent the resource identifier/table name
     * @param {Resource} resource
     *
     * @memberOf ResourceMgr
     */
    storeResourceById(id, resIdent, resType, resource) {
        this.resourceByIdent[resIdent] = resource;
        this.resourceById[id] = resource;
        this.resourceTypeById[id] = resType;
    }
    // Signals termination of the server to the clients; does not do any cleanup
    // as it's supposed to halt any moment.
    signalTermination(reason) {
        var terminatedConnections = {};
        for (var resIdent in this.resourceByIdent) {
            var resource = this.resourceByIdent[resIdent];
            for (var id in resource.subscriber) {
                var connection = resource.subscriber[id];
                if (!(connection.id in terminatedConnections)) {
                    connection.signalTermination(reason);
                    terminatedConnections[connection.id] = true;
                }
            }
        }
    }
}
/**
 * A counter used to generate unique ids for each resource update message.
 * Each resource marks the id of the last update it sent, so that it knows
 * if a reconnecting client is still in sync. It's initialized with the
 * current time stamp, so that a restart of the server won't accidentally
 * hand out the same id twice (assuming there's not a resource update every
 * millisecond or faster; that could make the counter get ahead of the
 * value of a restarted instance).
 *
 * @static
 * @type {number}
 * @memberof ResourceMgr
 */
ResourceMgr.nextResourceUpdateMessageId = Date.now();
;
/**
 * A single resource (e.g. the app data or a facet of a table).
 *
 * A Resource consists of multiple elements, represented in a map that links
 * the element identifiers to a value. The identifiers' meaning can differ per
 * resource type. For app data, they map to specific app state context labels;
 * for tables, there is only one element.
 *
 * A Resource potentially has multiple subscribers, which are supposed to
 * share the same data. If one subscriber changes the data, that changes is
 * propagated to all other clients.
 *
 * On subscription, the Resource is responsible for checking authorization and
 * sending the initial update.
 *
 * @class Resource
 */
class Resource {
    constructor(ident, id, db, collection) {
        this.ident = ident;
        this.id = id;
        this.db = db;
        this.collection = collection;
        this.subscriber = {};
        this.alsoNotifyWriter = false;
        this.readyQueue = [];
        this.isReady = true;
        // persisted revision counter (advanced with each write). This is set
        // initially after reading the data from the database
        this.lastRevision = undefined;
    }
    // Gets called when the resource is removed from the ResourceMgr's
    // resourceById(ent) tables.
    destroy() {
    }
    getId() {
        return this.id;
    }
    /**
     * Executes all entries from the readyQueue, which can be one of two types:
     * "getAllElement" and "write", which simply call the eponymous functions
     * with the arguments given by the entry.
     *
     * This can be called in different steps of initialization. It is
     * therefore possible for functions called here to simply be rescheduled
     * (and placed again on the 'readyQueue'). For this reason, a new
     * queue is created before looping over the list of entries in the
     * old queue.
     *
     * @memberOf Resource
     */
    processReadyQueue() {
        if (this.readyQueue.length === 0) {
            return;
        }
        var readyQueue = this.readyQueue;
        this.readyQueue = []; // in case there is something to reschedule
        for (var i = 0; i < readyQueue.length; i++) {
            var entry = readyQueue[i];
            switch (entry.type) {
                case "getAllElement":
                    this.getAllElement(entry.fromRevision, entry.cb);
                    break;
                case "write":
                    this.write(entry.originatingClientResourceId, entry.elementObj, entry.cb);
                    break;
                case "external":
                    entry.cb(undefined, undefined, undefined);
                    break;
            }
        }
    }
    /**
     * This function may be called by the 'getAllElement' function,
     * where 'elementList' is the set of elements just retrieved for this
     * resource from the database. This function then determines the highest
     * version number for the elements just retrieved and if this number
     * is greater than the 'lastRevision' of the resource, sets this
     * number on 'lastRevision' (this happens the first time 'getAllElement'
     * is called. If the argument 'fromRevision' is not undefined, this
     * function filters out a subset of 'elementList' consisting only those
     * elements which have a revision higher than 'fromRevision'. The function
     * returns this filtered list (or the full list, if no filtering took place)
     * and the maximal revision of an element in the list.
     * If 'fromRevision' is undefined, this a full update (rather than an
     * incremental one) so empty elements (null value) are not included.
     *
     * @param {number} fromRevision
     * @param {any[]} elementList
     * @returns { filtered: any[], maxRevision: number }
     * @memberof Resource
     */
    filterAllElementRevision(fromRevision, elementList) {
        if (this.lastRevision === undefined) {
            this.lastRevision = 0; // first time, needs to be initialized
        }
        // determine the last revision in the resource. Moreover, if a
        // 'fromRevision' is specified, only 'elementList' is filtered
        // to include only elements with a revision larger than
        // 'fromRevision'
        // the maximal revision of a retrieved element
        var maxRevision = undefined;
        var filtered = [];
        for (var i = 0, l = elementList.length; i < l; i++) {
            var elem = elementList[i];
            var revision = elem._revision;
            if (revision !== undefined) {
                if (revision > this.lastRevision) {
                    this.lastRevision = revision;
                }
                if (maxRevision === undefined || revision > maxRevision) {
                    maxRevision = revision;
                }
                if ((fromRevision !== undefined && fromRevision < revision) ||
                    (fromRevision === undefined && elem.value !== null)) {
                    filtered.push(elem);
                }
            }
            else if (fromRevision === undefined && elem.value !== null) {
                filtered.push(elem);
            }
        }
        // if all elements have no revision, the revision is 0
        // (any additional updates will be added with a higher revision
        // number).
        return { filtered: filtered ? filtered : elementList,
            maxRevision: maxRevision === undefined ? 0 : maxRevision };
    }
    getAllElement(fromRevision, cb) {
        if (!this.isReady) {
            // if the resource is not ready yet, queue requests
            this.readyQueue.push({
                type: "getAllElement",
                cb: cb,
                fromRevision: fromRevision
            });
            return;
        }
        if (this.collection === undefined) {
            cb(null, o(), undefined);
        }
        else {
            var self = this;
            this.collection.find().toArray(function (err, elementList) {
                var elementObj = undefined;
                if (err === null) {
                    var filtered = self.filterAllElementRevision(fromRevision, elementList);
                    elementObj = self.getElementObj(filtered.filtered);
                    self.addExternalData(elementObj);
                }
                cb(err, elementObj, filtered.maxRevision);
                // process any writes pending this operation
                self.processReadyQueue();
            });
        }
    }
    // notify subscriber whenever this resource is modified
    subscribe(subscriber) {
        var subscriberId = Resource.nextSubscriberId++;
        if (Utilities.isEmptyObj(this.subscriber)) {
            this.acquireResource();
        }
        this.subscriber[subscriberId] = subscriber;
        return subscriberId;
    }
    unsubscribe(subscriberId) {
        delete this.subscriber[subscriberId];
        if (Utilities.isEmptyObj(this.subscriber)) {
            this.purgeResource();
        }
    }
    releaseResource(subscriberId) {
        delete this.subscriber[subscriberId];
        if (Utilities.isEmptyObj(this.subscriber)) {
            this.purgeResource();
        }
    }
    /**
     * Gets called on the first subscription to the resource
     */
    acquireResource() {
    }
    /**
     * Gets called when there are no more subscriptions to the resource
     */
    purgeResource() {
    }
    /**
     * Effectuates a change in the resource, stores it in the database and
     * sends the change to other subcribers.
     *
     * @param {number} originatingClientResourceId the originating client
     *     resource id
     * @param {*} elementObj an a/v; any attribute in elementObj denotes
     *     a resource element that is to be added/modified in this resource.
     *     deletion is signalled by providing an undefined/null value
     * @param {ResourceCallback} cb called after all the updates/writes have
     *     completed, with the arbitrary first error - or 'null' if no error
     *     occurred
     * @returns {void}
     *
     * @memberof Resource
     */
    write(originatingClientResourceId, elementObj, cb) {
        assert(typeof (originatingClientResourceId) === "number" &&
            typeof (elementObj) === "object" &&
            typeof (cb) === "function", "Resource.write: typecheck failed");
        if (!this.isReady || this.lastRevision === undefined) {
            this.readyQueue.push({
                type: "write",
                elementObj: elementObj,
                cb: cb,
                originatingClientResourceId: originatingClientResourceId
            });
            return;
        }
        var that = this;
        var revision = ++this.lastRevision;
        var revTimeStamp = new Date().toISOString();
        var writtenIds = []; // IDs of elements written
        // 'result' here is the number of records modified (should always
        // be 1, except, perhaps, in the case of deletion, if the deleted
        // entry does nto exist).
        function mfn(error, result) {
            o.count--;
            if (error !== null && o.error === null) {
                o.error = error;
            }
            assert(o.count >= 0, "mfn: count");
            assert(o.wasCalled === false, "mfn: wasCalled");
            if (o.count === 0) {
                o.wasCalled = true;
                o.cb(o.error, o.writeAckInfo, revision);
                that.notify(writtenIds, originatingClientResourceId);
            }
        }
        var o = {
            count: 0,
            wasCalled: false,
            cb: cb,
            writeAckInfo: {},
            error: null
        };
        for (var eid in elementObj) {
            var value = elementObj[eid];
            o.count++;
            if (value === undefined || value === null) {
                value = undefined;
            }
            else if (typeof (value) === "object" &&
                value.value === xdrDeleteIdent) {
                value.value = undefined;
            }
            writtenIds.push(this.writeElement(originatingClientResourceId, eid, value, revision, revTimeStamp, o.writeAckInfo, mfn));
        }
    }
    // This function performs the write of a single element object.
    // 'eid' is the ID identifying it in the database, 'elementObj'
    // is the object to be written (the 'value' of the entry in the database)
    // and may be undefined if the element needs to be deleted.
    // 'revision' is the revision assigned to this write by the resource.
    // 'writeAckInfo' is an object which the writeElement() function can use
    // to store information which needs to be set on the write acknowledgement
    // message to be sent at the end of the write operation. This is optional
    // and depends on the resource and on the operation (the base class does
    // not store any information here).
    // 'cb' is a callback which is called when the write of the single
    // object has succeeded.
    // The function returns the ID of the element just written.
    writeElement(originatingClientResourceId, eid, elementObj, revision, revTimeStamp, writeAckInfo, cb) {
        this.collection.update({ _id: eid }, {
            _id: eid,
            _revision: revision,
            _revTimeStamp: revTimeStamp,
            value: elementObj
        }, { upsert: true }, cb);
        return eid;
    }
    // notify clients of changes (is 'this.alsoNotifyWriter' is false,
    // the client which wrote the update is not notified).
    notify(idList, srcSID) {
        var subscriber = this.subscriber;
        var alsoNotifyWriter = this.alsoNotifyWriter;
        var _self = this;
        this.collection.find({ _id: { $in: idList } }).toArray(function (err, elementList) {
            if (err === null) {
                // Note: there's no need to add external data here
                var elementObj = _self.getElementObj(elementList);
                for (var sid in subscriber) {
                    if (Number(sid) !== srcSID || alsoNotifyWriter) {
                        subscriber[sid].resourceUpdate(sid, elementObj, _self.lastRevision);
                    }
                }
            }
        });
    }
    // The input is a list of objects as extracted from the mongo DB.
    // This function converts these objects to the structure which
    // is sent to the client.
    getElementObj(elementList) {
        var elementObj = {};
        var i;
        for (i = 0; i < elementList.length; i++) {
            // in case the entry is in an older format, upgrade it first
            var elem = AppStateFormatUpgrade.upgradeFormat(elementList[i]);
            if (!elem || !elem.value) {
                RemotingLog.log(0, "ERROR: empty app state element: " +
                    (elem ? ("ID: " + elem._id) : "null"));
                continue;
            }
            var attr = elem._id;
            elementObj[attr] = {
                ident: elem.value.ident,
                revision: elem._revision,
                value: !elem.value.value ?
                    xdrDeleteIdent : elem.value.value
            };
        }
        return elementObj;
    }
    // Adds external data to the resource element map
    addExternalData(elementObj) {
    }
    sendDirectUpdate(res) {
        RemotingLog.log(3, function () {
            return "sendDirectUpdate " +
                (typeof (res) === "object" && res !== null ? Object.keys(res).join(", ") : "");
        });
        for (var sid in this.subscriber) {
            this.subscriber[sid].resourceUpdate(sid, res, this.lastRevision);
        }
    }
    getPaidMgr() {
        return undefined;
    }
    /**
     * Executes f() when the resource is ready, i.e. either immediately, or when
     * setReady() is called.
     *
     * @param {() => void} f function to be executed
     * @memberof Resource
     */
    executeWhenReady(f) {
        if (this.isReady) {
            f();
        }
        else {
            this.readyQueue.push({
                type: "external",
                cb: f
            });
        }
    }
}
Resource.nextSubscriberId = 1;
/**
 * This derived class of Resource adds a paidMgr which has its template and
 * index table associated with the arguments 'templateCollection' and
 * 'indexCollection' respectively.
 * The resource is only considered 'ready' after these collections were
 * loaded into the paidMgr. To load them, it calls the paidBackingStore's load
 * function which has an asynchronous callback. Requests arriving before the
 * resource is ready are queued in this.readyQueue.
 *
 * @class AppStateResource
 * @extends {Resource}
 * @member {PaidBackingStore} paidBackingStore
 * @member {BackingStorePaidMgr} paidMgr
 * @member {boolean} isReady true once the paidBackingStore has finished loading
 * @member {Entry[]} readyQueue list of actions to be executed once the resource
 *                   is loaded
 */
class AppStateResource extends Resource {
    // Each app state resource has its own paid manager and translation
    // private remotePaidInterface: RemotePaidInterface;
    constructor(ident, id, db, dataCollection, templateCollection, indexCollection) {
        super(ident, id, db, dataCollection);
        this.paidBackingStore = new PaidBackingStore(templateCollection, indexCollection);
        this.paidMgr = new BackingStorePaidMgr(this.paidBackingStore);
        // this.remotePaidInterface = new RemotePaidInterface(this.paidMgr);
        this.isReady = false;
        this.paidBackingStore.load((err, templateList, indexList) => {
            if (err === null) {
                RemotingLog.log(2, "AppStateResource: loading templates/indices");
                RemotingLog.log(4, () => "AppStateResource: loaded template=\n" + JSON.stringify(templateList));
                RemotingLog.log(4, () => "AppStateResource: loaded index=\n" + JSON.stringify(indexList));
                this.paidMgr.preload(templateList, indexList);
                RemotingLog.log(3, "AppStateResource: templates/indices loaded");
                this.setReady();
            }
            else {
                // XXX TBD error handling
                RemotingLog.log(0, "AppStateResource: paid table load failed");
            }
        });
    }
    /**
     *
     * Called when the paidBackingStore has successfully loaded the template and
     * index tables.
     *
     * @memberOf AppStateResource
     */
    setReady() {
        this.isReady = true;
        this.processReadyQueue();
    }
    getPaidMgr() {
        return this.paidMgr;
    }
    getXDRFunc() {
        return XDR.xdrAppStateElement;
    }
    getIdentStrFunc() {
        return function (elem) {
            var ident = elem.ident;
            return ident.templateId + ":" + ident.indexId + ":" + ident.path;
        };
    }
}
/**
 * Implements persistent storage of paid information using two given mongodb
 * collections, one for the templates, and one for the indices.
 *
 * @class PaidBackingStore
 */
class PaidBackingStore {
    constructor(templateHandle, indexHandle) {
        this.templateHandle = templateHandle;
        this.indexHandle = indexHandle;
        this.templateMapCopy = {}; // For debugging !!!
    }
    /**
     * Stores the template entry under the template id in the database.
     * Call returns immediately, without confirmation, but crashes the
     * application on failure.
     *
     * @param {number} templateId
     * @param {PaidMgrTemplateEntry} templateEntry
     *
     * @memberOf PaidBackingStore
     */
    addTemplate(templateId, templateEntry) {
        function cb(error, result) {
            assert(error === null, "addTemplateCB");
        }
        this.verifyAddTemplateMap(Number(templateId), templateEntry, "addTemplate"); // !!!
        this.templateHandle.update({ _id: templateId }, { _id: templateId, value: templateEntry }, { upsert: true }, cb);
    }
    // DEBUG CHECK!!!
    // A test similar to the one of PaidMgr.preload, but before writing to
    // the database.
    verifyAddTemplateMap(templateId, tEntry, caller) {
        var parentId = tEntry.parentId;
        var childType = tEntry.childType;
        var childName = tEntry.childName;
        var referredId = tEntry.referredId;
        var tIdent = parentId + ":" + childType + ":" + childName;
        if (childType === "intersection") {
            tIdent += ":" + referredId;
        }
        assert(!(tIdent in this.templateMapCopy) || templateId === this.templateMapCopy[tIdent], "PaidBackingStore." + caller + ": templateId must not change: ident=" +
            tIdent + ", " + templateId + "(" + typeof (templateId) + ") != " +
            this.templateMapCopy[tIdent] + "(" +
            typeof (this.templateMapCopy[tIdent]) + ")");
        this.templateMapCopy[tIdent] = templateId;
    }
    /**
     * Stores the index entry under the index id in the database.
     * Call returns immediately, without confirmation, but crashes the
     * application on failure.
     *
     * @param {number} indexId
     * @param {PaidMgrIndexEntry} indexEntry
     *
     * @memberOf PaidBackingStore
     */
    addIndex(indexId, indexEntry) {
        function cb(error, result) {
            assert(error === null, "addIndexCB");
        }
        this.indexHandle.update({ _id: indexId }, { _id: indexId, value: indexEntry }, { upsert: true }, cb);
    }
    /**
     * Retrieves the contents of the template and index tables, and calls the
     * callback function when done with the data and error status. Note that
     * this is asynchronous.
     *
     * @param {(err, templateObj, indexObj) => void} cb the callback function
     *
     * @memberOf PaidBackingStore
     */
    load(cb) {
        var self = this;
        this.templateHandle.find().toArray(function (err, templateList) {
            if (err !== null) {
                cb(err);
                return;
            }
            self.indexHandle.find().toArray(function (err, indexList) {
                var templates = [];
                var indices = [];
                var i;
                for (i = 0; i < templateList.length; i++) {
                    var templateElement = templateList[i];
                    templates[templateElement._id] =
                        templateElement.value;
                }
                for (i = 0; i < indexList.length; i++) {
                    var indexElement = indexList[i];
                    indices[indexElement._id] = indexElement.value;
                }
                if (err === null) {
                    cb(null, templates, indices);
                }
                else {
                    cb(err);
                }
            });
        });
    }
}
// TableResource takes care of retrieving and storing data tables. Data is
// stored using one record per path, which contains an array with simple
// values per data element for that path. The empty path contains the mapping
// information, in particular the number of elements.
// The table name is "tables.<ident>". This convention is set in
// ResourceMgr.getDatabaseResourceBySpec().
class TableResource extends Resource {
    constructor(ident, id, db, collection, app, path, shadowCollection) {
        super(ident, id, db, collection);
        this.app = app;
        this.path = path;
        this.shadowCollection = shadowCollection;
        this.alsoNotifyWriter = true;
    }
    getXDRFunc() {
        return function (elem, xdr) {
            return elem;
        };
    }
    getIdentStrFunc() {
        return function (elem) {
            var ident = elem.ident;
            return ident.templateId + ":" + ident.indexId + ":" +
                ident.path.map((e) => "/" + encodeURIComponent(e));
        };
    }
    getAllElement(fromRevision, cb) {
        if (!this.isReady) {
            // if the resource is not ready yet, queue requests
            this.readyQueue.push({
                type: "getAllElement",
                cb: cb,
                fromRevision: fromRevision
            });
            return;
        }
        if (this.collection === undefined) {
            cb(null, [], undefined);
        }
        else {
            var _self = this;
            this.collection.find({ path: this.path }).
                toArray(function (err, data) {
                var filtered = _self.filterAllElementRevision(fromRevision, data);
                cb(err, { data: filtered.filtered }, filtered.maxRevision);
                // process any writes pending this operation
                _self.processReadyQueue();
            });
        }
    }
    removeTable(cb) {
        var self = this;
        if (this.collection === undefined) {
            cb(null, [], undefined);
        }
        else {
            this.collection.drop(function (err, result) {
                if (!err) {
                    self.sendDirectUpdate([[]]);
                }
                if (self.shadowCollection !== undefined) {
                    self.shadowCollection.drop(function (err, result) { });
                }
                cb(err, result, undefined);
            });
        }
    }
    // Calls cb(err, exists, revision) with a boolean indicating the existence
    // of the table.
    // err and revision are always null and undefined (respectively). 
    checkExistence(cb) {
        if (this.collection === undefined) {
            cb(null, false, undefined);
        }
        else {
            this.collection.findOne({}, function (err, data) {
                cb(null, !err && data, undefined);
            });
        }
    }
    // Writes using the bulk interface, which is apparently limited to 1000
    // records. The real reason seems to be that there is a 16MB limit on BSON,
    // so it might be that the 1000 is just a magic number and that proper operation
    // can be broken with 1000 very large records. [LIMITATION]
    write(originatingClientResourceId, tableData, cb) {
        assert(typeof (originatingClientResourceId) === "number" &&
            typeof (tableData) === "object" &&
            typeof (cb) === "function", "TableResource.write: typecheck failed");
        var _self = this;
        if (this.lastRevision === undefined) {
            // still need to determine the revision by reading any data
            // already available (queue the write to take place when this is
            // completed)
            this.readyQueue.push({
                type: "write",
                elementObj: tableData,
                cb: cb,
                originatingClientResourceId: originatingClientResourceId
            });
            this.collection.find({ path: this.path }, { _revision: true }).
                toArray(function (err, data) {
                // this sets the revision number on the resource
                _self.filterAllElementRevision(undefined, data);
                // process any writes pending this operation
                _self.processReadyQueue();
            });
            return;
        }
        var dbOp = this.collection;
        var revision = ++this.lastRevision;
        var revTimeStamp = new Date().toISOString();
        for (var i = 0, l = tableData.values.length; i < l; ++i) {
            tableData.values[i]._revision = revision;
            tableData.values[i]._revTimeStamp = revTimeStamp;
        }
        function insertValues(i) {
            if (i === tableData.values.length) {
                // no callback, just for testing; disabled for now.
                // _self.writeShadow(tableData);
                cb(null, undefined, revision);
            }
            else {
                dbOp.insert(tableData.values[i], function (err, result) {
                    if (!err) {
                        insertValues(i + 1);
                    }
                    else {
                        cb(err, undefined, revision);
                    }
                });
            }
        }
        dbOp.remove({}, function (err, result) {
            if (!err) {
                dbOp.insert({
                    path: [],
                    _revision: revision,
                    mapping: tableData.mapping
                }, function (err, result) {
                    if (!err) {
                        insertValues(0);
                    }
                    else {
                        cb(err, undefined, revision);
                    }
                });
            }
            else {
                cb(err, undefined, revision);
            }
        });
    }
    // TESTING. Doesn't do callbacks or anything, just unpacks the data in another
    // format in a shadow table. Can only handle single attributes.
    writeShadow(tableData) {
        var data = new Array(tableData.mapping.nrDataElements);
        var self = this;
        var attrMap = {};
        function decompressRawData(compressedData, indexedValues) {
            var data = [];
            var i, j;
            var offset, values;
            if (indexedValues === undefined) {
                for (i = 0; i < compressedData.length; i++) {
                    offset = compressedData[i].o;
                    values = compressedData[i].v;
                    for (j = 0; j < values.length; j++) {
                        data[offset + j] = values[j];
                    }
                }
            }
            else {
                for (i = 0; i < compressedData.length; i++) {
                    offset = compressedData[i].o;
                    values = compressedData[i].v;
                    for (j = 0; j < values.length; j++) {
                        data[offset + j] = indexedValues[values[j]];
                    }
                }
            }
            return data;
        }
        /// MongoDB doesn't like $ and . in attribute names, nor attributes
        /// starting with an underscore. These are removed; uniqueness is
        /// guaranteed by suffixing with a number.
        function remapAttributes(obj) {
            if (typeof (obj) !== "object") {
                return obj;
            }
            if (obj instanceof Array) {
                return obj.map(remapAttributes);
            }
            var remapped = {};
            for (var attr in obj) {
                if (!(attr in attrMap)) {
                    var nAttr = attr.replace(/^_+/, "").replace(/[$.]/g, "");
                    if (nAttr in attrMap) {
                        var suffix = 0;
                        while ((nAttr + " " + suffix) in attrMap) {
                            suffix++;
                        }
                        nAttr += " " + suffix;
                    }
                    attrMap[attr] = nAttr;
                }
                remapped[attrMap[attr]] = remapAttributes(obj[attr]);
            }
            return remapped;
        }
        function insertShadowData(i) {
            var bulk = self.shadowCollection.initializeOrderedBulkOp();
            if (i < data.length) {
                for (var j = i; j < data.length && j < i + 1000; j++) {
                    if (data[j] !== undefined) {
                        bulk.insert(remapAttributes(data[j]));
                    }
                }
                bulk.execute(function (err, result) {
                    insertShadowData(i + 1000);
                });
            }
        }
        attrMap["_id"] = "_id"; // Don't remap this attribute
        for (var i = 0; i < tableData.values.length; i++) {
            var path = tableData.values[i].path;
            if (path.length !== 1) {
                continue;
            }
            var attr = path[0];
            var values = decompressRawData(tableData.values[i].pathValuesRanges, tableData.values[i].indexedValues);
            for (var j = 0; j < values.length; j++) {
                var v = values[j];
                if (v !== undefined && v !== null) {
                    if (data[j] === undefined) {
                        data[j] = {};
                        data[j]._id = j + 1; // Map data element id to _id; note that 0 is not a good _id
                    }
                    data[j][attr] = v;
                }
            }
        }
        insertShadowData(0);
    }
}
/* The meta data resource describes the tables known to the system, i.e. those
   accessible under tables.<ident> in one single os.
     For every table, a record with a single AV exists, and it must contain:
   - id: the identifier, so "tables." + id will retrieve the actual table;
     this value cannot be changed.
   - name: the full name; can be changed
   - attributes: an array of objects with the following attributes
        - name: can be changed
        - originalName: cannot be changed
        - type: can be changed, but changes carry a risk
        - uniqueValues: (optional; cannot be changed)
        - min: (optional; change on type change?)
        - max: (optional; change on type change?)
   It may also contain
   - lastUpdate: the numeric representation of a Date() which reflects the time
     of the last change.
   - tags: a mutable list of strings.
   - state: ?

   The data is stored in the table "metadata" (see ResourceMgr.
   getMetaDataResourceBySpec). It has one record per table, and the
   format of each record is a an xdr'ed version of the object. The _id of the
   record (since this server relies on mongo) must be the id of the table.

   Note that there is only one metadata resource.
*/
var gMetaDataResource;
class MetaDataResource extends Resource {
    constructor(ident, id, db, collection, resourceManager) {
        super(ident, id, db, collection);
        this.resourceManager = resourceManager;
        var mongojs = require("mongojs");
        this.alsoNotifyWriter = true;
        this.objectId = mongojs.ObjectId;
        if (gMetaDataResource !== undefined) {
            RemotingLog.log(0, "ERROR : multiple metadata resources " +
                ident + " " + id);
        }
        gMetaDataResource = this;
    }
    getXDRFunc() {
        return XDR.xdrMetadataElement;
    }
    // metadata update entries has a simple identifier stored under their
    // 'ident' entry.
    getIdentStrFunc() {
        return function (elem) {
            return elem.ident;
        };
    }
    // The input is a list of objects as extracted from the mongo DB and the
    // external data sources.
    // This function converts these objects to the structure which
    // is sent to the client.
    getElementObj(elementList) {
        var elementObj = {};
        var i;
        for (i = 0; i < elementList.length; i++) {
            // in case the entry is in an older format, upgrade it first
            var elem = MetadataFormatUpgrade.upgradeFormat(elementList[i]);
            if (!elem) {
                RemotingLog.log(0, "ERROR: empty metadata element");
                continue;
            }
            elementObj[elem._id] = {
                ident: elem._id,
                revision: elem._revision,
                value: !elem.value ?
                    xdrDeleteIdent : elem.value
            };
        }
        return elementObj;
    }
    // Add external data sources (but only needed info; no connection info).
    addExternalData(elementObj) {
        var xdr = new AgentXDR(XDRDirection.Marshal, undefined);
        for (var i = 0; i < this.resourceManager.externalDataSources.length; i++) {
            var obj = this.resourceManager.externalDataSources[i];
            var eds = normalizeObject({
                name: obj.name,
                id: obj.id,
                attributes: obj.attributes,
                parameters: obj.queryParameters
            });
            elementObj[obj.id] = {
                ident: obj.id,
                revision: obj.revision === undefined ? 1 : obj.revision,
                value: xdr.xdrOS(eds)
            };
        }
    }
    // This function is called within the write() function (implemented
    // in the base class) to write a single element (given by 'elementObj')
    // into the metadata collection. 'eid' is the identfier of the metadata.
    // This should be the table ID for the relevant table, which should
    // also appear in the 'id' field of 'elementObj'. However, if this
    // is a new table, it was not yet assigned an ID by the mongo DB database.
    // Therefore, 'eid' would be the name of the database (which is not
    // necessarily unique, but is unique for a single write operation)
    // and 'id' would be missing in 'elementObj'. In that case, a new ID
    // is assigned to this entry (which creates a new metadata entry in
    // the database). This ID is then provided back to the writing client
    // through the write acknowledgement. The new ID assigned is stored in
    // the 'writeAckInfo' under an attribute equal to the old (temporary) ID.
    // If 'elementObj' contains a 'data' field, this is used to store
    // the relevant data in the data resources. This field is then
    // removed and not stored in the metadata table.
    // If a metadata entry already exist in the database for this ID,
    // the update is merged with the existing entry (which means that
    // fields which are missing in 'elementObj' will remain unchanged in
    // the database).
    // An undefined 'elementObj' or one which has 'remove: true' attribute
    // can be used to delete the corresponding table.
    // The function returns the ID of the element just written. If this
    // is assigned in this function, it is the ID assigned in the database
    // which is returned, which may differ from the original (temporary) ID.
    writeElement(originatingClientResourceId, eid, elementObj, revision, revTimeStamp, writeAckInfo, cb) {
        if (elementObj !== undefined &&
            (elementObj.value === undefined ||
                elementObj.value.value === undefined)) {
            cb(new Error("value missing in metadata update"), undefined);
            return eid;
        }
        if (elementObj === undefined ||
            XDR.isTrue(elementObj.value.value.remove)) {
            // need to remove this table (eid must be a table ID)
            this.removeTable(eid, revision, revTimeStamp, cb);
            return eid;
        }
        // set the revision
        elementObj._revision = revision;
        elementObj._revTimeStamp = revTimeStamp;
        var isNew = (elementObj.value.value.id === undefined);
        // determine the table ID for this entry (if there is an 'id'
        // field in 'elementObj', then this is the table ID and otherwise
        // a new table ID is allocated (and set on the object).
        var tableId = this.setUpdateTableId(elementObj);
        if (tableId === undefined) {
            cb(new Error("corrupted table ID in DB"), undefined);
            return eid;
        }
        if (isNew) {
            writeAckInfo[eid] = tableId;
        }
        var _self = this;
        function updateMetadata(err, result, revision) {
            if (err) {
                RemotingLog.log(0, "ERROR: MetaDataResource.write " +
                    "bulk write failed");
                cb(err, result);
            }
            else {
                _self.collection.update({ _id: tableId }, elementObj, { upsert: true }, cb);
            }
        }
        function mergeAndUpdateMetadata(err, result, revision) {
            if (isNew) {
                updateMetadata(err, result, revision);
                return;
            }
            // get the existing entry from the mongo DB (if exists) to merge
            // the update with it.
            _self.collection.find({ _id: tableId }).toArray(function (err, elementList) {
                if (err) {
                    cb(err, undefined);
                    return;
                }
                if (elementList.length === 1) {
                    // existing entry found, need to merge with update
                    elementObj = XDR.mergeXDRValues(elementObj, elementList[0]);
                }
                updateMetadata(err, result, revision);
            });
        }
        // Take out the data from the update object
        var data = elementObj.value.value.data;
        delete elementObj.value.value.data;
        var hasData = data !== undefined && !XDR.isEmptyOS(data);
        if (hasData) {
            this.writeData(originatingClientResourceId, tableId, data, mergeAndUpdateMetadata);
        }
        else {
            updateMetadata(null, undefined, revision);
        }
        return tableId;
    }
    // When the metadata update received has a 'data' field, this function
    // stores this data in the table resource. There is no need to notify
    // other clients, as they only subscribe to the table resource as needed.
    // The callback provided to this function continues the metadata
    // update process.
    writeData(originatingClientResourceId, tableId, data, cb) {
        // Get the resource for the table as we need to update it. It
        // does not need to call "getAllElement" or anything, we just
        // need it to get a unique handle to it and its database
        // interface.
        var tableResource = this.resourceManager.getDatabaseResourceBySpec({
            app: tableId,
            path: []
        });
        // Decode the data (tables are written as is) and update the table
        // and (when successful) the metadata
        var agentXDR = new AgentXDR(XDRDirection.Unmarshal, undefined);
        var tableData = agentXDR.xdrCdlObj(data);
        if (tableData instanceof Array) {
            if (tableData.length !== 1) {
                RemotingLog.log(0, "ERROR: MetaDataResource.write tableData");
                return;
            }
            tableData = tableData[0];
        }
        tableResource.write(originatingClientResourceId, tableData, cb);
    }
    // This function receives as input an update received from the client.
    // This is an object with a 'value' field which contains the actual
    // information. This function sets the _id field (next to the 'value'
    // field) which identifies this for insertion into the database.
    // If the 'value' object contains an 'id' field, this is the value
    // used. Otherwise, a new ID is generated and assigned (and also
    // placed under the 'id' field of 'value'). This function both modifies
    // the input object and returns the ID.
    setUpdateTableId(tableMetaDataUpdate) {
        // Get the record id if specified, assuming that the sent record is
        // denormalized and assign _id before inserting/upserting
        var tableId = tableMetaDataUpdate.value.value.id;
        if (tableId === undefined) {
            // If not specified, ask mongo for a new, unique id
            var newId = new this.objectId();
            tableId = tableMetaDataUpdate.value.value.id = newId.toString();
            RemotingLog.log(1, "Allocated new table id: " + tableId);
        }
        else {
            if (typeof (tableId) !== "string") {
                RemotingLog.log(0, "ERROR: MetaDataResource.setUpdateTableId");
                return undefined;
            }
        }
        // assign _id (before inserting/upserting the mongo DB)
        tableMetaDataUpdate._id = tableId;
        return tableId;
    }
    // Remove the table, and when successful, remove the table's metadata
    removeTable(tableId, revision, revTimeStamp, cb) {
        // Get the resource for the table as we need to update it.
        var tableResource = this.resourceManager.getDatabaseResourceBySpec({
            app: tableId,
            path: []
        });
        var _self = this;
        // update the metadata entry with an 'undefined' value. If no entry
        // is found in the mongo DB, this does not write a new entry into
        // the database.
        function removeMetaData() {
            _self.collection.update({ _id: tableId }, { _id: tableId, _revision: revision,
                revTimeStamp,
                value: undefined }, undefined, cb);
        }
        RemotingLog.log(1, function () { return "Removing table " + tableId; });
        tableResource.removeTable(function (err, result) {
            if (!err) {
                RemotingLog.log(1, function () {
                    return "Table removed " + tableId;
                });
                removeMetaData();
            }
            else {
                tableResource.checkExistence(function (_err, exists, revision) {
                    if (!exists) {
                        removeMetaData();
                    }
                    else {
                        // Note: error from call to removeTable
                        cb(err, result);
                    }
                });
            }
        });
    }
}
function mergeXDRById(elem, os) {
    for (var i = 0; i < os.os.length; i++) {
        if (os.os[i]._id === elem._id) {
            var origOsElem = os.os[i];
            os.os[i] = XDR.mergeXDRValues(elem, os.os[i]);
            os.os[i]._id = elem._id; // Can get removed by XDR.mergeXDRValues
            return {
                position: i,
                changed: !objectEqual(os.os[i], origOsElem)
            };
        }
    }
    os.os.push(elem);
    return {
        position: os.os.length - 1,
        changed: true
    };
}
function deleteFromXDRById(elem, os) {
    for (var i = 0; i < os.os.length; i++) {
        if (os.os[i]._id === elem._id) {
            os.os.splice(i, 1);
            return true;
        }
    }
    return false;
}
// ExternalResource takes care of interacting with the external data source API
class ExternalResource extends Resource {
    constructor(ident, id, 
        /**
         * The specification of the external data source
         */
        externalDataSourceSpecification, 
        /**
         * The parameters for the query
         */
        parameterValues, 
        /**
         * The path within the external data source
         */
        path) {
        super(ident, id, undefined, undefined);
        this.externalDataSourceSpecification = externalDataSourceSpecification;
        this.parameterValues = parameterValues;
        this.path = path;
    }
    acquireResource() {
        if (this.externalDataSource === undefined) {
            for (var i = 0; i < externalDataSourceClasses.length; i++) {
                var edsc = externalDataSourceClasses[i];
                if (edsc.accepts(this.externalDataSourceSpecification, this.path)) {
                    this.externalDataSource = new edsc.classConstructor(this.externalDataSourceSpecification, ensureOS(this.parameterValues), this.path);
                    return;
                }
            }
        }
        // Note that there won't be an externalDataSource when none of the
        // classes accepts the spec
    }
    purgeResource() {
        if (this.externalDataSource !== undefined) {
            this.externalDataSource.destroy();
            this.externalDataSource = undefined;
        }
    }
    getXDRFunc() {
        return function (elem, xdr) {
            return elem;
        };
    }
    getIdentStrFunc() {
        var queryParamStr = JSON.stringify(this.parameterValues);
        return function (elem) {
            var ident = elem.ident;
            return ident.templateId + ":" + ident.indexId + ":" +
                ident.path.map((e) => "/" + encodeURIComponent(e)) +
                "." + queryParamStr;
        };
    }
    getAllElement(fromRevision, cb) {
        if (this.externalDataSource === undefined) {
            cb("no such external data source", [], 1);
        }
        else if (!this.isReady) {
            // if the resource is not ready yet, queue requests
            this.readyQueue.push({
                type: "getAllElement",
                cb: cb,
                fromRevision: fromRevision
            });
        }
        else {
            this.externalDataSource.getData((err, data) => {
                var elementObj = {};
                elementObj[this.id] = data;
                cb(err, elementObj, 1);
            });
        }
    }
    setReady() {
        this.isReady = true;
        this.processReadyQueue();
    }
    removeTable(cb) {
        cb("can't remove external data source", [], undefined);
    }
    // Calls cb(err, exists, revision) with a boolean indicating the existence
    // of the table.
    // err and revision are always null and undefined (respectively). 
    checkExistence(cb) {
        cb(null, false, undefined);
    }
}
//# ../authorize/authorization.js:1
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
/// <reference path="../remotingLog.ts" />
/// <reference path="../mongojs.d.ts" />
/// <reference path="../../utils/node.d.ts" />
var mongojs = require('mongojs');
class Authorization {
    constructor(db, userEmailFile) {
        this.db = db;
        this.userEmailFile = userEmailFile;
        this.lastFileCheckTime = undefined;
        this.lastFileCheckUserObj = undefined;
    }
    /**
     * Calls cb with result of authorizing the current user for a given
     * resource specification.
     *
     * The basis of authentication is a series of records in the database, which
     * is all or nothing. E.g., they do not specify read/write permissions. If
     * these are added, account switching must be adapted too.
     *
     * @param resowner owner account name of the resource
     * @param restype resource type: app state, table or metadata
     * @param resname name of the resource
     * @param accessor name of the account that wants to access the resource
     * @param cb callback function
     */
    isAuthorized(resowner, restype, resname, accessor, cb) {
        var self = this;
        RemotingLog.log(3, () => "Authorization.isAuthorized(ownr=" + resowner +
            ", rtyp=" + restype + ", rname=" + resname +
            ", accessor=" + accessor + ")");
        if (!Authorization.isValidOwnername(resowner)) {
            RemotingLog.log(1, "Authorization.isAuthorized: invalid owner");
            cb("Invalid owner", undefined, false);
            return;
        }
        if (!Authorization.isValidUsername(accessor)) {
            RemotingLog.log(1, "Authorization.isAuthorized: invalid accessor");
            cb("Invalid accessor", undefined, false);
            return;
        }
        if (!Authorization.isValidResourcename(resname)) {
            RemotingLog.log(1, "Authorization.isAuthorized: invalid resource");
            cb("Invalid resource", undefined, false);
            return;
        }
        function isAuthorizedCont(perm) {
            if (perm === true) {
                self.isAuthorizedCont1(resowner, restype, resname, accessor, cb);
            }
            else {
                cb(null, undefined, false);
            }
        }
        if (this.userEmailFile === null) {
            isAuthorizedCont(true);
            return;
        }
        function isAccessorInFileCont() {
            if (self.lastFileCheckUserObj === undefined ||
                !(accessor in self.lastFileCheckUserObj)) {
                RemotingLog.log(1, "Authorization.isAuthorized: accessor not in file");
                cb(null, undefined, false);
            }
            else {
                isAuthorizedCont(true);
            }
        }
        if (Authorization.useAuthFiles) {
            this.getUserEmailFileLastModifiedTime(function (mtime) {
                if (isNaN(self.lastFileCheckTime) || isNaN(mtime) ||
                    mtime >= self.lastFileCheckTime) {
                    self.updateUserEmailCache(isAccessorInFileCont);
                }
                else {
                    isAccessorInFileCont();
                }
            });
        }
        else {
            this.db.collection("userHash").findOne({ userName: accessor }, function (err, result) {
                if (err) {
                    RemotingLog.log(1, "Authorization.isAuthorized: accessor not in db");
                    cb(err, undefined, false);
                }
                else {
                    isAuthorizedCont(true);
                }
            });
        }
    }
    // --------------------------------------------------------------------------
    // getUserEmailFileLastModifiedTime
    //
    getUserEmailFileLastModifiedTime(cb) {
        fs.stat(this.userEmailFile, function (err, stats) {
            if (!err && stats && stats.mtime) {
                cb(stats.mtime.getTime());
            }
            else {
                RemotingLog.log(2, "Authorization.isAuthorized: fs.stat error");
                cb(undefined);
            }
        });
    }
    // --------------------------------------------------------------------------
    // updateUserEmailCache
    //
    updateUserEmailCache(cb) {
        var userCache = {};
        var userRegExp = Authorization.usernameInUserEmailFileRegexp;
        var self = this;
        this.lastFileCheckTime = Date.now();
        try {
            fs.readFile(self.userEmailFile, 'utf8', function (err, data) {
                if (err) {
                    RemotingLog.log(2, "Authorization.isAuthorized: readFile error");
                    self.lastFileCheckUserObj = {};
                }
                else {
                    data.toString().split(/\n/).forEach(function (line) {
                        var res = userRegExp.exec(line);
                        if (res !== null) {
                            var username = res[1];
                            userCache[username] = true;
                        }
                    });
                    self.lastFileCheckUserObj = userCache;
                }
                cb();
            });
        }
        catch (e) {
            this.lastFileCheckUserObj = {};
            RemotingLog.log(2, "Authorization.isAuthorized: readfile exception");
            cb();
        }
    }
    // --------------------------------------------------------------------------
    // isAuthorizedCont1
    //
    isAuthorizedCont1(resowner, restype, resname, accessor, cb) {
        if (Authorization.alwaysAllowOwner && resowner === accessor) {
            RemotingLog.log(2, "Authorization.isAuthorized: allow owner==accessor");
            cb(null, accessor, true);
            return;
        }
        var authResource = new AuthorizationResource(this.db, resowner, '*', '*');
        var thread = {
            authorization: this,
            resowner: resowner,
            restype: restype,
            resname: resname,
            accessor: accessor,
            cb: cb,
            wildcardPerm: undefined
        };
        function isAuthorizedCont(err, username, perm) {
            RemotingLog.log(2, function () {
                return "Authorization.isAuthorized(ownr=" + resowner +
                    ", res=*:*, accessor=" + accessor + "): bool(err)=" +
                    !!err + ", perm=" + perm;
            });
            thread.authorization.isAuthorizedCont2(thread, err, perm);
        }
        authResource.getAccessorPerm(accessor, isAuthorizedCont);
    }
    // --------------------------------------------------------------------------
    // isAuthorizedCont2
    //
    isAuthorizedCont2(thread, err, perm) {
        var cb = thread.cb;
        // error
        if (err) {
            RemotingLog.log(2, function () {
                return "Authorization.isAuthorized(ownr=" + thread.resowner +
                    ", res=*:*, accessor=" + thread.accessor + "): err=" + err;
            });
            cb(err, undefined, false);
            return;
        }
        // wild-card denied
        if (perm === false) {
            RemotingLog.log(2, function () {
                return "Authorization.isAuthorized(ownr=" + thread.resowner +
                    ", res=*:*, accessor=" + thread.accessor +
                    ", perm=" + perm;
            });
            cb(err, undefined, false);
        }
        thread.wildcardPerm = perm;
        function isAuthorizedCont(err, username, perm) {
            thread.authorization.isAuthorizedCont3(thread, err, perm);
        }
        var authResource = new AuthorizationResource(this.db, thread.resowner, thread.restype, thread.resname);
        authResource.getAccessorPerm(thread.accessor, isAuthorizedCont);
    }
    // --------------------------------------------------------------------------
    // isAuthorizedCont3
    //
    isAuthorizedCont3(thread, err, perm) {
        var cb = thread.cb;
        // error
        if (err) {
            RemotingLog.log(3, function () {
                return "Authorization.isAuthorized<3a>(ownr=" + thread.resowner +
                    ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                    ", accessor=" + thread.accessor + "): err=" + err;
            });
            cb(err, undefined, false);
            return;
        }
        // explicit, specific answer
        if (perm === false || perm === true) {
            RemotingLog.log(3, function () {
                return "Authorization.isAuthorized<3b>(ownr=" + thread.resowner +
                    ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                    ", accessor=" + thread.accessor + "): perm=" + perm;
            });
            cb(err, thread.accessor, perm);
            return;
        }
        if (thread.wildcardPerm === true) {
            RemotingLog.log(3, function () {
                return "Authorization.isAuthorized<3c>(ownr=" + thread.resowner +
                    ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                    ", accessor=" + thread.accessor + "): wildcard allow";
            });
            cb(err, thread.accessor, true);
            return;
        }
        if (thread.resowner === thread.accessor) {
            RemotingLog.log(3, function () {
                return "Authorization.isAuthorized<3d>(ownr=" + thread.resowner +
                    ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                    ", accessor=" + thread.accessor + "): allow owner==accessor";
            });
            cb(err, thread.accessor, true);
            return;
        }
        if (Authorization.publicDataAccess && (thread.restype === "table" || thread.restype === "metadata")) {
            RemotingLog.log(3, function () {
                return "Authorization.isAuthorized<3e>(ownr=" + thread.resowner +
                    ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                    ", accessor=" + thread.accessor + "): allow owner==accessor";
            });
            cb(err, thread.accessor, true);
            return;
        }
        RemotingLog.log(3, function () {
            return "Authorization.isAuthorized<3f>(ownr=" + thread.resowner +
                ", rtyp=" + thread.restype + ", rname=" + thread.resname +
                ", accessor=" + thread.accessor + "): default deny";
        });
        cb(err, undefined, false);
    }
    // --------------------------------------------------------------------------
    // updateRule
    //
    updateRule(resowner, restype, resname, accessor, perm, cb) {
        if (!Authorization.isValidOwnername(resowner)) {
            cb("Invalid owner", undefined, false);
            return;
        }
        if (accessor === Authorization.wildcard) {
            accessor = "$*";
        }
        else if (!Authorization.isValidUsername(accessor)) {
            cb("Invalid accessor", undefined, false);
            return;
        }
        if (resname === Authorization.wildcard) {
            resname = '*';
        }
        else if (!Authorization.isValidResourcename(resname)) {
            cb("Invalid resource", undefined, false);
            return;
        }
        if (restype === Authorization.wildcard) {
            restype = '*';
        }
        else if (!Authorization.isValidResourcename(restype)) {
            cb("Invalid resource type", undefined, false);
            return;
        }
        var authResource = new AuthorizationResource(this.db, resowner, restype, resname);
        authResource.updateAccessorRule(accessor, perm, cb);
    }
    // --------------------------------------------------------------------------
    // getResourcePolicy
    //
    getResourcePolicy(resowner, restype, resname, cb) {
        if (!Authorization.isValidOwnername(resowner)) {
            cb("Invalid owner", resowner, {});
            return;
        }
        if (resname === Authorization.wildcard) {
            resname = '*';
        }
        else if (!Authorization.isValidResourcename(resname)) {
            cb("Invalid resource", resowner, {});
            return;
        }
        if (restype === Authorization.wildcard) {
            restype = '*';
        }
        else if (!Authorization.isValidResourcename(restype)) {
            cb("Invalid resource type", resowner, {});
            return;
        }
        var authResource = new AuthorizationResource(this.db, resowner, restype, resname);
        authResource.getRuleSet(cb);
    }
    // --------------------------------------------------------------------------
    // getOwnerList
    //
    getOwnerList(cb) {
        function findOwnerCB(error, docs) {
            if (error) {
                cb(error, undefined, []);
                return;
            }
            if (!Array.isArray(docs)) {
                cb("Authorization.getOwnerList: Unexpected type", undefined, []);
                return;
            }
            var ownerObj = {};
            for (var i = 0; i < docs.length; i++) {
                var colname = docs[i];
                var resobj = AuthorizationResource.parseCollectionName(colname);
                if (resobj === undefined) {
                    RemotingLog.log(3, "non-authorization collection '" +
                        colname + "'");
                    continue;
                }
                ownerObj[resobj.resowner] = true;
            }
            cb(error, undefined, Object.keys(ownerObj));
        }
        this.db.getCollectionNames(findOwnerCB);
    }
    // --------------------------------------------------------------------------
    // getOwnerResourceList
    //
    getOwnerResourceList(owner, cb) {
        function findOwnerResourceCB(error, docs) {
            if (error) {
                cb(error, undefined, []);
                return;
            }
            if (!Array.isArray(docs)) {
                cb("Authorization.getOwnerResourceList: Unexpected type", undefined, []);
                return;
            }
            var resourceList = [];
            for (var i = 0; i < docs.length; i++) {
                var colname = docs[i];
                var resobj = AuthorizationResource.parseCollectionName(colname);
                if (resobj === undefined) {
                    RemotingLog.log(3, "non-authorization collection '" +
                        colname + "'");
                    continue;
                }
                if (resobj.resowner === owner) {
                    resourceList.push(resobj);
                }
            }
            cb(error, undefined, resourceList);
        }
        if (!Authorization.isValidOwnername(owner)) {
            cb("Invalid owner", undefined, []);
            return;
        }
        this.db.getCollectionNames(findOwnerResourceCB);
    }
    // --------------------------------------------------------------------------
    // isValidOwnername (static)
    //
    static isValidOwnername(username) {
        return typeof (username) === "string" &&
            Authorization.validUsernameRegex.test(username);
    }
    // --------------------------------------------------------------------------
    // isValidUsername (static)
    //
    static isValidUsername(username) {
        return Authorization.isValidOwnername(username) &&
            username !== "anonymous";
    }
}
/**
 * When true, access to database resources is granted to every subscriber
 */
Authorization.publicDataAccess = false;
/**
 * When true, user name/password combinations come from the user email file;
 * when false, they come from the global table 'userAdmin' in the mongo db.
 */
Authorization.useAuthFiles = true;
/**
 * When true, a request for creating a new user/password combination from
 * the browser is accepted.
 */
Authorization.allowAddingUsers = false;
Authorization.alwaysAllowOwner = true;
// the contents are irrelevant - the address ('pointer address') is all self
//  matters
Authorization.wildcard = [{ _w_c_: '*' }];
Authorization.validUsernameRegex = /^[^\t]+$/;
Authorization.validResourcenameRegex = /^[a-zA-Z0-9_]+$/;
Authorization.usernameInUserEmailFileRegexp = /^([a-zA-Z0-9_]+):/;
// --------------------------------------------------------------------------
// isValidResourcename (static)
//
Authorization.isValidResourcename = function (resname) {
    return typeof (resname) === "string" &&
        Authorization.validResourcenameRegex.test(resname);
};
class AuthorizationResource {
    constructor(db, resowner, restype, resname) {
        this.db = db;
        this.resowner = resowner;
        this.restype = restype;
        this.resname = resname;
        this.collection = undefined;
        var cname = AuthorizationResource.getCollectionName(resowner, restype, resname);
        this.collection = this.db.collection(cname);
    }
    // --------------------------------------------------------------------------
    // getCollectionName (static)
    //
    static getCollectionName(resowner, restype, resname) {
        //return "rra." + resowner + ":" + restype + ":" + resname;
        return "rrm." + resowner + "." + restype + "." + resname;
    }
    //rrm.appState.uri.myLeanZCApp
    //(1) appState = type
    //(2) uri = owner
    //(3) myLeanZCApp = name
    static parseCollectionName(cname) {
        var res = AuthorizationResource.collectionNameParseRegex.exec(cname);
        if (typeof (res) !== "object" || res === null || res[1] === undefined ||
            res[2] === undefined || res[3] === undefined) {
            return undefined;
        }
        return {
            restype: res[1],
            resowner: res[2],
            resname: res[3] // resname: res[3]
        };
    }
    updateAccessorRule(accessor, perm, cb) {
        if (typeof (perm) === "boolean") {
            this.collection.update({ _id: accessor }, { _id: accessor, perm: perm }, { upsert: true }, cb);
        }
        else if (perm === "DELETE") {
            this.collection.remove({ _id: accessor }, false, cb);
        }
        else {
            RemotingLog.log(1, "Authorization.updateAccessorRule: " +
                "unexpected 'perm' (" + typeof (perm) + ")");
            cb("unexpected perm", undefined, false);
        }
    }
    getRuleSet(cb) {
        this.collection.find(function (err, ruleSet) {
            var ruleObj = undefined;
            if (err === null) {
                ruleObj = {};
                for (var i = 0; i < ruleSet.length; i++) {
                    var rule = ruleSet[i];
                    ruleObj[rule._id] = rule.perm;
                }
            }
            cb(err, undefined, ruleObj);
        });
    }
    getAccessorPerm(accessor, cb) {
        var self = this;
        function getAccessorPermCont(error, docs) {
            self.getAccessorPermCont(accessor, cb, error, docs, 1);
        }
        this.collection.find({ _id: accessor }, getAccessorPermCont);
    }
    // --------------------------------------------------------------------------
    // getAccessorPermCont
    //
    getAccessorPermCont(accessor, cb, error, docs, stage) {
        if (error) {
            cb(error, undefined, false);
            return;
        }
        if (docs instanceof Array && docs.length === 1) {
            var perm = docs[0].perm;
            if (typeof (perm) !== "boolean") {
                cb("Non-boolean perm", undefined, false);
                return;
            }
            cb(error, undefined, perm);
            return;
        }
        var self = this;
        function getAccessorPermCont(error, docs) {
            self.getAccessorPermCont(accessor, cb, error, docs, stage);
        }
        if (stage === 1) {
            stage++;
            if (accessor === this.resowner) {
                this.collection.find({ _id: "$owner" }, getAccessorPermCont);
                return;
            }
        }
        if (stage === 2) {
            stage++;
            this.collection.find({ _id: "$*" }, getAccessorPermCont);
            return;
        }
        if (stage === 3) {
            stage++;
            cb(error, undefined, null);
            return;
        }
        cb("Unexpected stage", undefined, false);
    }
}
AuthorizationResource.collectionNameParseRegex = 
///^rra.([^.:]+):([^.:]+):([^.:]+)$/;
/^rrm.([^.:]+).([^.:]+).([^.:]+)$/;
//# ../wsAuth.js:1
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
/// <reference path="authorize/authorization.ts" />
/// <reference path="../feg/xdr.ts" />
var child_process = require("child_process");
var url = require("url");
var crypto = require("crypto");
requireBtoaAtob();
class WSAuth {
    static validate(headers, cookieList, authDB, cb, flags) {
        if (flags && flags.origin !== "not-required") {
            if (!WSAuth.validateOrigin(headers)) {
                cb(null, undefined, false);
                return;
            }
        }
        if ("authorization" in headers) {
            var authStr = headers["authorization"];
            RemotingLog.log(2, function () {
                return "validating authorization header '" + authStr + "'";
            });
            BasicWSAuth.validate(authStr, authDB, cb);
            return;
        }
        for (var i = 0; i < cookieList.length; i++) {
            var cookie = cookieList[i];
            if (cookie.name === "mauth") {
                RemotingLog.log(2, function () {
                    return "validating 'mauth' cookie '" + cookie.value + "'";
                });
                CookieAuth.validate(cookie.value, cb);
                return;
            }
        }
        RemotingLog.log(2, "no 'authorization' header nor 'mauth' cookie present");
        cb("no cookie", undefined, false);
    }
    static validateOrigin(headers) {
        if (!("origin" in headers)) {
            RemotingLog.log(1, "WSAuth.validate: 'Origin' header missing");
            return false;
        }
        var origin = headers["origin"];
        var originUrlObj = url.parse(origin);
        var wsHostPort = headers["host"] || "";
        var wsHost = wsHostPort.split(":")[0];
        if (typeof (wsHost) !== "string" || wsHost !== originUrlObj.hostname ||
            originUrlObj.protocol !== "https:") {
            RemotingLog.log(1, function () {
                return "websocket host '" + String(wsHost) +
                    "' must match " + "'origin' host '" + originUrlObj.hostname +
                    "' and " + "origin.protocol '" + originUrlObj.protocol +
                    "' must be '" + "https:'";
            });
            return false;
        }
        return true;
    }
}
WSAuth.wwwRoot = "/var/www";
class BasicWSAuth {
    // --------------------------------------------------------------------------
    // validate (static)
    //
    // http basic authentication:
    //   the user and password are concatenated, separated by a colon ':',
    //   encoded with base64, then the string 'Basic' is prepended
    //
    // XXX  rumor has it that 'atob'/'btoa' does not support unicode
    static validate(authStr, authDB, cb) {
        if (!(/^Basic /.test(authStr))) {
            RemotingLog.log(2, "BasicWSAuth.validate: authStr does not start with 'Basic '");
            cb("basic authorization error", undefined, false);
            return;
        }
        var b64up = authStr.slice(6).trim();
        var userPassword = btoa(b64up);
        var upa = userPassword.split(":");
        if (!(upa instanceof Array) || upa.length !== 2) {
            RemotingLog.log(2, "BasicWSAuth.validate: upa.length != 2");
            cb("basic authorization error", undefined, false);
            return;
        }
        var username = upa[0];
        var password = upa[1];
        BasicWSAuth.validateLogin(authDB, username, password, cb);
    }
    static validateLogin(authDB, username, password, cb) {
        if (authDB === undefined) {
            BasicWSAuth.doValidate(username, password, cb);
        }
        else {
            BasicWSAuth.doValidateFromDB(authDB, username, password, cb);
        }
    }
    // --------------------------------------------------------------------------
    // doValidate
    //
    static doValidate(username, password, cb) {
        var cmd = WSAuth.wwwRoot + BasicWSAuth.passwordCheck +
            " " + username + " " + password;
        child_process.exec(cmd, function (error, stdout, stderr) {
            if (error === null && stdout.trim() === "yes") {
                RemotingLog.log(3, function () {
                    return "Password Matches! (user=" + username + ")";
                });
                cb(null, username, true);
            }
            else {
                RemotingLog.log(2, function () {
                    return "Password Check Error: " + error +
                        "(user=" + username + ")";
                });
                cb("login error", undefined, false);
            }
        });
    }
    static doValidateFromDB(authDB, username, password, cb) {
        var userHashCollection = authDB.collection("userHash");
        function verifyPwd(err, result) {
            if (err !== null || !(result instanceof Object)) {
                cb("login error", undefined, false);
                return;
            }
            var hash = result.hash;
            if (typeof (hash) !== "string") {
                cb("internal error", undefined, false);
                return;
            }
            var hashComponents = hash.split("\t");
            if (hashComponents.length !== BasicWSAuth.HASH_SECTIONS) {
                cb("internal error", undefined, false);
                return;
            }
            var knownPwdHash = hashComponents[BasicWSAuth.HASH_PBKDF2_INDEX];
            var passwordHash = crypto.
                pbkdf2Sync(password, hashComponents[BasicWSAuth.HASH_SALT_INDEX], Number(hashComponents[BasicWSAuth.HASH_ITERATION_INDEX]), knownPwdHash.length / 2, hashComponents[BasicWSAuth.HASH_ALGORITHM_INDEX]).
                toString('hex');
            var auth = username === hashComponents[BasicWSAuth.HASH_USERNAME_INDEX] &&
                knownPwdHash === passwordHash;
            cb(auth ? null : "login error", username, auth);
        }
        if (userHashCollection) {
            userHashCollection.findOne({ userName: username }, verifyPwd);
        }
        else {
            cb("internal error", undefined, false);
        }
    }
    static addUserNamePasswordEmail(authDB, username, password, email, update, cb) {
        var userHashCollection = authDB.collection("userHash");
        function createHash() {
            var salt = crypto.randomBytes(BasicWSAuth.PBKDF2_SALT_BYTE_SIZE).toString('hex');
            var pwdHash = crypto.
                pbkdf2Sync(password, salt, BasicWSAuth.PBKDF2_ITERATIONS, BasicWSAuth.PBKDF2_KEY_LEN, BasicWSAuth.PBKDF2_HASH_ALGORITHM).toString('hex');
            var hashComponents = [];
            hashComponents[BasicWSAuth.HASH_USERNAME_INDEX] = username;
            hashComponents[BasicWSAuth.HASH_ALGORITHM_INDEX] = BasicWSAuth.PBKDF2_HASH_ALGORITHM;
            hashComponents[BasicWSAuth.HASH_ITERATION_INDEX] = String(BasicWSAuth.PBKDF2_ITERATIONS);
            hashComponents[BasicWSAuth.HASH_SALT_INDEX] = salt;
            hashComponents[BasicWSAuth.HASH_PBKDF2_INDEX] = pwdHash;
            return hashComponents.join("\t");
        }
        if (username.indexOf("\t") !== -1) {
            // Don't allow hash field separation character in user name
            cb("illegal character", undefined, false);
            return;
        }
        if (userHashCollection) {
            var hash = createHash();
            if (update) {
                userHashCollection.update({ userName: username }, { userName: username, hash: hash, email: email }, { upsert: true }, function (err, result) {
                    cb(err, username, err === null);
                });
            }
            else {
                userHashCollection.findOne({ userName: username }, (err, result) => {
                    if (err !== null) {
                        cb(err, undefined, false);
                    }
                    else if (result) {
                        cb("user name already exists", username, false);
                    }
                    else {
                        userHashCollection.insert({ userName: username, hash: hash, email: email }, (err, result) => cb(err, username, err === null));
                    }
                });
            }
        }
        else {
            cb("database error", undefined, false);
        }
    }
    // --------------------------------------------------------------------------
    // getAuthStr (static)
    //
    static getAuthStr(username, password) {
        var userPassword = username + ":" + password;
        var b64up = atob(userPassword);
        var authStr = "Basic " + b64up;
        return authStr;
    }
}
BasicWSAuth.passwordCheck = "/auth/passwordCheck.php";
/* Password hashing, adapted from the php scripts
 *
 * A new password is hashed a number of times with a randomly chosen salt.
 * User name, the chosen algorithm, number of iterations, salt and hash are
 * then stored as the hash (binary values are stored as hex strings).
 *
 * When a user wants to get access, the hash is retrieved, and the entered
 * password is hashed according to the stored parameters. Both username and
 * hash have to be identical in order to get the go-ahead.
 */
// Hash algorithm, nr iterations, key length and salt size can be changed
// without affecting existing hashes. Note that keys are encoded as strings
// of hex digits, so the length of the string is twice that of the buffer.
BasicWSAuth.PBKDF2_HASH_ALGORITHM = "sha512";
BasicWSAuth.PBKDF2_ITERATIONS = 3842;
BasicWSAuth.PBKDF2_SALT_BYTE_SIZE = 56;
BasicWSAuth.PBKDF2_KEY_LEN = 36;
BasicWSAuth.HASH_SECTIONS = 5;
BasicWSAuth.HASH_USERNAME_INDEX = 0;
BasicWSAuth.HASH_ALGORITHM_INDEX = 1;
BasicWSAuth.HASH_ITERATION_INDEX = 2;
BasicWSAuth.HASH_SALT_INDEX = 3;
BasicWSAuth.HASH_PBKDF2_INDEX = 4;
class CookieAuth {
    /// Executes the cookie check command and calls cb(true, username) when the
    /// cookie was verified, or cb(false, undefined) when it wasn't.
    static validate(cookieStr, cb) {
        var cmd = WSAuth.wwwRoot + CookieAuth.cookieCheck + " " + cookieStr;
        RemotingLog.log(3, function () {
            return "validating cookie as '" + cmd + "'";
        });
        child_process.exec(cmd, function (error, stdout, stderr) {
            if (error === null) {
                var username = stdout.trim();
                if (username.length > 0) {
                    RemotingLog.log(3, function () {
                        return "Cookie verified! (user=" + username + ")";
                    });
                    cb(null, username, true);
                    return;
                }
            }
            RemotingLog.log(2, "Cookie was not verified");
            cb("could not verify cookie", undefined, false);
        });
    }
    /// Gets the user name from the document's cookie.    
    /// Returns undefined when it can't.
    static getCookieUserName() {
        var mauthVal = document.cookie.replace(/(?:(?:^|.*;\s*)mauth\s*\=\s*([^;]*).*$)|^.*$/, "$1");
        if (typeof (mauthVal) !== "string" || mauthVal.length === 0) {
            return undefined;
        }
        var decodedMAuth = decodeURIComponent(mauthVal);
        var parts = decodedMAuth.split(":");
        return parts.length < 2 ? undefined : parts[0];
    }
}
CookieAuth.cookieCheck = "/auth/cookieCheck.php";

//# ../formatUpgrade.js:1
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
// The modules in this file implement the upgrade of the format of the
// data stored in the database. When reading the entries, they are passed
// through the 'upgradeFormat()' function of the relevant module
// (depending on the resource). If needed, the format is corrected and
// the function outputs a modified object with the corrected format.
// This can then be further used as if it was received from the database. 
// The entries in the database are not modified.
//
// Upgrade of app state format
//
var AppStateFormatUpgrade;
(function (AppStateFormatUpgrade) {
    // this function takes an object retrieved from the database and
    // returns a corrected version on this object in cases where the
    // format of the object found in the database is no longer up to date.
    // The original object is never modified.
    function upgradeFormat(elementObj) {
        if (!elementObj)
            return elementObj;
        var repairFunctions = [];
        if (repairFunctions.length === 0)
            return elementObj;
        for (var i = 0, l = repairFunctions.length; i < l; ++i)
            elementObj = repairFunctions[i](elementObj);
        return elementObj;
    }
    AppStateFormatUpgrade.upgradeFormat = upgradeFormat;
})(AppStateFormatUpgrade || (AppStateFormatUpgrade = {}));
//
// Upgrade of database metadata format 
//
var MetadataFormatUpgrade;
(function (MetadataFormatUpgrade) {
    // this function takes an object retrieved from the database and
    // returns a corrected version on this object in cases where the
    // format of the object found in the database is no longer up to date.
    // The original object is never modified.
    function upgradeFormat(elementObj) {
        if (!elementObj)
            return elementObj;
        var repairFunctions = [
            addTopMissingValueType
        ];
        for (var i = 0, l = repairFunctions.length; i < l; ++i)
            elementObj = repairFunctions[i](elementObj);
        return elementObj;
    }
    MetadataFormatUpgrade.upgradeFormat = upgradeFormat;
    // In older versions of the metadata, the "type: attributeValue"
    // was missing at the top level of the value field. If needed,
    // this is added by this function.
    function addTopMissingValueType(elementObj) {
        if (!elementObj.value || elementObj.value.type)
            return elementObj;
        var newElementObj = shallowDupObj(elementObj);
        newElementObj.value = {
            type: "attributeValue",
            value: elementObj.value
        };
        return newElementObj;
    }
    // duplicate a single level of the object
    function shallowDupObj(obj) {
        var newObj = {};
        for (var attr in obj)
            newObj[attr] = obj[attr];
        return newObj;
    }
})(MetadataFormatUpgrade || (MetadataFormatUpgrade = {}));

//# ../externalDataSourceAPI.js:1
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
class ExternalDataSource {
    constructor(dataSourceSpec, parameterValues, path) {
        this.dataSourceSpec = dataSourceSpec;
        this.parameterValues = parameterValues;
        this.path = path;
    }
    destroy() {
        throw "do not call";
    }
    getData(cb) {
        throw "do not call";
    }
}
var externalDataSourceClasses = [];
//# ../redshiftExternalDataSource.js:1
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
/// <reference path="externalDataSourceAPI.ts" />
/// <reference path="../feg/utilities.ts" />
/// <reference path="remotingLog.ts" />
let Redshift = require('node-redshift');
// Parse int8, i.e. 8 byte ints, as numbers. For some historical reason, pg (the
// underlying library) doesn't do that, even though it works for numbers 2^63-1.
let types = require('pg').types;
types.setTypeParser(20, function (val) {
    return parseInt(val);
});
/**
 * Performs a single query on a redshift db and stores the data until no more
 * resources share it.
 *
 * The client is ready when "data" and/or "err" have been set.
 */
class RedShiftClient {
    constructor(dataSourceSpec, queryParameters, clientId) {
        this.queryParameters = queryParameters;
        this.clientId = clientId;
        this.nrSharingResources = 0;
        this.dataRevision = Date.now();
        this.id = dataSourceSpec.id;
        this.client = {
            host: dataSourceSpec.hostname,
            port: dataSourceSpec.portNumber === undefined ? 5439 : dataSourceSpec.portNumber,
            database: dataSourceSpec.database,
            user: dataSourceSpec.credentials.username,
            password: dataSourceSpec.credentials.password
        };
        this.query = dataSourceSpec.query;
        let redshiftClient = new Redshift(this.client, { rawConnection: false });
        RemotingLog.log(5, () => "create " + this.id + ": sending query: " + this.query);
        redshiftClient.parameterizedQuery(this.query, dataSourceSpec.queryParameters === undefined ? undefined : this.queryParameters, { raw: true }, (err, data) => {
            RemotingLog.log((err ? 0 : 5), () => this.id + ": received: " +
                (err ? "error " + err.toString() : data.length + " nr rows"));
            this.err = err;
            this.data = err ? [] : data;
            this.setReady();
        });
    }
    static getSharedClient(dataSourceSpec, queryParameters) {
        var clientId = dataSourceSpec.id + ":" + JSON.stringify(queryParameters);
        var client = RedShiftClient.clients[clientId];
        if (client === undefined) {
            client = new RedShiftClient(dataSourceSpec, queryParameters, clientId);
            RedShiftClient.clients[clientId] = client;
        }
        client.nrSharingResources++;
        return client;
    }
    destroy() {
        RemotingLog.log(5, () => "destroy " + this.id);
        delete this.data; // just to be sure
        this.clientId = undefined;
    }
    releaseClient(obj) {
        this.nrSharingResources--;
        if (this.readyQueue !== undefined && obj !== undefined) {
            let index = this.readyQueue.indexOf(obj);
            if (index >= 0) {
                this.readyQueue.splice(index, 1);
            }
        }
        if (this.nrSharingResources === 0) {
            delete RedShiftClient.clients[this.clientId];
            this.destroy();
        }
    }
    isReady(obj) {
        if ("data" in this) {
            return true;
        }
        if (this.readyQueue === undefined) {
            this.readyQueue = [];
        }
        this.readyQueue.push(obj);
        return false;
    }
    setReady() {
        if (this.readyQueue !== undefined) {
            for (var i = 0; i < this.readyQueue.length; i++) {
                this.readyQueue[i].setReady();
            }
            this.readyQueue = undefined;
        }
    }
}
RedShiftClient.clients = {};
class RedShiftExternalDataSource extends ExternalDataSource {
    constructor(dataSourceSpec, parameterValues, path) {
        super(dataSourceSpec, parameterValues, path);
        this.delayedCallback = undefined;
        this.client = RedShiftClient.getSharedClient(dataSourceSpec, parameterValues);
    }
    static accepts(dataSourceSpec, path) {
        return dataSourceSpec.type === "redshift" &&
            typeof (dataSourceSpec.database) === "string" &&
            path.length <= 1;
    }
    destroy() {
        this.client.releaseClient(this);
        this.client = undefined;
    }
    getData(cb) {
        if (!this.client.isReady(this)) {
            this.delayedCallback = cb;
            return;
        }
        this.delayedCallback = undefined;
        if (this.client.err) {
            cb(this.client.err, undefined, this.client.dataRevision);
        }
        else {
            cb(null, this.extractData(this.client.data), this.client.dataRevision);
        }
    }
    setReady() {
        if (this.delayedCallback !== undefined) {
            this.getData(this.delayedCallback);
        }
    }
    // Extracts data for the current path (can be the top path), and synthesizes
    // the attribute recordId if it doesn't exist.
    extractData(rawData) {
        if (this.path.length === 0) {
            var representativeAV = rawData.length === 0 ? {} : rawData[0];
            var paths = Object.keys(representativeAV).map(attr => [attr]);
            if (!("recordId" in representativeAV)) {
                paths.push(["recordId"]);
            }
            return [{
                    path: this.path,
                    mapping: {
                        rowNr: 0,
                        nrDataElements: rawData.length,
                        firstDataElementId: 0,
                        paths: paths
                    }
                }];
        }
        else {
            var attr = this.path[0];
            var indexedValues;
            var compressedData;
            if (attr === "recordId" && rawData.length > 0 && !(attr in rawData[0])) {
                compressedData = [{ o: 0, v: rawData.map((value, index) => index) }];
            }
            else {
                var columnData = rawData.map(row => row[attr]);
                indexedValues = getUniqueValues(columnData);
                compressedData = compressRawData(columnData, indexedValues);
            }
            return [{
                    path: this.path,
                    indexedValues: indexedValues,
                    pathValuesRanges: compressedData
                }];
        }
    }
}
externalDataSourceClasses.push({
    classConstructor: RedShiftExternalDataSource,
    accepts: RedShiftExternalDataSource.accepts
});

//# persistenceServer.js:1
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
var fs = require("fs");
class RemotingServer {
    constructor(serverParam, dbName, resourceMgr) {
        this.serverParam = serverParam;
        this.dbName = dbName;
        this.resourceMgr = resourceMgr;
        var self = this;
        if (!Authorization.useAuthFiles) {
            this.authDB = mongojs("userAdmin");
            this.userActionLogDB = this.authDB.collection("userLog");
        }
        this.networkServer = new NetworkServer(serverParam, function (networkServer, options, socket, remotingServer, connectionAuthenticated) {
            return new RemotingServerConnection(networkServer, options, socket, remotingServer, self.authDB, connectionAuthenticated);
        }, RemotingServerConnection.validateRequest, this);
    }
    getResourceMgr() {
        return this.resourceMgr;
    }
    getDBName() {
        return this.dbName;
    }
    shutdown() {
        if (this.authDB !== undefined) {
            this.authDB.close();
            this.authDB = undefined;
        }
        this.networkServer.shutdown();
        this.networkServer = undefined;
    }
    logUserAction(type, msg) {
        if (this.userActionLogDB) {
            this.userActionLogDB.insert(Object.assign({}, msg, { type: type, time: new Date(), db: this.dbName }));
        }
    }
}
function readExternalDataSourceConfig(fileName) {
    var configText = fs.readFileSync(fileName).toString();
    var config = JSON.parse(configText);
    if (!(config instanceof Object) || isNaN(config.length)) {
        throw "not a proper config file";
    }
    return config;
}
function main() {
    var server = undefined;
    var resourceMgr = undefined;
    var addedLocalServerParam = undefined;
    var localServer = undefined;
    var edsConfig = [];
    gArgParser = getArgParser();
    gMaxMessageSize = gArgParser.getArg("gMaxMessageSize", gMaxMessageSize);
    baseDelay = gArgParser.getArg("baseDelay", baseDelay);
    sizeDependentDelay = gArgParser.getArg("sizeDependentDelay", sizeDependentDelay);
    directoryListingAllowed = gArgParser.getArg("directoryListingAllowed", directoryListingAllowed);
    var port = gArgParser.getArg("port", 8080);
    var protocol = gArgParser.getArg("protocol", "wss");
    var dbName = gArgParser.getArg("mongodb", "cdlpersistence");
    gRemoteDebug = gArgParser.getArg("debugRemote", 4);
    if (typeof (gRemoteDebug) !== "number") {
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
    var os = require("os");
    var hostname = gArgParser.getArg("host", os.hostname());
    var homeDir = process.env.HOME;
    var myCertDir = homeDir + "/myCertificate";
    var myKeyPath = myCertDir + "/" + hostname + ".key";
    var myCertPath = myCertDir + "/" + hostname + ".crt";
    var keyPath = gArgParser.getArg("keyFile", myKeyPath);
    var certPath = gArgParser.getArg("certificateFile", myCertPath);
    var externalDataSourceConfigFileName = gArgParser.getArg("externalDataSourceConfig", "");
    RemotingLog.log(2, "keyFile = " + keyPath + ", certFile = " + certPath);
    var baseAuthDir = gArgParser.getArg("baseAuthDir", "/var/www");
    WSAuth.wwwRoot = baseAuthDir;
    var authRootDir = gArgParser.getArg("authRootDir", undefined);
    if (typeof (authRootDir) !== "undefined") {
        WSAuth.wwwRoot = authRootDir;
    }
    RemotingLog.log(3, "WSAuth.wwwRoot set to '" + WSAuth.wwwRoot + "'");
    var serverParam = {
        protocol: protocol,
        port: port,
        key: protocol === "wss" ? fs.readFileSync(keyPath) : undefined,
        certificate: protocol === "wss" ? fs.readFileSync(certPath) : undefined,
        fileServer: gArgParser.getArg("http", true),
        localMode: false
    };
    var localMode = gArgParser.getArg("localMode", false);
    if (localMode !== false) {
        if (localMode === true) {
            serverParam.localMode = true;
        }
        else if (localMode !== false) {
            RemotingLog.log(0, "Please set 'localMode' to 'true' or 'false'");
            process.exit(1);
        }
    }
    if (localMode === false) {
        var addedLocalPort = gArgParser.getArg("addLocalPort", undefined);
        if (isNaN(Number(addedLocalPort))) {
            addedLocalPort = undefined;
        }
        else {
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
    function startServer() {
        resourceMgr = new ResourceMgr(dbName);
        resourceMgr.externalDataSources = edsConfig;
        server = new RemotingServer(serverParam, dbName, resourceMgr);
        if (addedLocalServerParam !== undefined) {
            localServer = new RemotingServer(addedLocalServerParam, dbName, resourceMgr);
        }
    }
    function stopServer() {
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
        }
        catch (e) {
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
