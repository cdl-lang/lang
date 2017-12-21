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


// The functions in this file are part of the AllPosConstraints object.

// The functions in this file are responsible for creating the constraints
// which are implied by certain pre-defined points. For example,
// the use of a center point (of type 'horizontal-center' or
// 'vertical-center') implicitly implies a constraint positioning this
// point at the horizontal/vertical center of the relevant area.
// In principle, these constraints could have been added in advance
// for all such possible points, but this would be wasteful. Therefore,
// the constraints defining the automatically defined position of such points
// are added on demand (and are removed once the point is no longer used).
// Therefore, in addition to adding the relevant constraints the functions
// here must keep track of requests to create and destroy such points
// so that the constraints can be cleared once all requests to use
// a point have been destroyed.
//
// As point labels are created by the PosPoint object, it is up to
// the PosPoint for each specific point type to request
// the creation of the automatic constraints for the given point label.
// This request is sent to the AllPosConstraints of the area responsible
// for the automatic constraints implied by that point.
// Similarly, when the point label is removed, the PosPoint notifies
// the relevant AllPosConstraints object that the label is no longer used.
// 
// To keep track of such requests, the following table is used:
//
// automaticPointConstraints: {
//     <point label>: {
//         use: <an IdMgr object>,
//         constraintNames: {
//             <constraint name>: true,
//             ....
//         }
//         <additional fields, depending on the point type>
//     }
//     .....
// }
// For each point label for which automatic constraints were created,
// this table holds an entry which contains an IdMgr and an object
// holding the constraint names created for the point (the constraint names
// are all that is needed to remove those constraints).
// The IdMgr is used to assign IDs to the requests to use the point and
// keep track of the destruction of those requests. When the count reaches
// zero, the constraints are destroyed and the entry for this point in the
// table is destroyed.
//
// When a module requests to add automatic constraints for a certain point
// label, the functions here check whether the constraints were already
// created, and if not, creates them. Whether the constraints were created
// or not, a registration ID is returned. This registration ID has
// the form:
//       [<point label>, <ID>]
// This fully identifies the registration and can be used to cancel
// registrations.
//
// For the exact list of constraints created for each type of point, see
// the documentation in the relevant section below.

AllPosConstraints.prototype.initAutomaticPointConstraints =
    allPosConstraintsInitAutomaticPointConstraints;

function allPosConstraintsInitAutomaticPointConstraints()
{
    this.automaticPointConstraints = {};
}

// --------------------------------------------------------------------------
// removeAllAutomaticPointConstraints
//
AllPosConstraints.prototype.removeAllAutomaticPointConstraints =
    allPosConstraintsRemoveAllAutomaticPointConstraints;
function allPosConstraintsRemoveAllAutomaticPointConstraints()
{
    for (var name in this.automaticPointConstraints) {
        var entry = this.automaticPointConstraints[name];
        this.doRemoveAutomaticPointConstraint(entry);
    }
}

//
// If at any stage the constraints generated on an area are cleared,
// this function can be called to recreate the automatic point constraints
// which are the responsibility fo this area to maintain.
//
AllPosConstraints.prototype.recreateAutomaticPointConstraints =
    allPosConstraintsRecreateAutomaticPointConstraints;
function allPosConstraintsRecreateAutomaticPointConstraints()
{
    for (var name in this.automaticPointConstraints) {
        var entry = this.automaticPointConstraints[name];
        this.makeAutomaticPointConstraint(entry);
    }
}

//
// For a given entry describing the automatic constraints, this function
// refreshes the automatic constraints (adding those which need to be
// added or modified and removing those which are no longer needed).
// It then updates the given entry with the names of the constraints
// currently registered for that entry.
//

AllPosConstraints.prototype.makeAutomaticPointConstraint =
    allPosConstraintsMakeAutomaticPointConstraint;
function allPosConstraintsMakeAutomaticPointConstraint(entry)
{
    switch (entry.type) {
        case "center":
            this.makeCenterPointConstraints(entry);
            break;
        case "intersection":
            this.makeIntersectionPointConstraints(entry);
            break;
            
        case "rv":
            this.makeRVPointConstraints(entry);
            break;
            
        default:
            mondriaInternalError("unexpected type '" + entry.type + "'");
            break;
    }
}

///////////////////
// Center Points //
///////////////////

