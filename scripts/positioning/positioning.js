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

// This is the main positioning object. It provides an interface to 
// the main positioning constraint calculation module: PosCalc.
// The Positioning class provides an extra administrative layer, 
// storing the callbacks which have to be notified when the offset
// of a watched pair has changed.
//
// The 'zeroRounding' threshold is used to indicate to the system when
// two numbers should be considered equal: if the absolute ratio
// between their difference and one of the two values is less than the
// given threshold. This is used in various places in the positioning
// calculation (e.g. deciding when an error is zero).

// %%include%%: "posCalc.js"

var positioningDefaultZeroRounding = 0.000001;

function Positioning(zeroRounding)
{
    // zero rounding
    this.zeroRounding = (zeroRounding == undefined) ?
        positioningDefaultZeroRounding : zeroRounding;
    
    this.posCalc = new PosCalc(this.zeroRounding);
    
    // pair management
    
    // For every watched pair which was registered, keep an array of 
    // the objects that use it.
    this.objectsUsingWatchedPairArr = {};

    // This table stores watched pairs which were registered with a callback
    // function. The attributes of the table are the IDs of the watched
    // pairs and the values are of the form:
    // {
    //    lastValue: <last offset for this pair for which the CBs were called>
    //    callbacks: <array of { dir: -1/+1 callingObj: obj, CB: CB } objects>
    // }
    // where each { dir: -1/+1, callingObj: obj, CB: CB } object is one
    // registered callback with a none-null CB. 'dir' indicates the direction
    // of the pair for which the callback was registered relative to the
    // cannonical order of the pair.
    this.watchedPairCallbacks = {};

    // This flag is turned on when recalculation begins and is turned off
    // after recalculation if completed.
    // This flag is mainly used to block recursive calls to the positioning
    // refresh function (through a callback).
    this.refreshing = false;
}

//////////////////////////////////
// Access To Pair Offset Values //
//////////////////////////////////

// Return the offset between the two points. If the pair does not
// exist or its value was not yet calculated, this function returns
// undefined.

Positioning.prototype.getPairOffset = Positioning_GetPairOffset;

function Positioning_GetPairOffset(point1, point2)
{
    if(point1 == point2)
        return 0; // if the two points are equal, the offset is fixed at 0
    
    var pair = this.getPair(point1, point2);

    return this.getOffsetByPairEntry(pair);
}

// Same as above, but takes the pair entry itself as input (this is mostly
// for internal use). This pair entry can be either of the form stored
// in the Cycles object (this is for watched pairs) or of the form
// stored in the linearConstraint object (this is for pairs assigned to
// a variable). All that is needed here is that the pair object have a
// pair ID (.id) and the direction of the pair relative to the canonical
// order (.dir).

Positioning.prototype.getOffsetByPairEntry = positioningGetOffsetByPairEntry;

function positioningGetOffsetByPairEntry(pair)
{
    if (!pair)
        return undefined;

    var canonicalVal = this.posCalc.pairValues[pair.id];
    return canonicalVal == undefined ? undefined : canonicalVal * pair.dir;
}

/////////////////////////////////////
// Access to List of Changed Pairs //
/////////////////////////////////////

// This function returns the list of changed pairs (chnaged since the last
// time this list was cleared). In this list, the attributes are the
// pair IDs and the values are the new values of the pairs. The values are
// given for the pair in canonical order.

Positioning.prototype.getChangedPairs = PositioningGetChangedPairs;

function PositioningGetChangedPairs()
{
    return this.posCalc.getChangedPairs();
}

/////////////////////
// Pair management //
/////////////////////

// All pairs are stored inside the position calculation object (PosCalc).
// However, there are several ways in which they can be added or removed.
// A pair can be added in three ways:
// 1. As part of a constraint. In this case it is always a normal pair.
// 2. Directly through the APIs given below. In this case it can be
//    added as either a normal or a watched pair (or both). Pairs added
//    in this way are considered to belong to the positioning calculation
//    object.
//
// There are two ways to remove a pair:
// 1. Explicitly through the API given below. There is a separate API for
//    removing a pair belonging to the positioning calculation object and
//    a pair belonging to the triggers.
//    a. Removing a pair belonging to the positioning calculation system.
//       This can be restricted to removing just the normal or just the
//       watched variant of the pair. If the normal variant is removed,
//       this also removes all constraints which use the pair. A watched
//       pair can only be removed if a normal variant exists or no trigger
//       using the pair is defined.
//       If a normal pair is removed and the pair is also used by the
//       triggers, the pair remains/becomes registered as a watched pair.
//    b. Removing a pair belonging to the triggers: this removes all triggers
//       making use of this pair. If the pair was also used registered as
//       a watched pair to the positioning calculation module, the pair is
//       not removed from the positioning calculation. If it was not
//       registered as such, the watched variant of the pair is removed.

