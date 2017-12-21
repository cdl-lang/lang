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


// "relativeVisibility" posPoint implementation

// A relative visibility point is defined for a base area and a frame
// area which is assumed to be embedding* for the base area (that is, the base
// is embedded directly or indirectly in the frame). The relative visibility
// point can be of type left/right/top/bottom and is supposed to represent
// the leftmost/rightmost/topmost/bottommost position in the content of the
// base area which is visible from outside or inside the frame (whether
// the visibility is from inside or outside the frame area depends on the
// way the relative visibility point is defined, see below). Each relative
// visibility point is therefore the leftmost/rightmost/topmost/bottommost
// of the corresponding edge points (frame and content) of all areas in
// the embedding chain from the base to the frame. The base is always
// included in this chain while the frame is optionally included. If the
// frame is included, then this results in the visibility of the base area
// when looking at it from outside the frame area while if the frame is
// not included, the result is the visibility when looking at the area from
// inside the frame (under the assumption that the frame does not influence
// this visibility).
//
// To implement the leftmost/rightmost/topmost/bottommost we use a
// recursive constraint construction. For example, for the left relative
// visibility point of Base relative to Frame, the relative visibility
// point is defined as the rightmost between the left content edge of the base,
// the left frame edge of the base and the left relative visibility point
// of the embedding area of Base and Frame. This process terminates when
// only the content and frame of the base are included (without the
// relative visibility point of the Frame). If we are looking from
// outside frame, this will happen when Base is equal to Frame. When looking
// from inside Frame, this happens when Base is directly embedded in
// Frame. The position of the right/top/bottom relative visibility points
// is defined similarly, of course.
//
// A relative visibility point which is based only on the content and frame
// edge points of the Base area is a 'simple relative visibility point'.
// When 'independent content positioning mode' is false, a simple relative
// visibility point reduces to the content edge point (even if the offset
// between content and frame is not zero, the content is guaranteed to be
// inside the frame in this mode). The relative visibility point then
// receives the same label as the content edge point (which may also be
// the frame label, when zero-content-offset mode is on).
// We refer to this as a 'degenerate' relative visibility point.

// The description of a relative visibility point has the format:
//    {
//       visibilityOf: <base area condition>,
//       relativeTo: <frame area condition>,
//       type: ["top"/"left"/"bottom"/"right"],
//       includeFrame: true|false // default is false
//    }
// This generates labels for every pair of base area and frame area
// defined by the given conditions. If Base is not in independent content
// positioning mode and if base and frame are the same area
// or if base is directly embedded in frame and 'includeFrame' is false
// (we are looking 'from inside the frame') then a degenerate label
// is created for the base and frame area (this degenerate label is
// the standard content label for the corresponding edge type of the
// base area). In all other cases, a relative visibility label is created
// (this label is defined by the function
// rvLabel(baseId, frameId, type, includeFrame), which depends on all
// the given parameters).
//
// For each non-degenerate relative visibility point label, the object
// requests the Base area object to generate automatic constraints defining
// the position of the relative visibility point. Writing
// RV_<Base>_<Frame>_<type> for the relative visibility point label Base
// relative to Frame of type <type> and writing <Base>_<type>_content and
// <Base>_<type>_frame for the standard content and frame labels of the edge
// of type <type> of area <Base>, the following automatic constraints (of
// very high priority) are defined (if the point is a simple relative
// visibility point then constraints 3 and 4c are omitted and if the base
// area is not in 'independent content position mode' then constraints 2
// and 4b can be omitted):
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
// are generated. This may result in a simple relative visibility point,
// which then terminates the recursion.
//
// In order to allow the creation of these constraints, we need to use relative
// visibility point descriptions (for RV_<embedding(Base)>_<Frame>_<type>)
// in the description of those constraints. However, we want to do this
// separately for each base/frame pair and therefore want to pass the base id
// and/or frame ID as part of the relative visibility point description rather
//  than pass the full condition defining the 'visibilityOf' / 'relativeTo'
// condition which may match more than one area. Therefore, we allow (for
//  internal use only) to use an alternative format of the relative visibility
//  point:
//    {
//       visibilityOf: <base area Id>,
//       relativeTo: <frame area ID>,
//       type: ["top"/"left"/"bottom"/"right"],
//       includeFrame: true|false // default is false
//    }
//
// It is the responsibility of the automatic point constraints mechanism to
// modify the automatic constraints associated with an relative visibility
// point when the content positioning mode changes (this is relevant only
// for non-simple pairs). However, when a pair toggles between simple and
// non-simple (as a result of an embedding change) the RVPosPoint object
// notifies the automatic positioning constraint module of this change
// (the automatic positioning constraints module may receive the same
// notification from several RVPosPoint objects, but will update only once).
// It is also the responsibility of the RVPosPoint object defined here to
// keep its labels up to date. This means that it needs to track the 'simple'
// status of the point and the content positioning mode in order
// to decide whether to use a degenerate label or a statdard relative
// visibility label (tracking the content positioning mode of an area is only
// necessary when there are simple pairs with that area as base).
//
// Implementation
//
// The object has the following structure:
//
// {
//    uid: <unique ID>
//    type: <string indicating the type of the point>,
//    embeddingChangeRequests: {
//        <areaId>: <request ID>
//        .......
//    },
//    labels: {
//       <base ID>: {
//           <frame ID>: [<label>, <request ID>|undefined]
//           .......
//       }
//       .....
//    }

