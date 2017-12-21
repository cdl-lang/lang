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


// The object defined in this class stores information about or-groups
// of segment constraints and the satisfiaction of these or groups
// by the current solution.
//
// The object has the following structure:
//
// {
//    segmentConstraints: <SegmentConstraints object>
//
//    orGroups: {
//        <group ID>: {
//            satisfied: {
//               <variable>: "(]"|"[)"|"[]"|"()" 
//               ............
//            },
//            numSatisfied: <number of entries in 'satisfied'>
//            violated: {
//               <variable>: <target (number)>
//               ......
//            }
//            numViolated: <number of entries in 'violated'>
//        }
//        .....
//    }
//
//    changes: {
//        <group ID>: {
//             status: "violated"|"satisfied"|"unknown"
//             priority: <priority>
//             variables: {
//                 <variable>: <target (number)>|"(]"|"[)"|"()"|"[]"|undefined
//                 .......
//             }
//        }
//        .........
//    }
// }
//
// For each group, this table lists, under the group ID, those variables
// which are constrained by a constraint in the group and for each
// such variable indicate whether it satisfies the group constraint and
// if it satisfies them, whether they are tight or not (a min constraint is
// tight if moving the variable down even very slightly violates the
// constraint and a max constraint is tight if moving the variable up
// even very slightly violates the constraint).
// Under each variable which satisfies the constraints defined for it
// by the group, one of the following values is stored:
// "(]": max constraint is tight, min constraint is not (this includes
//       the case where no min constraint is defined by the group)
// "[)": min constraint is tight, max constraint is not (this includes
//       the case where no max constraint is defined by the group)
// "[]": both min and max constraints are tight.
// "()": neither the min nor max constraint is tight (one or both of these
//       may not be defined)
// If more than one constraint is defined by a group on the same variable
// then it is enough for one of those constraints to be satisfied
// on the variable for the group to be satisfied on the variable.
// If there is one such constraint which is not tight and one which is
// tight then the group is not tight on the group.
//
// In addition to the list of satisfied variables, there is a counter
// 'numSatisfied' which counts the number of variables on which the
// group is satisfied.
//
// If the group is violated on the variable, the variable is listed
// in the 'violated' table of the group. Under each variable this
// table stores the target value for the variable (the target value is
// the closest value to which the variable can move in order to satisfy
// the group constraint.
//
// While the or groups themselves are defined inside the SegmentConstraints
// mechanism and while they are mainly used to calculate the resistance of
// equation variables (in the Resistance module), the infomration stored
// here also includes the satisfaction status of or-group constraints which
// are defined on variables which are not in the equations (on such
// variables, the group is always satisfied).
//
// Group Status
// ------------
//
// An or-group can either be satisfied (if it is satisfied on one or more
// variables) or violated (if it is not satisfied on any variable).
// The status of the group affects the resistance the or-group induces
// on the movement of the variables (see 'resistance.js' for details).
//
// Changes
// -------
// The 'changes' table records those groups and variables for which
// a change has occurred. The changes table stores for such groups and
// variables the value before the change (since the new value can be
// read from the 'orGroups' table). The change table has the following
// format:
//
// changes: {
//     <group ID>: {
//          status: "violated"|"satisfied"|"unknown"
//          priority: <priority>
//          variables: {
//              <variable>: <target (number)>|"(]"|"[)"|"()"|"[]"|undefined
//              .......
//          }
//     }
//     .........
// }
//
// The table has entries only for those groups where a change took place.
// If the status of the group changed, the original status (before all
// changes took place) is stored under 'status' (an "unknown" value is
// stored if the group is new). If the satisfaction
// or violation of any variable changed, the original satisfaction
// status or optimization target for that variable and that group is
// stored in the changes table. If the variable is new, an 'undefined'
// is stored. If the priority of the group changed, the previous priority
// is stored under 'priority' in the group's entry ('undefined' is stored
// if no previous priority was defined for the group).
//
// The values stored for each group and variable in the changes table are
// the values as they were the last time the changes table was cleared.
// We store these original values because after a sequence of changes it
// may turn out that there was no change after all or we may want to
// know what actions need to be taken following a sequence of changes
// and we need to know the original values for taking such action.
//
// Resistance Calculation
// ----------------------
//
// Whenever the constraints change, the variable values move or the
// constraints belonging to a group change, the or-group update functions
// (of this object) are called (the two functions are
// 'updateVariableSatisfaction()' which is called for each variable
// separately and 'refreshModifiedGroups()' which is called once for
// all groups removed from variables and priorities which changed.
// These functions update the structure of this OrGroups object.
// After all changes are processed and recorded in the 'changes' table,
// the effect of these changes on the resistance of the various variables
// need to be calculated. This is the responsibility of the Resistance
// object, which reads the changes from the OrGroups object, processes
// them and then clears the changes.

