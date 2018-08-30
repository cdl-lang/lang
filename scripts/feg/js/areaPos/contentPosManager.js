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


// The ContentPosManager object defined in this file manages the automatic
// aspects of positioning the content of an area (relative to the area's
// frame). This means that the object manages aspects of content positioning
// which are not managed by positioning constraints specified by the author
// (in the form of explicit constraints referring to the content of the area)
// This object has two tasks:
// 1. Determine whether the content of an area should be allowed to have a
//    non-zero offset from the frame.
// 2. If a non-zero offset is allowed, this object determines which automatic
//    constraints should be applied to this offset.
//
// The object currently supports three modes:
//
// 1. 'Independent Content Position': the position of the content relative to
//    the frame is specified by explicit constraints (specified by the
//    author). In this case, no automatic constraints are specified
//    for the offset between the content and the frame. The constraints
//    which specify the position of the content must then be explicitly
//    specified in the 'position' section of some area(s) and must refer
//    to the content points of the area whose content is positioned.
// 2. 'Automatic Non-Negative Offset': in this mode a non-negative
//    offset is specified by automatic constraints for the offset of each
//    side of the content from the corresponding side of the frame. The
//    offset is always taken to be from the frame edge to the content edge,
//    so that in this mode the content is always contained inside the frame.
//    The automatic constraints generated in this mode have system (maximal)
//    priority and fix the distance to a given value. The ContentPosManager
//    has an API (see below) which allows other modules to set these
//    automatic offsets (e.g. the module which generates border lines
//    around areas may register an offset equal to the thickness of the
//    line). The ContentPosManager is then responsible for registering the
//    automatic constraint which will enforce this distance.
// 3. 'Zero Offset': in this mode the offset between the frame and the
//    content is set to zero on all sides. This is stronger than setting
//    an offset of zero in the automatic non-negative offset mode (above)
//    because in this mode the frame and content edges are internally
//    assigned the same point labels in the position calculation module.
//    This means that no constraint can then force an offset which is not
//    zero. The advantage of this mode is that it reduces the number of points,
//    pairs and constraints registered to the positioning system. Typically,
//    non-intersection areas without a border line would use this mode.
//    These areas can be very numerous, as they are often the simplest
//    elements in the display (e.g. markers on a slider or a graph).
//
// The mode of the ContentPosManager are detemrined as follows.
// 1. First, the value of the 'independentContentPosition' flag is determined.
//    If this value is true, the 'Independent Content Position' mode is used.
//    Otherwise, one of the two other modes is used. The value of the
//    'independentContentPosition' flag is determined as follows:
//    a. If the 'independentContentPosition' attribute is explicitly specified
//       in the description then the 'independentContentPosition' property
//       is set to that value.
//    b. If the 'independentContentPosition' attribute does not appear in the
//       description then the property is set to true if the area is an
//       intersection area and to false if the area is not an intersection
//       area. This default seems o be right in almost if not all cases.
// 2. If the 'independentContentPosition' property is set to false, the
//    ContentPosManager looks at the offsets registered by through the
//    'setContentOffset' interface (see below). If any of  these offsets is
//    defined (even if they are all zero), the 'automatic non-negative offset'
//    mode is used. Otherwise, the 'zero offset' mode is used.
//
// The distinction between a zero offset and an undefined offset is intended
// to allow the system to register zero offsets in preparation for a larger
// offset. This allows the system to remain in the 'automatic non-negative
// offset' mode even as the offset is zero if it is known that the offset
// may later become non-zero. Changing the offset is much cheaper than
// changing the mode from zero-offset to automatic non-negative offset
// (and back).
//
// To register an offset (for the automatic non-negative offset mode) one
// should call the following function (with 'this' being the ContentPosManager
// of the relevant area):
//
// this.setContentOffset("left"|"right"|"top"|"bottom", <offset>);
//
// or, if one wants to set all offsets at once (to the same value):
//
// this.setAllContentOffsets(<offset>)
//
// Both these functions round negative numbers to zero. An undefined offset
// value can also be used. If all offsets are set to undefined, the system
// will switch from 'automatic non-negative offset' mode to 'zero offset'
// mode.

