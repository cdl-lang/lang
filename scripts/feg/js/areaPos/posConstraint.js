// Copyright 2018 Yoav Seginer.
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


///////////////////////////////////
// Single Positioning Constraint //
///////////////////////////////////

// This object is constructed based on a single constraint description.
// Its input is a base area (the base area on which the constraint is
// defined) and the constraint description. The area then generates
// constraints and registers them to the positioning system. The main
// step in translating the constraint description into constraints which
// can be written to the positioning system is the resolution of the point
// descriptions: finding which areas match the condition which appears
// in the point definition. Since a single point definition may match
// multiple areas, a single constraint description can generate multiple
// constraints.
//
// This object allows the constraint decription to be changed or be removed.
// When this happens, the constraints are updated accordingly.
// When the constraints are updated, it is the responsibility of this
// object not only to add the new constraints but also to remove the old
// constraints.
//
// This same object can hold both a segment and a linear constraint. This
// also means that when the constraint definition changes, it can change
// from one type (linear/segment) to another. It is not recomended to
// do this, but it is supported (the old constraints are removed and the
// new ones added).
//
// This object has a unique ID which it uses to assign IDs to the constraints
// it registers to the positioning calculation module. The ID of each
// constraint is the ID of this object + ";" + <ID of pair 1> + ";" +
// <ID of pair 2> (the ID of pair 2 is used only if this is a linear
// constraint). The ID of each pair is simply <label 1> + ";" + <label 2>. 
//
// The structure of the object is as follows:
// {
//    type: <undefined/"linear"/"segment">, // type of constraint
//    baseArea: <the area on which this constraint is defined>,
//    id: <a unique ID used to construct constraint ID (see above)>,
//    priority: <number>, // priority assigned this constraint
//    pairs: [<array of one or two PosPair objects, representing the constraint
//             point pairs>],
//    ids: {
//        <constraint ID>: [2 or 4 point labels of the constraint]
//        ....
//    },
//    idByPair: [
//        {
//           <label 1>: {
//               <label 2>: {
//                   <constraint ID with label1,label2 as its first pair>: true
//                   ....
//               }
//               ....
//           }
//           ....
//        },
//        <identical structure, but index by the second pair of the constraint>
//    ],
//    pairChanges: [<pair changes object>, <pair changes object>],
//    dontProcessPairChanges: <true/false>
//
//    // linear constraint definition (undefined if segment constraint)
//    ratio: <number> // ratio between the offsets of the two point pairs
//
//   // segment constraint definition (undefined if linear constraint)
//   min: <number, possibly -Infinity> // minimal offset allowed
//   max: <number, possibly Infinity> // maximal offset allowed
//   stability: 'min'/'max'/'equals'/ // is this a stability constraint? and,
//                                    // if it is, in which direction
//   preference: 'min'/'max'          // preferred value inside allowed range
//   orGroups: <description of a point> // defines the names of the or-groups
//                                      // to which this 
// }
//
// The table under 'ids' holds the list of constraints defined by this object
// and currently registered to the positioning calculation module. Under
// each id, the labels of the points of the constraint are stored. If the
// constraint is a segment constraint, these are two labels (one pair) and if
// it is a linear constraint, these are four labels (two pairs).
//
// The 'idByPair' table is an indexing of constraint IDs by the point labels
// defining their pairs. There are two tables: idByPair[0] and idByPair[1].
// The first tables stores each ID under the labels of its first pair, the
// second stores each ID under the labels of its second pair. This second
// table exists only if constraint is a linear constraint.
//
// 'pairChanges' is an array which temporarily stores the changes reported
// by the pair objects. These entries are removed after being processed.
//
// 'dontProcessChanges' is a flag which can be set to indicate to the handler
// function (which handles updates from the underlying PosPair objects) not
// to process the changes reported but simply store the changes.

// %%include%%: "posPair.js"

// ID assignment

var posConstraintLastId = 0;

function nextPosConstraintId()
{
    return ++posConstraintLastId;
}

// The constructor takes as arguments the base area (on which the constraint
// is defined) and a description of the constraint. For now, this description
// is assumed to simply be a simple JavaScript data object. 
// If 'priority' is not undefined, the value given in 'priority' overrides
// the priority given inside the description.

function PosConstraint(baseArea, name)
{
    this.baseArea = baseArea;
    this.id = nextPosConstraintId();
    this.pairs = []; // one or two PosPair objects (this constraint's pairs)
    this.ids = {};
    this.idByPair = [{},{}];
    this.pairChanges = [{},{}];
    this.dontProcessPairChanges = false;
    this.name = name; // for author error message only
}

// The default priority assigned to constraints (currently defined to be 0)

PosConstraint.prototype.defaultPriority = 0;

