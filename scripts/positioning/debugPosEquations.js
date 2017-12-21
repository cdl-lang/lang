// Copyright 2017 Yoav Seginer.
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


// This file contains the debug functions of the PosEquations object.

// The debug module allows statistics and snapshots of various objects to
// be stored on the global debug logging object (globalDebugTracingObj).
//
// Object Snapshots and Log Messages
// =================================
//
// At each point in the code one can call the recording function as
// follows:
//
// this.debugRecord(<where string>, [<array of record types>],
//                  <debug messages>);
//
// The first argument should contain a string which can be used later to
// identify the place in the code where the information was recorded.
//
// The second argument should contain an array containing a subset of the
// following keywords, indicating the type of information to be recorded:
// 
// "errors": the IDs of the equations with error and the size of the error
//           (only equations with an error are recorded).
// "derivatives": the non-zero derivatives.
// "solution": the non-zero solution values.
// "error-equations": a copy of the equations which have an error
//                    (not only the equation ID).
// "zero-error-equations": a copy of the zero error equations which
//                    have variables with non-zero error derivatives
//                    appearing in them (these are the 'active' zero error
//                    equations).
// "resistance": the resistance of the variables which have a non-zero
//               error derivative or are bound in an equation where
//               non-zero error derivative variables appear.
// "variablesByResistance": the list of variables, sorted by their resistance
//               and total resistance.
// "violations": the information in the
//               'violatedVars' table.
// "optimizationSuspension": the information in the optimization suspension
//               table.
// "orGroups": this information in the posCalc.orGroups table. Groups are
//             reported here only if one of the variables in the group has
//             a non-zero error derivative or is bound in an equation where
//             non-zero error derivative variables appear.
//
// The third argument and on are treated as an array of values which will
// be converted into a log message. Each object or value in it is converted
// into a string and the strings are concatenated.
//
// Both the second and the third arguments are allowed to be undefined.
// If the array in either of these arguments contains a single string,
// the array may be omitted.
//
// When both the built-in logging types and a message are provided, these
// are stored in consecutive log entries. The message is stored as a
// plain string in the log array. The 'where' string is ignored in the
// message string.
//
// If one only wants to print a message, one can call
//
// this.debugMessage(<debug messages>);
//
// (this function is implemented in the DebugTracing object) 
//
// The functions this.debugOpenLogSection(<where string>) and
// this.debugCloseLogSection() can be used to open and close a log section
// in which subsequent logs will be stored. Such a log section occupies
// a single position in the list of logs created for a complete solution cycle.
// After calling 'debugCloseLogSection', subsequent logs will be placed at
// the top level of the log. Calling 'debugOpenLogSection' while a log
// section is already open will create a new log section right after the
// current log section (not inside it!).
// debugOpenLogSection() may optionally be given a 'where' string
// which will be added at the top of the log section.
//
// // (these functions are implemented in the DebugTracing object) 
//
// Collecting Statistics
// =====================
//
// Various statistics can be collected during debug mode. These are collected
// per solution cycle. Within every solution cycle, one can ask for
// any counter to be incremented by providing its name. There is no restriction
// on counter names and every counter would be reset to zero at the
// beginning of every solution cycle. To increment a counter, use the following
// function:
//
// debugIncCounter(<counter name>)
//
// (implemented in DebugTracing)
//
// At the end of the cycle, only counters which were incremented during the
// cycle will be output to the log. Other counters are not defined (and
// therefore are not printed) and their value is implicitly zero.
//
// In addition to counters incremented in the process of solving the
// equations, several counts are calculated at the beginning of the
// solution cycle. These include:
// - number of equations
// - number of variables
// - number of equations which need to be assigned bound variables
// - number of violations (suspended/not suspended)
// The are printed to the log at the beginning of the solution cycle.
// Incremental counters are printed to the log at the end of the solution
// cycle.
//
// Enabling Debugging
// ==================
// 
// The flag this.doDebugging needs to store an object specifying the types
// of debugging turned on for debugging to work. The object has the following
// format:
// {
//    trace: true|<object specifying debug types> // include this to produce 
//                                                // a complete trace, see 
//                                                // details below 
//    changes: true // this reports the variable and equation changes at
//                  // the beginning of every solution cycle. This indicates
//                  // the source of the need to recalculate
//    statistics: true // include this to generate statistics of the solution
//                     // process
// }
//
// If trace is 'true', object snapshots are created for all types of objects
// for which such snapshots are available (see list above). Alternatively,
// the 'trace' field can hold an object of the format:
// {
//    <data snapshot type>: true
//    .......
// }
// where the <data snapshot type> can be any of the types specified in the
// 'Object Snapshots and Log Messages' section (e.g. 'errors', 'derivatives',
// 'solution', etc.). When such an object is provided, data dumps are created
// only for data types appearing in this object. 
//
// Note that an empty 'doDebugging' object will not produce any debugging
// but may result in reduced performance because at every potential debug
// point it will be tested for the inclusion of the relevant flag.
// To turn off debugging it is therefore preferable to set doDebugging
// to false.
//

// This function looks at the curent state of 'doDebugging' and 
// uses it to set the various flags in 'DebugTracing' which control 
// what types of debugging are on.

PosEquations.prototype.debugSetDebugMode = posEquationsDebugSetDebugMode;

