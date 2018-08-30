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


// This file defines the single positioning point object. This object
// takes a point description object (as it appears in an area description)
// and the area on which this description is defined and creates the
// list of point labels which are generated by this point description.
// These point labels can then be used when registering constraints to
// the positioning system.
//
// Since the transformation of the point description into a set of point
// labels may depend on condition and canvas matches, the set of labels
// is dynamic. The point object updates this set dynamically and calls
// registered handlers to report such changes.

//////////////////////////////
// Positioning Point Object //
//////////////////////////////

// This object takes as input a base area and a point description and
// manages the set of labels which represent the points defined by this
// description relative to the given base area.
// There are several ways to define a point:
// 1. a global label, implemented by GlobalLabelPosPoint
// 2. a predefined type, "element"/"type", implemented by SuffixPosPoint
// 3. a user defined label, "element"/"label", implemented by SuffixPosPoint
// 4. a canvas value, "element"/"value"/"canvas", implemented by CanvasPosPoint
// 5. a relative visibility, "visibilityOf"/"relativeTo"/"type", implemented
//      by RVPosPoint
// 6. an internal label, implemented by InternalLabelPosPoint
// 7. an undefined point (with no labels), implemented by UndefinedPosPoint
//
// 
// The point object has the following structure (explanations below):
// {
//    impl: posPoint-implementation-object
//    labels: {
//        // the list of labels matching this posPoint
//        label1: true,
//        label2: true,
//        ...
//    }
//    changes: {
//       <label>: <removed/added>
//    }
//    handlers: {
//        <handler ID>: <handler object>
//        ....
//    };
//    descriptionRefresh: true|false
// }
//
// The 'impl' sub-object points to a specific posPoint implementation.
// 
// The 'labels' field holds the point labels assigned to this point.
//
// This object is updated when either the point description changes
// or the set of labels matched by the posPoint implementation changes. When
//  this happens, this list of updated. Labels which were removed are added to
//  the list of changes with the value "removed" and labels which were added are
// added to the list of changes with the label "added".
// The list of changes can be read by the objects which depend on this
// point object when their handlers are called. After all handlers are called,
// the changes list is cleared.
//
// Objects which want to be notified of changes in this point object
// can register a handler to receive such notifications.
// Thes handlers are stored in the object 'handlers', each handler under
// an ID assigned to it at registration. This ID is returned by the
// handler registration function, so this ID can be used to remove the handler.
// The handler should be an object X which is notified of a change
// by X.call(null, <point object>). The 'null' argument is intended to
// allow this to work when X is a standard JavaScript function.
//
// The 'descriptionRefresh' flag is set while the description is being
// refreshed. This blocks callback functions from calling the registered
// handlers, as these will be called when the description refresh is completed.
//
// Also, 'descriptionRefresh' is used while destorying the posPoint. However,
//  in this case, the callback functions are *not* called even in the end,
//  as they are assumed to be in the process of being destroyed.
//

// %%include%%: "pointLabels.js"
// %%include%%: "relativeVisibilityPoint.js"
// %%include%%: "suffixPoint.js"

function PosPoint(areaId, cm, name, pointNr)
{
    this.areaId = areaId.areaId;
    this.labels = {};
    this.changes = {};
    this.handlerId = 0;
    this.handlers = [];
    this.name = name; // for author error message only
    this.pointNr = pointNr; // for author error message only
}

///////////////////////
// Removal Functions //
///////////////////////

// This function should be called just before the point object is destroyed.
// Notice that this does not notify registered handlers of the resulting
// changes, so this should be called only when the constraint which this
// point is part of is destroyed and therefore there is no need to track
// modifications anymore.

PosPoint.prototype.destroyPoint = posPointDestroyPoint;

function posPointDestroyPoint()
{
    this.descriptionRefresh = true;

    this.callReleaseElementFunctions();
    
    if (this.impl) {
        this.impl.destroy();
        delete this.impl;
    }
    
    delete this.descriptionRefresh;

    // not calling handlers!
    // this.callHandlers();
}

// Release the element(s) obtained via a function
PosPoint.prototype.callReleaseElementFunctions =
      posPointCallReleaseElementFunctions;
function posPointCallReleaseElementFunctions()
{
    if (this.releaseElementFunctions) {
        var relElFun = this.releaseElementFunctions;
        for (var i = 0; i != relElFun.call.length; i++) {
            relElFun.call[i](relElFun.paid);
        }
    }
}