// This function is called with a description of a constraint. The function
// reads the description and modifies the current constraint definition
// accordingly. It then updates the constraints registered to the positioning
// calculation module.
// If 'priority' is not undefined, the value given in 'priority' overrides
// the priority given inside the description.

PosConstraint.prototype.newDescription = posConstraintNewDescription;

function posConstraintNewDescription(constraintDesc, priority)
{
    // Is this a segment constraint or a linear constraint?
    // This does not check that the description is well-formed, only checks
    // for those mandatory fields which distinguish the two types of
    // constraints.
    
    if(mustBeLinearConstraint(constraintDesc)) {

        var ratio = ("ratio" in constraintDesc) ?
            Number(getDeOSedValue(constraintDesc.ratio)) : undefined;

        if(ratio < positioningDefaultZeroRounding &&
           ratio > -positioningDefaultZeroRounding)
            ratio = 0;
        
        // is it a linear constraint with a 0 ratio?
        // we convert these to a segment constraint:
        // { pair1: { p1: <a>, p2: <b> }, pair2: { p1: <c>, p2: <d> }, ratio: 0}
        // becomes
        // { p1: <c>, p2: <d>, min:0, max:0, priority: maxNonSystemPosPriority }
        if (ratio === 0) {

            // take the two points
            var desc = {};
            desc.point1 = constraintDesc.pair2.point1;
            desc.point2 = constraintDesc.pair2.point2;

            // constrain the offset to 0
            desc.equals = 0;

            this.setSegmentConstraint(desc, maxNonSystemPosPriority);
        } else {

            // process as a linear constraint
            this.setLinearConstraint(constraintDesc, priority);
        }
    } else {
        // process as a segment constraint
        this.setSegmentConstraint(constraintDesc, priority);
    }
}

// This function returns true if the description given must be a description
// of a linear constraint if it is well-formed. This is done by checking for
// the existence of the field 'pair1' which must appear in linear constraints
// but may not appear in segment constraints. This function does not check
// that the description actually provides a well-formed constraint definition
// (either a segment or a linear constraint).

function mustBeLinearConstraint(constraintDesc)
{
    return (constraintDesc && constraintDesc.pair1);
}

// This function receive a string as input. This string should be a constraint
// type: "linear", "segment" or undefined. Any other value is also treated as
// undefined. The function sets the this.type field and returns true if
// the type changed and false if it did not change.

PosConstraint.prototype.setType = posConstraintSetType;

function posConstraintSetType(type)
{
    if(this.type == type)
        return false;

    if(type != "linear" && type != "segment")
        type = undefined;
    else
        this.type = type;

    return true;
}

// This function returns the ID assigned to a linear constraint with the
// given labels.

PosConstraint.prototype.createLinearId = posConstraintCreateLinearId;

function posConstraintCreateLinearId(label1, label2, label3, label4)
{
    return this.id + ";" + label1 + ";" + label2 + ";" + label3 + ";" + label4;
}

// This function returns the ID assigned to a segment constraint with the
// given labels.

PosConstraint.prototype.createSegmentId = posConstraintCreateSegmentId;

function posConstraintCreateSegmentId(label1, label2)
{
    return this.id + ";" + label1 + ";" + label2;
}

// Clear all constraint parameters (for both linear and segment constraints)

PosConstraint.prototype.clearConstraintParameters =
    posConstraintClearConstraintParameters;

function posConstraintClearConstraintParameters()
{
    this.priority = undefined;
    
    // linear constraint
    this.ratio = undefined;

    //segment constraint
    this.min = undefined;
    this.max = undefined;
    this.stability = undefined;
    this.preference = undefined;
    this.orGroups = undefined;
}

////////////////////////
// Constraint Removal //
////////////////////////

// This function should be called just before the constraint object is
// destroyed. This destroys the underlying point pairs and removes all
// constraints registered by this constraint object to the global positioning
// calculation module.

PosConstraint.prototype.destroyConstraint = posConstraintDestroyConstraint;

function posConstraintDestroyConstraint()
{
    // remove all constraints registered to the positioning calculation module 
    this.removeAllConstraints();

    // destroy the pairs used in this constraint
    if(this.pairs[0])
        this.pairs[0].destroyPair();
    if(this.pairs[1])
        this.pairs[1].destroyPair();
}

// This function removes all constraints currently registered by this object
// to the positioning calculation module.

PosConstraint.prototype.removeAllConstraints =
    posConstraintRemoveAllConstraints;

function posConstraintRemoveAllConstraints()
{
    // loop over the constraints, by ID, and remove them
    for(var id in this.ids) {
        var labels = this.ids[id];
        
        if(labels.length == 2) // segment constraint
            globalPosConstraintSynchronizer.removeSegment(labels[0], labels[1], id);
        else if(labels.length == 4) // linear constraint
            this.removeLinearFromPosCalc(labels, id);
    }
    
    // clear the ID tables
    this.ids = {};
    this.idByPair[0] = {};
    this.idByPair[1] = {};
}