function posEquationsDebugSetDebugMode()
{
    if(!this.doDebugging) {
        // reset the defaults (for the next round)
        this.debugLogMessages = true;
        this.debugStatistics = true;
        this.debugCreateSections = true;
    } else if(typeof(this.doDebugging) != "object") {
        // will only print the messages
        this.debugLogMessages = true;
        this.debugCreateSections = true;
        this.debugStatistics = false;
    } else {
        this.debugLogMessages = !!this.doDebugging.trace;
        this.debugStatistics = !!this.doDebugging.statistics;
        this.debugCreateSections = !!this.doDebugging.trace;
    }
}

// This function creates a new log entry for a new complete solution cycle
// (a solution cycle is completed after finding a feasible solution and
// optimizing it).
// The function receives one argument - the list of variables whose initial
// value was refreshed (this happens before this function is called because
// only then is it clear whether any positioning calculations are required.

PosEquations.prototype.debugNewSolutionCycle =
    posEquationsDebugNewSolutionCycle;

function posEquationsDebugNewSolutionCycle(refreshed)
{
    if(!this.doDebugging)
        return;

    this.debugNewCycle(); // from the base class DebugTracing

    // log the list of variable and equation changes which require
    // recalculation
    this.debugReportProblemChanges(refreshed);
    
    // clear all statistics and calculate intial statistics
    this.debugInitStatistics(refreshed);
}

// This function records the data structures specified in 'recordTypes' to
// the log. See explanation at the beginning of the file for the various data
// structures which can be recorded.

PosEquations.prototype.debugRecord = posEquationsDebugRecord;

function posEquationsDebugRecord(where, recordTypes)
{
    if(!this.doDebugging || !this.doDebugging.trace)
        return; // no debug logging

    var activeTypes = typeof(this.doDebugging.trace) == "object" ?
        this.doDebugging.trace : undefined;

    var logObj = {};

    if(typeof(recordTypes) == "string")
        recordTypes = [recordTypes];
    
    // built-in data recording
    
    for(var i in recordTypes) {
        switch(recordTypes[i]) {
            case "errors":
                if(activeTypes && !activeTypes["errors"])
                    break; // not an active type 
                logObj.errors = {};
                for(var e in this.innerProducts)
                    logObj.errors[e] = this.innerProducts[e];
                break;
            case "derivatives":
                if(activeTypes && !activeTypes["derivatives"])
                    break; // not an active type 
                logObj.derivatives = {};
                for(var d in this.errorDerivatives) {
                    var varStr = this.debugGetVarStr(d);
                    logObj.derivatives[varStr] = this.errorDerivatives[d];
                }
                break;
            case "solution":
                if(activeTypes && !activeTypes["solution"])
                    break; // not an active type 
                logObj.solution = {};
                for(var i in this.solution)
                    if(this.solution[i] || isNaN(this.solution[i])) {
                        var varStr = this.debugGetVarStr(i);
                        logObj.solution[varStr] = this.solution[i];
                    }
                break;
            case "error-equations":
                if(activeTypes && !activeTypes["error-equations"])
                    break; // not an active type 
                logObj.errorEquations = {};
                for(var e in this.innerProducts)
                    logObj.errorEquations[e] = this.debugGetEquation(e);
                break;
            case "zero-error-equations":
                if(activeTypes && !activeTypes["zero-error-equations"])
                    break; // not an active type 
                logObj.zeroErrorEquations = {};
            for(var v in this.errorDerivatives) {
                var _self = this;
                this.equations.combinationComponentIndex(v).
                    forEach(function(t,e) {
                        if(_self.innerProducts[e] ||
                           logObj.zeroErrorEquations[e])
                            return; // not zero error or already recorded
                        logObj.zeroErrorEquations[e] =
                            _self.debugGetEquation(e);
                    });
                }
                break;
            case "resistance":
                if(activeTypes && !activeTypes["resistance"])
                    break; // not an active type 
                logObj.resistance = {};
                var boundAdded = {};
                
                for(var v in this.errorDerivatives) {
                    
                    logObj.resistance[this.debugGetVarStr(v)] =
                        this.debugGetResistance(v);

                    var _self = this;
                    this.equations.combinationComponentIndex(v).
                        forEach(function(t,e) {
                        if(_self.innerProducts[e] || boundAdded[e])
                            return; // not zero error or already logged
                        boundAdded[e] = true;
                        var boundVar = _self.boundVarsByEq[e];
                        if(boundVar == undefined)
                            return;
                        logObj.resistance[_self.debugGetVarStr(boundVar)] =
                          _self.debugGetResistance(boundVar);
                        });
                }
                break;
            case "variablesByResistance":

                if(activeTypes && !activeTypes["variablesByResistance"])
                    break; // not an active type 
                logObj.variablesByResistance = [];

                var node = this.variablesByResistance.first;
                
                while(node) {

                    var entry = dupObj(node.entry);
                    entry.sortVal = dupObj(node.sortVal);
                    logObj.variablesByResistance.push(entry);
                    
                    node = node.next;
                }
                
                break;
                
            case "violations":

                if(activeTypes && !activeTypes["violations"])
                    break; // not an active type 

                logObj.violations = [];
                
                var node = this.violatedVars.first;
                
                while(node) {
                    
                    var entry = {
                        variable: this.debugGetVarStr(node.entry.variable),
                        priority: node.sortVal,
                        target: node.entry.target,
                        value: this.solution[node.entry.variable],
                        suspended: !!node.entry.suspended
                    };

                    if(node.entry.suspended)
                        entry.suspended = true;
                    
                    logObj.violations.push(entry);
                    
                    node = node.next;
                }
                
                break;
            case "optimizationSuspension":
                if(activeTypes && !activeTypes["optimizationSuspension"])
                    break; // not an active type 
                logObj.optimizationSuspension =
                    dupObj(this.optimizationSuspension);
                break;
            case "orGroups":
                if(activeTypes && !activeTypes["orGroups"])
                    break; // not an active type 

                // or-groups to log: those whose variables
                // have non-zero error derivative or are bound in an
                // equation with such variables

                var boundAdded = {};
                logObj.orGroups = {};

                for(var v in this.errorDerivatives) {

                    var varOrGroups =
                        this.segmentConstraints.getVariableOrGroups(v);

                    for(var group in varOrGroups)
                        logObj.orGroups[group] = {};

                    var _self = this;
                    this.equations.combinationComponentIndex(v).
                        forEach(function(t,e) {
                        if(_self.innerProducts[e] || boundAdded[e])
                            return; // not zero error or already logged
                        boundAdded[e] = true;
                        var boundVar = _self.boundVarsByEq[e];
                        if(boundVar == undefined)
                            return;

                        varOrGroups = _self.segmentConstraints.
                            getVariableOrGroups(boundVar);

                        for(var group in varOrGroups)
                            logObj.orGroups[group] = {};
                        });
                }

                // construct the log entry for each or group

                for(var group in logObj.orGroups) {

                    var entry = this.posCalc.orGroups.orGroups[group];

                    if(!entry)
                        logObj.orGroups[group] = "cannot find entry!";
                    else {
                        var logEntry = logObj.orGroups[group];

                        logEntry.numSatisfied = entry.numSatisfied;
                        logEntry.satisfied = {};
                        for(var s in entry.satisfied)
                            logEntry.satisfied[this.debugGetVarStr(s)] =
                                entry.satisfied[s];
                        
                        logEntry.numViolated = entry.numViolated;
                        logEntry.violated = {};
                        for(var v in entry.violated)
                            logEntry.violated[this.debugGetVarStr(v)] =
                                entry.violated[v];
                    }
                }
                
                break;
        }
    }

    if(!isEmptyObj(logObj)) {
        logObj.where = where;
        this.debugPushNextLog(logObj);
    }

    if(arguments.length >= 3) {
        // extract the arguments (except the first two) 
        var args = Array.prototype.slice.call(arguments, 2);
        this.debugMessage.apply(this, args);
    }
}

