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


// The object in this file is the main positioning calculation object.
// It performs two basic functions:
// 1. It allows one to add and remove constraints (segment
//    constraint, linear constraints and preference and stability constraints).
//    It is also possible to add pairs of points for which no
//    constraint is defined. The offset for these pairs will then also be
//    calculated (though no restriction is imposed on this offset).
//    Such unconstrained offsets are registered as 'watched' pairs.
//    The offset of watched pairs is never used to calculate the offsets 
//    of normal pairs (pairs added by constraints) but watched pairs
//    can be used to calculate the offset of some other watched
//    pairs.
// 2. The object can be requested to solve the constraints. It will
//    do so beginning with the previous solution. The object then indicates
//    for which pairs the offset has changed since the previous solution.
//
// The linear, segment, stability and preference constraints are stored on
// the linearConstraints and segmentConstraints sub-objects of this object.
// The linearConstraints sub-object is also used to maintain the set of
// point pairs managed by this object. This is required to ensure that each
// pair is assigned a variable index.
//
// Sometimes, the offsets of the pairs are not fully defined by the
// constraints. In such cases, the "min" preference is used as a default.
// Specifically, if a normal pair is not constrained at all, its offset will be
// set to zero.
//
// The 'zeroRounding' argument of the Constructor allows the caller to
// specify the ratio (in absolute value) between the result of 
// an addition/subtraction operation and the values added/subtracted 
// under which the result would be considered 0 (that is, if the result 
// is much smaller, in absolute value, than the values added/subtracted,
// the result is considered zero). Note that it does not matter with which of
// the two numbers on which the opertion was performed we compare. 
// If no zeroRounding is given (or a zero or negative value is
// given), the system applies the default zero rounding. 

// 1 millionth seem more than reasonable given the accuracy of the real
// arithmetic on the one hand and the fact that any ratio smaller than
// at most 1/100 is meaningless in the constraints.

// %%include%%: "linearConstraints.js"
// %%include%%: "segmentConstraints.js"
// %%include%%: "orGroups.js"
// %%include%%: "cycles.js"
// %%include%%: "posEquations.js"
// %%include%%: "vecInnerProducts.js"

var posCalcDefaultZeroRounding = 0.000001;

inherit(PosCalc, DebugTracing);
function PosCalc(zeroRounding)
{
    // zero rounding
    this.zeroRounding = (zeroRounding && zeroRounding > 0) ?
        zeroRounding : posCalcDefaultZeroRounding;

    // Constraints
    
    this.linearConstraints = new LinearConstraints();
    this.segmentConstraints =
        new SegmentConstraints(this.linearConstraints);

    // or-group handling
    this.orGroups = new OrGroups(this.segmentConstraints);
    
    // Equations
    
    // This cycles object tracks the pair cycles. It also serves to store
    // all pairs for which offsets need to be calculated.
    this.pairEquations = new Cycles();
    
    // This object holds the set of equations to be solved and solves the
    // equations.
    this.equations = new PosEquations(this);

    // This table stores the vector ID conversion from cycles in
    // 'pairEquations' to equations in 'equations'. The attribute is the
    // 'pairEquations' cycle ID and the value
    // is <base ID>, the ID of the equation added to the base set.
    this.idConvert = {};

    // This table stored for each clone variable the ID of the cloning
    // equation created for it. The attributes of the table are clone variables
    // and the values are equation IDs.
    this.cloneEquations = {};
    
    // This vector holds the offset values of all point pairs. The attributes
    // in the vector are the pairIds and the values are the offsets
    // for the pairs in canonical order.
    this.pairValues = {};
    
    // watched pairs
    
    // This object calculates inner products between the vector of pair
    // offset values and the vectors defining the watched pairs.
    this.watchedInProdObj =
        new VecInnerProducts(this.pairEquations.watchedCycles,
                             this.pairValues, this.zeroRounding);
    // the table of inner products (the watched pair offsets)
    this.watchedInProd = this.watchedInProdObj.innerProducts;
    
    // solution
    
    // Each variable and the value assigned to it
    this.variables = {};
    
    // new variable added since the solution was last calculated. If this
    // variable was split off an existing variable (by the removal of 
    // a linear constraint) the value under this variable in this table is
    // the initial value for this variable, based on the value of the 
    // variable from which it was split off. This is determined by the 'change'
    // entry for the pair which is assigned to this variable (and was
    // previously assigned to another variable). If there are multiple
    // such pairs for the same new variable, these may result in conflicting
    // initial values. In that case (since this is only an initial value)
    // the last of these pairs updated will determine the initial value.
    // If this new variable is not split off an existing variable (and it
    // therefore has no initial value, 'undefined' is stored under it.
    this.newVariables = {};

    // This table stores the existing offsets of pairs which are associated
    // with a new variable (either because the pair is new or because
    // the pair was previously watched and was not assigned a variable).
    // This table does not store values for pairs which were previously
    // assigned a variable and are about to switch to a new variable
    // (the values of those variables are stored directly in the newVariables
    // table). Moreover, this table does not necessarily store values for
    // all pairs being assigned a new variable. It only does so for pairs
    // for which this was requested (for example, when adding a stability
    // constraint, which should be relative to the existing offset, even if
    // the pair was not previously defined). Moreover, the offset is
    // available only if in the previous solution there was a path between
    // the two points of this pair.
    // The values in this table cannot be added directly to the 'newVariables'
    // table but must wait until all linear constraints have been
    // removed and added, to determine the raio between the variable and
    // the pair.
    // This table is cleared after initial values have been assigned to new
    // variables.
    // The keys to this table are pair IDs and the offsets are for the pair
    // in canonical order.
    this.newVarPairValues = {};

    
    // a list of variables whose value changed between the previous solution
    // and the current solution.
    this.changedVariables = {};
    
    // The list of pairs (by ID) whose value changed between the previous
    // solution and the current solution (this includes both the pairs
    // whose index/ratio changed and pairs for which the value of the
    // associated variable has changed).
    // Because every pair ID has two pairs associated with it (p1,p2) and
    // (p2,p1) and their values are the additive inverses (minus) of each
    // other, the entry under each pair ID hold the value of the pair in
    // canonical order (e.g. if the ID is p1;p2 then the value of (p1,p2)).
    this.changedPairs = {};

    // registration queues

    // Each queue below stores a separate list of updates for the positioning.
    // These are held separately so that they can be flushed to the 
    // positioning system in the most efficient order.
    // For each table there is a flag indicating whether the table
    // contains any updates which need to be flushed.  This flag is
    // set when an entry is added to the table.  The flag is only
    // reset when the updates are flushed. Even if all updates in the
    // table are removed before the flush, this flag remains set. This
    // simplifies its update and the flag is only needed for
    // optimization (so that we do not actually have to loop over the
    // table to detect that it is empty).

    // this object stores new watched pairs whose addition was requested 
    // by a call to addWatchedPair(). Only watched pairs not found in 
    // the pairEquations object are queued here.
    // Since the edge is not yet in pairEquations, the entry in this
    // table defines the canonical order of the points in the pair.
    // Entries whose value in the table is undfined should not be added
    // (these are entries which were first added and then removed before
    // the update took place).
    this.addedNewWatchedPairs = {};
    this.hasAddedNewWatchedPairs = false;
    // this object stores watched pairs which should be removed and 
    // for which an entry exists in pairEquations. These pairs are
    // then stored here under their ID and separated into two lists:
    // those edges which are in the forest and those which are not.
    // Those edges not in the forest should be removed first, as their
    // removal does not require a recompuation of the forest structure.
    // Entries whose value in the table is undfined should not be reomved
    // (these are entries which were first removed and then added again before
    // the update took place).
    this.removedWatchedPairsInForest = {};
    this.hasRemovedWatchedPairsInForest = false;
    this.removedWatchedPairsNotInForest = {};
    this.hasRemovedWatchedPairsNotInForest = false;

    // constraint registration queues

    // under each constraint ID for which an update was received, this
    // table stores an array with the argument appearing in the last
    // update for that constraint (in the case of a removed linear constraint,
    // 'true' is stored). A separate queue is constructed for
    // linear and segment constraints and for removed and added constraints.
    // The same constraint ID cannot appear both in the added and removed
    // queue.
    this.addedLinearConstraints = {};
    this.hasAddedLinearConstraints = false;
    this.removedLinearConstraints = {};
    this.hasRemovedLinearConstraints = false;
    this.addedSegmentConstraints = {};
    this.hasAddedSegmentConstraints = false;
    this.removedSegmentConstraints = {};
    this.hasRemovedSegmentConstraints = false;

    // debugging

    // inherit from DebugTracing
    // The log cycle priority (2) should be higher than that of PosEquations.
    this.DebugTracing(2);
}