// This function removes all constraints which have this pair of labels
// as their first (pairNum == 0) or second (pairNum == 1) pair.
// The function clears the entries for these constraints both in 'ids'
// and in 'idByPair'. It also removes the corresponding constraints registered
// to the positioning calculation mechanism.
// This function works for both linear and segment constraints.

PosConstraint.prototype.removeConstraintsByPair =
    posConstraintRemoveConstraintsByPair;

function posConstraintRemoveConstraintsByPair(label1, label2, pairNum)
{
    // get the entry in the 'idByPair' table
    
    if(!this.idByPair[pairNum] || !this.idByPair[pairNum][label1])
        return;

    var entry = this.idByPair[pairNum][label1][label2];

    for(var id in entry) {

        var logLevel = 0; if (logLevel <= ConsoleLogAttributes['constraints'][0])
            mLogger('constraints', logLevel, 
                    "removeConstraintsByPair: label1=" + label1 + " label2=" + label2 + " id=" + id); 

        // remove the constraint from the positioning system
        
        // get the full set of labels
        var labels = this.ids[id];
        
        if(labels.length == 2) // segment constraint
            globalPosConstraintSynchronizer.removeSegment(labels[0], labels[1], id);
        else if(labels.length == 4) // linear constraint
            this.removeLinearFromPosCalc(labels, id);
        
        // delete the constraint ID from the tables
        this.removeIdFromPairEntry(this.idByPair[0], id, labels[0],
                                   labels[1]);
        
        if(labels.length == 4)
            // if a linear constraint, remove the ID from the second pair
            this.removeIdFromPairEntry(this.idByPair[1], id, labels[2],
                                       labels[3]);
        
        delete this.ids[id];
    }
}

// This function adds the given ID under the two given labels in the
// pair entry given (this is either this.idByPair[0] or this.idByPair[1]).

PosConstraint.prototype.addIdUnderPairEntry =
    posConstraintAddIdUnderPairEntry;

function posConstraintAddIdUnderPairEntry(pairEntry, id, label1, label2)
{
    if(!pairEntry[label1])
        pairEntry[label1] = {};

    if(!pairEntry[label1][label2])
        pairEntry[label1][label2] = {};

    pairEntry[label1][label2][id] = true;
}


// This function clears the given ID from the pair entry <label1, label2>
// in the given 'idByPair' object. If the resulting entry <label1, label2>
// becomes empty as a result of this operation, the entry is removed from
// the table.
// The function does not actually check whether pairEntry[label1][label2]
// exists. This means that it is the responsibility of the calling function
// to verify that this is the case (otherwise, a JavaScript error will
// occur).

PosConstraint.prototype.removeIdFromPairEntry =
    posConstraintRemoveIdFromPairEntry;

function posConstraintRemoveIdFromPairEntry(pairEntry, id, label1, label2)
{
    delete pairEntry[label1][label2][id];
    if(isEmptyObj(pairEntry[label1][label2])) {
        delete pairEntry[label1][label2];
        if(isEmptyObj(pairEntry[label1])) {
            delete pairEntry[label1];
        }
    }
}

///////////////////////
// Linear Constraint //
///////////////////////

// This function parses the constraint description object under the assumption
// that it describes a linear constraint. If the parsing was
// successful, the constraint defined by this description are added
// to the positioning system. The constraints previously registered by this
// object to the positioning system are removed (unless the new constraints
// are a modification of the old constraints). If parsing of the constraint
// description fails, all constraints registered by this object to the
// positioning system are removed and none are added.
// If 'priority' is not undefined, the value given in 'priority' overrides
// the priority given inside the description.

PosConstraint.prototype.setLinearConstraint =
    posConstraintSetLinearConstraint;

function posConstraintSetLinearConstraint(constraintDesc, priority)
{
    // Set the type of the constraint to "linear". Returns true if the type
    // changed. 
    var changed = this.setType("linear");

    // If the type changed, must remove all constraints registered to the
    // positioning calculation module.
    if(changed) {
        this.removeAllConstraints();
        this.clearConstraintParameters();
    }

    var newRatio = getDeOSedValue(constraintDesc.ratio); // may be undefined
    var newPriority;

    if(priority != undefined)
        newPriority = priority;
    else if(constraintDesc.priority != undefined)
        newPriority = getDeOSedValue(constraintDesc.priority);
    else
        newPriority = this.defaultPriority; 
    
    // If no pair objects yet, create empty pair objects and register handlers
    for(var i = 0 ; i <= 1 ; ++i)
        if(!this.pairs[i]) {
            this.pairs[i] = new PosPair(this.baseArea, this.cm, this.name);
            // register handlers
            this.pairs[i].registerHandler(new ConstraintPairHandler(this, i));
        }

    // Construct the pairs based on their description. The consequence of
    // the change in the pairs is reported through the registered handlers
    // and, by default, these handlers also process the changes. Here we
    // want to process the changes only after both pairs were updated, so we
    // set a flag disabling immediate processing of the changes.
    this.dontProcessPairChanges = true;
    this.pairs[0].newDescription(constraintDesc.pair1);
    this.pairs[1].newDescription(constraintDesc.pair2);
    this.dontProcessPairChanges = false;

    // process all the changes (and record the new priority and ratio)

    if(!changed) // type did not change, only refresh
        this.updateChangedLinearConstraints(this.pairChanges[0],
                                            this.pairChanges[1], newRatio,
                                            newPriority);
    else
        this.createAllLinearConstraints(newRatio, newPriority);

    // clear the changes
    this.pairChanges[0] = {};
    this.pairChanges[1] = {};
}

