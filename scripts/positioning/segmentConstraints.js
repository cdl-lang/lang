// Copyright 2017,2018 Yoav Seginer.
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


// This file implements the segment constraints on offsets. The constructor
// receives a 'LinearConstraints' object as input and allows segment
// constraints to be added or removed. For every variable defined by the
// 'LinearConstraints' object, this object defines the segment constraints
// for that variable.
//
// In addition to the segment constraints, this object also stores
// the stability requirements. These requirements do not
// specify values for the pair offset, but specify the priorities for
// keeping the offset unchanged (one not letting it decrease and the
// other for not letting it increase).
//
// The functionality provided by this module is that which is required
// by the equation solution module. Mainly, this means that for
// a given variable and a given value for that variable one can quickly
// get an answer to questions such as which is the minimal or maximal
// value allowed for this variable, what is the priority of the constraint
// which sets this bound, what is the maximal priority of a constraint
// violated by assigning a certain value to a variable and so on.
//
// An external caller may wish to specify more than one constraint for the
// same pair. To allow this, the caller must give the constraint
// an ID (the 'constraint ID'). This ID plays no role when the constraints
// are applied. It only allows one to distinguish
// between different constraints defined for the same pair.
// To remove or modify a constraint, one needs to use the same ID as when
// the constraint was added. One should not asign the same ID to different
// constraints even if they are assigned to different pairs.
//
// When conflicting constraints are defined on pairs which are assigned to
// the same variable by the LinearConstraints module, clone variables are
// created, so that each constraint is defined on a different clone variable.
// A clone variable is a variable which is forced (by the equations generated
// by the system) to have the same solution as the main variable which it
// clones (by adding an equation m - c = 0 where 'm' is the main variable
// and 'c' a clone of that variable). The advantage of defining different
// constraints for the same variable on clone variables is that while the
// solution must assign the clone and the main variable the same value,
// these variables are allowed to have different values during the solution
// process, thus making it possible to initialize them with different values
// (when the constraints conflict) and then use the standard mechanisms to
// decide which constraint to violate and which to satisfy. This also makes
// the implementation of the segment constraints simpler.
//
// The clone variables are managed by the LinearConstraints module, but 
// it is up to the segment constraint module to request the creation of
// such clone variables and to assign the segment constraints to those
// variables (for how this is done, see details below).
//
// Two constraints may share a variable (without cloning) if they do not
// conflict.
//
// All stability constraints defined for a variable are defined on the same
// variable (either the main variable or a clone) since different
// stability constraints cannot conflict with each other. Stability
// constraints are always considered to conflict with other constraints
// (because once some other constraints force the value assigned a variable
// to conflict with the constraints on that variable, the stability on
// the variable would try to maintain that conflict). Therefore, if a
// stability constraint is defined for a variable, either all min/max
// constraints on that variable are assigned to clone variables or a special
// 'stability' clone variable is created.

// This module also supports 'or-groups' (disjunction groups) of constraints.
// If a constraint is labelled by one or more 'or-group' labels than it 
// belongs to the disjunction groups named by these labels. A solution is
// considered to satisfy the disjunction group if it satisfies at least one
// of the constraints in the group.
// 
// The object has the following structure:
// {
//    variables: {
//       <variable index>: <entry for that variable (see below)>
//       ....
//    }
//    pairs: {
//      <point1>: {
//          <point2>: {
//              id: <the pair's ID = <point1>;<point2> in canonical order>
//              dir: <-1/+1> // +1 if this is the canonical order of the pair
//              entry: <Constraint entry, shared by [point1][point2] and
//                      [point2][point1], see below for details>
//          }
//          ....
//      }
//      ....
//    }
//    pairById = {
//       <pair ID>: <pointer to 'pairs[point1][point2].entry' with points
//                   in canonical order>
//       ....
//    }
//    orGroups: {
//        <group ID>: {
//            priority: <group priority>,
//            allPrioritiesEqual: true|false,
//            constraints: {
//                <constraintId>: <pair ID>
//                .....
//            }
//        }
//        ......
//    }
//    changes: {
//        <variable>: true
//        .....
//    }
//    orGroupsRemoved: {
//        <group ID>: {
//             <variable>: true
//             .....
//        }
//        .....
//    }
//    orGroupPriorityChanges: {
//        <group ID>: <original priority>
//        ......
//    }
// }
//
// The entry under each variable index has the following form (where each
// field is defined only if needed):
// {
//    min: {
//           value: <min value>,
//           priority: <priority>,
//           ids: {
//              <constraint ID>: {
//                  priority: <priority for this constraint>
//                  orGroups: <pointer to the 'labels' table of the or-group
//                             object of the constraint (if exists)>
//              }
//              .....
//           }
//           idNum: <number of ids in the ids table>
//           next: <same structure as 'min', for the next (smaller) min value>
//    }
//    max: {
//           value: <max value>,
//           priority: <priority>,
//           ids: {
//              <constraint ID>: {
//                  priority: <priority for this constraint>
//                  orGroups: <pointer to the 'labels' table of the or-group
//                             object of the constraint (if exists)>
//              }
//              .....
//           }
//           idNum: <number of ids in the ids table>
//           next: <same structure as 'max', for the next (larger) max value>
//    }
//    stability: {
//           // maximal priorities among stable min/max constraints
//           // (after flipping into the direction of the point pair)
//           priority: [<stable min priority (non-decrease)>,
//                      <stable max priority (non-increase)>],
//           ids: {
//              <constraint ID>: {
//                  // stability priorities for this constraint (they may
//                  // be the same in both directions or one may be -Infinity)
//                  priority: [<stable min priority (non-decrease)>,
//                             <stable max priority (non-increase)>],
//                  orGroups: <pointer to the 'labels' table of the or-group
//                             object of the constraint (if exists)>
//              }
//              .....
//           }
//    }
//    hasOrGroups: true|false
// }
//
// The min and max entries are the min (max respectively) values of
// the segment constraint(s) which are assigned to the given variable.
// The values here are already adjusted by the ratio specified by
// the linear constraints. Each  entry carries the constraint IDs of the
// constraints specifying that min/max value. Under each ID, the priority
// of the constraint and the or-groups it belongs to are specified.
// The priority of the min/max value is the maximum of the priorities of
// the non-or-group constraints which define it.
// The 'stability' entry appears only if there are stability constraints
// defined for this variable. Since multiple stability constraints may be
// defined on the same variable (they do not conflict) all such constraints
// are stored under the 'ids' list of the stability entry. The 'priority'
// of the stability entry is an array of two priorities: one for the stability
// in each direction (non-decrease first and non-increase second). These
// priorities are the maximal priority (in each direction) of all non-or-group
// stability constraints. 
// The 'orGroups' stored here for each constraint is an optional field which
// appears only when an or-groups object is defined on the constraint entry
// in the pair table (see below). If such or-groups are defined, then they
// are defined by a PosPoint object stored on the constraint entry. This
// PosPoint object contains a 'labels' table which lists (as attributes) all
// group names defined by the PosPoint object. The 'orGroups' field for each
// constraint here, points to this 'labels' table.
// The 'hasOrGroups' is true if any of the constraints defined on the variable
// has an or-group defined. This means that there is a non-empty list of
// or-groups defined on at least one of the constraints on the variable.
//

// Each pair entry has the following form:
// {
//    points: [<first point>,<second point>], // in the canonical order
//    index: <variable index of main variable assigned to this pair>
//    ratio: <the ratio between this pair and the associated variable>
//    stabilityClone: <variable index of clone on which stability constraints
//                     are defined>
//    ids: {
//       <constraint ID>: {
//           priority: <priority of this constraint>,
//           // undefined for min/max means -/+ infinity (respectively).
//           min: <min for this pair>,
//           max: <max for this pair>,
//           stability: "min"|"max"|"equals"|undefined,
//           cloneIndex: <variable index of clone variable (if any) assigned
//                        to the min/max constraint>
//           orGroups: <a PosPoint object defining the or-groups (see below)>,
//           preference: "min"|"max" // for debugging only
//       }
//       ....
//    }
// }
//
// Two conflicting constraints cannot be defined on the same variable.
// Therefore, when such multiple constraints exist, they are assigned to
// clone variables. If a constraint was assigned to a clone variable, the
// index of that clone variable appears here under 'cloneIndex'.
// All stability constraints are assigned to the same variable (as they
// do not conflict). If they are assigned to a clone variable, this
// variable is stored under 'stabilityClone'. Otherwise, 'stabilityClone'
// is undefined and the stability constraints are assigned on the main
// variable. This means that if the same constraint defines both
// stability and min/max constraints, these will not be assigned to the
// same variable.
//
// If or-groups are defined for this constraint, the 'orGroups' field
// holds a PosPoint object initialized based on the description of these
// or-groups (any valid point descirption is also a valid or-group description,
// though some probably make little sense). The labels generated by the
// PosPoint object are the names of the groups in which this constraint
// participates. An or-group of constraints is satisfied iff at least one 
// of the constraints in the group is satisfied (when a constraint appearing
// in more than one group is satisfies, in makes both groups satisfied).
//
// The 'changes' table records changes to the segment and stability
// constraints. This table has the form:
// {
//    <variable index>: <true>
//    ....
// }
// An entry in the 'changes' table is created and set to true if for any
// of the constraint types (min/max/stability) the constraint
// for the given variable may have changed. This does not indicate
// whether a change actually took place and what constraint types were
// changed (this is because this is not checked by the constraint update
// routines and does not seem to be important enough). In addition, a change
// is indicated here if the or-groups of the variable (to which any of
// the constraints on this variable belong) have changed.
//
// Finally, the orGroups table (stored directly under the main object)
// stores an index from group names to constraints which are assigned to
// those groups. For each group name, the table lists the constraint IDs
// of all constraints which are assigned to that group and the pair ID
// on which the constraint is defined.
// In addition, the table stores the priority of each group, which is the
// maximal priority of all constraints in the group. In addition to the
// priority itself, the entry also stores a flag 'allPrioritiesEqual'
// which is true if the priorities of all constraints in the group are equal.
// This is the most common case and knowledge of this fact simplifies
// the refresh of the group priority when a constraint is removed.
//
// The 'orGroupsRemoved' records variables from which a group was removed
// (that is, all constraint in that group were removed from the variable).
//
// The 'orGroupPriorityChanges' table stores the list of or-groups for
// which the priority changed (since the last time this table was cleared).
// The table holds the groups for which the priority changed as attributes
// and under each attribute the priority before the first change is
// stored.

//
// Constructor
//

// The constructor receives a LinearConstraints object as input. If no such
// object is given, the constructor create a new empty linear constraints
// object (this is used to assign variable indices to the pairs).