// Any change to the 'independentContentPosition' attribute in the description
// and any new content offset set is immediately propagated and will
// immediately influence the mode and the constraints registered to the
// positioning system. After such a modification, the geometry task is
// scheduled.

// The object has the following structure:
// {
//    baseArea: <pointer to the area on which this object is attached>,
//    independentContentPosition: true|false // whether in independent content
//                                           // position mode
//    zeroOffsetMode: true|false // whether in zero offset mode (cannot be
//                               // true if independentContentPosition is true)
//    offsets: {
//        left: <number >= 0>   // deleted if undefined 
//        right: <number >= 0>  // deleted if undefined 
//        top: <number >= 0>    // deleted if undefined 
//        bottom: <number >= 0> // deleted if undefined 
//    }
//
//    allModeCallbacks: {
//        <subSystem1>: {
//           <id1> : { obj: <obj>, opq: <opq> },
//           <id2>: ...
//           ...
//        },
//        ...
//    },

//    zeroOffsetCallbacks: {
//        <subSystem1>: {
//           <id1> : { obj: <obj>, opq: <opq> },
//           <id2>: ...
//           ...
//        },
//        ...
//    }
// }
//
// This object holds two lists of callbacks. These callbacks are registered
// by modules which wish to be notified when the content positioning
// modes changes (for example, content points, which need to update their
// labels).
//
// The callbacks registered to 'allModeCallbacks' are called whenever
// the content mode changes (no matter what the mode before or after was).
// To register a callback to this list, a module should call:
//
// ContentPosManager.registerAllModeChange(<sub-system>, <id>, <obj>,
//                                         <opaque>).
// <sub-system> and <id> are arbitrary strings which together identify
// this registration (and can be used to unregister it).
//
// When the mode changes, the following function call (for each registration)
// takes place (after the mode change is completed):
// <obj>.contentOffsetModeChange(<base area ID>, <prev Mode>, <new mode>,
//                               <opaque>)
// where <base area ID> is the ID of the area of this ContentPosManager,
// <prev mode> and <new mode> are the modes before and after the change
// (these are strings which can be one of: "zero", "auto" and "independent").
// <opaque> is the opaque given with the registration.
//
// To remove a callback, one should call:
// ContentPosManager.unregisterAllModeChange(<sub-system>, <id>);
//
// The callbacks registered to 'zeroOffsetCallbacks' behave similarly
// except that they are called only when the mode changes to or from
// zero offset mode.
//
// To register a callback to this list, a module should call:
//
// ContentPosManager.registerZeroOffsetModeToggle(<sub-system>, <id>, <obj>,
//                                                <opaque>).
// (with the same meaning as above).
//
// When the mode changes to/from zero offset mode, the following function
// call (for each registration) takes place (after the mode change is
// completed):
// <obj>.zeroOffsetToggle(<base area ID>, <prev Mode>, <is zero offset mode?>,
//                        <opaque>)
// where <is zero offset mode?> is true if the mode after the change is
// zero offset mode and false otherwise. The other arguments are as in the
// 'contentOffsetModeChange' case.
//
// To remove a callback, one should call:
// ContentPosManager.unregisterZeroOffsetModeToggle(<sub-system>, <id>);

//
// Supported edge names
//

ContentPosManager.edgeNames = {
    left: true,
    right: true,
    top: true,
    bottom: true
};

//
// Constructor
//

// The constructor does nothing much except initialization to default
// values and storage of the area ('baseArea') on which this object is defined.

function ContentPosManager(area, path)
{
    this.baseArea = area; // the area on which this object is defined

    this.ipcPropVal = undefined; // Will get set later
    this.offsets = {}; // all offsets are undefined   

    this.allModeCallbacks = {};
    this.zeroOffsetCallbacks = {};

    // determine the initial mode (without consulting description)
    this.determineMode();
}

ContentPosManager.prototype.independentContentPositionHandler =
      contentPosManagerIndependentContentPositionHandler;
function contentPosManagerIndependentContentPositionHandler(value)
{
    this.ipcPropVal = typeof(value) === "object"? undefined: value;
    this.determineMode();
}

