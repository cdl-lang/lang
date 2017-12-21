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


// This file implements the calculation of the linear constraints.
// It partitions the set of pairs into equivalence classes, assigns each
// such class a variable (an index) and calculates the ratio between
// the variable and each of the pairs in its equivalence class.
//
// The object supports several basic operations: addng a linear constraint,
// removing a linear constraint, changing a linear constraint and looking
// up the variable (index) assigned to a given pair and the ratio between
// that variable and the pair offset.
// When the ratio offset of a pair changes, the changed pair is 
// stored in a list, so that an external caller can examine these changes.
// The entry holds both the original index and ratio (as they were before
// the first change recorded for that pair) and the index and ratio
// after the last change recorded for the pair (these may be undefined if
// the pair was removed).
// This list can be cleared by the external caller after having
// examined its content.
//
// Every constraint is assigned a priority (the default being 0).
// If in the process of adding a constraint a conflict is
// detected between the constraint and previously added constraints,
// the new constraint may be added after the conflict is resolved by
// suspending a list of constraints of lower priority.
// If several constraints have the same priority, there is no guarantee
// as to which of them would be suspended.
// When a constraint is suspended, the system attempts to add it back
// into the constraint system when a constraint is removed (the removed
// constraint need not be the constraint which caused the suspended
// constraint to be suspended).
// Remark: One should avoid conflicts as much as possible. This mechanism
// is only intended to allow the system to continue functioning consistently
// in the face of conflicts. One should not rely on any particular
// behavior of this mechanism.
// Remark: When linear constraints conflict there still is the zero offset
// solution which satisfies them all. Therefore, it is in principle possible
// to ignore such conflicts. In practice, however, such a conflict is
// probably an indication of an inconsistent configuration.
//
// Each constraint registered to this module has an ID. Constraints with
// different IDs defined for the same two point pairs are, by definition,
// either conflicting or identical. Therefore, for each two point pairs,
// only one constraint is active at any given moment. The active constraint
// is the one with the highest priority. If several constraints have the
// same priority, the last one registered is used.
// Remark: It is not recommeneded to register more than one constraint for
// the same two point pairs.
//
// The object is based on a cycles object. The pairs of points are the
// nodes of the graph constructed by the cycles object and the linear
// constraints are the edges in the graph. The 'prop' entry for the edge
// in canonical order in the 'edges' object stores an array of objects
// of the form:
// {
//    id: <constraint ID>,
//    scalar: <ratio defined by the constraint with this ID>
//    priority: <the priority of this constraint>
// }
// The array is sorted by the priority of the constraints and the first
// entry in the array is the active constraint (this is the scalar actually
// used). The inverse edge holds exactly the same array, only with the
// reciprocal scalars.
//
// If an edge is in the cycles object, it is active and the first constraint
// in its constraint array is used (is active). When an edge is suspended
// (because its highest priority constraint conflicts with the active
// constraint of some other edge) it is removed from the cycles object
// and placed in the 'suspended' table.
//
// Remark: in most reasonable configurations there should be no constraint
// cycles. However, the possibility remains open and therefore we
// should accomodate it.
//
// While internally we allow constraints defined on different edges to have
// the same ID, we do expect constraint IDs to be unique (the constraint ID
// can include the edge information if necessary). This is enforced when a new
// constraint is registered. If another constraint with the same ID is
// registered on another edge, this constraint is first removed.
// Therefore, every constraint has a unique ID and we have a table which
// for each constraint ID gives the edge on which the constraint with that
// ID is defined. The table has the following form:
//
// constraintById: {
//    <constraintId>: [pairId1, pairId2]
//    .......
// }
// pairId1 and pairId2 are stored in the order in which the were given
// when the constraint was registered, which is not necessarily the canonical
// order.

// %%include%%: "edges.js"

// Variable ID assignment

var variableIdCounter = 1025; // Number of IDs already assigned

function nextVariableId()
{
    return "" + (++variableIdCounter);
}

// In addition to a Cycles object, this object carries a table of pairs,
// where for each pair it stores the ID of the pair, its canonical order,
// the index of the variable associated with that pair and the ratio between
// the pair and the variable.
// The ID of the pair whose canonical order is (point1,point2) is
// <point1>;<point2>. The entry [point1][point2] in the pairs table has
// the following form:
// {
//    id: <the pair's ID>,
//    dir: <-1/+1>,
//    index: <index of variable associated with this pair>
//    ratio: <the ratio between the offset of this pair and the variable>
// }
// where dir is +1 if [point1][point2] is the canonical order and -1 if not.
// There is also a 'pairById' table which allows to lookup a pair by its ID.
// Every entry has the form:
// {
//    points: [<first point>,<second point>] // in the canonical order
//    pair: <pointer to the [<first point>][<second point>] entry in
//           the 'pairs' table>
// }
//
// In addition to the entry for each pair, there is also a table 'variables'
// with an entry for each main variable index (that is, not clones),
// specifying which pairs and clones are associated with each variable index.
// This table has the form:
// {
//   <variable index>: {
//      pairs: {
//         <pairId>: true,
//         .....
//      },
//      numPairs: <number of entries in 'pairs'>
//      clones: {
//         <clone index>: true
//         .....
//      }
//      numClones: <number of entries in 'clones'>
//   }
//   ....
// }
// Here, there is an entry in 'pairs' for each pair which is associated with
// the variable (the variable can be either a main variable or a clone).
// If the variable is a main variable, there is an entry in 'clones' for each
// clone which clones the variable. A clone variable has no "clone" variables
// stored under it (for an explanation of clone variables, see below).
//
// The object also holds a 'changes' table, which records all pairs whose
// variable and or ratio has changed. It records both the index+ratio before
// the first change for the pair which was recorded in the table
// (since it was last cleared) and the current index+ratio. Either ratio+index
// pair may be undefined (if the pair was just created or removed,
// respectively). An external caller can clear this list after inspecting
// its content.
//
// The object also holds a table which contains all active constraints,
// sorted by variable index and priority. This table, stored under
// the 'byVariable' field of the LinearConstraints object, has the following
// format:
// {
//    <variable index>: <SortedList of constraints, sorted by priority>
// }
// The path to each entry in the SortedList table is [pairId1,pairId2] where
// the pairs are in the canonical order used in the 'cycles' structure.
// The entry for each item in the sorted list has the form:
// {
//    pairs: [<pairId1,pairId2], // in the canonical order
//    priority: <the priority of the active constraint for this pair>,
//    scalar: <the scalar defining this constraint> 
// }
//
// The 'suspended' field holds the edges for which constraints were suspended.
// These constraints are not active but are still considered 'defined'.
// The system tries to reactivate them when other constraints are removed
// or modified (or when the constraints for the suspended edges are modified).
// The 'suspended' structure is a sorted list of entries, sorted by priority
// (highest priority first). The path to each entry consists of the two pair
// IDs defining the edge (these two pair IDs appear only in one order, so
// look-up may require looking up the edge twice (once as [pairId1, pairId2]
// and once as [pairId2, pairId1]).
// Each entry has the format:
// {
//    pairs: [pairId1, pairId2] // same as the path leading to this entry
//    constraints: [
//       {
//          id: <constraint ID>,
//          scalar: <ratio defined by the constraint with this ID>
//          priority: <the priority of this constraint>
//       },
//       ......................
//    ]
// }
// The list under 'constraints' is exactly the same list as that which is
// stored under the 'prop' of the corresponding edge when the constraint
// is active.
// Because each edge is only stored in the suspended table only once under
// the canonical order of the pairs, there is also an index table for suspended
// edges which gives the edges in both orders:
//
// suspendedIndex: {
//    <pairId1>: {
//        <pairId2>: 1
//        ......
//    }
//    <pairId2>: {
//        <pairId1>: -1
//        ......
//    }
//    .....
// }
// with an entry for every path [pairId1, pairId2] which is stored in the
// 'suspended' table.
//
// Clone Variables
// ---------------
// Given a variable ('main variable') already allocated, a module can ask
// to be allocated a clone variable of the main variable. Clone variables
// are forced to have the same value as the main variable by adding
// equations of the form m - c = 0 to the set of equations (where m is the
// main variable and c is a clone of that variable). For each clone, a
// separate equation is added.
// No pairs are associated with clone variables - the clone variables
// represent the same pairs as those assigned to the main variable. The
// clone variables are used to allow multiple constraints to be applied
// to the same variable. Because the main and clone variables are
// separate variables, they can be set to different values at the beginning
// of the solution process. This inequality is only temporary, however,
// because the equations force the solution to assign the same value to
// the clone and main variable. As a result, if there are conflicting
// constraints on a variable, the solution process starts with the various
// values for the variable (satisfying the different variables) and
// ends up selecting the one value which best solves the conflicting
// constraints.

