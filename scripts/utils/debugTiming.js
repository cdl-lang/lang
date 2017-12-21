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


// The class in this file implements the measurement of time elapsed
// between various points in the code. Labels are used to associate start
// and stop points for the measurement and group names are used to turn
// various measurement points on and off.

//
// Timing
//

// This file implements a global timing object 'globalDebugTimingObj'.
// To measure the time between two points in the code, one should use
// the following global functions:
//
// debugStartTimer(<group name>, <label>)
// debugStopTimer(<label>)
//
// The first function should be placed where timing should start and
// the second timer should be placed where timing should stop. Each label
// defines a different timer. The timing for a specific label begins when
// debugStartTimer is called for that label. subsequent calls to
// debugStartTimer have no effect, until debugStopTimer is called with that
// label. When this happens, timing for that label stops and the result is
// stored in that label's entry in the timing table
// (globalDebugTimingObj.debugTimingTable). A call to debugStopTimer with
// a label for which the timer has not been started is ignored.
// Each timing is added to the list of timings collected in the table.
// This produces a sequence of timings for each label.
//
// The group name (a string) which appears in the 'debugStartTimer' function
// is the group which this timing belongs to. The timer will be started only if
// this group is currently active. Initially, no group is active. To activate
// a group, call one of the following functions:
//
// debugTimingAddGroup(groupName)
// debugTimingAddConditionalGroup(condGroup, group)
//
// Both functions activate the group 'group' (a string), but the second
// function does this only if the group 'condGroup' (a string) is already
// active. To de-activate a group, call the function:
//
// debugTimingRemoveGroup(group)
//
// One can activate and de-activate groups either through the debugger or at
// specific places in the code (for example, after a mouse down).
//
// To activate debug timing, the global flag 'doDebugTiming' needs to be set
// to true.
//
// After having collected some debug timing, one can examine them by
// loking at the table globalDebugTimingObj.debugTimingTable (using a
// debugger). The timings for each label appear under that label's entry
// in the debugTimingTable. The raw timing data is stored there. In addition,
// one can calculate various statistics (average/min/max time) over these
// timings by calling the following function:
//
// globalDebugTimingObj.calcStatistics(<label>)
//
// This will calculate the statistics for the timing data currently stored
// for the given label. The statistics are then stored in the label's entry
// in the debugTimingTable.
// If the function is called without a label, it calculates the statistics
// for all labels.
// One would typically call this function from inside a debugger.
//
// To clear timing data, one can call the function:
//
// debugTimingClear(<label>)
//
// This clears the data collected and the statistics for the given label.
// If called without a label, this clears all labels.
//
// debugTimingTable
// ================
// The globalDebugTimingObj.debugTimingTable is the table which holds the
// collected timings and statistics calculated. The attributes of teh table
// are the labels and the value under each attribute is an object holding
// the timing data and statistics for that label. This entry has the following
// format:
// {
//    results: <an array holding the raw timings> // not very interesting
//    startTime: <Date object> // if timer is running - the start time
//                             // if the timer is not running - undefined
//    stat: {  // statistics (calculated over the results)
//
//       end: <end time of last result>
//       start: <start time of first result>
//
//       count: <number of results>
//       average: <average time>
//       minTime: <minimal time measured>
//       maxTime: <maximal time measured>
//       totalTime: <sum of times measured>
//       timeDistribution: <array>  // entry 't' holds the number of times
//                                  // a time interval of length 't' was
//                                  // measured.
//    }
// }
//
// 
// Log Elapsed Time
// ================
// When using debug logging from inside the code (using console.log,
// for example) one may want to print the time elapsed between consecutive
// logs. This can be done by calling the function:
//
// debugLogTimeElapsed()
//
// This function returns the time elapsed (in milliseconds) since the
// function was last called.

// as long as this flag is false, no timing takes place. When not debugging,
// this should be false.
var doDebugTiming = false;

// this flag controls outputting some debug timing reports to the console
var doDebugTimingReport;

//
// Global debug timing object
//

var globalDebugTimingObj;

//
// Initialization
//