// }
//
// The implementation of the relative visibility point registers dependencies
// on the (Base,Frame) area nodes in the 'visibilityOf' and 'relativeTo'
//  attributes of its description. 
//
// In case the point is defined with 'includeFrame' which is falsy,
// we need to detemine for every pair of Base and Frame areas whether
// Base is directly embedded in Frame (in which case the point is a simple
// relative visibility point and the label of the point
// may be degenerate). This is checked directly on the area objects
// upon adding a pair and, in addition, an embedding change notification
// request is registered to the global embedding monitor. These requests
// are stored in the 'embeddingChangeRequests' so that they can be
// unregistered when no longer needed.
//
// The 'labels' table holds the pairs <baseId,frameId >actually detected.
// For each pair of areas, an array holding two values is stored:
// the first value is the point label used for this pair, and the second value
// is the registration ID for the request to create automatic constraints
// for the label (this will be undefined for degnerate labels).

function RVPosPoint(baseAreaId, posPoint)
{
    this.posPoint = posPoint;
    this.type = undefined;

    this.rvuid = "rvp" + (++RVPosPoint.uid);

    // storage for maintining resolution state for the two 'element' attributes
    this.elem = {
        visibilityOf: {
            tag: ["visibilityOf", this.rvuid],
            id: {}
        },
        relativeTo: {
            tag: ["relativeTo", this.rvuid],
            id: {}
        }
    };

    this.labels = {};

}

RVPosPoint.uid = 0;

// unique ID for registrations to external objects (e.g. content position
// manager).

RVPosPoint.nextUid = 1;

RVPosPoint.prototype.getNextUid = rvPosPointGetNextUid;

function rvPosPointGetNextUid()
{
    return ++RVPosPoint.nextUid;
}

// The 'destroy' function should be called just before the RVPosPoint object
// is about to be destroyed.

RVPosPoint.prototype.destroy = rvPosPointDestroy;

function rvPosPointDestroy()
{
    // by removing all labels, all automatic constraints as well as
    // registrations for content position mode notifications and  embedding
    // notifications are removed.
    this.removeAllLabels();

    this.cleanElement("visibilityOf");

    this.cleanElement("relativeTo");
}

// This function is used to update the description of the relative visibility
// point. It receives the new description of the point as its only argument.
// The changes relative to the previous description are handled through
// the standard call back functions