///////////////////////
// Automatic Offsets //
///////////////////////

// This function should be called by an external module which wants to
// set an automatic non-negative offset on the given side of the area
// (edge can be "left"|"right"|"top"|"bottom"). This function takes care
// of updating the ContentPosManager internal structures, setting all required
// constraints and notifying all relevant external objects of the change.
// If 'offset' is undefined, the relevant offset requirement is removed.
// As long as there still is one defined offset requirement, such an
// undefined requirement is treated as a zero offset requirement. Once all
// the requirements are undefined, the mode is changed to zero offset mode
// (unless the 'independent content position' mode was on, in which case
// the mode remains unchanged).

ContentPosManager.prototype.setContentOffset =
    contentPosManagerSetContentOffset;

function contentPosManagerSetContentOffset(edge, offset)
{
    if(!(edge in ContentPosManager.edgeNames)) {
        cdlInternalError("unknown edge name for content offset: ", edge);
        return false;
    }
    
    var prevValue = this.offsets[edge];

    if(offset === prevValue)
        return false; // nothing to do

    if(offset === undefined) {
        delete this.offsets[edge];
        if(this.isInAutoOffsetMode() && isEmptyObj(this.offsets)) {
            this.setZeroOffsetMode();
        }
    } else {
        this.offsets[edge] = offset > 0 ? offset : 0;
        if(this.zeroOffsetMode) {
            this.setAutoOffsetMode();
        }
    }

    // if in 'independent content position' mode and the offset is left or top
    // we need to notify the absolute positioning manager of the change
    // (as this change will not necessarily cause a positioning change but
    // the offset of the display DIV needs to be adjusted).
    if((edge == "left"  || edge == "top") && (offset || prevValue) &&
       this.isInIndependentContentPositionMode())
        globalAbsolutePosManager.refreshDisplayOffset(this.baseArea, edge,
                                                      offset ? offset : 0);
    
    // no mode change, should we update the constraints?
    if(!this.isInAutoOffsetMode())
        return true;
    
    // because undefined != 0 and because of rounding of negative numbers,
    // this equality may have been missed above
    if(!prevValue && !offset)
        return true;

    // update the automatic constraint for this edge.
    this.setAutoConstraint(edge);
    return true;
}

// This function should be called by an external module which wants to
// set all automatic non-negative offsets to the given value.
// This function takes care of updating the ContentPosManager internal
// structures, setting the required constraints and notifying all
// relevant external objects of the change.
// If 'offset' is undefined, all offset requirements are removed and
// the mode is changed to zero offset mode (unless the
// 'independent content position' mode was on, in which case the mode remains
// unchanged).
// Returns true when positioning has to be scheduled.

ContentPosManager.prototype.setAllContentOffsets =
    contentPosManagerSetAllContentOffsets;

function contentPosManagerSetAllContentOffsets(offset)
{
    if(offset == undefined) {
        
        if(this.zeroOffsetMode)
            return false; // nothing to do, all offsets are already undefined

        // if in 'independent content position' mode and this operation caused
        // the left or top offset to change, we need to notify the absolute
        // positioning manager of the change (as this change will not
        // necessarily cause a positioning change but the offset of
        // the display DIV needs to be adjusted).
        if(this.isInIndependentContentPositionMode()) {
            if(this.offsets.left)
                globalAbsolutePosManager.
                    refreshDisplayOffset(this.baseArea, "left", 0);
            if(this.offsets.top)
                globalAbsolutePosManager.
                    refreshDisplayOffset(this.baseArea, "top", 0);
        }
        
        this.offsets = {};

        if(this.isInAutoOffsetMode())
            this.setZeroOffsetMode();
        
        return true;
    }

    // simply call the single offset refresh function (above) for each side
    // of the area (this will also take care of the appropriate mode change
    var change = false;
    for(var edge in ContentPosManager.edgeNames) {
        if (this.setContentOffset(edge, offset)) {
            change = true;
        }
    }
    return change;
}

