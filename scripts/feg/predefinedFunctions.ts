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

/// <reference path="cdl.ts" />
/// <reference path="valueType.ts" />

var numericValueType: ValueType = new ValueType().addNumber();
var stringValueType: ValueType = new ValueType().addString();
var boolValueType: ValueType = new ValueType().addBoolean();
var numOrStrOrBoolValueType: ValueType = new ValueType().
    addNumber().addString().addBoolean();
var anyDataValueType: ValueType = new ValueType().addAnyData();
// Area zero is the pointer, of which there is precisely one
var areaZeroValueType: ValueType = new ValueType().addArea(0, [_r(1, 1)]);

// Predefined constants and functions
var _: Projector = new Projector();
var mustBeDefined = o();
var unmatched: TerminalSymbol = new TerminalSymbol("unmatched");
var ascending: string = "ascending";
var descending: string = "descending";
var plus: BuiltInFunction = new BuiltInFunction("plus", 2, 2, numericValueType);
var minus: BuiltInFunction = new BuiltInFunction("minus", 2, 2, numericValueType);
var mul: BuiltInFunction = new BuiltInFunction("mul", 2, 2, numericValueType);
var div: BuiltInFunction = new BuiltInFunction("div", 2, 2, numericValueType);
var pow: BuiltInFunction = new BuiltInFunction("pow", 2, 2, numericValueType);
var mod: BuiltInFunction = new BuiltInFunction("mod", 2, 2, numericValueType);
var remainder: BuiltInFunction = new BuiltInFunction("remainder", 2, 2, numericValueType);
var and: BuiltInFunction = new BuiltInFunction("and", 2, Infinity, boolValueType.addSize(1));
var logb: BuiltInFunction = new BuiltInFunction("logb", 2, 2, numericValueType);
var or: BuiltInFunction = new BuiltInFunction("or", 2, Infinity, boolValueType.addSize(1));
var not: BuiltInFunction = new BuiltInFunction("not", 1, 1, boolValueType.addSize(1));
var offset: BuiltInFunction = new BuiltInFunction("offset", 2, 3, numericValueType.copy().addSize(0, Infinity), true, true);
var coordinates: BuiltInFunction = new BuiltInFunction("coordinates", 1, 1, anyDataValueType, false, true, true);
var lessThan: BuiltInFunction = new BuiltInFunction("lessThan", 2, 2, boolValueType);
var lessThanOrEqual: BuiltInFunction = new BuiltInFunction("lessThanOrEqual", 2, 2, boolValueType);
var equal: BuiltInFunction = new BuiltInFunction("equal", 2, 2, boolValueType.addSize(1));
var notEqual: BuiltInFunction = new BuiltInFunction("notEqual", 2, 2, boolValueType.addSize(1));
var greaterThanOrEqual: BuiltInFunction = new BuiltInFunction("greaterThanOrEqual", 2, 2, boolValueType);
var greaterThan: BuiltInFunction = new BuiltInFunction("greaterThan", 2, 2, boolValueType);
var map: BuiltInFunction = new BuiltInFunction("map", 2, Infinity, undefined);
var filter: BuiltInFunction = new BuiltInFunction("filter", 2, 2, undefined);
var first: BuiltInFunction = new BuiltInFunction("first", 1, 1, undefined);
var prev: BuiltInFunction = new BuiltInFunction("prev", 0, 2, undefined, true, true);
var next: BuiltInFunction = new BuiltInFunction("next", 0, 2, undefined, true, true);
var last: BuiltInFunction = new BuiltInFunction("last", 1, 1, undefined);
var sort: BuiltInFunction = new BuiltInFunction("sort", 2, 2, undefined);
var prevStar: BuiltInFunction = new BuiltInFunction("prevStar", 0, 2, undefined, true, true);
var prevPlus: BuiltInFunction = new BuiltInFunction("prevPlus", 0, 2, undefined, true, true);
var nextStar: BuiltInFunction = new BuiltInFunction("nextStar", 0, 2, undefined, true, true);
var nextPlus: BuiltInFunction = new BuiltInFunction("nextPlus", 0, 2, undefined, true, true);
var index: BuiltInFunction = new BuiltInFunction("index", 0, 2, numericValueType, true, true);
var concatStr: BuiltInFunction = new BuiltInFunction("concatStr", 1, 2, stringValueType.copy().addSize(1));
var concat: BuiltInFunction = new BuiltInFunction("concat", 1, 2, stringValueType.copy().addSize(1));
var subStr: BuiltInFunction = new BuiltInFunction("subStr", 2, 2, stringValueType.copy().addSize(1));
var numberToString: BuiltInFunction = new BuiltInFunction("numberToString", 2, 2, stringValueType.copy().addSize(1));
var bool: BuiltInFunction = new BuiltInFunction("bool", 1, 1, boolValueType.copy().addSize(1));
var notEmpty: BuiltInFunction = new BuiltInFunction("notEmpty", 1, 1, boolValueType.copy().addSize(1));
var empty: BuiltInFunction = new BuiltInFunction("empty", 1, 1, boolValueType.copy().addSize(1));
var sum: BuiltInFunction = new BuiltInFunction("sum", 1, Infinity, numericValueType.copy().addSize(1));
var min: BuiltInFunction = new BuiltInFunction("min", 1, Infinity, undefined,
                                               false,false,false,true);
