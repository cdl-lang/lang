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


// This file implements the "bottom" part of the function result interface
// for ordering function nodes. This object registers on the data object
// to which the ordering function should be applied and receives
// the add/remove match updates from that object. It is then responsible
// for constructing the tree which tracks the ordering of those elements
// (based on the comparison function defined for the data, which is
// also received through the data object).
//
// Multiple ordering functions applied to the same data object will share
// a single OrderService object. To construct an ordering function,
// external modules should create an OrderResult object (or an object
// derived from the OrderResult class). This OrderResult object should then
// be composed with the data object to which it should be applied.
// An OrderService node would then be created automitically and pushed
// between the OrderResult object and the data object it is applied to
// so as to provide the required ordering functionality.
//
// The OrderService object is derived from the FuncResult class. The
// OrderResult objects are stored as composed functions on this node
// (and when they become active*, as active composed functions).
// The OrderResult objects do not have the isOrder() functon return true.
// Rather, it is the OrderService object which sets has 'isOrder()'
// return true. This makes the order service the target for ordering
// information from dominated nodes (this information is then propagated
// to the OrderResult nodes through the 'OrderRequirement' interface
// (see below).
//
// Order Requirements
// ------------------
//
// xxxxxxxxxxxxxxxxxxxx
// 
//
// Object Structure
// ----------------
//
// {
//     orderTree: <PartialOrderTree>,
//     rangeRequirements: <Map>{
//         <result ID>: <RangeOrderRequirement>,
//         ......
//     }
//
//     forwardElementRequirements: <Map>{
//         <element ID>: <ElementOrderService>
//         .....
//     }
//     backwardElementRequirements: <Map>{
//         <element ID>: <ElementOrderService>
//         .....
//     }
//
//     pendingMatchUpdates: <array of objects:
//            {
//                elementIds: <array of element IDs>,
//                source: <the source of the data>
//                isAdd: true|false
//            }
//     >
//     refreshQueued: true|false
// }
//
// orderTree: this field stores the PartialOrderTree object which is
//    responsible for sorting the elements based on the comparison
//    function received from the data object and (through the registration
//    of order requirements) notify the composed order results of changes
//    in their matches.
// rangeRequirements: this is a table holding the range requirement
//    objects created and registered to the order tree. Each requirement
//    object is stored under the ID of the order result object which is
//    its listener (and defines its properties).
//
// forwardElementRequirements: this table holds an entry for each element ID
//    for which a forward index order result is registered to this
//    order service. The ElementOrderService under it stores the
//    requirement object registered to the order tree, the result objects
//    which are the listeners of this requirement and properties which
//    determine the properties with which the requirement is registered.
// backwardElementRequirements: this is the same as forwardElementRequirements
//    only for index order results which are defined in the backward
//    ordering.
//
// pendingMatchUpdates: this is an array which is used to queue
//    add/remove matches updates while the the order service is suspended
//    (the order service is suspended when it waits for the comparison
//    functions to be ready - to avoid sorting and then re-sorting once
//    the compariosn function is ready). This array stores an object
//    for each update received. The object consists of the array of
//    element IDs received through the update, a pointer to their source
//    (function result node) and a flag indicating whether the elements
//    were added or removed.
//    The existence of the 'pendingMatchUpdates' array serves as an
//    indication that the order service is suspended.
// refreshQueued: this flag is set to true when the order service is
//    set on the indexer queue. While on the queue, the order service
//    is suspended and it is unsuspended when it reaches its turn on the
//    queue.

// %%include%%: "funcResult.js"
// %%include%%: "elementOrderService.js"
// %%include%%: <scripts/utils/trees/partialOrder.js>

inherit(OrderService, FuncResult);

//
// Constructor
//

// The constructor initializes the order tree with an undefined comparison
// function. The comparison will have to be set before the first elements
// are added to the order tree.

function OrderService(internalQCM)
{
    this.FuncResult(internalQCM);
    this.orderTree = new PartialOrderTree(undefined, undefined);
    this.rangeRequirements = new Map();
    this.forwardElementRequirements = new Map();
    this.backwardElementRequirements = new Map();
    this.pendingMatchUpdates = undefined;
}

// Destroy this object

OrderService.prototype.destroy = orderServiceDestroy;