////////////////////////////////////////
// Getting, Adding and Removing Pairs //
////////////////////////////////////////

// This function gets the entry for the given pair from the pairEquations
// object. The object returned contains at least the following
// two fields:
// {
//    id: <pair ID - the same in both cases>
//    dir: -1/+1 // direction of this pair relative to the canonical direction
// }
// If the flag 'includeQueuedUpdates' is true and the entry for this pair
// cannot be found in the 'pairEquations' table, the function checks whether
// an entry for this pair exists in the 'addedNewWatchedPairs' table.
// If it does (and the entry for this pair in the table is not undefined)
// this entry is returned (the pair has already been queued for addition).
// In case the queued entry is returned, the object returned has the 
// field 'queued' set.

PosCalc.prototype.getPair = posCalcGetPair;

function posCalcGetPair(point1, point2, includeQueuedUpdates)
{
    // get the pair entry from the pairEquations tables
    var entry = this.pairEquations.getEdge(point1, point2);

    if(entry !== undefined || !includeQueuedUpdates)
        return entry; // may be undefined

    // check if this pair was queued for addition (and if it was, return
    // its entry).
    var entry;
    if((point1 in this.addedNewWatchedPairs) && 
       (point2 in (entry = this.addedNewWatchedPairs[point1])))
        return entry[point2]; // may be undefined
    else if((point2 in this.addedNewWatchedPairs) && 
            (point1 in (entry = this.addedNewWatchedPairs[point2]))) {
        entry = entry[point1];
        if(entry === undefined)
            return undefined;
        return { id: entry.id, dir: -entry.dir, queued: true };
    }
    
    return undefined;
}

// Given a pair ID, this function returns the pair entry for the pair
// in canonical order as stored in the LinearConstraints object. This
// only returns a result for pairs which are assigned to a variable.

PosCalc.prototype.getVarPairById = posCalcGetVarPairById;

function posCalcGetVarPairById(pairId)
{
    return this.linearConstraints.getPairById(pairId);
}

// Get the two points (in canonical order) of the pair with the given ID.
// If no such pair exists, returns undefined. Otherwise, returns an array
// holding the two points.

PosCalc.prototype.getPairPoints = posCalcGetPairPoints;

function posCalcGetPairPoints(pairId)
{
    return this.pairEquations.getEdgePoints(pairId);
}

// This function returns a list (array) of points which together with the given
// point form a pair. This returns all pairs stored in the underlying
// pairEquations object. All pairs used either for positioning calculation
// or for triggers are stored in the pairEquations object, so this
// returns the other point of all pairs which are used. 

PosCalc.prototype.getOtherInPair = posCalcGetOtherInPair;

function posCalcGetOtherInPair(point)
{
    return this.pairEquations.edgeOtherEnd(point);
}

/////////////////////////////////
// Watche Pair Update Queueing //
/////////////////////////////////

// This is the function to be used by external functions wishing to add
// a watched pair. This function does not actually add the watched pair, 
// but only queues it for later addition. If the pair is already 
// watched, it is not queued for addition (but is removed from the removal
// queue, if it was previously queued for removal).
// This function returns the pair entry for this pair, just as 
// would have been returned by 'getPair(point1, point2, true)'.
// The returned object contains at least the following fields:
// {
//    id: <pair ID>,
//    dir: -1|+1 // direction relative to the canonical order of the pair
// }
// This entry is not a copy, but the original entry, so it should not be
// modified or stored.
//
// Pairs where there are two identical points are not registered as
// a pair into the positioning system. The function then returns 'undefined'.
//

PosCalc.prototype.addWatchedPair = posCalcAddWatchedPair;

function posCalcAddWatchedPair(point1, point2)
{
    if(point1 == point2)
        return undefined;

    var edge = this.pairEquations.getEdge(point1, point2);
    var pairId;

    if(edge !== undefined) {
        var edgeInfo = this.pairEquations.getEdgeInfo(edge.id);
        if(edgeInfo.isWatched) {
            // check whether this was not previously queued for removal
            if(edgeInfo.inForest) {
                if(edge.id in this.removedWatchedPairsInForest)
                    this.removedWatchedPairsInForest[edge.id] = undefined;
            } else if(edge.id in this.removedWatchedPairsNotInForest)
                this.removedWatchedPairsNotInForest[edge.id] = undefined;
            return edge;
        }
        pairId = edge.id;
    }

    // add to the queue (if an entry already exists, use the existing ID and
    // canonical direction).
    
    var entry;
    if((point2 in this.addedNewWatchedPairs) && 
       (point1 in (entry = this.addedNewWatchedPairs[point2]))) {
        if(entry[point1] === undefined) {
            // set the inverse entry
            entry = entry[point1] = {
                id: (pairId !== undefined ? 
                     pairId : makePairId(point2, point1)),
                dir: (pairId !== undefined ? -edge.dir : 1),
                queued: true
            }
        } else
            entry = entry[point1];
        // return entry based on the inverse entry
        return edge ? 
            edge : { id: entry.id, dir: -entry.dir, queued: true };
    }

    if(!(point1 in this.addedNewWatchedPairs))
        entry = this.addedNewWatchedPairs[point1] = {};
    else if((point2 in (entry = this.addedNewWatchedPairs[point1])) &&
            entry[point2] !== undefined)
        return entry[point2];
    
    this.hasAddedNewWatchedPairs = true;
    return entry[point2] = { id: (pairId !== undefined ? 
                                  pairId : makePairId(point1, point2)), 
                             dir: (pairId !== undefined ? edge.dir : 1),
                             queued: true };
}

// This function is called by the Positioning object to remove the watched 
// instance of a pair (if the pair is watched). The removal does ot actually
// take place here, but is only queued here, to take place later. 
// If the pair is (also) normal, this has no effect on that instance.
// Neither has this operation any effect on constraints.
// The 'pair' object provided as input should be the one returned by a call
// to getPair(point1, point2, true).

PosCalc.prototype.removeWatchedPair = posCalcRemoveWatchedPair;

