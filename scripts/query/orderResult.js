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


// This file implements the OrderResult object, which is a base class for
// all function result objects whose function is dependent on the ordering
// of the data. It is up to the derived class to implement the exact ordering
// function.
//
// The ordering function result node is actually split into two nodes.
// Each of them implements half of the function result interface:
// the OrderResult node implements the "upper" part of the interface
// (the interface that notifies the composed function of
// changes in the matches, indexer, projection path, etc.
// of the oordering function) while an OrderService object implements
// the "bottom" part of the interface (the interface that receives
// updates from the data object). The reason this is split is that
// several ordering functions registered on the same data object
// can share the same administration to calculate their result
// (since the ordering defined by the data object is the same for all
// the ordering functions).
//
// To construct an ordering function, external modules should create
// an OrderResult object (or an object derived from the OrderResult
// class). This OrderResult object should then be composed with the
// data object to which it should be applied, by calling
// <OrderResult>.setData(<data object>). The call to the setData function
// then gets/constructs the OrderService object which is actually
// composed with the data object. The OrderResult object is not composed
// with any data object as a function result node. Instead, it communicates
// with the ordering service node through a special interface (which
// is partially similar to the function result interface). 
//
// Order Tracking Interface
// ------------------------
//
// When an OrderResult object calculates an ordering function which is
// a selection (that is, the reult of the function is a subset of the
// input set based on ordering, such as the 'pos' functions) one can use
// the standard function result composition to composed additional
// functions with the ordering function. Such composed functions will
// receive the set of elements matched by the order function, but without
// their ordering (so composing with an order function which selects for
// positions 0-10 will receive the 11 elements at the given positions, but
// without beign able to determine the ordering among them). This makes
// incremental updates simple and is consistent with the standard
// function result interface.
//
// However, some modules may be interested in the ordering among the
// elements matched by an ordering function. For this purpose there is
// a separate interface, which is available only on 'selecting' order functions
// (that is, order function which produce a set of elements, and not,
// for example, on an order function which returns the positions (integers)
// of given elements in the set).
//
// A module wishing to receive these updates must register itself using the
// following function:
//
// <OrderResult>.addOrderTracing(<object which will receive the updates>)
//
// and to remove this registration one should call:
//
// <OrderResult>.removeOrderTracing(<object which receives the updates>)
//
// These tracing objects are considered to be 'active', which means that
// once at least one such object has been registered, the order result
// node also becomes active.
//
// Notifications will be received through calls to the following callback
// function, which should be defined on every object registered through
// the 'addOrderTracing()' function:
//
// <registered object>.updatePos(<element IDs>, <first offset>, <last offset>,
//                               <set size>)
//
// In this callback, <element IDs> is an ordered array of element IDs
// from offset <first offset> (including) to offset <last offset>
// in the ordered set. The offsets are always from the beginning of the
// ordered set (even if the OrderResult is defines in terms of
// offsets from the end of the ordered set). This set of elements is the
// set of elements whose position may have changed (some of the elements
// received here may remain in the same place they were before). The module
// which receives this notification may assume there were no changes
// outside of the range given (or that an additional notification will
// be received). In addition to the array of element IDs, the function
// also provides the current size of the ordered set. If only the
// set size changed and no element positions changed, <element IDs>,
// <first offset> and <last offset> will be undefined.
// The <set size> allows the receiver of this notification to do two things:
// 1. Detect the removal of elements from the range it is tracking as
//    a result of the ordered set shrinking below the offsets defined
//    by the order function. For example, if an order function defines
//    positions [4,59] and the size of the ordered set drops from
//    60 elements to 50 elements (as a result of removing the last 10 elements)
//    <element IDs> will be undefined (there are no element IDs who changed
//    their position) but by receiving the notification that the set size
//    decreased the receiving module can discard the last 10 elements.
// 2. When the offsets were originally specified in terms of backward
//    offsets (offsets from the end of the ordered set) knowing the
//    set size allows the forward offsets provided in the callback to
//    be translated into backward offsets.
// This function will be called with the full range of matches upon
// the registration of the order tracing object. 
//
// Immediately after registering an order tracing object, that object should
// pull the initial list of matching elements (because if this is not
// the first object to register the requirement, no notification will be
// delivered, as notifications are only sent for changes in the set). To fetch
// the current set of elements, the order tracing object should call:
//
// <order result>.getOrderedMatches()
//     This function returns an array with all element IDs matched, in
//     the forwaard order of the set (even if the order result was defined
//     in terms of backward offsets). This function may return an empty
//     array if an update with the full set of matches is pending. Othewise,
//     this function incorporates the current state of the ordering,
//     including any updates which are still pending (this means that
//     when these updates will be received, they would be mostly redundant).
//     Compare this with the standard 'getDominatedMatches()' interface.
//     'getDominatedMatches()' does not guarantee that the element IDs
//     it returns are in order (though they often are) and also takes into
//     account any pending updates so that when these updates arrive
//     they are fully incremental. Therefore, getOrderedMatches() should
//     be used by order tracing modules which receive the not fully
//     incremental 'updatePos()' notifications while 'getDominatedMatches()'
//     should be used by standard functio result nodes which use the
//     addMatches() and removeMatches() notifications and rely on their being
//     fully incremental.
//
//     getOrderedMatches() can be called at any point in time (not only
//     after the initial registration of an order tracing module, though
//     then it must be called). Moreover, getOrderedMatches() may also be
//     called when there is no orer tracing module registered, though then
//     it is not guaranteed to return the elements in their correct order.