///////////////////
// Getting pairs //
///////////////////

// This function gets the entry for the given pair, as stored in the
// pairEquations object or (if the pair is still waiting to be added)
// as stored in the watched pair addition queue. The two most important 
// (that is, useful) fields in the object returned are:
// {
//    id: <pair ID>
//    dir: -1/+1 // direction of this pair relative to the canonical direction
// }
// If the pair entry was returned from the addition queue (and is therefore
// not yet in the pairEquations object) the object returned would
// have the field 'queued' set.

Positioning.prototype.getPair = positioningGetPair;

function positioningGetPair(point1, point2)
{
    return this.posCalc.getPair(point1, point2, true);
}

// Get the two points (in canonical order) of the pair with the given ID.
// If no such pair exists, returns undefined. Otherwise, returns an array
// holding the two points.

Positioning.prototype.getPairPoints = positioningGetPairPoints;

function positioningGetPairPoints(pairId)
{
    return this.posCalc.getPairPoints(pairId);
}

/////////////////////////////////////
// Adding and removing constraints //
/////////////////////////////////////

// These functions are merely an interface to the identical functions
// in the PosCalc object.

Positioning.prototype.addLinear = positioningAddLinear;

function positioningAddLinear(p1point1, p1point2, p2point1, p2point2, scalar,
                              priority, id)
{
    var rc = this.posCalc.addLinear(p1point1, p1point2, p2point1, p2point2,
                                    scalar, priority, id);
    scheduleGeometryTask(false);
    return rc;
}

Positioning.prototype.removeLinearById = positioningRemoveLinearById;

function positioningRemoveLinearById(constraintId)
{
    var rc = this.posCalc.removeLinearById(constraintId);
    scheduleGeometryTask(false);
    return rc;
}

Positioning.prototype.addSegment = positioningAddSegment;

function positioningAddSegment(point1, point2, constraintId,
                               priority, extremum1, extremum2,
                               stability, preference, orGroups)
{
    this.posCalc.addSegment(point1, point2, constraintId,
                            priority, extremum1, extremum2,
                            stability, preference, orGroups);
    scheduleGeometryTask(false);
}

Positioning.prototype.removeSegment = positioningRemoveSegment;

function positioningRemoveSegment(point1, point2, constraintId)
{
    this.posCalc.removeSegment(point1, point2, constraintId);
    scheduleGeometryTask(false);
}

///////////////////////////////////////
// Adding and removing watched pairs //
///////////////////////////////////////

// This function adds the given pair as a watched pair for the calculation
// of positioning. The registering function is required
// to supply a 'callingObj' and optionally also a callback function ('CB').
// If a callback function is given then when the offset of the pair changes,
// this callback is called, with the 'callingObj' as its 'this' pointer
// and the new offset as its first argument,
// the pair ID as its second argument and the pair direction (-1/+1)
// relative to the cannical order as its third argument.
// If the pair is already registered then the callback will not be
// called with the current offset. It is up to the registering function
// to look up the current offset by calling 'getPairOffset'. If point1 and
// point2 are the same, the callback will also not be called, as
// 'getPairOffset' will always return a zero for such pairs.
// If no callback function is given, the 'callingObj' is still required
// as it identifies this registration of the watched pair. To delete a
// watched pair, one needs the specify the callingObj and CB given at the
// time of registration. Only after all callingObj + CB pairs are removed
// is the watched pair removed.
//
// The function returns the pair entry of the pair added, as stored in the 
// pairEquations object inside this.posCalc. This is not a copy, but 
// a pointer to the original entry, so it should not be modified and may 
// change when positioning is updated. This entry sepcified, among other
// things, the pair ID and the direction (+1/-1) of this pair relative
// to the canonical order of the pair (that is, which point is the first and
// which the second). For more details, see the documention of 
// PosCalc.addWatchedPair().
// If point1 and point2 are the same, no pair is registered and undefined
// is returned.