function posCalcRemoveWatchedPair(point1, point2, pair)
{
    if(pair.queued) {
        // the pair was only queued for addition, just remove it from 
        // the addition queue.
        if(pair.dir == 1)
            this.addedNewWatchedPairs[point1][point2] = undefined;
        else
            this.addedNewWatchedPairs[point2][point1] = undefined;

        return;
    }

    var edgeInfo = this.pairEquations.getEdgeInfo(pair.id);

    if(!edgeInfo.isWatched) {
        // check whether this pair was queued for addition as a watched
        // pair and, if it was, remove it from that list
        var entry;
        if(pair.dir == 1) {
            if((point1 in this.addedNewWatchedPairs) && 
               (point2 in (entry = this.addedNewWatchedPairs[point1])))
                entry[point2] = undefined;
        } else if((point2 in this.addedNewWatchedPairs) && 
                  (point1 in (entry = this.addedNewWatchedPairs[point2])))
            entry[point1] = undefined;

        return; // no need to queue for removal (the edge is not watched).
    }

    // queue for removal
    
    if(edgeInfo.inForest) {
        this.removedWatchedPairsInForest[pair.id] = true;
        this.hasRemovedWatchedPairsInForest = true;
    } else {
        this.removedWatchedPairsNotInForest[pair.id] = true;
        this.hasRemovedWatchedPairsNotInForest = true;
    }
}

////////////////////////////////
// Constraint Update Queueing //
////////////////////////////////

// The following functions are to be called by an external module (the 
// Positioning object owning this PosCalc) to add or remove constraints.
// These functions do not actually add or remove the constraints but only
// queue the constraints for addition and removal. The IDs of the constraints
// are considered to be unique, so only the last update for each 
// constaint ID is stored in the queue.
// When a constraint is deleted, a 'false' is stored under its ID in the
// queue.
// There is a separate queue for linear constraints and for segment 
// constraints. 

PosCalc.prototype.addLinear = posCalcAddLinear;

function posCalcAddLinear(p1point1, p1point2, p2point1, p2point2, scalar,
                          priority, id)
{
    if(id in this.removedLinearConstraints)
        this.removedLinearConstraints[id] = undefined;

    this.addedLinearConstraints[id] = 
        [p1point1, p1point2, p2point1, p2point2, scalar, priority, id];
    this.hasAddedLinearConstraints = true;
}

PosCalc.prototype.removeLinearById = posCalcRemoveLinearById;

function posCalcRemoveLinearById(constraintId)
{
    if(constraintId in this.addedLinearConstraints)
        this.addedLinearConstraints[constraintId] = undefined;

    this.removedLinearConstraints[constraintId] = true;
    this.hasRemovedLinearConstraints = true;
}

PosCalc.prototype.addSegment = posCalcAddSegment;

function posCalcAddSegment(point1, point2, constraintId,
                           priority, extremum1, extremum2,
                           stability, preference, orGroups)
{
    if(constraintId in this.removedSegmentConstraints)
        this.removedSegmentConstraints[constraintId] = undefined;

    var currentValue;
    if(stability) { // calculate the current offset of this pair
        currentValue = this.getCurrentValue(point1, point2);
    }

    // round very small bounds to zero (to avoid conflicts with the solution
    // calculation rounding).
    if(extremum1 && extremum1 < this.zeroRounding &&
       -extremum1 < this.zeroRounding)
        extremum1 = 0;
    if(extremum2 && extremum2 < this.zeroRounding &&
       -extremum2 < this.zeroRounding)
        extremum2 = 0;
    
    this.addedSegmentConstraints[constraintId] =
        [point1, point2, constraintId, priority, extremum1, extremum2,
         stability, preference, orGroups, currentValue];
    this.hasAddedSegmentConstraints = true;
}

PosCalc.prototype.removeSegment = posCalcRemoveSegment;

function posCalcRemoveSegment(point1, point2, constraintId)
{
    if(constraintId in this.addedSegmentConstraints)
        this.addedSegmentConstraints[constraintId] = undefined;
    this.removedSegmentConstraints[constraintId] = [point1, point2];
    this.hasRemovedSegmentConstraints = true;
}

///////////////////////////////
// Adding and removing Pairs //
///////////////////////////////

// This function adds a pair to the 'pairEquations' object. The pair
// can be added either as watched or as normal (indicated by the flag
// 'isWatched'). This function is to be used internally by PosCalc:
// the watched pairs are added from the added watched pair queue and
// the normal pairs are added from the constraint queue. 
// Adding a pair as watched does nto change its status as a normal
// pair and adding it as a normal pair does not change its status
// as a watched pair.
// One may optionally specify the pair ID which is to be assigned to the
// new pair created (if the pair does not already exist). This should be
// used in case the pair ID was already allocated elsewhere (for example, 
// in the addedNewWatchedPairs table) to ensure a consistent pair ID.
// If the pair is normal, this function checks whether a pair ID was
// already allocated for it in the addedNewWatchedPairs table. If it was,
// this pair ID is used. If no pair ID is provided or can be found,
// a new pair ID will be allocated (if the pair is new). This takes place
// inside 'addEdge()' below.
// If the pair is in the forest, it is also added to the
// LinearConstraints table. The function makes sure the pair is
// created with the same ID both in the linear constraints object and
// in the pairEquations object.
// The argument 'currentValue' is optional. It may be provided to this
// function when the calling function knows the current value
// (in the old solution) but the pair may be assigned to a new variable
// (not one split off of an existing variable). In this case, this
// value is stored here and when the new variable is created, this value
// is set as its initial value. If the pair is assigned to an existing
// variable, the value of the variable will not be changed by the value
// given in 'currentValue' (see the function refreshChangedVarPairs()
// for the update of the new variables with this value).

PosCalc.prototype.internalAddPair = posCalcInternalAddPair;

function posCalcInternalAddPair(point1, point2, isWatched, pairId,
                                currentValue)
{
    if(point1 == point2)
        return;
    
    if(!isWatched && this.hasAddedNewWatchedPairs) {
        // check whether a pair ID was already allocated
        var entry;
        if((point1 in this.addedNewWatchedPairs) && 
           (point2 in (entry = this.addedNewWatchedPairs[point1]))) {
            if((entry = entry[point2]) !== undefined)
                pairId = entry.id;
        } else if((point2 in this.addedNewWatchedPairs) && 
                  (point1 in (entry = this.addedNewWatchedPairs[point2]))) {
            if((entry = entry[point1]) !== undefined) {
                pairId = entry.id;
                // reverse the pair
                var tempPoint = point2;
                point2 = point1;
                point1 = tempPoint;
            }
        }
    }

    var edge =
        this.pairEquations.addEdge(point1, point2,
                                   isWatched ? undefined : true,
                                   isWatched ? true : undefined, pairId);

    if(currentValue !== undefined) {
        // This pair may be assigned to a new variable and 'currentValue'
        // is the value for this pair as calculated based on the old solution.
        // We store this value here so that when a new variable is create
        // for it, this value could be used as the initial value.
        this.newVarPairValues[edge.id] = edge.dir * currentValue;
    }
    
    var edgeEntry = this.pairEquations.edgesById[edge.id];
    
    if(!edgeEntry.inForest && !edgeEntry.isNormal)
        return; // should not be assigned a variable
    
    // assign a variable make sure the canonical order is the same.
    if (edge.dir > 0)
        this.linearConstraints.addPair(point1, point2, edge.id);
    else
        this.linearConstraints.addPair(point2, point1, edge.id);
}

// This function removes the pair with the given ID as a watched pair.
// This function should only be called internally by this module
// (when pairs scheduled for removal are removed). This function only
// rmeoves the pair as a watched pair. If the pair is also a normal
// pair, it remains a normal pair. 

PosCalc.prototype.internalRemoveWatchedPair = posCalcInternalRemoveWatchedPair;

