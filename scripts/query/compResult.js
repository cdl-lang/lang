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


// This is the function result node for a comparison function. It passes
// its data on as received from its data object, but becomes the dominated
// comparison object for all composed functions (until the next CompResult
// object). The dominated comparison object defines the ordering of
// the elements in the composed chain.

// External Interface
// ------------------
//
// This object supports the standard FuncResult interface, allowing it
// to be inserted into a function result chain. As far as matches are
// concerned, this object is transparent: it passes the indexer, projection
// path and matches of its data object to all function result nodes composed
// with it. It does, however, influence the ordering of those matches
// (something that is only visible to composed result nodes which depend
// on the ordering).
//
// To support comparison, the CompResult nodes have the following additional
// interface, to be used by the function which construct the function
// result chain:
//
// <CompResult>.setComparison(<Comparison>): this function sets the given
//      Comparison object as the definition of the comparison function
//      which defines the ordering by this node.
//
// In addition, nodes which implement order-dependent functions (e.g.
// [first, ...], [pos, ...]) have acces through the CompResult object
// to a comparison function:
//
// <CompResult>.compare(<element ID 1>, <element ID 2>): this function
//      returns a number < 0 if <element ID 1> is smaller than <element ID 2>,
//      a number > 0 if <element ID 1> is larger than <element ID 2> and
//      0 if the two element IDs are equal. Since we need a complete ordering,
//      this function should return 0 only if the two element IDs are
//      the same.
//      The comparison function defined on a certain CompResult node first
//      applies the comparison defined by the Comparison object set on it
//      using the 'setComparison()' function (see above). If this cannot
//      determine the ordering, the dominated comparison function of the
//      data result of the CompResult node is used. If no such dominated
//      comparison is available, the data element IDs are compared
//      (such that the default ordering is always based on the ordering
//      of the data elements).

//
// Object Structure
//

// {
//     comparison: <Comparison>
//     compCalc: <CompCalc>
// }
//
// comparison: this is the Comparison object which describes the comparison
//     which should take place. This is only a description (the comparison
//     criteria) and must still be combined with the data to produce an
//     actual comparison (this actual comparison function is implemented
//     by the CompCalc object, see below).
// compCalc: this is the CompCalc object which actually implements
//     the comparison function. It is allocated by the global InternalQCM
//     object based on the Comparison object defining the comparison,
//     and the indexer and path to which this comparison is applied.
//     This 'CompCalc' would be called to perform the comparison for
//     determining the ordering at composed function results.

// %%include%%: "funcResult.js"
// %%include%%: "comparison.js"
// %%include%%: "compCalc.js"
// %%include%%: "partitionCompCalc.js"

inherit(CompResult, FuncResult);

// all CompResult nodes created, by ID
var debugAllCompResults = undefined; // initialized, if needed, by InternalQCM

//
// Constructor
//

// The constructor takes only the standard FuncResult argument: the
// global InternalQCM object.

function CompResult(internalQCM)
{
    this.FuncResult(internalQCM);

    if(debugAllCompResults !== undefined) // for debugging only
        debugAllCompResults[this.id] = this;
    
    this.comparison = undefined;
    this.compCalc = undefined;
}

// destroy function for this node (does not release the 'Comparison'
// object, only the CompCalc object).

CompResult.prototype.destroy = compResultDestroy;

function compResultDestroy()
{
    this.FuncResult_destroy();

    if(this.comparison)
        this.comparison.release();
    if(this.compCalc)
		this.qcm.releaseCompCalc(this, this.compCalc);

    if(debugAllCompResults !== undefined) // for debugging only
        delete debugAllCompResults[this.id];

}

// Indicate that this function result object is transparent to matches,
// which means that its dominated matches are identical to those of its
// data object.

CompResult.prototype.isMatchTransparent = compResultIsMatchTransparent;

function compResultIsMatchTransparent()
{
    return true;
}

////////////////////////////////////////////
// (Re-)setting the Comparison Definition //
////////////////////////////////////////////

