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


// This file provides an object which generates and manages a set of
// positioning constraints. It takes a decription containing the description
// of a set of constraints and generates one (or sometimes more)
// 'PosConstraint' object for each constraint in the description.
//
// This object also provides infrastructure for "reserved name" constraints
// and automatic constraints. The actual definition of the reserved name
// constraints and the registration of the automatic constraints must be
// defined in a derived class of this class (see more on this below).
//
// It is assumed that position constraints are defined in an object
// whose attributes are constraint names and the values under these attributes
// are constraint definition objects.
//
// At present, the name of each constraint (the attribute under which it
// appears) only plays a role in the system if it is a reserved name.
// Reserved names provide shorthand for certain standard constraints.
// 
// The value under a reserved name is interpreted by the derived class, that
//  is responsible to return a description that is in the same format of
//  the constraints that are not reserved name constraints.
// 
// 'undefined' is always a valid value under a constraint name. This does
// not define any constraint and can be used to remove an existing constraint
// by that name.
//
// No reserved names are defined here and they are optional. If used,
// these need to be defined in a derived class. To do so, the derived class
// has to define the member 'reservedNames'. This should be an object with
// reserved constraint names as attributes.
//  A function 'makeReservedConstraintDesc()' is provided by the base class,
// but may need to be overridden/extended by the derived class. This function
// takes the following arguments:
//   name: the reserved constraint name
//   reservedEntry: the value of this.reservedName[name]
//   value-type: describes what the reserved constraint description holds
//   value: the actual value from the constraint description
// 
//  The function should return the full specification of the constraint as it
//   would have appeared in the configuration had there been no shorthand for
//   it.
// 
//   The 'value' and 'value-type' are resolved by the function
//  'resolveReservedConstraint()'. The base class implementation identifies
//  the following types:
//   - "posPointShorthand" - a string, which is an attribute in
//       this.posPointShorthand. The string is also the value
//   - "offset" - a number, a string representation of a number, a value
//       object that can be converted to pixels, or a string with numbers
//       followed by "px". The value returned is the number of pixels
//   - "percentile" - a string composed of a number followed by '%'. The
//       value returned is the fraction, so that 50% is returned as 0.5
//   - "condition" - when an array is encountered. the value is the array
//   - "constraint" - a description of a constraint - as a reserved name may
//       be used also when using the standard constraint syntax.The value is the
//       constraint description object.
//   - "posPoint" - a description of a posPoint. The value is the posPoint
//       description object.
//   - undefined - othgerwise, unidentified
// 
//  Note that the types are not a verification of the description. For example,
//   any array is detected as a "condition", and the identification of
//   "posPoint" and "constraint" is merely a guess.
// 
// In addition, the derived class may define group names, such that specifying
// a constraint '<group name>: value' in the configuration would generate
// the constraints '<reserved name>: value' for each reserved name in the
// group specified. If a constraint belonging to a group is specified
// separately, the specific definition overrides the group definition.
// It is allowed to use hierarchies, such that one group has another group in
// its member list. If the contained group appears separately, the explicit,
// separate definition would take precedence. It is the responsibility of the
// derived class to not created cyclic definitions.
// To specify groups, the derived class must have an object
// 'this.reservedGroupNames' whose attributes are the group names and
// the value under each attribute is an array holding the names of the
// reserved names in that group.
//
// Finally, a derived class may also specify a function this.addAutoConstraints
// which registers automatic constraints. This function should create the
//  description of each constraint, then add it using the 'addConstraint'
//  function defined below. The name of an automatic constraint should not
//  begin with a "_".
//
//
// All constraint objects created are stored in 'this.constraints'.
// Automatic constraint are stored under their name (as given above) while
// non-automatic constraints are stored under the name given in the
// configuration + a special prefix (see the function makeInnerName for the
// specification of this prefix). This ensures that automatic constraints
// cannot be over-written by non-automatic constraints (and v.v, if the
// automatic constraint names do not start with the prefix)
// The structure of the object under each attribute (constraint name) in
// this table is as follows:
// {
//    constraint: <the PosConstraint object>,
//    automatic: true|false // true if this constraint is added automatically
//                          // by the system
// }
//
// This file also defines a maximal priority that can be assigned by the
// configuration (a non-system constraint) to a positioning constraint.
// Any higher priority assigned by the user will be rounded down to this
// maximal priority. Automatic constraints assigned
// by the system may have priority higher than this maximum.
//
// Finally, this file also provides some auxiliary functions which can
// be used to construct a constraint description object. These function
// are 'makeLinearDesc', 'makeSegmentDesc', 'makePreferenceDesc' and possibly
// others added after this comment was written.