// Derived Class Interface
// -----------------------
//
// The following functions need to be defined in derived classes of OrderResult,
// to implement the specific needs of the ordering function.
//
// registerToOrderService(): this function should register the appropriate
//    order requirements (OrderRequirement objects) to order service.
//    The OrderResult object should be the listener defined for those
//    requirements, so that it receives notifications when the elements
//    satisfying the requirements change.
// unregisterFromOrderService(): this function should unregister the
//    order requirements which were registered by registerToOrderService().
//    This is called when the OrderResult is detached from its current
//    order service node.
// addMatches(<element IDs>): this function must be implemented
//    in those order functions which are selections, that is, return
//    a subset of the input set, based on the ordering of the elements.
//    <element IDs> is an array of element IDs which were added to the
//    subset since the last update.
// removeMatches(<element IDs>): this function must be implemented
//    in those order functions which are selections, that is, return
//    a subset of the input set, based on the ordering of the elements.
//    <element IDs> is an array of element IDs which were removed from the
//    subset since the last update.
// removeAllMatches(): this function must be implemented
//    in those order functions which are selections, that is, return
//    a subset of the input set, based on the ordering of the elements.
//    This function is called to indicate that all elements in the subset
//    are about to be removed. This function is called before the
//    elements are actually removed, so that this (and dominating)
//    functions can still retrieve the list of matches to be removed
//    if they need to do so.
// getDominatedMatches(): this function must be implemented
//    in those order functions which are selections, that is, return
//    a subset of the input set, based on the ordering of the elements.
//    This function should return an array with element IDs which are
//    all element IDs currently matched by the order function.
//    The element IDs may be returned in any order. If there are still
//    pending match updates not yet forwarded from the OrderResult
//    object to the active* composed functions, getDominatedMatches()
//    should return the matches before the changes which are currently
//    pending (so that when the pending change updates are delivered the
//    set could be updated correctly).
// getDominatedMatchesAsObj(): this is similar to getDominatedMatches()
//    except that it returns a Map object whose keys are the element IDs
//    in the subset.
// filterDominatedMatches(<element IDs>): this function must be
//    implemented in those order functions which are selections, that is,
//    return a subset of the input set, based on the ordering of the elements.
//    This function returns an array with a subset of
//    the <element IDs> array which represent element IDs which are
//    matched by this order result (as in the case of getDominatedMatches(),
//    this excludes pending updates).
// filterDominatedMatchPositions(<element IDs>): this function must be
//    implemented in those order functions which are selections, that is,
//    return a subset of the input set, based on the ordering of the elements.
//    This function returns an array with positions (non-negative integers)
//    in the <element IDs> array which represent element IDs which are
//    matched by this order result (as in the case of getDominatedMatches(),
//    this excludes pending updates).

//
// Object Structure
// ----------------
//
// {
//     orderService: <OrderService>
//     orderTracing: <array of order tracing objects>
// }
//
// orderService: this is the order service which is directly dominated
//     by this OrderResult object. It is this order service object which
//     stores the order tree which actually performs the sorting operations
//     required to implement this order function.
// orderTracing: This is an array holding the objects registered through
//     the 'addOrderTracing()' function and which should receive
//     'updatePos()' notifications. It is asumed this list is not very long
//     and that objects are not frequently added or removed from it,
//     so it is stored in a simple array.
//     This is undefined when the list is empty.

// %%include%%: "funcResult.js"
// %%include%%: "queryResultQueryCalc.js"
// %%include%%: "orderService.js"
// %%include%%: <scripts/utils/trees/orderRequirements.js>

inherit(OrderResult, FuncResult);

// all OrderResult nodes created, by ID
var debugAllOrderResults = undefined;  // initialized, if needed, by InternalQCM

//
// Constructor
//

// The constructor takes the standard FuncResult constructor argument:
// the global InternalQCM.

function OrderResult(internalQCM)
{
    this.FuncResult(internalQCM);

    if(debugAllOrderResults !== undefined) // for debugging only
        debugAllOrderResults[this.id] = this;
    
    this.orderService = undefined;
    this.orderTracing = undefined;
}

// Destroy this object

OrderResult.prototype.destroy = orderResultDestroy;

function orderResultDestroy()
{
    // in case the order result was not deactivated before being destroyed
    this.unregisterFromOrderService();
    
    if(this.orderService !== undefined) {
        this.qcm.releaseOrderService(this);
        this.orderService = undefined;
    }

    this.FuncResult_destroy();

    if(debugAllOrderResults !== undefined) // for debugging only
        delete debugAllOrderResults[this.id];
}

// An OrderResult returns false here, since it is the OrderService
// object which it dominates which is the node responsible for performing
// the order related calculations.

OrderResult.prototype.isOrder = orderResultIsOrder;

function orderResultIsOrder()
{
    return false;
}

// An order result object becomes active when some order tracing objects
// are registered to it. In addition, it may become active* when
// active* function results are composed with it, in the standard way.

OrderResult.prototype.isActive = orderResultIsActive;

function orderResultIsActive()
{
    return this.orderTracing !== undefined;
}

//
// Order Tracing Registration
//

// This function adds the object 'orderTracingObj' to the list of objects
// which trace the ordering of the set defined by this order result.
// In addition to adding this object to the list fo 'orderTracing' objects
// which need to receive 'updatePos()' notifications (see introduction to
// this file) this function must also perform the following actions when
// this is the first object registered as an order tracing object:
// 1. Notify the derived class (in case it need to take special action when
//    ordering needs to be traced).
// 2. Activate the order result.

OrderResult.prototype.addOrderTracing = orderResultAddOrderTracing;

function orderResultAddOrderTracing(orderTracingObj)
{
    if(this.orderTracing === undefined) {
        this.orderTracing = [orderTracingObj];
        // set order tracing (in derived class)
        this.setOrderTracing();
        // activate node
        this.activated();
    } else {
        for(var i = 0, l = this.orderTracing.length ; i < l ; ++i) {
            if(this.orderTracing[i] === orderTracingObj)
                return; // already registered
        }
        this.orderTracing.push(orderTracingObj);
    }
}

// This function removes the object 'orderTracingObj' from the list of
// objects which trace the ordering of the set defined by this order result.
// If this is the last such object registered here, the order result
// becomes non-active (though it may remain active*).

OrderResult.prototype.removeOrderTracing = orderResultRemoveOrderTracing;

function orderResultRemoveOrderTracing(orderTracingObj)
{
    if(this.orderTracing === undefined)
        return; // not registered

    if(this.orderTracing.length > 1) {
        for(var i = 0, l = this.orderTracing.length ; i < l ; ++i)
            if(this.orderTracing[i] === orderTracingObj) {
                // found
                if(i < l - 1)
                    this.orderTracing[i] = this.orderTracing[l - 1];
                this.orderTracing.length--;
                return;
            }
    } else if(this.orderTracing[0] === orderTracingObj) {
        this.orderTracing = undefined;
        if(this.isActiveStar()) {
            // stop order tracing (in derived class) - no need to do this
            // if the node anyway gets deactivated.
            this.setOrderTracing();
        }
        // deactivate
        this.deactivated();
    }
}

//
// Activation and Deactivation
//

// This function is called when this node becomes active (not just active*).
// If the node was not previously active*, this registers it as a composed
// active* of its order service (if exists). This takes care of the rest
// of the activation.

OrderResult.prototype.activated = orderResultActivated;

function orderResultActivated()
{
    if(this.composedActiveNum > 0)
        return; // already active*

    // if this object has a dataObj (this holds only for some derived classes)
    // then we apply (for that data object) the standard activation function.
    if(this.dataObj !== undefined)
        this.FuncResult_activated();
    
    if(!this.orderService)
        return; // no data object assigned yet

    this.orderService.addActiveComposedFunc(this, false);
    this.registerToOrderService();
}

// This function is called when this node stops being active (though it
// may still be active*). If no longer active*, this node is removed as
// an active* composed function of the order service (if exists).
// This takes care of the result of the deactivation.

OrderResult.prototype.deactivated = orderResultDeactivated;