function posCalcInternalRemoveWatchedPair(pairId)
{
    var edgePoints = this.pairEquations.getEdgePoints(pairId);

    if(edgePoints === undefined)
        return;

    // remove from the pair equations
    this.pairEquations.removeEdgeById(pairId, false, true);

    // if this edge is not normal, we also need to remove it from the
    // list of pairs in 'linearConstraints'.
    if(!this.pairEquations.isNormalById(pairId))
        this.linearConstraints.removePair(edgePoints[0], edgePoints[1]);
}

//
// Auxiliary function when removing constraints
//

// This function checks whether the given pair of points is currently part
// of a constraint (segment or linear). If it is not used
// by any constraint (and it was not added explicitly as a normal pair)
// then the pair is removed. If the pair is used in a constraint but not
// in an active one and was not added explicitly as a normal pair, the pair is
// suspended, which means that it is removed from the pair equations
// (but it remains registered in the linear constraints object, since some
// inactive constraints may make use of it).

PosCalc.prototype.suspendOrRemoveUnusedPair = posCalcSuspendOrRemoveUnusedPair;

function posCalcSuspendOrRemoveUnusedPair(point1, point2)
{
    // get the pair entry (and with it, the pair ID)
    var pair = this.getPair(point1, point2);

    if(pair == undefined)
        return;

    // get the variable for this pair
    var variable = this.linearConstraints.getPairVariable(point1, point2);

    if(variable == undefined)
        return; // pair not assigned a variable

    // check whether there is a segment constraint defined for this pair
    if(this.segmentConstraints.hasConstraint(point1, point2))
        return; // has active constraint, so should not suspend

    // check whether there is an active linear constraint defined for this
    // variable
    if(this.linearConstraints.hasActiveConstraint(variable))
        return; // has active constraint, so should not suspend

    // suspend the pair
    this.pairEquations.removeEdgeById(pair.id, true, false);
    
    // if no constraint is defined for this pair and it is not a watched
    // edge in the forest, it can be removed completely
    if(!this.linearConstraints.hasConstraint(point1, point2) &&
       !this.segmentConstraints.hasConstraint(point1, point2) &&
       !this.pairEquations.inForest(point1, point2)) {
        // remove completely
        this.linearConstraints.removePair(point1, point2);
    }
}

/////////////////////////////////////
// Access to List of Changed Pairs //
/////////////////////////////////////

// This function returns the list of changed pairs (chnaged since the last
// time this list was cleared). In this list, the attributes are the
// pair IDs and the values are the new values of the pairs. The values are
// given for the pair in canonical order.

PosCalc.prototype.getChangedPairs = posCalcGetChangedPairs;

function posCalcGetChangedPairs()
{
    return this.changedPairs;
}

/////////////////////////////////////
// Adding and removing constraints //
/////////////////////////////////////

// These functions mainly wrap the add and remove functions of linear
// and segment constraint objects and have exactly the same argument
// structure. In addition, these functions add pairs used in the constraints
// to the 'pairEquations' object.
// These functions make sure that pairs are created with the same ID both in
// the linear constraints object and in the pairEquations object.
// If either of the two pairs contains two identical points, the constraint
// is not registered (because it is no longer linear - this is a segment
// constraint forcing the other pair to be zero).

PosCalc.prototype.internalAddLinear = posCalcInternalAddLinear;

function posCalcInternalAddLinear(p1point1, p1point2, p2point1, p2point2, 
                                  scalar, priority, id)
{
    if(p1point1 == p1point2 || p2point1 == p2point2)
        return; // pair with two identical points - is not linear
    
    // add the normal pairs
    this.internalAddPair(p1point1, p1point2, false);
    this.internalAddPair(p2point1, p2point2, false);

    // add the constraint
    this.linearConstraints.setConstraint(p1point1, p1point2, p2point1,
                                         p2point2, scalar, priority, id);

    if(this.doDebugging)
        this.debugMessage("adding linear constraint ", id, ":", gBR,
                          "<", p1point1, ";", 
                          p1point2,"> * ", scalar, " = <", p2point1, ";", 
                          p2point2, ">");
}

PosCalc.prototype.internalRemoveLinearById = posCalcInternalRemoveLinearById;

function posCalcInternalRemoveLinearById(constraintId)
{
    var points = this.linearConstraints.getPointsById(constraintId);

    if(!points)
        return; // no such constraint
    
    this.linearConstraints.removeConstraintById(constraintId);
    
    if(this.doDebugging)
        this.debugMessage("removing linear constraint ", constraintId);
    
    // If after the removal of the constraint any of the pairs of the
    // constraint is no longer part of any constraint (and was not added
    // explicitly as a normal pair), we should suspend or remove it so
    // that does not participate in any equation.
    this.suspendOrRemoveUnusedPair(points[0], points[1]);
    this.suspendOrRemoveUnusedPair(points[2], points[3]);
}

PosCalc.prototype.internalAddSegment = posCalcInternalAddSegment;

function posCalcInternalAddSegment(point1, point2, constraintId,
                                   priority, extremum1, extremum2,
                                   stability, preference, orGroups,
                                   currentValue)
{
    if(extremum1 == undefined && extremum2 == undefined &&
       stability == undefined && preference == undefined)
        return; // the constraint is empty, add nothing
    
    if(point1 == point2)
        return; // cannot constrain the offset between a point and itself
    
    // add the normal pair
    this.internalAddPair(point1, point2, false, undefined, currentValue);

    // add the constraint
    this.segmentConstraints.setConstraint(point1, point2, constraintId,
                                          priority, extremum1, extremum2,
                                          stability, preference, orGroups);

    if(this.doDebugging)
        this.debugMessage("adding segment constraint ", constraintId, ":",
                          gBR, 
                          extremum1 != undefined ? 
                          ("" + extremum1 +  " <= ") : "",
                          "<", point1, ";", point2, ">", 
                          extremum2 != undefined ? (" <= " + extremum2) : "", 
                          preference ? (" preference: " + preference) : "",
                          stability ? (" stability: " + stability) : "");
}

PosCalc.prototype.internalRemoveSegment = posCalcInternalRemoveSegment;

function posCalcInternalRemoveSegment(point1, point2, constraintId)
{   
    this.segmentConstraints.removeConstraint(point1, point2, constraintId);
    
    if(this.doDebugging)
        this.debugMessage("removing segment constraint ", constraintId);
    
    this.suspendOrRemoveUnusedPair(point1, point2);
}

////////////////////////////////////////////
// Update of Queued Pairs and Constraints //
////////////////////////////////////////////

// This function goes over all watched pairs and constraints which were
// queued for addition or removal (in case of constraint, 'addition' may
// also mean 'modification') and adds them or removes them, as necessary.
// The order in which this takes place is such that this process will be 
// as efficient as possible. Therefore, the update begins by removing
// watched pairs which are not in the forest (of the pairEquations object).
// Whether the wacthed pair is inside the forest or not was already determined
// when the update was queued. Similarly, the new watched pairs are
// only added after all other updates took place.

PosCalc.prototype.updateQueuedPairsAndConstraints = 
    posCalcUpdateQueuedPairsAndConstraints;