//
// Constructor
//

// The constructor takes the SegmentConstraints object as its only argument.

function OrGroups(segmentConstraints)
{
    this.segmentConstraints = segmentConstraints;
    
    this.orGroups = {};
    this.changes = {};
}

///////////////////////////////////
// Access to Or Group Properties //
///////////////////////////////////

// This function returns the current group status for the given group. This
// can be either "satisfied", "violated" or "unknown" (if the group
// does not appear in the 'orGroups' table).

OrGroups.prototype.getGroupStatus = orGroupsGetGroupStatus;

function orGroupsGetGroupStatus(group)
{
    if(!this.orGroups[group])
        return "unknown";

    return this.orGroups[group].numSatisfied > 0 ? "satisfied" : "violated";
}

// This function returns the current group satisfaction for the given
// variable. This can be either "(]", "[)", "()", "[]" if the group
// is satisfied on the variable, undefined, if there is no constraint
// of this group defined on the given variable or a number, which
// is the optimization target for this group on the given variable
// in case the group is violated on the variable.

OrGroups.prototype.getOrGroupSatisfaction = orGroupsGetOrGroupSatisfaction;

function orGroupsGetOrGroupSatisfaction(group, variable)
{
    var groupEntry = this.orGroups[group];
    
    if(!groupEntry)
        return undefined;
    
    if(groupEntry.satisfied[variable])
        return groupEntry.satisfied[variable];

    if(variable in groupEntry.violated)
        return groupEntry.violated[variable];

    return undefined;
}

// Given a group name and a variable, this function returns true if the
// group is satisfied on the variable and false otherwise.

OrGroups.prototype.isOrGroupSatisfiedOnVariable =
    orGroupsIsOrGroupSatisfiedOnVariable;

function orGroupsIsOrGroupSatisfiedOnVariable(group, variable)
{
    return !!this.orGroups[group] && this.orGroups[group].satisfied[variable];
}

// Given a group name and a variable, this function returns true iff the
// group is satisfied on this variable and on no other variable.

OrGroups.prototype.orGroupSatisfiedOnVariableOnly =
    orGroupsOrGroupSatisfiedOnVariableOnly;

function orGroupsOrGroupSatisfiedOnVariableOnly(group, variable)
{
    return !!this.orGroups[group] && this.orGroups[group].satisfied[variable]
        && this.orGroups[group].numSatisfied == 1;
}


// Given a group name and a variable, this function returns true if the
// group is satisfied on some other variable than the given variable
// (otherwise false is returned).

OrGroups.prototype.isOrGroupSatisfiedOnOtherVariable =
    orGroupsIsOrGroupSatisfiedOnOtherVariable;

function orGroupsIsOrGroupSatisfiedOnOtherVariable(group, variable)
{
    if(!this.orGroups[group])
        return false;
    
    for(var v in this.orGroups[group].satisfied) {
        if(v != variable)
            return true;
    }
    
    return false;
}


// Given an or-group name, this function returns the first (in the ordered
// stored) variable which satisfies the constraints of this group.
// The (optional) argument 'except' may hold a variable and in this case
// this function will not return that variable.
// If the group is not defined or is not satisfied on any variable at all
// or other than 'except' (if given), undefined is returned.