function orderResultDeactivated()
{
    if(this.isActiveStar())
        return;

    // if this object has a dataObj (this holds only for some derived classes)
    // then we apply (for that data object) the standard deactivation function.
    if(this.dataObj !== undefined)
        this.FuncResult_deactivated();
    
    if(!this.orderService)
        return; // no data object assigned yet

    this.unregisterFromOrderService();
    this.orderService.removeActiveComposedFunc(this.id);
}

//
// Setting the Data
//

// This function sets 'dataObj' (a FuncResult object) as the data to
// which this ordering function should be applied. This function
// overrides the default implementation of this function in FuncResult
// because the OrderService object needs to be inserted between
// the OrderResult object and 'dataObj'.

OrderResult.prototype.setData = orderResultSetData;

function orderResultSetData(dataObj)
{
    if(dataObj === undefined) {
        if(this.orderService === undefined)
            return;
    } else if(this.orderService !== undefined &&
              dataObj === this.orderService.dataObj)
        return;

    // remove registrations to old order service

    if(this.isActiveStar()) // remove derived class registrations 
        this.unregisterFromOrderService();
    // remove the order result for the order service
    this.qcm.releaseOrderService(this);
    this.orderService = undefined;

    if(dataObj === undefined)
        return;
    
    this.orderService = this.qcm.getOrderService(this, dataObj);
    this.orderService.addOrderResult(this);

    if(this.isActiveStar())
        // let derived class add its registrations
        this.registerToOrderService();
}

// This function sets 'dataObj' (a FuncResult object) as the terminal data
// for this ordering function (that is, at the bottom of the function result
// chain this ordering result node dominates). This is probably not very
// useful here, but we need to override the default implementation
// to make this work correctly.

OrderResult.prototype.setTerminalData = orderResultSetTerminalData;

function orderResultSetTerminalData(dataObj, argNum)
{
    if(this.orderService == undefined) {
        // no data object set yet, so can set the given data as the direct data 
        this.setData(dataObj);
        return;
    }

    // forward this call to the directly dominated node, the order service
    this.orderService.setTerminalData(dataObj);
}

// As the order result itself is not intersted in the indexer and path
// (and usually does not change them) the default behavior is for the
// refresh to simply be propagated to the active* composed functions
// (if any). There is also no need to remove any remaining matches here
// since this is taken care of by the call to this function on the service
// order.

OrderResult.prototype.refreshIndexerAndPaths =
    orderResultRefreshIndexerAndPaths;

function orderResultRefreshIndexerAndPaths(dataObj)
{
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive)
            this.composedActive[resultId].refreshIndexerAndPaths(this);
}

// As the order result itself is not intersted in the indexer and path
// (and usually does not change them) the default behavior is for the
// refresh to simply be propagated to the active* composed functions
// (if any).

OrderResult.prototype.replaceIndexerAndPaths =
    orderResultReplaceIndexerAndPaths;

function orderResultReplaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                           newIndexerContained, dataObj)
{
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive) {
            this.composedActive[resultId].
                replaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                       newIndexerContained, this);
        }
}

// This function is called when the node becomes active*. It should
// then register itself as active* to the order service (the rest should
// happen as a result of this registration).

OrderResult.prototype.becameActiveStar =
    orderResultBecameActiveStar;

function orderResultBecameActiveStar()
{
    if(!this.orderService)
        return; // no data object assigned yet

    this.orderService.addActiveComposedFunc(this, false);
    this.registerToOrderService();
}

// This function should never be called (because this object does not have
// a data object but is composed with the orer service instead). 

OrderResult.prototype.addDataObjMatches =
    orderResultAddDataObjMatches;

function orderResultAddDataObjMatches(oldDataObj, indexerAndPathChanged)
{
    assert(false, "this function should not be called");
}

// This function should never be called (because this object does not have
// a data object but is composed with the orer service instead). 

OrderResult.prototype.removeDataObjMatches =
    orderResultRemoveDataObjMatches;

function orderResultRemoveDataObjMatches(newDataObj, indexerAndPathChanged)
{
    assert(false, "this function should not be called");
}

// This function may be used to receive notifications from the order service.
// Each derived class should implement this function separately.

OrderResult.prototype.addMatches =
    orderResultAddMatches;

function orderResultAddMatches(elementIds, source)
{
    assert(false, "this function should be implemented in the derived class");
}

// This function may be used to receive notifications from the order service.
// Each derived class should implement this function separately.

OrderResult.prototype.removeMatches =
    orderResultRemoveMatches;

function orderResultRemoveMatches(elementIds, source)
{
    assert(false, "this function should be implemented in the derived class");
}

// This function may be used to receive notifications from the order service.
// Each derived class should implement this function separately.

OrderResult.prototype.removeAllMatches =
    orderResultRemoveAllMatches;

function orderResultRemoveAllMatches(source)
{
    assert(false, "this function should be implemented in the derived class");
}

// This function is called after notifications have been sent from ordering
// requirements to OrderResult objects which are registered as listeners
// to those requirements. A call to this function does not indicate that
// any notifications were actually sent, only that all those notifications
// that had to be sent have already been sent. This allows the order
// result to round up this update cycle. The default implementation is to
// do nothing (some order results may perform all required operations
// immediately upon receiving the update from the requirements). Other
// order results may wish to override this default implementation.

OrderResult.prototype.allNotificationsReceived =
    orderResultAllNotificationsReceived;

function orderResultAllNotificationsReceived()
{
    return; // by default, do nothing
}

// This function returns the dominated indexer of the order service
// (which is itself that of the data under it)

OrderResult.prototype.getDominatedIndexer =
    orderResultGetDominatedIndexer;

function orderResultGetDominatedIndexer()
{
    if(this.orderService === undefined)
        return undefined;

    return this.orderService.getDominatedIndexer();
}

// This function returns the dominated projection path of the order service
// (which is itself that of the data under it)

OrderResult.prototype.getDominatedProjPathId =
    orderResultGetDominatedProjPathId;

function orderResultGetDominatedProjPathId()
{
    if(this.orderService === undefined)
        return undefined;
    
    return this.orderService.getDominatedProjPathId();
}

// No multiple projection paths supported here 

OrderResult.prototype.getDominatedProjPathNum =
    orderResultGetDominatedProjPathNum;

function orderResultGetDominatedProjPathNum()
{
    return 1;
}

// This should be implemented by the deerived class

OrderResult.prototype.getTerminalProjMatches =
    orderResultGetTerminalProjMatches;

function orderResultGetTerminalProjMatches(projId)
{
    assert(false, "this function should be defined in the derived class");
}

// This should be implemented by the deerived class

OrderResult.prototype.filterTerminalProjMatches =
    orderResultFilterTerminalProjMatches;

function orderResultFilterTerminalProjMatches(projId, elementIds)
{
    assert(false, "this function should be defined in the derived class");
}