function orderServiceDestroy(orderResult)
{
    if(this.doDebugging)
        this.debugMessage("destroying order service ", this.id,
                          " over ",
                          (this.dataObj ? "dataObj " + this.dataObj.getId() :
                           "no dataObj "),
                          " with ", this.orderTree.getSize(), " elements");

    
    this.orderTree = undefined;
    // base class destructor
    this.FuncResult_destroy();
}

// The OrderService node is the result node which requires ordering
// information.

OrderService.prototype.isOrder = orderServiceIsOrder;

function orderServiceIsOrder()
{
    return true;
}

// The order service is never active (but becomes active* when active*
// functions are composed with it).

OrderService.prototype.isActive = orderServiceIsActive;

function orderServiceIsActive()
{
    return false;
}

// Returns the current size of the ordered set

OrderService.prototype.getSetSize = orderServiceGetSetSize;

function orderServiceGetSetSize()
{
    if(this.orderTree === undefined)
        return 0;

    return this.orderTree.getSize();
}

/////////////////////
// Indexer Refresh //
/////////////////////

// When the indexer and/or path change, this has no direct effect on the
// ordering. If the matches change as a result of this change, then
// it is the match updates which will result in changes to the ordering.
// If, in addition to the indexer change the dominated comparison also
// changed, a separate notification is received. Therefore, the only
// this this function need to do is forward this notification to the
// active* composed nodes.

OrderService.prototype.refreshIndexerAndPaths =
    orderServiceRefreshIndexerAndPaths;

function orderServiceRefreshIndexerAndPaths(dataObj)
{
    // clear the order tree (forwards the removals to the composed functions)
    this.removeAllMatches();
    
    // forward this update to the active* composed functions
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive)
            this.composedActive[resultId].refreshIndexerAndPaths(this);
}

// Just as in the case of refreshIndexerAndPaths(), this function
// only needs to forward this notification to the active* composed
// functions.

OrderService.prototype.replaceIndexerAndPaths =
    orderServiceReplaceIndexerAndPaths;

function orderServiceReplaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                            newIndexerContained, dataObj)
{
    // forward this update to the active* composed functions
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive) {
            this.composedActive[resultId].
                replaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                       newIndexerContained, this);
        }
}

/////////////////////////////////
// Activation and Deactivation //
/////////////////////////////////

// This deactivation function overrides the standard implementation,
// which is called at the end of this function. In addition to the standard
// implementation, this function also clears ll matches from the order tree
// (in case this order service is re-activated).

OrderService.prototype.deactivated = orderServiceDeactivated;

function orderServiceDeactivated()
{
    if(this.composedActiveNum > 0)
        return; // still active*

    // remove all elements still stored in the order tree (but no notifications
    // need to be sent).
    this.orderTree.removeAllElements();

    // perform standard deactivation (propagation to the data object).
    this.FuncResult_deactivated();
}

//////////////////////////////////
// Order Refresh and Suspension //
//////////////////////////////////

// This function is called when the order service becomes active*.
// If there is some comparison function dominated by this order service
// and this compariosn function is not yet order* (it is about to
// become order* since this order service dominates it, is an order node
// and is now also active*) this order service has to wait for the
// comparison function to be properly initialized. The order service
// must therefore be suspended and wait for its order refresh.

OrderService.prototype.becameActiveStar = orderServiceBecameActiveStar;

function orderServiceBecameActiveStar()
{
    var compInfo = this.dataObj.getDominatedComparison();

    if(compInfo === undefined) {
        // no comparison, so can unsuspend immediately
        this.unsuspend();
        return;
    }

    this.suspend();
}

// When the order service is notified of a refresh in the ordering,
// it must refresh the order of the elements in the order tree.
// However, since some updates to the comparison functions may still
// be queued (as query registrations and other queued operation may be involved)
// this function queues the refresh instead of carrying it out immediately.
// The refresh is only queued once, if it is already queued, it will not
// be queued again.
// In addition to refreshing itself, this object must also forward
// the refresh to any order* composed nodes (this is performed by the
// base class version of this function).

OrderService.prototype.refreshOrdering = orderServiceRefreshOrdering;

function orderServiceRefreshOrdering()
{
    if(!this.refreshQueued) {
        // not yet queued
        this.suspend();
    }

    // forward the refresh to dominating nodes (if needed)

    this.FuncResult_refreshOrdering();
}