// This registers all constraints defined by this PosConstraint object afresh.
// This is usually called when the type of the constraint has changed,
// so that all previous constraints have been removed.
// It goes over all pairs (not only those which have changed) and creates
// a constraint ID for each pair of pairs and then registers the corresponding
// constraint (with the given ratio and priority) to the positioning
// calculation system.

PosConstraint.prototype.createAllLinearConstraints =
    posConstraintCreateAllLinearConstraints;

function posConstraintCreateAllLinearConstraints(ratio, priority)
{
    this.ratio = ratio;
    this.priority = priority;
    
    // Loop over all pair combinations. Create an ID and register a constraint
    // for each of them.
    for(var l1p1 in this.pairs[0].labels)
        for(var l2p1 in this.pairs[0].labels[l1p1])
            for(var l1p2 in this.pairs[1].labels)
                for(var l2p2 in this.pairs[1].labels[l1p2]) {
                    var id = this.createLinearId(l1p1, l2p1, l1p2, l2p2);
                    this.addLinearConstraint(id, [l1p1, l2p1, l1p2, l2p2]);
                }
}

// This function is given the change lists (changes1, changes2) for
// the two pairs defining a linear constraint (it is assumed that the pairs
// have already been updated but the constraints were not). It may be that
// one or both of these change lists are empty. This function also optionally
// receives new values for the ratio and priority of the constraint.
// The function updates the constraint ID list. For IDs which are removed,
// the function also removes the corresponding constraint registered to
// the positioning calculation module. For IDs which are removed,
// a new constraint is added to the positioning calculation module.
// These new constraints are added using the new ratio and priority.
// If either the new priority or new ratios are differerent from the
// existing values, the constraint for the constraint IDs which did not
// change are also updated.

PosConstraint.prototype.updateChangedLinearConstraints =
    posConstraintUpdateChangedLinearConstraints;

function posConstraintUpdateChangedLinearConstraints(changes1, changes2,
                                                     newRatio, newPriority)
{
    var newIds = [];
    
    // based on the change lists, remove constraints whose pairs were removed
    // and return a list of the new constraints to be created (but these
    // are not created yet). This is done for both change lists.
    newIds[0] = this.pairChangesRemoveAndCreateLinear(0, changes1);
    newIds[1] = this.pairChangesRemoveAndCreateLinear(1, changes2);

    // if the new ratio or the new priority are not equal to the old values
    // then register their new values and re-register the constraints
    // currently in the list with their new ratio/priority.

    if(newRatio !== this.ratio || newPriority !== this.priority) {
        this.ratio = newRatio;
        this.priority = newPriority;
        
        for(var id in this.ids)
            this.updateLinearConstraint(id);
    }

    // add the new constraints
    for(var i = 0 ; i <= 1 ; ++i)
        for(var id in newIds[i])
            this.addLinearConstraint(id, newIds[i][id]);
}

// Given a pair number (0 or 1 - first or second pair) and the list of
// changes for that pair, this function removes the linear constraints
// for the pair labels which were removes and creates the IDs for the
// pair labels which were added (but the constraints are not yet added).
// The function returns an object containing the IDs of the new
// constraints which should be added. In this object the IDs are the
// attributes and the values are the four labels for that constraint
// (in the same format as in the 'ids' table).
// This function should only be used when updating a linear constraint.

PosConstraint.prototype.pairChangesRemoveAndCreateLinear = 
    posConstraintPairChangesRemoveAndCreateLinear;
    