var max: BuiltInFunction = new BuiltInFunction("max", 1, Infinity, undefined,
                                               false,false,false,true);
var me: BuiltInFunction = new BuiltInFunction("me", 0, 0, undefined, true);
var embedded: BuiltInFunction = new BuiltInFunction("embedded", 0, 1, undefined, true, true);
var embeddedStar: BuiltInFunction = new BuiltInFunction("embeddedStar", 0, 1, undefined, true, true);
var embedding: BuiltInFunction = new BuiltInFunction("embedding", 0, 1, undefined, true, true);
var embeddingStar: BuiltInFunction = new BuiltInFunction("embeddingStar", 0, 1, undefined, true, true);
var expressionOf: BuiltInFunction = new BuiltInFunction("expressionOf", 0, 1, undefined, true, true);
var referredOf: BuiltInFunction = new BuiltInFunction("referredOf", 0, 1, undefined, true, true);
var intersectionParentOf: BuiltInFunction = new BuiltInFunction("intersectionParentOf", 0, 1, undefined, true, true);
var debugNodeToStr: BuiltInFunction = new BuiltInFunction("debugNodeToStr", 1, 2, stringValueType.addSize(1));
var size: BuiltInFunction = new BuiltInFunction("size", 1, 1, numericValueType.copy().addSize(1));
var pointer: BuiltInFunction = new BuiltInFunction("pointer", 0, 0, areaZeroValueType.copy().addSize(1));
var sequence: BuiltInFunction = new BuiltInFunction("sequence", 1, 1, numericValueType.copy().addSize(0, Infinity));
var reverse: BuiltInFunction = new BuiltInFunction("reverse", 1, 1, undefined);
var pos: BuiltInFunction = new BuiltInFunction("pos", 2, 2, undefined);
var range: BuiltInFunction = new BuiltInFunction("range", 2, 2, undefined);
var arg: BuiltInFunction = new BuiltInFunction("arg", 2, 2, numOrStrOrBoolValueType.copy().addSize(0, 1));
var merge: BuiltInFunction = new BuiltInFunction("merge", 1, Infinity, undefined);
var mergeWrite: BuiltInFunction = new BuiltInFunction("mergeWrite", 1, Infinity, undefined);
var areaOfClass: BuiltInFunction = new BuiltInFunction("areaOfClass", 1, 1, undefined, false, true);
var allAreas: BuiltInFunction = new BuiltInFunction("allAreas", 0, 0, undefined, false, true);
var identify: BuiltInFunction = new BuiltInFunction("identify", 2, 2, undefined);
var anonymize: BuiltInFunction = new BuiltInFunction("anonymize", 1, 1, undefined);
var overlap: BuiltInFunction = new BuiltInFunction("overlap", 2, 2, boolValueType);
var time: BuiltInFunction = new BuiltInFunction("time", 2, 3, numericValueType.copy().addSize(1));
var timeTrue: BuiltInFunction = new BuiltInFunction("timeTrue", 2, 3, numericValueType.copy().addSize(1));
var changed: BuiltInFunction = new BuiltInFunction("changed", 1, 1, boolValueType.copy().addSize(1));
var redirect: BuiltInFunction = new BuiltInFunction("redirect", 0, 0, boolValueType.copy().addSize(0));
var systemInfo: BuiltInFunction = new BuiltInFunction("systemInfo", 0, 0, 
    new ValueType().
        addAttribute("url", new ValueType().addNumber().addSize(1)).
        addAttribute("language", new ValueType().addString().addSize(1)).
        addAttribute("languages", new ValueType().addString().addSize(0, Infinity)).
        addAttribute("maxTouchPoints", new ValueType().addNumber().addSize(1)).
        addAttribute("connectionStatus", new ValueType().addString().addSize(1)).
        addAttribute("powerDisconnected", new ValueType().addNumber().addSize(0, 1)).
        addAttribute("waitBusyTime", new ValueType().addNumber().addSize(1)).
    addSize(1));
