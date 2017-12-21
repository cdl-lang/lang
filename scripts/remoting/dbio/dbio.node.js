//# dbio.template:1
//# ../../feg/systemEvents.js:1
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
//# ../../feg/cdl.js:1
/// <reference path="utilities.ts" />
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
//# ../../feg/elementReference.js:1
/// <reference path="evaluationNode.apply.ts" />
/// <reference path="cdl.ts" />
/// <reference path="utilities.ts" />
class ValueReference extends NonAV {
}
class ElementReference extends ValueReference {
    constructor(element) {
        super();
        this.element = element;
    }
    getElement() {
        return this.element;
    }
    match(v) {
        return this.isEqual(v);
    }
    isEqual(v) {
        if (v instanceof ElementReference) {
            var er = v;
            return this.element === er.element;
        }
        return false;
    }
    copy() {
        return new ElementReference(this.element);
    }
    stringify() {
        return "@" + this.element;
    }
    toJSON() {
        return "new ElementReference(\"" + this.element + "\")";
    }
    toCdl() {
        return "@" + this.element;
    }
    typeName() {
        return "elementReference";
    }
    // an element-id is marshalled by specifying its templateId/indexId,
    //  as these are the components which can be translated from one agent to
    //  another
    marshalValue(xdr) {
        var paidEntry = gPaidMgr.getAreaEntry(this.element);
        // this call ensures that 'templateId's definition is made
        //  available to the peer
        var templateId = xdr.xdrTemplateId(paidEntry.templateId);
        // this call ensures that 'indexId's definition is made
        //  available to the peer
        var indexId = xdr.xdrIndexId(paidEntry.indexId);
        return {
            type: "elementReference",
            templateId: templateId,
            indexId: indexId
        };
    }
    // craete a new ElementReference instance according to 'obj'
    static unmarshalValue(obj, xdr) {
        // translate templateId to the local value
        var templateId = xdr.xdrTemplateId(obj.templateId);
        // translate indexId to the local value
        var indexId = xdr.xdrIndexId(obj.indexId);
        // create the area-id
        var areaId = gPaidMgr.getAreaId(templateId, indexId);
        return new ElementReference(areaId);
    }
    compare(v) {
        return this.element === v.element ? 0 : this.element < v.element ? -1 : 1;
    }
}
class DefunReference extends ValueReference {
    constructor(defun) {
        super();
        this.defun = defun;
    }
    typeName() {
        return "defunReference";
    }
    isEqual(v) {
        if (v instanceof DefunReference) {
            return this.defun.isEqual(v.defun);
        }
        return false;
    }
    copy() {
        return new DefunReference(this.defun);
    }
    stringify() {
        return this.defun.prototype.toFullString();
    }
    toCdl() {
        return this;
    }
    toJSON() {
        return "defun(" + this.defun.prototype.idStr() + ")";
    }
    match(v) {
        return this === v;
    }
    marshalValue(xdr) {
        Utilities.error("marshalling a defun is not supported");
        return undefined;
    }
    static unmarshalValue(obj, xdr) {
        Utilities.error("unmarshalling a defun is not supported");
        return undefined;
    }
    compare(v) {
        return 0; // TODO
    }
}
//# ../../feg/paidMgr.js:1
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
//# ../../feg/xdr.js:1
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
//# ../../feg/stringparser.js:1
class ParseTree {
}
class ParseResult {
}
class StringParseFormula {
    parse(formula) {
        var pos = 0;
        function skip_spaces() {
            while (pos < formula.length && formula[pos] === ' ') {
                pos++;
            }
        }
        function parse_arguments(head) {
            var args = [];
            pos++;
            skip_spaces();
            if (formula[pos] !== ')') {
                pos--;
                do {
                    pos++;
                    var arg = addOp();
                    args.push(arg.tree);
                    if (arg.success !== true) {
                        return {
                            success: arg.success,
                            tree: { head: head, arguments: args },
                            error: arg.error
                        };
                    }
                    skip_spaces();
                } while (formula[pos] === ',');
            }
            return {
                success: true,
                tree: { head: head, arguments: args }
            };
        }
        function atom() {
            var res;
            var matches;
            skip_spaces();
            if (formula[pos] === '-') {
                pos++;
                res = atom();
                return {
                    success: res.success,
                    tree: { head: "unaryMinus", arguments: [res.tree] },
                    error: res.error
                };
            }
            else if (formula[pos] === '(') {
                pos++;
                res = addOp();
                skip_spaces();
                if (pos >= formula.length) {
                    if (res.success === true) {
                        res.success = undefined;
                    }
                }
                else if (formula[pos] === ')') {
                    pos++;
                }
                else {
                    if (res.success !== false) {
                        res.success = false;
                        res.error = "missing right parenthesis";
                    }
                }
                return res;
            }
            else if ((matches = StringParseFormula.attributeRegExp.exec(formula.substr(pos))) !== null) {
                var attr = matches[0];
                if (attr[0] === '"' || attr[0] === "'") {
                    attr = attr.substr(1, attr.length - 2).replace(/\\(.)/g, "$1");
                }
                pos += matches[0].length;
                skip_spaces();
                if (pos < formula.length && formula[pos] === '(') {
                    if (!(attr in StringParseFormula.knownFunctions)) {
                        return {
                            success: false,
                            tree: { head: attr },
                            error: "unknown function"
                        };
                    }
                    res = parse_arguments(attr);
                    if (pos >= formula.length) {
                        if (res.success === true) {
                            res.success = undefined;
                        }
                    }
                    else if (formula[pos] === ')') {
                        pos++;
                        if (StringParseFormula.knownFunctions[attr] >= 0 &&
                            (res.tree.arguments === undefined ||
                                res.tree.arguments.length !== StringParseFormula.knownFunctions[attr])) {
                            res.success = false;
                            res.error = "wrong number of arguments to function";
                        }
                    }
                    else {
                        if (res.success !== false) {
                            res.success = false;
                            res.error = "closing parenthesis expected";
                        }
                    }
                    return res;
                }
                else {
                    return {
                        success: true,
                        tree: { head: attr }
                    };
                }
            }
            else if ((matches = StringParseFormula.numberRegExp.exec(formula.substr(pos))) !== null) {
                var num = Number(matches[0]);
                pos += matches[0].length;
                skip_spaces();
                if (formula[pos] in StringParseFormula.suffixes) {
                    num *= StringParseFormula.suffixes[formula[pos]];
                    pos++;
                }
                return {
                    success: !isNaN(num),
                    tree: { head: num },
                    error: isNaN(num) ? "incorrectly formatted number" : undefined
                };
            }
            else {
                return {
                    success: pos === formula.length ? undefined : false,
                    tree: { head: num },
                    error: pos === formula.length ? "formula incomplete" : "number, name or parenthesis expected"
                };
            }
        }
        function powOp() {
            var res = atom(), arg;
            skip_spaces();
            while (res.success && pos < formula.length) {
                var operator = formula[pos];
                switch (operator) {
                    case "^":
                        pos++;
                        arg = atom();
                        res = {
                            success: arg.success,
                            tree: { head: operator, arguments: [res.tree, arg.tree] },
                            error: arg.error
                        };
                        skip_spaces();
                        break;
                    default:
                        return res;
                }
            }
            return res;
        }
        function multOp() {
            var res = powOp(), arg;
            skip_spaces();
            while (res.success && pos < formula.length) {
                var operator = formula[pos];
                switch (operator) {
                    case "*":
                    case "/":
                    case "%":
                        pos++;
                        arg = powOp();
                        res = {
                            success: arg.success,
                            tree: { head: operator, arguments: [res.tree, arg.tree] },
                            error: arg.error
                        };
                        skip_spaces();
                        break;
                    default:
                        return res;
                }
            }
            return res;
        }
        function addOp() {
            var res = multOp(), arg;
            skip_spaces();
            while (res.success && pos < formula.length) {
                var operator = formula[pos];
                switch (operator) {
                    case "+":
                    case "-":
                        pos++;
                        arg = multOp();
                        res = {
                            success: arg.success,
                            tree: { head: operator, arguments: [res.tree, arg.tree] },
                            error: arg.error
                        };
                        skip_spaces();
                        break;
                    default:
                        return res;
                }
            }
            return res;
        }
        if (typeof (formula) !== "string") {
            return {
                success: false,
                tree: {
                    head: undefined,
                    result: undefined
                },
                error: "not a string"
            };
        }
        var res = addOp();
        skip_spaces();
        return pos === formula.length ? res :
            res.success ? { success: false, tree: res.tree, error: "end of expression expected" } :
                res;
    }
}
StringParseFormula.attributeRegExp = /^(([a-zA-Z_$][a-zA-Z_$0-9]*)|("([^\\"]|\\.)+")|('([^\\']|\\.)+'))/;
StringParseFormula.numberRegExp = new RegExp('^[+-]?([0-9]+(\\.[0-9]*)?|[0-9]*\\.[0-9]+)([Ee][0-9]+)?');
StringParseFormula.suffixes = {
    K: 1e3,
    k: 1e3,
    M: 1e6,
    m: 1e6,
    B: 1e9,
    b: 1e9,
    T: 1e12,
    t: 1e12
};
StringParseFormula.knownFunctions = {
    "ln": 1,
    "log10": 1,
    "logb": 2,
    "sqrt": 1,
    "abs": 1,
    "pi": 0,
    "e": 0,
    "exp": 1,
    "avg": -1,
    "sum": -1,
    "min": -1,
    "max": -1,
    "year": 1,
    "quarter": 1,
    "month": 1,
    "dayOfWeek": 1,
    "dayOfMonth": 1,
    "hour": 1,
    "minute": 1,
    "second": 1
};
/**
 * A parser for basic CDL values: numbers, strings, AVs with basic CDL values and
 * the o() and r() functions.
 *
 * @class StringParseCDLValue
 * @implements {StringParser}
 */