RVPosPoint.prototype.newDescription = rvPosPointNewDescription;

function rvPosPointNewDescription(pointDesc)
{
    if (!pointDesc)
        pointDesc = {};

    // refresh the includeFrame property (the new property will be used
    // when the pair list is refreshed)
    var boolIncludeFrame = isTrue(pointDesc.includeFrame);
    var includeFrameChanged = (this.includeFrame !== boolIncludeFrame);
    this.includeFrame = boolIncludeFrame;

    if(includeFrameChanged) {
        if(this.includeFrame) {
            this.destroyEmbeddingChangeRequests();
        } else {
            this.embeddingChangeRequests = {};
        }
    }

    // check whether the type (left/right/top/bottom) changed
    var typeChange = (this.type != getDeOSedValue(pointDesc.type));

    // If the type or the includeFrame property changed, we need to refresh
    // the labels for all pairs. However, since the list of pairs may also
    // have changed, we here only clear the labels and wait until after the
    // pair refresh to create the labels again. By setting 'type' to
    // 'undefined' no new labels are created during the refresh. 
    if(typeChange || includeFrameChanged) {
        this.type = undefined;
        this.removeAllLabels();
    }

    // handle 'visibilityOf'
    if (pointDesc.visibilityOf) {
        this.setElement("visibilityOf", "id", pointDesc.visibilityOf);
    } else {
        this.setElement("visibilityOf", undefined);
    }

    // handle 'realtiveTo'
    if (pointDesc.relativeTo) {
        this.setElement("relativeTo", "id", pointDesc.relativeTo);
    } else {
        this.setElement("relativeTo", undefined);
    }

    if(typeChange || includeFrameChanged) {
        this.type = getDeOSedValue(pointDesc.type);
        this.createAllLabels();
    }
}

// This function destroys the 'embeddingChangeRequests' table. It first
// unregisters every notification request which is stored in the table
// and then destroys the table.

RVPosPoint.prototype.destroyEmbeddingChangeRequests =
    rvPosPointDestroyEmbeddingChangeRequests;

function rvPosPointDestroyEmbeddingChangeRequests()
{
    for (var areaId in this.embeddingChangeRequests) {
        allAreaMonitor.removeAreaSpecificCallBack("change",
                                          this.embeddingChangeRequests[areaId]);
    }
    delete this.embeddingChangeRequests;
}

//
// area reference resolution
// 
// --------------------------------------------------------------------------
// setElement
// 
// 'attr' is either 'visibilityOf' or 'relativeTo'
// 'type' may be:
//    - "id" for a fixed explicit area id
//    - "ref" for a content node reference holding the area references
//    - <undefined> when none is present 
//
RVPosPoint.prototype.setElement = rVPosPointSetElement;
function rVPosPointSetElement(attr, type, val)
{
    var elem = this.elem[attr];
    assert(typeof(elem) === "object");

    if ((elem.type === type) && (elem.val === val)) {
        // nothing changed
        return;
    }

    this.cleanElement(attr);
    elem.type = type;
    elem.val = val.getElement();

    if (typeof(type) === "undefined") {
        // nothing to do
    } else if (type === "id") {
        this.addIdRef(attr, "id", elem.val);
    }
}

// --------------------------------------------------------------------------
// cleanElement
//
RVPosPoint.prototype.cleanElement = rVPosPointCleanElement;
function rVPosPointCleanElement(attr)
{
    var elem = this.elem[attr];
    if (typeof(elem) === "undefined") {
        return;
    }

    if (typeof(elem.type) === "undefined") {
        // nothing to do
    } else if (elem.type === "id") {
        this.removeIdRef(attr, "id", elem.val);
    }

    delete elem.type;
    delete elem.val;
}