// Return an object describing the given equation. This object should then
// be stored in the debug log

PosEquations.prototype.debugGetEquation = posEquationsDebugGetEquation;

function posEquationsDebugGetEquation(eqId)
{
    var equation = {};

    var eqVec = this.equationVecs[eqId];
    for(var i = 0, l = eqVec.length ; i < l ; ++i) {
        var entry = eqVec[i];
        var varStr = this.debugGetVarStr(entry.name);
        equation[varStr] = entry.value;
    }
    equation["bound variable"] = this.boundVarsByEq[eqId];

    return equation;
}

// Return an object describing the resistance of the given variable.
// This object should then be stored in the debug log

PosEquations.prototype.debugGetResistance = posEquationsDebugGetResistance;

function posEquationsDebugGetResistance(variable)
{
    var entry = this.resistance.variables[variable];

    if(!entry)
        return "no resistance defined";

    return dupObj(entry);
}

// Given a variable, this function returns a string describing this variable,
// to be used for debug printing. The string includes the variable index
// followed by pair IDs which belong to the variable. If there are more than
// two pairs associated with the variable, only the first two are included
// and '...' indicates that more pair IDs exist.

PosEquations.prototype.debugGetVarStr = posEquationsDebugGetVarStr;

function posEquationsDebugGetVarStr(variable)
{
    // the linear constraints module is responsible for the management
    // of variables.
    return this.segmentConstraints.linearConstraints.debugGetVarStr(variable);
}

////////////////
// Statistics //
////////////////

// This function clears all debug statistics from previous cycles (if such
// exist) and if debug statistics is turned on, calculates the initial
// statistics for the current cycle and writes them to the log.

PosEquations.prototype.debugInitStatistics = posEquationsDebugInitStatistics;

function posEquationsDebugInitStatistics(refreshed)
{
    if(!this.doDebugging || !this.doDebugging.statistics)
        return;

    var stats = { where: "initial statistics" };
    
    // count equation
    stats.equations = 0;
    for(var v in this.equationVecs)
        stats.equations++;

    // count variables
    stats.variables = this.equations.combinationSet.componentIndex.size;

    // count the number of variables whose initial value was refreshed
    stats.varInitRefreshed = 0;
    for(var v in refreshed)
        stats.varInitRefreshed++;
        
    // count the number of violations
    stats.suspendedViolations = 0;
    stats.activeViolations = 0;
    for(var v = this.violatedVars.first ; v ; v = v.next) {
        if(v.entry.suspended)
            stats.suspendedViolations++;
        else
            stats.activeViolations++;
    }

    // write the statistics to the log
    this.debugPushNextLog(stats);
}

/////////////
// Changes //
/////////////

// If the 'changes' debug mode is on, this function is called at the beginning
// of the solution cycle and it logs the variables and equations that
// changed since the last time a solution was found.

PosEquations.prototype.debugReportProblemChanges =
    posEquationsDebugReportProblemChanges;

