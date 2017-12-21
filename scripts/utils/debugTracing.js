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


//
// This object provides general tracing utilities. Any object which inherits
// this class can write messages and dump objects to the log. The messages
// and object dumps are stored in a global log structure.  
// 
// Cycles
// ======
// Logging is paritioned into cycles. The log holds an array 
// where each entry in the array is the log for a single cycle. When 
// a module performs logging, all logs will go to the currently open cycle. 
// At any point in time, a module can request to open a new log cycle. 
// This closes the current log cycle (if such a log cycle exists). When more 
// than one module writes logs, any of the logging modules can open 
// a new cycle. This will affect all modules writing logs.
// If no open cycle exists, a log operation would create a new cycle.
//
// To allow a module to determine the cycles when no other module is
// writing logs but to give up such control when some
// higher level module is writing logs, the operation of
// creating new cycles can be applied with a priority. A new cycle operation
// will fail if the current cycle was opened by a higher priority module.
// A new cycle operation with no priority specified will always succeed.
//
// Inside each cycle, the logs appear in chronological order.
//
// Log Sections
// ============
// Sometimes one wants to write a sequence of objects or messages which will 
// form a single entry in the log (for example, you want a single log for
// a certain operation performed by a loop, but the information to be logged
// needs to be collected throughout the loop). In this case, one can open 
// a log section. At most one log section can be open at the same time.
// Once a section is open, all logs will be written to that section. When 
// the section is closed, all logs stored in
// it are written to the log as a single log entry. Closing the
// log cycle closes any open section. If a new section
// is opened while another section is still open, this will first close
// the existing section (one cannot create sections within a section). 
//
// Statistics
// ==========
// In addition to logs, statistics can be collected. This may be used when
// one is not interested in the exact action taken but only in the number
// of times such an action took place. Modules wishing to collect statistics
// may increment named counters. At the end of each cycle, the count for
// that counter is written to the log and the counter is destroyed 
// (it will be initialized to 1 the next time it is incremented).
// Statistics include counters, and histograms - which are merely counters
//  organized in a hierarchy of two strings.
// 
// 

///////////////////////
// Global Log Object //
///////////////////////

// This is the global object in which the logs are stored. 
//
var globalDebugTracingLog;

function initializeDebugTracingLog()
{
    globalDebugTracingLog = new DebugTracingLog();
}

// This function initializes the debugging for various global modules. It is
// called after the relevant modules have been created and initialized.
//
// Remark: Only the tracing for global objects can be set here. While tracing 
// can be enabled for non-global objects, it is usually most convenient 
// to set the tracing on global objects. Therefore, in practice, all
// tracing can be turned on here.

function debugTracingSetDebugMode()
{
    //
    // Positioning Tracing
    //
    
    // PosCalc
    
    // This enables general debugging for the positioning module. It traces
    // the addition and removal of constraints and the modification of 
    // pair offsets. It does not trace the actual process of solving the
    // equations (to trace that, see 'equations' below).
    globalPos.posCalc.doDebugging = false;
    // to enable tracing, uncomment the following line
    // globalPos.posCalc.doDebugging = true;
    
    // PosEquations
    
    // This traces the process of solving the equations, down to the smallest
    // details (which variables are moved and why). Here, the doDebugging is
    // not merely a true/false flag but carries an object describing what
    // type of tracing to perform. See 'positioning/debugPosEquations.js'
    // for the exacg format of this object.
    globalPos.posCalc.equations.doDebugging = false;
    // select below the types of debug to enable
    /* globalPos.posCalc.equations.doDebugging = { 
        // trace: true, // trace all data structures
        // trace: {}, // list of data types to trace - empty object produces
                      // only trace messages, but no data object dumps.
        // statistics: true,
        // changes: true
    }; */
    
    // this function needs to be called to properly enable tracing
    globalPos.posCalc.equations.debugSetDebugMode();
}

//
// Structure of the Object
//