OrGroups.prototype.getFirstSatisfiedVariable =
    orGroupsGetFirstSatisfiedVariable;

function orGroupsGetFirstSatisfiedVariable(group, except)
{
    var groupEntry = this.orGroups[group];
    
    if(!groupEntry)
        return undefined;
    
    for(var variable in groupEntry.satisfied) {

        if(variable == except)
            continue;
        
        return variable;
    }

    return undefined;
}

// This function returns the list of satisfied variables for the given
// or-group. undefined is returned if the group does not exist

OrGroups.prototype.getSatisfiedVariables =
    orGroupsGetSatisfiedVariables;

function orGroupsGetSatisfiedVariables(group)
{
    if(!this.orGroups[group])
        return undefined;
    
    return this.orGroups[group].satisfied;
}

/////////////////////////
// Satisfaction Update //
/////////////////////////

// Given a variable and a value, this function updates the satisfaction of
// all groups with constraints defined on this variable, for the given
// value assignment to the variable. If a 'stableValue' is provided, this
// also includes the stability constraints.
// This function should be called after the value assigned to a variable
// has changed or when the constraints on the variable have changed.
// This function looks at the constraints as currently defined on
// the variable. It cannot handle the removal of groups from a variable
// (as it does not have any knowledge of such removals).
// Removals are handled separately by the function 'removeVariableFromGroup()'.

OrGroups.prototype.updateVariableSatisfaction =
    orGroupsUpdateVariableSatisfaction;

function orGroupsUpdateVariableSatisfaction(variable, value, stableValue)
{
    // get the group satisfaction for this variable and value
    var satisfaction =
        this.segmentConstraints.getOrGroupSatisfaction(variable, value,
                                                       stableValue);

    // update the or-group entries
    for(var group in satisfaction) {

        var groupEntry = this.orGroups[group];
        
        if(!groupEntry) {
            groupEntry = this.orGroups[group] = {
                satisfied: {},
                numSatisfied: 0,
                violated: {},
                numViolated: 0
            }
            // new group
            this.addStatusChange(group, "unknown");
        }
        
        if(typeof(satisfaction[group]) == "number") {
            
            // violation of this group
            
            if(groupEntry.satisfied[variable]) {
                this.addVariableChange(group, variable,
                                       groupEntry.satisfied[variable]);
                delete groupEntry.satisfied[variable];
                groupEntry.numSatisfied--;
                if(!groupEntry.numSatisfied)
                    this.addStatusChange(group, "satisfied");
                groupEntry.numViolated++;
            } else if(groupEntry.violated[variable] != undefined) {
                if(groupEntry.violated[variable] != satisfaction[group])
                    this.addVariableChange(group, variable,
                                           groupEntry.violated[variable]);
            } else {
                groupEntry.numViolated++;
                this.addVariableChange(group, variable, undefined);
            }
            groupEntry.violated[variable] = satisfaction[group];
            
        } else {
            
            // group is satisfied on this variable

            if(groupEntry.violated[variable] != undefined) {
                
                this.addVariableChange(group, variable,
                                       groupEntry.violated[variable]);
            
                delete groupEntry.violated[variable];
                groupEntry.numViolated--;
            }
            
            if(!groupEntry.satisfied[variable]) {

                this.addVariableChange(group, variable, undefined);
                
                groupEntry.numSatisfied++;

                if(groupEntry.numSatisfied == 1)
                    this.addStatusChange(group, "violated");
                    
            } else if(groupEntry.satisfied[variable] != satisfaction[group])
                this.addVariableChange(group, variable,
                                       groupEntry.satisfied[variable]);
            
            groupEntry.satisfied[variable] = satisfaction[group];
        }
    }
}

// This function should be called to remove a variable from a group.
// The variable's entry is removed from the group.

OrGroups.prototype.removeVariableFromGroup =
    orGroupsRemoveVariableFromGroup;