function posEquationsDebugReportProblemChanges(refreshed)
{
    if(!this.doDebugging || !this.doDebugging.changes)
        return;

    var logObj = { where: "changes to problem from last solution" };
    
    // list the refreshed variables
    logObj.variables = {};

    for(var v in refreshed)
        logObj.variables[this.debugGetVarStr(v)] = this.solution[v];

    // list of changed equations
    logObj.changedEquations = {};
    
    for(var eq in this.changedEquations)
        logObj.changedEquations[eq] = this.debugGetEquation(eq);

    // list of equations where the bound variable needs to be refreshed
    // (this includes new equations)
    logObj.newBoundEquations = {};
    
    for(var eq in this.needToRefreshBoundVar)
        logObj.newBoundEquations[eq] = this.debugGetEquation(eq);

    this.debugPushNextLog(logObj);
}

//////////////////////////////////////////
// Optimization Suspension Verification //
//////////////////////////////////////////

// This function checks whether the values stored in the optimizationSuspension
// table are internally consistent, whether they are consistent with
// the currently defined equations, whether they are consistent with
// the optimization suspension recorded on the violated variables and
// whether the suspension is indeed correct, given the current resistance.
//
// The function returns an array specifying the problems found. The first
// entry in the array is a time stamp (to ensure the function was indeed
// recalculated in the debugger when it is called repeatedly). If all is well,
// the returned array should only contain this timestamp.

PosEquations.prototype.debugCheckOptimizationSuspension =
    posEquationsDebugCheckOptimizationSuspension;

function posEquationsDebugCheckOptimizationSuspension()
{
    var problems = [];

    // put a timestamp
    problems.push((new Date()).getTime());
    
    this.debugCheckOptimizationSuspensionInternalConsistency(problems);
    this.debugCheckOptimizationSuspensionCorrectness(problems);

    return problems;
}

// This function checks whether PosEquations is in debug mode and if it is,
// checks the consistency of the optimization suspension tables (using 
// the 'debugCheckOptimizationSuspension' function). If this results in
// any problems being reported, the function reports an internal error
// (which typically would exit to the debugger).

PosEquations.prototype.debugBreakOnOptimizationSuspensionErrors =
    posEquationsDebugBreakOnOptimizationSuspensionErrors;

function posEquationsDebugBreakOnOptimizationSuspensionErrors()
{
    var problems = this.debugCheckOptimizationSuspension();
    if(problems && problems.length > 1)
        mondriaInternalError(problems);
}

// This function checks whether the values stored in the optimizationSuspension
// table are internally consistent, whether they are consistent with
// the currently defined equations and whether they are consistent with
// the suspension information stored on the violated variables.
// The function receives an array 'problems' into which it records the
// problems it detects. If this array is not given, it will be created.
// The function returns the 'problems' array.

PosEquations.prototype.debugCheckOptimizationSuspensionInternalConsistency =
    posEquationsDebugCheckOptimizationSuspensionInternalConsistency;

