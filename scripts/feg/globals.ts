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

/// When true, node evaluation and updates are shielded by a try...catch
/// construction.
var g_noTryAndCatchUpdate: boolean = true;

/// When true, warnings regarding possible author errors and performance
/// problems are shown during runtime.
var showRuntimeWarnings: boolean = false;

/// Depending on its value, certain warnings are raised to syntax errors.
/// However, the resulting file will be runnable. To suppress the error
/// messages, lower the level.
var strictnessLevel: number = 0;

function setStrictnessLevel(sl: number): void {
    if (sl !== undefined) {
        strictnessLevel = sl;
    }
}

/// When true, (some) simple queries can build a cache on their input
/// to speed up multiple similar queries on the same values.
var allowSimpleQueryCache: boolean = true;

/// The format version of the actual .run.js file.
declare var fmtVersion: number;

/// Maps template id/function node id to a list of labels using the expression.
declare var functionNodeToExpressionPaths: number[][][][];
declare var functionNodeToExpressionPathsStringCache: string[];

/**
 * The format version number. Can't execute when it differs from fmtVersion.
 * History:
 * 1 r4000-ish: initial version
 * 2 r5920: variants split into qualifiers and variants; introduction of single
 *   variant
 * 2.1 r6214: change of fixed positions of [myMessage] and [{param: _}, [me]]
 * 2.2 r6235: remove superfluous schedule step from _sp()
 * 2.3 r6746: continuePropagation moved into true/false cases
 */
var gRunFmtVersion: number = 2.3;

/// Timestamp of onload event
var mondriaOnLoadDate: Date;

/// Timestamp of loading the html file. Declared in the html file.
declare var mondriaStartDate: Date;

/// Used by domEvent
declare var logEventTimes: boolean;
declare var logEventHistory: boolean;

/// When true, the first test task is scheduled after load
var runTests: boolean = false;

/// When defined, a log string that matches this regular expression will halt
/// testing
var testLogBreak: RegExp = undefined;

/// The maximum time a test is allowed to run in ms
var maxTestDuration: number = 240000;

/// The end time of the test: start time plus maxTestDuration
var testDurationGuardTime: number; // Maximum clock time for test

/// Set to true to activate timing functions during execution
var gProfile: boolean = false;

/// Tells internalQueryResult to use or not use result indexers
var useResultIndexers: boolean = true;

/// Allows moving query to another data source
var allowSetData: boolean = true;

/// false sets multiQuery to create a minimal tree (with much movement)
/// true makes multiQuery create a linear sequence of query applications with
/// a _ at the end
var linearMultiQuery: boolean = true;

/// This gets set to true when there have been too many content/position
/// tasks in a row.
var possibleLoopDetected: boolean = false;

var exportCount: any = undefined;
var testParamsDescStr: string;
var mondriaMutex: boolean = false;
var debugObjCache: boolean = false;
var doDebugging: boolean = false; // used in ContentTask?
var noTimeOut: boolean = false;

// When true, the 'load js' phase of the compiler tracks cpu time per node of
// the tree.
var debugLoadJSTime: boolean = false;

// Tests whether a string is a number
var numberRegExp = /^ *(\-|\+)? *([0-9]+(\.[0-9]*)?|[0-9]*\.[0-9]+|Infinity) *$/;

var debugDelayLoad: boolean = false;

enum ProductStatus {
    development,
    testing,
    qualityAssurance,
    production
}

var productStatus: ProductStatus = ProductStatus.development;

/// When defined, the "running" div is suppressed until Date.now() surpasses it
var suppressRunningUntil: number;
