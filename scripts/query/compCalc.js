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


// This file implements the class (CompCalc and its derived classes)
// which actually calculates a comparison function. The object is
// created for a given comparison description (a Comparison object) and
// indexer + path (which defined the elements begin compared).
// A single CompCalc object may serve multiple comparison result
// (CompResult) objects (which are nodes in the FuncResult chain).
//
// It is the responsibility of the Comparison object to push its description
// to the CompCalc object.
//
// The base class only implements a basic interface. Most of the code is
// in the derived classes.
//
// Comparison Function
// -------------------
//
// Each derived class of CompCalc needs to defined the following functions:
//
// getCompareFunc(): this function returns a function which takes as
//     arguments two data element IDs which need to be compared and
//     returns their comparison based on the comparison defined in the
//     CompCalc. Since this comparison will be carried outside the
//     context of the CompCalc, all information required in order
//     to perform the comparison shoudl be included inside the returned
//     function using closure.
//     The data elements IDs passed to this function are considered
//     to be raised to the path at which the comparison is defined.
//     If not, they need to be raised first (see the next function).
// getRaisingFunc(): this function returns a function which, give
//     and element ID, returns an element ID which is the raising of
//     the input element ID to the path at which the comparison
//     defined by the CompCalc is defined. As in the case of getCompareFunc(),
//     this function is called outside the context of the CompCalc object,
//     so all need information needs to be included using closure.
//
// needToSuspendOrderingUponAddition(): this must return true if the
//     CompCalc node suspects that added matches may be received by
//     any of the owner CompResult objects before the CompCalc object
//     had a chance to update its values. In case of doubt, this function
//     should return true. The default implementation returns false.
//     
//
// Object Structure
// ================
//
// {
//     qcm: <Internal QCM>
//     id: <ID of this comparison calculation node>
//     qcmKey: <string>,
//     comparison: <Comparison>,
//     indexer: <InternalQCMIndexer>,
//     prefixProjPathId: <ID of the prefix projection path>
//     results: <Map>{
//        <comparison result ID>: <CompResult>
//        ......
//     }
//     activeResults: <Map>{
//        <comparison result ID>: <CompResult>
//        ......
//     }
// }
//
// qcm: the global internal QCM for this object.
// id: this is the ID of this comparison calculation node.
// qcmKey: the key (string) under which this node is stored in the QCM.
//    (this is needed for clean-up).
// comparison: the Comparison node which defines the comparison function
//    implemented by this function (this only encodes the description
//    of the comparison and not the data to which it needs to be applied).
// indexer: this is the indexer that stores the data to which the
//    comparison function is to be applied.
// prefixProjPathId: this is the ID of the path in the indexer 'indexer'
//    at which the data to which this comparison is applied can be found.
// results: this is a list of result (CompResult) objects
//    which currently make use of this comparison calculation node.
// activeResults: this is a partial list of the 'results' list of those
//    CompResult nodes which are order* (that is, CompResult nodes where
//    there is some active* ordering function which is composed* with
//    that CompResult node).

// %%include%%: "internalQCM.js"

//
// constructor 
//

// The constructor takes as arguments the global Internal QCM object
// and the objects and IDs which define the comparison carried
// out by it uniquely:
// internalQCM: the global QCM manager.
// comparison: the Coparison object which describes the comparison
// indexer: the indexer which stores the data which is being compared
//     by this comparison function
// prefixProjId: the ID of the path at which the data being compared
//     an be found inside the indexer.
// key: this is the key (a string containing the IDs of the other
//     arguments to the constructor) which is used by the Internal QCM
//     central module to identify this CompCalc object.
//
// The constructor stores the arguments provided to it and adds itself to
// the comparison function which defines it. This will result in the
// comparison being set up.

function CompCalc(internalQCM, comparison, indexer, prefixProjPathId, key)
{
    this.qcm = internalQCM;
    this.id = InternalQCM.newId();
    this.qcmKey = key;
    this.comparison = comparison;
    this.indexer = indexer;
    this.prefixProjPathId = prefixProjPathId;
        
    this.results = new Map();
    this.activeResults = new Map();

    // store the CompCalc object on the Comparison object so that the
    // Comparison object can notify it when it changes. This also initializes
    // this CompCalc with the properties of the comparison (pushed from the
    // Comparison object).
    this.comparison.addCompCalc(this);
}