function SegmentConstraints(linearConstraints)
{
    this.variables = {};
    this.pairs = {};
    this.pairById = {};
    this.linearConstraints =
        linearConstraints ? linearConstraints : new LinearConstraints();
    this.changes = {};
    this.orGroups = {};
    this.orGroupsRemoved = {};
    this.orGroupPriorityChanges = {};
}

/////////////////////////////////
// Constraint Update Functions //
/////////////////////////////////

// This function returns the entry for the given pair. If no entry is
// defined for the given pair (in this or the opposite order) a new
// entry is created with the canonical order as given as input to the
// function.

SegmentConstraints.prototype.getPair = segmentConstraintsGetPair;

function segmentConstraintsGetPair(point1, point2)
{
    if(!point1 || !point2)
        return undefined;
    
    if(!this.pairs[point1])
        this.pairs[point1] = {};
    if(!this.pairs[point2])
        this.pairs[point2] = {};

    if(this.pairs[point1][point2])
        return this.pairs[point1][point2]; // pair already exists

    var linearEntry = this.linearConstraints.getPairVal(point1, point2);
    
    // make sure the canonical direction is the same as in the 
    // LinearConstraints object.
    
    var dir = linearEntry.dir;

    // points in entry are in canonical order
    var entry = {
        points: dir > 0 ? [point1, point2] : [point2, point1],
        index: linearEntry.index,
        // the ratio returned in linearEntry is for the points in the
        // order given, not in the canonical order, but the entry constructed
        // here is for the canonical order, so the ratio may need to be
        // negated.
        ratio: dir > 0 ? linearEntry.ratio : -linearEntry.ratio,
        ids: {}
    };
    
    var id = linearEntry.id;
    
    // create the pair
    this.pairs[point1][point2] = { id: id, dir: dir, entry: entry };
    this.pairs[point2][point1] = { id: id, dir: -dir, entry: entry };
    
    this.pairById[id] = this.pairs[point1][point2].entry;
    
    // return the entry in the direction in which it was requested
    return this.pairs[point1][point2];
}

// This function returns the variable table entry for the given variable
// index. If no entry exists, a new one is created.

SegmentConstraints.prototype.getIndexEntry =
    segmentConstraintsGetIndexEntry;

function segmentConstraintsGetIndexEntry(index)
{
    if(!this.variables[index])
        this.variables[index] = { hasOrGroups: false };

    return this.variables[index];
}

// This function checks whether the given variable index entry is empty,
// and if it is, clears it.

SegmentConstraints.prototype.clearIndexEntry =
    segmentConstraintsClearIndexEntry;

function segmentConstraintsClearIndexEntry(index)
{
    var varEntry = this.variables[index];

    if(!varEntry)
        return;
    
    if(varEntry.min == undefined && varEntry.max == undefined &&
       varEntry.stability == undefined) {
        delete this.variables[index];
        // If this is a clone variable, it can be destroyed (clone variables
        // only host a single constraint, so it is no longer needed).
        this.linearConstraints.destroyIfClone(index);
    }
}

// This function sets a constraint with ID 'constraintID' between
// the two points (in this order) to be within the range [extremum1,extremum2].
// The constraint is assigned the given priority. An existing constraint
// for the same pair and ID is replaced.
// The range [extremum1,extremum2] is interpreted to be a non-empty range,
// so the larger of the two is taken to be the maximum and the smaller of
// the two is taken to be the minimum. If one of extremum1 or extremum2
// is undefined, we take extremum1 to be the minimum and extremum2 as
// the maximum.
// If 'stability' is not undefined, this is also a stability constraint (for the
// given pair, direction(s), and priority).
// If the argument 'preference' is set to either "min" or "max",
// this defines the following constraint:
// 1. "min": min = 0 and max = 0
// 2. "max": min = Infinity
// Since a preference can appear together with extremum1 and extremum2
// specifications, the constraint actually registered is the combined
// constraint (that is, the larger of the minimums specified and
// the smaller of the maximums specified). In case of a "max" preference,
// if there a maximum spacified in the same constraint, both min and max
// are set to that maximum (rather than setting min to Infinity).
// Other values of 'preference' are ignored.
// To define a stability or preference constraint without defining a
// segment constraint, simply use undefined extremum1 and extremum2.
// The 'orGroups' is an optional object of the following form:
// {
//    baseArea: <an area object>,
//    orGroupDesc: <an object which is a valid PosPoint description>
// }
// If given, this pair defines the PosPoint which defines the list of
// labels which are the 'or-group' names for this constraint (a PosPoint
// object is created, or if already exists, updated) based on this object.
// Passing 'undefined' here would remove any existing PosPoint or-group 
// object previously defined for this constraint).

SegmentConstraints.prototype.setConstraint = segmentConstraintsSetConstraint;

function segmentConstraintsSetConstraint(point1, point2, constraintId,
                                         priority, extremum1, extremum2,
                                         stability, preference, orGroups)
{
    // if the constraint is unbound, can remove any existing constraint
    if(extremum1 == undefined && extremum2 == undefined && !stability &&
       preference != "min" && preference != "max") {
        this.removeConstraint(point1, point2, constraintId);
        return;
    }

    if(orGroups && !orGroups.orGroupDesc)
        orGroups = undefined; 

    // if the constraint already exists, did its priority change?
    var priorityChanged = false;
    
    // get the pair entry
    var pair = this.getPair(point1, point2);
    // get the ID entry
    var idEntry = pair.entry.ids[constraintId];
    
    if(!idEntry)
        idEntry = pair.entry.ids[constraintId] = {};
    else
        if(idEntry.priority != priority)
            priorityChanged = true;
    
    // decide which is the maximum and which the minimum and flip in case
    // that the direction is -1.
    if(extremum1 == undefined) {
        if(extremum2 == undefined)
            idEntry.min = idEntry.max = undefined;
        else {
            idEntry.min = (pair.dir == 1) ? undefined : -extremum2;
            idEntry.max = (pair.dir == 1) ? extremum2 : undefined;
        }
    } else if(extremum2 == undefined) {
        idEntry.min = (pair.dir == 1) ? extremum1 : undefined;
        idEntry.max = (pair.dir == 1) ? undefined : -extremum1;
    } else if(extremum1 <= extremum2) {
        idEntry.min = (pair.dir == 1) ? extremum1 : -extremum2;
        idEntry.max = (pair.dir == 1) ? extremum2 : -extremum1;
    } else {
        idEntry.min = (pair.dir == 1) ? extremum2 : -extremum1;
        idEntry.max = (pair.dir == 1) ? extremum1 : -extremum2;
    }
    
    idEntry.priority = priority;
    idEntry.stability = (!stability || stability == "equals" || pair.dir == 1) ?
        stability : (stability == "min" ? "max" : "min");

    // preference 
    if(preference == "min") {
        if(idEntry.min == undefined || idEntry.min < 0)
	  idEntry.min = 
	    (idEntry.max != undefined && idEntry.max < 0) ? idEntry.max : 0;
        if(idEntry.max == undefined || idEntry.max > 0)
            idEntry.max = 
	      (idEntry.min != undefined && idEntry.min > 0) ? idEntry.min : 0;
        idEntry.preference = "min"; // record this fact for debugging purposes
    } else if(preference == "max") {
        if(pair.dir > 0)
            idEntry.min = (idEntry.max == undefined) ? Infinity : idEntry.max;
        else
            idEntry.max = (idEntry.min == undefined) ? -Infinity : idEntry.min;
        idEntry.preference = "max"; // record this fact for debugging purposes
    } else
        delete idEntry.preference;

    // or-groups
    if(orGroups || idEntry.orGroups)
        this.updateOrGroups(pair, constraintId, orGroups, priorityChanged);

    // update the segment constraint for the associated variable
    this.updateVariableSegmentConstraints(pair, constraintId);

    // update the stability constraints
    this.updateVariableStability(pair.entry, constraintId);

    // cleanup and change list update
    
    if(idEntry.min == undefined && idEntry.max == undefined) {
        if(idEntry.cloneIndex) {
            this.clearIndexEntry(idEntry.cloneIndex);
            delete idEntry.cloneIndex;
        }
    }
    
    // this will remove the entry only if it is empty
    this.clearIndexEntry(pair.entry.index);
}

// This function updates a variable entry with the segment constraint (min 
// and max) induced on it by the segment constraint defined on the given pair
// and constraint ID. This does not update the stability constraint (which
// is handled separately). This would delete any previous values induced by the
// same pair and constraint ID.
// If this constraint assigns a min (max) value to a main variable where
// a conflicting min, max or stability constraint is already 
// assigned by another constraint then the constraint is assigned to
// a clone variable.

SegmentConstraints.prototype.updateVariableSegmentConstraints =
    segmentConstraintsUpdateVariableSegmentConstraints;

function segmentConstraintsUpdateVariableSegmentConstraints(pair, constraintId)
{
    if(!pair)
        return;

    var idEntry = pair.entry.ids[constraintId];

    if(!idEntry)
        return;
    
    // For the variable constraint, we need to multiply by the pair's ratio.
    // If the ratio is negative (for this pair in this canonical order) we need
    // to flip the min and max.

    var minVal, maxVal;
    
    if(pair.entry.ratio < 0) {
        if(idEntry.max != undefined)
            minVal = idEntry.max / pair.entry.ratio;
        if(idEntry.min != undefined)
            maxVal = idEntry.min / pair.entry.ratio;
    } else {
        if(idEntry.min != undefined)
            minVal = idEntry.min / pair.entry.ratio;
        if(idEntry.max != undefined)
            maxVal = idEntry.max / pair.entry.ratio;
    }

    // having determined the min/max values, we now need to determine the
    // variable index to which these should be assigned and possibly remove
    // previous values assigned for the same constraint ID.
    this.assignConstraintToVariable(pair.entry, constraintId, minVal,
                                    maxVal);
}

// This function assigns the min and max values of the given constraint to
// a variable and deletes any min and max values assigned by this constraint
// to this or another variable.
// This function also chooses which variable to assign the constraint to,
// a clone or the main variable for the pair. If the constraint is already
// assigned to a clone variable, the assignment remains unchanged. If the
// constraint is not yet assigned or assigned to the main variable,
// the function first checks whether this constraint conflicts with another
// constraint already assigned to that variable.
// If such a conflict exists, a new clone variable is created and assigned
// to the constraint.
// This function also registers an entry in the change list for the variables
// influenced by this change (if there was any change).

SegmentConstraints.prototype.assignConstraintToVariable =
    segmentConstraintsAssignConstraintToVariable;