// This function sets the automatic constraint for the offset defined
// for the given edge. This function should be called only when in
// automatic non-negative offset mode. This function sets the constraint
// through the AllPosConstraints object attached to the area. If this
// object is not defined (during area construction, for example)
// no constrain is created, but the AllPosCnstraints object will check
// whether it needs to create any constraints once it is constructed.

ContentPosManager.prototype.setAutoConstraint =
    contentPosManagerSetAutoConstraint;

function contentPosManagerSetAutoConstraint(edge)
{
    if(!this.baseArea.allPosConstraints)
        return; // not yet constructed, will add the constraints later

    this.baseArea.allPosConstraints.
        setAutoContentConstraint(edge, this.offsets[edge]);
}

// Return the offset registered for the given edge. If no offset is registered,
// zero is returned.

ContentPosManager.prototype.getOffset = contentPosManagerGetOffset;

function contentPosManagerGetOffset(edge)
{
    var offset = this.offsets[edge];
    
    return offset ? offset : 0; 
}

///////////
// Modes //
///////////

// This function reads the 'independentContentPosition' property from the
// area description, checks whether the area is an intersection area and
// from this, together with the offsets currently registers, determines the
// current mode. If the mode changed, it initiates the mode change.
//
ContentPosManager.prototype.determineMode = contentPosManagerDetermineMode;

function contentPosManagerDetermineMode()
{
    // check the 'independentContentPosition' property in the description
    var independentContentPosition = this.ipcPropVal;

    // if not defined, initialize to the default value
    if(independentContentPosition === undefined)
        independentContentPosition = !!this.baseArea.isIntersection();

    if(!independentContentPosition) {
        if(isEmptyObj(this.offsets))
            this.setZeroOffsetMode();
        else
            this.setAutoOffsetMode();
    } else
        this.setIndependentContentPositionMode();
}

////////////////////
// Mode Functions //
////////////////////

// Each of these functions returns true when content positioning is in the
// mode specified by its name

// This function returns true if content positioning is currently in automatic
// non-negative offset mode.

ContentPosManager.prototype.isInAutoOffsetMode =
    contentPosManagerIsInAutoOffsetMode;

function contentPosManagerIsInAutoOffsetMode()
{
    return !this.independentContentPosition && !this.zeroOffsetMode;
}

// This function returns true if content positioning is currently in zero
// offset mode.

ContentPosManager.prototype.isInZeroOffsetMode =
    contentPosManagerIsInZeroOffsetMode;

function contentPosManagerIsInZeroOffsetMode()
{
    return this.zeroOffsetMode;
}

// This function returns true if content positioning is currently in
// independent content position mode

ContentPosManager.prototype.isInIndependentContentPositionMode =
    contentPosManagerIsInIndependentContentPositionMode;

function contentPosManagerIsInIndependentContentPositionMode()
{
    return this.independentContentPosition;
}

//////////////////
// Mode Changes //
//////////////////

// This function changes the mode to 'zero offset' mode. It takes care of
// notifying all relevant external modules.

ContentPosManager.prototype.setZeroOffsetMode =
    contentPosManagerSetZeroOffsetMode;

function contentPosManagerSetZeroOffsetMode()
{
    if(this.zeroOffsetMode) // mode already set
        return;

    var prevMode = this.independentContentPosition ? "independent" : "auto";

    if(prevMode == "auto" && this.baseArea.allPosConstraints)
        // remove the automatic constraints for the offset between the frame
        // and the content
        this.baseArea.allPosConstraints.removeAutoContentConstraints();
    
    this.toggleZeroOffsetMode(false);
    this.callCallbacks(prevMode, "zero");
}

ContentPosManager.prototype.setAutoOffsetMode =
    contentPosManagerSetAutoOffsetMode;

function contentPosManagerSetAutoOffsetMode()
{
    if(this.zeroOffsetMode === false &&
       this.independentContentPosition === false)
        return; //mode already set

    var prevMode = this.independentContentPosition ? "independent" : "zero";
    
    if(this.zeroOffsetMode)
        this.toggleZeroOffsetMode(false);
    else {
        // set the new mode
        this.independentContentPosition = false;
        this.zeroOffsetMode = false;
    }

    // add the automatic constraints for the offset between the frame and
    // the content
    if(this.baseArea.allPosConstraints)
        for(var edge in ContentPosManager.edgeNames)
            this.baseArea.allPosConstraints.
                setAutoContentConstraint(edge, this.offsets[edge]);
    
    this.callCallbacks(prevMode, "auto");
}