// Destroy function

CompCalc.prototype.destroy = compCalcDestroy;

function compCalcDestroy()
{
    if(this.comparison !== undefined)
        this.comparison.removeCompCalc(this.getId());
}

// Returns the ID of this object

CompCalc.prototype.getId = compCalcGetId;

function compCalcGetId()
{
    return this.id;
}

// Returns the key constructed by the internal QCM to identify this
// comparison function.

CompCalc.prototype.getQCMKey = compCalcGetQCMKey;

function compCalcGetQCMKey(compResult)
{
    return this.qcmKey;
}

// This function adds the given result node to the list of CompResult nodes
// whose comparison is implemented by this comparison calculation node.

CompCalc.prototype.addCompResult = compCalcAddCompResult;

function compCalcAddCompResult(compResult)
{
    this.results.set(compResult.getId(), compResult);
    if(compResult.isOrderStar())
        this.resultActivated(compResult);
}

// Remove the given comparison result from the list of comparison results 
// which make use of this comparison calculation node. The function returns
// true if there are still comparison results making use of this comparison
// calculation node and false if there are no such comparison results.

CompCalc.prototype.removeCompResult = compCalcRemoveCompResult;

function compCalcRemoveCompResult(compResult)
{
    var resultId = compResult.getId();

    if(this.activeResults.has(resultId))
        this.resultDeactivated(compResult);

    this.results.delete(resultId);
    
    return (this.results.size > 0);
}

// This function notifies the CompResult nodes this CompCalc belongs to
// that the comparison changed.

CompCalc.prototype.refreshOrdering = compCalcRefreshOrdering;

function compCalcRefreshOrdering()
{
    // notify all the CompResult objects of this change
    this.activeResults.forEach(function(result, resultId) {
        result.compCalcRefreshed();
    });
}

// Indicate whether this CompCalc is active. This is iff there is some
// result node using this CompCalc which is order* (that is, has an active*
// ordering function which is composed* with it). The list of these result
// nodes is stored in 'activeResults'.

CompCalc.prototype.isActive = compCalcIsActive;

function compCalcIsActive()
{
    return (this.activeResults.size > 0);
}

// this function is called when the result 'compResult' (which should
// already be registered in the 'this.results' table) becomes order*.
// This function then adds it to the 'activeResults' table and if this
// is the first result to become order*, activates this CompCalc
// object.

CompCalc.prototype.resultActivated = compCalcResultActivated;

function compCalcResultActivated(compResult)
{
    var wasActive = this.isActive();
    
    this.activeResults.set(compResult.getId(), compResult);

    if(!wasActive && this.isActive())
        this.activated();
}

// this function is called when the result 'compResult' (which should
// be registered in the 'this.results' table) stops being order*.
// This function then removes it from the 'activeResults' table and if this
// is the first result to become order*, activates this CompCalc
// object.

CompCalc.prototype.resultDeactivated = compCalcResultDeactivated;

function compCalcResultDeactivated(compResult)
{
    var resultId = compResult.getId();
    var wasActive = this.isActive();
    
    this.activeResults.delete(resultId);

    if(wasActive && !this.isActive())
        this.deactivated();
}

// This function is called when this CompCalc is activated (that is, when
// the first of its CompResult nodes becomes order*).
// Derived classes should implement this function.

CompCalc.prototype.activated = compCalcActivated;

function compCalcActivated()
{
    assert(false, "need to define function in derived class");
}

// This function is called when this CompCalc is deactivated (that is, when
// the last of its CompResult nodes stops being order*).
// Derived classes should implement this function. 

CompCalc.prototype.deactivated = compCalcDeactivated;

function compCalcDeactivated()
{
    assert(false, "need to define function in derived class");
}

// Default implementation. In case of doubt, the derived class function
// should return false (see introduction).

CompCalc.prototype.needToSuspendOrderingUponAddition =
    compCalcNeedToSuspendOrderingUponAddition;

function compCalcNeedToSuspendOrderingUponAddition()
{
    return true;
}