function segmentConstraintsAssignConstraintToVariable(pairEntry, constraintId,
                                                      minVal, maxVal)
{
    var idEntry = pairEntry.ids[constraintId];
    var index;
    var changed = false; // did the constraint change?
    
    // if this constraint is already assigned to a clone variable,
    // keep this assignment, otherwise check whether a clone needs to
    // be created.
    
    if(idEntry.cloneIndex != undefined)
        index = idEntry.cloneIndex;
    else {

        // check whether this constraint conflicts with some other constraint
        // assigned to this variable
        var varEntry = this.getIndexEntry(pairEntry.index);

        if((minVal != undefined && varEntry.max &&
            varEntry.max.value < minVal &&
            (varEntry.max.idNum > 1 || !varEntry.max.ids[constraintId])) ||
           (maxVal != undefined && varEntry.min &&
            varEntry.min.value > maxVal &&
            (varEntry.min.idNum > 1 || !varEntry.min.ids[constraintId])) ||
           (varEntry.stability &&
            (maxVal != undefined || minVal != undefined))) {
            // there is a (potential) conflict, remove any previous values
            // for this constraint from this variable and assign the
            // constraint to a clone variable
            this.replaceConstraintOnVariable(constraintId, pairEntry.index,
                                             true);
            this.replaceConstraintOnVariable(constraintId, pairEntry.index,
                                             false);

            // need to create a clone
            index = idEntry.cloneIndex =
                this.linearConstraints.createClone(pairEntry.index);

            // add the constraint to the new clone entry
            this.addConstraintToVariable(index, constraintId, minVal,
                                         idEntry.priority, 
					 idEntry.orGroups ? 
					 idEntry.orGroups.labels : undefined,
                                         true);
            this.addConstraintToVariable(index, constraintId, maxVal,
                                         idEntry.priority, 
					 idEntry.orGroups ?
					 idEntry.orGroups.labels : undefined,
                                         false);
            return;
        }

        index = pairEntry.index;
    }

    // modify the constraint on the variable entry (if needed)
    this.replaceConstraintOnVariable(constraintId, index, true, minVal,
                                     idEntry.priority, 
				     idEntry.orGroups ? 
				     idEntry.orGroups.labels : undefined);
    this.replaceConstraintOnVariable(constraintId, index, false, maxVal,
                                     idEntry.priority, 
				     idEntry.orGroups ? 
				     idEntry.orGroups.labels : undefined);
}

// This function receives a constraint ID, a variable index and an
// optional set of new values (value, priority and or-group) for this
// constraint and variable. The or-groups object should be the 'labels' object
// out of the PosPoint object defining the or-groups. 
// The 'isMin' flag indicates whether this is
// a minimum or maximum constraint. The function removes any old
// values for the given constraint ID from the variable entry and if
// new values are provided, it adds the new values on the variable entry.
// If this results in some change to the variable constraint, a change
// is recorded for this variable.

SegmentConstraints.prototype.replaceConstraintOnVariable =
    segmentConstraintsReplaceConstraintOnVariable;

function segmentConstraintsReplaceConstraintOnVariable(constraintId, index,
                                                       isMin, newVal,
                                                       newPriority,
                                                       newOrGroups)
{
    var varEntry = this.getIndexEntry(index);
    
    var prev = undefined;
    var constraint = isMin ? varEntry.min : varEntry.max;
    
    while(constraint) {

        if(constraint.ids[constraintId])
            break;
        
        prev = constraint;
        constraint = constraint.next;
    }

    var entry = constraint ? constraint.ids[constraintId] : undefined;
    var changed = false;

    // the or groups before the change
    var origOrGroups = entry ? entry.orGroups : undefined;
    var origPriority = entry ? entry.priority : undefined;
    
    if(entry && newVal != undefined && newVal == constraint.value) {
        // new value the same as old, so replace directly
        entry.priority = newPriority;
        if(!newOrGroups) {
            if(entry.orGroups) {
                changed = true;
                delete entry.orGroups;
            }
        } else if(newOrGroups != entry.orGroups) {
            entry.orGroups = newOrGroups;
            changed = true;
        }
        // refresh priority if needed
        if(this.updateConstraintPriority(constraint, origPriority, newPriority,
                                         origOrGroups, newOrGroups))
            changed = true;
    } else if(entry) {
        // delete the constraint
        delete constraint.ids[constraintId];
        if(!--constraint.idNum) { // remove this constraint value
            if(prev)
                prev.next = constraint.next;
            else if(isMin)
                varEntry.min = constraint.next;
            else // max
                varEntry.max = constraint.next;

            changed = true;
        } else {
            // refresh priority if needed
            if(this.updateConstraintPriority(constraint, origPriority, 
					     undefined, origOrGroups, 
					     undefined))
                changed = true;
        }
    }
    
    if(newVal != undefined && (!constraint || constraint.value != newVal)){

        // new value defined and it did not replace the old entry directly
        // (because the value changed), so add it.
        
        if(isMin)
            this.addConstraintToVariable(index, constraintId, newVal,
                                         newPriority, newOrGroups, true);
        else
            this.addConstraintToVariable(index, constraintId, newVal,
                                         newPriority, newOrGroups, false);
    }
    
    if(changed)
        this.addChange(index);

    // update the or-group assignment to this variable
    if(origOrGroups || newOrGroups)
        this.refreshOrGroupsOnVariable(index, varEntry, constraintId,
                                       origOrGroups, newOrGroups);
}

// This function adds a constraint with the given ID, value, priority and
// or groups to the min or max entry of the variable with the given index.
// The or-groups object should be the 'labels' object out of the PosPoint 
// object defining the or-groups.
// If 'isMin' is true, the constraint is added to the min constraints
// and otherwise to the max constraints.
// If the min/max constraint on this variable changed as a result of this
// addition, a change is recorded for this variable.

SegmentConstraints.prototype.addConstraintToVariable =
    segmentConstraintsAddConstraintToVariable;

function segmentConstraintsAddConstraintToVariable(index, constraintId,
                                                   value, priority,
                                                   orGroups, isMin)
{
    if(value == undefined)
        return;

    var varEntry = this.getIndexEntry(index);

    // find insertion position
    
    var prev = undefined;
    var constraint = isMin ? varEntry.min : varEntry.max;
    var sign = isMin ? -1 : 1;
    
    while(constraint) {

        if(sign * constraint.value >= sign * value)
            break;
        
        prev = constraint;
        constraint = constraint.next;
    }

    if(!constraint || sign * constraint.value > sign * value) {
        // insert a new entry in the list
        constraint = {
            value: value, priority: -Infinity, ids: {}, idNum: 0,
            next: constraint
        };
        if(prev)
            prev.next = constraint;
        else if(isMin)
            varEntry.min = constraint;
        else
            varEntry.max = constraint;
    }

    var origOrGroups = constraint.ids[constraintId] ?
        constraint.ids[constraintId].orGroups : undefined;
    
    constraint.ids[constraintId] = { priority: priority };

    if(orGroups) {
        constraint.ids[constraintId].orGroups = orGroups;
        this.addChange(index);
    }

    constraint.idNum++;  

    if(this.updateConstraintPriority(constraint, undefined, priority,
                                     origOrGroups, orGroups))
        this.addChange(index);

    if(origOrGroups || orGroups)
        this.refreshOrGroupsOnVariable(index, varEntry, constraintId,
                                       origOrGroups, orGroups);
}

// This function updates a variable entry with the stability
// constraints induced on it by the segment constraint defined on the given
// pair and constraint ID. This would delete any previous stability
// induced by the same pair and constraint ID.
// If the stability of the variable changed as a result of this operation
// (which means that the priority of stability changed or the or-groups
// of the stability changed) this function reports a change for this
// variable.

SegmentConstraints.prototype.updateVariableStability =
    segmentConstraintsUpdateVariableStability;

function segmentConstraintsUpdateVariableStability(pairEntry, constraintId)
{
    if(!pairEntry)
        return false;

    var idEntry = pairEntry.ids[constraintId];

    if(!idEntry)
        return false;

    var index = (pairEntry.stabilityClone == undefined) ?
        pairEntry.index : pairEntry.stabilityClone;
    var indexEntry = this.getIndexEntry(index);
    var stabilityEntry = indexEntry.stability;
    var origOrGroups;
    
    if(!idEntry.stability) {
       if(!stabilityEntry || !stabilityEntry.ids[constraintId])
           return; // nothing changed

       this.removeStability(pairEntry, constraintId);
       return;
       
    } else {
        // add/modify the existing constraint
        
        if(!stabilityEntry) {

            // create a stability clone?
            if(indexEntry.min || indexEntry.max) {
                index = pairEntry.stabilityClone =
                    this.linearConstraints.createClone(pairEntry.index);
                indexEntry = this.getIndexEntry(index);
            }
            
            stabilityEntry = indexEntry.stability = {
                priority: [-Infinity, -Infinity],
                ids: {}
            };
        }

        var entry = stabilityEntry.ids[constraintId];

        if(!entry)
            entry = stabilityEntry.ids[constraintId] = {};

        origOrGroups = entry.orGroups;
        
        entry.priority = idEntry.stability == "min" ?
            [idEntry.priority, -Infinity] :
            (idEntry.stability == "max" ? [-Infinity, idEntry.priority] :
             [idEntry.priority, idEntry.priority]);
        
        if(!idEntry.orGroups) {
            if(entry.orGroups) {
                delete entry.orGroups;
                this.addChange(index);
            }
        } else if(idEntry.orGroups.labels != entry.orGroups) {
            entry.orGroups = idEntry.orGroups.labels;
            this.addChange(index);
        }
    }
    
    // recalculate priority
    this.recalcStabilityPriority(index);

    if(origOrGroups || idEntry.orGroups)
        this.refreshOrGroupsOnVariable(index, indexEntry, constraintId,
                                       origOrGroups,
                                       idEntry.orGroups ?
                                       idEntry.orGroups.labels : undefined);
}

// This function recalculates the stability priority of the given variable
// index. This excludes or-group constraints (which are handled separately).
// If this is different from the previous priority, the new priority
// is set, and a change is recorded for this variable.

SegmentConstraints.prototype.recalcStabilityPriority =
    segmentConstraintsRecalcStabilityPriority;

function segmentConstraintsRecalcStabilityPriority(index)
{
    var indexEntry = this.variables[index];

    if(!indexEntry)
        return; // the variable may have been deleted
    
    var stabilityEntry = indexEntry.stability;

    if(!stabilityEntry)
        return; // the entry may have been deleted
    
    // recalculate priority
    var newPriority = [-Infinity,-Infinity];

    for(var id in stabilityEntry.ids) {

        var s = stabilityEntry.ids[id];
        
        if(s.orGroups && !isEmptyObj(s.orGroups))
            continue; // ignore or-group constraints

        if(newPriority[0] < s.priority[0])
            newPriority[0] = s.priority[0];
        if(newPriority[1] < s.priority[1])
            newPriority[1] = s.priority[1];
    }

    if(stabilityEntry.priority == undefined ||
       newPriority[0] != stabilityEntry.priority[0] ||
       newPriority[1] != stabilityEntry.priority[1]) {
        stabilityEntry.priority = newPriority;
        // update the changes table
        this.addChange(index);
    }
}