// --------------------------------------------------------------------------
// addIdRef
// 
// increment the reference count for a areaId
// if this is the first encounter with the areaId, call 'addId'
//
RVPosPoint.prototype.addIdRef = rVPosPointAddIdRef;
function rVPosPointAddIdRef(attr, ident, areaId)
{
    var elemId = this.elem[attr].id;

    var areaIdEntry = elemId[areaId];

    if (typeof(areaIdEntry) === "undefined") {
        areaIdEntry = elemId[areaId] = {};
        this.addId(attr, areaId);
    }

    assert(!(ident in areaIdEntry));
    areaIdEntry[ident] = true;
}

// --------------------------------------------------------------------------
// removeIdRef
// 
// decrement the reference count for a areaId
// if it reaches 0, call 'removeId'
//
RVPosPoint.prototype.removeIdRef = rVPosPointRemoveIdRef;
function rVPosPointRemoveIdRef(attr, ident, areaId)
{
    var elemId = this.elem[attr].id;

    var areaIdEntry = elemId[areaId];

    assert(typeof(areaIdEntry) !== "undefined");

    assert(ident in areaIdEntry);

    delete areaIdEntry[ident];

    if (isEmptyObj(areaIdEntry)) {
        delete elemId[areaId];
        this.removeId(attr, areaId);
    }
}

// --------------------------------------------------------------------------
// addId
// 
// add a areaId as a match for 'attr'
//
RVPosPoint.prototype.addId = rVPosPointAddId;
function rVPosPointAddId(attr, areaId)
{
    this.addRemoveId(true, attr, areaId);
}

// --------------------------------------------------------------------------
// removeId
// 
// remove a areaId from 'attr' match-list
//
RVPosPoint.prototype.removeId = rVPosPointRemoveId;
function rVPosPointRemoveId(attr, areaId)
{
    this.addRemoveId(false, attr, areaId);
}

// --------------------------------------------------------------------------
// addRemoveId
// 
// add or remove (depending on 'isAdd') a areaId from the set of matches
//   of 'attr'.
// Call addAreaPair()/removeAreaPair() on the added/removed id against all
//  current matches for the other attribute.
//
RVPosPoint.prototype.addRemoveId = rVPosPointAddRemoveId;
function rVPosPointAddRemoveId(isAdd, attr, areaId)
{
    var otherAttr = (attr === "relativeTo") ? "visibilityOf" : "relativeTo";

    var otherElemId = this.elem[otherAttr].id;

    var visibilityOf;
    var relativeTo;

    if (attr === "visibilityOf") {
        visibilityOf = areaId;
    } else {
        relativeTo = areaId;
    }

    for (var otherAreaId in otherElemId) {
        if (attr === "visibilityOf") {
            relativeTo = otherAreaId;
        } else {
            visibilityOf = otherAreaId;
        }
        if (isAdd) {
            this.addAreaPair(visibilityOf, relativeTo);
        } else {
            this.removeAreaPair(visibilityOf, relativeTo);
        }
    }

    this.posPoint.applyChanges();
}

// loop over all the area pairs currently defined and add them all.

RVPosPoint.prototype.createAllLabels = rvPosPointCreateAllLabels;

function rvPosPointCreateAllLabels()
{
    for(var baseId in this.elem.visibilityOf.id) {
        for(var frameId in this.elem.relativeTo.id) {
            this.addAreaPair(baseId, frameId);
        }
    }
        
    this.posPoint.applyChanges();
}

// loop over all the area pairs currently defined and remove them all.

RVPosPoint.prototype.removeAllLabels = rvPosPointRemoveAllLabels;

function rvPosPointRemoveAllLabels()
{
    for(var baseId in this.elem.visibilityOf.id) {
        for(var frameId in this.elem.relativeTo.id) {
            this.removeAreaPair(baseId, frameId);
        }
    }
}