// vertical an horizontal center points:
//   For each such point, a single linear constraint is added, defining
//   the offset between the left/top edge of the area and the center point
//   to be half of the width/height of the area. There are separate
//   center points for the frame and the content of an area.
// These constraints do not need to be updated when the content positioning
// toggles between zero-offset and non-zero-offset, because such a toggle
// would cause the label of a content center point to change, resulting
// in a proper update of the automatic constraint through the standard
// mechanisms.

// This function should be called to request the creation of the automatic
// constraints for the given point label centerType should be either
// 'horizontal-center' or 'vertical-center'.

AllPosConstraints.prototype.addCenterPointConstraints =
    allPosConstraintsAddCenterPointConstraints;

function allPosConstraintsAddCenterPointConstraints(label, centerType,
                                                    isContent)
{
    if (this.baseArea.isInZeroContentOffsetMode())
        isContent = false;

    var entry = this.automaticPointConstraints[label];

    if(!entry) {
        entry = this.automaticPointConstraints[label] = {
            use: new IdMgr(),
            type: "center",
            label: label,
            centerType: centerType,
            isContent: isContent
        };

        this.makeAutomaticPointConstraint(entry);
    }

    return [label, entry.use.allocate()];
}

// Given a label entry from the automatic constraints table, this function
// creates the constraints for the label, which is
// a point label for a center point of the given type (and content type).
//
// The names of the centering constraints are:
// 1. horizontal-center
// 2. vertical-center
// 3. content-horizontal-center
// 4. content-vertical-center

AllPosConstraints.prototype.makeCenterPointConstraints =
    allPosConstraintsMakeCenterPointConstraints;
function allPosConstraintsMakeCenterPointConstraints(entry)
{
    // Add a constraint defining the horizontal/vertical frame/content center.
    // For the center point itself, we use the label directly (by using
    // an 'internal' point description) rather than create a standard
    // point description for it. This is because using a standard point
    // description would create an additional request for the same point
    // and this would mean that even when the point is no longer really needed
    // there would still remain a request for this point and it would
    // therefore never be deleted (until the area is destroyed).
    
    var description;
    var startEdge, endEdge;

    if (entry.centerType == "horizontal-center") {
        startEdge = "left";
        endEdge = "right";
    } else {
        startEdge = "top";
        endEdge = "bottom";
    }
    description = this.makeLinearDesc(
        [startEdge, undefined, entry.isContent],
        { internal: entry.label },
        [startEdge, undefined, entry.isContent],
        [endEdge, undefined, entry.isContent],
        2);

    description.priority = strongAutoPosPriority;
    var constraintName =
        (entry.isContent ? "content-" : "") + entry.centerType;

    this.addConstraint(constraintName, description, true);

    entry.constraintNames = {};
    entry.constraintNames[constraintName] = true;
}

/////////////////////////////////////
// Relative Visibility Constraints //
/////////////////////////////////////

// This area is responsible for creating automatic point constraints
// for relative visibility points whose base is this area.
//
// Writing RV_<Base>_<Frame>_<type> for the relative visibility point label
// Base relative to Frame of type <type> and writing <Base>_<type>_frame
// and <Base>_<type>_content for the standard frame and content labels
// (respectively) of the edge of type <type> of area <Base>, the
// following automatic constraints are defined (but in certain situations,
// listed below, some of these may be omitted):
//
// For left/top type relative visibility points:
// 1. <RV_<Base>_<Frame>_<type>, <Base>_<type>_content> <= 0
// 2. <RV_<Base>_<Frame>_<type>, <Base>_<type>_frame> <= 0
// 3. <RV_<Base>_<Frame>_<type>, RV_<embedding(Base)>_<Frame>_<type>> <= 0
// 4. An or-group of constraints:
//    a. <RV_<Base>_<Frame>_<type>, <Base>_<type>_content> >= 0
//    b. <RV_<Base>_<Frame>_<type>, <Base>_<type>_frame> >= 0
//    c. <RV_<Base>_<Frame>_<type>, RV_<embedding(Base)>_<Frame>_<type>> >= 0