var loginInfo: BuiltInFunction = new BuiltInFunction("loginInfo", 0, 1, 
    new ValueType().
        addAttribute("username", new ValueType().addString().addSize(1)).
    addSize(1));
var timestamp: BuiltInFunction = new BuiltInFunction("timestamp", 1, 1, numericValueType.copy().addSize(1));
var displayWidth: BuiltInFunction =
    new BuiltInFunction("displayWidth", 0, 1, numericValueType, true, true);
var displayHeight: BuiltInFunction =
    new BuiltInFunction("displayHeight", 0, 1, numericValueType, true, true);
var baseLineHeight: BuiltInFunction =
    new BuiltInFunction("baseLineHeight", 0, 1, numericValueType, true, true);
var dateToNum: BuiltInFunction = new BuiltInFunction("dateToNum", 2, 2, numericValueType);
var numToDate: BuiltInFunction = new BuiltInFunction("numToDate", 2, 2, stringValueType);
var escapeQuotes: BuiltInFunction = new BuiltInFunction("escapeQuotes", 1, 1, anyDataValueType);
var areasUnderPointer: BuiltInFunction = new BuiltInFunction("areasUnderPointer", 0, 0, undefined);
var globalDefaults: BuiltInFunction = new BuiltInFunction("globalDefaults", 0, 0, anyDataValueType.copy().addSize(1));
var getRawData: BuiltInFunction = new BuiltInFunction("getRawData", 1, 1, anyDataValueType.copy().addSize(0, Infinity));
var download: BuiltInFunction = new BuiltInFunction("download", 2, 3, new ValueType().addSize(0));
var printArea: BuiltInFunction = new BuiltInFunction("printArea", 0, 0, new ValueType().addSize(0));
var dayOfWeek: BuiltInFunction = new BuiltInFunction("dayOfWeek", 1, 1, numericValueType);
var dayOfMonth: BuiltInFunction = new BuiltInFunction("dayOfMonth", 1, 1, numericValueType);
var month: BuiltInFunction = new BuiltInFunction("month", 1, 1, numericValueType);
var quarter: BuiltInFunction = new BuiltInFunction("quarter", 1, 1, numericValueType);
var year: BuiltInFunction = new BuiltInFunction("year", 1, 1, numericValueType);
var hour: BuiltInFunction = new BuiltInFunction("hour", 1, 1, numericValueType);
var minute: BuiltInFunction = new BuiltInFunction("minute", 1, 1, numericValueType);
var second: BuiltInFunction = new BuiltInFunction("second", 1, 1, numericValueType);
var foreignFunctions: BuiltInFunction = new BuiltInFunction("foreignFunctions", 0, 0, anyDataValueType.copy().addSize(0, Infinity));
var remoteStatus: BuiltInFunction = new BuiltInFunction("remoteStatus", 1, 1,
    new ValueType().
        addAttribute("state", new ValueType().addString().addSize(1)).
    addSize(0, 1));