// This function should be used to set and reset the comparison object
// which defines the comparison function. This is the only special
// interface function for this result node. In addition to this function,
// one need only use the standard 'setData()' function to insert the
// comparison result object into the function result chain.

CompResult.prototype.setComparison =
    compResultSetComparison;

function compResultSetComparison(comparison)
{
    if(this.comparison == comparison)
        return;

    if(this.comparison !== undefined)
        this.comparison.release(); // no longer used by this CompResult
    if(comparison !== undefined)
        comparison.allocate();
    
    this.comparison = comparison;

    if(this.resetCompCalc())
        // notify order* composed nodes of the new comparison function
        this.refreshOrdering();
}

// This function should be called when any of the arguments which detemine
// the identity of the CompCalc node changes (the Comparison object or
// the dominated indexer and path of the data). This function then calculates
// the new CompCalc object and sets it on the CompResult object.
// In tihs process it releases the old CompCalc object. The new CompCalc
// object may be undefined if some of the arguments for constructing it
// are missing (undefined).
// This function does not send an update notification to composed function
// result nodes that this change took place. This is the responsibility of the
// calling function.
// This function returns false if the CompCalc object did not change
// as a result of this operation and true if it did.

CompResult.prototype.resetCompCalc = compResultResetCompCalc;

function compResultResetCompCalc()
{
    var dataResult = this.dataObj;
    var indexer = dataResult ? dataResult.getDominatedIndexer() : undefined;

    var newCompCalc;
    if(indexer === undefined || this.comparison === undefined ||
       !this.isActiveStar() || !this.isOrderStar())
        newCompCalc = undefined;
    else
        newCompCalc = this.qcm.getCompCalc(this, this.comparison, indexer,
                                           dataResult.getDominatedProjPathId());

    if(this.compCalc === newCompCalc)
        return false; // nothing changed
    
    if(this.compCalc !== undefined)
        this.qcm.releaseCompCalc(this, this.compCalc);

    this.compCalc = newCompCalc;

    return true;
}


///////////////////////////////////
// Ordering FuncResult Interface //
///////////////////////////////////

// This function is called by the CompCalc object implementing the
// comparison defined by this node CompResult node when the comparison
// has changed. 

CompResult.prototype.compCalcRefreshed = compResultCompCalcRefreshed;

function compResultCompCalcRefreshed()
{
    // forward to composed order* nodes
    this.refreshOrdering();
}

// This function is called when this CompResult node becomes order*
// (that is, there is an active* ordering function composed* with this node).

CompResult.prototype.comparisonActivated = compResultComparisonActivated;

function compResultComparisonActivated()
{
    this.resetCompCalc();
    if(this.compCalc)
        this.compCalc.resultActivated(this);
}

// This function is called when this CompResult node stops being order*
// (that is, there is no active* ordering function composed* with this node).

CompResult.prototype.comparisonDeactivated = compResultComparisonDeactivated;

function compResultComparisonDeactivated()
{
    if(this.compCalc)
        this.compCalc.resultDeactivated(this);
    
    this.resetCompCalc();
}

////////////////////////////////////////
// Standard Function result Interface //
////////////////////////////////////////

// A comparison result node is active iff it is order* (that is, there is
// some composed* function which is an active* ordering function). 

CompResult.prototype.isActive =
    compResultIsActive;

function compResultIsActive()
{
    return this.isOrderStar();
}

// When the indexer and path of the data object of this node change,
// this object forwards this refresh to its composed nodes. In addition,
// it replaces its CompCalc node (since the identity of the CompCalc node
// depends on the indexer and path). If the CompCalc node changed as a result
// of this operation, the function sends an 'order refresh' message to all
// composed order* function result nodes. This refresh message is received
// by those nodes after they have received the 'refresh indexer and path'
// message (assuming it reached them, as there may be a result indexer
// long the way). The 'order refresh' reaches the result nodes before
// any match updates reach them.

CompResult.prototype.refreshIndexerAndPaths =
    compResultRefreshIndexerAndPaths;

