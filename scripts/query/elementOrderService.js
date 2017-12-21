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


// This file implement an object, owned by the order service, which is
// responsible for managing the order requirement for a single
// anchor element (and ordering direction).
//
// This object provides services for all IndexOrderResult objects
// which share the same element requirement. Since for every anchor element
// and direction (forward/backward) only one requirement may be registered
// to the ordered tree, an ElementOrderService object is created for
// each anchor element and direction for which index order results are
// registered to the order service. This object stores all
// indexer order requirements which have its anchor element and direction
// and sums up the properties which need to be tracked by the requirement
// (e.g. is there need to track the set of elements between the anchor and
// the beginning of the order in the given direction). This object is
// also responsible for registering the right requirement to the order
// tree (and removig it when it is no longer needed).
//
// The object has the following structure:
//
// {
//     orderTree: <PartialOrderTree>
//     elementId: <anchor element ID>,
//     isBackward: <Boolean>
//     requirement: <ElementRequirement>
//     numRange: <number>,
//     numOrderedRange: <number>,
//     results: <Map>{
//         <result ID>: <IndexOrderResult>,
//         ......
//     }
// }
//
// orderTree: the order tree to which the requirement should be registered.
// elementId: the ID of the anchor data element for the requirement this
//     object stores.
// isBackward: the direction of ordering of the requirement this object stores.
// requirement: this is the ElementRequirement object which is registered
//     to the order tree.
// numRange: the number of objects among the IndexOrderResult objects
//     in the 'results' list which reuire the range of elements between the
//     anchor and the beginning of the order to be tracked.
// numOrderedRange: the number of objects among those counted in 'numRange'
//     which also require tracking of the order of the elements in the
//     range between the anchor and the beginning of the ordering.
// results: table of all order result objects which make use of this
//     requirement (they all share the same anchor element and the same
//     ordering direction).

//
// Constructor
//

// The constructor creates the element requirement service object, but does
// not yet create and register the requirement object because this
// can only happen once a result is added (which specifies the exact type
// of requirement which should be constructed).

function ElementOrderService(orderTree, elementId, isBackward)
{
    this.orderTree = orderTree;
    this.elementId = elementId;
    this.isBackard = isBackward;

    this.requirement = undefined; // will be added in 'addResult()'

    this.numRange = 0;
    this.numOrderedRange = 0;

    this.results = new Map();
}

// This function adds the given order result node (which may be any order
// result which makes use of an element requirement and has the same anchor
// element and ordering direction as this ElementOrderService)
// as a listener for this requirement. If this is the first result node to
// be registered or this order result must track properties which were not
// tracked so far, a requirement object is create and (re-)registered to
// the order tree. Otherwise, the result is simply added as a listener
// to the requirement.

ElementOrderService.prototype.addResult = elementOrderServiceAddResult;

function elementOrderServiceAddResult(orderResult)
{
    var resultId = orderResult.getId();
    
    if(this.results.has(resultId))
        return; // already registered
    
    // is tracking of the range required now for the first time    
    var initRange = false;
    // is tracking of the range order required now for the first time
    var initOrderedRange = false;

    // xxxxx here should set initRange or initOrderedRange for result
    // nodes which require it

    if(this.requirement !== undefined && (initRange || initOrderedRange)) {
        // make sure all existing results were updated with the current
        // state, as the requirement is about to be destroyed and re-created.
        this.requirement.notifyListeners();
        
        // remove the existing requirement and register a new one.
        this.requirement.destroy();
        this.requirement = undefined;
    }
    
    if(this.requirement === undefined) {
        // create (and register) the requirement
        this.requirement =
            new ElementRequirement(this.elementId, this.isBackward,
                                   this.numRange > 0, this.numOrderedRange > 0,
                                   this.orderTree);
        // make the initial values available for pulling by the result nodes
        // (since they are not yet registered, the update will not be pushed).
        this.requirement.notifyListeners();

        // add existing results (do not need to receive any notifications,
        // as the result did not change for them). This list may be empty.

        if(this.results.size > 0) {
            var _self = this;
            this.results.forEach(function(result, resultId) {
                _self.requirement.addListener(result);
            });
        }
    }

    this.results.set(resultId, orderResult);
    
    // add the new result as a listener
    this.requirement.addListener(orderResult);

    // push the initial result to the new result object
    this.pushInitialValue(orderResult);
}

// This function is called after the 'orderResult' is registered
// to the element order service. It pushes the current offset
// (and, if needed, range) of the requirement which implements this
// result to the order result object. This is because the requirement
// may not be new (it may already be i use by another order result)
// and thereore an incremental update is not guaranteed.
// After pushing the initial value, the order result will receive
// incremental changes as needed.

ElementOrderService.prototype.pushInitialValue =
    elementOrderServicePushInitialValue;

function elementOrderServicePushInitialValue(orderResult)
{
    if(orderResult instanceof IndexOrderResult) {
        // result interested only in offset
        var offset = this.requirement.getOffset();
        orderResult.updateOffset(this.elementId, offset);
    }
}

// This function removes the given order result node, which must be a
// result node previously added to this ElementOrderService object.
// In addition to removing it as a listener from the requirement and
// removing it from the table of result objects, this function also
// checks whether after removing the result the requirement can stop
// tracking various properties (e.g. the range between the element and
// the beginning of the ordering) or whether this is the last
// result making use of this requirement, in which case the requirement
// can be detroyed.
// This function returns true if the number of order result objects
// registered to this ElementOrderService object is larger than zero
// after the removal and returns false if this number is zero after the
// removal.

ElementOrderService.prototype.removeResult = elementOrderServiceRemoveResult;

function elementOrderServiceRemoveResult(orderResult)
{
    var resultId = orderResult.getId();
    
    if(!this.results.has(resultId))
        return (this.results.size > 0); // not registered

    this.results.delete(resultId);
    // remove the result as a listener from the requirement
    this.requirement.removeListener(orderResult);
    
    if(this.results.size == 0) {
        // destroy the requirement
        this.requirement.destroy();
        return false;
    }
    
    // should tracking of the range stop after this removal    
    var stopRange = false;
    // should tracking of the range order stop after this removal
    var stopOrderedRange = false;

    // xxxxx here should set stopRange or stopOrderedRange for result
    // nodes which require it

    if(stopRange || stopOrderedRange) {
        // make sure all existing results were updated with the current
        // state, as the requirement is about to be destroyed and re-created.
        this.requirement.notifyListeners();
        
        // remove the existing requirement and register a new one.
        this.requirement.destroy();
        this.requirement =
            new ElementRequirement(this.elementId, this.isBackward,
                                   this.numRange > 0, this.numOrderedRange > 0,
                                   this.orderTree);
        // the current values were already received by the result nodes,
        // so refresh the requirement before re-registering the results
        this.requirement.notifyListeners();
        
        var _self = this;
        this.results.forEach(function(result, resultId) {
            _self.requirement.addListener(result);
        });
    }

    return true;
}