// The LinearConstraints module is responsible for managing the set of
// clone variables. It does not, however, register the required equations
// directly, but simply indicates to the equation module that such equations
// need to be added.
// The LinearConstraints object carries a table 'cloneVariables' where
// each attribute is the index of a clone variable and the value is the
// index of the main variable which the clone variable clones:
//
// cloneVariables: {
//    <clone index>: <main index>
// }
//
// In addition, there is a table 'cloneChanges' which lists clone variables
// which were added or removed since the last time the cloneChanges table
// was cleared. The equation module uses this table to add or remove
// cloning equation. It then can clear the changes table. The cloneChanges
// table has the following format:
// cloneChanges: {
//    <clone index>: "added"|"removed"
//    ......
// }

function LinearConstraints()
{
    this.edges = new Edges();
    this.cycles = new Cycles(this.edges);
    this.pairs = {};
    this.pairById = {};
    this.variables = {};
    this.changes = {};
    this.suspended = new SortedList();
    this.suspendedIndex = {};
    this.byVariable = {};
    this.constraintById = {};
    // cloning
    this.cloneVariables = {};
    this.cloneChanges = {};
}

///////////////////////////////
// Pair Management Functions //
///////////////////////////////

// This function adds a pair to the list of pairs. If the pair already exists,
// it returns the pair's entry. If the pair does not yet exist, and pairId 
// (the ID to be assigned to the pair) is not undefined, it creates
// an entry for the pair, using the given order of the points as the
// canonical order and the given pair ID. If no pair ID is provided 
// (it is undefined) no new pair is created and undefined is returned
// if the pair does not already exist.
// This function should only be used internally, as if the pair is new, it
// is not assigned a variable index and a ratio.
// Use 'getPairVal' to ensure that the returned object has the index and
// ratio set.

LinearConstraints.prototype.getPair = linearConstraintsGetPair;

function linearConstraintsGetPair(point1, point2, pairId)
{
    if(!point1 || !point2)
        return undefined;
    var p1 = this.pairs[point1];
    if(!p1) {
        if(pairId === undefined)
            return undefined;
        p1 = this.pairs[point1] = {};
    }
    var p2 = this.pairs[point2];
    if(!p2) {
        if(pairId === undefined)
            return undefined;
        p2 = this.pairs[point2] = {};
    }

    var r = p1[point2];
    if(r)
        return r; // pair already exists

    if(pairId === undefined)
        return undefined;
    
    // create the pair
    r = p1[point2] = { id: pairId, dir: 1 };
    p2[point1] = { id: pairId, dir: -1 };

    this.pairById[pairId] = {
        points: [point1,point2],
        pair: r
    };
    
    return r;
}

// Get the pair entry stored under [point1][point2] by the pair ID.

LinearConstraints.prototype.getPairById = linearConstraintsGetPairById;

function linearConstraintsGetPairById(pairId)
{
    var pairObj = this.pairById[pairId];

    if(!pairObj)
        return undefined;

    return pairObj.pair;
}

// Get the two points (in canonical order) of the pair with the given ID.
// If no such pair exists, returns undefined. Otherwise, returns an array
// holding the two points.

LinearConstraints.prototype.getPairPoints = linearConstraintsGetPairPoints;

function linearConstraintsGetPairPoints(pairId)
{
    var pairObj = this.pairById[pairId];

    if(!pairObj)
        return undefined;

    return pairObj.points;
}

// Given two points, this function returns the variable associated with
// this pair. If no such variable exists, undefined is returned.

LinearConstraints.prototype.getPairVariable = linearConstraintsGetPairVariable;

function linearConstraintsGetPairVariable(point1, point2)
{
    var entry = this.getPair(point1, point2);

    if(!entry)
        return undefined;

    return entry.index;
}

// This function returns a list (array) of points which together with the given
// point form a pair.

LinearConstraints.prototype.getOtherInPair = linearConstraintsGetOtherInPair;

function linearConstraintsGetOtherInPair(point)
{
    var points = [];

    for(var p in this.pairs[point])
        points.push(p);

    return points;
}

// Get the pair values (variable index and ratio). If the pair does not
// exist, undefined is returned.

LinearConstraints.prototype.getPairVal = linearConstraintsGetPairVal;

function linearConstraintsGetPairVal(point1, point2)
{
    return this.getPair(point1, point2);
}

// This function sets the given 'variableIndex' and 'ratio' on the given
// pair (point1,point2). This function also updates the reverse pair entry with
// -ratio.

LinearConstraints.prototype.setPairIndexAndRatio =
    linearConstraintsSetPairIndexAndRatio;

function linearConstraintsSetPairIndexAndRatio(point1, point2, variableIndex,
                                               ratio)
{
    var pair = this.getPair(point1, point2);

    // update the variable entry
    
    var varEntry;

    if(!(varEntry = this.variables[variableIndex]))
        varEntry = this.variables[variableIndex] = {
            pairs: {},
            numPairs: 1
        };
    else if(!(pair.id in varEntry.pairs))
        varEntry.numPairs++;

    varEntry.pairs[pair.id] = true;

    if(pair.index != variableIndex && pair.index != undefined) {
        varEntry = this.variables[pair.index];
        if(pair.id in varEntry.pairs) {
            if(!--varEntry.numPairs && !(varEntry.numClones))
                delete this.variables[pair.index];
            else
                delete varEntry.pairs[pair.id];
        }
    }

    // Update the pair entry
    
    if(pair.index != variableIndex || pair.ratio != ratio) {
        // the 'changes' entry is for the pair in canonical order
        var changeEntry;
        if(!(pair.id in this.changes))
            changeEntry = this.changes[pair.id] = {
                prevIndex: pair.index,
                prevRatio: (pair.index == undefined ?
                            undefined : pair.ratio * pair.dir)
            };
        else
            changeEntry = this.changes[pair.id];
        changeEntry.index = variableIndex;
        changeEntry.ratio = ratio * pair.dir;
        if(pair.index != undefined && pair.index != variableIndex)
            this.changeIndexByPairInByVariable(pair, variableIndex);
    }
    
    pair.index = variableIndex;
    pair.ratio = ratio;

    // the inverse pair
    pair = this.getPair(point2, point1);

    pair.index = variableIndex;
    pair.ratio = -ratio;
}

// This function adds a single pair. If the pair does not already exist,
// it is an isolated pair and is therefore assign a new variable and
// a ratio of 1. The pair is added to the 'changed' list.
// If the pair already exists, nothing is done.
// The pair entry for this pair is returned.
// The calling function must provide the ID of this pair.

LinearConstraints.prototype.addPair = linearConstraintsAddPair;

function linearConstraintsAddPair(point1, point2, pairId)
{
    var pair = this.getPair(point1, point2, pairId);

    if(pair.index == undefined)
        this.setPairIndexAndRatio(point1, point2, nextVariableId(), 1);

    return pair;
}

// This function removes the given pair from the structure. If there are
// constraints attached to this pair, these constraint are first removed.

LinearConstraints.prototype.removePair = linearConstraintsRemovePair;

function linearConstraintsRemovePair(point1, point2)
{
    if(!this.pairs[point1] || !this.pairs[point1][point2])
        return; // the pair does not exists

    // remove all constraints which use this pair
    this.removePairConstraints(point1, point2);
    
    var pair = this.pairs[point1][point2];
    
    // remove the pair entry from the variable list
    var varEntry = this.variables[pair.index];
    if(pair.id in varEntry.pairs) {
        if(!--varEntry.numPairs && !varEntry.numClones)
            delete this.variables[pair.index];
        else
            delete varEntry.pairs[pair.id];
    }

    // update the 'changes' table (values are for the canonical order)
    if(!this.changes[pair.id]) {
        this.changes[pair.id] = {
            prevIndex: pair.index,
            prevRatio: (pair.index == undefined ?
                        undefined : pair.ratio * pair.dir)
        }
    }
    this.changes[pair.id].index = undefined;
    this.changes[pair.id].ratio = undefined;
    
    // remove the pair entry itself
    delete this.pairById[pair.id];
    delete this.pairs[point1][point2];
    if(isEmptyObj(this.pairs[point1]))
        delete this.pairs[point1];
    
    if (point1 !== point2) {
        delete this.pairs[point2][point1];
        if(isEmptyObj(this.pairs[point2]))
            delete this.pairs[point2];
    }
}

//////////////////////////////////////
// Access to Constraint Information //
//////////////////////////////////////

// Given to pair IDs defining an edge, this function returns the list of
// constraints currently defined for the pair. If no constraints are
// defined, the function returns undefined. If the constraints are active,
// the function returns the array of constraints as stored under the
// 'prop' field of the edge. If the constraints of this edge are suspended,
// the function returns the entry for this edge as stored in the 'suspended'
// table (see the beginning of the file for the structure of this object).
// Note that in this case the returned object may represent the reverse
// edge (with the order of the pairs exchanged). The two pairs appear on the
// returned object, so this can easily be checked by the calling routine.

LinearConstraints.prototype.getEdgeConstraints =
    linearConstraintsGetEdgeConstraints;