function compResultRefreshIndexerAndPaths(dataObj)
{
    var compCalcChanged = this.resetCompCalc();

    // forward refresh to composed active* nodes
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive)
            this.composedActive[resultId].refreshIndexerAndPaths(this);

    // if the comparison changed, notify the dominating nodes of this
    // after they are notified of the change in indexer and path
    // (this arrives before match updates are sent).
    if(compCalcChanged)
        this.refreshOrdering();
}

// This function is called when the dominated indexer and path of
// the data changed but continue to represent the same data as before
// (this is usually due to the insertion or removal of a result indexer
// along the way). In this case, the replacement has to be forwarded
// to the composed active* nodes. In addition, the CompCalc node
// may need to be replaced, but there is no need to send an 'order refresh'
// message, since nothing really changed.

// in case of replacement, should allow the compCalc object to take over
// the keys from the old compCalc, as those keys are the same xxxxxxxxxx 

CompResult.prototype.replaceIndexerAndPaths =
    compResultReplaceIndexerAndPaths;

function compResultReplaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                          newIndexerContained, dataObj)
{
    var compCalcChanged = this.resetCompCalc();

    // forward replace to composed active* nodes
    if(this.composedActiveNum > 0)
        for(var resultId in this.composedActive) {
            this.composedActive[resultId].
                replaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                       newIndexerContained, this);
        }
}

// This function is called when the match count of the data  object is
// increased. If the match count increased from zero (to a non-zero value)
// the match count of this node also increases from 0 to 1 and this
// match count increase must be propagated to the active composed nodes
// (together with the matches, which are passed through as is).

CompResult.prototype.increaseMatchCount =
    compResultIncreaseMatchCount;

function compResultIncreaseMatchCount(incMatchCount, dataResultMatches, source)
{
    if(incMatchCount === 0 ||
       this.dataObj.getDomMatchCount() - incMatchCount > 0)
        return; // did not increase from zero to non-zero

    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        composedResult.increaseMatchCount(1, dataResultMatches, this);
    }
}

// This function is called when the match count of the data  object is
// decreased. If the match count decreased to zero (from a non-zero value)
// the match count of thi node also decreases from 1 to 0 and this
// match count decrease must be propagated to the active composed nodes
// (together with the matches, which are passed through as is).

CompResult.prototype.decreaseMatchCount =
    compResultDecreaseMatchCount;

function compResultDecreaseMatchCount(decMatchCount, dataResultMatches, source)
{
    if(decMatchCount === 0 || this.dataObj.getDomMatchCount() > 0)
        return; // did not drop from non-zero to zero

    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        composedResult.decreaseMatchCount(1, dataResultMatches, this);
    }
}

// Since this only forwards the matches, the default implementation is used 

CompResult.prototype.addDataObjMatches =
    compResultAddDataObjMatches;

function compResultAddDataObjMatches(oldDataObj, indexerAndPathChanged)
{
    if(this.dataObj === undefined)
        return;

    if(this.dataObj.getDomMatchCount() == 0 &&
       !this.hasNonQueryActiveComposed())
        // nothing to do, as this node is directly composed with the indexer
        // and queries have direct access to the indexer
        return;

    this.FuncResult_addDataObjMatches(oldDataObj, indexerAndPathChanged);
}

// Since this only forwards the matches, the default implementation is used 

CompResult.prototype.removeDataObjMatches =
    compResultRemoveDataObjMatches;

function compResultRemoveDataObjMatches(newDataObj, indexerAndPathChanged)
{
    if(this.dataObj === undefined)
        return;
    
    if(this.dataObj.getDomMatchCount() == 0 &&
       !this.hasNonQueryActiveComposed())
        // nothing to do, as this node is directly composed with the indexer
        // and queries have direct access to the indexer
        return;

    this.FuncResult_removeDataObjMatches(newDataObj, indexerAndPathChanged);
}

// This function simply forwards the matches to all active* composed nodes.

CompResult.prototype.addMatches =
    compResultAddMatches;