function posCalcUpdateQueuedPairsAndConstraints()
{
    debugStartTimer("positioning", "removing non-forest watched pairs");

    // remove watched pairs which are not in the forest
    if(this.hasRemovedWatchedPairsNotInForest) {
        for(var pairId in this.removedWatchedPairsNotInForest) {
            if(this.removedWatchedPairsNotInForest[pairId] === true)
                this.internalRemoveWatchedPair(pairId);
        }
        this.hasRemovedWatchedPairsNotInForest = false;
        this.removedWatchedPairsNotInForest = {};
    }

    debugStopTimer("removing non-forest watched pairs");

    debugStartTimer("positioning", "removing in-forest watched pairs");

    // remove watched pairs which are not in the forest
    if(this.hasRemovedWatchedPairsInForest) {
        for(var pairId in this.removedWatchedPairsInForest) {
            if(this.removedWatchedPairsInForest[pairId] === true)
                this.internalRemoveWatchedPair(pairId);
        }
        this.hasRemovedWatchedPairsInForest = false;
        this.removedWatchedPairsInForest = {};
    }

    debugStopTimer("removing in-forest watched pairs");
   
    // remove segment constraints
 
    debugStartTimer("positioning", "removing segment constraints");
   
    if(this.hasRemovedSegmentConstraints) {
        for(var constraintId in this.removedSegmentConstraints) {
            var args = this.removedSegmentConstraints[constraintId];
            if(args !== undefined)
                this.internalRemoveSegment(args[0], args[1], constraintId);
        }
        this.hasRemovedSegmentConstraints = false;
        this.removedSegmentConstraints = {};
    }

    debugStopTimer("removing segment constraints");

    // remove linear constraints

    debugStartTimer("positioning", "removing linear constraints");
   
    if(this.hasRemovedLinearConstraints) {
        for(var constraintId in this.removedLinearConstraints) {
            if(this.removedLinearConstraints[constraintId] !== undefined)
                this.internalRemoveLinearById(constraintId);
        }
        this.hasRemovedLinearConstraints = false;
        this.removedLinearConstraints = {};
    }

    debugStopTimer("removing linear constraints");

    // add linear constraints

    debugStartTimer("positioning", "adding linear constraints");
   
    if(this.hasAddedLinearConstraints) {
        for(var constraintId in this.addedLinearConstraints) {
            var args = this.addedLinearConstraints[constraintId];
            if(args !== undefined)
                this.internalAddLinear.apply(this, args);
        }
        this.hasAddedLinearConstraints = false;
        this.addedLinearConstraints = {};
    }

    debugStopTimer("adding linear constraints");
    
    // add segment constraints

    debugStartTimer("positioning", "adding segment constraints");
   
    if(this.hasAddedSegmentConstraints) {
        for(var constraintId in this.addedSegmentConstraints) {
            var args = this.addedSegmentConstraints[constraintId];
            if(args !== undefined)
                this.internalAddSegment.apply(this, args);
        }
        this.hasAddedSegmentConstraints = false;
        this.addedSegmentConstraints = {};
    }

    debugStopTimer("adding segment constraints");

    // add watched pairs
    
    debugStartTimer("positioning", "adding watched pairs");

    if(this.hasAddedNewWatchedPairs) {
        for(var point1 in this.addedNewWatchedPairs) {
            var added = this.addedNewWatchedPairs[point1];
            for(var point2 in added) {
                var entry;
                if((entry = added[point2]) === undefined)
                    continue;
                if (entry.dir === -1) {
                    this.internalAddPair(point2, point1, true, entry.id);
                } else {
                    this.internalAddPair(point1, point2, true, entry.id);
                }
            }
        }
        this.hasAddedNewWatchedPairs = false;
        this.addedNewWatchedPairs = {};
    }
    
    debugStopTimer("adding watched pairs");
}

// Returns true when there are no changes to the constraints in the queue,
// in which case, it's safe to call getCurrentValue.

PosCalc.prototype.constraintQueueIsEmpty = posCalcConstraintQueueIsEmpty
function posCalcConstraintQueueIsEmpty() {
    return !this.hasAddedLinearConstraints && 
           !this.hasAddedSegmentConstraints &&
           !this.hasRemovedLinearConstraints &&
           !this.hasRemovedSegmentConstraints;
}


////////////////////////////
// Recalculation Required //
////////////////////////////

// This function returns true iff there are changes which require
// the constraint equations to be solved again. In case only watched
// variables need to be recalculated, this function returns false.
// It may happen that this function returns true even if there is no actual
// need to recalculate the solution (because the changes the function checks
// are a necessary but not a sufficient condition for the equations
// or the constraint on the solution to have changed).
// This function is guaranteed to return true if there is need to recalculate.

PosCalc.prototype.needToRecalcConstraintSolution =
    posCalcNeedToRecalcConstraintSolution;

function posCalcNeedToRecalcConstraintSolution()
{
    // did any linear constraints change?
    if(!isEmptyObj(this.linearConstraints.changes))
        return true;

    // did any segment constraints change?
    if(!isEmptyObj(this.segmentConstraints.changes))
        return true;

    // did any equations change? 
    if(!isEmptyObj(this.pairEquations.changes))
        return true;

    return false;
}

// This function returns true iff the watched equations changed.
// Even if this function returns false we may still need
// to recalculate watched variables because the constraint solution
// needs to be recalculated.

PosCalc.prototype.watchedEquationsChanged = posCalcWatchedEquationsChanged;

function posCalcWatchedEquationsChanged()
{
    return !isEmptyObj(this.pairEquations.watchedChanges);
}

// This function returns true iff there are changes which require the
// recalculation of positioning.

PosCalc.prototype.needToRecalcPositioning =
    posCalcNeedToRecalcPositioning;

function posCalcNeedToRecalcPositioning()
{
    return (this.hasAddedNewWatchedPairs || 
            this.hasRemovedWatchedPairsInForest || 
            this.hasRemovedWatchedPairsNotInForest ||
            this.hasAddedLinearConstraints ||
            this.hasRemovedLinearConstraints ||
            this.hasAddedSegmentConstraints ||
            this.hasRemovedSegmentConstraints ||
            this.needToRecalcConstraintSolution() ||
            this.watchedEquationsChanged());
}

//////////////////////
// Equation Refresh //
//////////////////////

// The following function reads the changes in 'pairEquations' and in the
// constraints which took place since this function was last called.
// It applies these to modify the sets of equations. The difference
// between the pairEquations and the final equations is that the
// pair equations have pairs as their components while the equations
// have variable indices as their components. This function also refreshes
// the set of variables being used.
// This function should be called as the first step in caluclating
// a new solution.

PosCalc.prototype.refreshEquations = posCalcRefreshEquations;

function posCalcRefreshEquations()
{
    // First, referesh the segment constraints based on any changes made to
    // the linear constraints.
    this.segmentConstraints.processLinearConstraintChanges();
    
    // modify the equations and the list of variables used in these equations

    // recalculate the variable equations
    debugStartTimer("positioning", "refresh changed equations");
    this.refreshChangedEquations();
    debugStopTimer("refresh changed equations");
    debugStartTimer("positioning", "refresh changed pairs");
    this.refreshChangedVarPairs();
    this.refreshClonedVariables();
    debugStopTimer("refresh changed pairs");
}

// This function takes all pairs for which the assignment of index or
// ratio has changed and updates the equations for the corresponding variables.
// It also adds new variables to the variable list. The function tries to
// detemine whether there is a known initial value for these new variables
// (and store it in the 'newVariables' table). Such a value is avilable
// either if the variable was split from an existing variable (because of
// a removal of a linear constraint) or if the offset of the pair was
// determined based on the old solution and stored in the 'newVarPairValues'
// table.
// Watched pairs which are not in the forest do not have a variable assigned
// to them, so they will not be processed here unless they previously had
// a variable assigned to them and this was removed or the other way around.
// In such cases, the addition/removal of the variable is handled here
// but the addition/removal of the watched path is handled in the watched
// equation update function.
// This does not modify equations which are in the list of modified equations
// (these are handled by another function).

PosCalc.prototype.refreshChangedVarPairs = posCalcRefreshChangedVarPairs;