// This function removes the stability of the given constraint ID from the
// variable it is currently assigned to. The function receives the
// pair entry on which the constraint is defined as input (because this
// stores the index of the clone on which the stability constraints are
// registered, if registered on a clone).

SegmentConstraints.prototype.removeStability =
    segmentConstraintsRemoveStability;

function segmentConstraintsRemoveStability(pairEntry, constraintId)
{
    var index = (pairEntry.stabilityClone == undefined) ?
        pairEntry.index : pairEntry.stabilityClone;
    
    var indexEntry = this.variables[index];
    
    if(!indexEntry || !indexEntry.stability ||
       !indexEntry.stability.ids[constraintId])
        return; // nothing to remove

    var stabilityEntry = indexEntry.stability;
    
    var origOrGroups = stabilityEntry.ids[constraintId].orGroups;

    delete stabilityEntry.ids[constraintId];
    
    if(origOrGroups)
        this.refreshOrGroupsOnVariable(index, indexEntry, constraintId,
                                       origOrGroups, undefined);

    if(isEmptyObj(stabilityEntry.ids)) {
        delete indexEntry.stability;
        // delete the variable if it is no longer used for any constraint
        this.clearIndexEntry(index);
        this.addChange(index);
		// if this is a stability clone of the original variable, remove it
		// from the original variable's entry
		delete pairEntry.stabilityClone;
    } else
        this.recalcStabilityPriority(index);
}

// This function removes the constraint for the given pair and constraint ID.

SegmentConstraints.prototype.removeConstraint =
    segmentConstraintsRemoveConstraint;

function segmentConstraintsRemoveConstraint(point1, point2, constraintId)
{
    if(!this.pairs[point1] || !this.pairs[point1][point2])
        return; // no constraint to remove

    this.removeConstraintByPairId(this.pairs[point1][point2].id, constraintId);
}

// The following function clears the constraint for the given
// constraint ID under the pair with the given pair ID given pair 'entry'.
// This is an internal function and should not be called directly
// by external functions.

SegmentConstraints.prototype.removeConstraintByPairId =
    segmentConstraintsRemoveConstraintByPairId;

function segmentConstraintsRemoveConstraintByPairId(pairId, constraintId)
{
    var entry =
        this.pairById[pairId] ? this.pairById[pairId] : undefined;
    
    if(!entry || constraintId == undefined || !entry.ids[constraintId])
        return;
    
    var idEntry = entry.ids[constraintId];

    var index = (idEntry.cloneIndex != undefined) ?
        idEntry.cloneIndex : entry.index;

    // remove the min and max
    this.replaceConstraintOnVariable(constraintId, index, true);
    this.replaceConstraintOnVariable(constraintId, index, false);
    
    if(idEntry.stability) {
        // remove the stability (using the standard update function)
        delete idEntry.stability;
        this.updateVariableStability(entry, constraintId);
        this.clearIndexEntry(entry.index);
    }

    if(index != entry.index) // a clone variable
        this.clearIndexEntry(index);
    else
        this.clearIndexEntry(entry.index);

    delete entry.ids[constraintId];

    // cleanup empty pair entries
    if(isEmptyObj(entry.ids)) {
        var point1 = entry.points[0];
        var point2 = entry.points[1];
        delete this.pairById[pairId];
        delete this.pairs[point1][point2];
        if(isEmptyObj(this.pairs[point1]))
            delete this.pairs[point1];
        delete this.pairs[point2][point1];
        if(isEmptyObj(this.pairs[point2]))
            delete this.pairs[point2];
    }
}

// This function removes all constraints defined on the given pair.
// This function does not remove the pair from the associated
// LinearConstraints object. 

SegmentConstraints.prototype.removePair = segmentConstraintsRemovePair;

function segmentConstraintsRemovePair(point1, point2)
{
    if(!this.pairs[point1])
        return; // pair does not exist
    
    var pair = this.pairs[point1][point2];

    if(!pair)
        return; // pair does not exist
    
    // loop over all constraints defined for this pair and remove them
    for(var id in pair.entry.ids)
        this.removeConstraintByPairId(pair.id, id);
}

// This functions sets an entry in the 'changes' table for the given
// variable index.

SegmentConstraints.prototype.addChange = segmentConstraintsAddChange;

function segmentConstraintsAddChange(index)
{
    this.changes[index] = true;
}

SegmentConstraints.prototype.clearChanges = segmentConstraintsClearChanges;

function segmentConstraintsClearChanges()
{
    this.changes = {};
}

////////////////////////////////
// Constraint Priority Update //
////////////////////////////////

// The functions in this section update the non-or-group priority assigned
// to each value in a variable's constraint entry. This is the
// maximum priority of all non-or-group constraints defined on a variable
// for a given value. This priority changes not only when a definition
// of a constraint is added changed or removed but also when the first
// or-group is added to an or-group definition or when the last group
// is removed from such a definition.


// Given a variable constraint entry (as appear under the min, max or stability
// fields of a variable entry) and the previous and new priority and
// or-groups for a single constraint belonging to that entry,
// this function recalculates the priority of the given constraint entry
// (which is the maximum of the priorities of the non-or-group constraints
// stored on the constraint entry. If no non-or-group constraints are stored
// on the entry, the priority is -Infinity.
// If the ID is added/removed, the prev/new (respectively) values should
// be undefined.
// This function modifies the priority of the constraint, if necessary,
// and returns true if the priority has changed (and false otherwise).

SegmentConstraints.prototype.updateConstraintPriority =
    segmentConstraintsUpdateConstraintPriority;

function segmentConstraintsUpdateConstraintPriority(constraint,
                                                    prevPriority, newPriority,
                                                    prevOrGroups, newOrGroups)
{
    if(prevPriority == newPriority && prevOrGroups == newOrGroups)
        return false; // nothing to do

    if(constraint.priority == undefined)
        constraint.priority = -Infinity;
    
    // is the new priority at least as high as the previous priority
    // (in that case, it increases the priority).
    if(newPriority != undefined && newPriority >= constraint.priority
       && isEmptyObj(newOrGroups)) {
        if(constraint.priority == newPriority)
            return false; // nothing changed
        constraint.priority = newPriority;
        return true;
    }

    // new priority lower than current constraint entry priority or does not
    // contribute to it (because the constraint is an or-group constraint).
    // Check whether the previous priority contributed to the total
    // priority of this constraint entry. If it did, we need to recalculate the
    // priority.
    
    if(prevPriority == undefined || prevPriority < constraint.priority ||
       (prevOrGroups && !isEmptyObj(prevOrGroups)))
        // no contribution to the previous entry priority, so no change
        return false;

    // recalculate the priority by looping over all constraints belonging
    // to this entry

    var prevPriority = constraint.priority;
    constraint.priority = -Infinity;
    
    for(var id in constraint.ids) {

        var c = constraint.ids[id];

        if(c.priority > constraint.priority &&
           (!c.orGroups || isEmptyObj(c.orGroups)))
            constraint.priority = c.priority;
    }

    return (prevPriority != constraint.priority);
}

// This function is called to add the priority of the given constraint
// to the non-or-group priority of constraints on the given variable.
// The function receives as arguments the 'variable' on which the constraint
// is defined and the constraint entry (from the pair
// table). This function does not check that the constraint has no or-groups
// (it is up to the calling function to verify this) and adds the priority
// of the this constraint to the priority of constraints on the variable
// at the relevant value(s). It is also assume that the constraint is already
// registered on the relevant variable entry.
// The function returns true if any of the priorities changed.

SegmentConstraints.prototype.addConstraintNonOrGroupPriority =
    segmentConstraintsAddConstraintNonOrGroupPriority;

function segmentConstraintsAddConstraintNonOrGroupPriority(variable, idEntry,
                                                           constraintId)
{
    // get the variable entry
    var varEntry = this.variables[variable];

	if(!varEntry)
		return false;
	
    var changed = false;
    
    for(var field in { min: true, max: true }) {

        if(!varEntry[field] || idEntry[field] === undefined)
            continue; // no constraint defined

        // find the entry for this constraint in the variable entry
        var constraint = varEntry[field];

        while(idEntry[field] != constraint.value)
            constraint = constraint.next;

        if(idEntry.priority > constraint.priority) {
            constraint.priority = idEntry.priority;
            changed = true;
        }
    }

    // stability

    // find the entry for this constraint in the variable entry
    var stabilityEntry = varEntry.stability;
    
    if(!stabilityEntry || idEntry.stability === undefined)
        return changed;

    // get the constraint entry under stability (this already has the correct
    // priorities for each direction).
    var constraintEntry = stabilityEntry.ids[constraintId];

    for(var i = 0 ; i <= 1 ; i++)
        if(constraintEntry.priority[i] > stabilityEntry.priority[i]) {
            stabilityEntry.priority[i] = constraintEntry.priority[i];
            changed = true;
        }
    
    return changed;
}

// This function is called to remove the priority of the given constraint
// from the non-or-group priority of constraints on the given variable.
// The function receives as arguments the 'variable' on which the constraint
// is defined, the constraint ID and the constraint entry (from the pair
// table). This function does not check that the constraint has or-groups
// (it is up to the calling function to verify this) and removes the priority
// of the this constraint from the priority of constraints on the variable
// at the relevant value(s). It is also assumed that the constraint is already
// registered on the relevant variable entry.
// The function returns true if any of the priorities changed.

SegmentConstraints.prototype.removeConstraintNonOrGroupPriority =
    segmentConstraintsRemoveConstraintNonOrGroupPriority;

function segmentConstraintsRemoveConstraintNonOrGroupPriority(variable,
                                                              constraintId,
                                                              idEntry)
{
    // get the variable entry
    var varEntry = this.variables[variable];

	if(!varEntry)
		return false;

    var changed = false;
    
    for(var field in { min: true, max: true }) {

        if(!varEntry[field] || idEntry[field] === undefined)
            continue; // no constraint defined

        // find the entry for this constraint in the variable entry
        var constraint = varEntry[field];

        while(constraint && idEntry[field] != constraint.value)
            constraint = constraint.next;

        if(!constraint)
            // the constraint was not yet added to the variable (will be the
            // same for all fields).
            return false;

        if(idEntry.priority != constraint.priority)
            continue; // constraint priority did not contribute to entry

        var priority = -Infinity;
        
        for(var id in constraint.ids) {
            
            if(id == constraintId)
                continue; // skip the constraint being removed

            var entry = constraint.ids[id];
            
            if(entry.priority <= priority ||
               (entry.orGroups && !isEmptyObj(entry.orGroups)))
               continue; // does not affect the priority

            priority = entry.priority;
        }

        if(constraint.priority != priority) {
            constraint.priority = priority;
            changed = true;
        }
    }

    if(this.removeNonOrGroupStabilityPriority(varEntry, constraintId, idEntry))
        return true;

    return changed;
}