// The default dominated match count (for all ordering functions which are
// selections returning a subset of the original set) is 1.

OrderResult.prototype.getDomMatchCount =
    orderResultGetDomMatchCount;

function orderResultGetDomMatchCount()
{
    return 1;
}

// This function should be implemented in the derived class 

OrderResult.prototype.getDominatedMatches =
    orderResultGetDominatedMatches;

function orderResultGetDominatedMatches()
{
    assert(false, "this function should be implemented in the derived class");
}

// This function should be implemented in the derived class 

OrderResult.prototype.getDominatedMatchesAsObj =
    orderResultGetDominatedMatchesAsObj;

function orderResultGetDominatedMatchesAsObj()
{
    assert(false, "this function should be implemented in the derived class");
}

// This function should be implemented in the derived class 

OrderResult.prototype.filterDominatedMatches =
    orderResultFilterDominatedMatches;

function orderResultFilterDominatedMatches(elementIds)
{
    assert(false, "this function should be implemented in the derived class");
}

// This function should be implemented in the derived class 

OrderResult.prototype.filterDominatedMatchPositions =
    orderResultFilterDominatedMatchPositions;

function orderResultFilterDominatedMatchPositions(elementIds)
{
    assert(false, "this function should be implemented in the derived class");
}

// This function should be implemented in the derived class 

OrderResult.prototype.getOrderedMatches =
    orderResultGetOrderedMatches;

function orderResultGetOrderedMatches()
{
    assert(false, "this function should be implemented in the derived class");
}

// This function returns the dominated identification of the order service
// (which is itself that of the data under it)

OrderResult.prototype.getDominatedIdentification =
    orderResultGetDominatedIdentification;

function orderResultGetDominatedIdentification()
{
    if(this.orderService === undefined)
        return undefined;
    
    return this.orderService.getDominatedIdentification();
}

// This function returns the dominated comparison of the order service
// (which is itself that of the data under it). Note that neither the
// order service nor an order function change the comparison which applies
// to to functions composed with them.

OrderResult.prototype.getDominatedComparison = 
    orderResultGetDominatedComparison;

function orderResultGetDominatedComparison()
{
    if(this.orderService === undefined)
        return undefined;
    
    return this.orderService.getDominatedComparison();
}

//////////////////////
// RangeOrderResult //
//////////////////////

// RangeOrderResult is a a derived class of OrderResult which implements
// the 'pos' function, which selects out of its data all elements
// at a given range of positions.
//

// Object Strcture
// ---------------
//
// {
//    lowOpen: true|false
//    highOpen: true|false
//    isComplement: true|false
//    isBackward: true|false
//    offsets: <array of two integers>
// }
//
// lowOpen: indicates whether the given range is open at its lower end.
//    (for the definition of the lower end, see the introduction for this
//    object).
// highOpen: indicates whether the given range is open at its lower end.
//    (for the definition of the lower end, see the introduction for this
//    object).
// isComplement: true iff this is a complement range, that is, if
//    one of its defining offsets is a forward offset and the other is
//    a backward offset.
// isBackward: true if both defining offsets of the range are backward offsets.
//    false otherwise (including the case where this is a complement range).
// offsets: this is an array containing two numbers, which define the
//    range of positions matched by this order function. These numbers are
//    already in the format required by the rang eorder requirement, that is,
//    non-negative integers. If the input offset to this PoOrderResult
//    was negative, it is converted to a on-negative integer using the
//    formula -(x+1) (-1 is mapped to 0). The 'isBackward' and 'isComplement'
//    flags then store the information as to which offsets originated in
//    a negative offset. If both offsets are forward or backward offsets,
//    the 'isBackward' flag stores the information about their direction
//    (and the two offsets may be stored in any order in 'offsets'). If
//    one offset is a forward offset and the other a backward offsets,
//    the first offset in the 'offsets' array must be the forward offset
//    and the second offset the backward offset (and the 'isComplement' flag
//    is set).

inherit(RangeOrderResult, OrderResult);

//
// Constructor
//

// The constructor only takes the standard 'internalQCM' argument which
// all FuncResult objects take.

function RangeOrderResult(internalQCM)
{
    this.OrderResult(internalQCM);

    // set default values
    this.lowOpen = false;
    this.highOpen = false;
    this.isComplement = false;
    this.isBackward = false;
    this.offsets = undefined;
}

// This function sets the offsets which define the range of offsets in the
// ordered set which are matched by this RangeOrderResult object.
// 'offsets' should be an array of two integers (positive or negative, see
// introduction) and 'lowOpen' and 'highOpen' should be Booleans.
// This function stores the offsets and high/low open/closed
// properties and then registers an order requirement or modifies an existing
// order requirement to reflect these new offset values (order requirements
// can be registered only if an order service already exists and the
// order result is active, otherwise the function waits for a call
// to 'registerToOrderService()').

RangeOrderResult.prototype.updateOffsets =
    rangeOrderResultUpdateOffsets;

function rangeOrderResultUpdateOffsets(offsets, lowOpen, highOpen)
{
    // store the parameters
    this.lowOpen = !!lowOpen;
    this.highOpen = !!highOpen;
    this.isComplement = ((offsets[0] < 0 && offsets[1] >= 0) ||
                         (offsets[0] >= 0 && offsets[1] < 0));
    this.isBackward = !this.isComplement && offsets[0] < 0;

    if(this.isComplement) {
        if(offsets[0] < 0)
            this.offsets = [offsets[1], -(1 + offsets[0])];
        else
            this.offsets = [offsets[0], -(1 + offsets[1])];
    } else if(this.isBackward)
        this.offsets = [-(1 + offsets[0]), -(1 + offsets[1])];
    else
        this.offsets = offsets.concat(); // duplicate the array

    // regsister the offsets to the requirement object, if the order service
    // is already available (and this node is active*)

    if(this.isActiveStar())
        this.registerToOrderService();
}

// This function starts or stops order tracing (depending on the current
// setting of this.orderTracing), that is, tracing the
// order of elements inside the range). This done by re-regsitering to
// the order service (which is called with the appropriate flag
// based on whether there are any order tracing objects registered).

RangeOrderResult.prototype.setOrderTracing = rangeOrderResultSetOrderTracing;

function rangeOrderResultSetOrderTracing()
{
    if(this.isActiveStar())
        // let derived class add its registrations
        this.registerToOrderService();
}

// This function is called to register a requirement to the order service
// or modify an existing requirement registered to the order service.
// It is the order service which actually constructs the requirement
// and registers it, so this function only needs to pass to the order
// service the parameters of the requirements. This object is registered
// as the listener of the requirement (to receive updates).

RangeOrderResult.prototype.registerToOrderService =
    rangeOrderResultRegisterToOrderService;