// This function is called when a pair of areas (baseId, frameId) is
// added to the list of relative visibility points defined by this object.
// This function first checks whether this pair is simple
// or not (see explanation in the introduction) and if it is simple,
// whether the label for this pair is degenerate
// or not. It then adds the required label to the PosPoint object.
// If the label is not degenerate, this function also requests the
// creation of the automatic constraints defining the position of the
// relative visibility point.
// If 'dontAddContentRegistration' is true, this function will not try
// to add a registration for this pair (if it is simple) to receive
// notification on content positioning mode changes. This should be used
// when the 'addAreaPair' immediately follows a 'removeAreaPair'.

RVPosPoint.prototype.addAreaPair = rvPosPointAddAreaPair;

function rvPosPointAddAreaPair(baseId, frameId, dontAddContentRegistration)
{
    // is this a simple pair?
    var isSimple = this.isSimple(baseId, frameId);
    
    if(!this.includeFrame && baseId != frameId) {
        // if not already monitoring the embedding of this base, record a
        // monitoring request
        if(this.embeddingChangeRequests[baseId] === undefined) {
            this.embeddingChangeRequests[baseId] =
                  allAreaMonitor.addAreaSpecificCallBack("change", baseId,
                                                    this, this.updateEmbedding);
        }
    }

    var baseArea = allAreaMonitor.getAreaById(baseId);

    // if a simple pair, is the label degenerate
    var isDegenerate =
        isSimple && !baseArea.isInIndependentContentPositionMode();
    
    // generate the label
    // In the degenerate case, we need a frame label if in zero offset mode
    // and a content label if in automatic offset mode.
    if (typeof(this.type) !== "undefined") {
        var label = isDegenerate ?
            edgeLabel(baseArea, this.type,
                      !baseArea.isInZeroContentOffsetMode()) :
            rvLabel(baseId, frameId, this.type, this.includeFrame);
    
        this.posPoint.addLabel(label);
    }

    var requestId;

    if(!isDegenerate && (typeof(this.type) !== "undefined"))
        // add the automatic constraints defining the position of this point
        // this returns a pair [<label>, <id>] which is the request ID
        requestId = baseArea.allPosConstraints.
            addRVPointConstraints(label, frameId, this.type,
                                  this.includeFrame, isSimple);
    else
        requestId = [label, undefined];

    // store the request ID
    if(!this.labels[baseId])
        this.labels[baseId] = {};

    this.labels[baseId][frameId] = requestId;

    if(isSimple && !dontAddContentRegistration)
        this.registerToContentPosModule(baseId, frameId);
}

// This function is called when a pair of areas (baseId, frameId) is
// removed from the list of relative visibility points defined by this object.
// This function removes the label registered for this pair from the list
// of point labels and cancels the request to generate the automatic
// constraints for this point.
// If 'dontRemoveContentRegistration' is true, this function will not try
// to cancel any registration made for this pair to receive notification
// for content positioning mode changes. This should be used when the
// 'removeAreaPair' is immediately followed by a 'addAreaPair'.

RVPosPoint.prototype.removeAreaPair = rvPosPointRemoveAreaPair;

function rvPosPointRemoveAreaPair(baseId, frameId,
                                  dontRemoveContentRegistration)
{
    if(!this.labels[baseId])
        return; // nothing to remove
    
    // get the request ID for this pair
    var requestId = this.labels[baseId][frameId];

    if(!requestId)
        return;

    var label = requestId[0];
    
    if(requestId[1] !== undefined) {
        // not degenerate, so cancel request for automatic constraints
        
        var baseArea = allAreaMonitor.getAreaById(baseId);

        if(baseArea)
            baseArea.allPosConstraints.
                removeAutomaticPointConstraints(requestId);
    }
    
    this.posPoint.removeLabel(label);
    
    // clear the entry from the labels table
    delete this.labels[baseId][frameId];
    if(isEmptyObj(this.labels[baseId])) {

        delete this.labels[baseId];
        
        if(this.embeddingChangeRequests) {
            var embeddingRequestId = this.embeddingChangeRequests[baseId];
            if(embeddingRequestId !== undefined)
                allAreaMonitor.removeAreaSpecificCallBack("change",
                                                            embeddingRequestId);
            delete this.embeddingChangeRequests[baseId];
        }
    }

    if(!dontRemoveContentRegistration)
        this.unregisterFromContentPosModule(baseId, frameId);
}