// This function adds the given label to the list of labels.
// If the label is already registered than no change is registered.
// Note that no ref-count is done, so that the first removeLabel
// will remove the label, even if it were added twice or more
PosPoint.prototype.addLabel = posPointAddLabel;
function posPointAddLabel(label)
{
    if (label in this.labels) {
        return;
    }

    this.labels[label] = true;

    if (this.changes[label] == "removed") {
        delete this.changes[label];
    } else {
        this.changes[label] = "added";
    }
}

// This function removes the given label. It also updates the changes list.

PosPoint.prototype.removeLabel = posPointRemoveLabel;
function posPointRemoveLabel(label)
{
    if (! this.labels[label])
        return;

    delete this.labels[label];

    if(this.changes[label] == "added")
        delete this.changes[label];
    else
        this.changes[label] = "removed";
}

PosPoint.prototype.removeAllLabels = posPointRemoveAllLabels;
function posPointRemoveAllLabels()
{
    for(var label in this.labels)
        this.removeLabel(label);
}

// this function returns an associative array of the labels matched
//  by the posPoint

PosPoint.prototype.getLabels = posPointGetLabels;

function posPointGetLabels()
{
    return this.labels;
}

///////////////////////////////////
// Description Refresh Functions //
///////////////////////////////////

// This function performs a complete refresh based on a new description.

PosPoint.prototype.newDescription = posPointNewDescription;

function posPointNewDescription(pointDesc)
{
    var type = this.determineType(pointDesc);

    this.descriptionRefresh = true;

    if (!this.impl || this.type != type) {
        if (this.impl) {
            this.impl.destroy();
            delete this.impl;
        }

        this.type = type;

        switch (type) {
          case undefined:
            this.impl = new UndefinedPosPoint(this.areaId, this);
            // UndefinedPosPoint can't call the callHandlers itself
            this.callHandlersSuppressed = true;
            break;
          case "relativeVisibility":
            this.impl = new RVPosPoint(this.areaId, this);
            break;
          case "canvas":
            assert(false, "unsupported type"); // !!!
            break;
          case "label":
            this.impl = new SuffixPosPoint(this.areaId, this, true);
            break;
          case "type":
            this.impl = new SuffixPosPoint(this.areaId, this, false);
            break;
          case "globalLabel":
            this.impl = new GlobalLabelPosPoint(this.areaId, this);
            break;
          case "internalLabel":
            this.impl = new InternalLabelPosPoint(this.areaId, this);
            break;
        }
    }

    this.impl.newDescription(pointDesc);

    delete this.descriptionRefresh;

    if (this.callHandlersSuppressed) {
        delete this.callHandlersSuppressed;
        this.callHandlers();
    }
}

// this function determines the posPoint type based on its description
// it is also used as an auxilary function by 'isAPosPointDescription()'
PosPoint.prototype.determineType = posPointDetermineType;
function posPointDetermineType(pointDesc)
{
    if (! pointDesc)
        return undefined;

    if (typeof(pointDesc) == "object") {
        if (pointDesc.internal !== undefined) {
            return "internalLabel";
        }
        if (pointDesc.visibilityOf !== undefined) {
            return "relativeVisibility";
        }
        if (pointDesc.value !== undefined) {
            return "canvas";
        }
        if (pointDesc.label !== undefined) {
            return "label";
        }
        if (pointDesc.type !== undefined) {
            return "type";
        }
    } else {
        return "globalLabel";
    }
    return undefined;
}

// this function takes a description and attempts to guess if it's a posPoint
//  description
function isAPosPointDescription(desc)
{
    var type = PosPoint.prototype.determineType(desc);
    return (type !== undefined);
}
//
// List of predefined types
//
PosPoint.definedTypes = {
    "left": true,
    "right": true,
    "top": true,
    "bottom": true,
    "horizontal-center": true,
    "vertical-center": true
};

//
// List of predefined edge types (a subset of the above)
//

PosPoint.definedEdgeTypes = {
    "left": true,
    "right": true,
    "top": true,
    "bottom": true
};

//////////////////////////////////
// Change Notification Handlers //
//////////////////////////////////

// The 'PosPoint' object allows handlers to be registered. These handlers
// are called when there are changes in the labels for the point.
// Each handler X is assumed to be an object which supports the member
// function X.call(null, <point object>). The 'null' argument is intended
// to allow this to work when X is a standard JavaScript function.
//
// It is up to the handler object to store any context information it will
// need when called.

// This function registers a new handler to the PosPoint object. It is not
// verified that this handler was not registered before. The function
// returns an ID which can later be used to remove the handler.

PosPoint.prototype.registerHandler = posPointRegisterHandler;