//

// %%include%%: "../posPoint/posPoint.js"
// %%include%%: "posConstraint.js"

// The maximal positioning constraint priority which can be used in the
// description.
var maxNonSystemPosPriority = 1000;

// The default priority assigned to constraints where no priority is defined
var defaultPosPriority = 0;

// The priority assigned to strong automatic constraints
var strongAutoPosPriority = 2000;

// The highest system priority - should be used only for a very small set of
// constraints which are certain not to contradict each other. 
var strongestAutoPosPriority = 3000;

//
// Constructor
//

// The 'systemPositioning' flag is true if the positioning constraints
// given here were generated by the system (as opposed to originating in the
// configuration file). This allows the constraints to be assigned a priority
// higher than the maximal allowed for constraints originating in the
// configuration.

function PosConstraintManager(baseArea, systemPositioning, description)
{
    this.baseArea = baseArea;

    this.systemPositioning = !!systemPositioning;
    // list of constraint names (in configuration format) which were created
    // from a (reserved) group name. The attribute is the constraint name and
    // the value is the group name.
    this.groupConstraints = {};
    
    // This object holds the 'PosConstraint' objects corresponding to the
    // constraint definitions appearing in the description. Each one
    // appears under the attribute under which its definition appears in
    // the description object (see above for the structure of the objects
    // stored here).
    this.constraints = {};

    // the automatic constraint will be added when the newDescription
    // function is called.
    this.needToAddAutoConstraints = true;
    
    if(!baseArea)
        return;
    
    // initialize the object from the description
    if(description)
        this.newDescription(description);
}

// This function should be called when this object is destroyed. It removes
// all constraints registered by this object. It can also be called before
// calling the derived class description update function in order to
// ensure that all constraints are registered afresh. 

PosConstraintManager.prototype.destroyConstraints =
    posConstraintManagerDestroyConstraints;

function posConstraintManagerDestroyConstraints()
{
    for(var c in this.constraints) {
        this.constraints[c].constraint.destroyConstraint();
        delete this.constraints[c];
    }

    this.groupConstraints = {};

    // in case we want to restart after this destroy, the automatic
    // constraints need to be added back.
    this.needToAddAutoConstraints = true;
}

// This function takes the name of a constraint as it appears in the
// configuration and adds a prefix to it, to create the name that is used
// internally. This prefix ensures that constraints from the configuration
// don't conflict with the names of automatic constraints.

PosConstraintManager.prototype.makeInnerName =
    posConstraintManagerMakeInnerName;

function posConstraintManagerMakeInnerName(name)
{
    return "_" + name;
}

// This function takes as input a non-automatic constraint name as stored
// internally and returns the name as it would appear in the configuration.
// This is the inverse of the 'makeInnerName' function.

PosConstraintManager.prototype.makeConfName =
    posConstraintManagerMakeConfName;

function posConstraintManagerMakeConfName(name)
{
    return name.substr(1);
}

// This function receives a position description (as would appear in the
// configuration). It goes over all existing constraints and removes
// non-automatic constraint which do not appear in the given description.
// For constraints which belong to a reserved name group, the function
// also checks whether that group appears in the description (if it does,
// the constraint is not removed).

PosConstraintManager.prototype.removeConstraintsNotInDescription =
    posConstraintManagerRemoveConstraintsNotInDescription;

function posConstraintManagerRemoveConstraintsNotInDescription(posDesc)
{
    for(var name in this.constraints) {

        if(this.constraints[name].automatic)
            continue; // don't remove automatic constraints
        
        var confName = this.makeConfName(name);
        
        if(!posDesc ||
           (posDesc[confName] === undefined &&
            (this.groupConstraints[confName] === undefined ||
             posDesc[this.groupConstraints[confName]] === undefined)))
            this.removeConstraint(name);
    }
}