// This function performs the stability priority update for the function
// removeConstraintNonOrGroupPriority. This is slightly different from
// the min and max because there are two priorities (non-increase and
// non-decrease stability). The function returns true if as a result of
// this removal the stability priority (in either direction) of the
// variable changed. Otherwise, it returns false.

SegmentConstraints.prototype.removeNonOrGroupStabilityPriority =
    segmentConstraintsRemoveNonOrGroupStabilityPriority;

function segmentConstraintsRemoveNonOrGroupStabilityPriority(varEntry,
                                                             constraintId,
                                                             idEntry)
{
    if(!varEntry.stability || idEntry.stability === undefined) 
        return false; // no stability defined

    var stabilityEntry = varEntry.stability;

    if(!stabilityEntry)
        return false; // the constraint was not yet added to the variable.

    // get the constraint entry under stability (this already has the correct
    // priorities for each direction).
    var constraintEntry = stabilityEntry.ids[constraintId];

    if(!constraintEntry)
        return false; // was not yet added

    var changed = false;
    
    for(var i = 0 ; i <= 1 ; ++i) {
        if(constraintEntry.priority[i] < stabilityEntry.priority[i])
            continue; // constraint priority did not contribute to entry

        var priority = -Infinity;
        
        for(var id in stabilityEntry.ids) {
            
            if(id == constraintId)
                continue; // skip the constraint being removed
            
            var entry = stabilityEntry.ids[id];
            
            if(entry.priority[i] <= priority ||
               (entry.orGroups && !isEmptyObj(entry.orGroups)))
                continue; // does not affect the priority
            
            priority = entry.priority[i];
        }
        
        if(stabilityEntry.priority[i] != priority) {
            stabilityEntry.priority[i] = priority;
            changed = true;
        }
    }

    return changed;
}

////////////////////////////////////////
// Constrained Pair/Variable Checking //
////////////////////////////////////////

// This function returns true if there is some segment constraint defined
// for this pair of points. Otherwise, false is returned

SegmentConstraints.prototype.hasConstraint =
    segmentConstraintsHasConstraint;

function segmentConstraintsHasConstraint(point1, point2)
{
    if(!this.pairs[point1])
        return false;

    return !!this.pairs[point1][point2];
}

// Given a variable index this function returns true if there
// is some segment constraint defined for the given variable.

SegmentConstraints.prototype.variableHasConstraint =
    segmentConstraintsVariableHasConstraint;

function segmentConstraintsVariableHasConstraint(variable)
{
    return !!this.variables[variable];
}

// Given a pair ID, this function returns true if there
// is some segment constraint defined for the given pair.

SegmentConstraints.prototype.pairHasConstraint =
    segmentConstraintsPairHasConstraint;

function segmentConstraintsPairHasConstraint(pairId)
{
    return !!this.pairById[pairId];
}

// Given a variable index this function returns true if there
// is some or-group constraint defined for the given variable. 

SegmentConstraints.prototype.variableHasOrGroups =
    segmentConstraintsVariableHasOrGroups;

function segmentConstraintsVariableHasOrGroups(variable)
{
    return !!this.variables[variable] && this.variables[variable].hasOrGroups;
}

// Given an variable, this function marks the variable as having or-groups
// defined on at least on of its constraints (the list of or-groups
// should not be empty).

SegmentConstraints.prototype.setVariableHasOrGroups =
    segmentConstraintsSetVariableHasOrGroups;

function segmentConstraintsSetVariableHasOrGroups(variable)
{
    if(!this.variables[variable])
        return; // variable entry not yet defined

    this.variables[variable].hasOrGroups = true;
}

// Given a variable, this function returns the list of or groups
// to which constraints on the variable belong (the or-groups to which the
// variable "belongs"). The list is returned as an object whose attributes
// are the names of the groups (and the value under each attribute is 'true').
// If no constraints on the variable belong to an or-group, the function
// returns undefined. 

SegmentConstraints.prototype.getVariableOrGroups =
    segmentConstraintsGetVariableOrGroups;

function segmentConstraintsGetVariableOrGroups(variable)
{
    var varEntry = this.variables[variable];

    if(!varEntry || !varEntry.hasOrGroups)
        return undefined;
    
    var orGroups = {};

    for(var section in varEntry) {

        var constraint = varEntry[section];
        
        while(constraint) {
            
            for(var id in constraint.ids) {

                if(constraint.ids[id].orGroups)
                    for(var group in constraint.ids[id].orGroups)
                        orGroups[group] = true;
            }

            constraint = constraint.next;
        }
    }

    return orGroups;
}

//////////////////////////////
// Linear Constraint Change //
//////////////////////////////

// This function reads the list of changes in the LinearConstraints object
// and updates the segment constraints accordingly.

SegmentConstraints.prototype.processLinearConstraintChanges =
    segmentConstraintsProcessLinearConstraintChanges;

function segmentConstraintsProcessLinearConstraintChanges()
{
    var changes = this.linearConstraints.changes;
    
    for(var c in changes) {
        if(changes[c].index == undefined)
            continue; // pair was removed
        var points = this.linearConstraints.pairById[c].points;
        this.updateNewIndexOrRatio(points[0], points[1]);
    }
}

// Given a pair of points, (point1, point2), this function checks the
// linear constraint entry for this pair, and if it changed, updates
// the segment constraints for this pair accordingly.

SegmentConstraints.prototype.updateNewIndexOrRatio =
    segmentConstraintsUpdateNewIndexOrRatio;

function segmentConstraintsUpdateNewIndexOrRatio(point1, point2)
{
    if(!this.pairs[point1] || !this.pairs[point1][point2])
        return; // no segment constraints for this pair
        
    var pair = this.pairs[point1][point2];
    var entry = pair.entry;
    // get the linear entry for the pair in the canonical order of
    // the segment constraints.
    var linearEntry = this.linearConstraints.getPairVal(entry.points[0],
                                                        entry.points[1]);
    // check whether the index or ratio changed
    if(entry.index == linearEntry.index &&
       entry.ratio == linearEntry.ratio)
        return; // no change, nothing to update
    
    var oldIndex = entry.index; // the old index (may equal the new index)
    var oldRatio = entry.ratio;

    // if the index changed, remove constraints from the old index
    if(oldIndex != linearEntry.index) {

        for(var cId in entry.ids) {
            
            var idEntry = entry.ids[cId];
        
            // remove min/max constraints
            
            var varIndex = (idEntry.cloneIndex != undefined) ?
                idEntry.cloneIndex : oldIndex;
            delete idEntry.cloneIndex;

            this.replaceConstraintOnVariable(cId, varIndex, true);
            this.replaceConstraintOnVariable(cId, varIndex, false);

            this.removeStability(entry, cId);

            if(varIndex != oldIndex)
                this.clearIndexEntry(varIndex);
        }
    }
    
    // set the new index and ratio
    entry.index = linearEntry.index;
    entry.ratio = linearEntry.ratio;
    
    // Add the constraints under the new index
    for(var cId in entry.ids) {

        var idEntry = entry.ids[cId];
        
        // stability constraints do not change when only the ratio changes.
        if(oldIndex != entry.index)
            // add stability to the new variable
            this.updateVariableStability(entry, cId);

        // add the constraints to the new variable
        this.updateVariableSegmentConstraints(pair, cId);
    }

    // remove the entry if it became empty
    this.clearIndexEntry(oldIndex);
}

////////////////////////////////
// Constraint Query Functions //
////////////////////////////////

/////////////////////////
// min/max constraints //
/////////////////////////

// Given a variable index, this function returns
// the maximum value allowed for this varaible by the constraints defined
// (this is the minimum of the max values for all constraints). A returned
// value of Infinity means that there is no bound.
// If 'ignoreInfinite' is set, this function will ignore -Infinity values
// (which are a constraint which can never be satisified).

SegmentConstraints.prototype.getMax = segmentConstraintsGetMax;

function segmentConstraintsGetMax(index, ignoreInfinite)
{
    var entry = this.variables[index];

    if(!entry || !entry.max)
        return Infinity; // no constraints on this variable
    
    var constraint = entry.max;

    if(ignoreInfinite && constraint.value == -Infinity)
        constraint = constraint.next;
    
    if(constraint)
        return constraint.value;

    return Infinity;
}

// Given a variable index, this function returns
// the minimum value allowed for this varaible by the constraints defined
// (this is the maximum of the min values for all constraints).
// A returned value of -Infinity means that there is no bound.
// If 'ignoreInfinite' is set, this function will ignore Infinity values
// (which are a constraint which can never be satisified).

SegmentConstraints.prototype.getMin = segmentConstraintsGetMin;

function segmentConstraintsGetMin(index, ignoreInfinite)
{
    var entry = this.variables[index];

    if(!entry || !entry.min)
        return -Infinity; // no constraints on this variable
    
    var constraint = entry.min;

    if(ignoreInfinite && constraint.value == Infinity)
        constraint = constraint.next;
    
    if(constraint)
        return constraint.value;

    return -Infinity;
}

// This function returns the priority for the min/max constraint at the
// given value (if any) and the maximal priority of a min/max constraint
// violated by this value (all this for the given index). The 'isMin'
// flag determines whether the min or max constraints are used.
// The result of this function does not include or-group constraints
// (as these are assigned a -Infinity priority in the variable entry).
// If there is a violation, it also returns the maximal violated value
// with this priority (again, excluding or-group constraints).
// The function returns 'undefined' if there is no min/max constraint for this
// given index or the min/max constraint is lower/higher (respectively) than
// the given value. Otherwise, it returns an object of the form:
// {
//    priorityAtVal: <priority of min/max constraint at the given value>
//    violatedPriority: <max priority of min/max constraint violated by this
//                       value>
//    violatedValue: <largest/smallest value of violated min/max constraint
//                    with this priority>
// }
// If 'violatedPriority' is -Infinity, violatedValue is undefined.

SegmentConstraints.prototype.priorityForValue =
    segmentConstraintsPriorityForValue;

function segmentConstraintsPriorityForValue(index, value, isMin)
{
    var entry = this.variables[index];
    
    if(!entry)
        return undefined; // no min/max constraint on this variable

    var constraint = isMin ? entry.min : entry.max;

    if(!constraint)
        return undefined; // no min/max constraint on this variable
    
    var violatedPriority = -Infinity;
    var violatedValue;
    
    while(constraint) {

        var priority = -Infinity;
        
        if((isMin && constraint.value <= value) ||
           (!isMin && constraint.value >= value))
            break;
        
        if(constraint.priority > violatedPriority) {
            violatedPriority = constraint.priority;
            violatedValue = constraint.value;
        }
        constraint = constraint.next;
    }
    
    var result;
    
    if(!constraint || (isMin && constraint.value < value) ||
       (!isMin && constraint.value > value)) {
        // no constraint at value
        if(violatedPriority == -Infinity)
            return undefined;

        result = { priorityAtVal: -Infinity };
    } else
        result = { priorityAtVal: constraint.priority };
    
    result.violatedPriority = violatedPriority;
    if(violatedPriority != -Infinity)
        result.violatedValue = violatedValue;
    
    return result;
}