function posConstraintPairChangesRemoveAndCreateLinear(pairNum, changes)
{
    var newIds = {};

    var otherPair = 1 - pairNum;
    
    for(var l1 in changes)
        for(var l2 in changes[l1])
            if(changes[l1][l2] == "removed")
                this.removeConstraintsByPair(l1, l2, pairNum);
            else {
                // loop over the current pairs of the other pair and add
                // the corresponding constraint
                for(var l1p2 in this.pairs[otherPair].labels)
                    for(var l2p2 in this.pairs[otherPair].labels[l1p2]) {
                        // record that this constraint needs to be created
                        // (it will be added later)
                        if(!pairNum)
                            newIds[this.createLinearId(l1, l2, l1p2, l2p2)] =
                                [l1, l2, l1p2, l2p2];
                        else
                            newIds[this.createLinearId(l1p2, l2p2, l1, l2)] =
                                [l1p2, l2p2, l1, l2];   
                    }
            }
    
    return newIds;
}

// Given an ID of a constraint which is already in the 'ids' table, this
// function updates the corresponding constraint in the positioning
// calculation module with the ratio and priority currently defined for the
// constraint. This is typically called when the priority and/or the ratio
// has changed.
// If the ratio or priority are undefined, no constraint is registered
// and any existing constraint with the given ID is removed
// from the positioning system. 

PosConstraint.prototype.updateLinearConstraint =
    posConstraintUpdateLinearConstraint;

function posConstraintUpdateLinearConstraint(id)
{
    var points = this.ids[id];
    
    if(!points || points.length != 4)
        return; // no constraint with this ID, or not a linear constraint
    
    if(this.ratio === undefined || this.priority === undefined)
        this.removeLinearFromPosCalc(points, id);
    else
        this.addLinearToPosCalc(points, this.ratio, this.priority, id);
}

// This function adds a new linear constraint with the given ID and
// point labels. The function does not duplicate the array 'labels' but
// stores the object as given.
// If either the ratio or the priority of the constraint is undefined,
// this function does not actually register the constraint to the
// positioning system.

PosConstraint.prototype.addLinearConstraint = posConstraintAddLinearConstraint;

function posConstraintAddLinearConstraint(id, points)
{
    var logLevel = 0; if (logLevel <= ConsoleLogAttributes['constraints'][0])
        mLogger('constraints', logLevel, 
                "addLinearConstraint: p0=" + points[0] + " p1=" + points[1] + 
                " p2=" + points[2] + " p3=" + points[3] + 
                " id=" + id); 
    
    this.ids[id] = points;
    
    // put the id in the idByPair index
    this.addIdUnderPairEntry(this.idByPair[0], id, points[0], points[1]);
    this.addIdUnderPairEntry(this.idByPair[1], id, points[2], points[3]);
    
    if(this.ratio === undefined || this.priority === undefined)
        return; // not fully defined
    
    // register the constraint to the positioning system
    this.addLinearToPosCalc(points, this.ratio, this.priority, id);
}

// This function actually registers the given linear constraint to the 
// positioning system. If the constraint has a pair with two identical points,
// the constraint actually registered is a segment constraint (constraining
// the other pair to an offset of zero). If both pair consist of two identical
// points, no constraint is registered. When a segment constraint is 
// registered, it is registered with a 'maxNonSystemPosPriority' priority,
// as linear constraints are inherently stronger than segment constraints.
//
// As input, the function expects an array 'points' holding the four points
// of the constraint, the 'ratio' of the constraint, the 'priority' of the
// constraint and the 'id' of the constraint. As this is an internal function,
// the validity of the arguments is not checked - this is the responsibility
// of the calling function. 

PosConstraint.prototype.addLinearToPosCalc = 
    posConstraintAddLinearToPosCalc;

function posConstraintAddLinearToPosCalc(points, ratio, priority, id)
{
    // check for pairs with two identical points (these must have an offset
    // of zero). If both pairs are such, no constraint needs to be added.
    // If only one pair is such, add a segment constraint forcing the other
    // pair to have a zero offset.
    if(points[0] == points[1]) {
        if(points[2] == points[3])
            return; // both pairs have two identical points
        else
            globalPosConstraintSynchronizer.addSegment(points[2], points[3], id,
                                 maxNonSystemPosPriority, 0, 0);
    } else if(points[2] == points[3])
        globalPosConstraintSynchronizer.addSegment(points[0], points[1], id, 
                             maxNonSystemPosPriority, 0, 0);
    else
        globalPosConstraintSynchronizer.addLinear(points[0], points[1], points[2], points[3],
                            ratio, priority, id);
}

// This function actually removes the constraint with the given ID from 
// the positioning system. Before removing the constraint, the function
// checks the points on which the constraint is defined. If one of the
// pairs consists of two identical points (while the other pair consists
// of two different points) it is actually a segment constraint which 
// was registered and therefore a segment constraint needs to be removed
// (this segment constraint sets the offset of the non-identical pair to zero).
// If both pairs are of identical points (in ech pair) there is nothing
// to remove. In all other cases, the linear constraint with the given ID
// is removed. 
// The argument 'points' is expected to hold and array containing the
// four points of the constraint.

PosConstraint.prototype.removeLinearFromPosCalc = 
    posConstraintRemoveLinearFromPosCalc;