function
posEquationsDebugCheckOptimizationSuspensionInternalConsistency(problems)
{
    if(!problems)
        problems = [];
    
    for(var blocked in this.optimizationSuspension.blocked) {

        // is this variable defined in the equations?
        if(!this.equations.hasComponent(blocked))
            problems.push("Blocked variable " + blocked +
                          " no longer in equations");
        // is the variable free?
        if(this.boundVars[blocked])
            problems.push("Blocked variable " + blocked +
                          " is bound (in equation " + this.boundVars[blocked] +
                          ")");
        
        // check whether the variable appears in the equations appearing in
        // its entry
        
        var blockedEntry = this.optimizationSuspension.blocked[blocked];

        if(!this.equationVecs[blockedEntry.blocking]) {
            problems.push("blocking equation " + blockedEntry.blocking +
                          " of blocked variable " + blocked +
                          " is no longer defined.");
        } else if(!this.equations.getValue(blockedEntry.blocking, blocked))
            problems.push("blocked variable " + blocked +
                          " does not appear in its blocking equation " +
                          blockedEntry.blocking);
        else if(!this.optimizationSuspension.equations[blockedEntry.blocking])
            problems.push("blocking equation " + blockedEntry.blocking +
                          " of blocked variable " + blocked +
                          " does not appear in the list" +
                          " of blocking equations.");
        else if(!this.optimizationSuspension.equations[blockedEntry.blocking].
                blocked[blocked])
            problems.push("blocked variable " + blocked +
                          " does not appear as blocked in equation " +
                          blockedEq);

        for(var blockedEq in blockedEntry.blockedEq) {
            if(!this.equationVecs[blockedEq]) {
                problems.push("blocked equation " + blockedEq +
                              " blocked by variable " + blocked +
                              " is no longer defined.");
            } else if(!this.equations.getValue(blockedEq, blocked))
                problems.push("blocked variable " + blocked +
                              " does not appear in equation " +
                              blockedEq + " which it blocks");
            else if(!this.optimizationSuspension.equations[blockedEq])
                problems.push("blocked equation " + blockedEq +
                              " blocked by variable " + blocked +
                              " does not appear in the list" +
                              " of blocking equations.");
            else if(!this.optimizationSuspension.equations[blockedEq].
                    blocking[blocked])
                problems.push("blocked variable " + blocked +
                              " does not appear in as blocking for equation " +
                              blockedEq + ", which it blocks");
        }
    }

    for(var selfBlocked in this.optimizationSuspension.selfBlocked) {

        if(!this.equations.hasComponent(selfBlocked))
            problems.push("Self-blocked variable " + selfBlocked +
                          " no longer in equations");
        // is the variable free?
        if(this.boundVars[selfBlocked])
            problems.push("Self-blocked variable " + selfBlocked +
                          " is bound (in equation " +
                          this.boundVars[selfBlocked] + ")");

        // does the variable appear in the equations which appear in its
        // entry

        var selfBlockedEntry =
            this.optimizationSuspension.selfBlocked[selfBlocked];

        for(var eqId in selfBlockedEntry.equations) {

            if(!this.equationVecs[eqId]) {
                problems.push("blocked equation " + eqId +
                              " of self-blocked variable " + selfBlocked +
                              " is no longer defined.");
            } else if(!this.equations.getValue(eqId, selfBlocked))
                problems.push("self-blocked variable " + selfBlocked +
                              " does not appear in the blocking equation " +
                              eqId);
            else if(!this.optimizationSuspension.equations[eqId]) {
                problems.push("blocking equation " + eqId +
                              " of self-blocked variable " + selfBlocked +
                              " does not appear in the list" +
                              " of blocking equations.");
            } else if(!this.optimizationSuspension.equations[eqId].
                      selfBlocked[selfBlocked]) {
                problems.push("self-blocked variable " + selfBlocked +
                              " does not appear as self-blocked for equation "
                              + eqId + ", which it blocks");
            }
        }
    }
    
    for(var eqId in this.optimizationSuspension.equations) {

        var eqEntry = this.optimizationSuspension.equations[eqId];
        
        // check that all blocked and blocking variables appear in
        // the block variable list and that the priorities are correct

        for(var blocked in eqEntry.blocked) {
            var blockedEntry = this.optimizationSuspension.blocked[blocked];

            if(!blockedEntry)
                problems.push("variable " + blocked +
                              " registered as blocked by equation " + eqId +
                              " but is not a blocked variable");
            else {
                if(blockedEntry.priority != eqEntry.optimizationPriority)
                    problems.push("the priority of the blocked variable " +
                                  blocked + " (" +
                                  blockedEntry.priority + ")" +
                                  " does not match the priority of its" +
                                  " blocking equation " + eqId + " (" +
                                  eqEntry.optimizationPriority + ")");
            }
        }

        for(var blocking in eqEntry.blocking) {
            var blockingEntry = this.optimizationSuspension.blocked[blocking];

            if(!blockingEntry)
                problems.push("variable " + blocking +
                              " registered as blocking for equation " + eqId +
                              " but is not a blocked variable");
            else {
                if(blockingEntry.priority == eqEntry.optimizationPriority) {
                    var blockingEqEntry = this.optimizationSuspension.
                        equations[blockingEntry.blocking];
                    // if blockingEqEntry does not exist, the problem is
                    // reported elsewhere
                    if(blockingEqEntry &&
                       blockingEqEntry.suspensionId >= eqEntry.suspensionId)
                        problems.push("blocked variable " + blocking +
                                      " is blocking for equation " + eqId +
                                      " but both have same priority" +
                                      " and the suspension ID of" +
                                      " the equation (" + eqEntry.suspensionId
                                      + " is not larger than that of the" +
                                      " equation blocking the variable (" +
                                      blockingEqEntry.suspensionId + ", eq.= "
                                      + blockingEntry.blocking + ")");
                } else if(blockingEntry.priority <
                          eqEntry.optimizationPriority) {
                    problems.push("the priority of the blocked variable " +
                                  blocking + " (" +
                                  blockingEntry.priority + ")" +
                                  " is smaller than the priority of " +
                                  " equation " + eqId + " (" +
                                  eqEntry.optimizationPriority + ")" +
                                  " which it blocks");
                }
            }
        }

        for(var selfBlocked in eqEntry.selfBlocked) {
            var entry = this.optimizationSuspension.selfBlocked[selfBlocked];

            if(!entry)
                problems.push("variable " + selfBlocked +
                              " registered as self-blocked for equation " +
                              eqId + " but is not a self-blocked variable");
            else if(!entry.equations[eqId])
                problems.push("variable " + selfBlocked +
                              " registered as self-blocked for equation " +
                              eqId + " but equation is not registered as" +
                              " blocked by it");
        }
        
        // check consistency with the violated variable which is the
        // bound variable in this equation

        var violated = this.boundVarsByEq[eqId];

        if(violated == undefined) {
            problems.push("no bound variable defined for blocking equation " +
                          eqId);
        } else {
            var node = this.violatedVars.getNode(violated, true);

            if(!node)
                problems.push("bound variable (" + violated +
                              ") of blocking equation " + eqId +
                              " is not violated");
            else {
                if(node.sortVal != eqEntry.optimizationPriority) {
                    problems.push("violation priority of bound variable " +
                                  violated + " (" + node.sortVal +
                                  ") does not equal the priority (" +
                                  eqEntry.optimizationPriority +
                                  ") of its blocking equation (" + eqId + ")");
                }

                var direction = node.entry.target - this.solution[violated];
                
                if(direction * eqEntry.optimizationDir <= 0) {
                    problems.push("optimization direction of bound variable " +
                                  violated + " (" + direction +
                                  " does not agree with the direction (" +
                                  eqEntry.optimizationDir + ") recorded " +
                                  " on its blocking equation (" + eqId + ")");
                }

                // check the suspension list recorded on the violated variable
                if(!node.entry.suspended) {
                    problems.push("missing suspension flag on violated" +
                                  " variable " + violated +
                                  " which is bound in blocking eq. " + eqId); 
                }
            }
        }
    }

    // check that every suspended violated variable with a non-empty
    // 'suspended' object has either a corresponding blocking equation
    // or is blocked or self-blocked with the proper priority

    for(var node = this.violatedVars.first ; node ; node = node.next) {
        
        if(!node.entry.suspended)
            continue;
        
        var eqId = this.boundVars[node.entry.variable];
        
        if(eqId == undefined) {
            
            var selfBlockedEntry = 
                this.optimizationSuspension.selfBlocked[node.entry.variable];
            var blockedEntry = 
                this.optimizationSuspension.blocked[node.entry.variable];
            
            if(selfBlockedEntry) {
                if(node.entry.sortVal > selfBlockedEntry.resistance)
                    problems.push("suspended violated variable " + 
                                  node.entry.variable + 
                                  " is self-blocking but" + 
                                  " has higher violation priority (" + 
                                  node.entry.sortVal + 
                                  ") than its self-blocking resistance (" +
                                  selfBlockedEntry.resistance + ")");
            } else if(blockedEntry) {
                if(node.entry.sortVal > blockedEntry.priority)
                    problems.push("suspended violated variable " + 
                                  node.entry.variable + 
                                  " is blocked but" + 
                                  " has higher violation priority (" + 
                                  node.entry.sortVal + 
                                  ") than its blocked priority (" +
                                  blockedEntry.priority + ")");
            } else
                problems.push("suspended violated variable " +
                              node.entry.variable
                              + " is free but is not blocked or self-blocked");
        } else if(!this.optimizationSuspension.equations[eqId]) {
            // variable is suspended, but its equation not blocked, is
            // it self blocked?
            if(node.sortVal >
               this.resistance.getMinResistance(node.entry.variable))
                // not self blocked
                problems.push("suspended violated variable " +
                              node.entry.variable
                              + " is bound," +
                              " but it is not self-blocked and" +
                              " its equation is not blocking");
        }
    }
    
    return problems;
}