// The structure of the object is as follows (explanations below): 
// {
//    logs: <array of cycle log objects>,
//    maxLogLength: <maximal entries in the 'logs' array>
//    cyclePriority: <priority with which the current cycle was opened>
//    section: <current section array>
//    counters: {
//        <counter name>: <count>
//        .....
//    },
//    histograms: {
//      <topic1>: {
//        <counter name>: <count>,
//        ...
//      },
//      <topic2>: ...
//    }
// }
//
// The 'logs' entry holds an array of log cycle objects. The log cycle 
// objects are stored in reverse chronological order: the most recent cycle 
// is the first, the oldest cycle is the last. If there is a limit on the 
// size of the log, this array is not allowed to grow beyond that number 
// (the oldest cycles are discarded). The length of the log is controlled 
// by the variable maxLogLength.
//
// 'maxLogLength' is the maximal number of entries (cycles) to be stored 
// in the 'logs' array. When this number is reached, the oldest log cycle is 
// disacarded when a new cycle is added. This has no effect on the number
// of logs in each cycle. Set 'maxLogLength' to Infinity if you wish
// no logs to be discarded. A value of zero or less would also result in
// an infinte bound on the length of the log.
//
// The 'cyclePriority' field holds the priority with which the most recent
// log cycle was created. When a new cycle is requested
// with a priority lower than that of the cycle currently open, no new
// cycle is created. An 'undefined' priority always opens a new cycle 
// and any priority opens a new cycle after a cycle with undefined priority. 
//
// The 'section' field stores an array representing the current log section 
// (in case such a section was opened). If no section was opened, 
// this field is undefined. The array representing the section is simply 
// used to collect the logs written to that section.
//
// The 'statistics' table stores the current count for each counter defined.

function DebugTracingLog()
{
    this.logs = [];
    this.maxLogLength = 100; // defualt maximal number of log cycles
    this.cyclePriority = undefined;
    this.section = undefined;
    this.counters = {};
    this.histograms = {};
}

// This function requests a new logging cycle to be created. Once a cycle 
// is created, all logging goes to that cycle. This also clears all 
// statistics counters. Before opening a new cycle, this function closes 
// the previously open cycle (if any). This includes recording the values 
// of all statistics counters to the cycle (before closing it).
// The function takes a single (optional) argument - the priority
// with which the cycle is opened. If this is undefined, a new cycle is
// always opened. Otherwise (it should be a number) it is compared with
// the priority of the currently open cycle (if any). If that priority is
// smaller or equal to the priority specified for the new cycle, the new
// cycle is created. If the previous priority is undefined, a new cycle 
// is also opened. 

DebugTracingLog.prototype.newCycle = debugTracingLogNewCycle;

function debugTracingLogNewCycle(priority)
{
    if(this.logs[0]) { // open cycle exists
        
        // check whether the priority is higher than that of the current cycle
        if(priority !== undefined && this.cyclePriority !== undefined &&
           priority < this.cyclePriority)
            return; // don't close the cycle and create a new one
        
        // if any section is current open, close it
        this.closeSection();
        
        // record any statistics previously collected to the current cycle
        this.recordStatistics();
    }
    
    if(this.maxLogLength > 0)
        while(this.logs.length >= this.maxLogLength)
            this.logs.pop();

    if(!this.logs[0] || this.logs[0].length > 0)
        // new cycle entry at beginning of log, but no need to do so if
        // the current cycle log is empty
        this.logs.unshift([]);
    
    // clear the statistics entry
    this.counters = {};
    this.histograms = {};
    
    // record the cycle priority
    this.cyclePriority = priority;
}

// This function pushes the next debug log entry onto the current cycle log.

DebugTracingLog.prototype.pushNextLog = debugTracingLogPushNextLog;

function debugTracingLogPushNextLog(logObj)
{
    // if no logging cycle was yet opened for this group, open one 
    if(!this.logs[0])
        this.newCycle();
    
    if(this.section) {
        this.section.push(logObj);
        return;
    }
    
    var cycleEntry = this.logs[0];
    
    if(!cycleEntry)
        return;
    
    // push the log entry
    cycleEntry.push(logObj);
}

// This function opens a new section. If another section
// is already open, that section is automatically closed 
// when a new section is created (the currently open section is already 
// stored in the log, so once a new section is created, logs stop being
// written to the previous section).
// The 'where' string is stored under the attribute 'where' directly 
// on the array representing the section. This can be used to indicate 
// where the section was created. 

DebugTracingLog.prototype.openSection = debugTracingLogOpenSection;