function orGroupsRemoveVariableFromGroup(variable, group)
{
    var groupEntry = this.orGroups[group];
    var removedLastViolation = false;
    
    if(!groupEntry)
        return;
    
    if(groupEntry.satisfied[variable]) {
        
        groupEntry.numSatisfied--;

        if(!groupEntry.numSatisfied) // group became violated
            this.addStatusChange(group, "satisfied");

        this.addVariableChange(group, variable,
                               groupEntry.satisfied[variable]);
        delete groupEntry.satisfied[variable];
        
    } else if(groupEntry.violated[variable] != undefined) {
        this.addVariableChange(group, variable, groupEntry.violated[variable]);
        delete groupEntry.violated[variable];
        groupEntry.numViolated--;

        // If nothing else happens, the group will be removed. Record
        // the status change - this will not override a previously
        // status change from "satisfied".
        if(!groupEntry.numViolated && !groupEntry.numSatisfied)
            this.addStatusChange(group, "violated");
    }

    if(!groupEntry.numSatisfied && !groupEntry.numViolated)
        // remove the group
        delete this.orGroups[group];
}

// This function reads from SegmentConstraints the list of groups which
// were removed from variables and the list of groups whose priority
// changed and updates the or group tables.

OrGroups.prototype.refreshModifiedGroups =
    orGroupsRefreshModifiedGroups;

function orGroupsRefreshModifiedGroups()
{
    var removals = this.segmentConstraints.orGroupsRemoved;
    
    for(var group in removals)
        for(var variable in removals[group])
            this.removeVariableFromGroup(variable, group);

    var priorityChanges = this.segmentConstraints.orGroupPriorityChanges;
    
    for(var group in priorityChanges)
        // simply record this change in the group changes table
        this.addPriorityChange(group, priorityChanges[group]);
    
    this.segmentConstraints.clearOrGroupChanges();
}

/////////////
// Changes //
/////////////

// This function is used to record a change in the satisfaction of
// a group by a variable. The function is given a group ID, a variable
// and the satisfaction value of the variable before the change
// (this can be "[)", "(]", "[]", "()", undefined or a number
// (in case of a violation, in which case the number is optimization
// target of the violation).
// The function checks whether a variable change is already recorded
// in the changes table for this group and variable. If it is, the
// function does nothing. If not change is yet recorded, the function
// records the given value under the group and variable. This
// ensures that the changes table always records the original satisfaction
// value of the variable before all changes recorded in this round. 

OrGroups.prototype.addVariableChange = orGroupsAddVariableChange;

function orGroupsAddVariableChange(group, variable, origValue)
{
    if(!this.changes[group])
        this.changes[group] = {};

    if(!this.changes[group].variables)
        this.changes[group].variables = {};
    
    if(!(variable in this.changes[group].variables))
        this.changes[group].variables[variable] = origValue;
}

// This function is called when the satisfaction status of the group
// changes. The function is given the status before the change
// ("violated", "satisfied" or "unknown"). The function checks whether
// there is a change already recorded for the status. If there is,
// it does not do anything. Otherwise, the given origStatus is recorded
// under the 'status' field of the group's change entry.

OrGroups.prototype.addStatusChange = orGroupsAddStatusChange;

function orGroupsAddStatusChange(group, origStatus)
{
    if(!this.changes[group])
        this.changes[group] = {};

    if(!this.changes[group].status)
        this.changes[group].status = origStatus;
}

// This function is called when the priority of the group
// changes. The function is given the priority before the change
// (undefined or a number). The function checks whether
// there is a change already recorded for the priority. If there is,
// it does not do anything. Otherwise, the given original priority is recorded
// under the 'priority' field of the group's change entry.

OrGroups.prototype.addPriorityChange = orGroupsAddPriorityChange;

function orGroupsAddPriorityChange(group, origPriority)
{
    if(!this.changes[group])
        this.changes[group] = {};

    if(!("priority" in this.changes[group]))
        this.changes[group].priority = origPriority;
}

OrGroups.prototype.clearChanges = orGroupsClearChanges;

function orGroupsClearChanges()
{
    this.changes = {};
}