function linearConstraintsGetEdgeConstraints(pairId1, pairId2)
{
    if(!this.pairById[pairId1] || !this.pairById[pairId2])
        return undefined; // pairs don't exist, so no constraint can exist

    var edge = this.edges.getEdge(pairId1, pairId2);

    if(edge !== undefined)
        return edge.prop;
    
    // check whether this is a suspended edge
        
    if(this.suspended.isEmpty()) // the most likely case 
        return undefined;
    
    var entry = this.suspended.getEntry([pairId1,pairId2]);
    
    if(entry)
        return entry;
    
    // try again in the reverse order
    return this.suspended.getEntry([pairId2,pairId1]);
}

// Given two pair IDs, this function returns the highest priority
// constraint currently defined between these two pairs. If no such
// constraint is defined, undefined is returned. Otherwise, the following
// structure is returned:
// {
//    priority: <priority of the highest priority constraint>
//    scalar: <the scalar defined for this constraint>
//    suspended: <true/false: is the constraint active or suspended?>
// }

LinearConstraints.prototype.getConstraintByPairIds =
    linearConstraintsGetConstraintByPairIds;

function linearConstraintsGetConstraintByPairIds(pairId1, pairId2)
{
    var entry = this.getEdgeConstraints(pairId1, pairId2);

    if(!entry)
        return undefined;
    
    if(isArray(entry))
        return {suspended: false,
                priority: entry[0].priority,
                scalar: entry[0].scalar};

    // this is a suspended edge, get the highest priority constraint
    var constraint = entry.constraints[0];
    
    // this is a suspended entry, determine whether it is given in the
    // order pair1,pair2 or in the order pair2,pair1.
    var scalar =
        (entry.pairs[0] == pairId1) ? constraint.scalar : 1/constraint.scalar; 

    return {suspended: true,
            priority: constraint.priority,
            scalar: scalar};
}

// Same as above, but instead of getting the pair IDs as input, this function
// receives the points of the two pairs (a sequence of four points) as input.
// If a constraint is found, the sign of the scalar is adjusted to the
// order in which the points were given in the input.

LinearConstraints.prototype.getConstraint = linearConstraintsGetConstraint;

function linearConstraintsGetConstraint(p1point1, p1point2, p2point1,
                                        p2point2)
{
    // Get the two pairs.
    var pair1 = this.getPair(p1point1, p1point2);

    if(!pair1)
        return undefined;
    
    var pair2 = this.getPair(p2point1, p2point2);

    if(!pair2)
        return undefined;

    var constraint = this.getConstraintByPairIds(pair1.id, pair2.id);

    if(!constraint)
        return undefined;

    constraint.scalar = constraint.scalar * pair1.dir * pair2.dir;

    return constraint;
}

//////////////////////////////////////////////////
// Management of Constraint List on Single Edge //
//////////////////////////////////////////////////

// this function adds the given constraint to the list of constraints already
// defined for the edge. If a constraint with the same ID is already defined
// for the edge, that constraint is replaced. The new constraint is added
// into the list of constraints at the location determined by its priority
// (the constraints are sorted by decreasing priority). If a constraint with
// the same priority already exists, the new constraint is inserted before it.
// This insertion operation takes place whether the current list of constraints
// is active and stored under the 'prop' field of the edge or if the
// current list of constraints is suspeneded and stored in the suspended
// list. The insertion does not change the location where the constraint list
// is stored (under the edge or in the suspended table). If the constraints
// are stored under the edge, the inverse edge entry is also updated.
// If no constraint was previously defined for this edge, nothing is done.
// The function returns the 'new highest priority constraint' for this edge
// as a result of this operation. If this did not change, false is
// returned. Otherwise, the following structure is returned:
// {
//    exists: true|false // does a constraint for this edge already exist?
//    suspended: true|false, // are the constraints currently suspended?
//                           // this appears only if exists == true
//    lowerPriority: true|false, // appears only if exists == true and
//                               // suspended == false and is then true
//                               // iff the new highest priority constraint
//                               // has priority strictly lower than the
//                               // previous highest priority constraint.
//    otherHighestId: true|false, // true if the ID of the new highest
//                                // priority constraint is not the same
//                                // as the ID of the constraint added. This
//                                // is only defined if exists == true
//    priority: <priority of the highest priority constraint>
//    scalar: <scalar for the highest priority constraint>
//    id: <constraint ID>
// }
// This function assumes the calling function already made sure the scalar
// is not zero.

LinearConstraints.prototype.addConstraintToEdge =
    linearConstraintsAddConstraintToEdge;

function linearConstraintsAddConstraintToEdge(pairId1, pairId2, scalar,
                                              priority, constraintId)
{
    // get the entry for this edge
    var entry = this.getEdgeConstraints(pairId1, pairId2);

    if(!entry) // no constraints yet for this edge
        return {exists: false,
                priority: priority,
                scalar: scalar,
                id: constraintId };

    var suspended = !isArray(entry);
    // the vector of constraint
    var constraints = suspended ? entry.constraints : entry;

    var firstPriority = constraints[0].priority;
    var firstScalar = constraints[0].scalar;

    var reversedScalar = false;
    
    if(suspended && entry.pairs[0] != pairId1) {
        scalar = 1 / scalar; // suspended under the edge in reverse order
        reversedScalar = true;
    }

    var reverse;
    
    if(!suspended) { // also get the reverse edge entry
        reverse = this.edges.getEdge(pairId2, pairId1).prop;
    }
    
    // the operations below assume that the list is very short (as it should
    // normally be of length 1 at most).

    // check whether there already exists a constraint with this ID. If yes,
    // remove it
    for(var i = 0 ; i < constraints.length ; ++i) {
        if(constraints[i].id == constraintId) {
            constraints.splice(i, 1);
            if(reverse)
                reverse.splice(i, 1);
            break;
        }
    }

    // insert the new constraint
    var insert;
    for(insert = 0 ; insert < constraints.length ; ++insert)
        if(priority >= constraints[insert].priority)
            break; //insert here
    
    // insert here
    constraints.
        splice(insert, 0,
               { priority: priority, scalar: scalar, id: constraintId});
    if(reverse) // also insert on the reverse edge
        reverse.
            splice(insert, 0,
                   { priority: priority, scalar: 1/scalar, id: constraintId});

    // did the highest priority constraint change?
    if(firstPriority == constraints[0].priority &&
       firstScalar == constraints[0].scalar)
        return false; // nothing changed

    // return the new highest priority constraint
    var result = {
        exists: true,
        suspended: suspended,
        otherHighestId: (constraints[0].id != constraintId),
        priority: constraints[0].priority,
        scalar: (reversedScalar ?
                 1/constraints[0].scalar : constraints[0].scalar),
        id: constraints[0].id
    };
    
    if(!result.suspended)
        result.lowerPriority = (firstPriority > result.priority);
    return result;
}

// This function removes the constraint with the given ID from the edge
// defined by the two pair IDs. The removal takes place whether the
// edge is currently active or suspended. If the edge is not found
// (active or suspended) or no constraint with the given ID is found,
// this function does nothing and false is returned. Otherwise, the
// constraint is removed from the list of constraints stored on the
// edge (or in its suspended entry). If this constraint was not the first
// (highest priority) in the list, the function returns false (because
// this removal does not change anything as far as the constraints to
// be applied are concerned). Similarly, if the new highest priority
// constraint has the same priority and scalar as the previous highest priority
// constraint, false is returned. Otherwise, the function returns the
// following structure:
// {
//    empty: true|false,     // true if no constraints are left
//    suspended: true|false, // is the edge currently suspended?
//    lowerPriority: true|false, // appears only if empty == false and
//                               // is then true iff the new highest priority
//                               // constraint has priority strictly lower
//                               // than the previous highest priority
//                               // constraint.
//    priority: <priority of the highest priority constraint>
//    scalar: <scalar for the highest priority constraint>
//    id: <constraint ID>
// }
// If constraintId == undefined, all constraints defined for the edge
// are removed.
// The allocation of this edge is removed from all constraint IDs which are
// removed.

LinearConstraints.prototype.removeConstraintFromEdge =
    linearConstraintsRemoveConstraintFromEdge;