Positioning.prototype.addWatchedCalcPair = positioningAddWatchedCalcPair;

function positioningAddWatchedCalcPair(point1, point2, callingObj, CB)
{
    if(point1 == point2)
        return undefined; // trivial pair - not registered.
    
    var pair = this.posCalc.addWatchedPair(point1, point2);
    
    // record the callingObj and CB for this pair
    this.addObjUsingWatchedPair(pair, callingObj, CB);
    scheduleGeometryTask(false);

    return pair;
}

// This function removes the registration of the watched pair which has
// the given calling object (callingObj) and callback function (CB).
// If no such registration is found, the function does nothing. If, after
// removing the registration no more registrations remain, this function
// removes the watched instance of the pair. If the pair is (also) normal that
// instance remains unchanged. If the pair is also used by the triggers, the
// pair is not removed. No constraints are removed.

Positioning.prototype.removeWatchedCalcPair =
    positioningCalcRemoveWatchedCalcPair;

function positioningCalcRemoveWatchedCalcPair(point1, point2, callingObj, CB)
{
    // get the pair (and its ID)
    var pair = this.getPair(point1, point2);

    if(!pair)
        return;

    // remove this registration of a watched pair. This may also remove the
    // pair if no additional registrations remain.
    this.delObjUsingWatchedPair(point1, point2, pair, callingObj, CB);
}

//////////////////////////////////////////////
// Auxiliary Watched Pair Removal Functions //
//////////////////////////////////////////////

// Add the given object and callback for the given pair. If the exact same
// object abd callback are already registered, they are not added again.

Positioning.prototype.addObjUsingWatchedPair =
    Positioning_addObjUsingWatchedPair;

function Positioning_addObjUsingWatchedPair(pair, obj, CB)
{
    var objUsingWatchedPairArr = this.objectsUsingWatchedPairArr[pair.id];

    if(!objUsingWatchedPairArr)
        objUsingWatchedPairArr = this.objectsUsingWatchedPairArr[pair.id] = [];
    
    // check that the obj/CB pair has not yet been added
    for(var i = objUsingWatchedPairArr.length - 1 ; i >= 0 ; --i)
        if(objUsingWatchedPairArr[i].obj == obj &&
           objUsingWatchedPairArr[i].CB == CB)
            return; // already in the list
    
    objUsingWatchedPairArr[objUsingWatchedPairArr.length] = {
        obj: obj,
        CB: CB
    };

    if(CB) // add to callback table
        this.addWatchedCallback(pair, obj, CB);
}

// This function removes the registration of the given external object and
// callback (CB) as using this pair as a watched pair. If, as a result,
// the watched pair is no longer used, it is removed.
// The 'pair' object provided as input should be the one returned by a call
// to getPair(point1, point2, true).

Positioning.prototype.delObjUsingWatchedPair =
    Positioning_delObjUsingWatchedPair;

function Positioning_delObjUsingWatchedPair(point1, point2, pair, obj, CB)
{
    var objUsingWatchedPairArr = this.objectsUsingWatchedPairArr[pair.id];

    if(objUsingWatchedPairArr) {
        for (var i = 0; i < objUsingWatchedPairArr.length; i++) {
            if (objUsingWatchedPairArr[i].obj == obj &&
                objUsingWatchedPairArr[i].CB == CB) {
                objUsingWatchedPairArr.splice(i, 1);  // Delete this element
                break;
            }
        }
    }

    if(CB) // remove this callback from the callback table.
        this.removeWatchedCallback(pair.id, obj, CB);
    
    // remove the watched pair if it is no longer used by an external module
    this.delWatchedPairIfNotUsed(point1, point2, pair);
}

// This function checks whether this pair still has some external module
// registered as using it as a watched pair. If not, the pair is removed
// as a wathed pair (it may still remain as a normal pair).
// The 'pair' object provided as input should be the one returned by a call
// to getPair(point1, point2, true).

Positioning.prototype.delWatchedPairIfNotUsed =
    Positioning_delWatchedPairIfNotUsed;