function posConstraintRemoveLinearFromPosCalc(points, id)
{
    if(points[0] == points[1]) {
        if(points[2] == points[3])
            return; // both pairs have two identical points
        else
            globalPosConstraintSynchronizer.removeSegment(points[2], points[3], id);
    } else if(points[2] == points[3])
        globalPosConstraintSynchronizer.removeSegment(points[0], points[1], id);
    else
        globalPosConstraintSynchronizer.removeLinearById(id);
}

// This function updates the linear constraints based on the given
// changes in the given pair. It is assumed that the other pair did not
// change and that the ratio and priority did not change either.

PosConstraint.prototype.updatePairChangesForLinear =
    posConstraintUpdatePairChangesForLinear;

function posConstraintUpdatePairChangesForLinear(pairNum, changes)
{
    // remove constraints using pairs which were removed and get a list
    // of new pairs to create
    var newIds = this.pairChangesRemoveAndCreateLinear(pairNum, changes);

    // create the new pairs
    for(var id in newIds)
        this.addLinearConstraint(id, newIds[id]);
}

/////////////////////////
// Segment Constraints //
/////////////////////////

// This function parses the constraint description object under the assumption
// that it describes a segment constraint. If the parsing was
// successful, the constraint defined by this description are added
// to the positioning system. The constraints previously registered by this
// object to the positioning system are removed (unless the new constraints
// are a modification of the old constraints). If parsing of the constraint
// description fails, all constraints registered by this object to the
// positioning system are removed and none are added.
// If 'priority' is not undefined, the value given in 'priority' overrides
// the priority given inside the description.

PosConstraint.prototype.setSegmentConstraint =
    posConstraintSetSegmentConstraint;

function posConstraintSetSegmentConstraint(constraintDesc, priority)
{
    // Set the type of the constraint to "segment". Returns true if the type
    // changed. 
    var changed = this.setType("segment");

    // If the type changed, must remove all constraints registered to the
    // positioning calculation module.
    if(changed) {
        this.removeAllConstraints();
        this.clearConstraintParameters();
    }

    // get the new values of the various constaint parameters. min, max
    // and preference can have an undefined value. priority must have some
    // value and stability has a default value of undefined.

    var equalPixels = convertValueToPixels(getDeOSedValue(constraintDesc.equals));
    var newMin = ("min" in constraintDesc && constraintDesc.min !== undefined) ?
        convertValueToPixels(getDeOSedValue(constraintDesc.min)) : equalPixels;
    var newMax = ("max" in constraintDesc && constraintDesc.max !== undefined) ?
        convertValueToPixels(getDeOSedValue(constraintDesc.max)) : equalPixels;
    var newStability = this.getStabilityFromDesc(constraintDesc);
    var newPriority;

    if(priority != undefined)
        newPriority = priority;
    else if(constraintDesc.priority != undefined)
        newPriority = getDeOSedValue(constraintDesc.priority);
    else
        newPriority = this.defaultPriority; 

    var newPreference = getDeOSedValue(constraintDesc.preference);
    var newOrGroups = constraintDesc.orGroups;
    
    // If no pair object yet, create an empty pair object and register handlers
    if(!this.pairs[0]) {
        this.pairs[0] = new PosPair(this.baseArea, this.cm, undefined, this.name);
        // register handlers
        this.pairs[0].registerHandler(new ConstraintPairHandler(this, 0));
    }
    
    // Construct the pair based on its description. The consequences of the
    // changes in the pair would normally be processed by the handler
    // registered to the PosPair object. This handler, however, assumes
    // that the parameters of the constraint did not change. Therefore,
    // we here disable immediate processing of the changes by the handler.
    // Instead, the changes are stored and processed below.

    this.dontProcessPairChanges = true;
    this.pairs[0].newDescription(constraintDesc);
    this.dontProcessPairChanges = false;

    if(!changed)
        this.updateChangedSegmentConstraints(this.pairChanges[0], newMin,
                                             newMax, newStability, newPriority,
                                             newPreference, newOrGroups);
    else
        this.createAllSegmentConstraints(newMin, newMax, newStability,
                                         newPriority, newPreference,
                                         newOrGroups);

    // clear the changes
    this.pairChanges[0] = {};
}

// Given a constraint description, this returns the single string which
// describes the stability part of the constraint. This function
// returns undefined if there is no stability defined on the constraint.

PosConstraint.prototype.getStabilityFromDesc =
    posConstraintGetStabilityFromDesc;

function posConstraintGetStabilityFromDesc(constraintDesc)
{
    var stability = constraintDesc.stability !== undefined ?
        !!getDeOSedValue(constraintDesc.stability) : undefined;
    var stableMin = constraintDesc.stableMin !== undefined ?
        !!getDeOSedValue(constraintDesc.stableMin) : undefined;
    var stableMax = constraintDesc.stableMax !== undefined ?
        !!getDeOSedValue(constraintDesc.stableMax) : undefined;

    if(stability)
        return "equals"; // stability in both directions
    else if(stableMin)
        return stableMax ? "equals" : "min";
    else if(stableMax)
        return "max";

    return undefined; // no stability
}