// This function reads the current position description and completely
// refreshes all constraints. Constraints are identified by the attribute
// under which they appear. Existing constraints which also appear in the
// new description are replaced, constraints which do no longer appear
// in the description are removed and new constraints appearing in the
// description are added.
// Constraints which appear under reserved constraint names (see explanation
// above) are first converted to a constraint of a standard format.
// If the flag 'needToAddAutoConstraints' is true, this function will
// start by adding the automatic constraints (if defined - this depends on the
// derived class).

PosConstraintManager.prototype.newDescription =
    posConstraintManagerNewDescription;

function posConstraintManagerNewDescription(posDesc)
{
    if (this.needToAddAutoConstraints) {
        // if the derived object has a function for adding automatic
        // constraints, call it now.
        if (this.addAutoConstraints) {
            this.addAutoConstraints();
        }
        // this needs to take place only once (not every description change)
        // unless all constraints are destroyed.
        this.needToAddAutoConstraints = false;
    }
    
    // remove non-automatic existing constraints which are not in the
    // new description.
    this.removeConstraintsNotInDescription(posDesc);

    // add and replace the constraints appearing in the description
    for (var name in posDesc) {
        this.addNewConstraint(name, posDesc);
    }
}

PosConstraintManager.prototype.addNewConstraint =
      posConstraintManagerAddNewDescription;
function posConstraintManagerAddNewDescription(name, posDesc) {
    var constraintDesc = posDesc[name];

    if (!constraintDesc) {
        return;
    }
    // find the names that are members of this group, and
    // do not have a more specific description.
    // if this is not a group, it returns the singleton {name: true}
    var groupMemberNames = this.resolveGroupMembers(name, posDesc);

    for (var memberName in groupMemberNames) {
        if (memberName != name) {
            this.groupConstraints[memberName] = name;
        }
        var memberDesc = constraintDesc;
        var entry = this.getReservedConstraintNameEntry(memberName);
        this.addConstraint(memberName, memberDesc, false);
    }
}

// This function removes the named constraint.

PosConstraintManager.prototype.removeConstraint =
    posConstraintManagerRemoveConstraint;

function posConstraintManagerRemoveConstraint(name)
{
    var logLevel = 0; if (logLevel <= ConsoleLogAttributes.constraints[0])
        mLogger('constraints', logLevel, 
                "removeConstraint: name=" + name); 

    if(!this.constraints[name])
        return;

    this.constraints[name].constraint.destroyConstraint();

    delete this.constraints[name];
    delete this.groupConstraints[name];
}

PosConstraintManager.prototype.removeConstraintInnerName =
    posConstraintManagerRemoveConstraintInnerName;

function posConstraintManagerRemoveConstraintInnerName(name)
{
    this.removeConstraint(this.makeInnerName(name));
}

// This function adds a constraint with the given name and the given
// description to the set of constraints. The name should be given as it
// appears in the configuration. If the constraint is not automatic,
// the function first adds a prefix to the name, which then becomes the
// internal name under which the constraint is stored.
// If the name is the name of a constraint which
// already exists, it replaces the existing constraint. If no constraint
// by that name exists, the function creates a new PosConstraint object for it.
// If the constraint is not automatic ('isAutomatic' field is not set),
// this function checks the priority defined for the constraint. If none
// is defined, it sets the priority to the default. If the priority is higher
// than the maximal allowed for non-automatic constraints, this priority
// is rounded down to the maximum (unless this.systemPositioning is true).

PosConstraintManager.prototype.addConstraint =
    posConstraintManagerAddConstraint;