// For right/bottom type relative visibility points (the opposite constraints):
// 1. <RV_<Base>_<Frame>_<type>, <Base>_<type>_content> >= 0
// 2. <RV_<Base>_<Frame>_<type>, <Base>_<type>_frame> >= 0
// 3. <RV_<Base>_<Frame>_<type>, RV_<embedding(Base)>_<Frame>_<type>> >= 0
// 4. An or-group of constraints:
//    a. <RV_<Base>_<Frame>_<type>, <Base>_<type>_content> <= 0
//    b. <RV_<Base>_<Frame>_<type>, <Base>_<type>_frame> <= 0
//    c. <RV_<Base>_<Frame>_<type>, RV_<embedding(Base)>_<Frame>_<type>> <= 0
//
// Here, RV_<embedding(Base)>_<Frame>_<type> is a relative visibility point
// with the same 'includeFrame' as the point for which the constraints
// are generated. This may result in a degenerate point label, which then
// temrinates the recursion.
//
// If the RV point is 'simple' then constraints 3 and 4c are omitted.
// If the base area is NOT in 'independent content position mode' then
// constraints 2 and 4b can be omitted (since in this mode the frame is
// guaranteed to be outside the content). If the RV point is both simple
// and the base are is not in 'independent content position mode' then
// the relative visibility point is not created, so this function will not
// be called.
//
// This function can be called to create or refresh the constraints.
// When the constraints were already added, this function adds them again,
// possibly modfying them. Constraints which need not be added because
// the RV point is 'simple' or because of the content positioning mode
// are remove if previously added.
//
// The constraints created for the RV point have a name which is based
// on the label of the RV point + some suffix to distinguish between the
// constraints.

AllPosConstraints.prototype.addRVPointConstraints =
    allPosConstraintsAddRVPointConstraints;

function allPosConstraintsAddRVPointConstraints(label, frameId, type,
                                                includeFrame, isSimple)
{
    var entry = this.automaticPointConstraints[label];

    if(!entry) {
        
        entry = this.automaticPointConstraints[label] = {
            use: new IdMgr(),
            type: "rv",
            label: label,
            frameId: frameId,
            rvType: type,
            includeFrame: includeFrame,
            isSimple: isSimple
        };
    
        this.makeAutomaticPointConstraint(entry);
        if(!isSimple) {
            this.registerToContentPosModule(label);
            this.registerToEmbeddingChanges(label);
        }
    }

    return [label, entry.use.allocate()];
}

// This function is called by an RVPosPoint object when an RV point label
// which it already registered to the automatic constraints module changes
// its simple/not-simple status. This happens only if the base area of the
// label is in independent content positioning mode (otherwise the toggling
// of the isSimple property results in a change in label, removing or adding
// automatic constraints in the standard way).
// Since the same point label may be generated by several RVPosPoint
// objects and these will all call this function when the 'isSimple'
// property changes, this function first compares the isSimple property
// as currently recorded on the label's entry with the new value provided.
// If there are the same, the update already took place and there is
// nothing to do.
// When a change needs to be applied, it boils down to adding or removing
// the "oe" and "e" constraints (for more details, see above).

AllPosConstraints.prototype.updateRVPointSimplicity =
    allPosConstraintsUpdateRVPointSimplicity;

function allPosConstraintsUpdateRVPointSimplicity(label, isSimple)
{
    var entry = this.automaticPointConstraints[label];

    if(!entry || entry.isSimple == isSimple)
        return; // nothing to do
        
    entry.isSimple = isSimple;

    if(isSimple) {
        // remove the constraints with the RV point of the embedding area
        this.removeRVPointConstraintsBySuffix(entry, ["e", "oe"]);
        // remove registrations to get notifications when the content
        // positioning mode or the embedding of the base area changes
        //  (this is only needed when the point is not simple).
        this.unregisterFromContentPosModule(label);
        this.unregisterFromEmbeddingChanges(label);
    } else {
        // add the constraints with the RV point of the embedding area
        var descs = this.makeRVPointConstraintDescs(label, ["e", "oe"]);
        this.addRVPointConstraintsFromDesc(entry, descs);
        // register to get notifications when the content positioning mode
        // or the embedding of the base area changes
        this.registerToContentPosModule(label);
        this.registerToEmbeddingChanges(label);
    }
}

// Given a label of a relative visibility point and an array containing
// a list of constraint name suffixes for that label, this function generates
// an object containing the descriptions of the corresponding constraints
// for that point. The attributes of this object are the suffixes given
// and under each suffix is stored the corresponding description.
// The supported suffixes are:
// "c" - the constraint between the RV point and the content edge of the
//       base area
// "oc" - the or-group counterpart of the "c" constraint
// "f" - the constraint between the RV point and the frame edge of the
//       base area
// "of" - the or-group counterpart of the "f" constraint
// "e" - the constraint between the RV point and the corresponding RV point
//       of the embedding area.
// "oe" - the or-group counterpart of the "e" constraint
// For the relative visibility point itself, we use the label directly (by
// using an 'internal' point description) rather than create a standard
// point description for it. This is because using a standard point
// description would create an additional request for the same point
// and this would mean that even when the point is no longer really needed
// there would still remain a request for this point and it would
// therefore never be deleted (until the area is destroyed).
// The function returns 'undefined' if there is no entry yet created for
// this label in the list of automatic point constraints or if this entry
// does not contain sifficient information for creating the constraints.