function Positioning_delWatchedPairIfNotUsed(point1, point2, pair)
{
    // A pair that is used cannot be deleted
    if (this.objectsUsingWatchedPairArr[pair.id] &&
        this.objectsUsingWatchedPairArr[pair.id].length > 0)
        return;

    // watched pair no longer used by an external module
    delete this.objectsUsingWatchedPairArr[pair.id];

    this.posCalc.removeWatchedPair(point1, point2, pair);
}

////////////////////////////
// Watched Pair Callbacks //
////////////////////////////

// This function adds the given callback function (CB) and calling object
// (callingObj) to the list of callbacks for the given (watched) pair
// If CB is null/undefined, the callback is not added.
// This function does not allow the same callingObj + CB to be registered
// twice for the same pair.
// This function does not verify that the pair is indeed watched.

Positioning.prototype.addWatchedCallback = positioningAddWatchedCallback;

function positioningAddWatchedCallback(pair, callingObj, CB)
{
    if(!pair || !CB)
        return;

    if(!this.watchedPairCallbacks[pair.id]) {
        
        var lastValue = this.getOffsetByPairEntry(pair);

        if(lastValue !== undefined)
            lastValue *= pair.dir;

        this.watchedPairCallbacks[pair.id] = {
            // value for pair in canonical order 
            lastValue: lastValue,
            callbacks: []
        };
    }

    var callbacks = this.watchedPairCallbacks[pair.id].callbacks;
    
    for(var i = callbacks.length - 1 ; i >= 0 ; --i)
        if(callbacks[i].callingObj == callingObj && callbacks[i].CB == CB)
            return; // already registered
    
    var callbackEntry = {
        dir: pair.dir,
        callingObj: callingObj,
        CB: CB
    };
    
    // add this callback
    callbacks.push(callbackEntry);
}

Positioning.prototype.removeWatchedCallback = positioningRemoveWatchedCallback;

function positioningRemoveWatchedCallback(pairId, callingObj, CB)
{
    if(pairId == undefined || !CB)
        return;

    var entry =  this.watchedPairCallbacks[pairId];

    if(!entry)
        return;
    
    var callbacks = entry.callbacks;

    // search for the given callingObj and CB

    for(var i = callbacks.length - 1 ; i >= 0 ; --i) {
        if(callbacks[i].callingObj == callingObj && callbacks[i].CB == CB) {
            // found, remove it
            callbacks.splice(i, 1);
            // if no callbacks remain, remove the whole entry
            if(!callbacks.length)
                delete this.watchedPairCallbacks[pairId];
            return;
        }
    }
}

// This function goes over all pair registered in the watched callback table.
// For each of these pairs which appears in the changed pair list (of PosCalc)
// the function checks whether the value (after rounding) of the pair has
// changed since this function was last called (or since the pair was added,
// whichever came last). If the value has changed, the callbacks for that
// pair are called. The callback is called with the owner object as 'this',
// and with three arguments: the value of the pair, the pair ID and the pair
// direction (-1/+1 depending on whether the pair is in the canonical order
// or not).

// perhaps should run on 'changedPairs' instead of 'watchedPairCallbacks'
// when the first is shorter than the second? xxxxxxxxxxxxxxxxxxxxxxx

Positioning.prototype.callWatchedCallbacks = positioningCallWatchedCallback;

function positioningCallWatchedCallback()
{
    var changedPairs = this.getChangedPairs();
    
    for(var pairId in this.watchedPairCallbacks) {

        if(changedPairs[pairId] == undefined)
            continue;

        var entry = this.watchedPairCallbacks[pairId];
        
        if(entry.lastValue == changedPairs[pairId])
            continue;

        // value changed
        var value = entry.lastValue = changedPairs[pairId];

        // call the callbacks
        var callbacks = entry.callbacks;

        for(var i in callbacks)
            callbacks[i].CB.call(callbacks[i].callingObj,
                                 callbacks[i].dir * value, pairId,
                                 callbacks[i].dir);
    }
}

/////////////////////////////
// Refresh and Calculation //
/////////////////////////////

// This function repeatedly refreshes the positioning until there is no
// need to refresh anymore. The positioning calculation may need to be
// repeated several times because triggers firing as a result of positioning
// changes may then modify the constraints and triggers, thus requiring
// another round of calculation.
// To avoid entering an infinite loop due to incorrect configuration,
// or just blocking longer than allowed by the task queue, the function
// can take a timer as argument. It then checks in each round whether
// it exceeded the time allocated it by the timer (typically, this timer
// is the task queue timer). If the time allocated was exceeded,
// the function exits, returning 'false' to indicate that it
// did not complete its calculation. If the function completes the calculation
// before being timed out, it returns true.