// This registers all constraints defined by this PosConstraint object afresh.
// This is usually called when the type of the constraint has changed,
// so that all previous constraints have been removed.
// It goes over all pairs (not only those which have changed) and creates
// a constraint ID for each pair and then registers the corresponding
// constraint (with the given parameters) to the positioning
// calculation system.

PosConstraint.prototype.createAllSegmentConstraints =
    posConstraintCreateAllSegmentConstraints;

function posConstraintCreateAllSegmentConstraints(min, max, stability,
                                                  priority, preference,
                                                  orGroups)
{
    this.min = min;
    this.max = max;
    this.stability = stability;
    this.priority = priority;
    this.preference = preference;
    this.orGroups = orGroups;
    
    // Loop over all pairs. Create an ID and register a constraint
    // for each of them.
    for(var l1 in this.pairs[0].labels)
        for(var l2 in this.pairs[0].labels[l1]) {
            var id = this.createSegmentId(l1, l2);
            this.addSegmentConstraint(id, [l1, l2]);
        }
}

// This function is given a change list (changes) for the pair defining
// a segment constraint (it is assumed that the pair has already been updated
// but the constraints were not). This function also receives new values
// for the various segment constraint parameters.
// The function updates the constraint ID list. For IDs which are removed,
// the function also removes the corresponding constraint registered to
// the positioning calculation module. For IDs which are added,
// a new constraint is added to the positioning calculation module.
// These new constraints are added using the new constraint parameters.
// If any of the new paramters is different from the old parameters, 
// the constraint for the constraint IDs which did not change are also updated.

PosConstraint.prototype.updateChangedSegmentConstraints =
    posConstraintUpdateChangedSegmentConstraints;

function posConstraintUpdateChangedSegmentConstraints(changes, newMin, newMax,
                                                      newStability,
                                                      newPriority,
                                                      newPreference,
                                                      newOrGroups)
{
    // based on the change list, remove constraints whose pair was removed
    // and return a list of the new constraints to be created (but these
    // are not created yet).
    var newIds = this.pairChangesRemoveAndCreateSegment(changes);

    // if any of the paramters changed, we need to register the new parameters
    // and refresh the constraint currently in the list.

    if (this.min != newMin || this.max != newMax ||
        this.stability != newStability || this.priority != newPriority ||
        this.preference != newPreference || this.orGroups || newOrGroups) {

        this.min = newMin;
        this.max = newMax;
        this.stability = newStability;
        this.priority = newPriority;
        this.preference = newPreference;
        this.orGroups = newOrGroups;

        for(var id in this.ids)
            this.updateSegmentConstraint(id);
    }

    // add the new constraints
    for(var newId in newIds)
        this.addSegmentConstraint(newId, newIds[newId]);
}

// Given a list of changes for the pair defining a segment constraint,
// this function removes the segment constraints for the pair labels which
// were removes and creates the IDs for the pair labels which were added
// (but the constraints are not yet added).
// The function returns an object containing the IDs of the new
// constraints which should be added. In this object the IDs are the
// attributes and the values are the two labels for that constraint
// (in the same format as in the 'ids' table).
// This function should only be used when updating a segment constraint.

PosConstraint.prototype.pairChangesRemoveAndCreateSegment = 
    posConstraintPairChangesRemoveAndCreateSegment;
    
function posConstraintPairChangesRemoveAndCreateSegment(changes)
{
    var newIds = {};

    for(var l1 in changes)
        for(var l2 in changes[l1])
            if(changes[l1][l2] == "removed")
                this.removeConstraintsByPair(l1, l2, 0);
            else {
                 // pair added, add the corresponding constraint ID to the
                // list of new IDs.
                newIds[this.createSegmentId(l1, l2)] = [l1, l2];
            }
    
    return newIds;
}

// Given an ID of a constraint which is already in the 'ids' table, this
// function updates the corresponding constraint in the positioning
// calculation module with the segment constraint parameters currently
// defined for the constraint. This is typically called when some of these
// parameters have changed.

PosConstraint.prototype.updateSegmentConstraint =
    posConstraintUpdateSegmentConstraint;

function posConstraintUpdateSegmentConstraint(id)
{
    var points = this.ids[id];
    
    if(!points || points.length != 2)
        return; // no constraint with this ID, or not a segment constraint

    globalPosConstraintSynchronizer.addSegment(points[0], points[1], id,
                         this.priority, this.min, this.max, this.stability,
                         this.preference, 
			             !this.orGroups ? undefined : {
			                 baseArea: this.baseArea,
			                 orGroupDesc: this.orGroups
			             });
}