function initializeDebugTiming()
{
    globalDebugTimingObj = new DebugTimingObj("global");

    debugTimingAddGroup("area");
    debugTimingAddGroup("description");
    debugTimingAddGroup("positioning");
    debugTimingAddGroup("content");
    debugTimingAddGroup("construction");
    debugTimingAddGroup("task queue");
    debugTimingAddGroup("profiling");
    debugTimingAddGroup("event processing");
    debugTimingAddGroup("query");
    debugTimingAddGroup("z-index");
    debugTimingAddGroup("intersection");
    debugTimingAddGroup("scheduler");

    globalDebugTimingObj.debugProfilingGroups["profiling"] = true; 
}

//
// Global interface functions
//

// These function provide an interface for calling the same named functions
// on the global debug timing object

function debugStartTimer(group, label)
{
    if (! doDebugTiming)
        return;
    if (! globalDebugTimingObj) {
        initializeDebugTiming();
    }
    globalDebugTimingObj.debugStartTimer(group, label);
}

function debugStopTimer(label)
{
    if (globalDebugTimingObj) {
        globalDebugTimingObj.debugStopTimer(label);
    }
}

function debugTimingAddGroup(group)
{
    globalDebugTimingObj.debugTimingAddGroup(group);
}

function debugTimingAddConditionalGroup(condGroup, group)
{
    globalDebugTimingObj.debugTimingAddConditionalGroup(condGroup, group);
}

function debugTimingRemoveGroup(group)
{
    globalDebugTimingObj.debugTimingRemoveGroup(group);
}

function debugTimingClear(label)
{
    globalDebugTimingObj.debugTimingClear(label);
}

function debugLogTimeElapsed()
{
    return globalDebugTimingObj.debugLogTimeElapsed();
}

var totalTimeDebugTimingObj;
function debugTotalTimeStart(label)
{
    if (! doDebugTiming)
        return;
    if (! totalTimeDebugTimingObj) {
        totalTimeDebugTimingObj = new DebugTimingObj("total");
        totalTimeDebugTimingObj._totalTime = 0;
        totalTimeDebugTimingObj.debugTimingAddGroup("total");
    }

    totalTimeDebugTimingObj.debugLogTimeElapsed();
    totalTimeDebugTimingObj.debugStartTimer("total", label);
}

function debugTotalTimeStop(label)
{
    if ((! doDebugTiming) || (! totalTimeDebugTimingObj))
        return;
    var delta = totalTimeDebugTimingObj.debugLogTimeElapsed();
    totalTimeDebugTimingObj._totalTime += delta;
    totalTimeDebugTimingObj.debugStopTimer(label);
    //mMessage("TotalTime(", label, "): adding ", delta,
    //         ", current total is ", totalTime);
}

function debugTotalTimeClear()
{
    if (totalTimeDebugTimingObj) {
        totalTimeDebugTimingObj.debugTimingClear();
    }

    if (globalDebugTimingObj) {
        globalDebugTimingObj.debugTimingClear();
    }
}

function debugTotalTimeReport()
{
    if (! doDebugTiming) {
        return false;
    }
    if (totalTimeDebugTimingObj) {
        mMessage("totalTime: ", totalTimeDebugTimingObj._totalTime);
        mMessage(
            "======================== totalTime ==========================");
        totalTimeDebugTimingObj.calcStatistics();
        totalTimeDebugTimingObj.displayStatistics();
        mMessage(
            "=============================================================");
    }

    if (globalDebugTimingObj) {
        mMessage(
            "=================== globalDebugTimingObj ====================");
        globalDebugTimingObj.calcStatistics();
        globalDebugTimingObj.displayStatistics();
        mMessage(
            "=============================================================");
    }
    return true;
}

/////////////////////////
// Debug Timing Object //
/////////////////////////

function DebugTimingObj(name)
{
    this.name = name;

    // the attributes in this object are the names of measurement point
    // groups which are currently active. This affects only measurement
    // starts, as any measurement started is always also stopped (assumed
    // a stop point was reached) regardless of whether its group is active
    // or not.
    this.activeDebugTimingGroups = {};
    // optionally, the debugger profiler can be turned on within time
    // measurements. This list marks the groups for which profiling should
    // take place (the attributes in the object are the names of the groups
    // for which profiling takes place).
    this.debugProfilingGroups = {};
    // table for storing all timing events
    this.debugTimingTable = {};

    // time for log elapsed timer
    this.logElapsedLastTime = undefined;
}