// This function checks the correctness of the optimization suspension
// as recorded in the optimization suspension tables. The function assumes
// that the internal consistency of these tables was already checked and
// that their consistency with the violated variables was also verified.
// It therefore only checks that given the current resistance, the
// optimization currently suspended should indeed be suspended.
// The function receives an array 'problems' to which it pushes any
// problems it detects.

PosEquations.prototype.debugCheckOptimizationSuspensionCorrectness =
    posEquationsDebugCheckOptimizationSuspensionCorrectness;

function
posEquationsDebugCheckOptimizationSuspensionCorrectness(problems)
{
    if(!problems)
        problems = [];

    for(var eqId in this.optimizationSuspension.equations) {

        var eqEntry = this.optimizationSuspension.equations[eqId];

        if(!this.equationVecs[eqId])
            continue; // this problem is reported elsewhere

        // the optimization direction and priority of the equation were
        // already verified elsewhere and we assume here that they are
        // correct.
        
        // loop over the blocked variables of this equation
        for(var blocked in eqEntry.blocked) {
            var blockedEntry = this.optimizationSuspension.blocked[blocked];

            if(!blockedEntry)
                break; // this problems was reported elsewhere

            var relativeDir = this.equations.getValue(eqId, eqEntry.boundVar) *
                this.equations.getValue(eqId, blocked);
            
            // check resistance, relative sign and resistance direction
            if(blockedEntry.relativeSign * relativeDir <= 0) {
                problems.push("incorrect relative sign for blocked variable "+
                              blocked + " in its blocking equation (" + eqId +
                              ") should be: " + relativeDir
                              + " but is " + blockedEntry.relativeSign);
                              
            }
            
            var resistanceDir = relativeDir * -eqEntry.optimizationDir;
            
            if(blockedEntry.resistanceDir * resistanceDir <= 0) {
                problems.push("incorrect resistance direction for" +
                              " blocked variable "+
                              blocked + " in its blocking equation (" + eqId +
                              ") should be: " + resistanceDir
                              + " but is " + blockedEntry.resistanceDir);
            }
            
            // check that the resistance in the resistance direction is
            // at least the blocking priority

            var directionStr = resistanceDir > 0 ? "up" : "down";

            if(this.resistance.getResistance(blocked, directionStr) <
               blockedEntry.priority &&
               this.resistance.getSatOrGroupResistance(blocked, directionStr) <
               blockedEntry.priority) {
                problems.push("resistance in direction of optimization " +
                              "of blocked variable "+
                              blocked + " (" + resistance +
                              ") smaller than its blocked priority (" +
                              blockedEntry.priority + ")");
            }
        }
    }

    for(var selfBlocked in this.optimizationSuspension.selfBlocked) {
        
        var resistance = this.resistance.getMinResistance(selfBlocked);
        var registeredResistance =
            this.optimizationSuspension.selfBlocked[selfBlocked].resistance;
        
        if(resistance != registeredResistance)
            problems.push("self blocked variable " + selfBlocked +
                          " registered with resistance " + registeredResistance
                          + " but the actual resistance is " +
                          resistance);
    }
    
    return problems;
}

////////////////
// Violations //
////////////////

// This function goes over all variables in the equations and reports those
// variables which have a violation. It reports the type of violation.
// The function returns an object with an entry for each variable which has
// a violation.