AllPosConstraints.prototype.makeRVPointConstraintDescs =
    allPosConstraintsMakeRVPointConstraintDescs;

function allPosConstraintsMakeRVPointConstraintDescs(label, suffixes)
{
    var entry = this.automaticPointConstraints[label];
    var labelElt = new ElementReference(label);

    if(!entry || !entry.rvType)
        return undefined;
    
    var type = entry.rvType;
    var topOrLeft = (type == "left" || type == "top");
    var descs = {};
    
    for(var i in suffixes) {

        var suffix = suffixes[i];
        var isOrSuffix = (suffix[0] == "o");

        // common part
        descs[suffix] = {
            point1: { internal: label },
            priority: strongAutoPosPriority
        };
        if(isOrSuffix)
            descs[suffix].orGroups = label;
        if(topOrLeft ^ isOrSuffix)
            descs[suffix].max = 0;
        else
            descs[suffix].min = 0;
        
        switch(suffix) {
            case "c":
            case "oc":
                descs[suffix].point2 = 
                    { internal: edgeLabel(this.baseArea, type, true) };
                break;
            case "f":
            case "of":
                descs[suffix].point2 =
                    { internal: edgeLabel(this.baseArea, type, false) };
                break;
            case "e":
            case "oe":
                descs[suffix].point2 = {
                    visibilityOf: entry.embeddingId,
                    relativeTo: new ElementReference(entry.frameId),
                    type: type,
                    includeFrame: entry.includeFrame
                };
            break;
            default:
                break;
        }
    }

    return descs;
}

// This function is given the automatic constraints entry for a relative
// visibility label and a list of constraint descriptions. It then adds
// the constraints appearing in the constraint descriptions and adds the
// names of those constraints to the 'constraintNames' list stored
// in the entry. If 'removeNotInDesc' is true, any constraint which is
// registered in the 'constraintNames' list of the entry but does not
// appear in 'descs' is removed.

AllPosConstraints.prototype.addRVPointConstraintsFromDesc =
    allPosConstraintsAddRVPointConstraintsFromDesc;

function allPosConstraintsAddRVPointConstraintsFromDesc(entry, descs,
                                                        removeNotInDesc)
{
    var names = {}, name;

    if(!entry.constraintNames)
        entry.constraintNames = {};
    
    // add the constraints
    for(var n in descs) {

        var desc = descs[n];

        // patch in the embedding id
        // if (desc.point2.visibilityOf === null) {
        //     desc = dupObj(desc, 0);
        //     desc.point2.visibilityOf = entry.embeddingId;
        //     delete desc.point2.visibilityOf;
        // }

        name = entry.label + "_" + n;
        names[name] = true;
        this.addConstraint(name, desc, true);
        entry.constraintNames[name] = true;
    }
    
    // remove any constraints previously added and no longer needed
    if(removeNotInDesc && entry.constraintNames) {
        for(name in entry.constraintNames) {
            if(!names[name]) {
                // existing constraint is not in list of new constraints
                this.removeConstraint(name);
                delete entry.constraintNames[name];
            }
        }
    }
}

// Given the automatic constraints entry of an RV point label and a list
// of constraint name suffixes (see 'makeRVPointConstraintDescs' for the
// list of those suffixes) this function removes the constraints generated
// with those suffixes for the given label.


AllPosConstraints.prototype.removeRVPointConstraintsBySuffix =
    allPosConstraintsRemoveRVPointConstraintsBySuffix;

function allPosConstraintsRemoveRVPointConstraintsBySuffix(entry, suffixes)
{
    var label = entry.label;

    for(var i in suffixes) {
        var name = label + "_" + suffixes[i];
        if(!entry.constraintNames[name])
            continue;
        delete entry.constraintNames[name];
        this.removeConstraint(name);
    }
}

// This function actually creates the constraints for the given relative
// visibility point (see 'addRVPointConstraints()' for documentation).
// Constraints which already exist will be added again (possibly modifying
// them). Constraints which were previously added and are no longer needed
// are removed.

AllPosConstraints.prototype.makeRVPointConstraints =
    allPosConstraintsMakeRVPointConstraints;