function rangeOrderResultRegisterToOrderService()
{
    if(this.orderService === undefined || this.offsets === undefined)
        return; // cannot register yet

    this.orderService.registerRangeRequirement(this, this.offsets,
                                               this.isComplement,
                                               this.isBackward,
                                               this.lowOpen, this.highOpen,
                                               this.orderTracing !== undefined);
}

// This function is called to remove any requirement registration made
// by the order service for this order result node.

RangeOrderResult.prototype.unregisterFromOrderService =
    rangeOrderResultUnregisterFromOrderService;

function rangeOrderResultUnregisterFromOrderService()
{
    if(this.orderService === undefined || this.offsets === undefined)
        return; // no requirement registration to remove

    this.orderService.unregisterRangeRequirement(this);
}

//////////////////////////////////////
// Interface with Order Requirement //
//////////////////////////////////////

// The added matches are received from the order service and simply
// forwarded to the active* composed functions (the matches are not stored
// locally since they can easily be retrieved from the underlying order tree)

RangeOrderResult.prototype.addMatches =
    rangeOrderResultAddMatches;

function rangeOrderResultAddMatches(elementIds)
{
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive)
            this.composedActive[resultId].addMatches(elementIds, this);
}

// The removed matches are received from the order service and simply
// forwarded to the active* composed functions (the matches are not stored
// locally since they can easily be retrieved from the underlying order tree)

RangeOrderResult.prototype.removeMatches =
    rangeOrderResultRemoveMatches;

function rangeOrderResultRemoveMatches(elementIds)
{
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive)
            this.composedActive[resultId].removeMatches(elementIds, this);
}

// This function is called to remove all matches of this range order result.
// This function forwards this removal to the active* composed nodes.

RangeOrderResult.prototype.removeAllMatches =
    rangeOrderResultRemoveAllMatches;

function rangeOrderResultRemoveAllMatches()
{
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive)
            this.composedActive[resultId].removeAllMatches(this);
}

// This function forwards the update to all order tracing modules registered
// to it (and also adds the set size to the update).

RangeOrderResult.prototype.updatePos =
    rangeOrderResultUpdatePos;

function rangeOrderResultUpdatePos(elementIds, firstOffset, lastOffset, setSize)
{
    if(this.orderTracing === undefined)
        return;
    
    for(var i = 0, l = this.orderTracing.length ; i < l ; ++i)
        this.orderTracing[i].updatePos(elementIds, firstOffset, lastOffset,
                                       setSize);
}

//////////////////////
// Fetching Matches //
//////////////////////

// This function simply returns the matches of this range.

RangeOrderResult.prototype.getTerminalProjMatches =
    rangeOrderResultGetTerminalProjMatches;

function rangeOrderResultGetTerminalProjMatches(projId)
{
    if(this.orderService === undefined)
        return [];

    return this.orderService.getRangeMatches(this);
}

// This function returns the subset of 'elementIds' which are in this range.
// 'projId' is ignored.

RangeOrderResult.prototype.filterTerminalProjMatches =
    rangeOrderResultFilterTerminalProjMatches;

function rangeOrderResultFilterTerminalProjMatches(projId, elementIds)
{
    if(this.orderService === undefined)
        return [];

    return this.orderService.filterRangeMatches(this, elementIds);
}

// This function returns an array of element IDs which represent the
// matches of this range order function. These matches represent the current
// state fo this order result and therefore do not incorporate any pending
// matches. Since this object does not keep track of its matches, the
// matches are fetched from the order service.

RangeOrderResult.prototype.getDominatedMatches =
    rangeOrderResultGetDominatedMatches;

function rangeOrderResultGetDominatedMatches()
{
    if(this.orderService === undefined)
        return [];

    return this.orderService.getRangeMatches(this);
}

// This is the same as getDominatedMatches(), except that the matches are
// returned as a Map object whose keys are the matches.

RangeOrderResult.prototype.getDominatedMatchesAsObj =
    rangeOrderResultGetDominatedMatchesAsObj;

function rangeOrderResultGetDominatedMatchesAsObj()
{
    var matches = this.getDominatedMatches();
    var matchesAsObj = new Map();

    for(var i = 0, l = matches.length ; i < l ; ++i)
        matchesAsObj.set(matches[i], true);

    return matchesAsObj;
}

// This function returns an array contaiing a subset of
// the <element IDs> array which represent element IDs which are
// matched by this order result (as in the case of getDominatedMatches(),
// this excludes pending updateds).

RangeOrderResult.prototype.filterDominatedMatches =
    rangeOrderResultFilterDominatedMatches;

function rangeOrderResultFilterDominatedMatches(elementIds)
{
    var matchesAsObj = this.getDominatedMatchesAsObj();
    var filtered = [];

    if(matchesAsObj.size == 0)
        return filtered;
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(matchesAsObj.has(elementId))
            filtered.push(elementId);
    }

    return filtered;
}

// This function returns an array with positions (non-negative integers)
// in the <element IDs> array which represent element IDs which are
// matched by this order result (as in the case of getDominatedMatches(),
// this excludes pending updateds).

RangeOrderResult.prototype.filterDominatedMatchPositions =
    rangeOrderResultFilterDominatedMatchPositions;

function rangeOrderResultFilterDominatedMatchPositions(elementIds)
{
    var matchesAsObj = this.getDominatedMatchesAsObj();
    var positions = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        if(matchesAsObj.has(elementIds[i]))
            positions.push(i);
    }

    return positions;
}

// This function returns an array with all data element IDs currently
// matched by this range order result. These element IDs are guaranteed
// to be in forward order of the set if any order tracing objects were
// registered to this order result. It is not guaranteed that any subsequent
// notifications received (add/remove matches) will be purely incremental
// relative to the set returned here. Therefore, this function should be
// used by orer tracing modules (which do not expect full incrementality
// of updates) and not by standard function results (which expect updates
// to be fully incremental and should therefore use getDominatedMatches()
// instead.
// See introduction to the file for more details.

RangeOrderResult.prototype.getOrderedMatches =
    rangeOrderResultGetOrderedMatches;

function rangeOrderResultGetOrderedMatches()
{
    if(!this.orderService)
        return []; // not initialized yet

    return this.orderService.getOrderedRangeMatches(this);
}

////////////////////////
// Index Order Result //
////////////////////////