// This function indicates whether the order service is currently
// suspended (which means that it buffers any match updates and
// waits until it can re-order the existing matches and add/remove
// the updates). The order service is suspended while waiting for the
// comparison functions to be ready.

OrderService.prototype.isSuspended = orderServiceIsSuspended;

function orderServiceIsSuspended()
{
    return (this.pendingMatchUpdates !== undefined);
}

// This function suspends the order service. This means that a buffer is
// created to store match updates received so that they can be processed
// when the order service is unsuspended.

OrderService.prototype.suspend = orderServiceSuspend;

function orderServiceSuspend()
{
    if(this.pendingMatchUpdates === undefined)
        this.pendingMatchUpdates = [];

    if(this.refreshQueued)
        return; // already queued

    this.qcm.scheduleOrderService(this);
}

// This function unsuspends the order service. It reads the new comparison
// function, re-orders existing elements in the order tree (using the new
// comparison function) and then applies all match updates (added/removed)
// which were received while the order service was suspended.

OrderService.prototype.unsuspend = orderServiceUnsuspend;

function orderServiceUnsuspend()
{
    var notify = false;

    if(this.destroyed)
        return;
    
    // set the comparison function and reorder the elements already in the tree
    this.setCompareFunc();
    if(this.orderTree.getSize() > 1) {
        this.orderTree.refreshOrder();
        notify = true;
    }

    if(this.doDebugging)
        this.debugMessage("refreshing order service ", this.id,
                          " over ",
                          (this.dataObj ? "dataObj " + this.dataObj.getId() :
                           "no dataObj "),
                          " existing elements: ", this.orderTree.getSize());
    
    var pending = this.pendingMatchUpdates;
    this.pendingMatchUpdates = undefined;

    if(pending !== undefined && pending.length > 0) {

        notify = true;
        
        for(var i = 0, l = pending.length ; i < l ; ++i) {
            var update = pending[i];
            if(update.isAdd)
                this.doAddMatches(update.elementIds, update.source);
            else
                this.doRemoveMatches(update.elementIds, update.source);
        }
    }
    
    this.refreshOrderResults(); // propagate changes to composed order results
}

///////////////////
// Match Updates //
///////////////////

// This function is called to notify the order service that the elements
// whose IDs are in the array 'elementIds' have been added to the data
// whose ordering the order service needs to track. The order service
// then adds them to the order tree and when this operation has been completed,
// tells the order tree to notify the owners of the requirements registered
// to the order tree.
// Before the matches are added, the comparison function is re-constructed,
// in case some changes took place (e.g. nodes which need to be raised
// have been added to the data).

OrderService.prototype.addMatches =
    orderServiceAddMatches;

function orderServiceAddMatches(elementIds, source)
{
    if(!this.isActiveStar())
        // not yet active*, so need to queue the update for later 
        this.suspend();
    
    if(this.isSuspended()) {
        this.pendingMatchUpdates.push({
            elementIds: elementIds,
            source: source,
            isAdd: true
        });
        return;
    }
    
    // construct the up-to-date comparison function before using it in
    // the addition of elements (below)
    this.setCompareFunc();

    this.doAddMatches(elementIds);

    this.refreshOrderResults(); // propagate changes to composed order results
}

// This function may occasionally be called, but is essentially the same
// as 'addMatches()'.

OrderService.prototype.addProjMatches =
    orderServiceAddProjMatches;

function orderServiceAddProjMatches(elementIds, resultId, projId)
{
    this.addMatches(elementIds, this.dataObj);
}

// This function implements the actual addition of the elements to the
// order tree, without updating the comparison function or notifying
// the listeners. This allows this function to be used inside a
// repeated call to add matches.

OrderService.prototype.doAddMatches =
    orderServiceDoAddMatches;

function orderServiceDoAddMatches(elementIds)
{
    if(this.doDebugging)
        this.debugMessage("adding ", elementIds.length,
                          " elements to order service ", this.id);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i)
        this.orderTree.insertElement(elementIds[i]);
}

// This function is called to notify the order service that the elements
// whose IDs are in the array 'elementIds' have been removed from the data
// whose ordering the order service needs to track. The order service
// then removes them from the order tree and when this operation has been
// completed, tells the order tree to notify the owners of the requirements
// registered to the order tree.
// Here, as opposed to adding matches, there is no need to reconstruct
// the comparison function, since we can use the same function used to
// add the matches (if the comparison function for existing elements
// changed, this should have been handled through a 'refreshOrdering()'
// call.