function allPosConstraintsMakeRVPointConstraints(entry)
{
    // determine which constraints need to be added
    var suffixes = ["c", "oc"]; // content edge constraints always included

    if(this.baseArea.isInIndependentContentPositionMode())
        // frame point constraint added only in independent content positioning
        suffixes.push("f", "of");
    
    if(!entry.isSimple)
        // embedding RV constraint added only if the pair is not simple
        suffixes.push("e", "oe");

    entry.embeddingId = areaRelationMonitor.getEmbeddingId(this.baseArea.areaId);

    var descs = this.makeRVPointConstraintDescs(entry.label, suffixes);

    // add the described constraints (and remove any constraints which
    // were previously created but do not appear in the 'descs' list).
    this.addRVPointConstraintsFromDesc(entry, descs, true);
}

// This function is called with the automatic constraints entry of an
// RV point label which is not simple when the content positioning mode
// of the base area changes (from 'prevMode' to 'newMode'). This function
// then adjusts the automatic constraints generated for the label.
// The following changes take place (see the introduction to
// 'makeRVPointConstraintDescs' for a legend for the short constraint names
// used here):
// 1. If the new mode is "zero" then the "c" and "oc" constraints need to
//    be removed and if the previous mode was "auto", "f" and "of" need to
//    be added.
// 2. If the new mode is "auto", then the "f" and "of" constraints need to
//    be removed and if the previous mode was "zero", "c" and "oc" need to
//    be added.
// 3. If the new mode is "independent", then if the previous mode was "zero"
//    then the "c" and "oc" constraints need to be added and if
//    the previous mode was "auto" then the "f" and "of" constraints need
//    to be added.

AllPosConstraints.prototype.rvPointContentOffsetModeChange =
    allPosConstraintsRVPointContentOffsetModeChange;

function allPosConstraintsRVPointContentOffsetModeChange(entry, prevMode,
                                                         newMode)
{
    if(prevMode == newMode)
        return; // just to be on the safe side, as this is assumed below
    
    // determine which suffixes to add and remove
    var removeSuffixes;
    var addSuffixes;

    if(newMode == "zero") {
        removeSuffixes = ["c", "oc"];
        if(prevMode == "auto")
            addSuffixes = ["f", "of"];
    } else if(newMode == "auto") {
        removeSuffixes = ["f", "of"];
        if(prevMode == "zero")
            addSuffixes = ["c", "oc"];
    } else { // "independent" mode
        if(prevMode == "zero")
            addSuffixes = ["c", "oc"];
        else
            addSuffixes = ["f", "of"];
    }
    
    // remove the constraints which are no longer needed
    if(removeSuffixes)
        this.removeRVPointConstraintsBySuffix(entry, removeSuffixes);

    // create the description and add the new constraints needed
    if(addSuffixes) {
        var descs = this.makeRVPointConstraintDescs(entry.label, addSuffixes);
        this.addRVPointConstraintsFromDesc(entry, descs);
    }
}

// --------------------------------------------------------------------------
// rvPointEmbeddingChange
//
AllPosConstraints.prototype.rvPointEmbeddingChange =
    allPosConstraintsRvPointEmbeddingChange;
function allPosConstraintsRvPointEmbeddingChange(entry, embeddingId, label)
{
    if (embeddingId === this.embeddingId) {
        return;
    }

    assertFalse(entry.isSimple);

    // remove the constraints with the RV point of the old embedding area
    this.removeRVPointConstraintsBySuffix(entry, ["e", "oe"]);

    this.embeddingId = embeddingId;

    // add the constraints with the RV point of the new embedding area
    var descs = this.makeRVPointConstraintDescs(label, ["e", "oe"]);
    this.addRVPointConstraintsFromDesc(entry, descs);
}

////////////////////////////////////
// Intersection Point Constraints //
////////////////////////////////////