var urlStr: BuiltInFunction = new BuiltInFunction("urlStr", 1, 1, stringValueType);

// set functions
var intersect: BuiltInFunction = new BuiltInFunction("intersect", 2, 2, undefined);
var unite: BuiltInFunction = new BuiltInFunction("unite", 2, 2, undefined);
var isDisjoint: BuiltInFunction = new BuiltInFunction("isDisjoint", 2, 2, boolValueType);

// special functions
var classOfArea: BuiltInFunction = new BuiltInFunction("classOfArea", 1, 1, stringValueType.copy().addSize(0, Infinity), false, true);
var cond: BuiltInFunction = new BuiltInFunction("cond", 2, 2, undefined);
var debugBreak: BuiltInFunction = new BuiltInFunction("debugBreak", 0, 0, anyDataValueType);
var defun: BuiltInFunction = new BuiltInFunction("defun", 2, 2, undefined);
var using: BuiltInFunction = new BuiltInFunction("using", 3, Infinity, undefined);
var message: BuiltInFunction = new BuiltInFunction("message", 0, 0, undefined, false, true);
var myMessage: BuiltInFunction = new BuiltInFunction("myMessage", 0, 0, undefined, true, true);

// Temporary functions
var multiQuery: BuiltInFunction = new BuiltInFunction("multiQuery", 2, 2, undefined);
var tempAppStateConnectionInfo: BuiltInFunction = new BuiltInFunction("tempAppStateConnectionInfo", 0, 0,
    new ValueType().
        addAttribute("errorId", new ValueType().addNumber().addSize(1)).
        addAttribute("errorMessage", new ValueType().addString().addSize(1)).
        addAttribute("serverAddress", new ValueType().addString().addSize(0, 1)).
        addAttribute("serverPort", new ValueType().addString().addSize(0, 1)).
        addAttribute("serverPath", new ValueType().addString().addSize(0, 1)).
        addAttribute("protocol", new ValueType().addString().addSize(0, 1)).
        addAttribute("owner", new ValueType().addString().addSize(0, 1)).
        addAttribute("appName", new ValueType().addString().addSize(1)).
        addAttribute("connectionState", new ValueType().addString().addSize(1)).
        addAttribute("loginStatus", new ValueType().addString().addSize(1)).
    addSize(1));

// debugger functions
var debuggerAreaInfo: BuiltInFunction =
    new BuiltInFunction("debuggerAreaInfo", 1, 1, anyDataValueType.copy().addSize(1));
var debuggerContextInfo: BuiltInFunction =
    new BuiltInFunction("debuggerContextInfo", 1, 1, anyDataValueType.copy().addSize(1));

// data access

// external data access value type