ContentPosManager.prototype.setIndependentContentPositionMode =
    contentPosManagerSetIndependentContentPositionMode;

function contentPosManagerSetIndependentContentPositionMode()
{
    if(this.independentContentPosition)
        return; // mode already set

    var prevMode = this.zeroOffsetMode ? "zero" : "auto";
    
    if(this.zeroOffsetMode)
        this.toggleZeroOffsetMode(true);
    else {

        // remove the automatic constraints for the offset between the frame
        // and the content
        if(this.baseArea.allPosConstraints)
            this.baseArea.allPosConstraints.removeAutoContentConstraints();
        
        // change the mode
        this.independentContentPosition = true;
        this.zeroOffsetMode = false;
    }

    this.callCallbacks(prevMode, "independent");
}

// When the mode changes to or from zero offset mode, the point labels
// of the content position change. This requires removal and re-registration
// of all constraints and watched pairs which make use of those points (and
// because these cannot be distinguished from frame points, of all constraints
// which make use of points of this area).
// This function takes care of clearing and reactivating all constraints
// and registered watched pairs which are effected by this change. For
// clearing and restarting the constraints registered from other areas,
// this function makes this area 'unmatchable' and then makes it 'matchable'
// again (when the mode has been changed).
// The global position manager also needs to be updated. It has to both
// add/remove the offsets defining the position of the content and it
// has to modify the offsets defining the left/top offset of embedded
// areas (when the embedding area is in zero offset mode, the left/top offsets
// of its embedded areas area relative to the frame and otherwise, relative to
// the content).
// The function is called when the mode is still set to the mode before
// the change. The mode is changed mid-way inside the function. This is
// needed because the removal and addition of constraints is performed
// by external modules and these query the ContentPosManager to know
// how to remove and add the constraints.
// If the function is called when 'this.zeroOffsetMode' is false, it can mean
// only one thing - the current mode should be switched to zero offset mode.
// However, if the function is called with 'this.zeroOffsetMode' true,
// we still need to specify whether the mode should be switch to
// 'automatic non-negative offsets' or to 'independent content position'.
// To indicate this, the function is called with an argument
// 'independentContentPosition'. If this argument is true, the mode is
// changed to independent content position mode.

ContentPosManager.prototype.toggleZeroOffsetMode =
    contentPosManagerToggleZeroOffsetMode;

function contentPosManagerToggleZeroOffsetMode(independentContentPosition)
{
    var area = this.baseArea;
    var embeddedAreaList;

    var areaInitialized = this.baseArea.areaRegisteredToAbsolutePosManager;
    var prevIndependentContentPosition = this.independentContentPosition;

    if (areaInitialized) {
        embeddedAreaList = area.getEmbeddedAreaList();
        for (var i = 0; i != embeddedAreaList.length; i++) {
            var embeddedArea = embeddedAreaList[i];
            if (embeddedArea instanceof DisplayArea) {
                globalAbsolutePosManager.newEmbedding(embeddedArea, area,
                                                      undefined);
            }
        }
        if(!this.zeroOffsetMode) { // about to turn on the zero offset mode
            // update the absolute positioning manager
            globalAbsolutePosManager.removeAreaContentOffsets(area);
        }
    }

    // set the mode flags
    this.zeroOffsetMode = !this.zeroOffsetMode;
    this.independentContentPosition =
        this.zeroOffsetMode ? false : !!independentContentPosition;
    
    if (areaInitialized) {

        if (!this.zeroOffsetMode) { // added independence
            // update the absolute positioning manager
            globalAbsolutePosManager.addAreaContentOffsets(area);
        }

        // Refresh the absolute left/top offsets defined for the embedded areas
        for (var i = 0; i != embeddedAreaList.length; i++) {
            var embeddedArea = embeddedAreaList[i];
            if (embeddedArea instanceof DisplayArea) {
                globalAbsolutePosManager.newEmbedding(embeddedArea, undefined,
                                                      area);
            }
        }
    }
}