// Given a variable index and a value, this function returns
// the next constraint after 'value' for the variable. If 'isMin'
// is true, this constraint is the first smaller minimum constraint while
// if it is false,this is the first larger maximum constraint.
// This includes both or-group constraints and non-or-group constraints.
// In case of stability constraints, this is either the stable value or
// -Infinity/Infinity, depending on the value and the direction of movement.
// In order to have access to the stable value, this function takes
// the Resistance object as an argument. 

SegmentConstraints.prototype.nextValue =
    segmentConstraintsNextValue;

function segmentConstraintsNextValue(index, value, isMin, resistance)
{
    var entry = this.variables[index];
    
    if(!entry)
        return isMin ? -Infinity : Infinity; // no constraints on this variable

    if(entry.stability) {
        // stability constraint
        var stableValue = resistance.getStableValue(index);
        if(isMin)
            return (stableValue < value) ? stableValue : -Infinity;
        else
            return (stableValue > value) ? stableValue : Infinity;
    }
    
    if(isMin) {
        
        var constraint = entry.min;
        
        // skip constraints with greater or equal value
        while(constraint && constraint.value >= value)
            constraint = constraint.next;

        return constraint ? constraint.value : -Infinity;
    } else {

        var constraint = entry.max;
        
        // skip constraints with less or equal value
        while(constraint && constraint.value <= value)
            constraint = constraint.next;

        return constraint ? constraint.value : Infinity;
    }
}

// Given a variable and a value for that variable, this function returns
// a list of group names which have constraints for this variable.
// If 'isMin' is true, this looks only at 'min' constraints and otherwise,
// only at max constraints. The groups are returned as the attributes of
// the returned object where the value under each attribute is either
// a number, "[", "]", "(" or ")". If it is a number, the group is violated
// on this variable by the given value and the number returned is the target
// value to which the variable value needs to move in order to remove
// the violation. If it is "(", ")", "[" or "]",
// the group is satisfied on this variable for this value (this refers only
// the min constraints if 'isMin' is set and only to the max constraints
// if 'isMin' is not set). For min constraints "(" and "[" are used and
// for max constraints ")" and "]" are used.
// A group is satisfied if at least one constraint belonging to the group
// is satisfied by the value. If the value is "[" or "]" then the group
// is tight on the value and "(" or ")" if it is no tight. The group is
// not tight on a value if there is at least one constraint in the group
// which is satisfied by the value and the constraint value is not equal to the
// given value. Otherwise, if the group is satisfied, it is tight
// (this means that all group constraints satisfied by the value have
// a value equal to the satisfied value, which means that any movement
// of the value will create a violation).

SegmentConstraints.prototype.getOrGroupMinOrMaxSatisfaction =
    segmentConstraintsGetOrGroupMinOrMaxSatisfaction;

function segmentConstraintsGetOrGroupMinOrMaxSatisfaction(variable, value,
                                                          isMin)
{
    var result = {};
    
    var entry = this.variables[variable];
    var constraint = isMin ? entry.min : entry.max;
    
    // the loop goes over the constraints from the constraints most
    // difficult to satisfy to those easiest to satisfy.
    
    while(constraint) {

        var sat;

        if(isMin)
            sat = (constraint.value > value) ?
                constraint.value : ((constraint.value == value) ? "[" : "(");
        else
            sat = (constraint.value < value) ?
                constraint.value : ((constraint.value == value) ? "]" : ")");

        for(var id in constraint.ids) {
            if(!constraint.ids[id].orGroups)
                continue;
            for(var name in constraint.ids[id].orGroups)
                result[name] = sat;
        }
        constraint = constraint.next;
    }

    return result;
}

// This function goes over the stability constraints which are assigned
// to the variable whose entry is given in 'varEntry' and which belong to
// or-groups. For each or-group separately, this function determines whether
// the given value satisfies the stability constraint of the group on this
// variable. The result is returned in an object of the following form:
// {
//    <group name>: "[)"|"(]"|"()"|"[]"|<number>
//    .....
// }
// The value returned with each group indicates the satifaction for that
// group:
// <number>: the value violates the stability constraint of the group on
//     the given variable. <number> is the stable value of the variable
//     (this is the value which the variable should move to in order
//     to satisfy the group).
// "[)": satisfied, and the group is tight for a decrease in the variable's
//     value, and not tight for an increase.
// "(]": satisfied, and the group is tight for a increase in the variable's
//     value, and not tight for a decrease.
// "[]": satisfied, and the group is tight for both an increase and decrease
//     in the variable's value.
// "()": satisfied, and the group is not tight for both an increase and decrease
//     in the variable's value.
// Because all constraints are relative to the same stable value and since
// it is enough for one constraint in the group to be satisfied,
// there is only a small number of options (and the most permissive of these
// is assigned):
// "[]": only if all stability constraints are on both sides ("equals")
//       and the stable value is equal to the value.
// "[)": if there is at least one "min" stability constraint and
//       the stable value is equal to the value.
// "(]": if there is at least one "max" stability constraint and
//       the stable value is equal to the value.
// "()": if there are both max and min constraints in the group or
//       if there is a min constraint and the stable value < value or
//       there is a max constraint and the stable value > value.

SegmentConstraints.prototype.getOrGroupStabilitySatisfaction =
    segmentConstraintsGetOrGroupStabilitySatisfaction;

function segmentConstraintsGetOrGroupStabilitySatisfaction(varEntry, value,
                                                           stableValue)
{
    if(!varEntry.hasOrGroups || !varEntry.stability)
        return {}; // no or-group constraints

    var result = {};

    for(var id in varEntry.stability.ids) {
        var stabEntry = varEntry.stability.ids[id];
        if(!stabEntry.orGroups)
            continue;

        // calculate satisfaction for this specific constraint

        var satisfaction;

        if((value < stableValue && stabEntry.priority[0] > -Infinity) ||
           (value > stableValue && stabEntry.priority[1] > -Infinity))
            satisfaction = stableValue; // constraint violated
        else if(stabEntry.priority[0] > -Infinity) {
            if(stabEntry.priority[1] > -Infinity)
                satisfaction = "[]";
            else
                satisfaction = (value > stableValue) ? "()" : "[)";
        } else
           satisfaction = (value < stableValue) ? "()" : "(]";

        // combine this satisfaction with that of other constraints, for
        // each of the or-groups.
        for(var name in stabEntry.orGroups) {
            if(!(name in result)) // first contraint for this group
                result[name] = satisfaction;
            else {
                // combine to most permissive
                prevSatisfaction = result[name];
                if(typeof(prevSatisfaction) == "number")
                    result[name] = satisfaction;
                else if(typeof(satisfaction) == "number")
                    continue;
                else {
                    // both satisfy constraints, so take the least tight
                    // use the fact that "(" < "[" and ")" < "]"
                    result[name] =
                        (prevSatisfaction[0] < satisfaction[0] ? 
                         prevSatisfaction[0] : satisfaction[0]) +
                        (prevSatisfaction[1] < satisfaction[1] ? 
                         prevSatisfaction[1] : satisfaction[1])
                }
            }
        }
    }

    return result;
}

// given a variable and a value for that variable, this function returns
// a list of group names for which constraints are defined on the given
// variable. For each group, the satisfaction status of the group is
// indicated. The result is returned as an object of the following form:
// {
//    <group name>: "[)"|"(]"|"()"|"[]"|<number>
//    .....
// }
// The value returned with each group indicates whether the group's constraint
// is satisfied by the value and if it is, whether the constraint is tight
// (that is, the value is on the edge of the allow segment). The values
// have the following meaning:
// <number> - the constraint for this group is violated. The number is
//        the closest target to which the value need to move in order
//        to satisfy the group.
// "[)" - the min constraint for this group is tight, the max constraint
//        is satisfied but not tight.
// "(]" - the min constraint for this group is satisfied but not tight,
//        the max constraint is tight.
// "[]" - both min and max are satisfied but tight.
// "()" - both min and max are satisfied but neither is tight.
// If 'stableValue' is not undefined, this function also checks for stability
// requirements defined for groups. See getOrGroupStabilitySatisfaction()
// for more details on this. Note that as a result of variable cloning,
// the same variable cannot carry both stability constraints and min/max
// constraints.

SegmentConstraints.prototype.getOrGroupSatisfaction =
    segmentConstraintsGetOrGroupSatisfaction;

function segmentConstraintsGetOrGroupSatisfaction(variable, value, stableValue)
{
    var result = {};

    var entry = this.variables[variable];

    if(!entry || !entry.hasOrGroups)
        return result;
    
    result = this.getOrGroupMinOrMaxSatisfaction(variable, value, true);
    var maxResult =
        this.getOrGroupMinOrMaxSatisfaction(variable, value, false);

    // combine the min and max results

    for(var group in result) {

        if(typeof(result[group]) == "number")
            continue;
        else if(!(group in maxResult))
            result[group] = result[group] + ")";
        else if(typeof(maxResult[group]) == "number")
            result[group] = maxResult[group];
        else
            result[group] = result[group] + maxResult[group];
    }
    
    for(var group in maxResult) {
        if(group in result)
            continue; // already handled in the loop above
        if(typeof(maxResult[group]) == "number")
            result[group] = maxResult[group];
        else
            result[group] = "(" + maxResult[group];
    }
    
    if(stableValue == undefined || !entry.stability)
        return result; // no stability or should not be applied.
    
    // stability
    // (which means that 'result' is empty, as, due to cloning, a variable
    // cannot carry stability and min/max constraints) 

    return this.getOrGroupStabilitySatisfaction(entry, value, stableValue);
}

// This function checks whether the resistance of variable 'index' to movement 
// in the given direction 'dir' ("up"/"down") to the given value 'target'
// has resistance -Infinity. If any non-or-group constraint is found which
// resists the movement, 'false' is returned. If any or-group constraints
// are found which resist the movement, the names of the or-groups are 
// returned (the calling function can then check whether the or-group is
// satisfied on some other variable). If no resisting constraints are
// found, true is returned.
// Since constraints offer resistance to movement iff it increases their 
// violation, it does not matter where the movement started. If the direction
// is "up", "max" constraints have to be checked (any constraint
// with value lower than the target resists the movement) and if the direction
// is "down", "min" constraints have to be checked (any constraint
// with value higher than the target resists the movement).   
// If the same group has two (or more) min constraints or two (or more) 
// max constraints defined on a variable, variable's target needs to
// violate all these constraints for the constraints to resist the movement. 