PosEquations.prototype.debugReportViolations =
    posEquationsDebugReportViolations;

function posEquationsDebugReportViolations()
{
    var result = {};

    for(var variable in this.resistance.variables) {

        var entry = this.resistance.variables[variable];
        var violations = undefined;
        
        if(entry.violatedMinPriority != undefined &&
           entry.violatedMinPriority > -Infinity) {
            if(!violations)
                violations = {};
            violations.minViolation = entry.violatedMinValue;
            
            violations.minViolationPriority = entry.violatedMinPriority;
        }

        if(entry.violatedMaxPriority != undefined &&
           entry.violatedMaxPriority > -Infinity) {
            if(!violations)
                violations = {};
            violations.maxViolation = entry.violatedMaxValue;
            
            violations.maxViolationPriority = entry.violatedMaxPriority;
        }

        if(violations) {
            violations.currentValue =
                this.solution[variable] ? this.solution[variable] : 0;
            result[this.debugGetVarStr(variable)] = violations;
        }
    }

    return result;
}

// Given a pair ID, this function returns an array with the variables which
// are associated with this pair and which have a violation. This set is 
// the subset of the main variable associated with the pair and all its clones
// which have a violation defined on them. If there is no violation on any of
// these variables, an empty list is returned.

PosEquations.prototype.debugGetViolatedVarsByPairId = 
  posEquationsDebugGetViolatedVarsByPairId;

function posEquationsDebugGetViolatedVarsByPairId(pairId)
{
  var pairEntry = globalPos.posCalc.segmentConstraints.pairById[pairId];
  if (!pairEntry)
    return [];

  var variable = pairEntry.index;
  result = [];

  if(this.violatedVars.getNode(variable, true))
    result.push(variable);

  // check whether this variable has any clones and test each of them for
  // violations

  var varentry = globalPos.posCalc.linearConstraints.variables[variable];

  for (var clone in varentry) {

    if(varentry[clone] != "clone")
      continue;

    if(this.violatedVars.getNode(clone, true))
      result.push(clone);
  }

  return result;
}

// Given a variable, this function checks whether the variable has a violation.
// If it does, the function returns an object of the form:
// {
//    variable: variable, // the variable for which this object was created
//    priority: <violation priority>
//    value: <current value>
//    target: <target value to resolve the violation>
//    blockedBy: {
//        <variable>: {
//             direction: "up"|"down" // direction of movement of blocking
//                                    // variable which is blocked
//             resistance: <resistance to movement in this direction>
//        }
//        .....
//    }
//    equations: { // equations in which the above variables were blocked
//        <equation ID>: true,
//        ....
//    }
// }
// If the variable has no violation, the strong "no violation" is returned.

PosEquations.prototype.debugGetViolation = posEquationsDebugGetViolation;

function posEquationsDebugGetViolation(variable)
{
    var node = this.violatedVars.getNode(variable, true);

    if(!node)
        return "no violation";

    var result = {
        variable: variable,
        priority: node.sortVal,
        value: this.solution[variable],
        target: node.entry.target,
        blockedBy: {},
        equations: {}
    };

    // direction of optimization
    var direction = result.target - result.value;
    
    // add the variable
    this.debugAddBlockingToResult(result, variable, direction);

    return result;
}

// This function adds the given variable to the list of 'blockedBy' on
// the given 'result'. 'direction' is the direction of blocking we are
// interested in (positive or negative number) for that variable.
// If the resistance of the variable in this direction is at least the
// priority given in result.priority, the variable is recorded.
// If the resistance is lower than the function checks whether the
// variable is blocked in the optimization suspension table or is
// a bound variable in a blocking equation in that table. If it is
// (it should be) and the equation was not yet recorded on the result
// object, the function goes over all variable in the blocking equation
// (of the blocked variable or bound variable) and adds them with direction
// equal to the direction which would allow movement in the given direction.

PosEquations.prototype.debugAddBlockingToResult =
    posEquationsDebugAddBlockingToResult;

function posEquationsDebugAddBlockingToResult(result, variable, direction)
{
    // check the resistance of the variable in the given direction
    var resistance = (direction > 0) ?
        this.resistance.getUpResistance(variable) :
        this.resistance.getDownResistance(variable);

    if(resistance >= result.priority) {
        // add the variable
        var entry = result.blockedBy[variable] = {};
        entry.direction = direction > 0 ? "up" : "down";
        entry.resistance = resistance;
        return;
    }

    // check whether this is a blocked variable
    
    var blockedEntry = this.optimizationSuspension.blocked[variable];

    if(blockedEntry) {

        // blocked variable
        if(result.equations[blockedEntry.blocking])
            return; // equation already recorded, do nothing
        else
            // add all the equation's variables
            this.debugAddBlockingEquationToResult(result,
                                                  blockedEntry.blocking,
                                                  variable, direction);

        return;
    } else {

        // is this a bound variable?
        
        var eqId = this.boundVars[variable];

        if(eqId) {
            if(!result.equations[eqId])
                // add the equation's variable
                this.debugAddBlockingEquationToResult(result, eqId, variable,
                                                      direction);
            return;
        }
    }

    // probably an indication of some error
    var entry = result.blockedBy[variable] = {};
    entry.direction = direction > 0 ? "up" : "down";
    entry.resistance = "not blocked!";
}