// Intersection points for an area can be defined for any of the edge types
// (left/right/top/bottom) and can be either content or frame points.
// The position of intersection points of an area is constrained by
// the position of the points of the same type of the intersection parents
// of the area. When the intersection point is a frame intersection point,
// its position is determined by the relative visibility point for the
// corresponding edge of each of the intersection parents (with visibility
// being calculated relative to the LCE of the two parents) while for
// a content intersection point the position is determined directly by the
// content edge points of the intersection parents. The intersection
// point is taken to be the 'inner most' of the two points defining its
// position (rightmost/leftmost/bottommost/topmost of the two for the
// left/right/top/bottom intersection point, respectively).
//
// To implement this, automatic constraints are added. Writing
// <area>_<type> for the frame edge point of type <type> of area <area>
// and writing <area>_<type>_c for the corresponding content edge point,
// <area>_<type>_i for the corresponding intersection point and
// <area>_<type>_c_i for the content intersection point, the following
// automatic constraints are defined:
//
// For left/top content intersection points:
// 
// 1. < <area>_<type>_c_i, <expressionOf(area)>_<type>_c > <= 0
// 2. < <area>_<type>_c_i, <referredOf(area)>_<type>_c > <= 0
// 3. an or-group of constraints:
//    a. < <area>_<type>_c_i, <expressionOf(area)>_<type>_c > >= 0
//    b. < <area>_<type>_c_i, <referredOf(area)>_<type> >_c >= 0
//
// For right/bottom content intersection points (the opposite constraints to
// the ones for left/top points):
//
// 1. < <area>_<type>_i, <expressionOf(area)>_<type> > >= 0
// 2. < <area>_<type>_i, <referredOf(area)>_<type> > >= 0
// 3. an or-group of constraints:
//   a. < <area>_<type>_i, <expressionOf(area)>_<type> > <= 0
//   b. < <area>_<type>_i, <referredOf(area)>_<type> > <= 0
//
// For frame intersection points we use the relative visibility points
// of the intersection parents relative to their LCE instead of the parent
// edge points directly. Writing, as above, RV_<Base>_<Frame>_<type> for
// the relative visibility point, a similar set of constraints is defined:
//
// For left/top frame intersection points:
//
// 1. < <area>_<type>_i, RV_<expressionOf(area)>_<LCE(parents)>_<type> > <= 0
// 2. < <area>_<type>_i, RV_<referredOf(area)>_<LCE(parents)>_<type> > <= 0
// 3. an or-group of constraints:
//   a. < <area>_<type>_i, RV_<expressionOf(area)>_<LCE(parents)>_<type> > >= 0
//   b. < <area>_<type>_i, RV_<referredOf(area)>_<LCE(parents)>_<type> > >= 0
//
// For right/bottom frame intersection points:
//
// 1. < <area>_<type>_i, RV_<expressionOf(area)>_<LCE(parents)>_<type> > >= 0
// 2. < <area>_<type>_i, RV_<referredOf(area)>_<LCE(parents)>_<type> > >= 0
// 3. an or-group of constraints:
//   a. < <area>_<type>_i, RV_<expressionOf(area)>_<LCE(parents)>_<type> > <= 0
//   b. < <area>_<type>_i, RV_<referredOf(area)>_<LCE(parents)>_<type> > <= 0
//
// Since the condition "intersectionParentOf" matches both the expression
// and the referred parent of an intersection area, we can collapse
// constraints 1,2 and constraint 3a, 3b into one constraint description
// for each pair.
//
// The constraints created for the intersection point have a name which is
// based on the label of the intersection point + some suffix to distinguish
// between the constraints.

// This function should be called to request the creation of the automatic
// constraints for an intersection point of the base area of this
// AllPosConstraints object. If the constraints have not yet been created,
// they are added. Whether the constraints were added or not, a registration
// ID is returned.
// Note: if the base area is not an intersection area, this function will
// not actually add any constraints since the conditions defining the
// intersection parents of this area will return an empty set of matching
// areas.

AllPosConstraints.prototype.addIntersectionPointConstraints =
    allPosConstraintsAddIntersectionPointConstraints;

function allPosConstraintsAddIntersectionPointConstraints(label, type,
                                                          isContent)
{
    var entry = this.automaticPointConstraints[label];

    if(!entry) {
        
        entry = this.automaticPointConstraints[label] = {
            use: new IdMgr(),
            type: "intersection",
            label: label,
            intersectionType: type,
            isContent: isContent
        };

        this.makeAutomaticPointConstraint(entry);
    }

    return [label, entry.use.allocate()];
}

// This function actually adds the constaints for the intersection point.
// For the intersection point itself, we use the label directly (by
// using an 'internal' point description) rather than create a standard
// point description for it. This is because using a standard point
// description would create an additional request for the same point
// and this would mean that even when the point is no longer really needed
// there would still remain a request for this point and it would
// therefore never be deleted (until the area is destroyed).

AllPosConstraints.prototype.makeIntersectionPointConstraints =
    allPosConstraintsMakeIntersectionPointConstraints;