Positioning.prototype.reposition = positioningReposition;

function positioningReposition(timer)
{
    while(this.needToRefresh()) {

        if(timer && timer.timedOut())
            return false;
        
        this.refresh();
    }

    return true;
}

// This function returns true if there is need to recalculate the positioning
// (pair offset changes)

Positioning.prototype.needToRefresh = positioningNeedToRefresh;

function positioningNeedToRefresh()
{
    // is there need to calculate pair offsets? 
    if(this.posCalc.needToRecalcPositioning())
        return true;

    return false;
}

// This function refreshes all positioning calculations (both calculating
// pair offsets and triggers)

Positioning.prototype.refresh = positioningRefresh;

function positioningRefresh()
{
    debugStartTimer("positioning", "positioning refresh");

    // flag to block recursive calls of this function
    if(this.refreshing)
        return;

    this.refreshing = true;

    debugStartTimer("positioning", "calculate all variables");
    
    // Recalculate all variable values using the current constraints.
    // This calculates both normal and watched variables.
    if(this.posCalc.needToRecalcPositioning())
        this.posCalc.solveConstraints();

    debugStopTimer("calculate all variables");

    debugStartTimer("positioning", "watched callbacks");
    
    // call callbacks for watched pairs whose offset has changed
    this.callWatchedCallbacks();

    debugStopTimer("watched callbacks");
    
    this.refreshing = false;
    
    debugStopTimer("positioning refresh");
}

// This function clears all solution changes (variable and pair values which
// changed in the last calculation).

Positioning.prototype.clearSolutionChanges = positioningClearSolutionChanges;

function positioningClearSolutionChanges()
{
    this.posCalc.clearSolutionChanges();
}

///////////////
// Debugging //
///////////////

/////////////////////////////////////////////////////////
// Access to Positioning Internal Data (for Debugging) //
/////////////////////////////////////////////////////////

// Given a pair of points, this function returns all pair cycles in which
// this pair appears (possibly none). A pair cycle is a cycle of
// pairs which close a loop (e.g. <p1,p2>, <p2,p3>, <p3,p1>). Several of
// the pairs in such a cycle may be associated with the same variable
// (this means that when the equations are solved, they will be collapsed
// into one variable).
// The function takes two point labels as its input. If the pair is part of
// one or more cycles, the function returns an object with cycle IDs
// as attributes and under each attribute, the cycle with that ID
// (each cycle is an object with the pair IDs of pairs which participate
// in the cycle as attributes and -1/+1 as values (depending on the direction
// in which the pair is traversed in the cycle).
// When a pair is a watched pair, only one cycle is returned, and the pair
// itself does not appear in the cycle (the given cycle is actually a path
// and the watched pair closes it to a cycle).
// The returned value is a Map() object whose keys are the the cycle IDs.

Positioning.prototype.debugGetPairCycles = positioningDebugGetPairCycles;

function positioningDebugGetPairCycles(point1, point2)
{
    // get the pair entry for these two points
    var pair = this.getPair(point1, point2);

    if(!pair || !pair.id || pair.queued)
        return undefined;

    // get the entry of this pair as recorded in the object which tracks
    // pair cycles.
    var entry = this.posCalc.pairEquations.edgesById[pair.id];

    var result = undefined;

    if (! entry) {
        return undefined;
    }
    
    if(entry.inForest || entry.isNormal) {
        // return the cycles this pair participates in
        var cycleIds =
            this.posCalc.pairEquations.cycles.componentIndex.get(pair.id);
        if(cycleIds) {
            var _self = this;
            result = {};
            cycleIds.forEach(function(e,cycleId) {
                result[cycleId] =
                    _self.posCalc.pairEquations.cycles.vectors[cycleId];
            });
        }
    } else if(entry.watchedCycle) {
        // watched pair, return the watched cycle for this pair
        result = {};
        result[entry.watchedCycle] = this.posCalc.pairEquations.
            watchedCycles.vectors[entry.watchedCycle];
    }

    return result;
}