function linearConstraintsRemoveConstraintFromEdge(pairId1, pairId2,
                                                   constraintId)
{
    // get the entry for this edge
    var entry = this.getEdgeConstraints(pairId1, pairId2);

    if(!entry)
        return false;

    var suspended = !isArray(entry);
    // the vector of constraints
    var constraints = suspended ? entry.constraints : entry;
    // the reverse edge entry (if this is an active edge)
    var reverse = suspended ?
        undefined : this.edges.getEdge(pairId2, pairId1).prop;

    if(constraintId == undefined) {
        for(var i = 0 ; i < constraints.length ; ++i)
            this.removeEdgeAllocationToConstraintId(constraints[i].id);
        constraints.splice(0);
        if(reverse)
            reverse.splice(0);
        return  { empty: true, suspended: suspended };
    }
    
    var firstPriority = constraints[0].priority;
    var firstScalar = constraints[0].scalar;

    // find the constraint with the given ID
    var found = false;
    for(var i = 0 ; i < constraints.length ; ++i) {
        if(constraints[i].id == constraintId) {
            found = true;
            constraints.splice(i, 1);
            if(reverse)
                reverse.splice(i, 1);
            this.removeEdgeAllocationToConstraintId(constraintId); 
            break;
        }
    }

    if(!found || (constraints.length && firstScalar == constraints[0].scalar &&
                  firstPriority == constraints[0].priority))
        return false;

    // actually removed
    
    var result = {
        empty: !constraints.length,
        suspended: suspended
    };

    if(!result.empty) {
        result.priority = constraints[0].priority;
        result.scalar = ((suspended && entry.pairs[0] != pairId1) ?
                         1/constraints[0].scalar : constraints[0].scalar);
        result.id = constraints[0].id;
        result.lowerPriority = (firstPriority > result.priority);
    }
    
    return result;
}

/////////////////////////////////////
// Constraint Addition and Removal //
/////////////////////////////////////

// This function adds a constraint to the structure. Its input is a sequence
// of the points of two pairs ((p1point1,p1point2) and p2point1,p2point2))
// the scalar defining the linear constraint between them, the priority
// of the constraint and the constraint ID.
// If a constraint between the two given pairs and with the same ID is
// already stored in the structure, it is replaced by the new constraint.
// This function adds the new constraint to the list of constraints
// defined for this edge.
// If the priority of this constraint is higher than the previously highest
// priority constraint for these two pairs, the new constraint becomes
// the active constraint.
// If there was a conflict, the function repairs this conflict by either
// suspending some already defined constraints (and adding the new constraint
// as active) or by adding the new constraint as 'suspended'.
// If the constraint is added as active, the pairs which were affected
// by the change are stored in the 'changes' table.
// The function returns true if the constraint is added as active and false
// if it was added as suspended or not added at all.
//
// The constraint registered by this function is pair2 = scalar x pair1
//
// The actual implementation of all this is in 'setConstraintByPairIds'.

LinearConstraints.prototype.setConstraint = linearConstraintsSetConstraint;

function linearConstraintsSetConstraint(p1point1, p1point2, p2point1,
                                        p2point2, scalar, priority,
                                        constraintId)
{
    // Get the two pairs.
    var pair1 = this.getPair(p1point1, p1point2);
    var pair2 = this.getPair(p2point1, p2point2);

    // call the function which actually performs the work
    return this.setConstraintByPairIds(pair1.id, pair2.id,
                                       scalar * pair1.dir * pair2.dir,
                                       priority, constraintId);
}

// This function actually implements the functionality described in
// 'setConstraint'. It receives pair IDs as input and therefore assumes
// the pairs were already created.

LinearConstraints.prototype.setConstraintByPairIds =
    linearConstraintsSetConstraintByPairIds;

function linearConstraintsSetConstraintByPairIds(pairId1, pairId2, scalar,
                                                 priority, constraintId)
{
    if(!scalar || scalar == Infinity || scalar == -Infinity) {
        // if the scalar is zero or infinite, delete the constraint with
        // this ID
        this.removeConstraint(pairId1, pairId2, constraintId);
        return false;
    }
    
    var pairById1 = this.pairById[pairId1];
    var pairById2 = this.pairById[pairId2];

    if(!pairById1 || !pairById2)
        return false; // could not find the pairs

    // allocate the edge defined by these two pairs to this constraint ID.
    // If another edge is already allocated for the constraint ID, that
    // constraint is first removed.
    this.allocateEdgeToConstraintId(constraintId, pairId1, pairId2);
    
    // If both pairs are assigned an index but not the same index, make
    // pair1 the one with the lower index (if the trees were just split,
    // this will ensure that they are remerged under the original index).
    if(pairById1.pair.index != undefined &&
       pairById2.pair.index != undefined &&
       pairById2.pair.index < pairById1.pair.index) {
        var tmpId = pairId1; pairId1 = pairId2; pairId2 = tmpId;
        var tmpById = pairById1; pairById1 = pairById2; pairById2 = tmpById;
        // in this case, we also need to adjust the scalar
        scalar = 1/scalar;
    }

    // push the constraint into the list of constraints already defined
    // for this edge. The function returns the new highest priority
    // constraint for this edge (this is not necessarily the constraint added
    // above)
    var newConstraint =
        this.addConstraintToEdge(pairId1, pairId2, scalar, priority,
                                 constraintId);

    if(!newConstraint)
        return false; // nothing changed

    // if adding this constraint resulted in a lower priority constraint
    // (becaused it removed a higher priority constraint with the same ID)
    // processing is similar to the removal of a constraint.
    if(!newConstraint.suspended && newConstraint.lowerPriority)
        return this.addLowerPriorityConstraint(pairId1, pairId2,
                                               newConstraint);
    else
        return this.addHigherPriorityConstraint(pairId1, pairId2,
                                                newConstraint);
}

// This function is called when a new active constraint has to be added.
// The edge on which the constraint is defined can already be active or
// suspended or may be completely new. The only requirement is that the
// new constraint does not replace another, higher priority, constraint
// (this may happen if a constraint with the same ID as the highest
// priority constriant is registered with a lower priority - this would
// remove the higher priority constraint). The reason for this exception is
// that when the priority of the constraint becomes lower, suspended
// constraints which conflict with the new constraint may need to be
// reactivated. In the case handled in this function, however, only
// suspended constraints which do not conflict with the new constraint
// are reactivated (the conflict which existed before the new constraint
// was added may have been the result of the previous (now overwritten)
// constraint on the edge for which the constraint was added).

LinearConstraints.prototype.addHigherPriorityConstraint =
    linearConstraintsAddHigherPriorityConstraint;

function linearConstraintsAddHigherPriorityConstraint(pairId1, pairId2,
                                                      newConstraint)
{
    // Get the two pairs
    var pair1 =
        this.pairById[pairId1] ? this.pairById[pairId1].pair : undefined;
    var pair2 =
        this.pairById[pairId2] ? this.pairById[pairId2].pair : undefined;

    if(!pair1 || !pair2)
        return false;

    // Check for conflicts between this constraint and constraints on other
    // edges
    var repair = this.checkConflict(pair1, pair2, newConstraint.scalar,
                                    newConstraint.priority);

    if(!!repair == true) { // there's a conflict
        if(!repair.length) {
            // a conflict which cannot be repaired, suspend the new constraint
            if(!newConstraint.exists)
                // completely new, just register as suspended
                this.suspendNewEdge(pairId1, pairId2, newConstraint.scalar,
                                    newConstraint.priority, newConstraint.id);
            else if(!newConstraint.suspended)
                // edge already has active constraint
                this.suspendOrRemoveConstraint(pairId1, pairId2);
            return false;
        } else if(!!repair == true)
            // Need to suspend other constraints to repair the conflict.
            // Continue below to add the new constraint
            this.suspendEdgesById(repair);
    }

    if(newConstraint.suspended) { // activate this edge
        this.reactivateSuspendedEdge(pairId1, pairId2);
        return !newConstraint.otherHighestId;
    } else if(!newConstraint.exists) {
        var constraint = {
            priority: newConstraint.priority,
            scalar: newConstraint.scalar,
            id: newConstraint.id
        };
        this.addActiveEdge(pairId1, pairId2, [constraint]);
    } else {
        // modify an existing constraint
        this.refreshEdge(pairId1, pairId2);
    }
 
    // if this modified an existing active constraint or any constraints were
    // suspended as a result of this constraint being added then there
    // may be suspended constraints which can be reactivated.
    if((newConstraint.exists && !newConstraint.suspended) ||
       (!!repair == true && repair.length > 0))
        this.reactivateNonconflictingSuspended();

    return true;
}

// This function should be called when the highest priority constraint is
// removed from an active edge. This can happen as a result of a removal
// operation or as a result of the addition of a constraint with the same ID as
// the highest priority constraint but with a lower priority. Since the
// priority becomes smaller, some suspended constraints may now have priority
// over the new constraint. Therefore, if there is a suspended constraint
// with a higher priority (and belonging to the same graph component) we first
// suspend the new constraint and add the highest priority suspended constraint
// (of those belonging to the relevant graph component). We then add
// all non-conflicting suspended constraints (this may include the
// new constraint).

LinearConstraints.prototype.addLowerPriorityConstraint =
    linearConstraintsAddLowerPriorityConstraint;