// This function adds a new segment constraint with the given ID and
// point labels. The function does not duplicate the array 'labels' but
// stores the object as given.

PosConstraint.prototype.addSegmentConstraint =
    posConstraintAddSegmentConstraint;

function posConstraintAddSegmentConstraint(id, points)
{
    var logLevel = 0; if (logLevel <= ConsoleLogAttributes['constraints'][0])
        mLogger('constraints', logLevel, 
                "addSegmentConstraint: p0=" + points[0] + " p1=" + points[1] + " id=" + id); 

    this.ids[id] = points;

    // put the id in the idByPair index
    this.addIdUnderPairEntry(this.idByPair[0], id, points[0], points[1]);
    
    globalPosConstraintSynchronizer.addSegment(points[0], points[1], id,
                         this.priority, this.min, this.max, this.stability,
                         this.preference,
              			 !this.orGroups ? undefined : {
			                 baseArea: this.baseArea,
			                 orGroupDesc: this.orGroups
			             });
}


// This function updates the segment constraints based on the given
// changes in the point pair. It is assumed that the other parameters
// (min/max/stability/preference) did not change.

PosConstraint.prototype.updatePairChangesForSegment =
    posConstraintUpdatePairChangesForSegment;

function posConstraintUpdatePairChangesForSegment(changes)
{
    // remove constraints using pairs which were removed and get a list
    // of new pairs to create
    var newIds = this.pairChangesRemoveAndCreateSegment(changes);

    // create the new pairs
    for(var id in newIds)
        this.addSegmentConstraint(id, newIds[id]);
}

///////////////////////
// Callback handling //
///////////////////////

// This function is called when one of the point pair objects notifies of
// changes. The function is called with a pointer to the pair object
// and the number of the pair (0 = this.pairs[0], 1 = this.pairs[1]).
// This function updates the constraints based on the changes in the pair.

PosConstraint.prototype.pairHandler = posConstraintPairHandler;

function posConstraintPairHandler(posPair, pairNum)
{
    if(!this.pairs[pairNum]) {
        cdlInternalError("callback for non-existing pair: ", pairNum);
        return;
    }

    if(this.dontProcessPairChanges) {
        // store the changes, they will be processed later
        for(var label1 in posPair.changes) {

            var pairChanges = posPair.changes[label1];

            if(!this.pairChanges[pairNum][label1])
                this.pairChanges[pairNum][label1] = {};
            
            var entry = this.pairChanges[pairNum][label1];
            
            for(var label2 in pairChanges) {
                if(!entry[label2])
                    entry[label2] = pairChanges[label2];
                else if(entry[label2] != pairChanges[label2])
                    // added and then removed or removed and then added
                    // are equivalent to no change
                    delete entry[label2];
                // otherwise, the change has already been recorded
            }
        }
    } else {
        // apply the changes
        if(this.type == "linear")
            this.updatePairChangesForLinear(pairNum, posPair.changes);
        else if(this.type == "segment")
            this.updatePairChangesForSegment(posPair.changes);
    }
}

/////////////////////////
// Pair Update Handler //
/////////////////////////

// This object is the object registered by a constraint object to the
// underlying point pair objects (PosPair) and receives updates when the
// label pair sets for these pairs change
// The handler object registers which 'PosConstraint' object it was constructed
// for and which of the two pair (pair1/pair2: 0/1) it was registered for.

function ConstraintPairHandler(posConstraint, pairNum)
{
    this.posConstraint = posConstraint;
    this.pairNum = pairNum;
}

// The call function is the function which is called when the object to
// which this handler was registered wants to issue an update notification.
// The first argument to the call function is ignored. The second argument
// is the pair object by which it was called.

ConstraintPairHandler.prototype.call = constraintPairHandlerCall;

function constraintPairHandlerCall(unused, posPair)
{
    if(this.posConstraint)
        this.posConstraint.pairHandler(posPair, this.pairNum);
}

//////////////////////
// Value Conversion //
//////////////////////

// This function converts a Value object into a number of pixels. It supports
// two unit types: 'pureNumber' and unit types which have a 'pixel'
// unit. A pure number is also considered to be in pixel units.
// For ease of use, this function can handle two more types of input:
// numbers (which are returned as is) and string representations of pure
// numbers (no units). In the string case, the string is converted into
// a number.
// If the function fails to convert the value in to pixels, it returns
// 'undefined'. Otherwise, it returns the number of pixels (as a number).

function convertValueToPixels(value)
{
    if(value instanceof Array)
        value = value[0];

    if(value == undefined)
        return undefined;

    if(typeof(value) == "number")
        return value;

    if(typeof(value) == "string") {
        var result = Number(value);
        return isNaN(result) ? undefined : result;
    }

    return undefined;
}