////////////////////////////////////////////
// Callback Registration and Notification //
////////////////////////////////////////////

// register a callback for any mode change (see introduction for more details)

ContentPosManager.prototype.registerAllModeChange =
    contentPosManagerRegisterAllModeChange;

function contentPosManagerRegisterAllModeChange(subSystem, id, obj, opq)
{
    var sentry = this.allModeCallbacks[subSystem];
    if (! sentry) {
        sentry = this.allModeCallbacks[subSystem] = {};
    }

    // replace any existing registration
    sentry[id] = {
        obj: obj,
        opq: opq
    };
}

// unregister a callback for any mode change (see introduction for more
// details)

ContentPosManager.prototype.unregisterAllModeChange =
    contentPosManagerUnregisterAllModeChange;

function contentPosManagerUnregisterAllModeChange(subSystem, id)
{
    var sentry = this.allModeCallbacks[subSystem];
    if (! sentry) {
        return;
    }
    delete sentry[id];
}

// --------------------------------------------------------------------------
// unregisterZeroOffsetModeToggle
//
ContentPosManager.prototype.unregisterZeroOffsetModeToggle =
    contentPosManagerUnregisterZeroOffsetModeToggle;
function contentPosManagerUnregisterZeroOffsetModeToggle(subSystem, id)
{
    var sentry = this.zeroOffsetCallbacks[subSystem];
    if (! sentry) {
        return;
    }
    delete sentry[id];
}

// --------------------------------------------------------------------------
// registerZeroOffsetModeToggle
//
ContentPosManager.prototype.registerZeroOffsetModeToggle =
    contentPosManagerRegisterZeroOffsetModeToggle;
function contentPosManagerRegisterZeroOffsetModeToggle(subSystem, id, obj, opq)
{
    var sentry = this.zeroOffsetCallbacks[subSystem];
    if (! sentry) {
        sentry = this.zeroOffsetCallbacks[subSystem] = {};
    }

    // replace any existing registration
    sentry[id] = {
        obj: obj,
        opq: opq
    };
}

// --------------------------------------------------------------------------
// unregisterZeroOffsetModeToggle
//
ContentPosManager.prototype.unregisterZeroOffsetModeToggle =
    contentPosManagerUnregisterZeroOffsetModeToggle;
function contentPosManagerUnregisterZeroOffsetModeToggle(subSystem, id)
{
    var sentry = this.zeroOffsetCallbacks[subSystem];
    if (! sentry) {
        return;
    }
    delete sentry[id];
}

//
// This function calls the callbacks registered by various modules to allow
// them to receive a notification when the content positioning mode changes.
// This function is called after the change has taken place. The function is
// called with two arguments: the mode before the change an the mode after
// the change (each of these can be either "zero", "auto" or "independent").
// There are two types of callbacks: those which should be called with any
// change and those which should only be called if the mode changed
// to or from "zero" (zero offset mode). When the mode changes to/from
// zero offset mode, all callbacks (in both lists) are called while
// if the change is between independent and automatic offset modes, only
// the callbacks for all changes are called (a module should not register
// callbacks of both types as it would then receive two notification
// when the zero-offset mode is toggled).

ContentPosManager.prototype.callCallbacks = contentPosManagerCallCallbacks;

function contentPosManagerCallCallbacks(prevMode, newMode)
{
    for (var subSystem in this.allModeCallbacks) {
        for (var id in this.allModeCallbacks[subSystem]) {
            var entry = this.allModeCallbacks[subSystem][id];
            entry.obj.contentOffsetModeChange(this.baseArea.areaId, prevMode,
                                              newMode, entry.opq);
        }
    }

    if(prevMode == "zero" || newMode == "zero") {
        for (var subSystem in this.zeroOffsetCallbacks) {
            for (var id in this.zeroOffsetCallbacks[subSystem]) {
                var entry = this.zeroOffsetCallbacks[subSystem][id];
                entry.obj.zeroOffsetToggle(this.baseArea.areaId,
                                           newMode == "zero", entry.opq);
            }
        }
    }
}