function compResultAddMatches(elementIds, source)
{
    if(this.compCalc !== undefined &&
       this.compCalc.needToSuspendOrderingUponAddition()) {
        // suspends any dominating order services so that the matches
        // forwarded through this node will only be processed at the end
        // of the queue, to make sure the comparison function is ready
        this.refreshOrdering();
    }
    
    // if the match count is zero, no need to update composed queries
    var updateNonQueriesOnly = (this.getDomMatchCount() == 0);

    if(updateNonQueriesOnly && !this.hasNonQueryActiveComposed())
        return;
    
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(updateNonQueriesOnly &&
           (composed instanceof InternalQueryResult))
            continue;
            
        composed.addMatches(elementIds, this);
    }
}

// This function simply forwards the removal to all active* composed nodes.

CompResult.prototype.removeMatches =
    compResultRemoveMatches;

function compResultRemoveMatches(elementIds, source)
{
    // if the match count is zero, no need to update composed queries
    var updateNonQueriesOnly = (this.getDomMatchCount() == 0);

    if(updateNonQueriesOnly && !this.hasNonQueryActiveComposed())
        return;
    
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(updateNonQueriesOnly &&
           (composed instanceof InternalQueryResult))
            continue;
            
        composed.removeMatches(elementIds, this);
    }
}

// This function simply forwards the removal to all active* composed nodes.

CompResult.prototype.removeAllMatches =
    compResultRemoveAllMatches;

function compResultRemoveAllMatches(source)
{
    // if there are active composed results, forward the request to them
    
    if(this.composedActiveNum == 0)
        return; // no composed functions to forward to
    
    for(var resultId in this.composedActive)
        this.composedActive[resultId].removeAllMatches(this);
}

// This object does not distinguish between matches and projection matches
// and forwards them all as matches

CompResult.prototype.addProjMatches =
    compResultAddProjMatches;

function compResultAddProjMatches(elementIds, resultId, projId)
{
    this.addMatches(matches, this.dataObj);
}

// This object does not distinguish between matches and projection matches
// and forwards them all as matches

CompResult.prototype.removeProjMatches =
    compResultRemoveProjMatches;

function compResultRemoveProjMatches(elementIds, resultId, projId)
{
    this.removeMatches(matches, this.dataObj);
}

// This function returns the dominated indexer of its data

CompResult.prototype.getDominatedIndexer =
    compResultGetDominatedIndexer;

function compResultGetDominatedIndexer()
{
    return (this.dataObj === undefined ?
            undefined : this.dataObj.getDominatedIndexer());
}

// This function returns the dominated projection path of its data

CompResult.prototype.getDominatedProjPathId =
    compResultGetDominatedProjPathId;

function compResultGetDominatedProjPathId()
{
    return (this.dataObj === undefined ?
            undefined : this.dataObj.getDominatedProjPathId());
}

// Returns the value defined by its data

CompResult.prototype.getDominatedProjPathNum =
    compResultGetDominatedProjPathNum;

function compResultGetDominatedProjPathNum()
{
    return (this.dataObj === undefined ?
            undefined : this.dataObj.getDominatedProjPathNum());
}

// Returns the value defined by its data

CompResult.prototype.getDominatedProjMappings =
    compResultGetDominatedProjMappings;

function compResultGetDominatedProjMappings()
{
    return (this.dataObj === undefined ?
            undefined : this.dataObj.getDominatedProjMappings());
}

// The terminal projection matches are the dominated matches of the data object.

CompResult.prototype.getTerminalProjMatches =
    compResultGetTerminalProjMatches;

function compResultGetTerminalProjMatches(projId)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.getDominatedMatches();
}

// The terminal projection matches are the dominated matches of the data object.

CompResult.prototype.filterTerminalProjMatches =
    compResultFilterTerminalProjMatches;

function compResultFilterTerminalProjMatches(projId, elementIds)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.filterDominatedMatches(elementIds);
}

// Returns 0 if the data's match count is zero and 1 otherwise.

CompResult.prototype.getDomMatchCount =
    compResultGetDomMatchCount;

function compResultGetDomMatchCount()
{
    if(this.dataObj === undefined)
        return 0;
    
    return this.dataObj.getDomMatchCount() == 0 ? 0 : 1; 
}