function linearConstraintsAddLowerPriorityConstraint(pairId1, pairId2,
                                                     newConstraint)
{
    var pair1 = this.pairById[pairId1];

    if(!pair1)
        return; //nothing to do, not an active edge

    var index = pair1.pair.index;
    var foundNode = undefined;
    var minPriority = newConstraint.empty ? -Infinity : newConstraint.priority;
    
    // loop over the suspended constraints and search for the first (highest
    // priority) suspended constraint in this component
    for(var node = this.suspended.first;
        node && node.sortVal > minPriority ; node = node.next) {
        if(this.pairById[node.entry.pairs[0]].pair.index == index) {
            foundNode = node;
            break;
        }
    }

    if(foundNode)
        // replace the active edge with the suspended constraint found
        this.replaceBySuspendedConstraint(foundNode, pairId1, pairId2);
    else if(newConstraint.empty) {
        // remove the constraint
        this.removeEdge(pairId1, pairId2);
    } else {
        // apply the new constraint (it is assumed it is already active, so
        // we only need to refresh the ratios)
        this.refreshEdge(pairId1, pairId2);
    }

    // reactive any non-conflicting suspended constraints
    this.reactivateNonconflictingSuspended();
}

// Given a constraint ID, this function removes the constraint (at most one)
// with that ID which is registered (suspended or active).

LinearConstraints.prototype.removeConstraintById =
    linearConstraintsRemoveConstraintById;

function linearConstraintsRemoveConstraintById(constraintId)
{
    var pairIds = this.constraintById[constraintId];

    if(!pairIds)
        return;

    this.removeConstraint(pairIds[0], pairIds[1], constraintId);
}

// This function removes a constraint from the structure. If there are any
// suspended constaints, the system tries to reactivate them.
// If constraintId is undefined, all constraints registered to this edge
// are removed.

LinearConstraints.prototype.removeConstraint =
    linearConstraintsRemoveConstraint;

function linearConstraintsRemoveConstraint(pairId1, pairId2, constraintId)
{
    this.removeEdgeAllocationToConstraintId(constraintId);
    
    // get the new highest priority constraint for this edge as a result
    // of removing the constraint with the given ID.
    var newConstraint =
        this.removeConstraintFromEdge(pairId1, pairId2, constraintId);

    if(!newConstraint)
        return; // nothing to do
    
    if(newConstraint.suspended) {
        if(newConstraint.empty)
            // remove from the suspended list
            this.removeEdgeFromSuspended(pairId1, pairId2);
        else if(newConstraint.lowerPriority) {
            // priority became lower, move to a new location inside the
            // suspended list
            var entry = this.suspended.getEntry([pairId1,pairId2]);

            if(entry)
                this.addEdgeToSuspended(entry, entry.pairs,
                                        entry.constraints[0].priority);
        }
    } else if(newConstraint.lowerPriority || newConstraint.empty)
        // this was an active constraint and its priority decreased
        // (or the constraint is empty)
        this.addLowerPriorityConstraint(pairId1, pairId2, newConstraint);
}

// Same as above, but allows the removal of a constraint based on the
// points defining the pairs rather than the pair IDs.

LinearConstraints.prototype.removeConstraintByPoints =
    linearConstraintsRemoveConstraintByPoints;

function linearConstraintsRemoveConstraintByPoints(p1point1, p1point2,
                                                   p2point1, p2point2,
                                                   constraintId)
{
    // get the pair entries
    
    var pair1 = this.getPair(p1point1, p1point2);

    if(!pair1)
        return undefined;
    
    var pair2 = this.getPair(p2point1, p2point2);

    if(!pair2)
        return undefined;

    return this.removeConstraint(pair1.id, pair2.id, constraintId);
}

// This function removes the constraints which use the given pair. The pair
// itself is not removed.

LinearConstraints.prototype.removePairConstraints =
    linearConstraintsRemovePairConstraints;

function linearConstraintsRemovePairConstraints(point1, point2)
{
    if(!this.pairs[point1] || !this.pairs[point1][point2])
        return; // the pair does not exists

    var pair = this.pairs[point1][point2];
    
    // remove all suspended constraints which have one end at this pair.
    for(var otherPairId in this.suspendedIndex[pair.id])
        this.removeConstraint(pair.id, otherPairId);
    
    // remove all active constraints associated with this pair.
    var edges = this.cycles.edgeOtherEnd(pair.id);

    // remove all constraints (edge) applied to this pair.
    for(var i = 0, l = edges.length ; i < l ; ++i) {
        var otherPairId = edges[i];
        var emptyConstraint =
            this.removeConstraintFromEdge(pair.id, otherPairId);
        this.addLowerPriorityConstraint(pair.id, otherPairId, emptyConstraint);
    }
}

//////////////////////////////////////////
// Edge Activation, Refresh and Removal //
//////////////////////////////////////////

// This function adds a new active edge for the two point pairs given.
// the 'constraints' argument holds the array of constraints defined
// for this edge. The edge is added to the cycles object, with
// the given array stored as the 'prop' of the edge and an array with
// the reciprocal scalars stored as the 'prop' of the reverse edge.
// If 'dontRefreshEdge' is not set, this function then updates all variable
// indices and ratios for all nodes influenced by this change.
// In that case, the function should be called after all conflicting
// constraints have been suspended. If one wishes to call this function
// before the conflicting constraints have been removed, it should
// be called with 'dontRefreshEdge' set and the calling function should
// later call this.refreshEdge().

LinearConstraints.prototype.addActiveEdge = linearConstraintsAddActiveEdge;

function linearConstraintsAddActiveEdge(pairId1, pairId2, constraints,
                                        dontRefreshEdge)
{
    // create the reciprocal list of constraints
    var reverse = [];

    for(var i = 0 ; i < constraints.length ; ++i) {
        var entry = {
            id: constraints[i].id,
            priority: constraints[i].priority,
            scalar: 1 / constraints[i].scalar
        };
        reverse.push(entry);
    }
    
    // Add to the graph a normal edge between the two pairs.
    // (this edge is only allocated by the cycles)
    this.edges.addEdge(pairId1, pairId2, undefined, false, constraints,
                       reverse);
    this.cycles.addEdge(pairId1, pairId2, true, false);
    
    if(!dontRefreshEdge)
        // refresh variable indices and ratios for all pairs affected by
        // this edge
        this.refreshEdge(pairId1, pairId2);
}

// This function should be called to refresh all variable index and ratios
// as a result of adding the edge between the two given pairs or changing
// this edge's scalar.

LinearConstraints.prototype.refreshEdge = linearConstraintsRefreshEdge;

function linearConstraintsRefreshEdge(pairId1, pairId2)
{
    if(!this.cycles.inForest(pairId1, pairId2)) {
        // add the edge to the 'byVariable' table (for other edges this
        // has to take place later, after the index is calculated).
        this.addToByVariable(pairId1, pairId2);
        return; // edge was not added to the forest, no change
    }
    
    var pairById1 = this.pairById[pairId1];
    var pairById2 = this.pairById[pairId2];
    
    // Get the tree nodes for the two points
    var node1 = this.cycles.forest.nodes[pairId1];
    var node2 = this.cycles.forest.nodes[pairId2];

    var up, down; // find the up and down nodes in the pair
    var upIndex;
    if(node1 == node2.up) {
        up = node1;
        down = node2;
        upIndex = pairById1.pair.index;
    } else {
        up = node2;
        down = node1;
        upIndex = pairById2.pair.index;
    }
    
    // if the up node is a root node and has no variable assigned to it,
    // need to allocate a new variable ID.
    if(up.isRoot && upIndex == undefined) {
        if(up == node1)
            this.setPairIndexAndRatio(pairById1.points[0], pairById1.points[1],
                                      nextVariableId(), 1);
        else
            this.setPairIndexAndRatio(pairById2.points[0], pairById2.points[1],
                                      nextVariableId(), 1);
    }

    // add the edge to the 'byVariable' table
    this.addToByVariable(pairId1, pairId2);
    
    // update the 'down' node and recursively all nodes below it
    this.updateVariableAndRatio(down);
}

// This function removes the active edge defined by the two pair IDs.
// It then refreshes the indices and ratios of nodes affected by this removal.

LinearConstraints.prototype.removeEdge = linearConstraintsRemoveEdge;

function linearConstraintsRemoveEdge(pairId1, pairId2)
{
    // remove the constraint from the cycles graph.
    var splitPairNode = this.cycles.removeEdge(pairId1, pairId2);

    // If the tree was split, need to assign a new variable and assign it
    // to all pairs in the split tree (the part of the tree which does
    // not include the original root).
    
    if(splitPairNode) // this is the pair which was split
        this.updateVariableAndRatio(splitPairNode);
}

// Given a node in the forest, this function update the variable and
// ratio for the pair represented by this node and for all nodes under it.

LinearConstraints.prototype.updateVariableAndRatio =
    linearConstraintsUpdateVariableAndRatio;

function linearConstraintsUpdateVariableAndRatio(node)
{
    if(!node)
        return;

    // get the points of the pair
    var pairObj = this.pairById[node.name];
    
    if(node.isRoot) {
        // assign the root a new variable index
        this.setPairIndexAndRatio(pairObj.points[0], pairObj.points[1],
                                  nextVariableId(), 1);
    } else {
        // get the constraint scalar
        var scalar =
            this.edges.getEdge(node.up.name, node.name).prop[0].scalar;
        // get the entry of the 'up' pair
        var upObj = this.getPairById(node.up.name);

        this.setPairIndexAndRatio(pairObj.points[0], pairObj.points[1],
                                  upObj.index, upObj.ratio * scalar);
    }

    // Apply this function recursively over the nodes loop over the 
    for(var n in node.down)
        this.updateVariableAndRatio(node.down[n]);
}