SegmentConstraints.prototype.allowsMovement = 
    segmentConstraintsAllowsMovement;

function segmentConstraintsAllowsMovement(index, dir, target)
{
    var entry = this.variables[index];
    
    if(!entry)
        return true; // no constraints, so allows movement

    var violatedOrGroups;
    
    if(entry.stability) {
        // stability and min/max constraints are never defined on the same
        // variable, so enough to check the stability here 
        return this.stabilityAllowsMovement(entry, dir);
    }
    
    var isMin = (dir == "down"); // do we look at min or max constraints?
    var constraint = isMin ? entry.min : entry.max;
    
    while(constraint) {
        
        if((isMin && constraint.value <= target) ||
           (!isMin && constraint.value >= target))
            break;
        
        if(constraint.priority > -Infinity)
            return false; // non-or-group constraint violated

        if(entry.hasOrGroups) {
            // check or-group constraints
            if(!violatedOrGroups)
                violatedOrGroups = {};
            for(var id in constraint.ids) {
                for(var orGroup in constraint.ids[id].orGroups)
                    violatedOrGroups[orGroup] = true; 
            }
        }
        
        constraint = constraint.next;
    }
    
    if(!violatedOrGroups || isEmptyObj(violatedOrGroups))
        return true;
    
    // check whether any of the violated or groups is satisfied on this 
    // variable (for another constraints)
    while(constraint) {
        for(var id in constraint.ids) {
            for(var orGroup in constraint.ids[id].orGroups)
                delete violatedOrGroups[orGroup];
        }
        
        constraint = constraint.next;
    }
    
    return isEmptyObj(violatedOrGroups) ? true : violatedOrGroups;
}

// This function checks whether the stability constraints on the variable
// whose entry is given by 'varEntry' resist movement of the variable in the
// direction indicated by 'dir'. This implements the function
// allowsMovement() for the case of stability constraints and has the same
// return value.

SegmentConstraints.prototype.stabilityAllowsMovement = 
    segmentConstraintsStabilityAllowsMovement;

function segmentConstraintsStabilityAllowsMovement(varEntry, dir)
{
    if((varEntry.stability.priority[0] > -Infinity && dir == "down") ||
       (varEntry.stability.priority[1] > -Infinity && dir == "up"))
        return false;
    
    if(!varEntry.hasOrGroups)
        return true; // no or-groups, so allowed
        
    // check for or-groups
    var violatedOrGroups = {};
    var satisfiedOrGroups = {};

    for(var id in varEntry.stability.ids) {
        var constraint = varEntry.stability.ids[id];
        if(!constraint.orGroups)
            continue; // not an or-constraint
        if((varEntry.stability.priority[0] == -Infinity && dir == "down") ||
           (varEntry.stability.priority[1] == -Infinity && dir == "up")) {
            for(var orGroup in constraint.orGroups) {
                satisfiedOrGroups[orGroup] = true;
                if(orGroup in violatedOrGroups)
                    delete violatedOrGroups[orGroup];
            }
        } else {
            for(var orGroup in constraint.orGroups) {
                if(!(orGroup in satisfiedOrGroups))
                    violatedOrGroups[orGroup] = true;
            }
        }
    }
        
    return isEmptyObj(violatedOrGroups) ? true : violatedOrGroups;
}

///////////////////////////
// Stability Constraints //
///////////////////////////

// When querying the stability constraints, the value
// one is interested in is the priority of the constraint. For a given
// variable and direction, the priority of the constraint is the maximum of
// the priorities of the stability constraints on the pairs associated with
// that variable (one priority in each direction of movement).

// Get the priority of the stability constraint on the given variable index.
// The returned value is an array of two priorities (the first for
// movement in the 'down' direction and the second for movement in the 'up'
// direction). If there is no stability constraints on this variable,
// undefined is returned.

SegmentConstraints.prototype.getStability = segmentConstraintsGetStability;

function segmentConstraintsGetStability(index)
{
    var entry = this.variables[index];

    if(!entry || !entry.stability || entry.stability.priority == undefined)
        return undefined; // no stability constraints

    return entry.stability.priority;
}

///////////////////////////////
// Preferred Value Functions //
///////////////////////////////

// Given a variable name, this function looks up its segment constraints
// and its stability requirements. It then selects
// the value of the variable based on these constraints and requirements.
//
// The function checks whether the current value is
// within the range allowed by the min and max constraints. If it is,
// the curent value is returned. Otherwise,
// the current value is moved minimally to satisfy the constraints.
// Since stability requirements are never defined on a variable which
// also has min/max requirements, this means that for variables with
// a stability requirement, this function leaves the current value
// unchanged.
//
// Constraints specifying a value of Infinity or -Infinity are ignored here
// (since they can never be satisfied and are only defined to provide
// a violation to pull the variable in a certain direction).
//
// The function takes as input the 'variable' name and its current value
// (which is undefined if the variable is new).
//
// The function returns the preferred value for the variable.
// 

SegmentConstraints.prototype.getPreferredValue =
    segmentConstraintsGetPreferredValue;

function segmentConstraintsGetPreferredValue(index, value)
{
    var entry = this.variables[index];

    if(!entry)
        return 0; // least absolute value when no constraints
    
    // get the min and max
    
    var min = this.getMin(index, true);
    var max = this.getMax(index, true);

    if(value == undefined)
        value = 0;

    // return the allowed value closest to the current value 

    if(min > value)
        value = min;
    else if(max < value)
        value = max;
    // otherwise, leave unchanged
    
    return value; 
}

///////////////
// Or-Groups //
///////////////

// This function receives a pair entry, a constraint ID and an argument 
// 'orGroups' which is either undefined or an object of the form:
// {
//    baseArea: <an area object>,
//    orGroupDesc: <an object which is a valid PosPoint description>
// }
// it then updates the 'orGroups' PosPoint object defined on the constraint 
// for the given pair and constraint ID based on the 'orGroups' argument.
// If the 'orGroups' argument is undefined, the 'orGroups' are deleted 
// from the constraint.
// The argument 'priorityChanged' should be true if the constraint
// already existed before, but its priority now changed. In this case,
// this function also checks whether the priority of the groups the constraint
// belongs to needs to be refreshed.
//
// It is assumed that the constraint entry already exists. If not, the function
// returns without doing anything.

SegmentConstraints.prototype.updateOrGroups = segmentConstraintsUpdateOrGroups;

function segmentConstraintsUpdateOrGroups(pair, constraintId, orGroups,
                                          priorityChanged)
{
    if(!pair)
        return;
    
    var idEntry = pair.entry.ids[constraintId];
    
    if(!idEntry)
        return;
    
    if(!orGroups || !orGroups.baseArea) {
        if(!idEntry.orGroups)
            return; // nothing to do
        this.destroyOrGroups(pair.id, constraintId);
        return;
    }
    
    if(idEntry.orGroups && idEntry.orGroups.baseArea != orGroups.baseArea)
        this.destroyOrGroups(pair.id, constraintId);
    
    if(!idEntry.orGroups) {
        // create a new or-group object
        idEntry.orGroups = new PosPoint(orGroups.baseArea, orGroups.cm);
        // register handlers
        idEntry.orGroups.registerHandler(new OrGroupHandler(this, pair.id, 
                                                            constraintId));
        priorityChanged = false; // everything will anyway be recalculated
    }
    
    // set the new description on the or-group object. The rest will happen 
    // through the handlers registered to the or-group object
    idEntry.orGroups.newDescription(orGroups.orGroupDesc);

    if(priorityChanged)
        for(var groupName in idEntry.orGroups.labels)
            this.refreshOrGroupPriority(groupName);
}

// this function receives a pair ID and the ID of a constraint defined
// on that pair. It then destroys the or-group object stored on that 
// constraint and removes the constraint from all groups to which it 
// previously belonged.

SegmentConstraints.prototype.destroyOrGroups = 
    segmentConstraintsDestroyOrGroups;

function segmentConstraintsDestroyOrGroups(pairId, constraintId)
{
    var pairEntry = this.pairById[pairId];
    
    if(!pairEntry)
        return;
    
    var idEntry = pairEntry.ids[constraintId];
    
    if(!idEntry || !idEntry.orGroups)
        return;

    // destroy the or-group object (this also calls the relevant update
    // handlers with the list of group names which were removed).
    idEntry.orGroups.destroyPoint();
    delete idEntry.orGroups;
}

// This function is called with an or-group name, a pair ID and 
// the ID of a constraint defined on that pair. The function then adds the
// constraint to the given group, which simply amounts to adding the
// constraint to the global or group table and recording a change for
// that group and variable. The priority of the group may also need to
// be updated (it is the maximum priority of constraints in the group).

SegmentConstraints.prototype.addToOrGroup = 
    segmentConstraintsAddToOrGroup;

function segmentConstraintsAddToOrGroup(groupName, pairId, constraintId)
{
    var groupEntry = this.orGroups[groupName];
    if(!groupEntry)
        groupEntry = this.orGroups[groupName] = { priority: -Infinity,
                                                  constraints: {}};
    groupEntry.constraints[constraintId] = pairId;

    var idEntry = this.pairById[pairId].ids[constraintId];
    
    // get the constraint priority
    var priority = idEntry.priority;
    
    if(priority != groupEntry.priority)
        this.refreshOrGroupPriority(groupName);

    // record changes

    // get the variable assigned to this constraint (if already known)
    var index = (idEntry.cloneIndex == undefined) ?
        this.pairById[pairId].index : idEntry.cloneIndex;

    if(index != undefined) {

        if(!isEmptyObj(idEntry.orGroups.labels))
            // this constraint no longer contributes to the non-or-group
            // priority of the constraints on this variable
            this.removeConstraintNonOrGroupPriority(index, constraintId,
                                                    idEntry);
        
        this.addChange(index); // group change is a variable change
        this.delOrGroupRemove(groupName, index); // if previously removed
        // mark that this variable belongs to an or-group
        this.setVariableHasOrGroups(index);
    }
}

// This function is called with an or-group name, a pair ID and 
// a constraint ID of a constraint defined on this pair. The function then 
// removes the constraint from the given group. This amounts to adding the
// constraint to the global or-group table and recording a change for
// that group and variable. The priority of the group may also need to
// be updated (it is the maximum priority of constraints in the group).

SegmentConstraints.prototype.removeFromOrGroup = 
    segmentConstraintsRemoveFromOrGroup;