OrderService.prototype.removeMatches =
    orderServiceRemoveMatches;

function orderServiceRemoveMatches(elementIds, source)
{
    if(this.isSuspended()) {
        this.pendingMatchUpdates.push({
            elementIds: elementIds,
            source: source,
            isAdd: false
        });
        this.unsuspend();
        return; 
    }

    this.doRemoveMatches(elementIds);
    
    this.refreshOrderResults(); // propagate changes to composed order results
}

// This function may occasionally be called, but is essentially the same
// as 'addMatches()'.

OrderService.prototype.removeProjMatches =
    orderServiceRemoveProjMatches;

function orderServiceRemoveProjMatches(elementIds, resultId, projId)
{
    this.removeMatches(elementIds, this.dataObj);
}

// This function implements the actual addition of the elements to the
// order tree, without updating the comparison function or notifying
// the listeners. This allows this function to be used inside a
// repeated call to add matches.

OrderService.prototype.doRemoveMatches =
    orderServiceDoRemoveMatches;

function orderServiceDoRemoveMatches(elementIds)
{
    if(this.doDebugging)
        this.debugMessage("removing ", elementIds.length,
                          " elements from order service ", this.id);

    for(var i = 0, l = elementIds.length ; i < l ; ++i)
        this.orderTree.removeElement(elementIds[i]);

}


// This function is called to notify the order service that the all
// elements have been removed from the data whose ordering the order
// service needs to track. The order service then notifies the order
// tree that all elements should be cleared. When this operation has
// been completed, this function tells the order tree to notify the
// owners of the requirements registered to the order tree.

OrderService.prototype.removeAllMatches =
    orderServiceRemoveAllMatches;

function orderServiceRemoveAllMatches(source)
{
    this.orderTree.removeAllElements();
    this.refreshOrderResults(); // propagate changes to composed order results
}

//////////////////////////////////
// Refresh of Dominated Results //
//////////////////////////////////

// Since a single refresh of the order tree (a call to 'notifyListeners()')
// may generate multiple update calls for the same composed order result,
// the order service notifies all composed order results once such a refresh
// has been completed (that is, orderTree.notifyListeners() was called).
// Composed order results which wish to do so can make use of this notification
// to push updates to their own composed functions.
// This function therefore pakages together these two operations: it
// calls 'notifyListeners()', which causes all updates in the requirements
// registered to the ordered tree to be pushed to the order results which
// are registered as listeners on those requirement. Then, it notifies
// all composed order results that all updates have been sent and that
// they can propagate these updates further (an order result may choose not
// to wait for this call but immediately propagate the updates received
// from the order requirements).

OrderService.prototype.refreshOrderResults = orderServiceRefreshOrderResults;

function orderServiceRefreshOrderResults()
{
    this.orderTree.notifyListeners();

    for(var resultId in this.composedActive) {
        var result = this.composedActive[resultId];
        result.allNotificationsReceived();
    }
}

////////////////////////////////////
// Access to Dominated Properties //
////////////////////////////////////

// This object is transparent to this property: simply return the value
// returned by the data object (or undefined if there is no data object).

OrderService.prototype.getDominatedIndexer =
    orderServiceGetDominatedIndexer;

function orderServiceGetDominatedIndexer()
{
    if(this.dataObj === undefined)
        return undefined;
    
    return this.dataObj.getDominatedIndexer();
}

// This object is transparent to this property: simply return the value
// returned by the data object (or undefined if there is no data object).

OrderService.prototype.getDominatedProjPathId =
    orderServiceGetDominatedProjPathId;

function orderServiceGetDominatedProjPathId()
{
    if(this.dataObj === undefined)
        return undefined;
    
    return this.dataObj.getDominatedProjPathId();
}

// This object is transparent to this property (which anyway should
// always be 1): simply return the value returned by the data object
// (or undefined if there is no data object).

OrderService.prototype.getDominatedProjPathNum =
    orderServiceGetDominatedProjPathNum;

function orderServiceGetDominatedProjPathNum()
{
    if(this.dataObj === undefined)
        return undefined;
    
    return this.dataObj.getDominatedProjPathNum();
}

// The terminal projection matches are the dominated matches of the data object.