// This function result object implements a function which assigns
// element IDs received from one data object values which are their position
// in an ordered set which is the other data object of the index order
// result. This object therefore has two data objects: the ordered set
// and the set of elements for which the position in the ordered set needs
// to be determined.
//
// The output of this function result object is the subset of elements in the
// second data object which are found in the first data object. Each such
// data element carries, at the root path, a value which is its
// position in the ordered set.
//
// Two functions are provided for setting the two different data sets:
//
// setOrderedData(<FuncResult>): this sets the given FuncResult node as
//     the ordered set whose ordering determines the indexes calculated
//     by the index order result.
// setToIndexData(<FuncResult>): this sets the given FuncResult as the
//    set of elements whose position needs to be determined in the
//    ordered set.
//
// As with other order result objects, the ordered set data (the one
// set by setOrderedData()) is not registered as the dataObj of this
// index order result (because access to the ordered set is mediated
// by an order service object). It is therefore the second data object
// (the one registered by 'setToIndexData()') which is stoered under 'dataObj'.
//
// The element IDs for which the order index should be determined are
// therefore received from the index data object through standard calls to
// addMatches(), removeMatches() and removeAllMatches().
//
// The result of the index order result is stored in a new indexer. This is
// the dominated indexer for the function results composed with this node.
// Only element IDs which are in the ordered set are stored in this
// result indexer. The index in the order set is stored as the key
// (of type "number") at the root path for each element ID.
//
// A function which makes use of this object can, therefore, restrict itself
// to inheriting FuncResult and then implement the following functions
// (which will be called by the IndexOrderResult object):
//
// addMatches(<element IDs>, <IndexOrderResult>):
//     This function is called to indicate that the element IDs in
//     <element IDs> were added to the subset of element IDs which
//     which appear in the ordered set.
//     <IndexOrderResult> is the object from which the notification was
//     received (this is the standard addMatches() interface).
//     When matches are added, no 'updateKeys()' notification is received
//     for those matches, so the receiving object must fetch the keys
//     (index in the ordered set) by calling 'getValues()' on
//     <IndexOrderResult> (see details below).
// removeMatches(<element IDs>, <IndexOrderResult>):
//     This function is called to indicate that the element IDs in
//     <element IDs> are no longer in the order set.
//     <IndexOrderResult> is the object from which the notification was
//     received (this is the standard addMatches() interface).
//
// To receive key updates (changes in the index for existing matches)
// one must register a query calculation node to the indexer
// storing the result (<IndexOrderResult>.getDominatedIndexer() and
// <IndexOrderResult>.getDominatedProjPathId() provide the required
// indexer and path). The query calculation node need only register
// for key updates (no match update). 
//
// To get the current index of a set of element IDs (for example, inside
// an 'addMatches()' call) one can call the following function:
//
// <IndexOrderResult>.getValues(<element IDs>)
//
// This function returns the current ordering positions of the elements in the
// array of element IDs <element IDs>. The returned value is an object of
// the following format:
//
// {
//     keys: <array>,
//     types: <array>,
//     hasAttrs: <array>
// }
//
// (this is the same format as used elsewhere).
// keys: are the indexes of the given element IDs (with the positions
//    of this array aligned with those of the input <element IDs>). If an
//    element ID is not in the ordered set, an undefined value will appear in
//    the array.
// types: an array aligned with the 'keys' array. The for each entry
//    is either "number" (if the element ID is in teh ordered set)
//    or "undefined" (if it isn't).
// hasAttrs: indicates for each element whether the virtual indexer which
//    stores the order indexes of the elements stores any additional structure
//    under the nodes which store the index. Currently this is always
//    false, but this is part of the standard interface and may be
//    used in the future.

//
// Object Structure
// ----------------
//
// {
//     resultIndexer: <IdentityIndexer>,
//     rootPathNode: <path node>,
//     resultIndexerQueryCalc: <QueryResultQueryCalc>
// }
//
// resultIndexer: this is the indexer which stores the result of
//    this index order result. This is stored at the root path of the indexer.
//    At this path, the element IDs which have a defined index in the
//    ordered set are stored and their keys are the indexes of the
//    element IDs in the ordered set.
// rootPathNode: root path node of the result indexer. This is where the
//    result of this index order result is stored.
// resultIndexerQueryCalc: when a resultIndexer is used and non-query
//    result functions are composed with the index order result node, match
//    updates from the result indexer need to be forwarded by the query result
//    node to the composed function results (composed query results
//    register directly on the result indexer). For this purpose, this
//    IndexOrderResult uses the query calculation node stored here.
//    This QueryResultQueryCalc registers as a projection on the root
//    of the result indexer and forwards add/remove matches notifications.


inherit(IndexOrderResult, OrderResult);

//
// Constructor
//

// The constructor only takes the standard 'internalQCM' argument which
// all FuncResult objects take.

function IndexOrderResult(internalQCM)
{
    this.OrderResult(internalQCM);
    this.resultIndexer = new IdentityIndexer(internalQCM);
    this.rootPathNode = this.resultIndexer.addPath(this.qcm.getRootPathId());
    this.resultIndexerQueryCalc = undefined; // will be created if needed
}

// destroy function

IndexOrderResult.prototype.destroy = indexOrderResultDestroy;

function indexOrderResultDestroy()
{
    if(this.resultIndexerQueryCalc !== undefined)
        this.resultIndexerQueryCalc.destroy();

    this.resultIndexer.destroy();

    this.OrderResult_destroy();
}

// In addition to the deactivation which takes place in the base class,
// this function must also clear the result indexer (so that when it is
// reactivated no results will remain hanging in the result indexer.

IndexOrderResult.prototype.deactivated = indexOrderResultDeactivated;

function indexOrderResultDeactivated()
{
    this.resultIndexer.clear();
    this.OrderResult_deactivated();
}

// Override the default implementation: there is no order tracing on
// an index order result

IndexOrderResult.prototype.addOrderTracing = indexOrderResultAddOrderTracing;

function indexOrderResultAddOrderTracing(orderTracingObj)
{
    assert(false, "no order tracing on index order result");
}

// Override the default implementation: there is no order tracing on
// an index order result

IndexOrderResult.prototype.removeOrderTracing =
    indexOrderResultRemoveOrderTracing;

function indexOrderResultRemoveOrderTracing(orderTracingObj)
{
    assert(false, "no order tracing on index order result");
}

// This function sets the data object which defines the ordered set
// which determines the ordering relative to which the order indexes
// are defined. Thsi uses the standard setData function of order results.

IndexOrderResult.prototype.setOrderedData = indexOrderResultSetOrderedData;

function indexOrderResultSetOrderedData(dataObj)
{
    this.OrderResult_setData(dataObj);
}

// This function sets the data object for which the order indexes need
// to be determined (realtive to the ordering in the other data set).
// This function uses the standard (FuncResult) setData() function. 

IndexOrderResult.prototype.setToIndexData = indexOrderResultSetToIndexData;

function indexOrderResultSetToIndexData(dataObj)
{
    this.OrderResult_FuncResult_setData(dataObj);
}

// The index order result is not interested in the dominated indexer
// and (since its own result is stored in a new indexer) also does not
// forward updates regarding changes to the domianted indexer. Therefore,
// this function does nothing.

IndexOrderResult.prototype.refreshIndexerAndPaths =
    indexOrderResultRefreshIndexerAndPaths;