function posCalcRefreshChangedVarPairs()
{   
    // list of pairs whose index/ratio changed
    var changedPairs = this.linearConstraints.changes;

    // Update the changed index/ratios on those equations which did not change.
    for(var id in changedPairs) {

        var change = changedPairs[id]; // the change currently being processed

        // if the pair no longer exists, it can be removed
        if(change.index == undefined && !this.pairEquations.edgeExists(id))
            this.removePairValue(id);
        
        // if a variable has been removed from this pair, check whether
        // the variable should be removed
        if(change.prevIndex != undefined && change.prevIndex != change.index &&
           !this.linearConstraints.variableExists(change.prevIndex)) {
                this.removeVariable(change.prevIndex);
        }
        
        var cyclePair = this.pairEquations.edgesById[id]; // the pair entry

        if(!cyclePair)
            continue;

        // if this pair is assigned to a new variable, add that variable
        if(change.index != undefined && !(change.index in this.variables)) {
            if(change.prevIndex && (change.prevIndex in this.variables)) {
                // this was split from a previous variable, so set it to an
                // initial value which will result in the same value for
                // the pair offset (this may override a previous pair,
                // see explanation for the 'this.newVariables' table).
                this.newVariables[change.index] = 
                    this.variables[change.prevIndex] * change.prevRatio / 
                    change.ratio;
            } else if((id in this.newVarPairValues) &&
                      this.newVariables[change.index] === undefined) {
                // we have an initial value for this variable, store it, to
                // be used to initialize the variable
                this.newVariables[change.index] =
                    this.newVarPairValues[id] / change.ratio;
            } else if(!(change.index in this.newVariables))
                // add to the list of new variable, but without an initial value
                this.newVariables[change.index] = undefined;
        }

        // handle normal/in forest pairs
        if(cyclePair.isNormal || cyclePair.inForest)
            // normal pairs and non-normal pairs which are in the forest
            // (of pairEquations) may appear in equations
            this.refreshChangedPairEquations(id, change);
    }

    this.newVarPairValues = {}; // clear the table
}

// This function takes all cloned variables which are new and determines the
// initial value to assign these variables (and stores it in the newVariables
// list). The initial value should be equal to the value of the cloned
// variable. If the cloned variable is also new, the initial value is taken
// from the newVariables list, which was already updated for the main
// variable in refreshChangedVarPairs(). If the cloned variable is not
// new, is last value is used.
// This function performs for cloned variable a similar function to that
// performed by refreshChangedVarPairs() for non-cloned variables.

PosCalc.prototype.refreshClonedVariables =
    posCalcRefreshClonedVariables;

function posCalcRefreshClonedVariables()
{
    for(var cloneVar in this.linearConstraints.cloneChanges) {
        if(this.linearConstraints.cloneChanges[cloneVar] != "added")
            continue; // removed so no initial value to set
        // new clone variable, add it as a new variable.
        
        var mainVar = this.linearConstraints.cloneVariables[cloneVar];
        
        if(mainVar in this.newVariables)
            this.newVariables[cloneVar] = this.newVariables[mainVar];
        else
            this.newVariables[cloneVar] = this.getLastValue(mainVar);
    }

    this.linearConstraints.clearCloneChanges();
}

// Given the ID of a pair that changed and an object 'change' which describes
// the change in this object, this function updates all equations which are
// affected by this change.
// The function skips equations which are marked as changed, as these will
// be updated later.

PosCalc.prototype.refreshChangedPairEquations =
    posCalcRefreshChangedPairEquations;

function posCalcRefreshChangedPairEquations(pairId, change)
{
    if(this.equations.equations.baseSetSize()) {
        
        var cycles = this.pairEquations.cycles;
        // list of cycle equations in 'pairEquations' which changed.
        var changedCycles = this.pairEquations.changes;

        if(cycles.componentIndex.has(pairId)) {
            // loop over the list of equations in which this pair appears

            var componentIndex = cycles.componentIndex.get(pairId);
            var _self = this;
            componentIndex.forEach(function(entry, vecId) {
                
                if(changedCycles[vecId])
                    return; // this vector has changed, will be handled
                
                var pairVal = entry.value;
            
                _self.equations.
                    transferValue(_self.idConvert[vecId], change.prevIndex,
                                  change.prevRatio * pairVal, change.index,
                                  change.ratio * pairVal);
            });
        }
    }
}

// This function takes all pair equations which have changed (both
// cycle and watched) and updates the corresponding variable equations.

PosCalc.prototype.refreshChangedEquations =
    posCalcRefreshChangedEquations;

function posCalcRefreshChangedEquations()
{
    debugStartTimer("positioning", "refresh clone equations");
    this.refreshCloneEquations();
    debugStopTimer("refresh clone equations");
    debugStartTimer("positioning", "refresh changed cycles");
    this.refreshChangedCycles();
    debugStopTimer("refresh changed cycles");
    debugStartTimer("positioning", "refresh changed watched cycles");
    this.refreshChangedWatchedCycles();
    debugStopTimer("refresh changed watched cycles");
}

// This function goes over all clone variables which were added or removed.
// For each clone variable added, an equation is added which forces it to
// equal the main variable which it clones. For each clone variable removed,
// the corresponding equation is removed.

PosCalc.prototype.refreshCloneEquations = posCalcRefreshCloneEquations;

function posCalcRefreshCloneEquations()
{
    for(var cloneVar in this.linearConstraints.cloneChanges) {
        if(this.linearConstraints.cloneChanges[cloneVar] == "added") {
            // add the equation <main var> - <clone var> = 0
            var mainVar = this.linearConstraints.cloneVariables[cloneVar];
            var equation = [];
            equation.push({ name: mainVar, value: 1 }, 
                          { name: cloneVar, value: -1 });
            this.cloneEquations[cloneVar] =
                this.equations.addEquation(equation);
        }
        else {
            this.equations.removeEquation(this.cloneEquations[cloneVar]);
            delete this.cloneEquations[cloneVar];
        }
    }
}

// This function takes all cycles in the pair equations which have changed
// and updates the corresponding variable equations.

PosCalc.prototype.refreshChangedCycles =
    posCalcRefreshChangedCycles;

function posCalcRefreshChangedCycles()
{
    // list of equation in 'pairEquations' which changed.
    var changedEq = this.pairEquations.changes;
    
    for(var id in changedEq) {
        if(changedEq[id] == "removed") {
            // remove both the base vector and the combination vector created
            // for this cycle vector.
            this.equations.removeEquation(this.idConvert[id]);
            delete this.idConvert[id];
        } else {

            var values = {};
            var equation = [];
            
            // loop over the original vector and calculate the coefficient
            // for each variable associated with a pair in the cycle.
            var source = this.pairEquations.cycles.vectors[id];

            for(var i = 0, l = source.length ; i < l ; ++i) {

                var entry = source[i];
                var pairId = entry.name;

                var pair = this.getVarPairById(pairId);

                if(!pair) {
                    // this edge may have just been added to the forest and
                    // not yet assigned a variable. In this case, it must be
                    // a watched pair
                    var points = this.pairEquations.getEdgePoints(pairId);
                    pair =
                        this.linearConstraints.addPair(points[0], points[1], 
                                                       pairId);
                }
                
                if(!(pair.index in values)) {
                    var entry = values[pair.index] = { 
                        name: pair.index, 
                        value: entry.value * pair.ratio,
                    };
                    equation.push(entry);
                } else
                    values[pair.index].value += entry.value * pair.ratio;
            }

            if(changedEq[id] == "added")
                this.idConvert[id] = this.equations.addEquation(equation);
            else
                this.equations.setEquation(this.idConvert[id], equation);
        }
    }
}