OrderService.prototype.getTerminalProjMatches =
    orderServiceGetTerminalProjMatches;

function orderServiceGetTerminalProjMatches(projId)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.getDominatedMatches();
}

// The terminal projection matches are the dominated matches of the data object.

OrderService.prototype.filterTerminalProjMatches =
    orderServiceFilterTerminalProjMatches;

function orderServiceFilterTerminalProjMatches(projId, elementIds)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.filterDominatedMatches(elementIds);
}

// Since no matches are communicated between this and the composed nodes
// (OrderResult nodes) this objects has a match count of 0 (this ensures
// that also FuncResult base functions do not try to update matched of
// the composed functions through the standard inerface).

OrderService.prototype.getDomMatchCount =
    orderServiceGetDomMatchCount;

function orderServiceGetDomMatchCount()
{
    return 0;
}

// this function should never be called, since this node is only dominated
// by OrderResult objects which have a different interface for match updates.

OrderService.prototype.getDominatedMatches =
    orderServiceGetDominatedMatches;

function orderServiceGetDominatedMatches()
{
    assert(false, "this function should never be called");
}

// this function should never be called, since this node is only dominated
// by OrderResult objects which have a different interface for match updates.

OrderService.prototype.getDominatedMatchesAsObj =
    orderServiceGetDominatedMatchesAsObj;

function orderServiceGetDominatedMatchesAsObj()
{
    assert(false, "this function should never be called");
}

// this function should never be called, since this node is only dominated
// by OrderResult objects which have a different interface for match updates.

OrderService.prototype.filterDominatedMatches =
    orderServiceFilterDominatedMatches;

function orderServiceFilterDominatedMatches(elementIds)
{
    assert(false, "this function should never be called");
}

// this function should never be called, since this node is only dominated
// by OrderResult objects which have a different interface for match updates.

OrderService.prototype.filterDominatedMatchPositions =
    orderServiceFilterDominatedMatchPositions;

function orderServiceFilterDominatedMatchPositions(elementIds)
{
    assert(false, "this function should never be called");
}

// This object is transparent to this property: simply return the value
// returned by the data object (or undefined if there is no data object).

OrderService.prototype.getDominatedIdentification =
    orderServiceGetDominatedIdentification;

function orderServiceGetDominatedIdentification()
{
    if(this.dataObj === undefined)
        return undefined;
    
    return this.dataObj.getDominatedIdentification();
}

///////////////////////////////////////////
// Adding and Removing OrderResult Nodes //
///////////////////////////////////////////

// This function adds the given result node to the list of OrderResult nodes
// which make use of this order service.

OrderService.prototype.addOrderResult = orderServiceAddOrderResult;

function orderServiceAddOrderResult(orderResult)
{
    // call the base class function
    this.addComposedFunc(orderResult);
}

// This function is called when the OrderResult node 'orderResult' is
// about to be added as an active* composed node to this order service.
// It may be that 'orderResult' was already registered as composed
// but not as composed active* or it may be that 'orderResult' was just
// added as a composed function (and happened to be active*).
// 'wasActiveStar' indicates whether this OrderService node was active*
// before 'orderResult' was added as composed active*.
// This function tells the orderResult object to register it requirements
// to the order service.

OrderService.prototype.aboutToAddActiveComposed =
    orderServiceAboutToAddActiveComposed;

function orderServiceAboutToAddActiveComposed(orderResult, wasActiveStar)
{
    // the order result object should now register its ordering
    // requirements to the order service
    orderResult.registerToOrderService();
}

// Remove the given order result from the list of order results 
// which make use of this order service node. The function returns
// true if there are still order results making use of this order
// service node and false if there are no more such order results.

OrderService.prototype.removeOrderResult = orderServiceRemoveOrderResult;

function orderServiceRemoveOrderResult(orderResult)
{
    this.removeComposedFunc(orderResult.getId());
    return (this.getNumComposedFuncs() != 0);
}

//////////////////////////////
// Requirement Registration //
//////////////////////////////

////////////////////////////////////
// Range Requirement Registration //
////////////////////////////////////

// Returns a range requirement object for the given 'orderResult' object,
// which must be a RangeOrderResult object. If there is an existing
// requirement object for 'orderResult', it is returned (it must be a
// range order result, since 'orderResult' cannot change its type to
// a different sort of order result). If no requirement is yet registered
// for 'orderResult', a new object is created and 'orderResult' is set as
// its listener.