//////////////////////////////////////
// Conflict Checking and Resolution //
//////////////////////////////////////

// This function checks a constraint (before it is added) for conflicts
// with the existing constraints. If the constraint replaces another
// constraint between the same two pairs, there is no conflict unless
// the constraint is part of a cycle (and therefore replacing the original
// constraint is not enough to resolve the conflict).
// If no conflict is detected, the function returns false.
// When a conflict is detected, the function returns a set of constraints
// which can be suspended/removed in order to allow the new constraint
// to be added. These constraints must be of strictly lower priority than
// the constraint being checked. If no such set can be found, an empty set
// is returned.
// If the flag 'dontRepair' is set, the function does not attempt to repair
// a conflict if one is found.

LinearConstraints.prototype.checkConflict = linearConstraintsCheckConflict;

function linearConstraintsCheckConflict(pair1, pair2, scalar, priority,
                                       dontRepair)
{
    if(!pair1 || !pair2)
        return false; // no conflict
    
    // check whether the two pairs are already in the same component
    // (if they were assigned a component at all).
    if(pair1.index == undefined || pair1.index != pair2.index)
        return false; // not in the same component, no conflict

    // The two pairs are in the same component, check whether the given scalar
    // agrees with the ratios already calculated.
    if(pair1.ratio * scalar == pair2.ratio)
        return false;
    
    var edgeObj = this.edges.getEdge(pair1.id, pair2.id);

    // If the edge between the two already exists and is not part of a cycle,
    // there is no conflict either (because the new constraint replaces it.
    if(edgeObj && !this.cycles.edgeInCycle(edgeObj.id))
        return false;
    
    // There is a conflict, find a set of constraints of lower priority
    // which can be removed to resolve this conflict.

    if(dontRepair)
        return []; // don't look for lower priority constraints to suspend
    
    var resolving = this.conflictResolvingSet(pair1, pair2, priority);

    return resolving;
}

// Given two pairs and the priority of the constraint between them, this
// function searches for a set of lower priority constraints such that if these
// lower priority constraints are removed, the given constraint can be
// added without a conflict.
// If the function cannot find such a set, it returns an empty array.
// Remark: it is actually possible to improve this function by making it
// select a set of constraints to suspend such that the ratio of
// a minimal number of nodes changes. It is not clear to me at this point
// what the compuational cost of such an algorithm would be.

LinearConstraints.prototype.conflictResolvingSet =
    linearConstraintsConflictResolvingSet;

function linearConstraintsConflictResolvingSet(pair1, pair2, priority)
{
    // Duplicate the cycle vector set (the search is performed by manipulating
    // this set).

    var vectorSet = this.cycles.cycles.duplicate();
    
    var edgeObj = this.edges.getEdge(pair1.id, pair2.id);

    // if the edge between the two given pairs is not in the graph yet,
    // add the cycle which would have been created by adding the edge.
    if(!edgeObj) {
        // create a dummy edgeObj
        edgeObj = { id: makePairId(pair1.id, pair2.id), dir: 1 };
        this.cycles.addExternalCycle(pair1.id, pair2.id, edgeObj.id, 
                                     vectorSet);
    }

    var edgeId = edgeObj.id;
    
    // Remove edges of lower priority than the given priority until no more
    // cycles are left containing the given edge. In each step we select
    // an edge from one of the cycles containing the edge (pair1,pair2),
    // remove that cycle and adding/subtracting that cycle from all other
    // cycles containing the selected edge (just as in the standard edge
    // removal algorithm).

    var removed = [];
    
    var componentIndex = vectorSet.componentIndex.get(edgeId);
    while(componentIndex.size != 0) {

        // Search for the minimal component of a vector containing this
        // component. This should have lower priority than the given priority
        var minComponent = undefined;
        var minPriority = priority;

        // loop over all vectors and find the least priority component
        var _self = this;
        componentIndex.forEach(function(entry, v) {

            var vector = vectorSet.vectors[v];

            for(var i = 0, l = vector.length ; i < l ; ++i) {
                var c = vector[i].value;
                if(c == edgeId)
                    continue;
                var lastPriority = _self.edges.getEdgePropById(c)[0].priority;
                if(lastPriority < minPriority)
                    minComponent = c;
            }
        });

        if(minComponent == undefined)
            // could not find a lower priority edge to remove, return with
            // failure
            return [];

        // add the minimal component to the list of removed components 
        removed.push(minComponent);
        
        // remove this component
        
        var cycles = vectorSet.componentIndex.get(minComponent);

        // the following loop iterates only once because in the first
        // iteration all other vectors are changed so that they do not contain
        // 'minComponent' anymore

        cycles.forEach(function(e, firstCycleId) {

            var firstCycle = vectorSet.vectors[firstCycleId];

            cycles.forEach(function(t, cycleId) {
                if(cycleId == firstCycleId)
                    return;
                var cycle = vectorSet.vectors[cycleId];

                vectorSet.addToVector(cycleId, undefined, firstCycleId,
                                      (cycle[minComponent] ==
                                       firstCycle[minComponent]) ? -1 : 1);
            });

            // remove the first cycle
            vectorSet.removeVector(firstCycleId);
        });
    }

    return removed;
}

///////////////////////////
// Suspended constraints //
///////////////////////////

// When an edge is suspended, it needs to be removed from the 'cycles'
// structure but must remain stored. It can be reactivated (i.e. added
// to the 'cycles' structure) when another constraint belonging to the same
// variable is removed or changed.
// Reactivation should be attempted in decreasing order of priority.
// Therefore, in addition to allowing access to the edges through
// their pair IDs, we also hold all suspended edges in a list sorted
// by priority (of their highest priority constraint). This is implemented
// by the 'SortedList' object.
// The path used is the two pair IDs defining the edge (in canonical order).
// The entry for each suspended edge (which is placed in the sorted
// list) has the following structure:
// {
//    pairs: [pairId1, pairId2],
//    constraints: [  // the constraints assigned this edge, sorted by priority
//       {
//           scalar: <scalar>,
//           priority: <priority>,
//           id: <constraintId>
//       }
//       .....
//    ]
// }
// Each suspended edge is stored only once, under the canonical order
// of its pairs. To make the inverse access fast, there is also an index
// table for suspended edges which gives the edges in both orders:
//
// suspendedIndex: {
//    <pairId1>: {
//        <pairId2>: 1
//        ......
//    }
//    <pairId2>: {
//        <pairId1>: -1
//        ......
//    }
//    .....
// }
// with an entry for every path [pairId1, pairId2] which is stored in the
// 'suspended' table.

// This function reactivates suspended edges which no longer
// conflict with the current active constraints. This can be done in
// any order and regardless of the priority of the constraints.

LinearConstraints.prototype.reactivateNonconflictingSuspended =
    linearConstraintsReactivateNonconflictingSuspended;

function linearConstraintsReactivateNonconflictingSuspended()
{
    var node = this.suspended.first;
    var pair1, pair2;
    
    while(node) {
        pair1 = this.pairById[node.entry.pairs[0]].pair;
        pair2 = this.pairById[node.entry.pairs[1]].pair;

        // the node may be removed by the following steps, so store the
        // pointer to the next node.
        var next = node.next;
        
        if(pair1.index == undefined || pair1.index != pair2.index ||
           pair1.ratio * node.entry.scalar == pair2.ratio)
            // non-conflicting constraint, can be added
            this.reactivateSuspendedEdge(node.entry.pairs[0],
                                         node.entry.pairs[1]);
        node = next;
    }
}

// This function should be called when constraints are defined for the
// edge given by the two pair IDs, this edge is currently
// stored in the 'suspended' table and we wish to activate it.
// This function does not check whether the reactivated constraint
// conflicts with other already active constraints. It assumes that it
// is called only if no such conflict exists.
// This function returns true if the edge was reactivated and false if not.

LinearConstraints.prototype.reactivateSuspendedEdge =
    linearConstraintsReactivateSuspendedEdge;

function linearConstraintsReactivateSuspendedEdge(pairId1, pairId2)
{
    // get the suspended entry (it can be either in this or the reverse order)
    var entry = this.suspended.getEntry([pairId1,pairId2]);

    if(!entry) {
        entry = this.suspended.getEntry([pairId2,pairId1]);

        if(!entry)
            return false; // no suspended constraints found

        pairId1 = entry.pairs[0];
        pairId2 = entry.pairs[1];
    }

    //remove from the suspended list
    this.removeEdgeFromSuspended(pairId1, pairId2);

    // make this edge active
    this.addActiveEdge(pairId1, pairId2, entry.constraints);

    return true;
}

// This function suspends the given edge (given by the two pairs
// defining it). The edge must be active and it is assumed that the
// edge which caused the conflict is already in the graph so there is no
// need to re-calculate the indices and ratios of nodes.
// If the edge does not carry any constraints, it is simply removed.