function segmentConstraintsRemoveFromOrGroup(groupName, pairId,
                                             constraintId)
{
    if(!this.removeFromOrGroupTable(groupName, constraintId))
        return; // not found in list

    // update the priority of the group
    if(this.orGroups[groupName] &&
       !this.orGroups[groupName].allPrioritiesEqual)
        this.refreshOrGroupPriority(groupName);

    // get the constraint entry and the variable entry (if already exists)
    var idEntry = this.pairById[pairId].ids[constraintId];
    var index = (idEntry.cloneIndex == undefined) ?
        this.pairById[pairId].index : idEntry.cloneIndex;
    
    if(index != undefined) {
        
        if(isEmptyObj(idEntry.orGroups))
            // no more groups, this becomes a non-or-group constraint and
            // contributes to its non-or-group priority
            this.addConstraintNonOrGroupPriority(index, idEntry, constraintId);

        // record changes
        this.addChange(index); // group change is a variable change
        this.addOrGroupRemove(groupName, index);
        this.refreshHasOrGroups(index); // still has any or-groups defined?
    }
}

// This function simply removes the entry for the given group and
// constraint from the 'this.orGroups' table. It returns false if the group
// and constraint ID were not found in the table and true otherwise.

SegmentConstraints.prototype.removeFromOrGroupTable = 
    segmentConstraintsRemoveFromOrGroupTable;

function segmentConstraintsRemoveFromOrGroupTable(groupName, constraintId)
{
    var groupEntry = this.orGroups[groupName];
    if(!groupEntry || !(constraintId in groupEntry.constraints))
        return false;
    
    // remove the constraint from the list
    
    delete groupEntry.constraints[constraintId];

    if(isEmptyObj(groupEntry.constraints))
        delete this.orGroups[groupName];

    return true;
}


// Given a group name, this function calculates the priority of the group
// as the maximum of the priorities of all constraints in the group.

SegmentConstraints.prototype.refreshOrGroupPriority =
    segmentConstraintsRefreshOrGroupPriority;

function segmentConstraintsRefreshOrGroupPriority(groupName)
{
    var entry = this.orGroups[groupName];
    
    if(!entry)
        return;

    var priority = -Infinity;
    var first = true;
    var allPrioritiesEqual = true;
    
    var constraints = entry.constraints;

    for(var constraintId in constraints) {
        var pairId = constraints[constraintId];
        var p = this.pairById[pairId].ids[constraintId].priority;
            
        if(p < priority)
            allPrioritiesEqual = false;
        else if(p > priority) {
            if(!first)
                allPrioritiesEqual = false;
            priority = p;
        }

        first = false;
    }

    // if the priority changed and there is no entry yet for this group in
    // the or-group priority change table, store the original priority in
    // the table.
    if(entry.priority != priority &&
       this.orGroupPriorityChanges[groupName] == undefined)
        this.orGroupPriorityChanges[groupName] = entry.priority;
        
    
    entry.priority = priority;
    entry.allPrioritiesEqual = allPrioritiesEqual;
}

// This function receives a variable, the variable's entry (from the
// 'variables' table), and the original (before the change) and new
// (after the change) or-group assigned to a constraint (whose constraint ID
// is given, too) for the given variable. The or-group objects are
// the 'labels' sections of the PosPoint object defining the groups
// (or they may be undefined if no or groups are defined).
// This function should be called after the change has taken place
// (which means that the calling function must store a pointer to the
// original or-group object).
// This function records the changes in group assignment to variables
// (that is, which variables have some constraint belonging to the group)
// as a result of setting the given group on the given constraint.
// Removed groups are recorded in the 'orGroupsRemoved' table and the
// function may also update the 'hasOrGroups' property of the variable.
//

SegmentConstraints.prototype.refreshOrGroupsOnVariable =
    segmentConstraintsRefreshOrGroupsOnVariable;

function segmentConstraintsRefreshOrGroupsOnVariable(variable, varEntry,
                                                     constraintId, origOrGroups,
                                                     newOrGroups)
{
    if(origOrGroups == newOrGroups)
        return; // nothing changed, do nothing

    if(origOrGroups) {
        // find groups which were previously assigned to the constraint,
        // but do not belong to the new or-groups.
        for(var group in origOrGroups) {
            if(newOrGroups && (group in newOrGroups))
                continue; // still assigned to this constraint
            this.removeFromOrGroupTable(group, constraintId);
            // Mark these groups as removed from the variable if no other
            // constraint of this variable belongs to the group.
            if(!this.variableHasOrGroup(varEntry, group)) {
                this.addChange(variable);
                this.addOrGroupRemove(group, variable);
            }
        }
    }
    
    if(newOrGroups && !isEmptyObj(newOrGroups)) {

        varEntry.hasOrGroups = true;

        // find all groups added by this new group assignment. If the group
        // was previously removed from the variable, delete that removal
        for(var group in newOrGroups) {
            if(!origOrGroups || !(group in origOrGroups)) {
                this.addChange(variable);
                this.delOrGroupRemove(group, variable);
            }
        }
        
    } else
        varEntry.hasOrGroups = this.hasAnyOrGroups(varEntry);
}

// Given a variable entry, this function checks whether that variable
// has any constraint belonging to the given group.
// If the group is found in any of the constraints of the
// variable, true is returned. Otherwise, false is returned.

SegmentConstraints.prototype.variableHasOrGroup =
    segmentConstraintsVariableHasOrGroup;

function segmentConstraintsVariableHasOrGroup(varEntry, groupName)
{
    if(!varEntry)
        return false;

    for(var section in varEntry) {

        var constraint = varEntry[section];

        while(constraint) {

            for(var id in constraint.ids) {

                if(constraint.ids[id].orGroups &&
                   constraint.ids[id].orGroups[groupName])
                    return true;
            }

            constraint = constraint.next;
        }
    }

    return false;
}

// This function is given a variable entry (from the 'variables' table).
// It loops over all constraints recorded on the entry and checks
// whether any of them has a or-group defined (a non-empty list of
// or-groups). If yes, it returns true and otherwise false.

SegmentConstraints.prototype.hasAnyOrGroups =
    segmentConstraintsHasAnyOrGroups;

function segmentConstraintsHasAnyOrGroups(varEntry)
{
    if(!varEntry)
        return false;

    for(var section in varEntry) {

        var constraint = varEntry[section];

        while(constraint) {
            
            for(var id in constraint.ids) {

                if(constraint.ids[id].orGroups &&
                   !isEmptyObj(constraint.ids[id].orGroups))
                    return true;
            }

            constraint = constraint.next;
        }
    }

    return false;
}

// Given a variable, this function checks whether any
// or-groups are defined on the variable (that is, any of its constraints
// has a non-empty list of or-groups) and updates the hasOrGroups
// priority on the variable accordingly.

SegmentConstraints.prototype.refreshHasOrGroups =
    segmentConstraintsRefreshHasOrGroups;

function segmentConstraintsRefreshHasOrGroups(variable)
{
    var varEntry = this.variables[variable];

    if(!varEntry)
        return;

    varEntry.hasOrGroups = this.hasAnyOrGroups(varEntry);
}

// This function returns true if the given variable has any constraints
// belonging to or-groups.

SegmentConstraints.prototype.variableHasOrGroups =
    segmentConstraintsVariableHasOrGroups;

function segmentConstraintsVariableHasOrGroups(variable)
{
    var varEntry = this.variables[variable];

    return !!varEntry && varEntry.hasOrGroups;
}

// This function returns the priority of the given or-group. The function
// returns -Infinity if the group or its priority are not defined. 

SegmentConstraints.prototype.getOrGroupPriority =
    segmentConstraintsGetOrGroupPriority;

function segmentConstraintsGetOrGroupPriority(group)
{
    if(!this.orGroups[group] || this.orGroups[group].priority == undefined)
        return -Infinity;

    return this.orGroups[group].priority;
}

// This function adds the removal of 'group' from 'variable' to the
// 'orGroupsRemoved' table.

SegmentConstraints.prototype.addOrGroupRemove =
    segmentConstraintsAddOrGroupRemove;

function segmentConstraintsAddOrGroupRemove(group, variable)
{
    var groupRemovals = this.orGroupsRemoved[group];

    if(!groupRemovals)
        groupRemovals = this.orGroupsRemoved[group] = {};
    
    groupRemovals[variable] = true;
}

// This function deletes the removal of 'group' from 'variable' from the
// 'orGroupsRemoved' table.

SegmentConstraints.prototype.delOrGroupRemove =
    segmentConstraintsDelOrGroupRemove;

function segmentConstraintsDelOrGroupRemove(group, variable)
{
    var groupRemovals = this.orGroupsRemoved[group];

    if(!groupRemovals)
        return; // nothing to do

    delete groupRemovals[variable];
}


// This function clears the lists of or-group changes: removals and priorities

SegmentConstraints.prototype.clearOrGroupChanges =
    segmentConstraintsClearOrGroupChanges;

function segmentConstraintsClearOrGroupChanges()
{
    this.orGroupsRemoved = {};
    this.orGroupPriorityChanges = {};
}

// This function is called when the list of or-group names for the given
// pair and constraint ID has changed. The function then looks up the 
// constraint entry (on which the or-group object is stored) and reads
// the list of changes from the or-group object. It then updates the
// variable constraint structures to refelct the new set of groups.

SegmentConstraints.prototype.orGroupHandler = segmentConstraintsOrGroupHandler;

function segmentConstraintsOrGroupHandler(pairId, constraintId)
{
    // get the constraint
    var pairEntry = this.pairById[pairId];
    
    if(!pairEntry)
        return;
    
    var idEntry = pairEntry.ids[constraintId];
    
    if(!idEntry)
        return;
    
    var orGroups = idEntry.orGroups;
    
    for(var name in orGroups.changes) {
        if(orGroups.changes[name] == "added")
            this.addToOrGroup(name, pairId, constraintId);
        else
            this.removeFromOrGroup(name, pairId, constraintId);
    }
}

/////////////////////////////
// Or-Group Handler Object //
/////////////////////////////

// This object provides a handler which can be registered to or-group object
// (which are PosPoint objects). The 'call' function of this handler object 
// is called by the or-group object when it wants to notify of changes in 
// the list of or-group names defined by the or-group object.
// The handler object registers which constraint it was constructed for.
// This is given by a pointer to the SegmentConstraints object which stores
// the constraints, a pair ID and a constraint ID.

function OrGroupHandler(segmentConstraints, pairId, constraintId)
{
    this.segmentConstraints = segmentConstraints;
    this.pairId = pairId;
    this.constraintId = constraintId;
}

// The first argument to the call function is ignored. The second argument
// is the or-group (PosPoint) object by which it was called.

OrGroupHandler.prototype.call = orGroupHandlerCall;

function orGroupHandlerCall(unused, orGroup)
{
    if(this.segmentConstraints)
        this.segmentConstraints.orGroupHandler(this.pairId, this.constraintId);
}