function debugTracingLogOpenSection(where)
{
    if(!this.logs[0])
        this.newCycle();
    
    var section = this.section = [];
    
    if(where)
        section.where = where;
    
    var cycleEntry = this.logs[0];
    
    // push the log section onto the log
    cycleEntry.push(section);
}

// This function closes the current section (since the section is already
// stored in the log, all it has to do is remove the section from the
// section table).

DebugTracingLog.prototype.closeSection = debugTracingLogCloseSection;

function debugTracingLogCloseSection()
{
    this.section = undefined;
}

// line break

// Use this object as an argument to 'message' where a line break in the
// log message is required.
var gBR = new Object();

// This function converts its arguments into strings and stored
// their concatenation as a log message.

DebugTracingLog.prototype.message = debugTracingLogMessage;

function debugTracingLogMessage()
{
    var message = "";
    
    // loop over the arguments
    for(var i = 0, length = arguments.length ; i < length ; ++i) {
        
        if(arguments[i] == gBR) {
            // dump the existing message and start from the beginning
            this.pushNextLog(message);
            message = "     ";
            continue;
        }
        
        if(typeof(arguments[i]) == "number" ||
           typeof(arguments[i]) == "string")
            message += arguments[i];
        else if(arguments[i])
            message += objToString(arguments[i]);
    }
    
    if(message.length > 0) {
        this.pushNextLog(message);
    }
}

//
// Statistics (counters and histograms)
//

// This function increments by 1 the given counter.
// If the counter does not exist, it behaves as if its value was zero before
// this operation. 

DebugTracingLog.prototype.incCounter = debugTracingLogIncCounter;

function debugTracingLogIncCounter(counter)
{
    if(!this.counters[counter])
        this.counters[counter] = 1;
    else
        this.counters[counter]++;
}

//
// This function increments by 1 the given counter inside the given topic.
// If the topic does not exist, it is created. If the couter within the topic
//  does not exist, it behaves as if its value was zero before this operation
// 
DebugTracingLog.prototype.incHistogramCounter =
    debugTracingLogIncHistogramCounter;
function debugTracingLogIncHistogramCounter(topic, counter)
{
    if (! this.histograms[topic]) {
        this.histograms[topic] = { _total: 0 };
    }

    if (! this.histograms[topic][counter]) {
        this.histograms[topic][counter] = 1;
    } else {
        this.histograms[topic][counter]++;
    }
    this.histograms[topic]._total++;
}

// This function takes the statistics collected until now
// and records them as a log. The statistics are then cleared.

DebugTracingLog.prototype.recordStatistics = debugTracingLogRecordStatistics;

function debugTracingLogRecordStatistics()
{
    if(!isEmptyObj(this.counters))
        this.pushNextLog(this.counters);
    if(!isEmptyObj(this.histograms))
        this.pushNextLog(this.histograms);
    
    this.counters = {};
    this.histograms = {};
}

//////////////////////////
// Debug Tracing object //
////////////////////////// 

// This object should be inherited by any object which wishes to write
// to the debug log. It provides a basic interface to the debug log and
// also stores the object's logging state (such as its cycle opening priority
// and whether logging is turned on or off).
//
// The this.doDebugging variable needs to be of a non-falsy type 
// (anything such that !!this.doDebugging == true) in order
// for debugging to take place. Otherwise, debugging is turned off.
// The derived class is allowed to used this variable to store information
// as to what sort of debugging to perform (but this is entirely up to
// the derived class to use this information).
// In addition to the main 'doDebugging' variable, there are additional
// variables to control what output the debugging produces. If the variable
// 'debugLogMessages' is false, no messages will be logged (using
// 'debugMessage') even if doDebugging is true. While the default for
// this flag is true, it may be set to false by the derived class when it
// wants to suppress debug messages. Similarly for 'debugStatistics'
// (statistics) and 'debugCreateSections' (for section).
//
// Because this class is inherited by other classes, all its variable and
// function names begin with 'debug' (except for doDebugging).

//
// The constructor takes as argument the priority with which the module 
// creates new log cycles. This allows a module to create new
// log cycles only when no higher priority module has opened a log cycle. 
// In addition, a flag indicating whether debugging is turned 
// on or off may be given (by default, if no argument is given, debugging 
// would be turned off). 
// The 'doDebugging' as well as the other flags controlling which
// types of debugging are turned on can later be modified by the derived class.
//