// This function is called by the embedding change monitor when the
// embedding of an area changed (for an area for which such notifications
// were requested by this object). The function then checks whether
// this makes any simple pairs non-simple or the other way around.
// If the content position mode of the base area is not "independent"
// then this requires the label associated with the pair to be changed
// (from degenerate to standard or the other way around). This also results
// in an update (addition/removal) of the coresponding automatic constraints.
// If the content position mode is "independent" then the label does not
// need to change, but the automatic constraints module needs to be notified
// (as the constraints for a simple and a non-simple pair differ).

RVPosPoint.prototype.updateEmbedding = rvPosPointUpdateEmbedding;
function rvPosPointUpdateEmbedding(embeddingRequestId, opaque, areaId,
                                   prevEmbeddingId, embeddingId) {
    if(prevEmbeddingId == embeddingId)
        return; // no change (should probably never happen)

    // entry for pair with the previous embedding area as frame (if exists) 
    var requestId = this.labels[areaId][prevEmbeddingId];

    var baseArea;
    
    // check whether (base area, previous embedding) is a registered pair
    // label.
    if(prevEmbeddingId && requestId) {
        // This pair was a simple pair and has now become a non-simple pair.

        // remove the registration for content position mode updates
        // (if it is no longer needed by other pairs)
        this.unregisterFromContentPosModule(areaId, prevEmbeddingId);
        
        // If the label was degenarate, the pair should be removed and
        // added again. Otherwise, we are in "independent" content positioning
        // mode and the label remains unchanged but the automatic
        // constraints module needs to be notified of the change
        if(requestId[1] === undefined) {
            // this label was degenarate, so the pair should be removed and
            // added again
            this.removeAreaPair(areaId, prevEmbeddingId, false);
            this.addAreaPair(areaId, prevEmbeddingId, false);
        } else {
            baseArea = allAreaMonitor.getAreaById(areaId);
            if(baseArea)
                baseArea.allPosConstraints.
                    updateRVPointSimplicity(requestId[0], false);
        }
    }

    // entry for pair with the new embedding area as frame (if exists) 
    requestId = this.labels[areaId][embeddingId];
    
    // check whether (base area, new embedding) is a registered pair
    // label.
    if(embeddingId && requestId) {
        // this pair was non-simple and now became simple.

        // add a registration for content position mode updates
        this.registerToContentPosModule(areaId, embeddingId);

        baseArea = allAreaMonitor.getAreaById(areaId);
        if(!baseArea)
            return; // perhaps in the process of being destroyed
        
        if(!baseArea.isInIndependentContentPositionMode()) {
            // the new label is degenerate, need to remove the pair and
            // add it back again.
            this.removeAreaPair(areaId, prevEmbeddingId, false);
            this.addAreaPair(areaId, prevEmbeddingId, false);
        } else {
            // tell the automatic positioning module to update the constraints
            baseArea.allPosConstraints.
                updateRVPointSimplicity(requestId[0], true);
        }
    }

    this.posPoint.applyChanges();
}

//
// Content Position Mode Handling
//

// This function return true if the given base and frame form a simple
// pair.

RVPosPoint.prototype.isSimple = rvPosPointIsSimple;

function rvPosPointIsSimple(baseId, frameId)
{
    return baseId == frameId ||
           (!this.includeFrame &&
            (frameId == RVPosPoint.getEmbeddingId(baseId)));
}

// This function registers this point to receive notifications for any
// change in the content positioning mode of the given base area.
// The function first checks whether the given pair is simple, and if it is,
// performs the registration.