function posConstraintManagerAddConstraint(name, constraintDesc,
                                           isAutomatic, priority)
{
    // if this is not an automatic constraint, add the required prefix to
    // the name (this prefix ensures that non-automatic constraint cannot
    // override automatic constraints).
    if(! constraintDesc || ! isAutomatic)
        name = this.makeInnerName(name);

    if(! constraintDesc) {
        // remove the constraint
        this.removeConstraint(name);
        return;
    } else if(typeof(constraintDesc) !="object") {
        // report an author error and remove the constraint
        cdlAuthorError("constraint \"",
                           isAutomatic ? name : this.makeConfName(name),
                           "\" is not a reserved constraint name");
        this.removeConstraint(name);
        return;
    }
        
    if(!this.constraints[name])
        this.constraints[name] = {};
    
    var entry = this.constraints[name];

    entry.automatic = isAutomatic;

    // we cannot change the priority on the description object directly
    // because this may be an object directly out of the description of the
    // area. Therefore, we pass this priority as an extra argument.
    if (priority === undefined) {
        priority = getFirstNumber(constraintDesc.priority);
        if (priority === undefined) {
            priority = defaultPosPriority;
        }
    }
    if (!entry.automatic && !this.systemPositioning &&
          priority > maxNonSystemPosPriority) {
        priority = maxNonSystemPosPriority;
    }
    if (!entry.constraint) {
        entry.constraint = new PosConstraint(this.baseArea, name);
    }
    entry.constraint.newDescription(constraintDesc, priority);
}

////////////////////////////////////////
// Constraint Definition Construction //
////////////////////////////////////////

// This function creates a linear constraint description based on the
// given parameters. The first four parameters are the four points used
// by the constraint. Each can be defined either by a string (which is then
// taken to be literally the point label) or by an array containing
// the arguments required by the function 'makePointDesc'.
// The last argument is the ratio for the constraint.
// The constraint description is not assigned any priority (which gives it
// the default 'higher than all segment constraints' priority).

PosConstraintManager.prototype.makeLinearDesc =
    posConstraintManagerMakeLinearDesc;

function posConstraintManagerMakeLinearDesc(point1, point2, point3, point4,
                                            ratio)
{
    var point1Desc = (point1 instanceof Array) ?
        this.makePointDesc.apply(this, point1) : point1;
    var point2Desc = (point2 instanceof Array) ?
        this.makePointDesc.apply(this, point2) : point2;
    var point3Desc = (point3 instanceof Array) ?
        this.makePointDesc.apply(this, point3) : point3;
    var point4Desc = (point4 instanceof Array) ?
        this.makePointDesc.apply(this, point4) : point4;
        
    var constraint =
        {
            denominator: {
                point1: point1Desc,
                point2: point2Desc
            },
            numerator: {
                point1: point3Desc,
                point2: point4Desc
            },
            ratio: ratio
        };

    return constraint;
}

// This function creates a segment constraint description based on the
// given parameters. The first two parameters are the two points used
// by the constraint. Each can be defined either by a string (which is then
// taken to be literally the point label) or by an array containing
// the arguments required by the function 'makePointDesc'. The last two
// arguments are the min and the max offsets defined by this constraint.

PosConstraintManager.prototype.makeSegmentDesc =
    posConstraintManagerMakeSegmentDesc;

function posConstraintManagerMakeSegmentDesc(point1, point2, min, max)
{
    var point1Desc = (point1 instanceof Array) ?
        this.makePointDesc.apply(this, point1) : point1;
    var point2Desc = (point2 instanceof Array) ?
        this.makePointDesc.apply(this, point2) : point2;
        
    var constraint =
        {
            point1: point1Desc,
            point2: point2Desc,
            min: min,
            max: max,
            priority: defaultPosPriority
        };

    return constraint;
}

// This function creates a preference constraint description based on the
// given parameters. The first two parameters are the two points used
// by the constraint.  Each can be defined either by a string (which is then
// taken to be literally the point label) or by an array containing
// the arguments required by the function 'makePointDesc'. The last parameter
// is the preference type (can be either "min" or "max").

PosConstraintManager.prototype.makePreferenceDesc =
    posConstraintManagerMakePreferenceDesc;

function posConstraintManagerMakePreferenceDesc(point1, point2, preference)
{
    var point1Desc = (point1 instanceof Array) ?
        this.makePointDesc.apply(this, point1) : point1;
    var point2Desc = (point2 instanceof Array) ?
        this.makePointDesc.apply(this, point2) : point2;
    
    var constraint =
        {
            point1: point1Desc,
            point2: point2Desc,
            preference: preference,
            priority: defaultPosPriority
        };

    return constraint;
}