// This function starts a timer for the given group and label. The timer
// is only activated if the group is currently active. If the timer was
// already started for this label, this does nothing. 

DebugTimingObj.prototype.debugStartTimer = debugTimingObjDebugStartTimer;

function debugTimingObjDebugStartTimer(group, label)
{
    if(!doDebugTiming || !(group in this.activeDebugTimingGroups))
        return;

    var entry = this.debugTimingTable[label];
    
    if(!entry)
        entry = this.debugTimingTable[label] = { results: [] };

    if(entry.startTime)
        return; // already started
    else {
        entry.startTime = new Date();
        if((group in this.debugProfilingGroups) &&
           (console.profile !== undefined)){
            entry.profiling = true;
            console.profile(label);
        }
    }
}

// This function stops the timer of the given label (if it was started)
// and stores the result in the list of timing results for that label.
// if 'print' is set, the timing result for this measurement is printed
// (to the console).

DebugTimingObj.prototype.debugStopTimer = debugTimingObjDebugStopTimer;

function debugTimingObjDebugStopTimer(label, print)
{
    if(!doDebugTiming)
        return;
    
    var entry = this.debugTimingTable[label];

    if(!entry || !entry.startTime)
        return; // not started

    if(entry.profiling) {
        console.profileEnd(label);
        entry.profiling = false;
    }
    
    var curTime = new Date();
    
    // create an entry for this measurement and push it on the list of
    // results.

    var timing = { start: entry.startTime, end: curTime };
    timing.diff = timing.end.getTime() - timing.start.getTime();
    
    entry.results.push(timing);
    entry.startTime = undefined;

    if(print)
        this.printLastDebugTiming(label);
}

///////////////////////////
// Statistics Extraction //
///////////////////////////

// Given a label, this function adds to its entry statistics based on the
// results currently stored on the entry.

DebugTimingObj.prototype.calcStatistics = debugTimingObjCalcStatistics;

function debugTimingObjCalcStatistics(label)
{
    if(label === undefined) {
        for(var l in this.debugTimingTable)
            this.calcStatistics(l);
        return;
    }
    
    var entry = this.debugTimingTable[label];

    if(!entry)
        return;

    var stat = entry.stat = {};
    
    stat.count = entry.results.length;

    if(!entry.results.length)
        return;
    
    // first time to fall within the statistics calculated here 
    stat.start = entry.results[0].start.getTime();
    // last time to fall within the statistics calculated here 
    stat.end = entry.results[entry.results.length-1].end.getTime();
    stat.totalTime = 0;
    stat.minTime = Infinity;
    stat.maxTime = -Infinity;
    stat.timeDistribution = [];
    
    for(var i = 0, length = entry.results.length ; i < length ; ++i) {
        var diff =
            entry.results[i].end.getTime() - entry.results[i].start.getTime();
        stat.totalTime += diff;
        if(diff < stat.minTime)
            stat.minTime = diff;
        if(diff > stat.maxTime)
            stat.maxTime = diff;

        if(!stat.timeDistribution[diff])
            stat.timeDistribution[diff] = 1;
        else
            stat.timeDistribution[diff]++;
    }

    stat.average = stat.totalTime / stat.count;
}

DebugTimingObj.prototype.debugTimingClear =
    debugTimingObjDebugTimingClear;

function debugTimingObjDebugTimingClear(label)
{
    if(label === undefined) {
        for(var l in this.debugTimingTable)
            this.debugTimingClear(l);

        if (this._totalTime) {
            this._totalTime = 0;
        }
        return;
    }

    delete this.debugTimingTable[label];
}

////////////////////////////////////
// Setting/Resetting Group Labels //
////////////////////////////////////

DebugTimingObj.prototype.debugTimingAddGroup =
    debugTimingObjDebugTimingAddGroup;

function debugTimingObjDebugTimingAddGroup(group)
{
    this.activeDebugTimingGroups[group] = true;
}