// This function takes all watched cycles in the pair equations which have
// changed and updates the value of the pair which this equation represents.

PosCalc.prototype.refreshChangedWatchedCycles =
    posCalcRefreshChangedWatchedCycles;

function posCalcRefreshChangedWatchedCycles()
{
    // list of equation in 'pairEquations' which changed.
    var changedEq = this.pairEquations.watchedChanges;
    
    for(var id in changedEq) {

        if(changedEq[id] == "added" || changedEq[id] == "changed") {

            // get the pair ID for this watched path
            var pairId = this.pairEquations.watchedCycleToEdge[id];
            // update/create the value for this pair
            this.setPairValue(pairId, (this.watchedInProd[id] ?
                                       this.watchedInProd[id] : 0));
            // since this is a watched pair which is not in the forest,
            // we can remove its variable assignment (if there is any)
            var points = this.pairEquations.getEdgePoints(pairId);
            if(points)
                this.linearConstraints.removePair(points[0], points[1]);
        } else { // removed
            // the pair ID is stored on the change list and it may still
            // exist (if it moved into the forest). In that case, it is
            // assigned to a variable and this new variable assignment is
            // handled elsewhere (and later)
            var pairId = changedEq[id];
            // if the pair no longer exists, remove it
            if(!this.pairEquations.edgeExists(pairId))
                this.removePairValue(pairId);
        }
    }
}

//////////////////////////
// Solution Calculation //
//////////////////////////

// This function calculates a new solution to the current set of constraints,
// including offsets which do not appear in any cycle (and are therefore
// constrained only by their own constraints) and the watched pairs. 
// The function first refreshes the equations and the variable list and then
// calculates the solution.

PosCalc.prototype.solveConstraints = posCalcSolveConstraints;

function posCalcSolveConstraints()
{
    debugStartTimer("positioning", "equation refresh");
    
    if(this.doDebugging)
        this.debugNewCycle();

    // update the constraints and watched pairs which were queued for
    // addition/removal since the last refresh.
    this.updateQueuedPairsAndConstraints();

    // refresh all equations (cycle equations as well as watched equations)
    this.refreshEquations();

    debugStopTimer("equation refresh");

    // refresh or-groups which were removed or whose priority changed
    this.orGroups.refreshModifiedGroups();

    // set the values of the independent variables and initialize the
    // value of new variables (if possible)
    debugStartTimer("positioning", "set new and independent variables");
    this.setNewAndIndependentVariables();
    debugStopTimer("set new and independent variables");
    
    if(this.needToRecalcConstraintSolution()) {

        debugStartTimer("positioning", "solve equations");

        // solve the cycle equations
        this.equations.prepareAndSolve();

        debugStopTimer("solve equations");
        
        // update the variable list with the variables which changed as
        // a result of solving the constraints
        this.updateChangesFromEquations();
    }
    
    // Update the list of changed pairs for those pairs which are associated
    // with a variable. As a by-product, those watched pairs which are
    // dependent on these modified pairs are also updated 
    debugStartTimer("positioning", "calculate changed pair offsets");
    this.calcChangedPairs();
    debugStopTimer("calculate changed pair offsets");

    // Clear all change lists
    this.clearAllChanges();
}

// This function goes over the list of variables in the equations whose value
// has changed and updates the lists of variables and changed variables
// on 'this' (PosCalc) object.

PosCalc.prototype.updateChangesFromEquations =
    posCalcUpdateChangesFromEquations;

function posCalcUpdateChangesFromEquations()
{
    // loop over the changes
    for(var variable in this.equations.solutionChanges)
        this.setVariable(variable, this.equations.solutionChanges[variable]);

    this.equations.clearSolutionChanges();
}

// Clear all changes recorded on this object, including its sub-objects

PosCalc.prototype.clearAllChanges = posCalcClearAllChanges;

function posCalcClearAllChanges()
{
    this.linearConstraints.clearChanges();
    this.segmentConstraints.clearChanges();
    this.pairEquations.clearChanges();
    this.clearNewVariables();
}

// This function clears the list of new variables

PosCalc.prototype.clearNewVariables =
    posCalcClearNewVariables;

function posCalcClearNewVariables()
{
    this.newVariables = {};
}

// This function clears the list of solution changes

PosCalc.prototype.clearSolutionChanges =
    posCalcClearSolutionChanges;

function posCalcClearSolutionChanges()
{
    this.changedVariables = {};
    this.changedPairs = {};
}

////////////////////////////////
// Variable Value Calculation //
////////////////////////////////

// This function sets the given variable entry (in 'this.variables') to
// the specified value. It first checks whether the value changed. A difference
// of less than 'this.zeroRounding' would be considered as 'no change'.
// The value of 'this.variables' is refreshed only if there was sme change.
// If the value changed then 'this.changedVariables' is also refreshed.

PosCalc.prototype.setVariable = posCalcSetVariable;

function posCalcSetVariable(variable, value)
{
    if(this.variables[variable] != undefined &&
       this.variables[variable] <= value + this.zeroRounding &&
       this.variables[variable] >= value - this.zeroRounding)
        return; // value unchanged

    this.variables[variable] = value;
    this.changedVariables[variable] = value;
}

// This function should be called when a variable should be removed from the
// list of variables.

PosCalc.prototype.removeVariable = posCalcRemoveVariable;

function posCalcRemoveVariable(variable)
{
    delete this.variables[variable];
    delete this.changedVariables[variable];
}

/////////////////////////
// Non-cycle Variables //
/////////////////////////

// This function sets the values of variables which do
// not belong to any cycles and of new variables. The values of variables 
// which do not belong to any cycle are not determined
// by solving the set of equations but directly and independently by the
// segment constraints defined on those variables. If no preference is
// specified for the variable, a default "min" preference is used. 
// This function only has to calculate the values of those variables which are
// new and those variables for which the segment/preference constraints
// have changed. It also needs to consider those variables which were in
// the equations in the previous round but are now no longer in the
// equations (this removes an implict constraint on these variables).
// If the variable is new and belong to a cycle, its value will eventually
// be detemrined by the solution of the equations. However, sometimes
// we have an initial value to provide for such variables (for example,
// if the variable was split off from another variable by the removal of
// a linear constraint and pairs belonging to that new variable already have
// an offset). If such an initial value exists for such a new variable, that
// value is set to the equation solution system (as an initial value).

PosCalc.prototype.setNewAndIndependentVariables =
    posCalcSetNewAndIndependentVariables;

function posCalcSetNewAndIndependentVariables()
{
    var refreshed = {}; // list of variables already set
    
    // loop over the list of new variables.
    
    for(var newVar in this.newVariables) {
        
        if(this.equations.hasVariable(newVar)) {
            // this variable is a new variable which appears in the equations.
            // if an initial value is know for it, set this value
            // (it may change later when the equations are solved).
            var value = this.newVariables[newVar];
            if(value !== undefined)
                this.equations.setSolution(newVar, value);
            continue;
        }

        this.setToPreferredValue(newVar);

        refreshed[newVar] = true;
    }

    // loop over the list of variables whose segment and/or preference
    // constraints have changed.            
    
    for(var name in this.segmentConstraints.changes) {
            
        if(refreshed[name])
            continue;
        
        if(this.equations.hasVariable(name))
            // variable in the cycle equations, value will/was
            // determined there
            continue;
        
        // the constraint change list may contain variables which have
        // expired
        if(!this.linearConstraints.variableExists(name))
            continue;
            
        this.setToPreferredValue(name);

        refreshed[name] = true;
    }

    // Loop over the variables which were removed from the equations.
    // If these variables still exist, they are now independent

    var changes = this.equations.equations.getComponentChanges();

    for(var variable in changes) {

        if(changes[variable] != "removed" || refreshed[variable])
            continue;

        // variable was removed from the equations, does it still exist?
        if(!this.linearConstraints.variableExists(variable))
            continue;

        this.setToPreferredValue(variable);
        
        refreshed[variable] = true;
    }
}