// This function creates a point definition object based on the parameters
// it receives. If the given label is a predefined type, this creates a 'type'
// based point. Otherwise, a label based point is created.

PosConstraintManager.prototype.makePointDesc =
    posConstraintManagerMakePointDesc;

function posConstraintManagerMakePointDesc(label, element, isContent)
{
    var point;

    if (PosPoint.definedTypes[label])
        point = { type: label };
    else
        point = { label: label };

    if (element !== undefined) {
        point.element =
            (typeof(element) == "string") ? [element] : element;
    }

    if (point.type && isContent) { // content apply only to type based points 
        point.content = true;
    }

    return point;
}

// this function takes a constraint name and the set of explicitly defined
// constraint names. If the constraint name is a group name it resolves it
// to the set containing the members of the group, except those that are
// explicitly defined. The resolution is recursive, as groups are allowed
// to have other groups as members. In this case too the nested group members
// are added only if the nested group is not explicitly defined (in addition
// to the condition that the nested group members are not explicitly defined)
//
// For example, if the groups are:
// frame: [ horizontal, vertical]
// horizontal: [left, right]
// vertical: [top, bottom]
// 
// and the the set of explicitly defined names is
// { frame: true, horizontal: true, left: true, bottom: true}
// 
// then the process of resolving 'frame' evolves as follows:
//  frame -> { horizontal, vertical}, but 'horizontal' is explicitly defined, so
//  frame -> {vertical}. Next, vertical -> {top, bottom}, but 'bottom' is
//  explicitly defined, so vertical -> {top}, frame -> {top }.
// 
PosConstraintManager.prototype.resolveGroupMembers =
    posConstraintManagerResolveGroupMembers;
function posConstraintManagerResolveGroupMembers(name, explicitlyDefined)
{
    if (! this.reservedGroupNames) {
        var resolvedSet = {};
        resolvedSet[name] = true;
        return resolvedSet;
    }
    return this.rResolveGroupMembers(name, explicitlyDefined);
}

PosConstraintManager.prototype.rResolveGroupMembers =
    posConstraintManagerRResolveGroupMembers;
function posConstraintManagerRResolveGroupMembers(name, explicitlyDefined)
{
    var resolvedSet = {};
    if (! (name in this.reservedGroupNames)) {
        resolvedSet[name] = true;
        return resolvedSet;
    }

    var members = this.reservedGroupNames[name];

    for (var i = 0; i < members.length; i++) {
        var member = members[i];
        if (member in explicitlyDefined)
            continue;
        var nestedMembers =
            this.rResolveGroupMembers(member, explicitlyDefined);
        for (var m in nestedMembers) {
            resolvedSet[m] = true;
        }
    }
    return resolvedSet;
}

// this function takes a description and attempts to guess if it's a
// posConstraint description
function isAPosConstraintDescription(desc)
{
    if ("point1" in desc)
        return true;
    if ("denominator" in desc)
        return true;
    return false;
}

// this boolean function answers whether a predicate holds with relation to
//  the given entry.
// the supported predicates are:
//  "beforeEmbedding" - is the point before its embedding, e.g. "left" is
//   considered to be after its embedding, but "right: is before its embedding.
// "beforeOther" - for edges that have an 'otherPoint', does thisPoint come
//      before its paired point, e.g. "left" is before "right"
PosConstraintManager.prototype.isReservedPoint =
    posConstraintManagerIsReservedPoint;
function posConstraintManagerIsReservedPoint(entry, predicate)
{
    switch (predicate) {
      case "beforeOther":
        return entry.isFirst;
      case "beforeEmbedding":
        return ! entry.isFirst;
    }
    return undefined;
}

// this function returns the reserved entry for a reserved constraint name.
// its is meant to allow a derived class to interject itself in the process
// (e.g. and create / modify the reserved entry)
PosConstraintManager.prototype.getReservedConstraintNameEntry =
    posConstraintManagerGetReservedConstraintNameEntry;
function posConstraintManagerGetReservedConstraintNameEntry(memberName)
{
    return this.reservedNames? this.reservedNames[memberName]: undefined;
}