function indexOrderResultRefreshIndexerAndPaths(dataObj)
{
    return;
}

// The index order result is not interested in the dominated indexer
// and (since its own result is stoered in a new indexer) also does not
// forward updates regarding changes to the domianted indexer. Therefore,
// this function does nothing.

IndexOrderResult.prototype.replaceIndexerAndPaths =
    indexOrderResultReplaceIndexerAndPaths;

function indexOrderResultReplaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                                newIndexerContained, dataObj)
{
    return;
}

// This function is called when the 'to index' data object changes. When
// this function is called, the new data object is already set under
// 'dataObj'.
// Since the function 'removeDataObjMatches()' was already called and that
// function performed all required updates, the addDataObjMatches()
// function does not do anything.

IndexOrderResult.prototype.addDataObjMatches =
    indexOrderResultAddDataObjMatches;

function indexOrderResultAddDataObjMatches(oldDataObj, indexerAndPathChanged)
{
    return;
}

// This function is called when the 'to index' data object changes.
// When this function is called the old 'to index' data object is still
// registered under 'dataObj' (this may be undefined if the is the first
// time a 'to index' data object is set). 'newDataObj' is
// the new 'to index' data object.
// Thsi function then compares the matches of the new and old 'to index'
// data objects and adds those matches added by the new object and removes
// those matches which are not in the new data.

IndexOrderResult.prototype.removeDataObjMatches =
    indexOrderResultRemoveDataObjMatches;

function indexOrderResultRemoveDataObjMatches(newDataObj, indexerAndPathChanged)
{
    // get the dominated matches of the new data object

    var newMatches = newDataObj === undefined ?
        undefined : newDataObj.getDominatedMatchesAsObj();

    if(newMatches === undefined || newMatches.size === 0) {
        this.removeAllMatches();
        return;
    }

    var oldMatches = this.dataObj === undefined ?
        undefined : this.dataObj.getDominatedMatchesAsObj();
    
    // find existing matches which are not among the new domainted matches

    var removed = [];

    oldMatches.forEach(function(t, elementId) {
        if(!newMatches.has(elementId))
            removed.push(elementId);
    });

    if(removed.length > 0)
        this.removeMatches(removed);

    // find new matches which are not among the existing matches

    var added = [];
    
    newMatches.forEach(function(t, elementId) {
        if(!oldMatches.has(elementId))
            added.push(elementId);
    });

    if(added.length > 0)
        this.addMatches(added);
}

// This function is called when a new active composed function is composed
// with this result node. The only thing we need to do here is check whether
// there is need to create a resultIndexerQueryCalc node (in case the
// composed function just added is not a query).

IndexOrderResult.prototype.aboutToAddActiveComposed = 
    indexOrderResultAboutToAddActiveComposed;

function indexOrderResultAboutToAddActiveComposed(composedResult, 
                                                  wasActiveStar)
{
    if((composedResult instanceof InternalQueryResult) ||
       this.resultIndexerQueryCalc !== undefined)
        return; // nothing to do

    // first non-query-result active composed function
    // register a query calculation node to the result indexer, to
    // receive updates when nodes are added or removed
    this.resultIndexerQueryCalc = new QueryResultQueryCalc(this);
}

// This function is called every time an active composed query function 
// is removed from the list of active function results composed with 
// this index order result or when one of the composed function results which 
// was active* is no longer active*. This function then checks whether after
// this update there is still need for the resultIndexerQueryCalc node.

IndexOrderResult.prototype.activeComposedFuncRemoved = 
    indexOrderResultActiveComposedFuncRemoved;

function indexOrderResultActiveComposedFuncRemoved(composedResult)
{
    if((composedResult instanceof InternalQueryResult) ||
       this.resultIndexerQueryCalc === undefined)
        return; // nothing to do
    
    if(this.composedQueryResultNum == this.composedActiveNum) {
        // last non-query-result active composed function, unregister
        // the query calculation node from the result indexer
        this.resultIndexerQueryCalc.destroy();
        this.resultIndexerQueryCalc = undefined;
    }
}


// This function is called when this index order result first becomes
// both active* and has a data object. This function then goes over all
// matches added to it and registers element requirements for them
// into the order service.

IndexOrderResult.prototype.registerToOrderService =
    indexOrderResultRegisterToOrderService;

function indexOrderResultRegisterToOrderService()
{
    if(this.orderService === undefined)
        return; // cannot register yet

    var _self = this;

    if(this.dataObj === undefined)
        return; // still no 'to index' matches defined

    var matches = this.dataObj.getDominatedMatches();

    for(var i = 0, l = matches.length ; i < l ; ++i) {
        // register requirement to order service
        this.orderService.registerIndexRequirement(this, matches[i], false);
    }
}

// This function is called when this index order result either stops being
// active* or when it detached from its current data object. This function
// then goes over all matches added to it and de-registers their element
// requirements from the order service.

IndexOrderResult.prototype.unregisterFromOrderService =
    indexOrderResultUnregisterFromOrderService;

function indexOrderResultUnregisterFromOrderService()
{
    if(this.orderService === undefined)
        return; // cannot register yet

    if(this.dataObj === undefined)
        return; // still no 'to index' matches defined

    var matches = this.dataObj.getDominatedMatches();

    for(var i = 0, l = matches.length ; i < l ; ++i) {
        // unregister requirement from order service
        this.orderService.unregisterIndexRequirement(this, matches[i], false);
    }
}

//////////////////////////
// Requirement Listener //
//////////////////////////

// This function implements the interface of this order result node as
// a listener of the requirements which track the offset of the elements
// tracked by this index order result.
// This function is called when the offset of the given element ID
// (registered previously by this order result to the order service)
// changes. 'elementId' is the element whose offset changed. 'offset' is
// the new offset, which may either be a non-negative integer or undefined.
// If it is undefined, the element ID is no longer in the ordered set.
// This function then updates the result indexer with the given update
// (if the offset is undefined, the element ID is removed, otherwise, the
// element ID is added and its key is set).

IndexOrderResult.prototype.updateOffset =
    indexOrderResultUpdateOffset;

function indexOrderResultUpdateOffset(elementId, offset)
{
    var nodes = this.rootPathNode.nodes;

    if(nodes.has(elementId)) {
        if(offset === undefined)
            this.resultIndexer.removeNode(this.rootPathNode, elementId);
        else
            this.resultIndexer.setKeyValue(this.rootPathNode, elementId,
                                           "number", offset, false);
    } else if(offset !== undefined) {
        this.resultIndexer.addDataElementNode(this.rootPathNode, elementId);
        this.resultIndexer.setKeyValue(this.rootPathNode, elementId,
                                       "number", offset, true);
    }
}

//////////////////////////////////
// Adding and Removing Elements //
//////////////////////////////////