class StringParseCDLValue {
    parse(cdlString) {
        var pos = 0;
        function skip_spaces() {
            while (pos < cdlString.length && cdlString[pos] === ' ') {
                pos++;
            }
        }
        function parse_arguments(head) {
            var args = [];
            pos++;
            skip_spaces();
            if (cdlString[pos] !== ')') {
                pos--;
                do {
                    pos++;
                    var arg = expression();
                    args.push(arg.tree);
                    if (arg.success !== true) {
                        return {
                            success: arg.success,
                            tree: { head: head, arguments: args },
                            error: arg.error
                        };
                    }
                    skip_spaces();
                } while (cdlString[pos] === ',');
            }
            return {
                success: true,
                tree: {
                    head: head,
                    arguments: args
                }
            };
        }
        function parse_av() {
            var args = [];
            var result = {};
            pos++;
            skip_spaces();
            if (cdlString[pos] !== ')') {
                pos--;
                do {
                    pos++;
                    skip_spaces();
                    var matches = StringParseFormula.attributeRegExp.exec(cdlString.substr(pos));
                    if (matches === null) {
                        return {
                            success: false,
                            tree: { head: undefined },
                            error: "attribute expected"
                        };
                    }
                    var attr = matches[0];
                    if (attr[0] === '"' || attr[0] === "'") {
                        attr = attr.substr(1, attr.length - 2).replace("\\\\", "\\");
                    }
                    pos += matches[0].length;
                    skip_spaces();
                    if (cdlString[pos] !== ":") {
                        return {
                            success: false,
                            tree: { head: undefined },
                            error: "colon expected"
                        };
                    }
                    pos++;
                    skip_spaces();
                    var arg = expression();
                    args.push(arg.tree);
                    if (arg.success !== true) {
                        return {
                            success: arg.success,
                            tree: { head: "", arguments: args },
                            error: arg.error
                        };
                    }
                    result[attr] = arg.tree.result;
                    skip_spaces();
                } while (cdlString[pos] === ',');
            }
            return {
                success: true,
                tree: {
                    head: "",
                    arguments: args,
                    result: result
                }
            };
        }
        function expression() {
            var res;
            var matches;
            skip_spaces();
            if (pos < cdlString.length && cdlString[pos] === '{') {
                // AV object
                res = parse_av();
                if (pos >= cdlString.length) {
                    if (res.success === true) {
                        res.success = undefined;
                    }
                }
                else if (cdlString[pos] === '}') {
                    pos++;
                }
                else {
                    if (res.success !== false) {
                        res.success = false;
                        res.error = "closing brace expected";
                    }
                }
                return res;
            }
            else if ((matches = StringParseCDLValue.identifierRegExp.exec(cdlString.substr(pos))) !== null) {
                // Constant identifier: true, false
                // or function application: o(1, r(5, 10))
                var id = matches[0];
                pos += id.length;
                skip_spaces();
                if (id === "true" || id === "false") {
                    return {
                        success: true,
                        tree: {
                            head: id,
                            result: id === "true"
                        }
                    };
                }
                else if (id === "_") {
                    return {
                        success: true,
                        tree: {
                            head: id,
                            result: _
                        }
                    };
                }
                else if (pos < cdlString.length && cdlString[pos] === '(') {
                    var resultFunc = StringParseCDLValue.knownFunctions[id];
                    if (resultFunc === undefined) {
                        return {
                            success: false,
                            tree: { head: id },
                            error: "unknown function: " + id
                        };
                    }
                    res = parse_arguments(id);
                    if (pos >= cdlString.length) {
                        if (res.success === true) {
                            res.success = undefined;
                        }
                    }
                    else if (cdlString[pos] === ')') {
                        pos++;
                        res.tree.result = resultFunc(res.tree.arguments);
                    }
                    else {
                        if (res.success !== false) {
                            res.success = false;
                            res.error = "closing parenthesis expected";
                        }
                    }
                    return res;
                }
                else {
                    return {
                        success: false,
                        tree: { head: id },
                        error: "function call expected"
                    };
                }
            }
            else if ((matches = StringParseCDLValue.numberRegExp.exec(cdlString.substr(pos))) !== null) {
                // number: result is nunerical value
                var num = Number(matches[0]);
                pos += matches[0].length;
                skip_spaces();
                return {
                    success: !isNaN(num),
                    tree: { head: num, result: num },
                    error: isNaN(num) ? "incorrectly formatted number" : undefined
                };
            }
            else if ((matches = StringParseCDLValue.stringRegExp.exec(cdlString.substr(pos))) !== null) {
                // string: result is string stripped of quotes and extra backslashes
                var str = matches[0];
                pos += str.length;
                skip_spaces();
                return {
                    success: true,
                    tree: {
                        head: str,
                        result: str.substr(1, str.length - 2).replace("\\\\", "\\")
                    }
                };
            }
            else {
                return {
                    success: false,
                    tree: { head: undefined },
                    error: "number, string or function expected"
                };
            }
        }
        if (typeof (cdlString) !== "string") {
            return {
                success: false,
                tree: {
                    head: undefined,
                    result: undefined
                },
                error: "not a string"
            };
        }
        var res = expression();
        skip_spaces();
        return pos === cdlString.length ? res :
            res.success ? { success: false, tree: res.tree, error: "operator expected" } :
                res;
    }
}
StringParseCDLValue.attributeRegExp = /^(([a-zA-Z_$][a-zA-Z_$0-9]*)|("([^\\"]|\\.)+")|('([^\\']|\\.)+'))/;
StringParseCDLValue.identifierRegExp = /^[a-zA-Z_$][a-zA-Z_$0-9]*/;
StringParseCDLValue.stringRegExp = /^(("[^"]*")|(\'[^\']*\'))/;
StringParseCDLValue.numberRegExp = /^[+-]?([0-9]+(\\.[0-9]*)?|[0-9]*\\.[0-9]+)([Ee][0-9]+)?/;
StringParseCDLValue.knownFunctions = {
    o: (elts) => elts.map(elt => elt.result),
    r: (elts) => new RangeValue(elts.map(elt => elt.result), true, true),
    Rcc: (elts) => new RangeValue(elts.map(elt => elt.result), true, true),
    Rco: (elts) => new RangeValue(elts.map(elt => elt.result), true, false),
    Roc: (elts) => new RangeValue(elts.map(elt => elt.result), false, true),
    Roo: (elts) => new RangeValue(elts.map(elt => elt.result), false, false)
};
//# ../../feg/remotePaidInterface.js:1
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
//# ../../feg/watcherProducer.js:1
/// <reference path="result.ts" />
var nextWatcherId = 1025;
function getNextWatcherId() {
    return nextWatcherId++;
}

//# ../serverRuntime.js:1
function scheduleRemotingTask() {
    setImmediate(() => { gRemoteMgr.flush(); });
}

var gErrContext = {
    getErrorContext: function() { return undefined; }
}

var fs = require("fs");
//# ../remotingLog.js:1
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
//# ../wsAuth.js:1
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
//# ../networkConnection.js:1
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
//# ../networkClient.js:1
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
    constructor(serverOptions, connectionOptions) {
        super(connectionOptions);
        var protocol = serverOptions.protocol === "ws" ? "ws" : "wss";
        var hostName = serverOptions.hostName;
        var port = serverOptions.port === undefined ? 8080 : serverOptions.port;
        var path = serverOptions.path === undefined ? "/" : serverOptions.path;
        var requestOptions = {};
        for (var attr in serverOptions) {
            if (attr === "protocol") {
                requestOptions.protocol = (protocol === "ws") ? "http:" : "https:";
            }
            else {
                requestOptions[attr] = serverOptions[attr];
            }
        }
        this.url = protocol + "://" + hostName + ":" + port + path;
        requireWebSockets();
        requireBtoaAtob(); // base64 <-> ascii
        //
        // if options include a username and a password, generate an
        // 'authorization' header
        //
        if ((typeof (serverOptions.username) === "string") &&
            (typeof (serverOptions.password) === "string")) {
            var authStr = BasicWSAuth.getAuthStr(serverOptions.username, serverOptions.password);
            if (typeof (requestOptions.headers) === "undefined") {
                requestOptions.headers = {};
            }
            requestOptions.headers["authorization"] = authStr;
        }
        requestOptions.protocols = ["json"];
        this.requestOptions = requestOptions;
        try {
            RemotingLog.log(1, "new web socket to url: '" + this.url + "'");
            this.connect();
        }
        catch (e) {
            this.connection = undefined;
        }
    }
    destroy() {
        this.disconnect();
    }
    // --------------------------------------------------------------------------
    // connect
    //
    connect() {
        this.connection = runtimeEnvironment.newWebSocket(this, this.url, this.requestOptions);
        this.messageQueue = [];
    }
    disconnect() {
        this.connection.close();
        this.connection = undefined;
    }
}
//# ../remoteMgr.js:1
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
var gRemoteMgr;
function createRemoteMgr() {
    gRemoteMgr = new RemoteMgr();
    gRemoteDebug = gArgParser.getArg("debugRemote", 0);
}
class RemoteMgr {
    constructor() {
        this.nextClientId = 0;
        this.clientById = {};
        this.clientBySpecHash = {};
        this.nextResourceId = 0;
        this.resourceById = {};
        // when this is an object, remotingTask was scheduled, and the object
        //  elements are the clients that have pending messages that should be
        //  sent over the connection
        this.pendingWrite = undefined;
        this.pendingResources = new Set();
        this.reconnectScheduled = undefined;
        this.reconnectDelay = 3000;
        this.terminated = false;
        this.loginStatusUpdateClients = {};
        this.loginCounter = 0;
    }
    hasPendingResources() {
        return this.pendingResources.size > 0;
    }
    subscribe(consumer, hostSpec, resourceSpec, xdrFunc, identStrFunc, consumerIdent) {
        var clientId = this.getClient(hostSpec);
        if (clientId === undefined) {
            return undefined;
        }
        var resource = this.createResource(clientId, resourceSpec, xdrFunc, identStrFunc, consumer, consumerIdent);
        var rId = resource.getId();
        this.pendingResources.add(rId);
        var client = this.clientById[clientId];
        client.subscribe(resource.getId(), resource.getSpec());
        return resource.getId();
    }
    unsubscribe(resourceId) {
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
    /**
     * Logs in for given parameters. Note that the client is released, so
     * a notification will only be given when there is at least one resource
     * connected.
     */
    login(hostSpec, accountInfo) {
        var clientId = this.getClient(hostSpec);
        this.loginCounter++;
        if (clientId !== undefined) {
            var client = this.clientById[clientId];
            client.login(Object.assign({}, accountInfo, { loginSeqNr: this.loginCounter }));
            this.releaseClient(clientId);
        }
    }
    logout(resourceId) {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
        var client = this.clientById[clientId];
        client.logout();
        this.unsubscribe(resourceId);
    }
    createAccount(hostSpec, accountInfo) {
        var clientId = this.getClient(hostSpec);
        this.loginCounter++;
        if (clientId !== undefined) {
            var client = this.clientById[clientId];
            client.createAccount(Object.assign({}, accountInfo, { loginSeqNr: this.loginCounter }));
            this.releaseClient(clientId);
        }
    }
    registerForLoginStatusUpdates(client) {
        this.loginStatusUpdateClients[client.watcherId] = client;
    }
    unregisterForLoginStatusUpdates(client) {
        delete this.loginStatusUpdateClients;
    }
    loginStatusUpdate(username, authenticated, errorMessage, loginSeqNr) {
        if (loginSeqNr === this.loginCounter) {
            for (var clientId in this.loginStatusUpdateClients) {
                var client = this.loginStatusUpdateClients[clientId];
                client.loginStatusUpdate(username, authenticated, errorMessage);
            }
        }
    }
    releaseResource(resourceId) {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
        var client = this.clientById[clientId];
        client.releaseResource(resource.getId());
        this.destroyResource(resource);
        this.releaseClient(clientId);
    }
    getRemotingConnectionById(resourceId) {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
        return this.clientById[clientId];
    }
    getClient(hostSpec) {
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
    releaseClient(clientId) {
        var client = this.clientById[clientId];
        if (client !== undefined) {
            var clientAdminData = client.getAdminData();
            clientAdminData.refCount--;
            if (clientAdminData.refCount <= 0) {
                this.destroyClient(client);
            }
        }
    }
    getHostSpecHash(hostSpec) {
        return hostSpec.protocol + "://" + hostSpec.hostName + ":" + hostSpec.port +
            (hostSpec.path === undefined ? "/" : hostSpec.path);
    }
    createClient(hostSpec, specHash) {
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
    createNetworkClient(hostSpec, specHash, clientAdminData) {
        var options = {
            poolSize: 100,
            poolDelay: 100
        };
        return new RemotingClientConnection(hostSpec, options, this, clientAdminData, gPaidMgr);
    }
    destroyClient(client) {
        var clientAdminData = client.getAdminData();
        client.destroy();
        delete this.clientById[clientAdminData.id];
        delete this.clientBySpecHash[clientAdminData.specHash];
    }
    createResource(clientId, resourceSpec, xdrFunc, identStrFunc, consumer, consumerIdent) {
        var rid = this.nextResourceId++;
        var resource = new RemotingResource(rid, resourceSpec, clientId, xdrFunc, identStrFunc, consumer, consumerIdent);
        this.resourceById[rid] = resource;
        return resource;
    }
    destroyResource(resource) {
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
    updateResource(resourceId, elementObj, updateRevision, fullSyncRevision) {
        this.pendingResources.delete(resourceId);
        // calls globalConcludeInitPhaseTask.schedule();
        // in order to move concludeInitiPhaseTesk at the end of the queue
        unsubcribeResourceHook();
        var resource = this.resourceById[resourceId];
        if (resource === undefined) {
            mMessage("RemoteMgr.updateResource: No such resource " + resourceId);
        }
        else {
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
    write(resourceId, ident, value) {
        var resource = this.resourceById[resourceId];
        var clientId = resource.getClientId();
        if (typeof (this.pendingWrite) === "undefined") {
            this.pendingWrite = {};
            scheduleRemotingTask();
        }
        var clientEntry = this.pendingWrite[clientId];
        if (typeof (clientEntry) === "undefined") {
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
    flush() {
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
    getClientConsumerList(client) {
        var consumerList = [];
        var resourceObj = client.getSubscribedResourceObj();
        for (var rid in resourceObj) {
            var resource = this.resourceById[rid];
            var consumer = resource.getConsumer();
            var consumerIdent = resource.getConsumerIdent();
            consumerList.push({ consumer: consumer, ident: consumerIdent });
        }
        return consumerList;
    }
    // --------------------------------------------------------------------------
    // notifyConnectionState
    //
    // notify each of the consumers in 'consumerList' that the connection state
    //  is now 'errorId/errorMessage'
    //
    notifyConnectionState(consumerList, errorId, errorMessage) {
        // to do: delete resources affected by this error from this.pendingResources
        for (var i = 0; i < consumerList.length; i++) {
            var entry = consumerList[i];
            entry.consumer.resourceConnectionStateUpdate(errorId, errorMessage, entry.ident);
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
    resourceUpdateComplete(consumerList, resourceId) {
        for (var i = 0; i < consumerList.length; i++) {
            consumerList[i].consumer.resourceUpdateComplete(resourceId);
        }
    }
    clientOpenCB(client) {
        var consumerList = this.getClientConsumerList(client);
        this.notifyConnectionState(consumerList, 0, "");
    }
    clientCloseCB(client, error) {
        if (this.terminated) {
            return;
        }
        var consumerList = this.getClientConsumerList(client);
        this.notifyConnectionState(consumerList, 1, "connection closed: " +
            ((typeof (error) === "object") ? error.code :
                "(unknown)"));
        client.shutdown("error", true);
        this.scheduleReconnect(client);
    }
    clientErrorCB(client, error) {
        var consumerList = this.getClientConsumerList(client);
        this.notifyConnectionState(consumerList, 1, "connection error");
        client.shutdown("connection error", true);
        this.scheduleReconnect(client);
    }
    terminate(client, reason) {
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
    reloadApplication(client, reason) {
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
    reconnect(reconnectClient) {
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
    scheduleReconnect(client) {
        var that = this;
        function callReconnect() {
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
    resetTemplateIndexIds() {
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
    debugForceClose(timeout) {
        if (!this.clientById) {
            return;
        }
        for (var clientId in this.clientById) {
            this.clientById[clientId].debugForceClose(timeout);
        }
    }
    // This releases the forced closure of all client connections (of this
    // remoting manager). The clients then try to reconnect. 
    debugReleaseForceClose() {
        if (!this.clientById) {
            return;
        }
        for (var clientId in this.clientById) {
            this.clientById[clientId].debugReleaseForceClose();
        }
    }
    static getAppName() {
        if (RemoteMgr.appName === undefined) {
            var argParser = getArgParser();
            var appName = argParser.getAppName();
            var slashIdx = Math.max(appName.lastIndexOf("/"), appName.lastIndexOf("\\"));
            if (slashIdx >= 0) {
                appName = appName.slice(slashIdx + 1);
            }
            if (appName.slice(-8) === ".node.js") {
                appName = appName.slice(0, -8);
            }
            else if (appName.slice(-5) === ".html") {
                appName = appName.slice(0, -5);
            }
            else if (appName.slice(-4) === ".htm") {
                appName = appName.slice(0, -4);
            }
            RemoteMgr.appName = argParser.getArg("appName", appName);
        }
        return RemoteMgr.appName;
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
RemoteMgr.appName = undefined;
class RemotingClientConnection extends NetworkClientConnection {
    constructor(hostSpec, options, remoteMgr, adminData, paidMgr) {
        super(hostSpec, options);
        this.remoteMgr = remoteMgr;
        this.adminData = adminData;
        this.paidMgr = paidMgr;
        // indexed by resource-ids;
        // each resource entry is indexed by elements;
        // each resource-element entry stores the sequence-id that is waiting
        //  remote-server acknowledgedment; the value is the latest 'ackId'
        this.pendingAcknowledge = {};
        // stores the number of elements awaiting acknowledgement (for each
        // resource separately)
        this.nPendingAcknowledge = {};
        this.nextAckId = 1;
        // ClientConnection
        this.subscribedResource = {};
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
    destroy() {
        this.pendingAcknowledge = undefined;
        this.nPendingAcknowledge = undefined;
        this.subscribedResource = undefined;
        this.remoteMgr = undefined;
        super.destroy();
    }
    connect() {
        this.initDef();
        super.connect();
    }
    // --------------------------------------------------------------------------
    // subscribe
    //
    // subscribe with the remote manager for updates on the resource identified by
    //  'resourceSpec', which this client is going to refer to as 'rid'
    //
    subscribe(rid, resourceSpec) {
        var subReqObj = this.subscribedResource[rid] = {
            spec: resourceSpec,
            // revision for which full update was received
            revision: undefined,
            // revision(s) for which write acknowledgements were received
            // but where there are gaps with the update revision.
            // Stored as a array decribing a sequence of ranges.
            // See updateSubscribedResourceRevision() for details
            ackRevision: undefined,
            // When there are acknowledgement revisions in 'ackRevision',
            // the 'ackRevisionByIdent' stores as attributes the identifiers
            // of the objects for which the acknowledgements were received and
            // under each such attribute the highest revision for which it
            // was received. Entries in this table are cleared once 'ackRevision'
            // is cleared (or when an update for a specific identity is
            // received with a higher revision number).
            ackRevisionByIdent: undefined
        };
        this.sendSubscriptionRequest(rid, subReqObj);
    }
    unsubscribe(rid) {
        this.sendUnsubscribeRequest(rid);
        delete this.subscribedResource[rid];
    }
    login(accountInfo) {
        this.sendMessage({
            type: "login",
            username: accountInfo.username,
            password: accountInfo.password,
            loginSeqNr: accountInfo.loginSeqNr
        });
    }
    logout() {
        this.sendMessage({ type: "logout" });
    }
    createAccount(accountInfo) {
        this.sendMessage({
            type: "createAccount",
            username: accountInfo.username,
            password: accountInfo.password,
            email: accountInfo.email,
            loginSeqNr: accountInfo.loginSeqNr
        });
    }
    releaseResource(rid) {
        this.sendReleaseResourceRequest(rid);
        delete this.subscribedResource[rid];
    }
    sendSubscriptionRequest(rid, subReqObj) {
        this.sendMessage({
            type: "subscribe",
            resourceId: rid,
            resourceSpec: subReqObj.spec,
            revision: subReqObj.revision
        });
    }
    sendUnsubscribeRequest(rid) {
        this.sendMessage({
            type: "unsubscribe",
            resourceId: rid
        });
    }
    sendReleaseResourceRequest(rid) {
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
    resubscribe() {
        this.remoteMgr.resetTemplateIndexIds();
        for (var rid in this.subscribedResource) {
            this.sendSubscriptionRequest(Number(rid), this.subscribedResource[rid]);
        }
    }
    getNextAckId() {
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
    resubmitWrite() {
        for (var resourceId in this.pendingAcknowledge) {
            if (this.nPendingAcknowledge[resourceId] === 0) {
                continue;
            }
            var resourceEntry = this.pendingAcknowledge[resourceId];
            var resourceWriteEntry = {};
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
    write(resourceId, elementObj, ackId) {
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
        this.sendMessage({
            type: "write",
            resourceId: resourceId,
            list: writeList
        }, this.writeAckHandler, { resourceId: resourceId, elementObj: elementObj, ackId: ackId });
    }
    // --------------------------------------------------------------------------
    // markWaitingAck
    //
    // mark all of the elements in resourceObj as 'waiting for server ack' with
    //  the specified ackId;
    // for those elements that were not already in that state (because of a previous
    // request that was not yet acknowledged), increment the ack counter
    //
    markWaitingAck(resourceId, resourceObj, ackId) {
        var resourceEntry = this.pendingAcknowledge[resourceId];
        if (resourceEntry === undefined) {
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
    writeAckHandler(arg, status, message) {
        if (status === true) {
            var fullSyncRevision = this.updateSubscribedResourceRevision(arg.resourceId, arg.elementObj, message.revision, true);
            this.writeAcknowledgmentReceived(arg.resourceId, arg.elementObj, arg.ackId, message.info, message.revision, fullSyncRevision);
        }
        else {
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
    writeAcknowledgmentReceived(resourceId, resourceObj, ackId, writeAckInfo, updateRevision, fullSyncRevision) {
        var resourceEntry = this.pendingAcknowledge[resourceId];
        if (resourceEntry === undefined) {
            return;
        }
        var queuedUpdates = undefined;
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
            RemotingLog.log(5, () => "updating resource " + resourceId +
                " after write acknowledgement from client " +
                this.adminData.id + " with full sync revision " +
                fullSyncRevision);
            // use undefined revision, since these updates may have revisions
            // lower than the last revision received
            this.remoteMgr.updateResource(resourceId, queuedUpdates, undefined, fullSyncRevision);
        }
    }
    // --------------------------------------------------------------------------
    // resourceUpdateHandler
    //
    // a message-handler; notify remote-mgr of the changes
    //
    resourceUpdateHandler(message) {
        var resourceId = message.resourceId;
        // the last revision this message covers
        var updateRevision = message.revision;
        var jselement = message.update;
        var elementObj = {};
        var xdr = this.getXDRFunc(XDRDirection.Unmarshal, resourceId);
        if (typeof (xdr) !== "function") {
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
                }
                else if (elem.revision !== undefined &&
                    (queuedUpdate.revision === undefined ||
                        queuedUpdate.revision < elem.revision)) {
                    pending[identStr].queuedUpdate = elem;
                }
            }
            else if (ackRevisionByIdent !== undefined &&
                (identStr in ackRevisionByIdent)) {
                var ackRevision = ackRevisionByIdent[identStr];
                if (elem.revision === undefined || elem.revision <= ackRevision) {
                    continue; // local version more up to date
                }
                else {
                    delete ackRevisionByIdent[identStr];
                    elementObj[identStr] = elem;
                }
            }
            else {
                elementObj[identStr] = elem;
            }
        }
        // 'updateRevision' is the last revision on the server at the time the
        // update was sent. 'fullSyncRevision' is the last revision for which
        // the client is fully synchronized (this includes write
        // acknowledgements for its own writes which do not leave gaps in the
        // revision sequence with updates from the server).
        var fullSyncRevision = this.updateSubscribedResourceRevision(resourceId, elementObj, updateRevision, false);
        RemotingLog.log(5, () => "updating resource " + resourceId +
            " from client " + this.adminData.id +
            " with update revision " + updateRevision +
            " and full sync revision " + fullSyncRevision);
        this.remoteMgr.updateResource(resourceId, elementObj, updateRevision, fullSyncRevision);
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
    resourceInboundProgressHandler(resourceId, sequenceNr, receivedLen, totalLen) {
        // each resource should define its own (optional) handler for
        // the inbound progress
        var resource = this.remoteMgr.resourceById[resourceId];
        if (resource === undefined) {
            this.dlog(2, "RemotingClientConnection." +
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
    resourceOutboundProgressHandler(resourceId, sequenceNr, replyArgs, receivedLen, totalLen) {
        // each resource should define its own (optional) handler for
        // the outbound progress
        var resource = this.remoteMgr.resourceById[resourceId];
        if (resource === undefined) {
            this.dlog(2, "RemotingClientConnection." +
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
        resource.outboundProgressUpdate(identities, elementObj, receivedLen, totalLen);
    }
    // --------------------------------------------------------------------------
    // networkErrorHandler
    //
    // an event handler for 'error'
    //
    networkErrorHandler(error) {
        this.remoteMgr.clientErrorCB(this, error);
    }
    // --------------------------------------------------------------------------
    // networkCloseHandler
    //
    // an event handler for 'close'
    //
    networkCloseHandler(error) {
        this.remoteMgr.clientCloseCB(this, error);
    }
    networkOpenHandler() {
        this.remoteMgr.clientOpenCB(this);
    }
    getSubscribedResourceObj() {
        return this.subscribedResource;
    }
    terminationHandler(message) {
        this.remoteMgr.terminate(this, message.reason);
    }
    reloadHandler(message) {
        this.remoteMgr.reloadApplication(this, message.reason);
    }
    defineHandler(message) {
        var definitionList = message.list;
        if (definitionList instanceof Array) {
            for (var i = 0; i < definitionList.length; i++) {
                var def = definitionList[i];
                if (isXDRTemplateDefinition(def)) {
                    this.remotePaidMgr.addRemoteTemplateDefinition(def);
                }
                else if (isXDRIndexDefinition(def)) {
                    this.remotePaidMgr.addRemoteIndexDefinition(def);
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
    loginStatusHandler(message) {
        this.remoteMgr.loginStatusUpdate(message.username, message.authenticated, message.reason, message.loginSeqNr);
    }
    // Called upon (re)connection; should clear transmitted ids?
    initDef() {
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
    updateSubscribedResourceRevision(resourceId, elementObj, revision, isWriteAck) {
        if (revision === undefined || !(resourceId in this.subscribedResource)) {
            return undefined;
        }
        // add the last revision updated to the subscribed resource
        var resourceSpec = this.subscribedResource[resourceId];
        var elemId;
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
                }
                else {
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
            }
            else {
                // there is a gap, add revision at end of write acknowledged
                // revision list
                var lastAckRevisionPos = ackRevision.length - 1;
                if (revision - 1 === ackRevision[lastAckRevisionPos]) {
                    ackRevision[lastAckRevisionPos] = revision;
                }
                else if (revision > ackRevision[lastAckRevisionPos]) {
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
        for (var i = resourceSpec.ackRevision.length - 2; i >= 0; i -= 2) {
            if (resourceSpec.ackRevision[i] >= revision - 1) {
                // revision update reached this acknowledgement revision range,
                // so up to date up to the end of this range
                resourceSpec.revision = resourceSpec.ackRevision[i + 1];
                // and can remove this range (including all preceeding ranges)
                if (i === resourceSpec.ackRevision.length - 2) {
                    resourceSpec.ackRevision = undefined;
                    resourceSpec.ackRevisionByIdent = undefined;
                }
                else {
                    resourceSpec.ackRevision.splice(0, i + 2);
                }
                break;
            }
        }
        return resourceSpec.revision;
    }
    getAdminData() {
        return this.adminData;
    }
    getTemplateIndexAdmin() {
        return this.remotePaidMgr;
    }
    getXDRFunc(dir, resourceId) {
        var resource = this.remoteMgr.resourceById[resourceId];
        var xdrFunc = resource.getXdrFunc();
        var xdr = new AgentXDR(dir, this.remotePaidMgr);
        return function (elem) {
            return xdrFunc(elem, xdr);
        };
    }
    getIdentStrFunc(resourceId) {
        var resource = this.remoteMgr.resourceById[resourceId];
        return resource === undefined ? undefined : resource.getIdentStrFunc();
    }
    resetTemplateIndexIds() {
        this.remotePaidMgr.resetChannel();
    }
    // forces the connection to close, as if it was closed as a result of
    // communication loss or the server dying.
    debugForceClose(timeout) {
        this.debugRemainClosed = true;
        this.closeHandler({ code: "debug forced close" });
        if (timeout) {
            var _self = this;
            function releaseForceClose() {
                _self.debugReleaseForceClose();
            }
            setTimeout(releaseForceClose, timeout);
        }
    }
    // Releases the forced closure of the connection (when forced by the function
    // above).
    debugReleaseForceClose() {
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
function debugForceClose(timeout) {
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
    constructor(id, spec, clientId, xdrFunc, identStrFunc, consumer, consumerIdent) {
        this.id = id;
        this.spec = spec;
        this.clientId = clientId;
        this.xdrFunc = xdrFunc;
        this.identStrFunc = identStrFunc;
        this.consumer = consumer;
        this.consumerIdent = consumerIdent;
        /**
         * last revision of the resource received
         *
         * @type {number}
         * @memberof RemotingResource
         */
        this.revision = undefined;
    }
    destroy() {
    }
    getId() {
        return this.id;
    }
    getSpec() {
        return this.spec;
    }
    update(elementObj, updateRevision, fullSyncRevision) {
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
            }
            else if (fullSyncRevision !== undefined &&
                fullSyncRevision > updateRevision) {
                this.revision = fullSyncRevision;
            }
            else {
                this.revision = updateRevision;
            }
        }
        this.consumer.resourceUpdate(elementObj, this.consumerIdent, updateRevision);
    }
    inboundProgressUpdate(sequenceNr, receivedLen, totalLen) {
        if (this.consumer.inboundProgressUpdate !== undefined) {
            this.consumer.inboundProgressUpdate(sequenceNr, receivedLen, totalLen);
        }
    }
    // 'identities' is an array containing the identities of the objects
    // sent in the outbound message. These are the attributes of the object
    // 'elementObj' which is the original object from which the message was
    // created.
    outboundProgressUpdate(identities, elementObj, receivedLen, totalLen) {
        if (this.consumer.outboundProgressUpdate !== undefined) {
            this.consumer.outboundProgressUpdate(identities, elementObj, receivedLen, totalLen);
        }
    }
    getElement(eid) {
        return this.element[eid];
    }
    getClientId() {
        return this.clientId;
    }
    getXdrFunc() {
        return this.xdrFunc;
    }
    getIdentStrFunc() {
        return this.identStrFunc;
    }
    getConsumer() {
        return this.consumer;
    }
    getConsumerIdent() {
        return this.consumerIdent;
    }
    terminate(reason) {
        this.consumer.resourceConnectionStateUpdate(2, reason, this.consumerIdent);
    }
}
//# ../cmdClient/appStateCmdClient.js:1
/// <reference path="../../feg/externalTypes.basic.d.ts" />
/// <reference path="../../feg/globals.ts" />
/// <reference path="../memoryXdr.ts" />
/// <reference path="../../feg/xdr.ts" />
/**
 * Takes a single subscription on a persistence server and repeats the resource
 * updates to all subscribed clients. Assumes all clients have the same paid
 * administration.
 *
 * @class ServerMultiplexer
 * @implements {RemoteResourceUpdate}
 */
class ServerMultiplexer {
    constructor() {
        this.watcherId = getNextWatcherId();
        this.appStateSpec = undefined;
        this.serverSpec = undefined;
        this.serverId = undefined;
        this.exitOnError = true;
        this.clients = new Map();
        this.nextClientId = 1;
    }
    initAppStateSpec() {
        this.appStateSpec = {
            type: "appState",
            app: gArgParser.getArg("appName", "<none>"),
            owner: gArgParser.getArg("owner", "anonymous")
        };
    }
    initRemote(defaultOpts = {}) {
        var port = gArgParser.getArg("port", defaultOpts.port || 8080);
        var protocol = gArgParser.getArg("protocol", defaultOpts.protocol || "wss");
        var serverAddress = gArgParser.getArg("server", defaultOpts.server || "127.0.0.1");
        var caPath = gArgParser.getArg("cacert", defaultOpts.cacert || "certutil/rootCA.pem");
        var caCert = protocol === "wss" ? fs.readFileSync(caPath) : undefined;
        var username = gArgParser.getArg("user", defaultOpts.user || undefined);
        var password = gArgParser.getArg("password", defaultOpts.password || undefined);
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
    getServerDBStr() {
        return this.serverSpec.protocol + "://" + this.appStateSpec.owner +
            "@" + this.serverSpec.hostName + ":" + this.serverSpec.port +
            "/" + this.appStateSpec.app;
    }
    subscribeServer() {
        this.serverId = gRemoteMgr.subscribe(this, this.serverSpec, this.appStateSpec, XDR.xdrAppStateElement, CmdClient.getIdentString, "remoteServer");
    }
    /// This function gets called on a change in app-state and needs to be
    /// implemented in the derived class.
    resourceUpdate(elementObj, consumerIdent) {
        this.clients.forEach(client => {
            client.resourceUpdate(elementObj, consumerIdent);
        });
    }
    allRequestsAcknowledged() {
        this.clients.forEach(client => {
            client.allRequestsAcknowledged();
        });
    }
    // handle additional information provided by the write acknowledgement
    writeAckInfoUpdate(resourceId, writeAckInfo) {
    }
    resourceConnectionStateUpdate(errorId, errorMessage, ident) {
        if (errorId !== 0) {
            console.log("connectionStateUpdate: error(" + errorId + "): " + errorMessage);
            if (this.exitOnError) {
                process.exit(1);
            }
        }
    }
    subscribe(client) {
        var clientId = this.nextClientId++;
        if (this.serverId === undefined) {
            this.subscribeServer();
        }
        this.clients.set(clientId, client);
        return clientId;
    }
    set(ident, value) {
        gRemoteMgr.write(this.serverId, ident, value);
    }
    signalTermination(reason) {
        throw new Error('Method not implemented.');
    }
    getTemplateIndexAdmin() {
        var tiic = undefined;
        this.clients.forEach(function (client) {
            assert(false, "what are we doing here?");
        });
        return tiic;
    }
    getTemplateIndexIdUpdates() {
        return undefined;
    }
    resetTemplateIndexIds() {
    }
    defineRemoteTemplateIndexIds(definitionList) {
    }
    loginStatusUpdate(username, authenticated, errorMessage) {
        this.clients.forEach(function (client) {
            client.loginStatusUpdate(username, authenticated, errorMessage);
        });
    }
    resourceUpdateComplete(resourceId) {
        this.clients.forEach(function (client) {
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
class CmdClient {
    constructor() {
        this.watcherId = getNextWatcherId();
    }
    initFile(argPath = undefined) {
        var path = gArgParser.getArg("path", argPath);
        if (!path) {
            console.log("Please specify file path");
            process.exit(0);
        }
        this.fileSpec = {
            path: path
        };
    }
    getFileDBStr() {
        return this.fileSpec.path;
    }
    static getIdentString(appStateElem) {
        return AppStateIdentifier.getHashStr(appStateElem.ident);
    }
    writeFile(obj) {
        var bytes = JSON.stringify(obj, undefined, this.stringifySpacer);
        try {
            fs.writeFileSync(this.fileSpec.path, bytes, { encoding: "utf8" });
        }
        catch (ex) {
            console.error("Writing to file '" + this.fileSpec.path + "' failed");
            console.error(ex);
        }
    }
    readFile() {
        var obj = undefined;
        try {
            var bytes = fs.readFileSync(this.fileSpec.path, "utf8");
            if (bytes) {
                obj = JSON.parse(bytes);
            }
        }
        catch (ex) {
            console.log("Reading from file '" + this.fileSpec.path + "' failed");
            console.error(ex);
        }
        return obj;
    }
    unset(ident) {
        this.set(ident, xdrDeleteIdent);
    }
    set(ident, value) {
        serverMultiplexer.set(ident, value);
    }
    subscribeServer() {
        this.multiplexerId = serverMultiplexer.subscribe(this);
    }
    // Functions that should be implemented!
    getTemplateIndexAdmin() {
        throw new Error("Method not implemented.");
    }
    getTemplateIndexIdUpdates() {
        throw new Error("Method not implemented.");
    }
    resetTemplateIndexIds() {
        throw new Error("Method not implemented.");
    }
    defineRemoteTemplateIndexIds(definitionList) {
        throw new Error("Method not implemented.");
    }
    resourceConnectionStateUpdate(errorId, errorMessage, ident) {
        throw new Error("Method not implemented.");
    }
    writeAckInfoUpdate(resourceId, writeAckInfo) {
        throw new Error("Method not implemented.");
    }
    signalTermination(reason) {
        throw new Error("Method not implemented.");
    }
    loginStatusUpdate(username, authenticated) {
    }
    resourceUpdateComplete(resourceId) {
    }
}
//# ../cmdClient/singleElementCmdClient.js:1
/// <reference path="appStateCmdClient.ts" />
/// <reference path="../../feg/paidMgrInterface.ts" />
class SingleElementCmdClient extends CmdClient {
    constructor(paidMgr) {
        super();
        this.paidMgr = paidMgr;
        this.cachedIdent = undefined;
    }
    cacheElementIdent() {
        if (this.cachedIdent !== undefined) {
            return;
        }
        // successively generate template and index identifiers for the
        //  areas in elementConf.areaLineage[]
        var parentTemplateId;
        var parentIndexId;
        parentTemplateId = this.paidMgr.getScreenAreaTemplateId();
        parentIndexId = this.paidMgr.getScreenAreaIndexId();
        for (var i = 0; i < this.elementConf.areaLineage.length; i++) {
            var entry = this.elementConf.areaLineage[i];
            var childName = entry.name;
            var childType = entry.type;
            var referredId = undefined; // not suppported
            var templateId = this.paidMgr.getTemplateByEntry(parentTemplateId, childType, childName, referredId);
            if (childType === "intersection") {
                console.log("SingleElementCmdClient: intersections are not supported");
                return;
            }
            if (childType === "set") {
                var dataIdentity = entry["index"];
                var referredIndexId = undefined;
                var indexId = this.paidMgr.getIndexByEntry(parentIndexId, dataIdentity, referredIndexId);
            }
            else {
                indexId = parentIndexId;
            }
            parentTemplateId = templateId;
            parentIndexId = indexId;
        }
        var appStateIdent = new AppStateIdentifier(parentTemplateId, parentIndexId, "context," + this.elementConf.path);
        this.cachedIdent = appStateIdent;
    }
    resourceUpdate(elementObj, resourceIdent) {
        for (var attr in elementObj) {
            var elem = elementObj[attr];
            var ident = elem.ident;
            var value = elem.value;
            var templateId = ident.templateId;
            var indexId = ident.indexId;
            var path = ident.path;
            if (this.isElementPath(path) &&
                this.isElementTemplateId(templateId) &&
                this.isElementIndexId(indexId)) {
                this.elementUpdate(value);
                break;
            }
        }
    }
    // Called when all messages have been acknowledged. No need for action here.
    allRequestsAcknowledged() {
    }
    isElementPath(path) {
        this.cacheElementIdent();
        return this.cachedIdent !== undefined && this.cachedIdent.path === path;
    }
    isElementTemplateId(templateId) {
        this.cacheElementIdent();
        return this.cachedIdent !== undefined && this.cachedIdent.templateId === templateId;
    }
    isElementIndexId(indexId) {
        this.cacheElementIdent();
        return this.cachedIdent !== undefined && this.cachedIdent.indexId === indexId;
    }
    writeElement(elemValue) {
        this.cacheElementIdent();
        if (this.cachedIdent === undefined) {
            console.log("SingleElementCmdClient.writeElement: " +
                "element identifier unknown (write ignored)");
            return;
        }
        this.set(this.cachedIdent, elemValue);
    }
}
//# ../memoryXdr.js:1
/// <reference path="../feg/elementReference.ts" />
/// <reference path="../feg/utilities.ts" />
/// <reference path="remotingLog.ts" />
/// <reference path="../feg/paidMgrInterface.ts" />
//  this file implements xdr'ing from/into a memory buffer. this can be used
//   to alllow xdr'ing from/into a file.
//
// A MemoryXDR implements the interface 'RemotingConnectionDefinition'.
// It may be used as a substitute for the connection when constructing an XDR
//  object.
// When marshallilng, the templates and indices are available using
//  MemoryXDR.getTemplateList() and MemoryXDR.getIndexList(), following
//  data conversion.
//
// When unmarshalling, MemoryXDR.templateDefinitionHandler and
//  MemoryXDR.indexDefinitionHandler should be called with the respective
//  list prior to actual data conversion.
//
// MemoryXDR reads (while marshalling) or reads and writes (while unmarshalling)
//  paidMgr tables.
class MemoryXDR {
    constructor(paidMgr) {
        this.paidMgr = paidMgr;
        this.templateById = [undefined];
        this.indexById = [undefined];
        this.templateMap = { 0: 1 };
        this.indexMap = { 0: 1 };
    }
    /// return the list of templates found to be required for the data marshalled
    /// into this MemoryXDR
    getTemplateList() {
        return this.templateById;
    }
    /// return the list of indices found to be required for the data marshalled
    /// into this MemoryXDR
    getIndexList() {
        return this.indexById;
    }
    /// a template-id was encountered while marshalling, add it to the
    /// 'required templates' list
    defineTemplate(templateId) {
        if (templateId === 1) {
            return 0;
        }
        if (!(templateId in this.templateMap)) {
            var templateEntry = this.paidMgr.getTemplateEntry(templateId);
            if (templateEntry === undefined) {
                RemotingLog.log(1, function () {
                    return "defineTemplate: templateId " +
                        templateId + " lacks a template entry";
                });
                return undefined;
            }
            var parentId = this.defineTemplate(templateEntry.parentId);
            var referredId;
            if (templateEntry.referredId !== undefined &&
                templateEntry.referredId !== null) {
                referredId = this.defineTemplate(templateEntry.referredId);
            }
            var def = {
                parentId: parentId,
                childType: templateEntry.childType,
                childName: templateEntry.childName,
                referredId: referredId
            };
            var mxTemplateId = this.templateById.length;
            this.templateById.push(def);
            this.templateMap[templateId] = mxTemplateId;
        }
        return this.templateMap[templateId];
    }
    /// an index-id was encountered while marshalling, add it to the
    /// 'required indices' list
    defineIndex(indexId) {
        if (indexId === 1) {
            return 0;
        }
        if (!(indexId in this.indexMap)) {
            var indexEntry = this.paidMgr.getIndexEntry(indexId);
            if (indexEntry === undefined) {
                RemotingLog.log(1, function () {
                    return "defineIndex: indexId " +
                        indexId + " lacks an index entry";
                });
                return undefined;
            }
            var prefixId = this.defineIndex(indexEntry.prefixId);
            var compose = undefined;
            if (indexEntry.compose !== undefined) {
                compose = this.defineIndex(indexEntry.compose);
            }
            var def = {
                prefixId: prefixId,
                append: indexEntry.append,
                compose: compose
            };
            var mxIndexId = this.indexById.length;
            this.indexById.push(def);
            this.indexMap[indexId] = mxIndexId;
        }
        return this.indexMap[indexId];
    }
    /// an 'external' mxTemplateId was encountered  in the data while unmarshalling,
    /// get its local id (the one in use by this.paidMgr)
    translateTemplate(mxTemplateId) {
        if (mxTemplateId === 0) {
            return 1;
        }
        assert(mxTemplateId in this.templateMap, "templateId must already be known");
        return this.templateMap[mxTemplateId];
    }
    /// an 'external' mxIndexId was encountered  in the data while unmarshalling,
    /// get its local id (the one in use by this.paidMgr)
    translateIndex(mxIndexId) {
        if (mxIndexId === 0) {
            return 1;
        }
        assert(mxIndexId in this.indexMap, "indexId must already be known");
        return this.indexMap[mxIndexId];
    }
    // for each element of 'templateById', find the id used for it by this.paidMgr
    // (might extend this.paidMgr with a new template if it does not yet exist)
    templateDefinitionHandler(templateById) {
        for (var mxTemplateId = 1; mxTemplateId < templateById.length; mxTemplateId++) {
            assert(!(mxTemplateId in this.templateMap), "templateDefinitionHandler1");
            var def = templateById[mxTemplateId];
            var mxParentId = Number(def.parentId);
            var childType = def.childType;
            var childName = def.childName;
            var referredId = def.referredId;
            if (referredId === null) {
                referredId = undefined;
            }
            else if (referredId !== undefined) {
                referredId = Number(referredId);
            }
            var parentId = this.templateMap[mxParentId];
            if (parentId === undefined) {
                RemotingLog.log(1, function () {
                    return "TemplateDefinitionHandler: parentId '" +
                        mxParentId + "' lacks a definition";
                });
                continue;
            }
            var templateId = this.paidMgr.getTemplateByEntry(parentId, childType, childName, referredId);
            this.templateMap[mxTemplateId] = templateId;
            RemotingLog.log(3, function () {
                return "MemoryXDR.TemplateDefinitionHandler: mapping " +
                    "<" + parentId + ":" + childType + ":" +
                    childName + ":" + referredId + "> to " + mxTemplateId;
            });
        }
    }
    /// for each element of 'indexById', find the id used for it by this.paidMgr
    /// (might extend this.paidMgr with a new index if it does not yet exist)
    indexDefinitionHandler(indexById) {
        for (var mxIndexId = 1; mxIndexId < indexById.length; mxIndexId++) {
            assert(!(mxIndexId in this.indexMap), "indexDefinitionHandler");
            var def = indexById[mxIndexId];
            var mxPrefixId = Number(def.prefixId);
            var dataIdentity = def.append;
            var mxReferredIndexId = def.compose;
            if (dataIdentity === null) {
                dataIdentity = undefined;
            }
            var prefixId = this.indexMap[mxPrefixId];
            if (typeof (prefixId) === "undefined") {
                RemotingLog.log(1, () => "addIndexDef: indexId '" + mxPrefixId + "' lacks a definition");
                continue;
            }
            var referredIndexId = undefined;
            if (mxReferredIndexId !== null && mxReferredIndexId !== undefined) {
                mxReferredIndexId = Number(mxReferredIndexId);
                referredIndexId = this.indexMap[mxReferredIndexId];
                if (typeof (referredIndexId) === "undefined") {
                    RemotingLog.log(1, () => "addIndexDef: indexId '" + mxReferredIndexId + "' lacks a definition");
                    continue;
                }
            }
            try {
                var indexId = this.paidMgr.getIndexByEntry(prefixId, dataIdentity, referredIndexId);
                this.indexMap[mxIndexId] = indexId;
            }
            catch (e) {
                RemotingLog.log(0, "error in mxIndexId = " + mxIndexId + ", entry =" + JSON.stringify(def));
                throw e;
            }
        }
    }
}

//# ../../feg/js/utils/testMode.js:1
var gRunningDiv = undefined;
var suppressRunningDivOnce;

function debugNoPendingTasksNotification() {
    if (!mondriaOnLoadDate) {
        return;
    }

    var now = new Date();

    mMessage('Time from onload to idle = ' + 
             (now.getTime() - mondriaOnLoadDate.getTime()) + 'ms');
    if (typeof(nodeTimeKitModule) !== "undefined" && nodeTimeKitModule) {
        // Report CPU time if possible
        var cputime = nodeTimeKitModule.cputime();
        console.log("CPU time from onload = " +
                    Math.round((cputime - mondriaT0) / 1000.0) + " ms");
        mondriaT0 = cputime;
    }

    if (typeof(process) !== "undefined") {
        testParamsDescStr = "parameters:";
        for (var arg in actualArgumentValues) {
            testParamsDescStr += " " + arg + "=" + actualArgumentValues[arg];
        }
        console.log(testParamsDescStr);
    }

    mondriaOnLoadDate = undefined;

    testDurationGuardTime = Date.now() + maxTestDuration;
    scheduleTestTask();
}

function taskQueueEmptyHook() {
}

function taskQueueInitProgressHook(p) {
}

function taskQueueRunningHook() {
}

function confirm(msg) {
    console.log(msg);
    return false;
}

function clearProgressDiv() {
}

function userAlert(msg) {
    console.log(msg);
}

function unsubcribeResourceHook() {    
}

function hideSplashScreen() {
}

/*
function setSplashScreenText(text) {
}
*/

function unhideMondriaRootDiv() {
}

function showRunningDivNow() {
}

//# dbio.js:1
/// <reference path="../../utils/node.d.ts" />
/// <reference path="../cmdClient/appStateCmdClient.ts" />
class ClearCmdClient extends CmdClient {
    constructor() {
        super(...arguments);
        this.updateCount = 0;
    }
    resourceUpdate(elementObj, resourceIdent) {
        let waitForConfirmation = false;
        for (let attr in elementObj) {
            let elem = elementObj[attr];
            let elemIdent = elem.ident;
            let elemVal = elem.value;
            if (elemVal === xdrDeleteIdent) {
                continue;
            }
            console.log("Remove " + elemIdent.templateId + ":" + elemIdent.indexId +
                ":" + elemIdent.path);
            this.unset(elemIdent);
            waitForConfirmation = true;
        }
        if (!waitForConfirmation) {
            process.exit(0);
        }
    }
    allRequestsAcknowledged() {
        process.exit(0);
    }
}
class PrintCmdClient extends CmdClient {
    // --------------------------------------------------------------------------
    // resourceUpdate
    //
    // Print the data, element by element, followed by the set of template-ids
    //  mentioned in the data. FOr each template-id, print its entry, and the
    //  entry for each index-id associated (by the data elements printed) with
    //  the element.
    //
    // The initial set of areas for which a template/index legend is required is
    //  gathered while printing the data elements.
    // Then, for each area for which a legend is required, its 
    //  embedding/intersection-parents are also considered to require a legend.
    //
    resourceUpdate(elementObj, resourceIdent) {
        let usedAreaId = new Map();
        let changed = false;
        function addTemplateId(tid) {
            if (typeof (tid) === "number" && tid > 1 && !usedAreaId.has(tid)) {
                usedAreaId.set(tid, new Set());
                changed = true;
            }
        }
        function addIndexId(tid, iid) {
            if (typeof (tid) !== "number" || tid <= 1 || !usedAreaId.has(tid)) {
                return;
            }
            if (typeof (iid) !== "number" || iid <= 0 || usedAreaId.get(tid).has(iid)) {
                return;
            }
            usedAreaId.get(tid).add(iid);
            changed = true;
        }
        function prefixStr(prefixId) {
            return prefixId === undefined ? "(root)" : String(prefixId);
        }
        // prepare an xdr function that would take values into a format
        //  JSON.stringify can handle (e.g. no Infinity and NaN's)
        let agentXdr = new AgentXDR(XDRDirection.Marshal, nopTemplateIndexChannel);
        let xdrFunc = function (cdlObj) {
            return agentXdr.xdrCdlObj(cdlObj);
        };
        //
        // print the data elements
        //
        console.log("===========================================================");
        for (let attr in elementObj) {
            let elem = elementObj[attr];
            let ident = elem.ident;
            let value = elem.value;
            let templateId = ident.templateId;
            let indexId = ident.indexId;
            let path = ident.path;
            if (value !== xdrDeleteIdent) {
                addTemplateId(templateId);
                addIndexId(templateId, indexId);
                // transform to a form which we know JSON.stringify  can handle
                //  (although it's less concise, e.g. arrays are
                //   { type: "orderedSet", os: [1,2,3] }
                //   rather than just [1,2,3]
                //  )
                let xdrValue = xdrFunc(value);
                console.log("@" + templateId + ":" + indexId + "::" + path +
                    "==> " + JSON.stringify(xdrValue, null, 2));
                console.log("");
            }
        }
        console.log("===========================================================");
        // collect all area-ids (as usedAreaId[templateId][indexId] which are
        //  required for a full path between screen-area and each area mentioned
        //  while printing data elements
        //
        // XXX should also test for areas used inside values
        do {
            changed = false;
            for (let [templateId, indexIds] of usedAreaId) {
                let templateEntry = gPaidMgr.getTemplateEntry(templateId);
                if (typeof (templateEntry) !== "object") {
                    console.log("Error: missing template definition for" +
                        " template-id '" + templateId + "'");
                    process.exit(1);
                }
                addTemplateId(templateEntry.parentId);
                addTemplateId(templateEntry.referredId);
                let childType = templateEntry.childType;
                for (let indexId of indexIds) {
                    let indexEntry = gPaidMgr.getIndexEntry(indexId);
                    if (childType === "single") {
                        addIndexId(templateEntry.parentId, Number(indexId));
                    }
                    else if (childType === "set") {
                        addIndexId(templateEntry.parentId, indexEntry.prefixId);
                    }
                    else if (childType === "intersection") {
                        addIndexId(templateEntry.parentId, indexEntry.prefixId);
                        addIndexId(templateEntry.referredId, indexEntry.compose);
                    }
                }
            }
        } while (changed);
        console.log("");
        console.log("");
        // print all template entries and the indices actually occurring in them
        for (let [templateId, indexIds] of usedAreaId) {
            let templateEntry = gPaidMgr.getTemplateEntry(templateId);
            console.log("templateId=" + templateId + ": " +
                "  parentId=" + templateEntry.parentId +
                ", name=" + templateEntry.childName +
                ", type=" + templateEntry.childType +
                ((typeof (templateEntry.referredId) === "number") ?
                    (", referredParentId=" + templateEntry.referredId) :
                    ("")));
            for (let indexId of indexIds) {
                let indexEntry = gPaidMgr.getIndexEntry(indexId);
                console.log("     indexId=" + indexId + ":      " +
                    "prefixId=" + prefixStr(indexEntry.prefixId) +
                    ((typeof (indexEntry.compose) !== "undefined") ?
                        (", referredIndexId=" + indexEntry.compose) :
                        ("")) +
                    ((typeof (indexEntry.append) !== "undefined") ?
                        (", areaSet-value=" + indexEntry.append) :
                        ("")));
            }
            console.log("");
        }
        process.exit(0);
    }
    allRequestsAcknowledged() {
    }
}
class ExportCmdClient extends CmdClient {
    constructor() {
        super();
        this.initFile();
    }
    // --------------------------------------------------------------------------
    // resourceUpdate
    //
    // while getting the update from the server, xdr defines any template/index -id
    //  used in the data in gPaidMgr.
    //
    // A single object is then written to the export file, with three sections:
    //  - data (an object whose values are { ident: <tid/iid/path>, value: })
    //  - template
    //  - index
    resourceUpdate(elementObj, resourceIdent) {
        assert(resourceIdent === "remoteServer", "resource update called by remoteServer");
        // prepare an xdr object that would convert the elements into a format
        //  that can be safely handled by JSON.stringify, and would also collect
        //  all of the templateIds/indexIds required for the identification of
        //  these app-state elements
        //
        let memoryXdr = new MemoryXDR(gPaidMgr);
        let agentXdr = new AgentXDR(XDRDirection.Marshal, nopTemplateIndexChannel);
        let xdrFunc = function (elem) {
            return XDR.xdrAppStateElement(elem, agentXdr);
        };
        let exportList = [];
        for (let ident in elementObj) {
            let elem = elementObj[ident];
            let xdrElem = xdrFunc(elem);
            exportList.push(xdrElem);
        }
        // get the templates and index-ids that should be stored along with the
        //  data
        let templateList = memoryXdr.getTemplateList();
        let indexList = memoryXdr.getIndexList();
        let exportObj = {
            template: templateList,
            index: indexList,
            data: exportList
        };
        this.writeFile(exportObj);
        process.exit(0);
    }
    allRequestsAcknowledged() {
    }
}
// read the import file, and preload gPaidMgr with the templates/indices in it,
//  so that while xdr'ing the data gPaidMgr can define each template/index used
//  by the data (either as an ident or as an element-reference data) for the
//  server
class ImportCmdClient extends CmdClient {
    constructor() {
        super();
        this.updateCount = 0;
        this.importList = [];
        this.initFile();
        let importObj = this.readFile();
        let templateTable = importObj.template;
        let indexTable = importObj.index;
        let elementList = importObj.data;
        // create a memory-xdr that would convert data back into an agent format,
        //  and would also handle coordinating with the PaidMgr all of the templates
        //  and indices used within these app-states
        let memoryXdr = new MemoryXDR(gPaidMgr);
        let agentXdr = new AgentXDR(XDRDirection.Unmarshal, nopTemplateIndexChannel);
        let xdrFunc = function (elem) {
            return XDR.xdrAppStateElement(elem, agentXdr);
        };
        // define all templates and indices with the paidMgr
        memoryXdr.templateDefinitionHandler(templateTable);
        memoryXdr.indexDefinitionHandler(indexTable);
        // convert from xdr format to agent format
        for (let i = 0; i < elementList.length; i++) {
            let xdrElem = elementList[i];
            let elem = xdrFunc(xdrElem);
            this.importList.push(elem);
        }
    }
    // --------------------------------------------------------------------------
    // resourceUpdate
    //
    resourceUpdate(elementObj, resourceIdent) {
        let isClearing = false;
        let isEmpty = true;
        for (let attr in elementObj) {
            let elem = elementObj[attr];
            let elemVal = elem.value;
            if (elemVal !== xdrDeleteIdent) {
                isEmpty = false;
                break;
            }
        }
        if (!isEmpty) {
            // current configuration is not empty
            if (gArgParser.getArg("override", false) === true) {
                // user requested override - clear all existing elements
                for (let attr in elementObj) {
                    let elem = elementObj[attr];
                    let elemIdent = elem.ident;
                    let elemVal = elem.value;
                    if (elemVal === xdrDeleteIdent) {
                        continue;
                    }
                    isClearing = true;
                    this.unset(elemIdent);
                }
            }
            else {
                // user did not specify override - preserve
                //  existing configuration
                console.log("Cannot import into a non-empty configuration");
                process.exit(1);
            }
        }
        isEmpty = true;
        for (let i = 0; i < this.importList.length; i++) {
            let elem = this.importList[i];
            this.set(elem.ident, elem.value);
            isEmpty = false;
        }
        if (isEmpty) {
            console.log("Configuration is empty");
            if (!isClearing) {
                process.exit(0);
            }
        }
    }
    allRequestsAcknowledged() {
        process.exit(0);
    }
}
function dbioMain() {
    initializeModeDetection();
    gArgParser = getArgParser();
    createRemoteMgr();
    serverMultiplexer.initRemote();
    let argv = gArgParser.getArgv();
    let cmd = argv[2];
    if (cmd === "clear") {
        let cmdClient = new ClearCmdClient();
        console.log("clear DB: " + serverMultiplexer.getServerDBStr());
        cmdClient.subscribeServer();
    }
    else if (cmd === "print") {
        let cmdClient = new PrintCmdClient();
        cmdClient.subscribeServer();
    }
    else if (cmd === "export") {
        let cmdClient = new ExportCmdClient();
        console.log("export DB:");
        console.log("\t from: " + serverMultiplexer.getServerDBStr());
        console.log("\t to: " + cmdClient.getFileDBStr());
        cmdClient.subscribeServer();
    }
    else if (cmd === "import") {
        let cmdClient = new ImportCmdClient();
        console.log("import DB:");
        console.log("\t from: " + cmdClient.getFileDBStr());
        console.log("\t to: " + serverMultiplexer.getServerDBStr());
        cmdClient.subscribeServer();
    }
    else {
        if (typeof (cmd) === "string") {
            console.log("Unknown dbio command '" + cmd + "'");
        }
        else {
            console.log("Available dbio commands are: " +
                "'clear', 'print', 'import' and 'export'");
        }
        process.exit(1);
    }
}
dbioMain();