LinearConstraints.prototype.suspendOrRemoveConstraint =
    linearConstraintsSuspendOrRemoveConstraint;

function linearConstraintsSuspendOrRemoveConstraint(pairId1, pairId2)
{
    // get the edge (we need the scalar and priority)
    var edge = this.edges.getEdge(pairId1, pairId2);

    if(!edge)
        return; // constraint not found, cannot suspend

    // get the property of the edge in canonical order
    var prop;
    if(edge.dir < 0) {
        prop = this.edges.getEdgePropById(edge.id);
        var tmpId = pairId1; pairId1 = pairId2 ; pairId2 = tmpId;
    } else
        prop = edge.prop;
    
    if(prop.length > 0) {
        // store the edge as a suspended constraint
        var entry = {
            pairs: [pairId1, pairId2],
            constraints: prop
        };

        this.addEdgeToSuspended(entry, entry.pairs,
                                entry.constraints[0].priority);
    }

    // remove the edge from the graph. Since the constraint was suspended
    // because of a conflict, we assume that the removal of the edge does
    // not split the graph component to which it belongs and therefore
    // there is no need to re-assign the index and ratio to nodes in the tree.
    this.cycles.removeEdge(pairId1, pairId2);
}

// This function adds a new edge to the list of suspended edges.
// It is assumed that this edge does not appear yet in the Cycles object.
// If such an active edge entry already exists, one should use
// the 'suspendOrRemoveConstraint' function instead.

LinearConstraints.prototype.suspendNewEdge =
    linearConstraintsSuspendNewEdge;

function linearConstraintsSuspendNewEdge(pairId1, pairId2, scalar, priority,
                                         constraintId)
{
    var entry = {
        pairs: [pairId1, pairId2],
        constraints: [{ scalar: scalar, priority: priority, id: constraintId}]
    };

    this.addEdgeToSuspended(entry, entry.pairs, priority);
}

// Given an array of edge IDs (as stored in the 'cycles' object), this
// function suspends the constraints defined on these edges.

LinearConstraints.prototype.suspendEdgesById =
    linearConstraintsSuspendEdgesById;

function linearConstraintsSuspendEdgesById(edgeIds)
{
    for(var i in edgeIds) {
        // get the edge
        var edge = this.edges.edgesById[edgeIds[i]];

        // suspend the constraint
        this.suspendOrRemoveConstraint(edge.labels[0], edge.labels[1]);
    }
}

// This function receives a node in the 'suspended' table and two
// pair IDs representing an active edge. The suspended edge and the active
// edge need to be from the same graph component (but it is the responsibility
// of the calling function to verify this). This function then replaces
// the active edge by the suspended edge. This means that the active edge
// is removed from the graph and the suspended edge is added to the graph.
// If the active edge still has some active constraints registered on it,
// it is stored as a suspended edge.

LinearConstraints.prototype.replaceBySuspendedConstraint =
    linearConstraintsReplaceBySuspendedConstraint;

function linearConstraintsReplaceBySuspendedConstraint(suspendedNode,
                                                       replacedPairId1,
                                                       replacedPairId2)
{
    // get the pair IDs of the edge to be reactivated
    var pairId1 = suspendedNode.entry.pairs[0];
    var pairId2 = suspendedNode.entry.pairs[1];
    
    // first, add an edge for the edge being reactivated (but do not
    // recalculate the ratios yet).
    this.addActiveEdge(pairId1, pairId2,
                       suspendedNode.entry.constraints, true);

    // remove the suspended node from the table of suspended edges
    this.suspended.remove(suspendedNode.entry.pairs);

    // suspend or remove the edge to be replaced
    this.suspendOrRemoveConstraint(replacedPairId1, replacedPairId2);
    
    // now, refresh the ratios affected by this edge
    this.refreshEdge(pairId1, pairId2);
    
}

// This function actually performs the addition of an entry to the 'suspended'
// table (and also adds it to the suspendedIndex table). The function
// stores the entry given by 'entry' under the path given in the array
// 'pairs' (two pair IDs) with the given priority. If another entry already
// exists for this path, it is overwritten.

LinearConstraints.prototype.addEdgeToSuspended =
    linearConstraintsAddEdgeToSuspended;

function linearConstraintsAddEdgeToSuspended(entry, pairs, priority)
{
    // insert into the sorted list
    this.suspended.insert(entry, pairs, priority);
    
    // record in the inverse index
    if(!this.suspendedIndex[pairs[0]])
        this.suspendedIndex[pairs[0]] = {};
    this.suspendedIndex[pairs[0]][pairs[1]] = 1;
    if(!this.suspendedIndex[pairs[1]])
        this.suspendedIndex[pairs[1]] = {};
    this.suspendedIndex[pairs[1]][pairs[0]] = -1;
}

// This function actually performs the removal of an entry from the 'suspended'
// table (and also removes it from the suspendedIndex table).

LinearConstraints.prototype.removeEdgeFromSuspended =
    linearConstraintsRemoveEdgeFromSuspended;

function linearConstraintsRemoveEdgeFromSuspended(pairId1, pairId2)
{
    if(!this.suspendedIndex[pairId1])
        return;

    var dir = this.suspendedIndex[pairId1][pairId2];

    if(!dir)
        return;

    if(dir > 0)
        this.suspended.remove([pairId1, pairId2]);
    else
        this.suspended.remove([pairId2, pairId1]);
       
    delete this.suspendedIndex[pairId1][pairId2];
    delete this.suspendedIndex[pairId2][pairId1];
    
    if(isEmptyObj(this.suspendedIndex[pairId1]))
        delete this.suspendedIndex[pairId1];
    
    if(isEmptyObj(this.suspendedIndex[pairId2]))
        delete this.suspendedIndex[pairId2];
}

////////////////////////////
// Change List Management //
////////////////////////////

// Clear all changes stored in the change list.

LinearConstraints.prototype.clearChanges = linearConstraintsClearChanges;

function linearConstraintsClearChanges()
{
    this.changes = {};
}

///////////////////////////////////
// 'byVariable' table management //
///////////////////////////////////

// See the description of the 'byVariable' table at the beginning of the file

// If a constraint between the two give pairs is active, this constraint
// is added by this function to the 'byVariable' table (under its index).
// The constraint is added under the cannical order of its pairs.

LinearConstraints.prototype.addToByVariable =
    linearConstraintsAddToByVariable;

function linearConstraintsAddToByVariable(pairId1, pairId2)
{
    if(!pairId1 || !pairId2)
        return;
    
    // check whether there is an active constraint and get the corresponding
    // edge.
    var edgeObj = this.edges.getEdge(pairId1, pairId2);

    if(!edgeObj)
        return; // not an active constraint

    var entry = {
        pairs: (edgeObj.dir == 1) ? [pairId1,pairId2] : [pairId2,pairId1],
        priority: edgeObj.prop[0].priority,
        scalar: ((edgeObj.dir == 1) ?
                 edgeObj.prop[0].scalar : 1/edgeObj.prop[0].scalar),
    };

    // get the index
    var index = this.pairById[pairId1].pair.index;

    if(!this.byVariable[index])
        this.byVariable[index] = new SortedList();

    this.byVariable[index].insert(entry, entry.pairs, entry.priority);
}

// Remove the constraint for the given two pairs from the 'byVariable' list.
// To know which entry to remove this from, one must given the 'index'
// of the pairs of this constraints. If the constraint was in the list,
// it is remove and its 'entry' is returned. Otherwise, undefined is returned.

LinearConstraints.prototype.removeFromByVariable =
    linearConstraintsRemoveFromByVariable;

function linearConstraintsRemoveFromByVariable(pairId1, pairId2, index)
{
    if(!this.byVariable[index])
        return undefined;
    
    var entry = this.byVariable[index].remove([pairId1, pairId2]);

    if(!entry) // try in the opposite order
        entry = this.byVariable[index].remove([pairId2, pairId1]);

    if(!entry)
        return undefined; // not found

    // cleanup
    if(this.byVariable[index].isEmpty())
        delete this.byVariable[index];
    
    return entry;
}

// This function should be called when the index assigned to a pair is
// about to change. The function is given a pointer to the pair entry and
// the new index (not yet set on the pair entry). The function takes all
// constraints whose first pair (in the canonical order) is the given pair
// and changes the location of their entries in the 'byVariable' table
// from the old index to the new one.
// For edges already in the 'byVariable' table, if the index of one pair
// of the edge changes, so does the index of the other pair. This function
// wudl therefore be called for both ends of the edges and it is therefore
// sufficient to look at edges with the given pair as the first pair in
// the canonical order.

LinearConstraints.prototype.changeIndexByPairInByVariable =
    linearConstraintsChangeIndexByPairInByVariable;