function DebugTracing(cyclePriority, doDebugging)
{
    this.cyclePriority = cyclePriority;
    this.doDebugging = !!doDebugging;
    this.debugLogMessages = true;
    this.debugStatistics = true;
    this.debugCreateSections = true;
}

// The following functions provide an interface to the coresponding functions
// defined on the DebugTracingLog. Before calling those functions, however,
// the functions below check that debugging is active.

DebugTracing.prototype.debugNewCycle = debugTracingDebugNewCycle;

function debugTracingDebugNewCycle()
{
    if(!this.doDebugging)
        return;
    
    globalDebugTracingLog.newCycle(this.cyclePriority);
}

DebugTracing.prototype.debugOpenLogSection = debugTracingDebugOpenLogSection;

function debugTracingDebugOpenLogSection(where)
{
    if(!this.doDebugging || !this.debugCreateSections)
        return;
    
    globalDebugTracingLog.openSection(where);
}

DebugTracing.prototype.debugCloseLogSection = debugTracingDebugCloseLogSection;

function debugTracingDebugCloseLogSection()
{
    if(!this.doDebugging)
        return;
    
    globalDebugTracingLog.closeSection();
}

DebugTracing.prototype.debugPushNextLog = debugTracingDebugPushNextLog;

function debugTracingDebugPushNextLog(logObj)
{
    if(!this.doDebugging)
        return;
    
    globalDebugTracingLog.pushNextLog(logObj);
}

DebugTracing.prototype.debugMessage = debugTracingDebugMessage;

function debugTracingDebugMessage()
{
    if(!this.doDebugging || !this.debugLogMessages)
        return;
    
    globalDebugTracingLog.message.apply(globalDebugTracingLog, arguments);
}

DebugTracing.prototype.debugIncCounter = debugTracingDebugIncCounter;

function debugTracingDebugIncCounter(counter)
{
    if(!this.doDebugging || !this.debugStatistics)
        return;
    
    globalDebugTracingLog.incCounter(counter);
}

DebugTracing.prototype.debugIncHistogramCounter =
    debugTracingDebugIncHistogramCounter;

function debugTracingDebugIncHistogramCounter(topic, counter)
{
    if(!this.doDebugging || !this.debugStatistics)
        return;
    
    globalDebugTracingLog.incHistogramCounter(topic, counter);
}

DebugTracing.prototype.debugRecordStatistics = 
    debugTracingDebugRecordStatistics;

function debugTracingDebugRecordStatistics()
{
    if(!this.doDebugging || !this.debugStatistics)
        return;
    
    globalDebugTracingLog.recordStatistics();
}

//////////////////////
// Utility Function //
//////////////////////

// This function returns a string representation of the given object.
// If the optional 'skipFunctions' argument is set, function members of
// objects are not displayed in the string.

function objToString(obj, skipFunctions, depth)
{
    if ("string" == typeof(obj))
        return obj;
    if (isJSONSupported && !depth) {
        return JSON.stringify(obj);
    }
    else {
        return _objToString(obj, skipFunctions, depth);
    }
}

function _objToString(obj, skipFunctions, depth)
{
    if(!obj || typeof(obj) != "object") {
        return typeof(obj) == "function" ? "<function>" : String(obj);
    }

    if(typeof(depth) != "undefined") {
        if(depth <= 0)
            return isArray(obj) ? "<array>" : "<object>";
        depth--;
    }
    
    var conv;
    
    if(isArray(obj)) {

        conv = "[";
        
        for(var i = 0, len = obj.length ; i < len ; i++) {
            if(i)
                conv += ", ";
            conv += _objToString(obj[i], skipFunctions, depth);
        }

        conv += "]";

        return conv;
    }

    conv = "{";
    
    for(var p in obj) {
        if(skipFunctions && typeof(obj[p]) == "function")
            continue;
        conv += (conv.length > 1) ? ", " : " ";
        conv += p + ": " + _objToString(obj[p], skipFunctions, depth);
    }
    
    conv += (conv.length > 1) ? " }" : "}";
    
    return conv;
}