var dataSourceValueType = new ValueType().
    addAttribute("name", new ValueType().addString().addSize(1)).
    addAttribute("fullName", new ValueType().addString().addSize(1)).
    addAttribute("state", new ValueType().addString().addSize(1)).
    addAttribute("info", new ValueType().addString().addSize(1)).
    addAttribute("revision", new ValueType().addAnyData().addSize(0, Infinity)).
    addAttribute("lastUpdate", new ValueType().addNumber().addSize(1)).
    addAttribute("attributes", new ValueType().
                 addAttribute("name", new ValueType().addString().addSize(1)).
                 addAttribute("originalName", new ValueType().addString().addSize(1)).
                 addAttribute("type", new ValueType().addString().addSize(1)).
                 addAttribute("typeCount", new ValueType().
                              addAttribute("number", new ValueType().addNumber().addSize(1)).
                              addAttribute("date", new ValueType().addNumber().addSize(1)).
                              addAttribute("string", new ValueType().addNumber().addSize(1)).
                              addAttribute("object", new ValueType().addNumber().addSize(1)).
                              addAttribute("undefined", new ValueType().addNumber().addSize(1)).
                              addAttribute("boolean", new ValueType().addNumber().addSize(1)).
                              addAttribute("currency", new ValueType().addNumber().addSize(1)).
                              addAttribute("nrPositive", new ValueType().addNumber().addSize(1)).
                              addAttribute("nrNegative", new ValueType().addNumber().addSize(1)).
                              addAttribute("nrUnique", new ValueType().addNumber().addSize(1)).
                              addAttribute("nrUniqueValuesPerType", new ValueType().
                                           addAttribute("number", new ValueType().addNumber().addSize(1)).
                                           addAttribute("date", new ValueType().addNumber().addSize(1)).
                                           addAttribute("string", new ValueType().addNumber().addSize(1)).
                                           addAttribute("object", new ValueType().addNumber().addSize(1)).
                                           addAttribute("boolean", new ValueType().addNumber().addSize(1)).
                                           addAttribute("currency", new ValueType().addNumber().addSize(1)).
                                           addSize(1)).
                              addSize(1)).
                 addAttribute("uniqueValues", new ValueType().addAnyData().addSizeRange(new RangeValue([0, 64], true, false))).
                 addAttribute("min", new ValueType().addString().addSize(0, 1)).
                 addAttribute("max", new ValueType().addString().addSize(0, 1)).
                 addAttribute("currency", new ValueType().addString().addSize(0, 1)).
                 addSize(0, Infinity)).
    addAttribute("data", new ValueType().addAnyData().addDataSource().addSize(0, Infinity)).
    addSize(1);

var datasource: BuiltInFunction = new BuiltInFunction("datasource", 1, 2,
                                                      dataSourceValueType);

var datatable: BuiltInFunction = new BuiltInFunction("datatable", 1, 2,
                                                     dataSourceValueType);

var datasourceInfo: BuiltInFunction = new BuiltInFunction("datasourceInfo", 0, 0,
    new ValueType().
        addAttribute("name", new ValueType().addString().addSize(1)).
        addAttribute("baseName", new ValueType().addString().addSize(1)).
        addAttribute("revision", new ValueType().addAnyData().addSize(0, Infinity)).
        addAttribute("refreshTime", new ValueType().addNumber().addSize(1)).
        addAttribute("state", new ValueType().addString().addSize(1)).
        addAttribute("attributes", new ValueType().
            addAttribute("name", new ValueType().addString().addSize(1)).
            addAttribute("originalName", new ValueType().addString().addSize(1)).
            addAttribute("type", new ValueType().addString().addSize(1)).
            addAttribute("uniqueValues", new ValueType().addAnyData().addSizeRange(new RangeValue([0, 64], true, false))).
            addAttribute("min", new ValueType().addString().addSize(0, 1)).
            addAttribute("max", new ValueType().addString().addSize(0, 1)).
            addAttribute("currency", new ValueType().addString().addSize(0, 1)).
            addSize(0, Infinity)).
        addAttribute("info", new ValueType().addString().addSize(0, 1)).
        addAttribute("type", new ValueType().addString().addSize(0, 1)).
        addAttribute("typeCount", new ValueType().
            addAttribute("number", new ValueType().addNumber().addSize(1)).
            addAttribute("string", new ValueType().addNumber().addSize(1)).
            addAttribute("object", new ValueType().addNumber().addSize(1)).
            addAttribute("undefined", new ValueType().addNumber().addSize(1)).
            addAttribute("boolean", new ValueType().addNumber().addSize(1)).
            addAttribute("currency", new ValueType().addNumber().addSize(1)).
            addAttribute("nrPositive", new ValueType().addNumber().addSize(1)).
            addAttribute("nrNegative", new ValueType().addNumber().addSize(1)).
            addAttribute("nrUnique", new ValueType().addNumber().addSize(1)).
            addAttribute("nrUniqueValuesPerType", new ValueType().
                addAttribute("number", new ValueType().addNumber().addSize(1)).
                addAttribute("string", new ValueType().addNumber().addSize(1)).
                addAttribute("object", new ValueType().addNumber().addSize(1)).
                addAttribute("boolean", new ValueType().addNumber().addSize(1)).
                addAttribute("currency", new ValueType().addNumber().addSize(1)).
                addSize(1)).
            addSize(1)).
        addAttribute("progress", new ValueType().addString().addSize(0, 1)).
        addSize(0, Infinity));