function linearConstraintsChangeIndexByPairInByVariable(pair, newIndex)
{
    if(!pair || pair.index == undefined || pair.index == newIndex)
        return;

    // get the IDs of the other end of all edges which have this pair
    // as their first pair (in canonical order).
    var otherIds = this.cycles.edgeOtherEnd(pair.id, true);

    if(!otherIds.length)
        return;

    if(!this.byVariable[newIndex])
        this.byVariable[newIndex] = new SortedList();
    
    for(var i in otherIds) {
        var entry = this.removeFromByVariable(pair.id, otherIds[i],
                                              pair.index);
		if (entry)
			this.byVariable[newIndex].insert(entry, entry.pairs,
                                             entry.priority);
    }
}

///////////////////////////////////////
// Edge Allocation to Constraint IDs //
///////////////////////////////////////

// Every constraint registered must have a unique constraint ID. This
// uniqueness is guaranteed inside the constraint list of each edge
// by the mechanims which adds constraints to an edge. The function
// defined here guarantees this uniqueness across edges. It assigns
// the edge given by the two pairs as the edge to which this constraint
// ID belongs. If a constraint with the same ID is already assigned
// to another edge, that constraint is removed.

LinearConstraints.prototype.allocateEdgeToConstraintId =
    linearConstraintsAllocateEdgeToConstraintId;

function linearConstraintsAllocateEdgeToConstraintId(constraintId, pairId1,
                                                     pairId2)
{
    // if there is an existing constraint with the same ID assigned to
    // another edge, remove that constraint.
    
    var existing = this.constraintById[constraintId];

    if(existing) {
        if((pairId1 != existing[0] || pairId2 != existing[1]) &&
           (pairId2 != existing[0] || pairId1 != existing[1]))
            this.removeConstraint(existing[0], existing[1], constraintId);
        else
            return; // same edge
    }

    // ad a new entry
    this.constraintById[constraintId] = [pairId1, pairId2];
}

// This function removes the allocation of an edge to the given constraint ID.
// If such an allocation existed before this operation took place, this
// allocation is returned by this function, that is, the function returns
// an array [pairId1, pairId2]. If no such allocation existed, undefined
// is returned.

LinearConstraints.prototype.removeEdgeAllocationToConstraintId =
    linearConstraintsRemoveEdgeAllocationToConstraintId;

function linearConstraintsRemoveEdgeAllocationToConstraintId(constraintId)
{
    var allocation = this.constraintById[constraintId];

    if(!allocation)
        return undefined;

    delete this.constraintById[constraintId];

    return allocation;
}

/////////////////////
// Clone Variables //
/////////////////////

// Clone variables are variables which are forced to have the same value
// as the main variable which they clone. This is achieved by defining
// appropriate equations. As a result, in every solution, the main variable
// and its clones must have the same value, but during the solution process,
// the variables may have different values.
// The LinearConstraints object is responsible for assigning the clone
// variables and destroying them when no longer needed.
// When a module wants to make use of a clone variable, it must as
// the linear constraints module to create that variable (that is, it
// cannot ask to use an existing clone variable).Since every new use of
// a clone variable creates a new clone variable, the module which
// requested the clone to be created is also responsible for asking it
// to be destroyed.

// This function is called with a single argument which is the index of 
// a main (non-clone) variable. If such a variable exists, this function
// allocated a new clone variable for this variable and returns the index
// of that clone.

LinearConstraints.prototype.createClone = linearConstraintsCreateClone;

function linearConstraintsCreateClone(mainVariable)
{
    // assign a new index to the clone
    var cloneIndex = nextVariableId();

    // record the clone in the clone table and under the main variable's
    // entry in the variable table.
    this.cloneVariables[cloneIndex] = mainVariable;
    var varEntry;
    if(!(varEntry = this.variables[mainVariable]))
        varEntry = this.variables[mainVariable] = {
            pairs: {},
            numPairs: 0,
            clones: {},
            numClones: 1
        };
    else if(!("clones" in varEntry)) {
        varEntry.clones = {};
        varEntry.numClones = 1;
    } else
        varEntry.numClones++;
    varEntry.clones[cloneIndex] = true;

    if(this.cloneChanges[cloneIndex] == "removed")
        this.cloneChanges[cloneIndex];
    else
        this.cloneChanges[cloneIndex] = "added";
    
    return cloneIndex;
}

// This function is called with the index of a variable. It checks whether
// this variable is a clone variable and, if it is, destroys it.
// This function should be called by the module which created the clone
// variable when it no longer needs the clone variable (clone variables,
// as opposed to the main variables, serve only the module to which they
// were allocated to begin with).

LinearConstraints.prototype.destroyIfClone = linearConstraintsDestroyIfClone;

function linearConstraintsDestroyIfClone(variable)
{
    var mainIndex = this.cloneVariables[variable];

    if(mainIndex == undefined)
        return; // not a clone variable

    delete this.cloneVariables[variable];

    var varEntry;
    if((varEntry = this.variables[mainIndex]) !== undefined && 
       ("clones" in varEntry) && (variable in varEntry.clones)) {
        if(!--varEntry.numClones && varEntry.numPairs == 0)
            delete this.variables[mainIndex];
        else
            delete varEntry.clones[variable];
    }

    if(this.cloneChanges[variable] == "added")
        delete this.cloneChanges[variable];
    else
        this.cloneChanges[variable] = "removed";
}

// This function clears the list of clone changes. It should be called by
// the external module which processes these changes (the equation
// module) after reading the changes list.

LinearConstraints.prototype.clearCloneChanges =
    linearConstraintsClearCloneChanges;

function linearConstraintsClearCloneChanges(variable)
{
    this.cloneChanges = {};
}

// Given a variable, this function returns the main variable associated with
// it. If the variable is a main variable, the variable itself is returned

LinearConstraints.prototype.getMainVariable =
    linearConstraintsGetMainVariable;

function linearConstraintsGetMainVariable(variable)
{
    return (this.cloneVariables[variable] == undefined) ?
        variable : this.cloneVariables[variable];
}
    
///////////////////////////////////
// Auxiliary Interface Functions //
///////////////////////////////////

// This function returns true if the given variable is defined (has some
// pair assigned to it) and false otherwise

LinearConstraints.prototype.variableExists =
    linearConstraintsVariableExists;

function linearConstraintsVariableExists(variable)
{
    return !!this.variables[variable] || !!this.cloneVariables[variable];
}

// This function returns true if there is some linear constraint (whether
// active or suspended) defined for this pair of points. Otherwise, false is
// returned

LinearConstraints.prototype.hasConstraint =
    linearConstraintsHasConstraint;

function linearConstraintsHasConstraint(point1, point2)
{
    // get the pair entry
    var pair = this.getPair(point1, point2);

    if(!pair)
        return false;

    // Check whether there is any active constraint defined for this pair
    if(this.cycles.nodeInForest(pair.id))
        return true;

    // check whether there is any suspended constraint defined for this
    // pair
    return !!this.suspendedIndex[pair.id];
}

// This function returns true if there is some linear constraint defined
// for this variable. Otherwise, false is returned.

LinearConstraints.prototype.hasActiveConstraint =
    linearConstraintsHasActiveConstraint;

function linearConstraintsHasActiveConstraint(variable)
{
    return !!this.byVariable[variable];
}

// Given a constraint ID, this function returns an array with the four points
// of the constraint.
// If no constraint with the given ID is found, undefined is returned.

LinearConstraints.prototype.getPointsById = linearConstraintsGetPointsById;

function linearConstraintsGetPointsById(constraintId)
{
    var pairIds = this.constraintById[constraintId];

    if(!pairIds)
        return undefined;

    var points1 = this.pairById[pairIds[0]].points;
    var points2 = this.pairById[pairIds[1]].points;
    
    return [points1[0], points1[1], points2[0], points2[1]];
}

///////////////
// Debugging //
///////////////

// Given a variable, this function returns a string describing this variable,
// to be used for debug printing. The string includes the variable index
// followed by pair IDs which belong to the variable. If there are more than
// two pairs associated with the variable, only the first two are included
// and '...' indicates that more pair IDs exist.

LinearConstraints.prototype.debugGetVarStr = linearConstraintsDebugGetVarStr;

function linearConstraintsDebugGetVarStr(variable)
{
    var varStr = variable + " (";
    var count = 0;
    var clones = "";
    var cloneCount = 0;

    if(this.cloneVariables[variable])
        // a clone variable
        return varStr + "clone of: " + this.cloneVariables[variable] + ")";

    var varEntry = this.variables[variable];
    if(varEntry.numClones)
        for(var id in varEntry.clones) {

            cloneCount++;
            if(cloneCount > 1)
                clones += ", ";
            if(cloneCount == 3)
                clones += "...";
            else if(cloneCount < 3)
                clones += id;
        }

    for(var id in varEntry.pairs) {
        
        count++;

        if(count > 1)
            varStr += ", ";
        
        if(count > 2) {
            varStr += "...";
            break;
        }

        varStr += id;
    }

    if(!count)
        varStr += "clones: " + clones;

    varStr += ")";

    return varStr;
}
