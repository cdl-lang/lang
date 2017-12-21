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