// return the matches of the data object (as an array) 

CompResult.prototype.getDominatedMatches =
    compResultGetDominatedMatches;

function compResultGetDominatedMatches()
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.getDominatedMatches();
}

// return the matches of the data object (as an object) 

CompResult.prototype.getDominatedMatchesAsObj =
    compResultGetDominatedMatchesAsObj;

function compResultGetDominatedMatchesAsObj()
{
    if(this.dataObj === undefined)
        return new Map();

    return this.dataObj.getDominatedMatchesAsObj();
}

// This function receives as input a list (array) of data element IDs
// and returns an array with a subset of the input array of element IDs
// which are matches of result object, which means that these are matches
// of the data object. This function is implemented by passing the
// call to the data object.

CompResult.prototype.filterDominatedMatches =
    compResultFilterDominatedMatches;

function compResultFilterDominatedMatches(elementIds)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.filterDominatedMatches(elementIds);
}

// This function receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are matches of result object, which means that these are matches
// of the data object. This function is implemented by passing the
// call to the data object.

CompResult.prototype.filterDominatedMatchPositions =
    compResultFilterDominatedMatchPositions;

function compResultFilterDominatedMatchPositions(elementIds)
{
    if(this.dataObj === undefined)
        return [];

    return this.dataObj.filterDominatedMatchPositions(elementIds);
}

// Return the dominated identification of the data object

CompResult.prototype.getDominatedIdentification =
    compResultGetDominatedIdentification;

function compResultGetDominatedIdentification()
{
    if(this.dataObj === undefined)
        return undefined;

    return this.dataObj.getDominatedIdentification();
}

// This comparison result node is the dominated comparison for all functions
// composed with it. It therefore returns here a new CompInfo object
// containing itself.

CompResult.prototype.getDominatedComparison = 
    compResultGetDominatedComparison;

function compResultGetDominatedComparison()
{
    return new CompInfo(this);
}

//////////////
// CompInfo //
//////////////

// This is an auxiliary object which carries information about the comparison
// between different result nodes. It carries the CompResult node which applies
// to the dominated matches of a certain result node together with information
// pertaining to the sequence of result nodes which appear between the
// CompResult node which defines the comparison and the result node to
// which the CompInfo applies. For example, if some projections have taken
// place between the two result nodes then the CompInfo object may indicate
// that raising may need to take place to the element IDs being compared
// before the comparison can be applied.
//
// The CompInfo is generated anew each time the order service needs to
// perform an ordering update (adding/removing elements or re-ordering
// existing elements). Therefore, the CompInfo object is always
// up-to-date and there is no need to send notifications when it changes
// (the cost of constructing this object is small).
//
// The CompInfo object is also used to generate the coparison function
// to be used. This function is constructed using closure, thus
// incorporating various information into the function. The choice
// a to which comparison function to construct is dependent on the
// parameters of the CompInfo object.
//
// Remark: currently we do not yet support passing ordering through a merge
// from two different sources. xxxxxxxxxxxxxx
//
// Remark: this comparison functions defined below can further be
// optimized by caching the key used in the previous comparison,
// since (at least for the first argument) there is a good chance that
// it will be repeated in the next call xxxxxxxxxxxx
//
// Object Structure
// ----------------
//
// {
//     compResult: <CompResult>,
//     domCompInfo: <CompInfo>,
//     needToRaise: true|false,
//     translations: undefined|[<array of translation objects>]
// }
//
// compResult: this is the topmost CompResult object which defines the
//     ordering defined by this CompInfo object.
// compInfo: this is the CompInfo of the data object of the CompResult
//     object stored here (this may also be undefined). Every CompInfo
//     object also has a domCompInfo field, so this provide the calling
//     function with the full chain of comparisons which apply at the
//     place where the getDominatedComparison() is called. This is
//     used to generate the compare function used by the order service.
// needToRaise: if there are projections between the result node
//     which returned this CompInfo object and the CompResult object,
//     and there are data elements defined between the projected path
//     and the path at which the comparison result is defined,
//     this flag is set to true, since the compared data elements
//     may need to be raised before being compared.
// translations: in case data element IDs are translated by merge
//     indexers along the function result chain between the CompResult
//     node and the result node for which this CompInfo object is
//     generated, a translation object must be stored in this list of
//     translations. Such a translation object should implement a
//     function get() which, given an element ID, returns the source element
//     ID (the ID of the element before it was mapped in the merge indexer).
//     These translations will be applied from first to last before
//     applying the comparison (so each merge indexer should push its
//     translation object at the beginning of this list).