// Database functions
var database: BuiltInFunction = new BuiltInFunction(
    "database", 1, 3,
    new ValueType().addAnyData().addDataSource().addSize(0, Infinity)
);
var databases: BuiltInFunction = new BuiltInFunction("databases", 0, 0,
    new ValueType().
        addAttribute("name", new ValueType().addString().addSize(1)).
        addAttribute("id", new ValueType().addString().addSize(1)).
        addAttribute("lastUpdate", new ValueType().addNumber().addSize(1)).
        addAttribute("tags", new ValueType().addString().addSize(1)).
        addAttribute("metaData", new ValueType().addAnyData().addSize(0, Infinity)).
        addAttribute("fileSize", new ValueType().addString().addSize(0, 1)).
        addAttribute("nrRecords", new ValueType().addString().addSize(0, 1)).
        addAttribute("parameters", new ValueType().
                addAttribute("description", new ValueType().addString().addSize(1)).
                addAttribute("type", new ValueType().addString().addSize(1)).
                addAttribute("min", new ValueType().addAnyData().addSize(0, 1)).
                addAttribute("max", new ValueType().addAnyData().addSize(0, 1)).
                addAttribute("discreteValues", new ValueType().addAnyData().addSize(0, Infinity)).
                addSize(0, Infinity)).
        addAttribute("attributes", new ValueType().
            addAttribute("name", new ValueType().addString().addSize(1)).
            addAttribute("originalName", new ValueType().addString().addSize(1)).
            addAttribute("type", new ValueType().addString().addSize(1)).
            addAttribute("typeCount", new ValueType().
                addAttribute("number", new ValueType().addNumber().addSize(1)).
                addAttribute("string", new ValueType().addNumber().addSize(1)).
                addAttribute("object", new ValueType().addNumber().addSize(1)).
                addAttribute("undefined", new ValueType().addNumber().addSize(1)).
                addAttribute("boolean", new ValueType().addNumber().addSize(1)).
                addAttribute("currency", new ValueType().addNumber().addSize(1)).
                addAttribute("nrPositive", new ValueType().addNumber().addSize(1)).
                addAttribute("nrNegative", new ValueType().addNumber().addSize(1)).
                addAttribute("nrUnique", new ValueType().addNumber().addSize(1)).
                addAttribute("nrUniqueValuesPerType", new ValueType().
                    addAttribute("number", new ValueType().addNumber().addSize(1)).
                    addAttribute("string", new ValueType().addNumber().addSize(1)).
                    addAttribute("object", new ValueType().addNumber().addSize(1)).
                    addAttribute("boolean", new ValueType().addNumber().addSize(1)).
                    addAttribute("currency", new ValueType().addNumber().addSize(1)).
                    addSize(1)).
                addSize(1)).
            addAttribute("uniqueValues", new ValueType().addAnyData().addSize(0, 250)). // 250 is just a rough estimate
            addAttribute("min", new ValueType().addString().addSize(0, 1)).
            addAttribute("max", new ValueType().addString().addSize(0, 1)).
            addAttribute("currency", new ValueType().addString().addSize(0, 1)).
            addSize(0, Infinity)).
        addAttribute("uploadProgress", new ValueType().
                addAttribute("dataTransferred", new ValueType().addNumber().addSize(1)).
                addAttribute("state", new ValueType().addString().addSize(1)).
                addSize(0, 1)).
    addSize(0, Infinity)
);