RVPosPoint.prototype.registerToContentPosModule =
    rvPosPointRegisterToContentPosModule;

function rvPosPointRegisterToContentPosModule(baseId, frameId)
{
    if(!this.isSimple(baseId, frameId))
        return;
    
    if(this.uid === undefined) // if this is the first time, generate an ID
        this.uid = this.getNextUid();
    
    var baseArea = allAreaMonitor.getAreaById(baseId);

    if(baseArea)
        baseArea.contentPosManager.registerAllModeChange("rvPoint", this.uid,
                                                         this);
}

// This function unregisters a registration for content position mode
// notification if such a registration was made for the pair (baseId, frameId)
// and if this is the only pair with the same base ID which requires
// such a registration. A pair requires such a registration iff it is
// simple. A pair is simple if base ID is equal to frame ID or if
// 'includeFrame' is false and frame ID is the direct embedding area
// of area ID.

RVPosPoint.prototype.unregisterFromContentPosModule =
    rvPosPointUnregisterFromContentPosModule;

function rvPosPointUnregisterFromContentPosModule(baseId, frameId)
{
    if(!this.isSimple(baseId, frameId))
        return; // not a simple pair, nothing to do

    // check whether there is another pair with the same base ID which
    // requires this registration (there are two cases where a pair is
    // simple: baseId == frameId and frameId == embedding(baseId), one of
    // them is being remove here, we need to check that the other doesn't
    // exist

    var frameIds = this.labels[baseId];

    if(frameIds) {
        if(baseId != frameId) {
            if(frameIds[baseId])
                // the pair (baseId, baseId) still needs the registration
                return;
        } else if(!this.includeFrame) {
            var embeddingId = RVPosPoint.getEmbeddingId(baseId);

            if(embeddingId && frameIds[embeddingId])
                // the pair (baseId, embedding(baseId)) still needs
                // the registration
                return;
        }
    }

    // remove the registration
    var baseArea = allAreaMonitor.getAreaById(baseId);

    if(baseArea)
        baseArea.contentPosManager.
            unregisterAllModeChange("rvPoint", this.uid);
}

// This function is called when the content position mode of an area, which
// is the base area of some simple pair of this RV point, has changed.
// The function receives as arguments the ID of the base area and the
// modes before and after the change (these can be "zero", "auto" or
// "independent"). The function then finds simple pair(s) with the given
// area as base and updates their labels. Since the pair is simple,
// any mode change also changes the label (in "independent" mode the label
// is a relative visibility label, in "auto" mode it is the content edge
// label and in "zero" (zero-offset) mode it is the frame label). This
// function therefore calls 'removeAreaPair' and 'addAreaPair' for these
// pairs.

RVPosPoint.prototype.contentOffsetModeChange =
    rvPosPointContentOffsetModeChange;

function rvPosPointContentOffsetModeChange(baseId, prevMode, newMode)
{
    // find the simple pairs for this base area 

    var frameIds = this.labels[baseId];

    if(!frameIds)
        return;

    if(frameIds[baseId]) {
        this.removeAreaPair(baseId, baseId, false);
        this.addAreaPair(baseId, baseId, false);
    }

    if(!this.includeFrame) {
        // check whether this base area appears in a pair where the frame
        // is the embedding area
        var embeddingId = RVPosPoint.getEmbeddingId(baseId);
        if(frameIds[embeddingId]) {
            this.removeAreaPair(baseId, embeddingId, false);
            this.addAreaPair(baseId, embeddingId, false);
        }
    }

    this.posPoint.applyChanges();
}

RVPosPoint.getEmbeddingId = rvPosPointGetEmbeddingId;
function rvPosPointGetEmbeddingId(areaId) {
    var embeddingRef = areaRelationMonitor.getEmbeddingId(areaId);

    return embeddingRef === undefined? undefined: embeddingRef.getElement();
}