OrderService.prototype.getRangeRequirement =
    orderServiceGetRangeRequirement;

function orderServiceGetRangeRequirement(orderResult)
{
    var resultId = orderResult.getId();
    if(this.rangeRequirements.has(resultId))
        return this.rangeRequirements.get(resultId);

    var requirement = new RangeOrderRequirement(this.orderTree);
    requirement.addListener(orderResult);
    this.rangeRequirements.set(resultId, requirement);

    return requirement;
}

// This function is called by a RangeOrderResult object which is already
// registered to this order service in order to register its ordering
// requirements. This may be called either for the initial registration
// for this RangeOrderResult object or to refresh an existing registration.
// This function first checks whether a requirement is already registered
// for this RangeOrderResult object. If not, a requirement object is created
// for it and otherwise the existing requirement object is updated.
// 'rangeOrderResult' is the RangeOrderResult object which called this function
// and which needs to be registered as a listener of the requirement
// created or modified here. 'isComplement' is true if a complement
// requirement should be created (a requirment whose range is defined by
// one forward offset and one backward offset) or a simple range requirement.
// If a simple range requirement is needed, 'isBackward' indicates whether
// the range is defined by forward or backward offsets. 'offsets' is
// an array of two non-negative integers defining the range. If 'isComplement'
// is true, the first of these offsets is a forward offset and the second
// a backward offset. If 'isComplement' is false, both offsets are forward
// or backward, as indicated by 'isBackward'. 'lowOpen' and 'highOpen'
// are both booleans indicating whether the range defined by the offsets
// is closed at its lower/high end (lwer/higher always defined relative to
// forward offsets). 'isOrderRange' indicates whether 'rangeOrderResult'
// needs to keep track of the ordering inside the range (if 'isOrderRange' is
// true) or not.

OrderService.prototype.registerRangeRequirement =
    orderServiceRegisterRangeRequirement;

function orderServiceRegisterRangeRequirement(rangeOrderResult,
                                              offsets, isComplement, isBackward,
                                              lowOpen, highOpen, isOrderRange)
{
    // get the requirement object. This may result in a new requirement
    // object being created if there is no existing requirement.
    var requirement = this.getRangeRequirement(rangeOrderResult);

    // set the range of the range requirement
    requirement.updateOffsets(offsets, isComplement, isBackward, lowOpen,
                              highOpen, isOrderRange);

    // force the requirement to update the listener
    requirement.notifyListeners();
}

// This function is called to remove the requirement registered for
// the given range order result node, 'orderResult'. The requirement is
// destroyed and removed from the list of requirements.

OrderService.prototype.unregisterRangeRequirement =
    orderServiceUnregisterRangeRequirement;

function orderServiceUnregisterRangeRequirement(orderResult)
{
    var resultId = orderResult.getId();

    if(!this.rangeRequirements.has(resultId))
        return; // no requirement to unregister

    var requirement = this.rangeRequirements.get(resultId);
    requirement.destroy();

    this.rangeRequirements.delete(resultId);
}

////////////////////////////////////
// Index Requirement Registration //
////////////////////////////////////

// This function is called by a IndexOrderResult object which is already
// registered to this order service in order to register its ordering
// requirement for the given element ID and ordering direction. This function
// checks whether there is already a ElementOrderService object which
// owns the requirement for the given element and ordering direction.
// If there is no such element order service object, the object is created.
// The index order result object is then added as a listener to the
// element order service (adding it will push the intial values to the
// result object).

OrderService.prototype.registerIndexRequirement =
    orderServiceRegisterIndexRequirement;

function orderServiceRegisterIndexRequirement(indexOrderResult, elementId,
                                              isBackward)
{
    var requirementService = isBackward ?
        this.backwardElementRequirements.get(elementId) :
        this.forwardElementRequirements.get(elementId);

    if(requirementService === undefined) {
        requirementService = new ElementOrderService(this.orderTree, elementId,
                                                     isBackward);
        if(!isBackward)
            this.forwardElementRequirements.set(elementId, requirementService);
        else
            this.backwardElementRequirements.set(elementId, requirementService);
    }

    // add this index order result to the list of listeners.
    requirementService.addResult(indexOrderResult);
}