function allPosConstraintsMakeIntersectionPointConstraints(entry)
{
    var parentDescPoint;
    var type = entry.intersectionType;
    var intersectionParents = this.baseArea.getIntersectionParents();
    entry.desc = [];
    entry.constraintNames = {};

    var i, j;
    var name;

    if (typeof(intersectionParents) === "undefined") {
        mondriaAuthorHint("makeIntersectionPointConstraints: area " +
                          this.baseArea.areaId +
                          "is not an intersection area");
        return;
    }

    for (var pid = 0; pid <= 1; pid++) {
        if(entry.isContent) {
            parentDescPoint = {
                element: intersectionParents[pid],
                type: type,
                content: true
            };
        } else {
            parentDescPoint = {
                visibilityOf: intersectionParents[pid],
                // relativeTo: [lce, [intersectionParentsOf, [me]]],
                type: type,
                includeFrame: false
            };
        }

        var desc = entry.desc[pid] = [];

        // the non-or-group constraints
        desc[0] = {
            point1: { internal: entry.label },
            point2: parentDescPoint,
            priority: strongAutoPosPriority
        };

        // the or-group constraints
        desc[1] = {
            point1: { internal: entry.label },
            point2: parentDescPoint,
            priority: strongAutoPosPriority,
            orGroups: entry.label
        };

        if(type == "left" || type == "top") {
            desc[0].max = 0;
            desc[1].min = 0;
        } else {
            desc[0].min = 0;
            desc[1].max = 0;
        }

        // add the constraints
        for(j = 0 ; j <= 1 ; j++) {
            name = this.makeIntersectionConstraintName(entry.label, pid, j);
            entry.constraintNames[name] = true;
        }
    }

    if (entry.isContent) {
        for (i = 0; i <= 1; i++) {
            for (j = 0; j <= 1; j++) {
                name = this.makeIntersectionConstraintName(entry.label, i, j);
                this.addConstraint(name, entry.desc[i][j], true);
            }
        }
    } else {
        var areaObj = {};
        for (i = 0; i <= 1; i++) {
            var paid = intersectionParents[i].getElement();
            areaObj[paid] = allAreaMonitor.getAreaById(paid);
        }
        entry.lceReqId =
            allAreaMonitor.registerLCE(areaObj, this, this.lceHandler, entry);
    }
}

// --------------------------------------------------------------------------
// lceHandler
//
AllPosConstraints.prototype.lceHandler = allPosConstraintsLceHandler;
function allPosConstraintsLceHandler(reqId, lce, entry)
{
    var i, j;
    var name;

    var lcePaid = (typeof(lce) === "undefined") ? undefined : lce.areaId;
    if (lcePaid !== entry.areaId) {
        if (typeof(entry.areaId) !== "undefined") {
            for (name in entry.constraintNames) {
                this.removeConstraint(name);
            }
        }
        entry.areaId = lcePaid;

        if (typeof(entry.areaId) !== "undefined") {
            for (i = 0; i <= 1; i++) {
                for (j = 0; j <= 1; j++) {
                    var desc = entry.desc[i][j];
                    desc.point2.relativeTo = new ElementReference(lce.areaId);
                    name = this.makeIntersectionConstraintName(entry.label,
                                                               i, j);
                    this.addConstraint(name, entry.desc[i][j], true);
                }
            }
        }
    }
}

// --------------------------------------------------------------------------
// makeIntersectionConstraintName
//
AllPosConstraints.prototype.makeIntersectionConstraintName =
    allPosConstraintsMakeIntersectionConstraintName;
function allPosConstraintsMakeIntersectionConstraintName(label, parentId,
                                                        constraintId)
{
    return label + "_" + parentId + "_" + constraintId;
}

/////////////
// Removal //
/////////////

// Given a request ID, this function removes the corresponding request from
// the request table. When all requests for a specific point label are
// removed, this function destroys the constraints created for the
// point label.

AllPosConstraints.prototype.removeAutomaticPointConstraints =
    allPosConstraintsRemoveAutomaticPointConstraints;
function allPosConstraintsRemoveAutomaticPointConstraints(requestId)
{
    var label = requestId[0];
    var id = requestId[1];
    var entry = this.automaticPointConstraints[label];

    if(!entry)
        return;
    
    entry.use.free(id);
    
    if (entry.use.count() > 0) {
        return; // still some requests for this point
    } else {
        this.doRemoveAutomaticPointConstraint(entry);
        delete this.automaticPointConstraints[label];
    }
}