// This function is called to add the element IDs in the array 'elementIds'
// to those element IDs whose index in the ordered set should be tracked.
// These element IDs should not have previously been tracked.

IndexOrderResult.prototype.addMatches =
    indexOrderResultAddMatches;

function indexOrderResultAddMatches(elementIds)
{
    if(this.orderService === undefined)
        return;
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i)
        this.orderService.registerIndexRequirement(this, elementIds[i], false);
}

// This function is called to remove the element IDs in the array 'elementIds'
// from those element IDs whose index in the ordered set should be tracked.
// These element IDs should have previously been tracked.

IndexOrderResult.prototype.removeMatches =
    indexOrderResultRemoveMatches;

function indexOrderResultRemoveMatches(elementIds)
{
    if(this.orderService === undefined)
        return;

    var nodes = this.rootPathNode.nodes;
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        this.orderService.unregisterIndexRequirement(this, elementId, false);
        if(nodes.has(elementId))
            this.resultIndexer.removeNode(this.rootPathNode, elementId);
    }
}

// This function is called to remove all element IDs whose index should be
// determined. The function propagates this call to composed functions
// and then clears all tables and registrations made for all element IDs. 

IndexOrderResult.prototype.removeAllMatches =
    indexOrderResultRemoveAllMatches;

function indexOrderResultRemoveAllMatches()
{
    if(this.orderService === undefined)
        return;
    
    var elementIds = this.dataObj.getDominatedMatches();

    for(var i = 0, l = elementIds.length ; i < l ; ++i)
        this.orderService.unregisterIndexRequirement(this, elementIds[i],
                                                     false);
    
    this.resultIndexer.clear();
}

////////////////////////////////
// Dominated Indexer and Path //
////////////////////////////////

// When the dominated indexer is refreshed, there is nothing to do here,
// since any function composed with this index order result sees data
// from the result indexer.

IndexOrderResult.prototype.refreshIndexerAndPaths =
    indexOrderResultRefreshIndexerAndPaths;

function indexOrderResultRefreshIndexerAndPaths(dataObj)
{
    return;
}

// When the dominated indexer is refreshed, there is nothing to do here,
// since any function composed with this index order result sees data
// from the result indexer.

IndexOrderResult.prototype.replaceIndexerAndPaths =
    indexOrderResultReplaceIndexerAndPaths;

function indexOrderResultReplaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                                newIndexerContained, dataObj)
{
    return;
}

// For function result nodes dominating this result node, the result indexer
// of this index order result is the dominated indexer.

IndexOrderResult.prototype.getDominatedIndexer =
    indexOrderResultGetDominatedIndexer;

function indexOrderResultGetDominatedIndexer()
{
    return this.resultIndexer;
}

// The position of the elements in the ordered set is
// at the root path of a new set of data (with the same element IDs
// as the input data).

IndexOrderResult.prototype.getDominatedProjPathId =
    indexOrderResultGetDominatedProjPathId;

function indexOrderResultGetDominatedProjPathId()
{
    return this.qcm.getRootPathId();
}

///////////////////////
// Dominated Matches //
///////////////////////

// This result function is considered to have a single projection with ID 0
// so this function simply returns the same matches as getDominatedMatches().

IndexOrderResult.prototype.getTerminalProjMatches =
    indexOrderResultGetTerminalProjMatches;

function indexOrderResultGetTerminalProjMatches(projId)
{
    if(projId !== 0)
        return [];

    return this.getDominatedMatches();
}

// This result function is considered to have a single projection with ID 0
// so this function simply returns the same matches as getDominatedMatches().

IndexOrderResult.prototype.filterTerminalProjMatches =
    indexOrderResultFilterTerminalProjMatches;

function indexOrderResultFilterTerminalProjMatches(projId, elementIds)
{
    if(projId !== 0)
        return [];

    return this.filterDominatedMatches(elementIds);
}

// The dominated matches are those element IDs whose offset is not undefined
// and these are the element IDs stored in the result indexer.

IndexOrderResult.prototype.getDominatedMatches =
    indexOrderResultGetDominatedMatches;

function indexOrderResultGetDominatedMatches()
{
    return this.resultIndexer.getAllMatches(this.qcm.getRootPathId());
}

// same as getDominatedMatches(), but returns the matches as the keys
// of a map object returned.

IndexOrderResult.prototype.getDominatedMatchesAsObj =
    indexOrderResultGetDominatedMatchesAsObj;

function indexOrderResultGetDominatedMatchesAsObj(elementIds)
{
    return this.resultIndexer.getAllMatchesAsObj(this.qcm.getRootPathId());
}

// Return the subset of the input element IDs which have a defined
// offset

IndexOrderResult.prototype.filterDominatedMatches =
    indexOrderResultFilterDominatedMatches;

function indexOrderResultFilterDominatedMatches(elementIds)
{
    return this.resultIndexer.filterDataNodesAtPath(this.qcm.getRootPathId(),
                                                    elementIds);
}

// Same as filterDominatedMatches() except that instead of returning the
// subset of element IDs which have a defined offset, this function returns
// an array with the position in the input array of the element IDs which
// have a defined offset.

IndexOrderResult.prototype.filterDominatedMatchPositions =
    indexOrderResultFilterDominatedMatchPositions;

function indexOrderResultFilterDominatedMatchPositions(elementIds)
{
    var positions = this.resultIndexer.
        filterDataNodesAtPathPositions(this.qcm.getRootPathId(), elementIds);

    return positions;
}

// This function returns the current ordering positions of the elements in the
// array of element IDs <element IDs>. The returned value is an object of
// the following format:
//
// {
//     keys: <array>,
//     types: <array>,
//     hasAttrs: <array>
// }
//
// (this is the same format as used elsewhere).
// keys: are the indexes of the given element IDs (with the positions
//    of this array aligned with those of the input <element IDs>). If an
//    element ID is not in the ordered set, an undefined value will appear in
//    the array.
// types: an array aligned with the 'keys' array. The for each entry
//    is either "number" (if the element ID is in teh ordered set)
//    or "undefined" (if it isn't).
// hasAttrs: indicates for each element whether the virtual indexer which
//    stores the order indexes of the elements stores any additional structure
//    under the nodes which store the index. Currently this is always
//    false, but this is part of the standard interface and may be
//    used in the future.

IndexOrderResult.prototype.getValues = indexOrderResultGetValues;

function indexOrderResultGetValues(elementIds)
{
    return this.resultIndexer.getNodeValues(this.qcm.getRootPathId(),
                                            elementIds);
}

// This is not currently supported (though, in principle the element IDs
// could be returned in the order of their indexes).

IndexOrderResult.prototype.getOrderedMatches =
    indexOrderResultGetOrderedMatches;

function indexOrderResultGetOrderedMatches()
{
    assert(false, "ordered matches not supported for the index order result");
}