// This function is called by a IndexOrderResult object which is
// registered to this order service in order to unregister its ordering
// requirement for the given element ID and ordering direction.
// This function finds the ElementOrderService object which owns the
// element requirement for the required element and ordering direction.
// It then removes the order result from the list of listeners for this
// requirement. If as a result of this operation there are no more listeners
// registered to the element order service, the element order service object
// is discarded (there is no need to destroy it, as the last removal
// performed all required removals).

OrderService.prototype.unregisterIndexRequirement =
    orderServiceUnregisterIndexRequirement;

function orderServiceUnregisterIndexRequirement(indexOrderResult, elementId,
                                                isBackward)
{
    var requirementService = isBackward ?
        this.backwardElementRequirements.get(elementId) :
        this.forwardElementRequirements.get(elementId);

    if(requirementService === undefined)
        return;

    // remove this index order result from the list of listeners.
    if(!requirementService.removeResult(indexOrderResult)) {
        // no remaining results registered for this element and direction,
        // can destroy the element order service.
        if(!isBackward)
            this.forwardElementRequirements.delete(elementId);
        else
            this.backwardElementRequirements.delete(elementId);
    }
}

////////////////////////////////////////////
// Fetching Information From Requirements //
////////////////////////////////////////////

// This function is called with a RangeOrderResult object which is registered
// to the order service. It then fetches from the requirement assigned to
// this RangeOrderResult the current set of matches for this range order
// result. The set is returned as an array of data element IDs.
// For the difference between this function and getOrderedRangeMatches()
// see the documentation of getOrderedRangeMatches().

OrderService.prototype.getRangeMatches =
    orderServiceGetRangeMatches;

function orderServiceGetRangeMatches(rangeOrderResult)
{
    var requirement = this.rangeRequirements.get(rangeOrderResult.getId());

    if(requirement === undefined)
        return []; // no matches

    return requirement.getMatches();
}

// This function is called with a RangeOrderResult object which is registered
// to the order service. It then fetches from the requirement assigned to
// this RangeOrderResult the current set of matches for this range order
// result. The set is returned as an array of data element IDs.
// The difference between this function and getRangeMatches() is the difference
// between getDominatedMatches() and getOrderedMatches() (see there for more
// details). In short:
// 1. getOrderedRangeMatches() returns the element IDs is order (if
//    the requirement was registered to track that order) while
//    getDominatedMatches() is not guaranteed to do so.
// 2. subsequent updates may not be fully incremental relative to
//    getOrderedRangeMatches() while addMatches()/removeMatches() updates
//    are guaranteed to be fully incremental relative to the matches
//    returned by getDominatedMatches().

OrderService.prototype.getOrderedRangeMatches =
    orderServiceGetOrderedRangeMatches;

function orderServiceGetOrderedRangeMatches(rangeOrderResult)
{
    var requirement = this.rangeRequirements.get(rangeOrderResult.getId());

    if(requirement === undefined)
        return []; // no matches

    return requirement.getOrderedMatches();
}

// This function is called with a RangeOrderResult object which is registered
// to the order service and a list (array) of element IDs. This function
// then checks which of the elements in 'elementIds' is in the range
// defined by 'rangeOrderResult'. It returns a (new) array with this
// subset of elements. The actual filtering is implemented by the
// range requirement object. The filtering is relative to the matches already
// reported by the requirement (and not those still pending).

OrderService.prototype.filterRangeMatches =
    orderServiceFilterRangeMatches;

function orderServiceFilterRangeMatches(rangeOrderResult, elementIds)
{
    var requirement = this.rangeRequirements.get(rangeOrderResult.getId());

    if(requirement === undefined)
        return []; // no matches

    return requirement.filterMatches(elementIds);
}


////////////////
// Comparison //
////////////////

// The comparison function is fetched from the CompInfo object received
// from the dominated node. It is then set on the comparison tree.
// If there is no dominated comparison, the default comparison is used
// (ordering by element IDs).

OrderService.prototype.setCompareFunc = orderServiceSetCompareFunc;

function orderServiceSetCompareFunc()
{
    // Get the comparison information
    var compInfo = this.dataObj.getDominatedComparison();

    if(compInfo === undefined)
        this.orderTree.updateCompareFunc(function(elementId1, elementId2) {
            return elementId1 - elementId2;
        });
    else
        this.orderTree.updateCompareFunc(compInfo.getCompareFunc());
}