// If the given equation is a blocked equation, this function adds all
// variable in the given equation to the list of 'blockedBy' on
// the given result. 'blocked' is a variable blocked by this equation.
// Each variable is added with the direction in which it blocked the
// movement of 'blocked' in the given 'direction'. The 'blocked'
// variable is not added here.

PosEquations.prototype.debugAddBlockingEquationToResult =
    posEquationsDebugAddBlockingEquationToResult;

function posEquationsDebugAddBlockingEquationToResult(result, eqId,
                                                      blocked, direction)
{
    result.equations[eqId] = true;
            
    var equation = this.equationVecs[eqId];

    if(!equation || !this.equations.getValue(eqId, blocked))
        return;
    
    var blockedValue = this.equations.getValue(eqId, blocked);

    for(var i = 0, l = equation.length ; i < l ; ++i) {

        var v = equation[i].name;

        if(v == blocked)
            continue;
        
        this.debugAddBlockingToResult(result, v,
                                      -direction * equation[i].value *
                                      blockedValue);
    }
}
    
////////////////////////////////
// Additional Debug Functions // 
////////////////////////////////

// This function creates an inner product object between the current solution
// vector and the base equations (before performing linear transformations
// on these equations). Once this object is created, it is updated
// automatically for changes in the base equations but not for changes in the
// solution. To update for changes in the solution, call this function
// again.

PosEquations.prototype.debugUpdateInnerProdOfBaseEqWithSolution =
    posEquationsDebugUpdateInnerProdOfBaseEqWithSolution;

function posEquationsDebugUpdateInnerProdOfBaseEqWithSolution()
{
    if(!this.debugInnerProductWithBaseEq) {
        this.debugInnerProductWithBaseEq =
            new VecInnerProducts(this.equations.baseSet, this.solution,
                                 this.zeroRounding);
    } else
        this.debugInnerProductWithBaseEq.calcDualInnerProducts();
    
    return this.debugInnerProductWithBaseEq;
}

///////////////////////
// Utility Functions //
///////////////////////

function dupObj(obj0, maxDepth)
{
    return rdupObj(obj0, maxDepth, 0);
}

function rdupObj(obj0, maxDepth, dupObjRecursionDepth)
{
    if (maxDepth === undefined)
        maxDepth = 1000;

    if (dupObjRecursionDepth > 20) {
        mondriaInternalError('DupObj recursion level: ' + dupObjRecursionDepth);
    }
    dupObjRecursionDepth++;

    if(!obj0 || maxDepth < 0 || typeof(obj0) != "object")
        return obj0;

    var newObj0;
    if (obj0 instanceof Array) {
        newObj0 = [];
        //newObj0.length = obj0.length;
    } else {
        newObj0 = {};
    }
    for(var i0 in obj0) {
        var obj1 = obj0[i0];
        if (maxDepth < 1 || !obj1 || (typeof(obj1) != "object")) {
            newObj0[i0] = obj1;
        } else {
            var newObj1;
            if (obj1 instanceof Array) {
                newObj1 = [];
                //newObj1.length = obj1.length;
            } else {
                newObj1 = {};
            }
            for(var i1 in obj1) {
                var obj2 = obj1[i1];
                if (maxDepth < 2 || !obj2 || (typeof(obj2) != "object")) {
                    newObj1[i1] = obj2;
                } else {
                    var newObj2;
                    if (obj2 instanceof Array) {
                        newObj2 = [];
                        //newObj2.length = obj2.length;
                    } else {
                        newObj2 = {};
                    }
                    for(var i2 in obj2) {
                        var obj3 = obj2[i2];
                        if (maxDepth < 3 || !obj3 || (typeof(obj3) != "object")) {
                            newObj2[i2] = obj3;
                        } else {
                            var newObj3;
                            if (obj3 instanceof Array) {
                                newObj3 = [];
                                //newObj3.length = obj3.length;
                            } else {
                                newObj3 = {};
                            }
                            for(var i3 in obj3) {
                                var obj4 = obj3[i3];
                                if (maxDepth < 4 || !obj4 || (typeof(obj4) != "object")) {
                                    newObj3[i3] = obj4;
                                } else {
                                    var newObj4;
                                    if (obj4 instanceof Array) {
                                        newObj4 = [];
                                        //newObj4.length = obj4.length;
                                    } else {
                                        newObj4 = {};
                                    }
                                    for(var i4 in obj4) {
                                        var obj5 = obj4[i4];
                                        if (maxDepth < 5 || !obj5 || (typeof(obj5) != "object")) {
                                            newObj4[i4] = obj5;
                                        } else {
                                            var newObj5;
                                            if (obj5 instanceof Array) {
                                                newObj5 = [];
                                                //newObj5.length = obj5.length;
                                            } else {
                                                newObj5 = {};
                                            }
                                            for(var i5 in obj5) {
                                                var obj6 = obj5[i5];
                                                if (maxDepth < 6 || !obj6 ||
                                                    (typeof(obj6) != "object"))
                                                {
                                                    newObj5[i5] = obj6;
                                                } else {
                                                    newObj5[i5] =
                                                        rdupObj(obj6,
                                                                maxDepth - 6);
                                                }
                                            }
                                            newObj4[i4] = newObj5;
                                        }
                                    }
                                    newObj3[i3] = newObj4;
                                }
                            }
                            newObj2[i2] = newObj3;
                        }
                    }
                    newObj1[i1] = newObj2;
                }
            }
            newObj0[i0] = newObj1;
        }
    }
    return newObj0;
}