//
// Constructor
//

// A CompInfo object is always created on a CompResult object and carries
// that CompResult object. At that point, neither raising or translation is
// required.

function CompInfo(compResult)
{
    this.compResult = compResult;
    this.domCompInfo = this.compResult.dataObj ?
        this.compResult.dataObj.getDominatedComparison() : undefined;
    this.needToRaise = false;
    this.translations = undefined;
}

// This function sets the 'needToRaise' property to true

CompInfo.prototype.setNeedToRaise = compInfoSetNeedToRaise;

function compInfoSetNeedToRaise()
{
    this.needToRaise = true;
}

// This function adds the given translation object (which should translate
// element IDs to element IDs, see introduction) at the beginning of the
// list of translations.

CompInfo.prototype.unshiftTranslation  = compInfoUnshiftTranslation;

function compInfoUnshiftTranslation(translation)
{
    if(this.translations === undefined)
        this.translations = [translation];
    else
        this.translations.unshift(translation);
}

// This function generates a comparison function based on the properties
// in this CompInfo object and returns the function. Using closure, the
// returned function contains enough information to perform the comparison.

CompInfo.prototype.getCompareFunc = compInfoGetCompareFunc;

function compInfoGetCompareFunc()
{
    var domCompFunc;
    
    if(this.domCompInfo !== undefined)
        domCompFunc = this.domCompInfo.getCompareFunc();
    
    if(this.compResult.compCalc === undefined) {
        // no comparison
        if(domCompFunc !== undefined)
            return domCompFunc;
        else
            return function(elementId1, elementId2) {
                return elementId1 - elementId2;
            };
    }

    // compare function for this CompResult node
    var resultCompareFunc = this.compResult.compCalc.getCompareFunc();

    var baseCompareFunc; // this CompResult's comparison + dominated comparison
    if(this.domCompInfo === undefined) {
        baseCompareFunc = function(elementId1,elementId2) {
            var cmp = resultCompareFunc(elementId1,elementId2);
            if(cmp === 0)
                return (elementId1 - elementId2);
            return cmp;
        };
    } else {
        baseCompareFunc = function(elementId1,elementId2) {
            var cmp = resultCompareFunc(elementId1,elementId2);
            if(cmp === 0)
                return domCompFunc(elementId1, elementId2);
            return cmp;
        };
    }

    var raiseAndCompFunc;
    
    if(this.needToRaise) {
        var raisingFunc = this.compResult.compCalc.getRaisingFunc();
        raiseAndCompFunc = function(elementId1, elementId2) {
            var elementId1 = raisingFunc(elementId1);
            var elementId2 = raisingFunc(elementId2);
            return baseCompareFunc(elementId1, elementId2);
        }
    } else
        raiseAndCompFunc = baseCompareFunc;

    if(this.translations === undefined)
        return raiseAndCompFunc;

    if(this.translations.length == 1) {
        var translation = this.translations[0];
        return function(elementId1, elementId2) {
            elementId1 = translation.get(elementId1);
            elementId2 = translation.get(elementId2);
            return raiseAndCompFunc(elementId1, elementId2);
        }
    } else {
        var l = this.translations.length;
        var translations = this.translations;
        return function(elementId1, elementId2) {
            for(var i = 0 ; i < l ; ++i) {
                var translation = translations[i];
                elementId1 = translation.get(elementId1);
                elementId2 = translation.get(elementId2);
            }
            return raiseAndCompFunc(elementId1, elementId2);
        };
    }
}