// Internal functions
var internalApply: BuiltInFunction = new BuiltInFunction("internalApply", 2, 2, undefined);
// [EXECUTECOMPILEDQUERY]
// var executeCompiledQuery: BuiltInFunction = new BuiltInFunction("executeCompiledQuery", 2, 2, undefined);
var internalPush: BuiltInFunction = new BuiltInFunction("internalPush", 1, 1, undefined);
var internalAtomic: BuiltInFunction = new BuiltInFunction("internalAtomic", 1, 1, undefined);
var internalDelete: BuiltInFunction = new BuiltInFunction("internalDelete", 0, 0, new ValueType().addUndefined().addSize(0));
var compareAreasQuery: BuiltInFunction = new BuiltInFunction("compareAreasQuery", 2, 2, undefined);
var nCompareAreasQuery: BuiltInFunction = new BuiltInFunction("nCompareAreasQuery", 2, 2, undefined);
var internalFilterAreaByClass: BuiltInFunction = new BuiltInFunction("internalFilterAreaByClass", 2, 2, undefined);
var internalFilterAreaByClassName: BuiltInFunction = new BuiltInFunction("internalFilterAreaByClassName", 2, 2, stringValueType);
var dynamicAttribute: BuiltInFunction = new BuiltInFunction("dynamicAttribute", 3, 3, anyDataValueType.copy().addSize(1));
var verificationFunction = new BuiltInFunction("verificationFunction", 2, 2, anyDataValueType);
var makeDefined = new BuiltInFunction("makeDefined", 1, 1, undefined);
var singleValue: BuiltInFunction = new BuiltInFunction("singleValue", 1, 1, undefined);

// rounding functions; 2nd optional argument is number of digits following
//  the decimal point to keep (may be negative e.g. round(1345.2, -2) ->  1300)
var floor: BuiltInFunction = new BuiltInFunction("floor", 1, 2, numericValueType);
var ceil: BuiltInFunction = new BuiltInFunction("ceil", 1, 2, numericValueType);
var round: BuiltInFunction = new BuiltInFunction("round", 1, 2, numericValueType);
// Miscellaneous math functions
var abs: BuiltInFunction = new BuiltInFunction("abs", 1, 1, numericValueType);
var sqrt: BuiltInFunction = new BuiltInFunction("sqrt", 1, 1, numericValueType);
var sign: BuiltInFunction = new BuiltInFunction("sign", 1, 1, numericValueType);
var uminus: BuiltInFunction = new BuiltInFunction("uminus", 1, 1, numericValueType);
var evaluateFormula: BuiltInFunction = new BuiltInFunction("evaluateFormula", 2, 2, numericValueType);
var testFormula: BuiltInFunction = new BuiltInFunction("testFormula", 1, 1, boolValueType);
var evaluateCdlStringValue: BuiltInFunction = new BuiltInFunction("evaluateCdlStringValue", 1, 1, anyDataValueType);
var testCdlValueString: BuiltInFunction = new BuiltInFunction("testCdlValueString", 1, 1, boolValueType);
var addComputedAttribute: BuiltInFunction = new BuiltInFunction("addComputedAttribute", 3, 3, undefined);

// Test Functions (to be used in automated testing only)
var testStore: BuiltInFunction = new BuiltInFunction("testStore", 0, 0, anyDataValueType.copy().addSize(0, Infinity), false, true);