// This function adds the group 'group' to the set of active groups iff
// 'condGroup' is already active.

DebugTimingObj.prototype.debugTimingAddConditionalGroup =
    debugTimingObjDebugTimingAddConditionalGroup;

function debugTimingObjDebugTimingAddConditionalGroup(condGroup, group)
{
    if(this.activeDebugTimingGroups[condGroup])
        this.activeDebugTimingGroups[group] = true;
}

DebugTimingObj.prototype.debugTimingRemoveGroup =
    debugTimingObjDebugTimingRemoveGroup;

function debugTimingObjDebugTimingRemoveGroup(group)
{
    delete this.activeDebugTimingGroups[group];
}

//////////////
// Printing //
//////////////

DebugTimingObj.prototype.printLastDebugTiming =
    debugTimingObjPrintLastDebugTiming;

function debugTimingObjPrintLastDebugTiming(label)
{
    var entry = this.debugTimingTable[label];

    if(!entry || !entry.result.length)
        return;

    var timing = entry.results[entry.result.length - 1];

    this.printSingleDebugTiming(label, timing);
}

DebugTimingObj.prototype.printSingleDebugTiming =
    debugTimingObjPrintSingleDebugTiming;

function debugTimingObjPrintSingleDebugTiming(prefix, timing)
{
    if(!timing)
        return;

    mMessage("%s: start: %s (%s), now: %s (%s) elapsed: %s ms", prefix,
             timing.start.toLocaleTimeString(),
             timing.start.getTime(),
             timing.end.toLocaleTimeString(),
             timing.end.getTime(),
             timing.end.getTime() -
             timing.start.getTime());
}

///////////////
// Log Timer //
///////////////

// This function returns the time elapsed (in milliseconds) since the last call
// to this function. This can be used in logging to print the time since
// the last log message.

DebugTimingObj.prototype.debugLogTimeElapsed =
    debugTimingObjDebugLogTimeElapsed;

function debugTimingObjDebugLogTimeElapsed()
{
    var curDate = new Date();
    var now = curDate.getTime();
    var diff;
    
    if(this.logElapsedLastTime === undefined)
        diff = 0;
    else
        diff = now - this.logElapsedLastTime;

    this.logElapsedLastTime = now;
    
    return diff;
}

DebugTimingObj.prototype.displayStatistics = debugTimingObjDisplayStatistics;
function debugTimingObjDisplayStatistics()
{
    var i;

    if (! doDebugTiming)
        return;

    if (gArgParser.getArg("ddtr") === "json") {
        var out = {};
        for (var e in this.debugTimingTable) {
            if (this.debugTimingTable[e].stat) {
               out[e] = this.debugTimingTable[e].stat.totalTime;
            }
        }

        var args = gArgParser.getArgList();
        for (i = 0; i < args.length; i++) {
            var arg = args[i];
            out[arg] = gArgParser.getArg(arg);
        }

        var name = this.name;
        console.log(name + "=" + objToString(out));
        return;
    }

    function fixLen(str, len, trim)
    {
        var strstr = String(str);
        var out = trim ? strstr.substr(0, len) : strstr;
        while (out.length < len) {
            out = out + " ";
        }

        return out;
    }

    function prtItem(item)
    {
        mMessage(
            fixLen(item.name, 45) + "  " +
                fixLen(item.totalTime, 10) + "  " +
                fixLen(item.count, 10) + "  " +
                fixLen(item.timePerCall, 6, true));
    }

    prtItem(
        { name: "name",
          totalTime: "Total Time",
          count: "Count", 
          timePerCall: "tm/call"
        }
    );

    mMessage("--------------------------------------------------------------");

    var member = [];
    for (var x in this.debugTimingTable) {
        var stat = this.debugTimingTable[x].stat;
        if (! stat)
            continue;

        member.push(
            {
                name: x,
                totalTime: stat.totalTime,
                count: stat.count,
                timePerCall:
                (stat.count ? stat.totalTime/stat.count : "?")
            }
        );
    }

    member.sort(function (a, b) { return a.totalTime - b.totalTime; } );

    for (i = 0; i < member.length; i++) {
        var item = member[i];
        prtItem(item);
    }
}
