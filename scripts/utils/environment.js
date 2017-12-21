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