function posPointRegisterHandler(handler)
{
    if(!handler || typeof(handler.call) != "function") {
        cdlInternalError("registering improper handler object: ", handler);
        return undefined;
    }
    
    var id = this.handlerId++;
    this.handlers[id] = handler;
    return id;
}

// This function removes the handler with the given ID (if it is found)
// The removeHandler* functions never get called? [TGV]

PosPoint.prototype.removeHandlerById = posPointRemoveHandlerById;

function posPointRemoveHandlerById(handlerId)
{
    delete this.handlers[handlerId];
}

// This function removes the given handler from the list of handlers.

PosPoint.prototype.removeHandler = posPointRemoveHandler;

function posPointRemoveHandler(handler)
{
    for(var h in this.handlers) {
        if(this.handlers[h] == handler)
            this.removeHandlerById(h);
        // continue even if already deleted, since we do not want to assume
        // that each handler is only registered once.
    }
}

// this function should be called by the posPoint implementations when they
// are triggered by something other than the posPoint object, e.g. a canvas
// callback, a positioning trigger, a condition add/remove callback.
// If the 'descriptionRefresh' flag is set, the call is ignored, as the changes
//  will be applied when the posPoint description update completes
PosPoint.prototype.applyChanges = posPointApplyChanges;
function posPointApplyChanges()
{
    if (this.descriptionRefresh) {
        this.callHandlersSuppressed = true;        
    } else {
        this.callHandlers();
    }
}

// This function calls all registered handlers. After calling the handlers,
// the changes list is cleared.
PosPoint.prototype.callHandlers = posPointCallHandlers;

function posPointCallHandlers()
{
    // call handlers
    for(var h in this.handlers)
        this.handlers[h].call(null, this);
    
    // clear changes
    this.changes = {};
}


// ======================================================


// "undefined" posPoint implementation
function UndefinedPosPoint()
{
}

UndefinedPosPoint.prototype.destroy = undefinedPosPointDestroy;
function undefinedPosPointDestroy()
{
}

UndefinedPosPoint.prototype.newDescription = undefinedPosPointNewDescription;
function undefinedPosPointNewDescription()
{
}

// "global" posPoint implementation
function GlobalLabelPosPoint(areaId, posPoint)
{
    this.posPoint = posPoint;
}

GlobalLabelPosPoint.prototype.destroy = globalLabelPosPointDestroy;
function globalLabelPosPointDestroy()
{
    this.posPoint.removeLabel(this.label);
}

// This string is prefixed to 'constant' labels which are defined by
// the description directly. This ensures that constant labels and
// automatically generated labels cannot overlap. 
GlobalLabelPosPoint.prototype.constPrefixStr = "_";

GlobalLabelPosPoint.prototype.newDescription =
    globalLabelPosPointNewDescription;
function globalLabelPosPointNewDescription(pointDesc)
{
    this.label = this.constPrefixStr + String(pointDesc);
    this.posPoint.addLabel(this.label);
    this.posPoint.callHandlers();
}

///////////////////////////////////
// Internal Label Implementation //
///////////////////////////////////

// An internal label point should be used only for points generated
// by code which knows already what point label is required. This is
// convenient, for example, when generating constraints where some of the
// point labels are already known while other point labels should be defined
// based on a condition. In this case we want to use the standard interface
// for creating constraints from a description, but want to force certain
// point label to be exactly what we want them to be. Such points can
// then be defined by the description:
// {
//    internal: <string>
// }
// where the string is exactly the point label we want to have.
//
// This is similar to the global PosPoint (where the point label is a fixed
// string given by the description) only that in the global PosPoint the
// system automatically adds a prefix to the given string to make sure there
// is no collision between point labels generated in this way and other
// point labels. This is important for global points defined in
// the configuration but not for point defined internally in the code, as for
// those we can assure in advance that they do not conflict with other
// labels generated by the system.

function InternalLabelPosPoint(areaId, posPoint)
{
    this.posPoint = posPoint;
}

InternalLabelPosPoint.prototype.destroy = internalLabelPosPointDestroy;
function internalLabelPosPointDestroy()
{
    this.posPoint.removeLabel(this.label);
}

InternalLabelPosPoint.prototype.newDescription =
    internalLabelPosPointNewDescription;
function internalLabelPosPointNewDescription(pointDesc)
{
    this.posPoint.removeAllLabels(); // remove any existing label
    this.label = pointDesc.internal;
    this.posPoint.addLabel(this.label);
    this.posPoint.callHandlers();
}