// Given a variable name, this function sets the value of the variable based
// on the segment constraints and stability and preference requirements
// defined for the variable. It sets the value in the 'variables' table.
//
// If there are any or-groups defined for the variable, the variable's
// satisfaction for these groups is also updated to the OrGroups object.
//
// If the value of the variable changes, this function updates the
// 'this.changedVariables[variable]' entry.

PosCalc.prototype.setToPreferredValue = posCalcSetToPreferredValue;

function  posCalcSetToPreferredValue(variable)
{
    // get the current value
    var value = this.getLastValue(variable);

    // calculate the new value
    value = this.segmentConstraints.getPreferredValue(variable, value);
    
    if(value != this.variables[variable])
        this.setVariable(variable, value);

    // if this variable has any groups defined for it, update the group
    // satisfaction by the variable
    if(this.segmentConstraints.variables[variable] &&
       this.segmentConstraints.variables[variable].hasOrGroups)
        this.orGroups.updateVariableSatisfaction(variable, value, value);
}

// Given a variable name, this function returns the last value assigned
// to this variable. If the variable appears in the 'newVariables' table
// and has an initial value there, that value is used. Otherwise, if
// the variable is a clone variable and it is not yet assigned any value
// but the main variable the clone belongs to is assigned a value,
// this function returns the value of the main variable.
// The function returns undefined if the current value of the variable is
// not known (it is a new variable and the newVariables table does not
// hold an initial value for it).

PosCalc.prototype.getLastValue = posCalcGetLastValue;

function  posCalcGetLastValue(variable)
{
    // get the current value
    var value = this.variables[variable];

    if(value !== undefined)
        return value; // not a new variable, previous value exists
    
    // check whether a new value was explicitly assigned to this variable.
    value = this.newVariables[variable]; // may be undefined

    if(value !== undefined)
        return value; // new value explicitly assigned the variable.
    
    // is this a clone value? If it is, the current value can be
    // set based on the value of the main variable, if it is not new.

    var mainVar = this.linearConstraints.cloneVariables[variable];
    
    if(mainVar != undefined)
        value = this.variables[mainVar];

    return value;
}

// Given two point labels, this function returns the offset between these
// two points, based on the current solution of the positioning constraints.
// If a pair is already registered for these two points, this function
// simply returns the offset calculated for this pair. Otherwise, it
// checks whether there is a path of existing pairs connecting the two
// points. If there is, the function retrieves the offsets of these pairs
// and uses them to calculate the offset between the two given points.
// The function returns the offset (a number) if this calculation was
// successful and returns undefined if the offset could not be calculated.

PosCalc.prototype.getCurrentValue = posCalcGetCurrentValue;

function posCalcGetCurrentValue(point1, point2)
{
    // get the pair entry, if it exists
    var pairEntry = this.getPair(point1, point2, false);

    if(pairEntry) {
        // pair already exists, get its current offset
        return pairEntry.dir * this.pairValues[pairEntry.id];
    }

    // pair does not exist, check whether there is a path of existing
    // pairs between the points
    
    var path = this.pairEquations.forest.getPath(point1, point2);

    if(!path)
        return undefined; // could not find existing path between points

    // the path returned is a sequence of points (from point1 to point2).
    // get the IDs of the corresponding pairs and get their offsets.

    var total = 0;
    
    for(var i = 0, length = path.length - 1 ; i < length ; ++i) {
        
        // get the pair entry
        pairEntry = this.getPair(path[i].name, path[i+1].name, false);

        if(!pairEntry)
            return undefined; // pair offset not yet known

        total += pairEntry.dir * this.pairValues[pairEntry.id];
    }

    return total;
}

////////////////////////
// Pair Offset Values //
////////////////////////

// This function sets the value of the given pair. The value is for the pair
// in canonical order. If the pair appears in the path defining a watched
// pair, the value of that pair is also refreshed.
// The value should be a number, it is not allowed to be undefined.

PosCalc.prototype.setPairValue = posCalcSetPairValue;

function posCalcSetPairValue(pairId, value)
{
    var prevValue = this.pairValues[pairId];

    if(value == undefined)
        return;
    
    if(prevValue == value)
        return; // nothing changed
    
    var diff = prevValue ? value - prevValue : value;
    this.watchedInProdObj.addDualToProducts(pairId, diff);
    this.pairValues[pairId] = value;    
    this.changedPairs[pairId] = value;
    
    if(this.doDebugging)
        this.debugMessage("set pair <", pairId, "> = ", value);

    if(this.pairEquations.watchedCycles.componentIndex.has(pairId)) {
        var pairIndex =
            this.pairEquations.watchedCycles.componentIndex.get(pairId);
        var _self = this;
        pairIndex.forEach(function(entry,vecId) {
            _self.setPairValue(_self.pairEquations.watchedCycleToEdge[vecId],
                               _self.watchedInProd[vecId] ?
                               _self.watchedInProd[vecId] : 0);
        });
    }
}

// This function removes the entry for the given pair from the pair
// offset value table. It also removes it from the pair changes table
// (if it is there).

PosCalc.prototype.removePairValue = posCalcRemovePairValue;

function posCalcRemovePairValue(pairId)
{
  if(this.doDebugging)
    this.debugMessage("removing pair <", pairId, ">");

    delete this.pairValues[pairId];   
    delete this.changedPairs[pairId];
}

///////////////////////////////
// Changed Pairs Calculation //
///////////////////////////////

// This function calculates the list of pairs associated with a variable
// whose value has changed. This includes both pairs whose index/ratio
// changed and pairs for which the value of the associated variable has
// changed. Pairs which were removed do not appear in this list.
// As a by-product of this function, the watched pairs which depend on
// these updated pairs are also updated.
// The pair offsets are stored in this.pairValues and are also recorded
// in this.changedPairs if the offset of the pair changed.
// All values are for the pair in canonical order.

PosCalc.prototype.calcChangedPairs = posCalcCalcChangedPairs;

function posCalcCalcChangedPairs()
{
    // first, go over all pairs which have changed

    // list of pairs whose index/ratio changed
    var changedPairs = this.linearConstraints.changes;

    for(var id in changedPairs) {

        var change = changedPairs[id]; // the change currently being processed

        if(change.index == undefined)
            continue; // pair removed

        // add the pair and calculate its value (the value is for the
        // pair in canonical order)
        this.setPairValue(id,
                          this.variables[change.index] ?
                          this.variables[change.index] * change.ratio : 0);
    }
    
    // now, add the pairs which are associated with a variable which changed

    var pairsByVariable = this.linearConstraints.variables; 
    
    for(var v in this.changedVariables) {

        if(!(v in pairsByVariable))
            continue;
        
        var pairs = pairsByVariable[v].pairs;

        // Note: if this is a clone variable, it will not appear in the
        // variable list and 'pairs' will be undefined. This is no a problem
        // since the value of a clone variable always changes together
        // with the value of the main variable associated with it.
        
        // loop over the pairs associated with this variable
        for(var id in pairs) {

            // get the canonical pair entry
            var pair = this.getVarPairById(id);

            this.setPairValue(id,
                              this.variables[pair.index] ?
                              this.variables[pair.index] * pair.ratio : 0);
        }
    }
}