// --------------------------------------------------------------------------
// doRemoveAutomaticPointConstraint
//
AllPosConstraints.prototype.doRemoveAutomaticPointConstraint =
    allPosConstraintsDoRemoveAutomaticPointConstraint;
function allPosConstraintsDoRemoveAutomaticPointConstraint(entry)
{
    // destroy the constraint
    for(var name in entry.constraintNames)
        this.removeConstraint(name);

    // RV points which are not simple register a request for notification
    // on content positioning mode changes
    if(entry.type == "rv" && !entry.isSimple)
        this.unregisterFromContentPosModule(entry.label);

    // intersection points sometime make lceMonitor registrations
    if (entry.lceReqId) {
        allAreaMonitor.unregisterLCE(entry.lceReqId);
    }
}

/////////////////////////////////////////
// Content Position Mode Notifications //
/////////////////////////////////////////

// This registers a request to receive notifications from the content
// positioning module of the base area of this object when the content
// positioning mode changes. The registration is identified by the
// label of the point for which this registration is made.
// The label is also used as an opaque (to identify the request when
// the callback arrives).

AllPosConstraints.prototype.registerToContentPosModule =
    allPosConstraintsRegisterToContentPosModule;

function allPosConstraintsRegisterToContentPosModule(label)
{
    if(!this.baseArea)
        return;
    
    this.baseArea.contentPosManager.
        registerAllModeChange("autoConstraints", label, this, label);
}

// This removes the registration to receive notifications from the content
// positioning module for the given label.

AllPosConstraints.prototype.unregisterFromContentPosModule =
    allPosConstraintsUnregisterFromContentPosModule;

function allPosConstraintsUnregisterFromContentPosModule(label)
{
    if(!this.baseArea)
        return;
    
    this.baseArea.contentPosManager.unregisterAllModeChange("autoConstraints",
                                                            label);
}

// This function is called when the content positioning mode of the base
// area changes. It is called once for every label registered to receive
// such notifications. It then looks up the entry for the automatic constraints
// of the label and modifies the automatic constraints to suit the new
// content positioning mode.
// Currently, only the automatic constraints generated for relative visibility
// points depend on the content positioning mode.

AllPosConstraints.prototype.contentOffsetModeChange =
    allPosConstraintsContentOffsetModeChange;

function allPosConstraintsContentOffsetModeChange(baseId, prevMode, newMode,
                                                  label)
{
    // may have expired since registered for callbacks
    var entry = this.automaticPointConstraints[label];

    if (entry && entry.type === "rv") {
        this.rvPointContentOffsetModeChange(entry, prevMode, newMode);
    }
}

// --------------------------------------------------------------------------
// registerToEmbeddingChanges
// 
// register to receive notifications if/when the embedding of the baseArea
//  changes. This is currently only used by relative visibility points, which
//  use the embedding area id as part of the point description
//
AllPosConstraints.prototype.registerToEmbeddingChanges =
    allPosConstraintsRegisterToEmbeddingChanges;
function allPosConstraintsRegisterToEmbeddingChanges(label)
{
    var entry = this.automaticPointConstraints[label];
    var baseId = this.baseArea.areaId;

    entry.embeddingChangeReqId =
        allAreaMonitor.addAreaSpecificCallBack("change", baseId,
                                               this, this.updateEmbedding,
                                               label);
}

// --------------------------------------------------------------------------
// unregisterFromEmbeddingChanges
//
AllPosConstraints.prototype.unregisterFromEmbeddingChanges =
    allPosConstraintsUnregisterFromEmbeddingChanges;
function allPosConstraintsUnregisterFromEmbeddingChanges(label)
{
    var entry = this.automaticPointConstraints[label];
    var reqId = entry.embeddingChangeReqId;
    assert(typeof(reqId) !== "undefined");
    allAreaMonitor.removeAreaSpecificCallBack("change", reqId);
    delete entry.embeddingChangeReqId;
}

// --------------------------------------------------------------------------
// updateEmbedding
// 
// this method is called back by the global area monitor when the base area's
//  embedding has changed
//
AllPosConstraints.prototype.updateEmbedding =
    allPosConstraintsUpdateEmbedding;
function allPosConstraintsUpdateEmbedding(reqId, label, areaId,
                                          prevEmbeddingId, embeddingId)
{
    var entry = this.automaticPointConstraints[label];
    assert(entry);

    // currently only used by relative visibility points
    assert(entry.type === "rv");
    this.rvPointEmbeddingChange(entry, embeddingId, label);
}
