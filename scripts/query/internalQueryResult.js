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


"use strict";

// To use this object, first construct it with the global InternalQCM object,
// then set the Query object on it (using 'setQuery()') and then attach it
// into a function application chain by first adding it as the source
// of the data of some composed result object and then assigning it 
// data by calling its own setData() function with the result object
// representing its data.
// These steps can be carried out in any order, but this is the order in
// which the least number of unnecessary updates take place.

// Object Structure
// ----------------
//
// Below appear only the fields which are specific to this derived class
// of the query result object. The fields which belong to the base class
// QueryResult are documented in QueryResult.js
//
// {
//     query: <Query object for this query>
//     rootQueryCalc: <InternalRootQueryCalc>,
//
//     dominating: <InternalQueryResult>
//
//     assumeNonZeroDomMatchCount: true|false
//     isPureProjection: true|false
//     matchCount: <number> // may be zero on an active projection node
//     projMatchCount: 0|1
//     matches: <Map object>: {
//         <element ID>: <count>
//         .....
//     }
//
//     pendingAddMatches: undefined|
//         <Array of:
//            {
//                elementIds: <array of element IDs>,
//                source: <source of added matches>,
//                matchCount: <number>
//            }
//            .....
//         >
//
//     pendingSetData: true|undefined
//     pendingRootRefresh: true|undefined
//     pendingIndexerReplace: true|undefined
//
//     resultIndexer: <MergeIndexer>
//     resultIndexerQueryCalc: <QueryResultQueryCalc>
// }
//
// query: this is the Query object which defines the query which is 
//    performed under this result object. This Query object may be
//    replaced dynamically, but it is assumed that this does nto happen
//    often. It is best to set the query before calling 'setData()' with
//    the data for this query. 
// rootQueryCalc: this is the root query calculation node assigned for
//    the calculation of this query. This may be shared by other query
//    applications which have the same Query object, the same indexer and
//    the same projection path.
//    An undefined rootQueryCalc is considered an empty selection
//    (which matches nothing).
//
// dominating: if this node is part of a query application chain and
//    is itself not active but is active*, this is the dominating 
//    internal query result object which is active and to which this 
//    query result object forwards the updates of its root query 
//    calculation node.
// matchCount: this is the count a data element needs to get in order
//    to be considered selected on this node. This is the total number 
//    of the selection root query calulation nodes dominated by this 
//    result node plus the dominated match count of the result node
//    dominated by this node (if any). The dominated match count of a
//    result node is 0 or 1 if it is not a selection node (whether it is 
//    a query or not) and its match count if it is a selection.
// assumeNonZeroDomMatchCount: this flag is set upon construction. It
//    provides a hint to the query result object as to what kind of
//    configurations it may appear in. Specifically, it indicates to
//    the query result object that it is likely at some point to be composed
//    with a data object whose dominated match count is not zero (even if
//    at first the data object has a zero dominated match count). This
//    may influence various decisions made by the query result node
//    (for example, whether to create a result indexer).
// isPureProjection: this indicates whether the current query is a pure
//    projection or not. This flag is stored here so that when the
//    query structure changes we still know the previous state of this property.
//    This property is set to false if no query is defined. But this
//    property is based on the Query object and not on the root query
//    calculation object, so it is correctly determined even before
//    the root query calculation node is created.
// projMatchCount: if the result node is active and the root projection
//    node is a projection, this is 1 and otherwise it is zero. 
//    matchCount + projMatchCount is returned by the function  
//    dominatedCount(). This is the total number of queries dominated by 
//    this result node. This is equal to matchCount if the query under 
//    this result node is a selection and is matchCount + 1 if it is 
//    a projection. dominatedCount() is non-zero iff the result node is active.
// matches: this table holds the match count for each element matched
//    by the selection nodes dominated by this result node. This table appears
//    only on active nodes. If the matchCount is 1, this table is not
//    needed because the information it holds is equivalent to the
//    match information stored in the matches of its root query calculation
//    node (if it is a selection) or the single root query calculation node
//    or result node it dominates. Therefore, when the match count is 1 or 0, 
//    'matches' is not defined.
// pendingAddMatches: in the process of activating this node, it may
//    receive 'addMatches' calls from lower result nodes while it itself
//    is not yet active* (it will be in a state of 'active* pending', see
//    FuncResult). Similarly, in the process of replacing the data object
//    under this node, this node may receive 'addMatches' updates
//    from the new data object chain before it is ready to process them.
//    In both cases, these matches are then buffered on the 'pendingAddMatches'
//    queue, which is simply an array holding objects storing the
//    arguments of each adMatches() call received. These will be used
//    either by the data object refresh functions or to call the 'addMatches()'
//    function once the node has completed its activation and has become
//    active*.
// pendingSetData: this flag is set to true on an active query result node
//    at the beginning of a setData() operation on the active query result
//    node itself or on any of the non-active query result nodes for which
//    this node is the dominating node (that is, the node which receives
//    their match updates). While this flag is set, match updates are queued
//    and not processed. These updates should only consist of addMatches
//    updates sent from the new data object (and, if it is not active,
//    from lower data objects).
// pendingRootRefresh: this flag is set to true just before the root
//    query calculation node of this query result node is refresh
//    and set to undefined when the root query calculation node has been set.
//    Any (selection) matches added by the root query calculation node
//    during this process will be queued and only added to rhe result node
//    after the refresh process has been completed (e.g. the match count
//    has been updated).
// pendingIndexerReplace: this flag is set during an operation where
//    the indexer and path are replaced but the new indexer and path
//    contain the same data as the old indexer and path (for example,
//    when a result indexer is inserted or removed). Setting this flag
//    allows updates to be blocked where these are generated but can be
//    ignored (since the matches did not change).

// resultIndexer: when the query has multiple projection sites 
//    and some of the active composed functions do not support 
//    such multi-projections or when required to index the result for 
//    more efficient composition, this field holds a merge indexer object 
//    which indexes the result of this query.
// resultIndexerQueryCalc: when a resultIndexer is used and non-query
//    result functions are composed with the query result node, match
//    updates from the result indexer need to be forwarded by the query result
//    node to the composed function results (composed query results
//    register directly on the result indexer). For this purpose, this
//    InternalQueryResult uses the query calculation node stored here.
//    This QueryResultQueryCalc registers as a projection on the root
//    of the result indexer and forwards add/remove matches notifications.

// %%include%%: "funcResult.js"
// %%include%%: "mergeIndexer.js"
// %%include%%: "queryResultQueryCalc.js"

inherit(InternalQueryResult, FuncResult);

// all InternalQueryResult nodes created, by ID
var debugAllQueryResults = undefined;  // initialized, if needed, by InternalQCM

//
// Constructor
//

// takes the internal QCM object which provides it with different global
// services (path ID allocation, compression, etc.) as the first argument.
// In addition, one may optionally provide a second argument, which, if true,
// indicates that the query result node should assume that its data object
// will have a match count which is not zero (this allows the object to
// prepare for this situation, for example by constructing a result
// indexer even if no such result indexer is initially required based on
// the standard criteria).
 
function InternalQueryResult(internalQCM, assumeNonZeroDomMatchCount)
{
	this.FuncResult(internalQCM);

    if(debugAllQueryResults !== undefined) // for debugging only
        debugAllQueryResults[this.id] = this;

    this.isPureProjection = false; // no query defined yet
    this.assumeNonZeroDomMatchCount = !!assumeNonZeroDomMatchCount;
    
    this.matchCount = 0;
    this.projMatchCount = 0;
}

// Destroy the query result

InternalQueryResult.prototype.destroy = internalQueryResultDestroy;

function internalQueryResultDestroy()
{
    this.FuncResult_destroy();

    if(this.resultIndexer)
        this.destroyResultIndexer();

	if(this.rootQueryCalc)
		this.qcm.releaseRootQueryCalc(this, this.rootQueryCalc);

    if(debugAllQueryResults !== undefined) // for debugging only
        delete debugAllQueryResults[this.id];

    if(this.doDebugging)
        this.debugMessage("destroying query result ", this.getId());
}

//////////////////////
// Access Functions //
//////////////////////

// This function returns the indexer used to calculate the query under
// root query calculation node of this result node. If the root query 
// calculation node is undefined, the query represents an empty selection.
// This means that if the query is applied to the output of another
// query, the 'dominated indexer' of the result node of this input query
// (the 'dataObj') is returned. This is the result indexer of
// the dataObj if the result is indexed and the indexer used
// to calculate the query under dataObj if the result is not
// indexed. If the root query calculation node is undefined and
// the result is applied directly to data (not to the result of a query)
// this function returns undefined.

InternalQueryResult.prototype.getIndexer = internalQueryResultGetIndexer;

function internalQueryResultGetIndexer()
{
    return this.getIndexerByRoot(this.rootQueryCalc);
}

// This function returns the indexer used to calculate the query under
// the given root query calculation node assuming it is assigned to this 
// result node (this function is sometimes called in the process
// of replacing the root query calculation node and we then want to
// know which indexer s used for both the old and the new root query 
// calculation node). If the root query calculation node is defined,
// this returns the indexer stored on that node. If the root query 
// calculation node is undefined, the query represents an empty selection.
// This means that if the query is applied to the output of another
// query, the 'dominated indexer' of the result node of this input query
// (the 'dataObj') is returned. This is the result indexer of
// the dataObj if the result is indexed and the indexer used
// to calculate the query under dataObj if the result is not
// indexed. If the root query calculation node is undefined and
// the result is applied directly to data (not to the result of a query)
// this function returns undefined.

InternalQueryResult.prototype.getIndexerByRoot = 
    internalQueryResultGetIndexerByRoot;

function internalQueryResultGetIndexerByRoot(rootQueryCalc)
{
	if(!rootQueryCalc) {
        if(this.dataObj)
            return this.dataObj.getDominatedIndexer();
		return undefined;
    }

	return rootQueryCalc.getIndexer();
}

// Return the prefix projection path of the root query calculation node
// used by this result node. If no root query result node is defined,
// this returns the root path ID.

InternalQueryResult.prototype.getPrefixProjPathId = 
	internalQueryResultGetPrefixProjPathId;

function internalQueryResultGetPrefixProjPathId()
{
	if(!this.rootQueryCalc)
		return this.qcm.getRootPathId();

	return this.rootQueryCalc.prefixProjPathId;
}

// If the query has a single projection path or no projection paths
// (it is a selection) this function returns the path ID of this path 
// in the indexer. If there is no projection path, this returns the
// path ID of the root path node of the tree. If there is more than one
// projection path, this functions returns undefined.

InternalQueryResult.prototype.getProjectionPathId = 
	internalQueryResultGetProjectionPathId;

function internalQueryResultGetProjectionPathId()
{
	if(!this.rootQueryCalc)
		return undefined;

	return this.rootQueryCalc.getProjectionPathId();
}

// This function returns true if there are multiple projection in the 
// query belonging to this result object and false otherwise.

InternalQueryResult.prototype.hasMultipleProjPaths = 
	internalQueryResultHasMultipleProjPaths;

function internalQueryResultHasMultipleProjPaths()
{
	if(!this.rootQueryCalc)
		return false;
	
	return this.rootQueryCalc.hasMultipleProjPaths();
}

////////////////////////
// Property Functions //
////////////////////////

// This function returns true if this query result node and all the result
// nodes it dominates down to the indexer to which this query is applied
// (the dominated indexer) do not perform any selection. This holds if
// the match count is 0 (meaning that up to that node no such selection
// took place) and if this query is a pure projection query (no selection
// or multi-projection)

InternalQueryResult.prototype.hasNoSelectionOnIndexer =
    internalQueryResultHasNoSelectionOnIndexer;

function internalQueryResultHasNoSelectionOnIndexer()
{
    return (this.matchCount == 0 && this.isPureProjection);
}

// This function returns 1 if this is a selecting query (not a pure projection)
// or if the 'assumeNonZeroDomMatchCount' flag is set (as this indicates
// that selections may be inserted under this pure projection). It returns
// its own number of selecting composed* active* if this is not
// a selecting query (an empty query is considered a selection until
// determined otherwise).

InternalQueryResult.prototype.getComposedSelectingNum =
    internalQueryResultGetComposedSelectingNum;

function internalQueryResultGetComposedSelectingNum()
{
    return this.isPureProjection &&
        !this.assumeNonZeroDomMatchCount && !this.resultIndexer ?
        this.composedSelectingNum : 1;
}

//////////////////////////
// Dominated Properties //
//////////////////////////

// This function returns the indexer which should be used by a query
// composed with this result node. If the result node has result indexer,
// that indexer is returned. Otherwise, the indexer used to calculate the
// query under this result node is returned.

InternalQueryResult.prototype.getDominatedIndexer = 
    internalQueryResultGetDominatedIndexer;

function internalQueryResultGetDominatedIndexer()
{
    if(this.resultIndexer)
        return this.resultIndexer;
    else
        return this.getIndexer();
}

// This function returns the projection path of the result of this query
// relative to the indexer used by the dominating query applications and
// the external result (that is, the indexer returned by 
// 'getDominatedIndexer()'). If this result node has a result indexer,
// the result is represented relative to the result indexer and the 
// path is always the root path. Otherwise, the query may have at most
// one projection path and this path is returned.

InternalQueryResult.prototype.getDominatedProjPathId = 
    internalQueryResultGetDominatedProjPathId;

function internalQueryResultGetDominatedProjPathId()
{
    if(this.resultIndexer)
        return this.qcm.getRootPathId();
    else
        return this.getProjectionPathId();
}

// this is the number of projection paths of this result node, as seen by 
// composed result nodes. If this result node has no result indexer
// and the root query calculation node is a projection, 
// this is the number of projection paths returned by the root query 
// calculation node. Otherwise, this is 1.

InternalQueryResult.prototype.getDominatedProjPathNum = 
    internalQueryResultGetDominatedProjPathNum;

function internalQueryResultGetDominatedProjPathNum()
{
    if(this.resultIndexer || !this.rootQueryCalc || 
       !this.rootQueryCalc.isProjection())
        return 1;

    return this.rootQueryCalc.getTerminalGeneratingProjNum();
}

// This function returns the path mappings of this result node, as seen by
// composed result nodes. This is returned as a Map object whose keys
// are the projection IDs (of the terminal geenrating projections)
// and where the value under each key is an array describing 
// the path mapping for that projection (see the documentation of 
// InternalRootQueryCalc.generatingProjMapping() for information about this
// array).
// If this node has a result indexer, the root of the result indexer holds
// the result. This is then returned as projection ID 0 with path mapping
// [<root path ID>, <root path ID>]. Otherwise, the projection mappings
// are those returned by the root query calculation node.
// If there is no root query calculation node, this returns undefined.

InternalQueryResult.prototype.getDominatedProjMappings = 
    internalQueryResultGetDominatedProjMappings;

function internalQueryResultGetDominatedProjMappings()
{
    if(!this.rootQueryCalc)
        return undefined;

    if(this.resultIndexer) {
        // the result is found at the root path of the result indexer
        var mapping = new Map();
        mapping.set(0, [this.qcm.getRootPathId(), this.qcm.getRootPathId()]); 
        return mapping;
    }

    return this.rootQueryCalc.getGeneratingProjMappings();
}

// Return the terminal projection matches of the given projection ID,
// which may be either zero of a ID of a terminal projection of the
// query under this node. If ID is 0, this function returns the selection
// matches of the query and if the ID is not 0, this request is forwarded
// to the root query calculation node.

InternalQueryResult.prototype.getTerminalProjMatches =
    internalQueryResultGetTerminalProjMatches;

function internalQueryResultGetTerminalProjMatches(projId)
{
    if(this.rootQueryCalc === undefined)
        return [];
    
    if(projId == 0)
        return this.getSelectionMatches();
    
    return this.rootQueryCalc.getTerminalProjMatches(this.getId(), projId);
}

// this function returns an array which is a subset of the input array
// <element IDs> such that the returned array only contains those
// elements in <element IDs> which are also in the array returned by
// getTerminalProjMatches(<projection ID>).

InternalQueryResult.prototype.filterTerminalProjMatches =
    internalQueryResultFilterTerminalProjMatches;

function internalQueryResultFilterTerminalProjMatches(projId, elementIds)
{
    if(this.rootQueryCalc === undefined)
        return [];
    
    if(projId == 0)
        return this.filterSelectionMatches(elementIds);
    
    return this.rootQueryCalc.filterTerminalProjMatches(this.getId(), projId,
                                                        elementIds);
}

// Return the identification ID which applies to this result. This must 
// be an identification which is defined on the dominated indexer of this
// result object. If there is no result indexer, this is simply the 
// identification received from the data result object. If there is 
// a result indexer, this is undefined, as the identification received
// from the data result object is stored as the base identity in the 
// result indexer.

InternalQueryResult.prototype.getDominatedIdentification = 
    internalQueryResultGetDominatedIdentification;

function internalQueryResultGetDominatedIdentification()
{
    if(this.resultIndexer)
        return undefined;

    return this.dataObj ? 
        this.dataObj.getDominatedIdentification() : undefined;
}

// The dominated comparison is based on the dominated comparison of
// the data. If the data has no comparison function defined, this
// function also returns undefined. However, if a comparison is defined,
// this function needs to check whether it modifies that comparison in
// one of two ways:
// 1. If this query defines a projection and there are data elements along
//    this projection path, this function sets a flag on the comparison
//    information object to indicate that raising may be required before
//    the comparison is applied.
// 2. If there is a merge indexer defined, and this merge indexer performs
//    element ID translation, this translation needs to be pushed on the
//    list of translations which need to be applied before the comparison
//    can take place.

InternalQueryResult.prototype.getDominatedComparison = 
    internalQueryResultGetDominatedComparison;

function internalQueryResultGetDominatedComparison()
{
    if(this.dataObj === undefined)
        return undefined;
    
    var compInfo = this.dataObj.getDominatedComparison();

    if(compInfo === undefined)
        return undefined;
    
    if(this.rootQueryCalc !== undefined &&
       this.rootQueryCalc.needToLower())
        compInfo.setNeedToRaise();
        
    if(!this.resultIndexer)
        return compInfo;

    // check whether a translation is required by the result indexer
    // (this is only in case of a multi-projection)
    var translation = this.resultIndexer.getElementTranslation();

    if(translation !== undefined)
        compInfo.unshiftTranslation(translation);

    return compInfo;
}

////////////////////////////
// Match Status Functions //
//////////////////////////// 

// Returns the total number of root query calculation nodes dominated
// by this result node. This is non-zero iff the result node is active.

InternalQueryResult.prototype.dominatedCount = 
	internalQueryResultDominatedCount;

function internalQueryResultDominatedCount()
{
    return this.matchCount + this.projMatchCount;
}

// This function returns true if this query result node should be active
// and false otherwise. To be active, this node should be active* and either:
// 1. Have an active* composed function which is not a query.
// 2. Be a projection.
// 3. Have more than one active* composed function.
// If the query or data object or dominated indexer are missing, the result
// node should not be active.

InternalQueryResult.prototype.calcIsActive = 
	internalQueryResultCalcIsActive;

function internalQueryResultCalcIsActive()
{    
    return (this.query !== undefined && this.dataObj !== undefined &&
            this.dataObj.getDominatedIndexer() !== undefined &&
             (this.composedActiveNum > 0 &&
              (this.composedActiveNum > this.composedQueryResultNum || 
               this.query.isProjection() || 
               this.composedQueryResultNum > 1)));
}

// This function returns true if this node was activated, that is, if its
// dominated count is not zero. During the refresh of the root query
// calculation node (when the 'pendingRootRefresh' is set) the node is
// temporarily deactivated, as the match counts still need to be determined.

InternalQueryResult.prototype.isActive = internalQueryResultIsActive;

function internalQueryResultIsActive()
{
    return !!this.dominatedCount() && !this.pendingRootRefresh;
}

// This function returns true iff this result node restricts the projection
// calculated by the query under its root query calculation node.
// The projection is restricted if the match count is at least 1.
// If the result node is not active, this also restricts the projection
// (so as to block it from calculating the projection before the result 
// node is ready).
// If the query is a trivial query and all active functions
// composed with it are queries, this result node is considered not active
// for this purpose (since it doesn't need to do anything).
// Note: this function should be called only when the query under it is
// a projection.

InternalQueryResult.prototype.restrictsProjection =
    internalQueryResultRestrictsProjection;

function internalQueryResultRestrictsProjection()
{
    return (this.matchCount != 0 || !this.isActive());
}

///////////////////////
// Setting the Query //
///////////////////////

// This function is used to set the Query object which defines the
// query to be performed under this result node. This Query object
// may be set and replaced at any time, but it is assumed that usually
// it is set immediately after construction of the result object
// (before the data object is set) and never modified again.
// In this case, all this function needs to do is store the Query object
// in the result object. Replacing the query object which no 
// data object is defined is just as simple.
// In other cases, the matches due to the query being removed
// (if any) need to be cleared and the new matches set. This is done
// by calling refreshIndexerAndPaths() (which takes care of clearing
// any existing matches and adding the matches of the root query calculation
// node under this result node) and then adding all the matches of the 
// data result object.

InternalQueryResult.prototype.setQuery = internalQueryResultSetQuery;

function internalQueryResultSetQuery(query)
{
    if(this.query == query)
        return; // nothing changed

    this.query = query;

    if(!this.dataObj) // no data source yet
        return;

    // reset the root query calculation node
    if(!this.resetRootQueryCalc(true, false))
        return; // root query calculation node did not change, nothing to do

    // get the projections of this query (may not be defined yet)
    var pathMapping = this.rootQueryCalc ?
        this.rootQueryCalc.getGeneratingProjMappings() : undefined;
    
    if(pathMapping === undefined) { // cannot happen if the root node exists

        // refresh match count and projection properties (if pathMapping
        // is defined, this happens inside 'updateTerminalProjs()').
        this.refreshMatchCount(false);
        this.resetProjProperties();
        
        if(!this.resultIndexer) {
            // refresh composed results (this change may have affected the
            // dominated path of composed nodes)
            for(var resultId in this.composedActive)
                this.composedActive[resultId].refreshIndexerAndPaths(this);
        } else { // if there is a result indexer, clear the mapping from it.
            this.setMappingsOnResultIndexer();
            return; // query not yet defined (will be refreshed later)
        }
    } else {
        this.updateTerminalProjs(pathMappings);
        // add the matches due to the root query calc under this query result
        // (at this point this result node must be active*)
        this.addRootQueryCalcMatches(true);
    }

    if(this.pendingAddMatches) { // queue may have been created during update
        this.pendingAddMatches = undefined;
    }
}

// This function may be called to modify the root query calculation node
// whenever this is required by a change in any of the objects which
// identify the root query calculation node (the Query object, the dominated
// indexer or the dominated projection path).
// This function then creates the new root query calculation node.
// A root query calculation node may be created only if the query and
// data object exist and if the result node is active*. Otherwise,
// an undefined root query calculation node is set.
// If the new root query calculation node turns out to be the same as
// the existing query calculation node, this function does nothing more
// and returns false (otherwise, true is returned).
// If the new root query calculation node is different from the previous one
// (either may be undefined in this case) and this function is called
// with 'removeOldQueryMatches' true, the matches due to the old
// root query calculation node (if not undefined) are removed
// (if the calling function wants to selectively remove the matches
// only of the root query calculation node and not clear all matches
// in the result node, this needs to take place here, before the old root
// query calculation node is released).
// The previous root query calculation node is released. The new root query
// calculation node is set on this result object.
// If the flag 'resetProjProperties' is set then, at the end of the process
// and only if the root query calculation node was replaced, this function
// resets the projection related properties of the query result node
// and the root query calculation node. This is optional since it is
// often better to perform this operation after the match counts were
// refreshed (this affects the 'restricts projection' property). If the
// calling function is about to call refreshMatchCount(), it can call
// this function with 'resetProjProperties' false and then call the
// function resetProjProperties() after refreshing the match
// count.

InternalQueryResult.prototype.resetRootQueryCalc =
    internalQueryResultResetRootQueryCalc;

function internalQueryResultResetRootQueryCalc(removeOldQueryMatches,
                                               resetProjProperties)
{
    var newRootQueryCalc;

	// get/create a root query calculation node for this query application. 
    // (only if it is active*).
    
	if(this.query && this.dataObj && this.isActiveStar()) {

        this.pendingRootRefresh = true; // to queue match updates
        
		var dataResult = this.dataObj;
        // use the dominated indexer and projection path of the data
        newRootQueryCalc =
			this.qcm.getRootQueryCalc(this, this.query,
									  dataResult.getDominatedIndexer(),
                                      dataResult.getDominatedProjPathId());

        this.pendingRootRefresh = undefined;
        
	} else // otherwise, no root query calculation node
        newRootQueryCalc = undefined;

    if(this.rootQueryCalc === newRootQueryCalc)
        return false; // nothing changed    

    // remove any activation lock set earlier
    if(this.query)
        this.query.unlockActive("InternalQueryResult");
    
    // clear the matches of the old root query calculation node
    // this is done with the old root query calculation node still set.
    // This is carried out only if the calling function requested it.
    if(this.rootQueryCalc && removeOldQueryMatches)
        this.clearRootQueryCalcMatches();

    if(this.rootQueryCalc)
        this.qcm.releaseRootQueryCalc(this, this.rootQueryCalc);

    this.rootQueryCalc = newRootQueryCalc;

    if(resetProjProperties)
        this.resetProjProperties();
    
    return true;
}

// This function clears the matches due to the query under the root query
// calculation node of this query result node. It does not remove any other
// matches. The removal is done using the standard match removal functions,
// so the removal is propagated in the usual way (specifically, this always
// implies that all full matches of this result node are removed, and this
// removal is forwarded to the dominating function result). 

InternalQueryResult.prototype.clearRootQueryCalcMatches = 
    internalQueryResultClearRootQueryCalcMatches;

function internalQueryResultClearRootQueryCalcMatches()
{
    if(this.rootQueryCalc && this.rootQueryCalc.isSelection()) {
        // this is a selection query, so we must fetch its selection
        // matches and remove them from the matches of this node
        var matches = this.rootQueryCalc.geMatches();
        this.removeMatches(matches, this, 1);
    } else if(this.isActive() &&
              (!this.hasNoSelectionOnIndexer() ||
               this.hasNonQueryActiveComposed())) {
        // this is a projection query, remove the matches of each of
        // the projections
        var generatingProjs = this.getTerminalGeneratingProjs();
        for(var i = 0, l = generatingProjs.length ; i < l ; ++i)
            this.removeAllTerminalProjMatches(generatingProjs[i]);
    }

    this.matches = undefined;
}

// This function sets the projection related properties of the root query
// calculation node and the query result node. This function is called
// after the root query calculation node has been replaced (including the
// case where it was first set). It should be called at the end of
// the reset operation, preferably after the match counts have also been
// refreshed (if they need to be refreshed).
// To refresh these properties on an existing root query calculation node
// after some relevant property has changed, call refreshProjProperties()

InternalQueryResult.prototype.resetProjProperties =
    internalQueryResultResetProjProperties;

function internalQueryResultResetProjProperties()
{
    this.refreshIsPureProjection(); // this property depends on the query
    
    // If this is a projection, check whether this result requires explicit
    // projection matches and, if yes, set this mode (this only applies to
    // projections and since the result has just now been registered on this
    // root query calculation node, there could have been no projection
    // matches added yet for this result).
    if(this.rootQueryCalc && this.rootQueryCalc.isProjection() &&
       this.requiresExplicitProjMatches())
        this.rootQueryCalc.initExplicitProjMatches(this.getId());
    
    this.refreshProjMustGenerateMatches();
}

// This function sets the projection related properties of the root query
// calculation node and the query result node. This function is called
// after some relevant property has changed (e.g. a result indexer was added
// or removed) but when the root query calculation node has not changed
// (and therefore must only be refreshed and not initialized).
// After determining whether this is a pure projection, the checks
// whether this query result requires the query under the root
// query calculation node to explicitly track the projection matches.
// This is needed when the query is a projection and either there is
// a result indexer (or a multi-projection) or when there are active
// composed function results which are not query results. However,
// if the query result does not restrict the projection, there is
// no need for this, as the matches can be accessed directly from
// the indexer. This is determined by the 'projection must generate matches'
// property.
// Since the requirement for explicit projection matches and for
// 'projection must generate matches' may change together (the one
// being turned on and the other off) the order in which these decisions
// are taken is important. If explicit projection matches are required,
// the process which adds them must know whether the projection had to
// be generated before this change and if explicit projection matches are
// not required, the process which releases them must know whether the
// matches need to be generated after the change.

InternalQueryResult.prototype.refreshProjProperties =
    internalQueryResultRefreshProjProperties;

function internalQueryResultRefreshProjProperties()
{
    this.refreshIsPureProjection(); // this property depends on the query

    if(this.rootQueryCalc === undefined || !this.rootQueryCalc.isProjection())
        // nothing to do, not a projection or a multi-projection which
        return;
    
    var requireExplicit = this.requiresExplicitProjMatches();

    // set/release the explicit projection matches. At the same time,
    // we need to check the 'projection must generate matches' property.
    // See introduction to this function.
    
    if(requireExplicit) {
        this.rootQueryCalc.setExplicitProjMatches(this.getId());
        // check the 'projection must generate matches' property value and
        // notify the root query calculation node of its value.
        this.refreshProjMustGenerateMatches();
    } else {
        // check the 'projection must generate matches' property value and
        // notify the root query calculation node of its value.
        this.refreshProjMustGenerateMatches();
        this.rootQueryCalc.releaseExplicitProjMatches(this.getId());
    }
}

//////////////////////////////////////
// Refreshing Projection Properties //
//////////////////////////////////////

// This function returns true if the query under this query result is
// a projection which is required to track its matches explicitly.
// This happens if this projection is a multi-projection or if it is
// a non-trivial projection and either there is a result indexer
// (or one is about to be created) at this node or there are non-query
// active composed functions.
// If the argument 'rootQueryCalc' is undefined, this function
// uses 'this.rootQueryCalc' to determine whether explicit projections
// are required. However, this function may also sometimes be called
// by the projection query calculation node (to determine its own
// status). This may happen while the replacement of the root query
// calculation node is in progress. To be certain that the answer is
// calculated for the correct root query calculation node, the
// calling function may also provide the root query calculation node
// explicitly as the argument of this function.

InternalQueryResult.prototype.requiresExplicitProjMatches = 
    internalQueryResultRequiresExplicitProjMatches;

function internalQueryResultRequiresExplicitProjMatches(rootQueryCalc)
{
    if(rootQueryCalc === undefined)
        rootQueryCalc = this.rootQueryCalc;
    
    if(rootQueryCalc === undefined || !rootQueryCalc.isProjection())
        return false; // not a projection

    if(rootQueryCalc.hasMultipleProjPaths())
        return true; // multi-projection, so requires explicit matches

    if(rootQueryCalc.isTrivialProjection())
        return false;  // trivial projections don't need to track the matches

    if(this.isPureProjection && !this.restrictsProjection())
        // in this case, the matches are pushed from the relevant path
        // in the indexer and there is no need for any extra selection 
        return false;
    
    return (!!this.resultIndexer || this.useResultIndexer() ||
            this.hasNonQueryActiveComposed());
}

// This function should be called only if the query under this query result
// is a projection. In this case, this function indicates whether
// the projection needs to actively generate its matches for this query result
// node (this would typically be done by registering to the appropriate
// path in the dominated indexer). There are two conditions for this.
// The first is that the result node does not restrict the projection
// (if the result node restricts the projection, selection matches collected
// on the query result node are pushed as projection matches to the root
// query result and these are the filtered (and lowered) to produce an
// update from the projection node). If the result node does not restrict
// the projection, it is up to the projection query itself to initiate the
// match updates. The second condition is that there is some object that
// is interested in these matches and does not get them directly from
// the indexer. This holds for composed result objects which are not queries
// (and therefore get their matches from this query result node and not from
// the indexer) and in case there is a result indexer defined on this
// query result (in which case that result indexer must be updated with
// the matches).

InternalQueryResult.prototype.projMustGenerateMatches =
    internalQueryResultProjMustGenerateMatches;

function internalQueryResultProjMustGenerateMatches()
{
    return (!this.restrictsProjection() &&
            !!(this.hasNonQueryActiveComposed() || this.resultIndexer ||
               this.useResultIndexer()));
}

// If the query under this result node is a projection, this function refreshes
// it 'projMustGenerateMatches' property.

InternalQueryResult.prototype.refreshProjMustGenerateMatches = 
    internalQueryResultRefreshProjMustGenerateMatches;

function internalQueryResultRefreshProjMustGenerateMatches()
{
    if(this.rootQueryCalc === undefined || !this.rootQueryCalc.isProjection())
        return;
    
    this.rootQueryCalc.
        refreshProjMustGenerateMatches(this.getId(),
                                       this.projMustGenerateMatches());
}


//////////////////////////////
// Indexer and Path Refresh //
//////////////////////////////

// This function is called when either the dominated indexer or 
// the dominated projection path of the data result object has changed.
// This function then allocates a new root query calculation node
// for this result node. If the root query calculation node did not change
// as a result of this operation, the process is terminated (because
// the root query calculation node determines the match count and
// the dominated indexer and path for all composed functions).
// If this root query calculation node is not the same as the one which
// existed before the refresh, teh match count is first refreshed and
// the matches due to the root query calculation
// node have to be added and the change may possibly have to be propagated.
// If this result node has a result indexer, the query under the root
// query calculation node has to be mapped to the result indexer. Composed
// functions do not need to have their indexer and path updated (because these
// are still pointing at the result indexer) and match updates are
// propagated from the result indexer when the matches are added to it.
// If there is no result indexer, the active composed nodes need to be
// notified that the indexer and path changed.
// At the end of this function (if the node is active*) the matches
// due to the root query calculation node are added.

InternalQueryResult.prototype.refreshIndexerAndPaths = 
	internalQueryResultRefreshIndexerAndPaths;

function internalQueryResultRefreshIndexerAndPaths()
{
    if(!this.resetRootQueryCalc(false, false))
        return; // root query calculation node did not change

    // clear the 'matches' table
    this.matches = undefined; // will be created again in 'refershMatchCount()'
    
    // refresh the match count (this also refreshes the 'dominating' pointer
    this.refreshMatchCount(false);
    this.resetProjProperties(); // needs the match count
    
    if(!this.resultIndexer) {
        // refresh composed results (this is not needed if there was a result
        // indexer even before this refresh, as that indexer sends the updates)
        for(var resultId in this.composedActive) {
            this.composedActive[resultId].refreshIndexerAndPaths(this);
        }
    } else { // if there is a result indexer, update the mapping to it.
        this.resultIndexer.clear(); // clear the matches stored in the indexer
        if(!this.setMappingsOnResultIndexer())
            return; // query not yet defined (will be refreshed later)
    }

    // add the matches due to the root query calc under this query result
    // (only if this node is active*, otherwise, these matches will be added
    // later).
    if(this.isActiveStar())
        this.addRootQueryCalcMatches(false);
}

// This function calculates the match count (matchCount and projMatchCount)
// for this node. In addition, if this refreshes the 'dominating' pointer
// on this node and dominated result nodes which are inactive.
// If the change in match count results in an active query result becoming
// inactive, its partial matches (if any) are added to the composed node.
// If the change in match count results in an inactive query result becoming
// active and the root query calculation node is not new,
// then the dominating function result nodes were already updated with
// the matches of the dominated nodes, so these matches are transferred from
// the dominating nodes to this node. For this reason, the flag
// 'existingRootQueryCalc' is provided, to indicate whether the update is
// for an existing root query calculation node (which already added its
// matches to the dominating node) or for a new root query calculation node
// (either because there was no previous root query calc or because it was
// replaced). 

InternalQueryResult.prototype.refreshMatchCount = 
    internalQueryResultRefreshMatchCount;

function internalQueryResultRefreshMatchCount(existingRootQueryCalc)
{
    var wasActive = this.isActive();
    var shouldBeActive = this.calcIsActive();
    
    if(wasActive && !shouldBeActive && this.isActiveStar() &&
       this.resultIndexer === undefined)
        // partial matches will now have to be counted on the composed node
        // This needs to be called before the match count is refreshed.
        this.addPartialMatchesToComposed();
    
    this.matchCount = 0;
    this.projMatchCount = 0;

    // if this node is active, accumulate the match count from the root
    // query calculation node and the dominated nodes, up to the first
    // active or non-query one.
    if(this.calcIsActive()) {
        if(this.query.isProjection())
            this.projMatchCount = 1;
        else
            this.matchCount = 1;
        
        // add the match counts of the dominated inactive nodes
        // also update the 'dominating' pointer on inactive nodes
        var dataResult = this;
        while(dataResult = dataResult.dataObj) {
            this.matchCount += dataResult.getDomMatchCount();
            if(!(dataResult instanceof InternalQueryResult) || 
               dataResult.isActive())
                break;
            dataResult.dominating = this;
        }

        this.dominating = undefined;
    } else {
        // set the dominating node for this node
        // (since it is inactive, if it is active* it should have exactly 
        // one active composed result node and it is either this or its 
        // dominating node which is the required dominating node).
        this.dominating = undefined;
        for(var resultId in this.composedActive) {
            var composedActive = this.composedActive[resultId];
            if(composedActive.isActive())
                this.dominating = composedActive;
            else if(!composedActive.isActiveStar()) {
                // stil pending, will update later (when composedActive
                // completes its activation).
                this.dominating = composedActive;
            } else 
                this.dominating = composedActive.dominating;
        }
        
        // set the dominating node on all dominated inactive nodes
        var dataResult = this;
        while(dataResult = dataResult.dataObj) {
            if(!(dataResult instanceof InternalQueryResult) || 
               dataResult.isActive())
                break;
            dataResult.dominating = this.dominating; // may be undefined
        }
    }

    if(this.matchCount > 1) {
        if(this.matches === undefined)
            this.matches = new IntHashMapUint(this.matchCount);
    } else
        this.matches = undefined;

    if(existingRootQueryCalc) {
        // change in match count may change whether the result restricts the
        // projection under it (and this affects the projection properties).
        // This requires a refresh only if the root query calculation node
        // is not new.
        this.refreshProjProperties();

        if(!wasActive && this.isActive() && !this.resultIndexer)
            // update match counts on this and dominating node
            this.updateMatchesAfterActiveStarBecameActive();
    }
}

// This function sets the match count to the given value. After doing so,
// it refreshes the projection properties of the query under it in case
// the 'restricts projection' property changed (that is match count changed
// between 0 and non-zero).

InternalQueryResult.prototype.setMatchCount = 
    internalQueryResultSetMatchCount;

function internalQueryResultSetMatchCount(matchCount)
{
    var needRefresh = ((matchCount === 0) != (this.matchCount === 0));
    
    this.matchCount = matchCount;

    if(needRefresh)
        this.refreshProjProperties();
}

// This function sets the projections defined by the root query calculation
// node as mappings on the result indexer (if it exists). All mappings 
// already registered to the result indexer are first removed.
// If no query is yet defined ('rootQueryCalc.getGeneratingProjMappings()'
// returned undefined) this function registers no mappings and
// returns false. Otherwise, true is returned.

InternalQueryResult.prototype.setMappingsOnResultIndexer = 
    internalQueryResultSetMappingsOnResultIndexer;

function internalQueryResultSetMappingsOnResultIndexer()
{
    if(!this.resultIndexer)
        return true;

    // remove all existing mappings from the result indexer
    this.resultIndexer.removeAllMappings();

    if(this.rootQueryCalc === undefined)
        return false; // the query is not yet defined
    
    // get the projection mappings for the query under this node
    var projMappings = this.rootQueryCalc.getGeneratingProjMappings();
    if(projMappings === undefined) // the query is not yet defined
        return false;
    
    var sourceIndexer = this.getIndexer();

    var _self = this;
    projMappings.forEach(function(mapping, projId) {
        _self.resultIndexer.addMapping(_self, projId, sourceIndexer,
                                       mapping, 0);
    });
    
    return true;
}

// This function adds all matches due to the root query calculation node
// under this result node. If it is a selection node, the matches are
// fetched (they are either already queued for addition, in which case they
// are fetched from the queue, or they are fetched directly from the
// root query calculation node) and set using 'addMatches()' (which also
// updates the result indexer or active composed results, as needed). If the
// query is a projection and does not restrict the projection 
// (that is, its match count is 0) we can immediately set the projections.
// Otherwise (if the result node restricts the projection, which means
// that there are selections from other queries which are counted on the
// result node and restrict the projection) the calling function must indicate
// whether this function need to update the projection. This should happen
// only if the selections which restrict the projection were not already
// updated (after the new root query calculation node was set but before this
// function was called) or are about to be added.

InternalQueryResult.prototype.addRootQueryCalcMatches = 
    internalQueryResultAddRootQueryCalcMatches;

function internalQueryResultAddRootQueryCalcMatches(updateRestrictedProj)
{
    if(!this.rootQueryCalc)
        return;
    
    if(this.rootQueryCalc.isSelection()) {
        // get the matches from the root query calculation node
        // (these may have been queued for addition during the root
        // query calculation node refresh
        var matches = this.getMatchesFromSource(this.rootQueryCalc);
        this.addMatches(matches, this.rootQueryCalc, 1);
        return;
    } else if(this.matchCount == 0 || updateRestrictedProj) {
        // does not restrict the projection, so can set the projection
        // matches already now (other updates will take place as
        // a result of selection matches later).
        this.setProjMatches();
    }
}

// This function is called when the indexer and path of this node are
// replaced (meaning that the full matches do not change) such that the
// matches of the old indexer are contained in the matches of the
// new indexer. This function is called after the root query calculation
// node has been transferred to the new indexer and after the match
// counts of the query results and the counts of matches from the old
// indexer have been updated. This function then performs the last step of
// the update which consists of adding the selection matches which
// of the query which are in the new indexer but were not in the new
// indexer. This therefore applies only to selection queries (in projection
// queries all matches are full matches and those are assumed to be unchanged).
// If this is a selection query, this function finds the dominating
// active query result which track its matches (perhaps this query result
// itself) and adds to it the matches of the root query calculation node
// which are not among the matches of the old indexer. To get the matches
// of this old indexer, this function is provided with the old indexer
// and the old projection path (of this query) as arguments. 

InternalQueryResult.prototype.addReplacedRootQueryCalcMatches = 
    internalQueryResultAddReplacedRootQueryCalcMatches;

function internalQueryResultAddReplacedRootQueryCalcMatches(oldIndexer,
                                                            oldProjPathId)
{
    if(this.rootQueryCalc === undefined || !this.rootQueryCalc.isSelection())
        return; // nothing to do (this only applies to selections)

    // add selections not in the indexer removed (but in the lower indexer).

    // find the query result to which these matches need to be added
    var active = this.isActive() ? this : this.dominating;
    if(active === undefined || active.matches === undefined)
        // matches not tracked, so nothing to update
        return;

    // get the matches of the old indexer
    var oldIndexerMatches = oldIndexer.getAllMatchesAsObj(oldProjPathId);
    // get the matches of the root query calc
    var matches = this.getMatchesFromSource(this.rootQueryCalc);

    for(var i = 0, l = matches.length ; i < l ; ++i) {
        var elementId = matches[i];
        if(!oldIndexerMatches.has(elementId))
            active.matches.inc(elementId, 1);
    }
}

// This function is called when the indexer and path of this node are
// replaced (meaning that the full matches do not change) such that the
// matches of the new indexer are contained in the matches of the
// old indexer. This function is called after the root query calculation
// node has been transferred to the new indexer and after the match
// counts of the query results and the counts of matches from the old
// indexer have been updated. This function is onyl called on a query
// result node which is active and has a 'matches' table.
// This function then performs the last step of the update which consists
// of removing matches from the 'matches' table which are not in the
// new indexer.

InternalQueryResult.prototype.removeReplacedRootQueryCalcMatches = 
    internalQueryResultRemoveReplacedRootQueryCalcMatches;

function internalQueryResultRemoveReplacedRootQueryCalcMatches()
{
    var newIndexer = this.rootQueryCalc.getIndexer();
    var projPathId = this.rootQueryCalc.prefixProjPathId;
    var newIndexerMatches = newIndexer.getAllMatchesAsObj(projPathId);

    var _self = this;
    
    this.matches.forEach(function(count, elementId) {
        if(!newIndexerMatches.has(elementId))
            _self.matches.delete(elementId);
    });
}

/////////////////////////////////////////////////////
// Addition and Removal of Active Composed Results //
/////////////////////////////////////////////////////

// This function is called before a new active composed function is attached
// (the first step in adding an active composed function). The function
// is called before any attachment takes place, so all counters on this
// object are, at the time this function is called, as before the attachement
// took place (specifically, isActiveStar() still returns the value as
// before the attachment).
// If a query is defined and the query result is not active* (it is about
// to become active*), this function forces the compilation of the
// query by making its compilation object active. The function then
// refreshes the 'isPureProjection' property, which is needed for the
// proper update of the counters in the attachment step.

InternalQueryResult.prototype.aboutToAttachActiveComposed = 
    internalQueryResultAboutToAttachActiveComposed;

function internalQueryResultAboutToAttachActiveComposed(wasActiveStar)
{
    if(this.query === undefined || this.isActiveStar())
        return; // nothing to do or already done

    // Since a an active composed function is about to be attached,
    // we need to determine the properties of the query of this result query
    // before the different counters can be updated.

    this.query.lockActive("InternalQueryResult");
    this.qcm.executeScheduled(undefined, true);
    this.refreshIsPureProjection();
}

// This function is called every time a new active function result 
// is about to be composed with this query result or when an existing composed
// function result is about to become active*. 'composedResult' is the 
// result object which is about to be composed or to become active.
// When this function is called, the new active composed function
// was not yet added to the list of active composed functions of this node,
// but the function was already attached, which means that the various
// active composed function counters (e.g. the number
// of active composed functions) were already updated. This means that
// descisions based on the number of active composed functions (and their
// type) can already be made here, but that any match updates
// forwarded here will not be forwarded to the new active composed functions. 
// This function is only required to update the consequences of this 
// update for this node and (if this changes the indexer) for composed 
// result nodes which were active* before this change.
// In cases where adding the active composed function resulted in this
// query result becoming active*, this function does nothing, as the
// updates performed by this function will be taken care of by the
// initialization of this query result as active* (in becameActiveStar()).

InternalQueryResult.prototype.aboutToAddActiveComposed = 
    internalQueryResultAboutToAddActiveComposed;

function internalQueryResultAboutToAddActiveComposed(composedResult, 
                                                     wasActiveStar)
{
    if(this.activeStarPending === true)
        // we're in the midst of the operation, the relevant operations
        // below will take place in becamActiveStar() later.
        return;
    
    if(this.composedRemovalInProgress !== undefined)
        // if there is a removal in progress, the updates below must also
        // be forwarded to the active* composed function which is being
        // removed (since the final steps of the removal depend on
        // the state after these operations). We therefore temporrily add this
        // function back to the list of active composed functions
        this.composedActive[this.composedRemovalInProgress.getId()] =
            this.composedRemovalInProgress;
    
    // does this require the node to calculate match counts
    if(!this.isActive() && this.calcIsActive())
        this.refreshMatchCount(wasActiveStar);

    // check whether this requires a result indexer to be constructed
    if(!this.resultIndexer && this.useResultIndexer()) {
        this.insertResultIndexer();
    } else if(this.resultIndexer &&
            !(composedResult instanceof InternalQueryResult) &&
            this.composedQueryResultNum + 1 == this.composedActiveNum) {
        // first non-query-result active composed function
        // register a query calculation node to the result indexer, to
        // receive updates when nodes are added or removed
        this.resultIndexerQueryCalc = new QueryResultQueryCalc(this); 
    } else if(!(composedResult instanceof InternalQueryResult) &&
              wasActiveStar)
        // if the query is a projection (and already active*), check
        // whether its projection properties changed.
        this.refreshProjProperties();

    if(this.composedRemovalInProgress !== undefined)
        // remove this, as it was only added temporarily (above)
        delete this.composedActive[this.composedRemovalInProgress.getId()];
}

// This function is called every time an active composed query function 
// is removed from the list of active function results composed with 
// this query result or when one of the composed function results which 
// was active* is no longer active*. This function then updates its own
// active/inactive status, as needed. If this node is/becames inactive but 
// is active* (so it has a 'dominating' node which actually performs
// the match count) the new dominating node needs to be set on this node 
// and on all inactive nodes which had this as 'dominating' node before the
// change. If the node is no longer active*, its dominating node needs
// to be removed. All this takes place inside 'refreshMatchCount()'.

InternalQueryResult.prototype.activeComposedFuncRemoved = 
    internalQueryResultActiveComposedFuncRemoved;

function internalQueryResultActiveComposedFuncRemoved(composedResult)
{
    if(!this.calcIsActive())
        this.refreshMatchCount(true);
    
    if(this.resultIndexer) {
        // check whether this requires the result indexer to be destroyed
        // (if deactivation took place, there could not have been 
        // a result indexer before the update).
        if(!this.useResultIndexer())
            this.removeResultIndexer();
        else if(!(composedResult instanceof InternalQueryResult) &&
                this.composedQueryResultNum == this.composedActiveNum &&
                this.resultIndexerQueryCalc !== undefined) {
            // last non-query-result active composed function, unregister
            // the query calculation node from the result indexer
            this.resultIndexerQueryCalc.destroy();
            this.resultIndexerQueryCalc = undefined;
        }
    }
}

/////////////////////////////////
// Activation and Deactivation //
/////////////////////////////////

// This function is called when this query result node is deactivated,
// which in the case of qiuery result nodes means that the last active*
// composed function was removed from this query result. This function
// needs to deactivate the query under it (release the root query calculation
// node) and notify its data object that it is no longer active*.
// There is no need to send updates (as there is no one to send them to).

InternalQueryResult.prototype.deactivated = internalQueryResultDeactivated;

function internalQueryResultDeactivated()
{
    // deactivated the query (releases the root query calculation node)
    this.resetRootQueryCalc(false, false);

    // reset the match counts (to 0)
    this.matchCount = 0;
    this.projMatchCount = 0;
    
    // the base class function propagates this deactivation downward.
    this.FuncResult_deactivated();
}

// This function is called when this node becomes active* and after its
// data objects were updated with this fact. This is the end of the
// initialization process and the node is now ready to set all the
// required matches.
// This function first registers a root query calculation node which will
// create the query calculation node structure to calcualte
// the query registerd to this node. After doing so, the node can
// detemrine its match count (which depends on whether the query is
// a selection or a projection).
// After determning the match count, the node can process all the
// matches is receives. Those matches from lower result nodes
// were delivered during during the initialization process and are
// now pending. These are now added. Matches from the result node's
// own query are pulled from its root query calculation node and added.

InternalQueryResult.prototype.becameActiveStar = 
    internalQueryResultBecameActiveStar;

function internalQueryResultBecameActiveStar()
{
    if(!this.query || !this.dataObj)
        return; // nothing to do

    // create the root query calculation node (should always succeed under
    // the conditions at which we arrived here).
    this.resetRootQueryCalc(false, false);
    
    // refresh the match count (this also refreshes the 'dominating' pointer
    this.refreshMatchCount(false);
    // refresh the projection properties
    this.resetProjProperties();

    // check whether there is need to create a result indexer (as this was
    // just activated, this is not an insertion operation for the result
    // indexer, but merely an initialization).
    if(this.useResultIndexer())
        this.createResultIndexer();
    
    // notify composed function that the projection paths may have changed
    for(var resultId in this.composedActive)
        this.composedActive[resultId].refreshIndexerAndPaths(this);
    
    // if there is a result indexer, update the mapping to it.
    // this returns false if no query is yet defined (in that case, we cannot
    // add the matches of the root query calculation node below).
    var canAddRootMatches = this.setMappingsOnResultIndexer();
    
    // add all queued added matches (received from lower result node
    // during the activation process). Check whether this includes an
    // update from the root query calculation node

    var updateFromRoot = false;
    
    if(this.pendingAddMatches) {
        for(var i = 0, l = this.pendingAddMatches.length ; i < l ; ++i) {
            var addMatches = this.pendingAddMatches[i];
            this.addMatches(addMatches.elementIds, addMatches.source,
                            addMatches.matchCount);
            if(addMatches.source == this.rootQueryCalc)
                updateFromRoot = true;
        }
        this.pendingAddMatches = undefined;
    }

    if(canAddRootMatches && !updateFromRoot)
        this.addRootQueryCalcMatches(false);
}

// This function is called when this node becomes active after it previously
// was only active*. It updates the matches of this node and of the
// active composed nodes.

InternalQueryResult.prototype.updateMatchesAfterActiveStarBecameActive =
    internalQueryResultUpdateMatchesAfterActiveStarBecameActive;

function internalQueryResultUpdateMatchesAfterActiveStarBecameActive()
{
    this.addDominatedMatchesWithoutForwarding(this);
    this.removePartialMatchesFromComposed();
}

// This function is called when one of the following holds:
// 1. this node becomes active after it previously was not active, but
//    possibly active*. In this case, 'dataResult' is this node itself.
// 2. after a lower result indexer was removed and, as a result, the dominated
//    indexer of this node changed and result nodes which previously did not
//    add their matches to this query result now do add their matches.
//    In this case, 'dataResult' is the highest result node under this node
//    whose matches were not yet added at this query result node (if the
//    'matches' table was previously undefined, this will be this node itself
//    and otherwise the node from which the result indexer was removed).
// This function then adds the matches of all result nodes which should be
// added to it but were not. It is assumed that this update does not affect
// the full matches at this node and therefore there is not match update to
// dominating nodes.
// If the argument 'fullMatches' is given, it should be an array. This
// function then pushes on this array the full matches of in the matches
// table (under the assumption that the match count is already updated
// on this query result).

InternalQueryResult.prototype.addDominatedMatchesWithoutForwarding = 
    internalQueryResultAddDominatedMatchesWithoutForwarding;

function internalQueryResultAddDominatedMatchesWithoutForwarding(dataResult,
                                                                 fullMatches)
{
    if(this.matchCount <= 1)
        return; // nothing to do, the matches are stored in the query
    
    // loop over the dominated data nodes which are not active
    for( ; dataResult ; dataResult = dataResult.dataObj) {

        var matchCount = (dataResult == this) ? 
            1 : dataResult.getDomMatchCount();

        if(matchCount == 0)
            break; // no selection on indexer beyond this point
        
        var matches;
        if(dataResult == this && this.rootQueryCalc &&
           !this.rootQueryCalc.isSelection())
            continue; // a projection does not contribute matches
        
        // the node itself contributes the matches of its root query
        // calculation node
        matches = this.getMatchesFromSource(dataResult == this ?
                                            this.rootQueryCalc : dataResult);

        this.matches.expectSize(matches.length);
        
        // add the matches
        if(fullMatches !== undefined) {
            for(var i = 0, l = matches.length ; i < l ; ++i) {
                var elementId = matches[i];
                if(this.matches.inc(elementId, matchCount) === this.matchCount)
                    fullMatches.push(elementId);
            }
        } else
            for(var i = 0, l = matches.length ; i < l ; ++i)
                this.matches.inc(matches[i], matchCount);

        if(dataResult != this &&
           (dataResult.isActive() ||
            !(dataResult instanceof InternalQueryResult)))
            break; // reached bottom of chain
    }
}

// This function is called when the node, which was previously active*
// becomes active. This means that before this change, the matches
// of this node were forwarded to a dominating node. Now that the
// matches are no longer forwarded, partial matches on this node
// (which were previously counted on the dominating node) are no longer
// forwarded and should therefore be removed from the dominating active node.
// This function should be called after the matches of this node were
// calculated. It goes over the full list of matches and creates an array
// for each partial match count. All element IDs with the corresponding
// partial match count are then pushed onto the corresponding array.
// Each of these arrays is then used in a call to removeMatches of
// the composed result (with the appropriate match count).

InternalQueryResult.prototype.removePartialMatchesFromComposed =
    internalQueryResultRemovePartialMatchesFromComposed;

function internalQueryResultRemovePartialMatchesFromComposed()
{
    if(this.matchCount <= 1)
        return; // no partial matches
        
    var partialMatches = [];
    var matchCount = this.matchCount;

    // create the arrays for storing the matches of each match count
    for(var count = 1 ; count < matchCount ; ++count)
        partialMatches[count] = [];

    this.matches.forEach(function(count, elementId) {
        if(count == matchCount)
            return; // a full match, is not removed
        partialMatches[count].push(elementId);
    });
    for(var count = 1 ; count < matchCount ; ++count) {
        // remove the partial matches from active composed functions
        if(partialMatches[count].length == 0)
            continue;
        for(var resultId in this.composedActive)
            this.composedActive[resultId].removeMatches(partialMatches[count],
                                                        this, count); 
    }
}

// This function is called when the node, which was previously active
// stops being active, but is still active* and no result indexer was
// used. This means that after this change, the matches that were counted on
// this node are counted on the dominating node. Until now, the dominating
// node only received updates for the full matches (with their full match
// count). Therefore, there is no need to update the full matches, but the
// partial matches need to be updated from this node to the dominating node.
// This function is therefore called before the match count is updated
// and before the matches are removed. The function goes over the full list
// of matches and creates an array for each partial match count.
// All element IDs with the corresponding partial match count are then
// pushed onto the corresponding array. Each of these arrays is then used
// in a call to addMatches of the composed result (with the appropriate
// match count).

InternalQueryResult.prototype.addPartialMatchesToComposed =
    internalQueryResultAddPartialMatchesToComposed;

function internalQueryResultAddPartialMatchesToComposed()
{
    if(this.matchCount <= 1 || this.matches === undefined ||
       this.composedActiveNum == 0)
        return; // no partial matches or no composed nodes to add them to
        
    var partialMatches = [];
    var matchCount = this.matchCount;

    // create the arrays for storing the matches of each match count
    for(var count = 1 ; count < matchCount ; ++count)
        partialMatches[count] = [];

    this.matches.forEach(function(count, elementId) {
        if(count == matchCount)
            return; // a full match, is not added
        partialMatches[count].push(elementId);
    });
    for(var count = 1 ; count < matchCount ; ++count) {
        // add the partial matches to active composed functions
        if(partialMatches[count].length == 0)
            continue;
        for(var resultId in this.composedActive)
            this.composedActive[resultId].addMatches(partialMatches[count],
                                                     this, count); 
    }
}

/////////////////////////
// Indexer Replacement //
/////////////////////////

// This function is called when a result indexer is added or removed at one
// of the result nodes with which this result node is composed* and,
// as a result, the indexer and paths on which this query is registered
// need to change, but the full matches are unchanged.
// Therefore, this function does not need to update the full matches and
// propagate these changes. However, the function does need to create
// a new root query calculation node (and, if this root query calculation
// node is new, also new query calculation nodes) and add/remove the
// matches of this query which are/aren't in the new indexer but aren't/are
// in the old indexer. The argument 'newIndexerContained' provides the
// information know which indexer is contained in the other (1 if the
// new indexer is contained in the old indexer, -1 if it is the other way
// around, 0 if thye are the same and undefined if this is unknown).
// In case the root query calculation node has a projection under it,
// there is also need to create (inside the query calculation structure)
// the projection matches for this internal query result. The propagation
// of these matches is blocked (since the composed nodes already hold the
// right matches) by setting the flag 'pendingIndexerReplace' during this
// operation.
// If there is no result indexer on this query result, the update is propagated
// to active composed functions.
// If there is a result indexer, the source of the mapping registered to
// the indexer needs to be replaced. This can take place without changing the
// elements registered to the result indexer, so that all function composed
// with this node do not notice any change.
// 'prevPrefixPathId' and 'prefixPathId' indicate how the projection paths
// of the data object before and after the change are related. For every
// projection path, removing the prefix 'prevPrefixPathId' from the old
// prefix path and adding 'prefixPathId' before it should result in the new
// projection path. 

InternalQueryResult.prototype.replaceIndexerAndPaths =
    internalQueryResultReplaceIndexerAndPaths;

function internalQueryResultReplaceIndexerAndPaths(prevPrefixPathId,
                                                   prefixPathId,
                                                   newIndexerContained,
                                                   source)
{
    var newRootQueryCalc;

    this.pendingIndexerReplace = true;

    var oldIndexer;
    var oldProjPathId;

    if(newIndexerContained === -1 && this.rootQueryCalc !== undefined) {
        // store the indexer and path from the old root query calculation node
        // before refreshing it
        oldIndexer = this.rootQueryCalc.getIndexer();
        // only needed when this is a selection, so is defined
        oldProjPathId = this.rootQueryCalc.getProjectionPathId();
    }

    // get/create a root query calculation node for this query application. 
    // (only if it is active*).
    this.resetRootQueryCalc(false, true);
    
    if(newIndexerContained === -1)
        this.addReplacedRootQueryCalcMatches(oldIndexer, oldProjPathId);
    else if(this.isActive() && this.matchCount > 1) {
        // other cases only apply if this is an active node and matches
        // are explicitly tracked on it
        if(newIndexerContained === undefined) {
            // relationships between new and old indexers not known,
            // regenerate the list of matches (full matches assumed to remain
            // unchanged).
            this.matches = new IntHashMapUint(this.matchCount);
            this.addDominatedMatchesWithoutForwarding(this);
        } else if(newIndexerContained === 1)
            // remove matches which are not in the new indexer
            this.removeReplacedRootQueryCalcMatches();
    }

    if(this.requiresExplicitProjMatches())
        // if explicit projection matches are calculated, these were reset to
        // the empty list when a new root query calculation node was created
        // above. Here we reset the list of projection matches.
        this.setProjMatches();
    
    if(this.resultIndexer) {
        // need to transfer the source of the mapping to the new indexer and
        // paths. The matches in the result indexer do not change, but various
        // registrations do. For this, we need the prefix paths of the query
        var projMappings = this.rootQueryCalc.getGeneratingProjMappings();
        if(projMappings === undefined) // the query is not yet defined
            return; // no query, so no matches and nothing more to do
        this.resultIndexer.
            replaceFuncSource(this, projMappings, prevPrefixPathId,
                              prefixPathId, this.dataObj.getDominatedIndexer());
        // no need to continue propagate this change, as all composed function
        // look at this result indexer, which did not change
    } else {
        for(var resultId in this.composedActive) {
            this.composedActive[resultId].
                replaceIndexerAndPaths(prevPrefixPathId, prefixPathId,
                                       newIndexerContained, this);
        }
    }

    this.pendingIndexerReplace = undefined;
}

// This function is called when a result indexer is removed from a
// query result such that this query result immediately dominates it.
// If this query result is not active, this call is forwarded to the
// immediately dominating active query result. This function is called
// before the indexer and path were replaced on all dominating nodes.
// Therefore, the queries on these nodes are still registered to the
// result indexer which is about to be removed.
// It is assumed that this function is called only when it is known that
// no full matches have changed as a result of this change. This function
// is responsible for updating the match counts and counts of existing
// matches which are the result of the change in match count due to the
// removal of the result indexer.
// 'resultIndexerResult' is the result node from which the result indexer
// was removed.
// 'incMatchCount' is the amount by which the dominated match count increases
// for this query result node. This function begins by updating the match
// count of this query result and then adds matches whose dominated match
// count contributes to this increase in match count. These are all queries
// which add their matches to this query result node which did not do so
// before, that is, the query result from which the result indexer
// was removes (it previously had a domianted match count of zero)
// and if that query result is not active, the nodes it dominates down to
// and including the first active result node. Note that all these
// matches come from queries which were nto registered to the result
// indexer being removed (since they are lower than that indexer).
// If the match table for this query result was previously undefined,
// this function must also add the matches of higher result nodes
// which contribute to the matches on this node. These matches are
// read from queries which are still registered to the result indexer being
// removed.
// After having refreshed the matches of this node (without forwarding
// updates, as the full matches are assumed to remain unchanged) this
// function checks whether the dominated match count of this query result
// node changed. If it did, this match count change is propagated
// to the dominating node.

InternalQueryResult.prototype.addCountsUnderRemovedIndexer = 
    internalQueryResultAddCountsUnderRemovedIndexer;

function internalQueryResultAddCountsUnderRemovedIndexer(resultIndexerResult, 
                                                         incMatchCount)
{
    if(incMatchCount == 0)
        return; // nothing to do
        
    if(!this.isActive()) { // inactive, forward to the dominating node
        if(this.dominating)
            this.dominating.addCountsUnderRemovedIndexer(resultIndexerResult, 
                                                         incMatchCount);
        return;
    }

    // update match count and matches

    this.matchCount += incMatchCount;
    
    // need to update the counts of the matches only if a match table is needed
    if(this.matchCount > 1) {
        if(this.matches === undefined) { // need to add all matches
            this.matches = new IntHashMapUint(this.matchCount);
            this.addDominatedMatchesWithoutForwarding(this);
        } else
            this.addDominatedMatchesWithoutForwarding(resultIndexerResult);
    }

    // may need to refresh because of the increase in match count, but only
    // do this after the matches were added above.
    this.refreshProjProperties();
    
    // propagate the increase in match count (if needed)

    if(this.resultIndexer || !this.composedQueryResultNum)
        return; // no need to propagate or nowhere to propagate to
    
    // calculate the increase in match count to be propagated 
    
    if(this.rootQueryCalc && !this.rootQueryCalc.isSelection()) {
        if(this.matchCount > incMatchCount || !this.isPureProjection)
            // this projection previously had a dominated match count of 1,
            // so nothing changed for the matches of the composed functions.
            return; // increase is 0, nothing to propagate
        
        // this is a pure projection and before the change there was
        // no selection between this projection and the indexer (match count of
        // zero), and this now no longer the case. Increase the match count
        // of dominating nodes by 1 
        incMatchCount = 1;
    }
    
    var matches = this.getDominatedMatches();
    
    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        // after processing the first active node, all dominating nodes
        // do not need to add partial matches, but only increase the match
        // count and the count for the matches of this node
        composedResult.increaseMatchCount(incMatchCount, matches, this);
    }
}

// This function is called when a result indexer is pushed between
// this query result node and its indexer. This function is called
// only if there is no active query result node between this node and the
// indexer that was added. While the dominated indexer (and path) for
// this node change, the matches do not. However, the match count and
// the counts in the 'matches' table have to be modified (though the full
// matches will remain the same). The update of the match count and the
// counts in the 'matches' table are handled by this function. This also
// updates the match count of the dominating query results (if this query
// result node is not active this function is called on the dominating
// active node, if this node is active, the propagation to the dominating
// nodes is performed by a different function).
// The match count has to be decreased by the amount given in 'decMatchCount'.
// This is 0 or 1 in case there is a projection between this query result
// and the result indexer (since a projection resets the match count to
// either 0 or 1, depending on whether it is a pure projection on the selections
// which took place between the indexer and the projection)
// and is the previous match count of the query result node on which the
// result indexer was created in case only selections appear in between
// (in that case, match counts are accumulated and the match count of
// the query result where the result indexer was inserted dropped to zero).
// This change only applies to element IDs which are in the set of matches
// of the query result node where the result indexer was created. All other
// matches must be removed from the list of matches on this result node.
// The set of matches on the query result node where the result indexer was
// created is given by the keys of the Map object 'resultIndexerMatches'.
// Note that none of the nodes was a full match prior to this operation
// (since it was not a match on a lower result node). Also no new matches are
// added, since for all element IDs remaining in the match table it holds
// that their count is reduce by the same amount as the amount by which the
// match count of the result is reduced.

InternalQueryResult.prototype.removeNonResultIndexerMatches = 
    internalQueryResultRemoveNonResultIndexerMatches;

function internalQueryResultRemoveNonResultIndexerMatches(resultIndexerMatches, 
                                                          decMatchCount)
{
    if(decMatchCount == 0)
        return; // nothing to do
    
    if(!this.matchCount) { // inactive, forward to the dominating node
        if(this.dominating)
            this.dominating.removeNonResultIndexerMatches(resultIndexerMatches, 
                                                          decMatchCount);
        return;
    }

    // update match count and matches

    this.setMatchCount(this.matchCount - decMatchCount);

    if(this.matchCount <= 1)
        this.matches = undefined;
    
    if(this.matches !== undefined) {
        // need to update matches only if matches are stored here
        var _self = this;
        if(resultIndexerMatches === undefined ||
           resultIndexerMatches.size == 0) {
            // remove all matches
            this.matches = new IntHashMapUint(this.matchCount);
        } else if(decMatchCount == 0) {
            this.matches.forEach(function(c, elementId) {
                if(!resultIndexerMatches.has(elementId))
                    _self.matches.delete(elementId); // not in result indexer
            });
        } else {
            this.matches.forEach(function(c, elementId) {
                if(!resultIndexerMatches.has(elementId))
                    _self.matches.delete(elementId); // not in result indexer
                else
                    _self.matches.dec(elementId, decMatchCount);
            });
        }
    }
    
    // propagate the update

    if(this.resultIndexer)
        return; // no need to propagate

    if(!this.composedQueryResultNum)
        return; // nowhere to propagate the update to

    if(this.rootQueryCalc && !this.rootQueryCalc.isSelection()) {
        if(this.matchCount > 0 || !this.isPureProjection)
            // this node was and remains a projection node with a dominated
            // match count of 1 so counts on dominating nodes remain unchanged.
            return;
        // this node was a projection node with a dominated match count of 1
        // but now has a dominated match count of 0 (because its match count
        // is zero and it is a pure projection). So popagate a decrease of 1
        // in the match count.
        decMatchCount = 1;
    }

    var matches = this.getDominatedMatches();
    
    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        if(!(composedResult instanceof InternalQueryResult))
            continue;
        // after processing the first active node, all dominating nodes
        // do not need to remove partial matches, but only decrease the match
        // count and the count for the matches of this node
        composedResult.decreaseMatchCount(decMatchCount, matches, this, false);
    }
}

/////////////////////////
// Data Result Refresh //
/////////////////////////

// This function is called when the data object is about to be set
// (but before any action has taken place). If this query result node
// is not active*, there is nothing to do here, as the node will not be
// updated (except for linking it with the new data object). If this
// query result object is active, this function sets the flag
// 'pendingSetData' to indicate that we are in the middle of the
// process of replacing the data object. This will cause match updates
// which are received by this object to be queued rather than processed).
// Such match updates are received from the new data object (or, if the
// new data object is not active, also from lower nodes in the data chain)
// when the function composition is set in case this composition
// resulted in the activation of the data object.
// If this query result node is active* but not active, this function
// is called on the dominating active query result node, which is the
// node which will actually receive the match updates sent from the
// new data object).

InternalQueryResult.prototype.aboutToSetData = 
    internalQueryResultAboutToSetData;

function internalQueryResultAboutToSetData(newDataObj)
{
    if(!this.isActiveStar())
        return; // not active, nothing to do

    // force refresh of existing queries, so that these do not get refreshed
    // in the midst of the query chain restructuring process (this does
    // not apply to queries which will only become active* as a result of
    // this restructuring).
    this.qcm.executeScheduled(undefined, true);
    
    if(this.isActive())
        this.pendingSetData = true;
    else if(this.dominating)
        this.dominating.aboutToSetData(newDataObj);
}

// This function is called internally at the end of the 'set data' operation
// and it simply removes the 'pendingSetData' flag which was set at the
// beginning of the process. Since this flag needs to be set on the active
// node dominating the place where the set data operation took place, this
// function may have to forward the notification of the completion of the
// set data operation to its active dominating node.
// This function also clears the 'pending added matches' queue which
// was created as a result of setting the 'pendingSetData' flag.

InternalQueryResult.prototype.setDataCompleted = 
    internalQueryResultSetDataCompleted;

function internalQueryResultSetDataCompleted()
{
    if(this.isActive()) {
        this.pendingSetData = undefined;
        this.pendingAddMatches = undefined;
    }
    else if(this.dominating)
        this.dominating.setDataCompleted();
}

// This function is called when the data object is about to be removed or
// replaced. 'newDataObj' is the new data object about to be set on this
// result node and this.dataObj still holds (at this point) the old
// data object. Moreover, when this function is called, 'this' query
// result has already been set as a composed function of 'newDataObj'
// and has not yet been removed as a composed function of 'this.dataObj'.
// This means that if 'this' node is active* then both 'newDataObj'
// and this.dataObj are active* (and therefore still store their matches).
// Finally, this means that in the process of setting 'this' as composed
// with 'newDataObj' match updates were received from 'newDataObj'.
// These updates (which must be 'addMatches' calls with the full list
// of matches of some dominated node) are queued on this node (due to the
// 'pendingSetData' flag which was set on this node).
// 'indexerOrPathChanged' is true if either the indexer or the 
// projection path of the data object has changed as a result of this
// update. In this case, this function has nothing to do, because
// refreshIndexerAndPaths() will be called after this function and will
// clear all this nodes matches and only then could new matches be added.
// If 'indexerOrPathChanged' is false and this.dataObj is undefined there
// is also nothing to do, since if the indexer and path of an undefined
// data object did not change this means that the new data object is
// also undefined or has no dominated indexer and path defined yet. 
// In all other cases (data object changed but the indexer and path did not)
// this function is responsible for performing the full update required,
// including match counts and matches.

InternalQueryResult.prototype.removeDataObjMatches = 
    internalQueryResultRemoveDataObjMatches;

function internalQueryResultRemoveDataObjMatches(newDataObj, 
                                                 indexerOrPathChanged)
{
    if(indexerOrPathChanged)
        return; // handled by other functions

    if(!this.dataObj || !newDataObj) {
        // if the indexer and path did not change and either the old or new
        // data object is missing, the other data object cannot have an indexer
        // or path defined.
        this.setDataCompleted(); // nothing more to do
        return;
    }

    // get the active function result which receives updates from this
    // query result (may be the query result itself).
    var active = this.isActive() ? this : this.dominating;
    if(!active)
        return;
    
    if(active === this) {
        // check whether the new data object changes the decision as to
        // whether a result indexer needs to be created (create the result
        // indexer before the update). This does not apply if this node is
        // not active (as it then never has a result indexer).
        if(!this.resultIndexer) {
            if(this.useResultIndexer(newDataObj))
                this.insertResultIndexer();
        } else if(!this.useResultIndexer(newDataObj))
            this.removeResultIndexer();
    }
    
    if(this.dataObj.getDomMatchCount() == 0) {
        // indexer and path did not change and the old object did not
        // restrict the matches, so need to add the restrictions imposed
        // on the matches by the chain of result nodes being added.
        active.reduceMatchesByInsertedQueries(newDataObj, this.dataObj);
    } else if(newDataObj.getDomMatchCount() == 0) {
        // indexer and path did not change and the new object does not
        // restrict the matches, so need to remove the restrictions imposed
        // on the matches by the chain of result nodes being remove.
        active.removeRestrictionsOfRemovedQueries(newDataObj, this.dataObj);
    } else {
        // new data object with the same indexer and path. Therefore,
        // need to calcualte the difference between the new and old set
        // of matches. At this point, this data was already composed
        // with the data object (but this was not yet removed as composed
        // with the old data object) so both solution sets are available
        // and the new data object may have sent updates (which were
        // queued) if this composition resulted in its activation.
        // Loop over new and old matches and calculate the difference.
        active.replaceDataObjMatches(this.dataObj, newDataObj);
    }
    
    // since the indexer and path did not change, this function already
    // completed the handling of the update.
    this.setDataCompleted();
}

// This function is called when the data object was removed or replaced.
// 'oldDataObj' is the old data object (before the replacement). When this
// function is called, the new data object was already set on this node and
// this node was set as a composed function of the new data object. Moreover,
// this node was already removed as a composed function of the old data
// object (which means that the old data object may not be active* anymore
// even if this node is). This function is also called after the indexer
// and path of 'this' node were refreshed.
// 'indexerOrPathChanged' indicates whether the dominated indexer and
// path of the data object changed (between the old and the new data objects)
// as a result of the replacement of the data object. If this is false,
// this function has nothing more to do, as all the work was carried out
// by 'removeDataObjMatches()' (which in this case does not need to wait for
// a indexer refresh).
// If 'indexerOrPathChanged' is true, all that is left for this function
// to do is add the matches from the data object (and possibly from
// lower nodes, if the data object is not active). The matches of the
// data object may be already queued for addition (the function
// getMatchesFromSource() determines whether to get the queued matches
// or fetch them again from the data object). If the data object is
// not active, the matches of lower nodes has to be fetched only if they
// are already queued (because if these nodes were already active*
// before this node was composed with them, there must be an additional
// active* node composed with them and these nodes have two composed
// active* functions which means they are active). Therefore, after
// fetching the matches of the data object, this function only needs to
// add matches which are waiting in the queue.

InternalQueryResult.prototype.addDataObjMatches = 
    internalQueryResultAddDataObjMatches;

function internalQueryResultAddDataObjMatches(oldDataObj, 
                                              indexerOrPathChanged)
{
    if(!indexerOrPathChanged) {
        this.setDataCompleted();
        return; // already handled in removeDataObjMatches()
    }

    // get the active function result which receives updates from this
    // query result (may be the query result itself).
    var active = this.isActive() ? this : this.dominating;
    if(!active)
        return;

    if(active.pendingSetData)
        // clear the pending flag to allow updates to be processed, but do
        // not clear the pending added matches queue yet (will happen below)
        active.pendingSetData = undefined;
    
    
    // add the matches from the data object (if its match count is not zero)
    var domMatchCount = this.dataObj.getDomMatchCount();
    if(domMatchCount > 0) {
        // if the matches were already queued for addition on 'active',
        // 'getMatchesFromSource()' gets them from the queue
        active.addMatches(active.getMatchesFromSource(this.dataObj),
                          this.dataObj, domMatchCount);
    }

    if(active.pendingAddMatches) { // add any matches which are still pending
        for(var i = 0, l = active.pendingAddMatches.length ; i < l ; ++i) {
            var addMatches = active.pendingAddMatches[i];
            active.addMatches(addMatches.elementIds, addMatches.source,
                              addMatches.matchCount);
        }
        active.pendingAddMatches = undefined;
    }
}

///////////////////////////////////////////////////////
// Composition Change Without Indexer or Path Change //
///////////////////////////////////////////////////////

// This function is called when the data object of a query result node
// is replaced but the dominated indexer and path do not change. 'oldDataObj'
// is the data object being removed and 'newDataObj' is the data object
// which is about to replace it. It is assumed that this function is called
// on an active query result node such that either 'this' query result node
// is the one whose data object was replaced or that the data object
// was replaced on a non-active query result node such that 'this' is
// its dominating active node.
// The two special cases where the dominated match count of the old or new
// data object is zero are not handled by this function but by special
// functions.
// This function first checks for the simpler replacement case where
// the replacement resulted in the insertion of a sequence of selection
// queries between 'oldDataObj' and 'this'. This case can be handled
// somewhat more efficiently by a special function.
// The opposite case, where the replacement resulted in the removal
// of a sequence of selections from the chain under 'this' node
// (that is, 'newDataObj' is dominated by 'oldDataObj') is checked
// for, but then handled by the standard function (as described below),
// except that some of the functions may receive a flag indicating that this
// is the situation.
// In all remaining cases, this function first propagates any change in
// match count due to the replacement to the dominating query result
// nodes (only if this is needed). Those composed result nodes then also
// update the counts in their 'matches' tables, but without changing the
// actual list of full matches. Next, this function updates the 'matches'
// table of 'this' query result, removing the matches of the old data object
// and adding those of the new data object. The match count of this node
// is also updated. In this process, the function determines the actual
// change in the matches: which matches are removed by this operation
// and which are added. This changes are then forwarded in the usual way.

InternalQueryResult.prototype.replaceDataObjMatches = 
    internalQueryResultReplaceDataObjMatches;

function internalQueryResultReplaceDataObjMatches(oldDataObj, newDataObj)
{
    var result;

    if(this.isPureProjection &&
       oldDataObj.getDomMatchCount() == 0 && newDataObj.getDomMatchCount() == 0)
        // no matches changed (no selections on indexer)
        return;
    
    // is the change the result of inserting a sequence of selections
    // between the old data object and this node?
    for(result = newDataObj ; result ; result = result.dataObj) {
        if(result == oldDataObj) {
            this.reduceMatchesByInsertedQueries(newDataObj, oldDataObj);
            return;
        } else if(!(result instanceof InternalQueryResult) ||
                  result.rootQueryCalc === undefined ||
                  !result.rootQueryCalc.isSelection())
            break;
    }

    // is the change the result of removing a sequence of selections
    // between the old data object and this node?
    var queriesSpliced = false;
    for(result = oldDataObj ; result ; result = result.dataObj) {
        if(result == newDataObj) {
            queriesSpliced = true;
            break;
        }
        if(!(result instanceof InternalQueryResult) ||
           result.rootQueryCalc === undefined ||
           !result.rootQueryCalc.isSelection() || result.isActive())
            break;
    }

    // check whether the change in match count on this node (if any)
    // needs to be propagated to composed queries. If needed, this is
    // done without changing the matches (these will be updated later)
    this.propagateMatchCountDiff(oldDataObj, newDataObj);
    
    // remove the counts due to the data result nodes being replace.
    // 'removed' the list of full matches on this node (these are candidates
    // for removal, but are not removed until we check whether they should
    // not be added back).
    var removed = this.decreaseCountOfReplacedData(oldDataObj, newDataObj,
                                                   queriesSpliced);
    
    // add the counts due to the new data object inserted.
    // 'added' is an array of full matches added as a result of this operation.
    // The 'removed' object is updated here to remove any removal candidates
    // which were added back in (these do not appear in the 'added' list).
    var added = this.increaseCountOfNewData(newDataObj, removed,
                                            queriesSpliced);

    // convert the removed matches into an array
    var removedMatches = [];
    removed.forEach(function(t, elementId) {
        removedMatches.push(elementId);
    });

    this.pushRemovedMatches(removedMatches, this, this.matchCount);
    this.pushNewMatches(added, this, this.matchCount);
}

// This function is called in the process of replacing a data object
// under 'this' node, such that the replacement does not change the
// dominated indexer or path (see 'replaceDataObjMatches()' for more
// details). It is assumed 'this' node is active.
// 'oldDataObj' is the data object before the replacement and 'newDataObj'
// is the data object after replacement. Both should be active*.
// This function is called to update the match counts of composed result
// nodes, if this is necessary. This update, if needed, takes place
// relative to the existing matches (before replacement) and, therefore,
// does not change the matches of any composed node but only updates
// the match counts.
// After determining whether there is need to propagate the match count
// (iff there are active composed query results and the dominated match
// count of 'this' node is not fixed at 0 or 1) this function calculates
// the difference in match count between the old and the new data object.
// If this difference is not zero, the match counts (and the counts
// of full matches of this node) are updated on the composed query results.
// This function does not modify 'this' object in any way. It is
// the responsibility of the calling function to do so.

InternalQueryResult.prototype.propagateMatchCountDiff =
    internalQueryResultPropagateMatchCountDiff;

function internalQueryResultPropagateMatchCountDiff(oldDataObj, newDataObj)
{
    // does a match count change need to be propagated to the
    // composed nodes? (iff the dominated match count of this node is not
    // fixed at 1 - either if it is a selection or, possibly, if it is a
    // pure projection which may change between a match count of 0 and 1).
    var propagate = (!this.resultIndexer && this.rootQueryCalc &&
                     (this.rootQueryCalc.isSelection() ||
                      this.isPureProjection));

    if(!propagate)
        return; // no need to propagate
    
    // calculate the match count difference between the old and the new data.
    var matchCountDiff = this.getMatchCountDiff(newDataObj, oldDataObj);
        
    if(matchCountDiff == 0)
        return; // no difference, nothing to do

    // in case of a pure projection, the match count may change between 0
    // and 1 in case the dominated match count changes between zero and
    // non-zero.
    if(this.isPureProjection) {
        if(this.matchCount > 0 && this.matchCount + matchCountDiff == 0)
            matchCountDiff = -1;
        else if(this.matchCount == 0) // matchCountDiff must be > 0
            matchCountDiff = 1;
        else
            return; // match count did not change
    }
    
    // need to update the match counts of the active composed queries
    // and the counts for full matches of this node (the actual
    // matches remain unchanged).
    
    var fullMatches = this.getDominatedMatches();
    
    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        if(matchCountDiff > 0)
            composedResult.increaseMatchCount(matchCountDiff,
                                              fullMatches, this);
        else
            composedResult.decreaseMatchCount(-matchCountDiff,
                                              fullMatches, this, false);
    }
}

// This function is used to decrease the match count at this result
// node as a result of a decrease in the match count at the data
// object, but without changing the actual matches (matches can later
// be added and removed). This is used when the match count changes
// as a result of a change in the composition chain (removal of
// selections). 'decMatchCount' indicates the amount by which
// the match count should be decreased. This should not be zero.
// 'dataResultMatches' should be an array holding the data element IDs
// for which the count should be decreased by this amount. These should be
// the dominated matches of the old data object of this node.
// This function operates recursively to decrease the match count of the
// dominating query result nodes until a node is reached which has a fixed
// dominated match count of 1 or zero (such as a projection node or a node
// with a result indexer). At each such recursive step, 'dataResultMatches'
// need only consist of the full matches of the data object of that node.
// 'mayNotDiscardMatches' indicates whether when the match count drops to <= 1
// as a result of the match count decrease, this function should discard
// the 'matches' table (in which case there is also no need to update it)
// or whether the 'matches' table should be updated and not discarded.
// In a recursive call to this function this is always false, but in the
// initial call to the function the calling function may need access to
// the matches after the update even if the match count is <= 1.
// It is then the responsibility of the calling function to update the
// 'matches' table.

InternalQueryResult.prototype.decreaseMatchCount = 
    internalQueryResultDecreaseMatchCount;

function internalQueryResultDecreaseMatchCount(decMatchCount,
                                               dataResultMatches, source,
                                               mayNotDiscardMatches)
{
    if(decMatchCount == 0)
        return;

    if(!this.isActive()) { // inactive, forward to the dominating node
        if(this.dominating)
            return this.dominating.decreaseMatchCount(decMatchCount, 
                                                      dataResultMatches, source,
                                                      false);
        return;
    }

    // does this match count decrease need to be propagated to the
    // composed nodes? (iff the dominated match count of this node is
    // not fixed at 1).
    var propagate = (!this.resultIndexer && this.rootQueryCalc &&
                     (this.rootQueryCalc.isSelection() ||
                      (this.isPureProjection &&
                       this.matchCount == decMatchCount)));
    
    // decrease the match count on this node
    this.setMatchCount(this.matchCount - decMatchCount);

    if(propagate) {

        var preLoweredLength = dataResultMatches.length;
        var isProjection = (this.rootQueryCalc !== undefined &&
                            this.rootQueryCalc.isProjection());
        var fullMatches;

        if(isProjection) {
            // since need to propagate the matches, this must be a pure
            // projection. First check whether the full matches can be fetched
            // from the 'projMatches' table (this may return 'undefined')
            var generatingProj = this.rootQueryCalc.getSingleGeneratingProj();
            fullMatches = generatingProj.getExplicitProjMatches(this.getId());
        }
        
        if(!this.matches) {
            // If there is no 'matches' table here, the previous match count
            // must be <= 1 and the new match count must be 0, so this cannot
            // be a selection and since it is propagated must be a pure
            // projection. If the projection matches were not fetched above,
            // the projection matches of this node are the previous matches of
            // the data object (possibly lowered)
            if(fullMatches === undefined) {
                fullMatches =
                    this.rootQueryCalc.lowerProjMatches(dataResultMatches);
            }
        } else if(this.matchCount <= 1 && !mayNotDiscardMatches) {
            if(!isProjection || fullMatches === undefined) {
                // need to find the full matches, but no need to update the
                // 'matches' table, as it is about to be discarded
                fullMatches = [];
                for(var i = 0, l = dataResultMatches.length ; i < l ; ++i) {
                    var elementId = dataResultMatches[i];
                    var count = this.matches.get(elementId) - decMatchCount;
                    if(count == this.matchCount)
                        // was a full match also before the removal
                        fullMatches.push(elementId);
                }
                if(isProjection) {
                    fullMatches =
                        this.rootQueryCalc.lowerProjMatches(fullMatches);
                }
            }
        } else {
            // In the process of decreasing the counts, we also find the full
            // matches (which need to be provided in the recursive call).
            // The query cannot be a projection in this case.
            fullMatches = [];
            for(var i = 0, l = dataResultMatches.length ; i < l ; ++i) {
                var elementId = dataResultMatches[i];
                if(this.matches.dec(elementId, decMatchCount) ==
                   this.matchCount)
                    // was a full match also before the removal
                    fullMatches.push(elementId);
            }
        }

        // propagate to the dominating nodes

        for(var resultId in this.composedActive) {
            var composedResult = this.composedActive[resultId];
            composedResult.decreaseMatchCount(decMatchCount, fullMatches,
                                              this, false);
        }

        if(dataResultMatches.length > preLoweredLength)
            // modified by lowering, so reset
            dataResultMatches.length = preLoweredLength;
        
    } else if(this.matchCount > 1 || (this.matches && mayNotDiscardMatches)) {
        // no need to propagate, just to update the counts
        for(var i = 0, l = dataResultMatches.length ; i < l ; ++i)
            this.matches.dec(dataResultMatches[i], decMatchCount);
    }

    if(this.matchCount <= 1 && !mayNotDiscardMatches)
        this.matches = undefined;
}

// This function returns the difference in the dominated match count
// of 'newDataObj' and 'oldDatObj' (new match count - old match count).
// If any of these two result nodes is not active, this is calculated
// as if it is (which means that we sum the match counts on it and all
// dominated inactive nodes down to, and including, the first active
// node reached).

InternalQueryResult.prototype.getMatchCountDiff = 
    internalQueryResultGetMatchCountDiff;

function internalQueryResultGetMatchCountDiff(newDataObj, oldDataObj)
{
    var matchCountDiff = 0;

    // add the new match count
    
    var result = newDataObj;
    while(result) {
        matchCountDiff += result.getDomMatchCount();
        if(!(result instanceof InternalQueryResult) || result.isActive())
            break;
        result = result.dataObj;
    }

    // remove the old match count

    var result = oldDataObj;
    while(result) {
        matchCountDiff -= result.getDomMatchCount();
        if(!(result instanceof InternalQueryResult) || result.isActive())
            break;
        result = result.dataObj;
    }

    return matchCountDiff;
}

// This function is called on an active query result node in the process
// of replacing the data object of a query result node such that 'this'
// query result node is the lowest active query result node dominating that node
// (possibly these are the same node and it is the data object of 'this'
// which is being replaced). 'oldDataObj' is the data object being replaced
// and it is assumed that it is still active* when this function is called.
// 'newDataObj' is the data object which replaces 'oldDataObj'.
// This function removes all counts of matches due to the removed data
// object and stored on this query result node. It also subtracts the
// match count due to the old data object. This function only updates
// the match count and the 'matches' table of this object, but does not
// propagate these changes any further (this is the responsibility of the
// calling function). This function does create a list of matches which
// are candidates for removal (those which had a full match count on this
// node before this operation). Thes removal candidates are returned as
// the keys of an Map object returned by this function.

InternalQueryResult.prototype.decreaseCountOfReplacedData = 
    internalQueryResultDecreaseCountOfReplacedData;

function internalQueryResultDecreaseCountOfReplacedData(oldDataObj, newDataObj,
                                                        queriesSpliced)
{
    var result = oldDataObj;
    var removed = new Map(); // candidates for removal as full matches.
    
    if(this.matches === undefined) {
        // match count on 'this' + old data object + any intermediate
        // inactive nodes is <= 1. Therefore, either this node is
        // a selection or the node under it is a selection or the indexer
        // itself. Get the matches of this object.
        var matches = this.rootQueryCalc.isSelection() ?
            this.rootQueryCalc.getMatches() :
            this.dataObj.getDominatedMatches();
        for(var i = 0, l = matches.length ; i < l ; ++i)
            removed.set(matches[i], true);
        // may decrease by 0
        this.setMatchCount(this.matchCount - result.getDomMatchCount());
        return removed;
    }

    // maximal match count to remove (undefined if the change is not the
    // result of splicing a chain of queries).
    var matchCountDiff = queriesSpliced ?
        -this.getMatchCountDiff(newDataObj, oldDataObj) : undefined;

    if(matchCountDiff === 0)
        return removed; // nothing to do
    
    // update the 'matches' table. 

    var domMatchCount = result.getDomMatchCount();

    if(matchCountDiff !== undefined) {
        if(domMatchCount >= matchCountDiff) {
            domMatchCount = matchCountDiff;
            matchCountDiff = 0;
        } else
            matchCountDiff -= domMatchCount;
    }
    
    if(domMatchCount > 0) {
        var matches = result.getDominatedMatches();
    
        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var elementId = matches[i];
            // decrease the count of the match. If the original count was
            // equal to the match count required for a full match, add
            // this to the list of removed full matches.
            if(this.matches.dec(elementId, domMatchCount) + domMatchCount ===
               this.matchCount)
                removed.set(elementId, true);
        }
        this.setMatchCount(this.matchCount - domMatchCount);
    }
    
    // if the replaced data object was not active, continue to remove
    // matches from the dominated data objects until reaching an active node.
    // (this loop is separate from the loop above, as we no longer need to
    // update the 'removed' list).
    
    while(matchCountDiff !== 0 && result && !result.isActive() &&
          (result instanceof InternalQueryResult)) {
        result = result.dataObj;
        if(result === newDataObj)
            break; // these matches remain after the change
        var matches = result.getDominatedMatches();
        var domMatchCount = result.getDomMatchCount(); 

        if(matchCountDiff !== undefined) {
            if(domMatchCount >= matchCountDiff) {
                domMatchCount = matchCountDiff;
                matchCountDiff = 0;
            } else
                matchCountDiff -= domMatchCount;
        }
        
        if(domMatchCount == 0)
            break;
        
        for(var i = 0, l = matches.length ; i < l ; ++i)
            this.matches.dec(matches[i], domMatchCount);

        this.setMatchCount(this.matchCount - domMatchCount);
    }

    return removed;
}

// This function is called on an active query result node in the process
// of replacing the data object of a query result node such that 'this'
// query result node is the lowest active query result node dominating that node
// (possibly these are the same node and it is the data object of 'this'
// which is being replaced). 'newDataObj' is the new function result node
// about to be set as the data object. It is assumed that it is already
// active* when this function is called.
// This function adds all counts of matches due to the new data object
// to the 'matches' table of this object (if there is a 'matches' table)
// and increases the match count on this query result node with the
// match count contributed by the new data object (the match count
// due to the old data object being replaced is assumed to have been
// already subtracted).
// This function also determines which full matches are added to this
// object by the new data object. This is done by checking which
// matches have a full match count after updating the counts.
// This is compared with 'removed' which is a Map object whose keys are
// the list of full matches on this query result object before the
// replacement (this is an initial candidate list for removal).
// When a full match is found in 'removed', it is removed from 'removed'
// and not added to the list of new matches (as it was removed and then
// added back again). If not found in 'removed' the match is added
// to the list of new matches.
// The list of new matches is returned as an array of element IDs
// by this function. When this function returns, the Map object 'removed'
// contains only those matches that need to be removed as a result of
// the replacement (that is, excluding matches which were removed and
// added back again).
// 'queriesSpliced' is a flag passed to this function by the calling function
// to indicate (when the flag is set) that the replacement of the data object
// resulted in the removal of selections from the query chain between
// 'this' and 'newDataObj' (that is, the old data object dominated
// 'newDataObj'). In this case, no matches could be removed by this
// replacement (as selections were only added) and this knowledge allows
// the function to operate somewhat more efficiently.

InternalQueryResult.prototype.increaseCountOfNewData = 
    internalQueryResultIncreaseCountOfNewData;

function internalQueryResultIncreaseCountOfNewData(newDataObj, removed,
                                                   queriesSpliced)
{    
    // calculate the new match count (incrementally). No need to do so
    // if the change is due to the splicing of queries, as the match count
    // was already properly calculated when removing the old data object.
    var incMatchCount = 0;
    if(!queriesSpliced) {
        var result = newDataObj;
        while(result) {
            incMatchCount += result.getDomMatchCount();
            if(!(result instanceof InternalQueryResult) || result.isActive())
                break;
            result = result.dataObj;
        }

        this.matchCount += incMatchCount;
        if(this.requiresExplicitProjMatches() &&
           !this.rootQueryCalc.hasExplicitProjMatches()) {
            // This can only happen if the query is a pure projection and
            // the match count increased from 0. So we set the projection
            // matches directly (these are still the old matches, but they
            // are about to be updated).
            var matches = this.dataObj.getDominatedMatches();
            matches = this.rootQueryCalc.lowerProjMatches(matches);
            this.rootQueryCalc.initExplicitProjMatches(this.getId(), matches);
            this.refreshProjProperties();
        }
    }
    
    result = newDataObj; // reset to the top of the chain
    var addedMatches = []; // new full matches

    if(incMatchCount == 0 && (this.matchCount == 0 || !this.matches)) {
        
        // special case: the new data object is the indexer and there are
        // no additional nodes between 'this' and 'newDataObj' (otherwise
        // the match count before this operation would have been > 1 and
        // this.matches would have existed). So we need to get the matches
        // (from the root query calculation node if this is a selection or
        // from the new data object, if this is a projection.

        var matches = this.matchCount > 0 ?
            this.getMatchesFromSource(this.rootQueryCalc) :
            newDataObj.getDominatedMatches();

        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var elementId = matches[i];
            if(!removed.has(elementId))
                addedMatches.push(elementId);
        }

        this.matches = undefined;
        // all removed matches must be in the matches fetched from indexer
        removed.clear();
        return addedMatches;
        
    } else if(incMatchCount == 0) {

        // this.matchCount > 0 so there are some selections between the new
        // data object and 'this' node (possibly 'this' node itself) and
        // this.matches exists, so these matches are already stored in
        // this.matches 
        var _self = this;
        this.matches.forEach(function(count, elementId) {
            if(count == _self.matchCount && !removed.has(elementId))
                addedMatches.push(elementId);
        });
        if(this.matchCount <= 1)
            this.matches = undefined;
        // Since the new data object is the indexer, this operation only
        // removed selections and there are no matches removed.
        removed.clear();
        return addedMatches;
        
    } else if(this.matchCount <= 1) {
        this.matches = undefined;
        // newDataObj must have a dominated match count of 1 and is the only
        // node to add matches from (otherwise, this would have been handled
        // above).
        var matches = this.getMatchesFromSource(result);
        // check which of these matches were removed. The difference is
        // the list of matches added.
        if(removed.size == 0)
            addedMatches = matches;
        else if(queriesSpliced) { // no matches could have been removed
            for(var i = 0, l = matches.length ; i < l ; ++i) {
                var elementId = matches[i];
                if(!removed.has(elementId))
                    addedMatches.push(elementId);
            }
            removed.clear();
        } else
            for(var i = 0, l = matches.length ; i < l ; ++i) {
                var elementId = matches[i];
                if(removed.has(elementId))
                    removed.delete(elementId);
                else
                    addedMatches.push(elementId);
            }

        return addedMatches;
    }

    // match count at least 2
    
    if(this.matches === undefined) {
        if(this.matchCount > incMatchCount) {
            // need to add the matches of the selections between this
            // node and the place the old data object was
            // removed. Since there was no matches table, only one
            // selection could have added here matches, either this
            // node, or its old (still stored) data object. Since the
            // total match count is > 1, these cannot be full matches.
            this.matches = new IntHashMapUint(this.matchCount, matches.length);
            var matches = this.rootQueryCalc.isSelection() ?
                this.getMatchesFromSource(this.rootQueryCalc) :
                this.getMatchesFromSource(this.dataObj);
            for(var i = 0, l = matches.length ; i < l ; ++i)
                this.matches.set(matches[i], 1);
        } else
            this.matches = new IntHashMapUint(this.matchCount);
    }
    
    // add the matches of the new data object and (if it is not active) of
    // its data object chain down to the first active (or non-query) node

    while(result) {

        var domMatchCount = result.getDomMatchCount();
        
        if(domMatchCount == 0)
            break;

        var matches = this.getMatchesFromSource(result);

        this.matches.expectSize(matches.length);
        
        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var elementId = matches[i];
            var count = this.matches.inc(elementId, domMatchCount);
            
            if(count == this.matchCount) { // full match
                if(removed.size !== 0 && removed.has(elementId)) {
                    if(!queriesSpliced)
                        removed.delete(elementId);
                } else
                    addedMatches.push(elementId);
            }
        }
        
        if(!(result instanceof InternalQueryResult) || result.isActive())
            break;
        result = result.dataObj;
    }

    if(queriesSpliced)
        removed.clear();
    
    return addedMatches;
}

// This is an auxiliary function which fetches the list of matches
// (an array of element IDs) from a given source (which should be
// either the root query calculation node of this query result or
// a function result object dominated by this node such that 'this' query
// result object is the object which receives match add and remove updates
// from that source). This function is used in situations (such as in the
// process of replacing a data object or refreshing the root query calculation
// node) where addMatches updates are not processed but queued. In these
// situations it is known that these are initial addMatches() calls
// and therefore contain the full set of matches for the source. In
// this case, there is no need to go back to the original source to
// fetch the matches, but it is enough to use the queued matches. This
// function then removes the matches received from the source from the
// list of queued updates (as it should only be procesed once).
// If no queued match update is found for thie given source, this function
// retrieves the matches from the source directly (using its
// 'getMatches()' or 'getDominatedMatches()' function).

InternalQueryResult.prototype.getMatchesFromSource = 
    internalQueryResultGetMatchesFromSource;

function internalQueryResultGetMatchesFromSource(source)
{
    if(source === undefined)
        // may happen if the source is the root query calculation node
        // and this node has ot yet been created. So there are no matches.
        return [];
    
    var matches;
    
    if(this.pendingAddMatches !== undefined &&
       this.pendingAddMatches.length > 0) {
        for(var i = 0, l = this.pendingAddMatches.length ; i < l ; ++i) {
            if(this.pendingAddMatches[i].source == source) {
                var additionalMatches = this.pendingAddMatches[i].elementIds;
                matches = matches ?
                    cconcat(matches, additionalMatches) : additionalMatches;
                // remove these matches, they may only be used once
                this.pendingAddMatches.splice(i,1);
                l--;
                i--; // next entry is now at the current offset
            }
        }
    }

    if(matches !== undefined)
        return matches;

    return (source == this.rootQueryCalc ?
            this.rootQueryCalc.getMatches() : source.getDominatedMatches());
}

// This function is identical to geMatchesFromSource() except that it
// returns the matches as a Map object rather than as an array.

InternalQueryResult.prototype.getMatchesFromSourceAsObj = 
    internalQueryResultGetMatchesFromSourceAsObj;

function internalQueryResultGetMatchesFromSourceAsObj(source)
{
    // get in array format
    var matches = this.getMatchesFromSource(source);

    if(matches !== undefined) {
        var matchesAsObj = new Map();
        for(var i = 0, l = matches.length ; i < l ; ++i)
            matchesAsObj.set(matches[i], 1);
        return matchesAsObj;
    }

    return new Map(); // empty set of matches
}

///////////////////////////////////////////
// Result Chain Insertion and Extraction //
///////////////////////////////////////////

// This function is called to determine the match count difference between
// the chain headed by the function result 'topDataObj' and the chain headed by
// the function result 'bottomDataObj'. This is the difference in the
// match count these chains would contribute to 'this' if 'this' is active
// and has each of these data objects as its data object.

InternalQueryResult.prototype.getChainMatchCountDiff =
    internalQueryResultGetChainMatchCountDiff;

function internalQueryResultGetChainMatchCountDiff(topDataObj, bottomDataObj)
{
    var topDataObjCount =
        (topDataObj instanceof InternalQueryResult) ?
        topDataObj.getAccumulatedMatchCount() : topDataObj.getDomMatchCount();
    var bottomDataObjCount =
        (bottomDataObj instanceof InternalQueryResult) ?
        bottomDataObj.getAccumulatedMatchCount() :
        bottomDataObj.getDomMatchCount();

    return topDataObjCount - bottomDataObjCount;
}

// This function calculates the match count as accumulated up to this
// function result. This is the match count that the chain under this
// result node contributes to its dominating active query result node.
// If the node is active, this is simply its match count. If the node is
// not active, this goes down the chain until it reaches an active node
// (either a non-query-result node, or one with a match count of zero
// or an active query result). It then returns the match count of the
// active node + the number of non-active query result nodes between that
// node and 'this' node (including).

InternalQueryResult.prototype.getAccumulatedMatchCount =
    internalQueryResultGetAccumulatedMatchCount;

function internalQueryResultGetAccumulatedMatchCount()
{
    var count = 0;

    var result = this;
    while(result) {
        var domMatchCount = result.getDomMatchCount();
        if(domMatchCount == 0 || !(result instanceof InternalQueryResult) ||
           result.isActive())
            return count + domMatchCount;

        count++; // non-active selection query
        result = result.dataObj;
    }

    return count;
}

// This function is called to determine the matchs of a chain of queries
// such that 'topDataObj' is the top-most query result node in the chain
// and 'bottomDataObj' is the data object of the lowest of query result node
// in the chain (that is, 'bottomDataObj' is not part of this chain).
// Only matches which are visible to a function result composed with
// 'topDataObj' are accumulated here, so 'bottomDataObj' is only
// a bound on the bottom of the chain. The matches are accumulated from
// 'topDataObj' down the data object chain until either an active
// query result is reached (this is included in the matches) or an
// non-query-result node is reached (this is included in the matches)
// or 'bottomDataObj' is reached (this is not included).
// A zero match count result node also ends the chain, since there cannot
// be any additional matches between it and the indexer.
// The function returns an object of the form:
// {
//    fullMatches: <array of element IDs>,
//    partialMatchObj: <Map>{
//        <element ID>: <partial count>,
//        .....
//    }
//    matchCount: <number>
// }
// 'fullMatches' holds the full matches for the chain of queries, that is,
// those matches which are matches on each and every result node which
// contributed to the matches.
// 'partialMatchObj' is defined only if 'topDataObj' is not an active
// query result node. In this case, this object stores the partial counts
// contributed by query result nodes in this chain for elements which are
// not fully matched by the chain.
// 'matchCount' is the total count for the full matches. This is the sum
// of the counts of all result nodes belonging to the chain (an element
// is a full match iff it is matched by each of these result nodes, which
// means that each of tehses result nodes contributes to the element's count
// its full match count).

InternalQueryResult.prototype.getChainMatches =
    internalQueryResultGetChainMatches;

function internalQueryResultGetChainMatches(topDataObj, bottomDataObj)
{
    if(!(topDataObj instanceof InternalQueryResult) || topDataObj.isActive())
        // node is active, so we only need to look at its matches
        return { fullMatches: this.getMatchesFromSource(topDataObj),
                 matchCount: topDataObj.getDomMatchCount()
               };
        
    // the new data object is not active, so we need to look also at its
    // data object chain (as explained in the introduction). We need to
    // collect the counts of the various elements and then distinguish
    // between full matchs and partial matches.

    var matchObj = new Map(); // eventually stores non-full matches
    var fullMatches = []; // eventually stores full matches 
    var totalMatchCount = 0;
    
    var result = topDataObj;
    while(result) {

        // extra match count contributed by this node
        var matchCount = result.getDomMatchCount();
        var matches = undefined;
        
        if(result == bottomDataObj || matchCount == 0) {
            // this terminates the chain and the matches of this result node
            // are not included. It remains to determine the full matches
            // among the matches collected so far.
            if(matchObj.size > 0) {
                if(totalMatchCount == 1) {
                    matchObj.forEach(function(count, elementId) {
                        fullMatches.push(elementId);
                    })
                    matchObj.clear();
                } else {
                    matchObj.forEach(function(count, elementId) {
                        if(count < totalMatchCount)
                            return;
                        fullMatches.push(elementId);
                        matchObj.delete(elementId);
                    });
                }
            }
            break; // last result node to be included in this calculation
        } else if(!(result instanceof InternalQueryResult) ||
                  result.isActive()) {
            // this is the last result node for which matches are added here.
            // These are used in determining the full matches, and their
            // count is included in the partial matches.
            totalMatchCount += matchCount;
            matches = this.getMatchesFromSource(result);
            if(matchObj.size == 0) {
                if(matchCount < totalMatchCount) {
                    // no full matches possible, only add partial matches
                    for(var i = 0, l = matches.length ; i < l ; ++i)
                        matchObj.set(matches[i], matchCount);
                } else // all matches are full matches (no partial matches)
                    fullMatches = matches;
            } else {
                for(var i = 0, l = matches.length ; i < l ; ++i) {
                    var elementId = matches[i];
                    if(!matchObj.has(elementId))
                        matchObj.set(elementId, matchCount); // partial match
                    else {
                        var count = matchObj.get(elementId) + matchCount;
                        if(count == totalMatchCount) { // full match
                            fullMatches.push(elementId);
                            matchObj.delete(elementId); // not a partial match
                        } else
                            matchObj.set(elementId, count);
                    }
                }
            }
            break;
        } else if(matchObj.size == 0) {
            totalMatchCount += matchCount;
            matches = this.getMatchesFromSource(result);
            for(var i = 0, l = matches.length ; i < l ; ++i)
                matchObj.set(matches[i], matchCount);
        } else {
            totalMatchCount += matchCount;
            matches = this.getMatchesFromSource(result);
            for(var i = 0, l = matches.length ; i < l ; ++i) {
                var elementId = matches[i];
                if(matchObj.has(elementId))
                    matchObj.set(elementId,
                                 matchObj.get(elementId) + matchCount);
                else
                    matchObj.set(elementId, matchCount);
            }
        }
        
        result = result.dataObj;
    }

    return { fullMatches: fullMatches, partialMatchObj: matchObj,
             matchCount: totalMatchCount
           };
}

///////////////////////////////
// Selection Chain Insertion //
///////////////////////////////

// The following functions handle the special case where a sequence of
// queries is inserted into the function result chain.

// This function is called to update the matches on 'this' node (which is
// expected to be active, otherwise the call is forwarded to its
// dominating active node) after a sequence of queries has been
// inserted into the function result chain under this query result node
// such that the insertion of these queries does not obscure the matches
// of the result nodes which were previously dominated by this node.
// This can happen in one of several ways:
// 1. only non-active query result nodes separate 'this' query
//    result and the point at which the selections were inserted into the
//    chain. Since only non-active selections separate this node from the
//    result nodes it previously dominated, all matches collected on
//    this node previously continue to be collected here. 
// 2. before the change, there were no selections made on the indexer
//    between this query result node and the indexer and after the
//    change the dominated indexer and path remain the same. Since there
//    were no selections made, these are not obscured by the new data objects.
// 'newDataObj' is the highest query result node in the sequence of
// result nodes inserted. 'oldDataObj' is the function result node just under
// the point of insertion (that is, 'newDataObj' is about to replace
// 'oldDataObj' as the data object of 'this' node or of some inactive node
// under 'this'). At this point, 'oldDataObj' is still set as the data
// object of this node.
// This function then updates the match counts and matches for 'this'
// node and its dominating nodes. Since selections were inserted, matches
// may only be removed by this operation.

InternalQueryResult.prototype.reduceMatchesByInsertedQueries = 
    internalQueryResultReduceMatchesByInsertedQueries;

function internalQueryResultReduceMatchesByInsertedQueries(newDataObj,
                                                           oldDataObj)
{
    if(!this.isActive()) {
        var active = this.dominating;
        if(active)
            active.reduceMatchesByInsertedQueries(newDataObj, oldDataObj);
        return;
    }
    
    // calculate the increase in match count
    var incMatchCount = this.getChainMatchCountDiff(newDataObj, oldDataObj);

    if(incMatchCount === 0)
        // nothing to do, the inserted queries do not select
        // (e.g. a comparison).
        return;
        
    // get the full and partial matches of the inserted chain
    var matches = this.getChainMatches(newDataObj, oldDataObj);

    // update the full matches and the match count
    this.addPrefixResultRestrictions(oldDataObj, matches.fullMatches,
                                     matches.matchCount,
                                     undefined, incMatchCount);
    
    if(matches.partialMatchObj === undefined)
        return; // no partial matches
    
    // increase the count for partial matches
    var _self = this;
    matches.partialMatchObj.forEach(function(count, elementId) {
        _self.matches.inc(elementId, count);
    });
}

// This function (which should only be called on an active node),
// is called after a sequence of queries has been inserted into the
// function result chain under this query result node.
// This function is only called if the insertion did not change the
// dominated indexer or projection path for this query result.
// This function is only responsible for updating the full matches of this
// query result node and increasing the match count and then propagating
// these two updates to the dominating nodes. This function does not need
// to add partial matches for the query chain added (this is done by
// a different function). Since selections are only added, this function
// only needs to increase the match count, remove matches and decrease
// the count of matches. The 'matches' table may also need to be created as
// a result of increasing the match count.
// The function is provided with the following arguments:
// 'oldDataObj': this is the data object directly under the chain
//    being inserted. This object is only needed if 'this' query result node
//    does not have a 'matches' table (in which case the matches may have to
//    be fetched from 'oldDataObj', see below). 
// 'matches' is an array of element IDs which are the full matches of the
//    chain inserted. These matches are those data elements which are
//    matched on every result node in the inserted chain whose matches
//    are counted on this query result.
// 'matchCount': this is the total match count on the inserted chain.
//    This is the count each element in 'matches' has on the inserted chain.
// 'incMatchCount': this is the difference in match count contributed by
//    the data object of this query result after the insertion and
//    the data object before the insertion. This is the amount by which the
//    match count of this query result node will change.
//    'matchCount' - 'incMatchCount' is the amount by which the count
//    should be decreased of full matches from the data object which are
//    no longer matches of the new object .
// This function first goes over all matches which were a full match before
// this update and checks whether they are in 'matches'. If not, they
// are added to the list of matches removed from this result node.
// These removed matches are then pushed further (to remove projection
// matches and matches from composed functions). This function then
// increases the match count of this result node by 'incMatchCount'.
// The count of all matches on this node which are in 'matchesAsObj' is
// increased by 'incMatchCount' (so they are matches iff they were matches
// before this update). This operation (of increasing the match count
// and the counts of the matches) is propagated to the composed result
// nodes (until a node is reached whose match count is fixed).
// A special case occurs when this query result does not have a 'matches'
// table and therefore does not store its original list of full matches.
// These full matches must therefore be fetched. There are several
// possibilities:
// 1. This node is a selection query. The full matches are the matches of
//    the selection query.
// 2. This node is a projection. The 'matches' of this result node
//    are therefore the selection matches received from the old data object
//    of this node. These may have a match count of 0 or 1. This
//    means that this node could not receive updates from more than one
//    dominated node and therefore this dominated node is 'oldDataObj'
//    (which must be its old data object). There are now two possibilities.
//    a. The dominated match count of 'oldDataObj' is 1 (which means that
//       the match count of 'this' node is 1). In this case, we simply
//       get the dominated matches from 'oldDataObj' to determine the
//       previous list of full matches.
//    b. The dominated match count of 'oldDataObj' is zero. There are two
//       cases:
//       1. The projection is a pure projection: this case is handled by
//          the function addPrefixRestrictionsToNoSelection() (see details
//          there).
//       2. The projection is not a pure projection. In this case, we
//          handle the update in exactly the same way as in 'a' above.
// As this only applies to full matches, if any partial
// matches of inactive query results under this node need to be collected
// on this node (due to inserted inactive nodes under the place of insertion),
// those partial counts need to be added to this query result object by
// the calling function (this operation does not need to be propagated to
// dominating nodes).
// 'matchesAsObj' is a Map object which should store (as keys) the same
// matches as 'matches'. If it is undefined, it will be created by this
// function.

InternalQueryResult.prototype.addPrefixResultRestrictions = 
    internalQueryResultAddPrefixResultRestrictions;

function internalQueryResultAddPrefixResultRestrictions(oldDataObj, matches,
                                                        matchCount,
                                                        matchesAsObj,
                                                        incMatchCount)
{
    if(!this.resultIndexer) {
        if(this.hasNoSelectionOnIndexer()) {
            // special case: this node together with the nodes it dominates
            // (before the restrictions are added) does not perform any
            // selection on the indexer.
            this.addPrefixRestrictionsToNoSelection(matches, matchesAsObj,
                                                    incMatchCount);
            return;
        }
    }
    
    // remaining cases

    if(matchesAsObj === undefined) {
        matchesAsObj = new Uint31HashSet(matches.length);
        for(var i = 0, l = matches.length ; i < l ; ++i)
            matchesAsObj.set(matches[i]);
    }
    
    // first find the removed matches. These are all node whose count 
    // is equal to the match count before the update and are not
    // included in the list of matches for which the count should be increased.
    var removedMatches = [];
    var removedMatchCount = matchCount - incMatchCount;
    
    if(this.matches === undefined) {
        // this.matchCount is 0 or 1
        var existingMatches;

        if(!this.rootQueryCalc)
            existingMatches = [];
        else if(this.rootQueryCalc.isSelection())
            existingMatches = this.rootQueryCalc.getMatches();
        else if(oldDataObj.getDomMatchCount() == 0 && this.matchCount == 1)
            // existing match count is due to an inactive node dominated
            // by this node (the query chain was inserted under it).
            existingMatches = this.dataObj.getDominatedMatches();
        else
            existingMatches = oldDataObj.getDominatedMatches();

        if(this.matchCount + incMatchCount > 1)
            this.matches = new IntHashMapUint(this.matchCount + incMatchCount,
                                              existingMatches.length);

        if(this.matchCount == 1 && incMatchCount > 0) {
            if(removedMatchCount > 0) { // must be 1
                // add to the 'matches' table only elements which are not
                // removed (for remove matches the count drops by 1 to 0)
                for(var i = 0, l = existingMatches.length ; i < l ; ++i) {
                    var elementId = existingMatches[i];
                    if(!matchesAsObj.has(elementId))
                        removedMatches.push(elementId);
                    else
                        this.matches.set(elementId, 1);
                }
            } else {
                for(var i = 0, l = existingMatches.length ; i < l ; ++i) {
                    var elementId = existingMatches[i];
                    this.matches.set(elementId, 1);
                    if(!matchesAsObj.has(elementId))
                        removedMatches.push(elementId);
                }
            }
        } else { // this.matchCount == 0 or incMatchCount == 0
            // possible if this node has a result indexer
            for(var i = 0, l = existingMatches.length ; i < l ; ++i) {
                var elementId = existingMatches[i];
                if(!matchesAsObj.has(elementId))
                    removedMatches.push(elementId);
            }
        }

    } else {
        var _self = this;

        if(removedMatchCount == _self.matchCount)
            // all matches will have full match count
            this.matches.forEach(function(count, elementId) {
                if(!matchesAsObj.has(elementId)) {
                    removedMatches.push(elementId);
                    _self.matches.delete(elementId);
                }
            });
        else if(removedMatchCount === 0) {
            // no need to change the counts
            this.matches.forEach(function(count, elementId) {
                if(!matchesAsObj.has(elementId)) {
                    if(count == _self.matchCount)
                        removedMatches.push(elementId);
                }
            });
        } else {
            this.matches.forEach(function(count, elementId) {
                if(!matchesAsObj.has(elementId)) {
                    if(count == _self.matchCount)
                        removedMatches.push(elementId);
                    _self.matches.set(elementId, count - removedMatchCount); 
                }
            });
        }
    }

    // forward the removed matches (with the old match count)
    this.pushRemovedMatches(removedMatches, this.dataObj, this.matchCount);
    
    // adjust the match counts
    this.increaseMatchCount(incMatchCount, matches, this);
}

// This function implements addPrefixResultRestrictions() for the special
// case where currently (before the change) this node and all nodes it
// dominates do not perform any selections on the indexer. This means that
// this node is a pure projection and that the dominated nodes have
// a match count of zero. As a result, this node never added its matches
// to the dominating nodes. It may, however, add its matches from now on
// (with a count of 1) since this function would not be called if nothing
// changes.
// This function is responsible for adding the full matches (given in the
// array 'matches') of the inserted restrictions to the matches table
// of this and dominating nodes and to update the full matches of those nodes
// and the match count of this and the dominating nodes.
// This function is not responsible, however, for adding the partial matches
// of the inserted chain. This addition (which cannot change full matches)
// is performed later by a different function.
// 'matchesAsObj' is a Map object which should store (as keys) the same
// matches as 'matches'. If it is undefined, it will be created by this
// function.

InternalQueryResult.prototype.addPrefixRestrictionsToNoSelection = 
    internalQueryResultAddPrefixRestrictionsToNoSelection;

function internalQueryResultAddPrefixRestrictionsToNoSelection(matches,
                                                               matchesAsObj,
                                                               incMatchCount)
{
    if(incMatchCount == 0)
        return; // nothing changed
    
    // since this node is a projection, its matches are those received
    // from the inserted chain, but may possibly have to be lowered. The
    // lowered matches are appended at the end of the 'matches' array
    // (and later removed).
    var preLoweredLength = matches.length;
    matches = this.rootQueryCalc.lowerProjMatches(matches);

    var clearLoweredFromObj = false;
    
    if(matchesAsObj === undefined) {
        matchesAsObj = new Uint31HashSet(matches.length);
        for(var i = 0, l = matches.length ; i < l ; ++i)
            matchesAsObj.set(matches[i]);
    } else if(matches.length > preLoweredLength) {
        // add the lowered matches
        for(var i = preLoweredLength, l = matches.length ; i < l ; ++i)
            matchesAsObj.set(matches[i]);
        clearLoweredFromObj = true; // need to remove these matches below
    }
    
    if(this.hasNonQueryActiveComposed()) {
        // non-query result nodes need to be notified explicitly of the
        // matches removed.
        
        var generatingProj = this.rootQueryCalc.getSingleGeneratingProj();
	    var projMatches = generatingProj.getProjMatches(this.getId());
        var removedMatches = [];
        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
            var elementId = projMatches[i];
            if(matchesAsObj.has(elementId))
                continue;
            removedMatches.push(elementId);
        }
        
        for(var resultId in this.composedActive) {
            var composedResult = this.composedActive[resultId];
            if(composedResult instanceof InternalQueryResult)
                continue; // will be handled below
            composedResult.removeMatches(removedMatches, this);
        }
    }

    // update the composed query result
    
    // Since this query result did not add any matches to the dominating
    // nodes previously, we can forward the update operation to the
    // dominating nodes.
    
    for(var resultId in this.composedActive) {
        var composedResult = this.composedActive[resultId];
        if(!(composedResult instanceof InternalQueryResult))
            continue; // handled above
        var active = composedResult.isActive() ?
            composedResult : composedResult.dominating;
        if(!active)
            continue;
        // dominated match count of 'this' (a projection) was previously
        // zero and now 1, so the increase in match count is 1.
        active.addPrefixResultRestrictions(this, matches, 1, matchesAsObj, 1);
    }

    // update match count (must have been zero before)
    this.matchCount = incMatchCount;
    if(this.requiresExplicitProjMatches()) {
        // set the projection matches directly (all updates to dominating nodes
        // already took place). These matches were already lowered.
        this.rootQueryCalc.initExplicitProjMatches(this.getId(), matches);
        this.refreshProjProperties();
    }

    if(this.matchCount > 1) {
        // create a match table (these are the selection matches of query, so
        // before lowering) tand update it with the full matches of the
        // dominated data objects (the partial matches will be added later).
        this.matches = new IntHashMapUint(this.matchCount, matches.length);
        for(var i = 0, l = matches.length ; i < l ; ++i)
            this.matches.set(matches[i], incMatchCount);
    }

    // restore the pre-lowered list
    
    if(clearLoweredFromObj)
        for(var i = preLoweredLength, l = matches.length ; i < l ; ++i)
            matchesAsObj.delete(matches[i]);
    
    matches.length = preLoweredLength;

}

// This function is used to increase the match count at this result
// node as a result of an increase in the match count at the data
// object, but without changing the actual matches (matches can later
// be added and removed). This is used when the match count changes
// as a result of a change in the composition chain (insertion of
// additional selections). 'incMatchCount' indicates the amount by which
// the match count should be increased. This should not be zero.
// 'dataResultMatches' should be an array holding the data element IDs
// for which the count should be increased by this amount. These should be
// the dominated matches of the (new) data object of this node.
// It is assumed that all matches of the original data object which were
// removed by the selections inserted have been already removed. Therefore,
// this list of matches is the list of matches for which the count needs
// to be increased.
// This function operates recursively to increase the match count of the
// dominating query result nodes until a node is reached which has a fixed
// dominated match count of 1 or zero (such as a projection node or a node
// with a result indexer). At each such recursive step, 'dataResultMatches'
// need only consist of the full matches of the data object of that node.

InternalQueryResult.prototype.increaseMatchCount = 
    internalQueryResultIncreaseMatchCount;

function internalQueryResultIncreaseMatchCount(incMatchCount, dataResultMatches,
                                               source)
{
    if(incMatchCount == 0)
        return;

    if(!this.isActive()) { // inactive, forward to the dominating node
        if(this.dominating)
            this.dominating.increaseMatchCount(incMatchCount, 
                                               dataResultMatches, source);
        return;
    }

    // does this match count increase need to be propagated to the
    // composed nodes? (iff the dominated match count of this node is
    // not fixed at 1 and it did not just increase from 0 to 1).
    var propagate = (!this.resultIndexer && this.rootQueryCalc &&
                     (this.rootQueryCalc.isSelection() ||
                      (this.isPureProjection && this.matchCount == 0)));
    
    // update this node
    
    this.setMatchCount(this.matchCount + incMatchCount);
    
    if(propagate) {
        
        var propagatedMatches = []; // full matches after this update
        if(this.matches === undefined) {
            if(this.matchCount <= 1)
                propagatedMatches = dataResultMatches;
            else {
                // add all matches to the match table.
                // since the matches need to be propagated, this is a selection,
                // so the matches calculated in this process are the propagated
                // matches
                this.matches = new IntHashMapUint(this.matchCount);
                this.addDominatedMatchesWithoutForwarding(this,
                                                          propagatedMatches);
            }
        } else {
            // only need to increase the match counts of the data result matches
            
            this.matches.expectSize(dataResultMatches.length);
            
            for(var i = 0, l = dataResultMatches.length ; i < l ; ++i) {
                var elementId = dataResultMatches[i];

                if(!this.matches.has(elementId)) // cannot be full match
                    this.matches.set(elementId, incMatchCount);
                else {
                    var count = this.matches.get(elementId) + incMatchCount; 
                    this.matches.set(elementId, count);
                    if(count === this.matchCount)
                        propagatedMatches.push(elementId);
                }
            }
        }

        for(var resultId in this.composedActive) {
            var composedResult = this.composedActive[resultId];
            composedResult.increaseMatchCount(incMatchCount, propagatedMatches,
                                              this);
        }
        
    } else {
        if(this.matchCount > 1) {
            if(this.matches === undefined) {
                this.matches = new IntHashMapUint(this.matchCount);
                this.addDominatedMatchesWithoutForwarding(this);
            } else
                for(var i = 0, l = dataResultMatches.length ; i < l ; ++i)
                    this.matches.inc(dataResultMatches[i], incMatchCount);
        }
    }
}

/////////////////////////////
// Selection Chain Removal //
/////////////////////////////

// This function is called when 'oldDataObj' is replaced
// by 'newDataObj' as the data object of some result node dominated
// by this node such that between this node and 'oldDataObj' there
// were no active nodes (that is, 'this' query result collected the matches
// of 'oldDataObj' and all query results between 'oldDtaObj' and 'this'
// node). In addition, this function is called under the assumption that
// this query result is active, that the dominated indexer and projection
// path did not change as a result of the replacement of the data object
// and that the dominated match count of 'newDataObj' is zero. This means
// that all restrictions on the matches due to the query chain under
// 'oldDataObj' (including) can be removed from 'this' nodes (and the
// consequences of the removal of these matches is then propagated to the
// dominating nodes).
// Due to the nature of this update, the match count on 'this' and possibly
// some dominating nodes decreases and all matches due to the chain
// under 'oldDataObj' need to be removed from the match tables, which results
// in matches possibly being added.

InternalQueryResult.prototype.removeRestrictionsOfRemovedQueries =
    internalQueryResultRemoveRestrictionsOfRemovedQueries;

function internalQueryResultRemoveRestrictionsOfRemovedQueries(newDataObj,
                                                               oldDataObj)
{
    // the amount by which the match count should be decreased.
    var decMatchCount = this.getChainMatchCountDiff(oldDataObj, newDataObj);

    // get the full and partial matches of the removed chain
    var matches = this.getChainMatches(oldDataObj, newDataObj);

    // decrease the count for partial matches

    if(matches.partialMatchObj !== undefined) {
        var _self = this;
        matches.partialMatchObj.forEach(function(count, elementId) {
            var newCount = _self.matches.get(elementId) - count;
            if(newCount == 0)
                _self.matches.delete(elementId);
            else
                _self.matches.set(elementId, newCount);
        });
    }
    
    // update the full matches and the match count

    this.removePrefixResultRestrictions(matches.fullMatches,
                                        undefined, decMatchCount);
}

// This function is called to update the matches and match count of
// this result node and its dominating nodes when a chain of result nodes
// dominated by this node was removed. 'matches' are the full matches
// this removed chain contributed to match counts of this node.
// 'decMatchCount' is the difference between the match count contributed
// (to this result query) by the old data object and the new data object. 
// This function decreases the count of matches in 'matches' which are in
// the 'this.matches' table by 'decMatchCount' and decreases the match count
// by 'decMatchCount'.
// it then adds those matches which previously did not have a full match
// count but after this update do have a full match count as matches
// (notifying the dominating nodes).
// 'matchesAsObj' is a Map object which stores the same matches (as keys)
// as 'matches'. This object is optional, if it is not provided, this
// function will created it if needed.

InternalQueryResult.prototype.removePrefixResultRestrictions = 
    internalQueryResultRemovePrefixResultRestrictions;

function internalQueryResultRemovePrefixResultRestrictions(matches,
                                                           matchesAsObj,
                                                           decMatchCount)
{
    // the function should be called on an active node
    if(!this.isActive()) {
        if(this.dominating !== undefined)
            this.dominating.removePrefixResultRestrictions(matches,
                                                           matchesAsObj,
                                                           decMatchCount);
        return;
    }
    
    var newMatchCount = this.matchCount - decMatchCount;

    if(!this.resultIndexer && newMatchCount == 0 && this.isPureProjection) {
        // special case: this is a pure projection and match count drops to 0

        if(this.hasNonQueryActiveComposed() && matchesAsObj === undefined) {
            // object will also be used below, so create it here (otherwise
            // will be created inside the removeRestrictionsFromNoSelection()
            // function as needed).
            matchesAsObj = new Uint31HashSet();
            for(var i = 0, l = matches.length ; i < l ; ++i)
                matchesAsObj.set(matches[i]);
        }
        
        this.removeRestrictionsFromNoSelection(matches, matchesAsObj);
        if(!this.hasNonQueryActiveComposed())
            return;
    } else {
        // if all match count is removed, this node is a projection  and we
        // do not need the 'matches' table to determine which matches were
        // added (these are all matches from the indexer which are not in
        // 'matches') Othewise, we need to keep the match table until the
        // added matches are determined, even if the match count drops to 1.
        var mayNotDiscardMatches = (newMatchCount != 0);
    
        // decrease the match count (and the individual counts of the matches)
        // (this propagates this update to dominating nodes).
        this.decreaseMatchCount(decMatchCount, matches, this,
                                mayNotDiscardMatches);
    }

    // determine which matches are added as a result of this operation
    // These are those matches which will have a full match count after
    // this update but did not have a full match count before.

    if(matchesAsObj === undefined) {
        matchesAsObj = new Uint31HashSet(matches.length);
        for(var i = 0, l = matches.length ; i < l ; ++i)
            matchesAsObj.set(matches[i], 1);
    }

    var addedMatches = []; // new full matches at this node
    
    if(this.matches !== undefined) {
        // find the full matches which do not appear in 'matchesAsObj'
        var fullMatchCount = this.matchCount;
        this.matches.forEach(function(count, elementId) {
            if(count != fullMatchCount)
                return;
            if(!matchesAsObj.has(elementId))
                addedMatches.push(elementId);
        });
    } else {
        // the new match count is 0 so this is a projection and the added
        // matches are all the indexer's matches (at the query's prefix path)
        // except for the previous matches ('matches'). Get the matches from
        // the indexer
        var indexer = this.rootQueryCalc.indexer;
        var allMatches =
            indexer.getAllMatches(this.rootQueryCalc.prefixProjPathId);
        if(allMatches !== undefined)
            for(var i = 0, l = allMatches.length ; i < l ; ++i) {
                var elementId = allMatches[i];
                if(!matchesAsObj.has(elementId))
                    addedMatches.push(elementId);
            }
    }

    if(this.matchCount <= 1)
        this.matches = undefined; // can destroy the table if not done yet

    this.pushNewMatches(addedMatches, this, this.matchCount);
}

// This function implements the special case of
// removePrefixResultRestrictions() in case the match count after the change
// drops to 0 and this node is a pure projection. In this case, the dominated
// match count of this node drops to zero and the standard function do not
// allow pushing added matches to composed query results (as this is assumed
// to imply an update in the indexer, which the composed queries should
// be notified of directly). For this reason, this function updates the
// dominating nodes directly. Non-query composed result functions are
// still updated by the standard function.
// This function reduced the match count to 0, discards the 'matches'
// table (it is no longer needed) and calls the 'remove restrictions'
// function on the composed query result nodes).
// 'matches' are the existing dominated matches
// of the data object of this node. These reflects the already existing
// matches (which should not be added again). 'matches' are the matches as
// an array of element IDs and 'matchesAsObj' are the same matches but
// as attributes of an object).

InternalQueryResult.prototype.removeRestrictionsFromNoSelection = 
    internalQueryResultRemoveRestrictionsFromNoSelection;

function internalQueryResultRemoveRestrictionsFromNoSelection(matches,
                                                              matchesAsObj)
{
    this.setMatchCount(0);
    this.matches = undefined;
        
    if(this.composedQueryResultNum == 0 &&
       this.composedMatchTransparentNum == 0)
        return; // no composed nodes to update
    
    // since this node is a pure projection, its matches are those received
    // from the removed chain, but may possibly have to be lowered. The
    // lowered matches are appended at the end of the 'matches' array
    // (and later removed).
    var preLoweredLength = matches.length;
    matches = this.rootQueryCalc.lowerProjMatches(matches);

    var clearLoweredFromObj = false;
    
    if(matchesAsObj === undefined) {
        matchesAsObj = new Uint31HashSet(matches.length);
        for(var i = 0, l = matches.length ; i < l ; ++i)
            matchesAsObj.set(matches[i]);
    } else if(matches.length > preLoweredLength) {
        // add the lowered matches
        for(var i = preLoweredLength, l = matches.length ; i < l ; ++i)
            matchesAsObj.set(matches[i]);
        clearLoweredFromObj = true; // need to remove these matches below
    }

    // update the composed query result
    this.FuncResult_removeRestrictionsFromNoSelection(matches, matchesAsObj);

    // restore the pre-lowered list

    if(clearLoweredFromObj)
        for(var i = preLoweredLength, l = matches.length ; i < l ; ++i)
            matchesAsObj.delete(matches[i]);
    
    matches.length = preLoweredLength;
}

////////////////////////////
// Generating Projections //
////////////////////////////

// This function returns the list of terminal generating projections
// of the root query calculation node of this result node. This list
// is simply an array of the terminal generating projection query 
// calculation nodes. If this result node has no root query calculation 
// node or the query is a selection, this function returns an empty
// array.

InternalQueryResult.prototype.getTerminalGeneratingProjs = 
    internalQueryResultGetTerminalGeneratingProjs;

function internalQueryResultGetTerminalGeneratingProjs()
{
    if(!this.rootQueryCalc)
        return [];

    return this.rootQueryCalc.getTerminalGeneratingProjs();
}

// This function is called by the root query calculation node at the
// end of the query refresh cycle. If any of the terminal projections
// have changed (were added, removed or their path mapping changed)
// the argument 'pathMappings' is a Map object which represents those changes.
// Otherwise, this function is called with an 'undefined' argument.
// The keys of the object 'pathMappings' are the IDs of the
// terminal generating projections which changed and the value under
// each attribute is the path mapping for that terminal generating
// projection (see the function
// InternalRootQueryCalc.generatingProjMapping() for the format of
// this path mapping description). This mapping is undefined if the
// node is no longer a terminal generating projection.
// This function then performs several actions to prepare for the
// addition of matches from this modified query (this update will
// arrive later). These are actions which are required in case the
// change in the query structure has influence on properties
// of the query result. These actions are:
// 1. If the change in the query structure causes the query result
//    to become active or stop being active, match counts and partial
//    matches need to be updated.
// 2. If the change in the query structure causes a result indexer
//    to be created or destroyed, this indexer is created/destroyed
//    here and the composed functions are notified of this change.
// 3. If the projection paths of the query changed:
//    a. If there was a result indexer before and after the update,
//       update the projection registered to the result indexer.
//    b. If there was no result indexer both before and after the update,
//       notify the composed query results that the projection paths changed.
//    In case a result indexer was created/destroyed, there is no need to
//    apply these updates, as they are carried out in the process of
//    creating or destroying the result indexer.

InternalQueryResult.prototype.updateTerminalProjs = 
    internalQueryResultUpdateTerminalProjs;

function internalQueryResultUpdateTerminalProjs(pathMappings)
{
    var wasActive = this.isActive();
    
    // refresh the match count (if needed).
    this.refreshMatchCount(this.isActiveStar());
    // refresh the projection properties
    this.resetProjProperties();
    
    var useResultIndexer = this.useResultIndexer();
    var hadResultIndexer = !!this.resultIndexer;

    if(useResultIndexer && !hadResultIndexer)
        this.insertResultIndexer();
    else if(!useResultIndexer && hadResultIndexer)
        this.removeResultIndexer();
    else if(pathMappings === undefined || pathMappings.size == 0)
        return; // no projection path change 
    else if(!this.resultIndexer) {
        // refresh composed results
        for(var resultId in this.composedActive)
            this.composedActive[resultId].refreshIndexerAndPaths(this);
    } else { // if there is a result indexer, update the mapping to it.
        var sourceIndexer = this.getIndexer();
        var _self = this;
        pathMappings.forEach(function(mapping, projId) {
            _self.resultIndexer.addMapping(_self, projId, sourceIndexer,
                                           mapping, 0);
        });
    }
}

// This function refreshes the 'isPureProjection' property based on the
// current state of the query. If this property changed, the new property
// is set and if the result node is active*, the number of selecting
// composed nodes of the data object is updated (a pure projection is not
// considered selecting but any other query is).

InternalQueryResult.prototype.refreshIsPureProjection = 
    internalQueryResultRefreshIsPureProjection;

function internalQueryResultRefreshIsPureProjection()
{    
    var isPureProjection =
        (this.query !== undefined && this.query.isPureProjection());

    if(isPureProjection === this.isPureProjection)
        return; // nothing changed

    this.isPureProjection = isPureProjection;

    if(!this.isActiveStar() || this.dataObj === undefined)
        return; // nothing more to update

    if(isPureProjection) {
        if(!this.assumeNonZeroDomMatchCount && !this.resultIndexer) {
            // from now on, propagate the selecting number (the difference is
            // this number - 1 as 1 was previously contributed by this node)
            this.dataObj.
                updateComposedSelectingNum(this.composedSelectingNum - 1);
        } // otherwise, continues to contribute 1
    } else if(!this.assumeNonZeroDomMatchCount && !this.resultIndexer)
        // from now on, contribute 1 to the selecting number fo the data obj
        this.dataObj.updateComposedSelectingNum(1 - this.composedSelectingNum);
}

// This function is called by an active* composed function when the number
// of selecting composed* active* nodes which it connects to 'this' node
// changes by 'numDiff' (which may be either positive or negative).
// This function then updates its own 'this.composedSelectingNum' property
// and handles the consequences of this update. This depends on whether
// this query result is a pure projection or not. If it is a pure projection,
// the update is passed on to its data object. If it isn't, the update
// is not propagated (this node is a selecting node and contributes
// a constant 1 to the selecting count of the data object).
// We only count composed selecting functions which are active. Therefore,
// this function is only called if there is some active composed function.
// However, this may also happen during the activation of this function
// result. At that time, if the activation of this function is still pending,
// it should not push the change in the number of selecting composed
// function to its data object, since this number will be pulled by the
// data object during the activation process.

InternalQueryResult.prototype.updateComposedSelectingNum =
    internalQueryResultUpdateComposedSelectingNum;

function internalQueryResultUpdateComposedSelectingNum(numDiff, nonFinalUpdate)
{
    this.composedSelectingNum += numDiff;
    
    if(this.isPureProjection && !this.assumeNonZeroDomMatchCount &&
       !this.resultIndexer) {
        // need to propagate to the data object
        if(!this.activeStarPending && this.dataObj !== undefined)
            this.dataObj.updateComposedSelectingNum(numDiff, nonFinalUpdate);
    }

    if(nonFinalUpdate)
        return;
    
    // check whether this change requires the creation/destruction of
    // a result indexer

    var useResultIndexer = this.useResultIndexer();
    var hadResultIndexer = !!this.resultIndexer;

    if(useResultIndexer && !hadResultIndexer)
        this.insertResultIndexer();
    else if(!useResultIndexer && hadResultIndexer)
        this.removeResultIndexer();
}

// this function is called after the composed selecting number may
// have been updated (by the function updateComposedSelectingNum()).
// It is used in cases where updateComposedSelectingNum() was called
// with a second argument which was true (or in case of doubt). This
// function indicates that the composed selecting number may have
// changed and the consequences of this change may not have been
// handled. If this is indeed the case, this as an opportunity for
// this function to handle these consequences.

InternalQueryResult.prototype.completeComposedSelectingNumUpdate =
    internalQueryResultCompleteComposedSelectingNumUpdate;

function internalQueryResultCompleteComposedSelectingNumUpdate()
{
    if(this.isPureProjection && !this.assumeNonZeroDomMatchCount &&
       !this.resultIndexer) {
        // need to propagate to the data object
        if(!this.activeStarPending && this.dataObj !== undefined)
            this.dataObj.completeComposedSelectingNumUpdate();
    }
    
    var useResultIndexer = this.useResultIndexer();
    var hadResultIndexer = !!this.resultIndexer;
    
    if(useResultIndexer && !hadResultIndexer)
        this.insertResultIndexer();
    else if(!useResultIndexer && hadResultIndexer)
        this.removeResultIndexer();
}

///////////////////////
// Access to Matches //
///////////////////////

// This is the standard interface for external modules (not composed result 
// nodes) to get access to the matches of this result node. In case the 
// result node is not active, this returns an empty array. If the result
// node is active, this is equivalent to getDominatedMatches()
// (getDominatedMatches() is also used internally among result nodes
// for an active result node to fetch the matches of the query under 
// an inactive result node it dominates).

InternalQueryResult.prototype.getMatches = 
    internalQueryResultGetMatches;

function internalQueryResultGetMatches()
{
    if(!this.isActive())
        return [];

    return this.getDominatedMatches();
}

// This function returns an array holding the data element IDs of all
// selection matches of this result node. If the result node has
// a match count of zero, this returns the matches of the root query 
// calculation node if it is a selection. If it is a projection 
// (and the match count is zero) this returns all nodes in the indexer under 
// the prefix path of the query. If the match count is 1, the function 
// either returns the matches of its root query calculation node (if it is 
// a selection) or the matches of its data query result (otherwise).
// If the match count is larger than 1, the function loops over the 'matches'
// table, finds those elements whose count is equal to the match count
// and returns that list.

InternalQueryResult.prototype.getSelectionMatches = 
    internalQueryResultGetSelectionMatches;

function internalQueryResultGetSelectionMatches()
{
    if(!this.rootQueryCalc || !this.isActive())
        return []; // not yet known

    if(!this.matchCount) {
        if(!this.rootQueryCalc.isSelection()) {
            // the projection is not restricted, return the full domain of 
            // the root query calculation node
            return this.rootQueryCalc.getDomain();
        } else
            return this.rootQueryCalc.getMatches();
    } else if(this.matchCount == 1) {
        if(!this.rootQueryCalc.isSelection())
            return this.dataObj.getDominatedMatches();
        else
            return this.rootQueryCalc.getMatches();
    } else {
        var matches = [];
        var matchCount = this.matchCount;

        this.matches.forEach(function(count, elementId) {
            if(count == matchCount)
                matches.push(elementId);
        });

        return matches;
    }
}

// This function is identical to 'getSelectionMatches' except that it
// returns the matches as a Map object whose keys are the matches.

InternalQueryResult.prototype.getSelectionMatchesAsObj = 
    internalQueryResultGetSelectionMatchesAsObj;

function internalQueryResultGetSelectionMatchesAsObj()
{
    if(!this.rootQueryCalc || !this.isActive())
        return new Map(); // not yet known

    if(!this.matchCount) {
        if(!this.rootQueryCalc.isSelection()) {
            // the projection is not restricted, return the full domain of 
            // the root query calculation node
            return this.rootQueryCalc.getDomainAsObj();
        } else
            return this.rootQueryCalc.getMatchesAsObj();
    } else if(this.matchCount == 1) {
        if(!this.rootQueryCalc.isSelection())
            return this.dataObj.getDominatedMatchesAsObj();
        else
            return this.rootQueryCalc.getMatchesAsObj();
    } else {
        var matches = new Map();
        var matchCount = this.matchCount;
        this.matches.forEach(function(count, elementId) {
            if(count == matchCount)
                matches.set(elementId, 1);
        });

        return matches;
    }
}

// This function receives an array with element IDs as input. It returns
// an array which is the subset of elements in the input array which 
// are matched on this result node. If the result node does not restrict 
// the query under it, this function simply returns the input array.
// Otherwise, a new array is returned (the input array is never changed).
// If the result node is not active, it must be a selection and its
// root query calculation node is used to filter the matches.

InternalQueryResult.prototype.filterSelectionMatches = 
    internalQueryResultFilterSelectionMatches;

function internalQueryResultFilterSelectionMatches(elementIds)
{
    if(!this.rootQueryCalc || !this.isActive())
        return []; // the empty query which matches nothing

    if(this.matchCount == 0) {
        if(!this.rootQueryCalc.isSelection())
            // does not restrict selection
            return elementIds;
        else 
            // inactive result node, must be a selection, use the root 
            // query calculation node to filter
            return this.rootQueryCalc.filterMatches(elementIds);
    } else if(this.matchCount == 1) {
        // there is no match table of the result node, filter using the
        // dominated matches.
        if(!this.rootQueryCalc.isSelection())
            return this.dataObj.filterDominatedMatches(elementIds);
        else // filter using the matches of the root query calculation node
            return this.rootQueryCalc.filterMatches(elementIds);
    } else {
        // fliter using the matches as recorded on the result node
        var matches = [];
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.matches.get(elementId) == this.matchCount)
                matches.push(elementId);
        }
        return matches;
    }
}

// This function receives an array with element IDs as input. It returns
// an array with the positions in the input array of element IDs which 
// are matched on this result node. If the result node does not restrict 
// the query under it, this function simply returns all positions in the
// input array.
// If the result node is not active, it must be a selection and its
// root query calculation node is used to filter the matches.
// This function is similar to 'filterSelectionMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

InternalQueryResult.prototype.filterSelectionMatchPositions = 
    internalQueryResultFilterSelectionMatchPositions;

function internalQueryResultFilterSelectionMatchPositions(elementIds)
{
    if(!this.rootQueryCalc || !this.isActive())
        return []; // the empty query which matches nothing

    if(this.matchCount == 0) {
        if(!this.rootQueryCalc.isSelection()) {
            // does not restrict selection
            var positions = new Array(elementIds.length);
            for(var i = 0, l = elementIds.length ; i < l ; ++i)
                positions[i] = i;
            return positions;
        } else 
            // inactive result node, must be a selection, use the root 
            // query calculation node to filter
            return this.rootQueryCalc.filterMatchPositions(elementIds);
    } else if(this.matchCount == 1) {
        // there is no match table of the result node, filter using the
        // dominated matches.
        if(!this.rootQueryCalc.isSelection())
            return this.dataObj.filterDominatedMatchPositions(elementIds);
        else // filter using the matches of the root query calculation node
            return this.rootQueryCalc.filterMatchPositions(elementIds);
    } else {
        // fliter using the matches as recorded on the result node
        var positions = [];
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.matches.get(elementId) == this.matchCount)
                positions.push(i);
        }
        return positions;
    }
}

// This function returns an array of holding the data element IDs of the
// matches of this result node as seen by dominating nodes (or the external
// result). In case this is a multi-projection and there is no result indexer,
// the caller must specify the projection ID to indicate the terminal projection
// whose results it wished to receive.
// If this result node has a result indexer, the matches are simply
// all the nodes stored at the root path of the result indexer.
// If the query under the root is a projection and there is no result indexer,
// and projId is undefined, this function returns the projection matches 
// of the generating projection node, if there is only one such node and 
// undefined if there are multiple projections.
// Otherwise, if the query under the root query calculation node of this result 
// node is an active selection, this is equivalent to 'getSelectionMatches()'.
// Finally, if this is an inactive selection result node, the dominated 
// matches are those of the root query calculation node under the result node.
// This function is for internal use among result nodes only and is used,
// among other things, by an active result node to fetch the matches of an
// inactive result node it dominates. Other modules should call getMatches() 
// instead (as getMatches() will not return any matches if the result node
// is not active).

InternalQueryResult.prototype.getDominatedMatches =
    internalQueryResultGetDominatedMatches;

function internalQueryResultGetDominatedMatches(projId)
{
    if(!this.rootQueryCalc)
        return [];

    if(this.resultIndexer) {
        if(this.resultIndexer.paths) {
            var matches = [];
            this.resultIndexer.paths.nodes.forEach(function(entry, elementId){
                matches.push(elementId);
            });
            return matches;
        } else
            return [];
    }

    if(this.rootQueryCalc.isSelection()) {
        if(this.isActive())
            return this.getSelectionMatches();
        else
            return this.rootQueryCalc.getMatches();
    }

    // not a selection

    var generatingProj = this.rootQueryCalc.getSingleGeneratingProj(projId);
    if(!generatingProj)
        return undefined;
	var projMatches = generatingProj.getProjMatches(this.getId());
    if(projMatches === undefined)
        return [];

	return projMatches;
}

// This function is identical to 'getDominatedMatches' except that it 
// returns the matches as an object whose attributes are the matches.

InternalQueryResult.prototype.getDominatedMatchesAsObj =
    internalQueryResultGetDominatedMatchesAsObj;

function internalQueryResultGetDominatedMatchesAsObj(projId)
{
    if(!this.rootQueryCalc)
        return new Map();

    if(this.resultIndexer)
        return (this.resultIndexer.paths ?
                this.resultIndexer.paths.nodes : new Map());

    if(this.rootQueryCalc.isSelection()) {
        if(this.isActive())
            return this.getSelectionMatchesAsObj();
        else
            return this.rootQueryCalc.getMatchesAsObj();
    }

    // not a selection

    var generatingProj = this.rootQueryCalc.getSingleGeneratingProj(projId);
    if(!generatingProj)
        return undefined;

    if(this.rootQueryCalc.hasExplicitProjMatches(this.getId()) ||
       this.projMustGenerateMatches()) {
        // matches already available in object format
	    var projMatches = generatingProj.getProjMatchesAsObj(this.getId());
	    if(!projMatches)
		    return new Map();
        return projMatches;
    }

    // lowering may be required, use the array based function
    projMatches = new Map();
    var matches = this.getDominatedMatches(projId);
    
    for(var i = 0, l = matches.length ; i < l ; ++i)
        projMatches.set(matches[i], 1);

    return projMatches;
}

// This function receives an array with element IDs as input. It returns
// an array which is the subset of elements in the input array which 
// are also dominated matches on this result node. If the result node
// represents a selection, this is equivalent to 'filterSelectionMatches()'.
// If the query has a single projection node, the elements returned
// are those which appear in the projection matches of that projection
// node. Finally, if the query is a multi-projection, it must have a
// result indexer and the matches filtered are those appearing in the
// nodes table of the root path of the result indexer.

InternalQueryResult.prototype.filterDominatedMatches = 
    internalQueryResultFilterDominatedMatches;

function internalQueryResultFilterDominatedMatches(elementIds)
{
    if(!this.rootQueryCalc)
        return [];

    if(this.rootQueryCalc.isSelection())
        return this.filterSelectionMatches(elementIds);

    // not a selection

    var projMatches;
    if(this.resultIndexer) {
        projMatches = this.resultIndexer.paths ? 
            this.resultIndexer.paths.nodes : undefined;
    } else {
        var generatingProj = this.rootQueryCalc.getSingleGeneratingProj();
		projMatches = generatingProj.getProjMatchesAsObj(this.getId());
    }
    if(!projMatches)
        return [];
        
    var matches = [];
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(projMatches.has(elementId))
            matches.push(elementId);
    }
    return matches;
}

// This function receives an array with element IDs as input. It returns
// an array an array with the positions in the input array of element IDs which 
// are also dominated matches on this result node. If the result node
// represents a selection, this is equivalent to
// 'filterSelectionMatchPositions()'. If the query has a single projection
// node, the positions returned are those of the elements which appear in
// the projection matches of that projection node. Finally, if the query
// is a multi-projection, it must have a result indexer and the matches
// filtered are those appearing in the nodes table of the root path of
// the result indexer.
// This function is similar to 'filterDominatedMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

InternalQueryResult.prototype.filterDominatedMatchPositions = 
    internalQueryResultFilterDominatedMatchPositions;

function internalQueryResultFilterDominatedMatchPositions(elementIds)
{
    if(!this.rootQueryCalc)
        return [];

    if(this.rootQueryCalc.isSelection())
        return this.filterSelectionMatchPositions(elementIds);

    // not a selection

    var projMatches;
    if(this.resultIndexer) {
        projMatches = this.resultIndexer.paths ? 
            this.resultIndexer.paths.nodes : undefined;
    } else {
        var generatingProj = this.rootQueryCalc.getSingleGeneratingProj();
		projMatches = generatingProj.getProjMatchesAsObj(this.getId());
    }
    if(!projMatches)
        return [];
        
    var positions = [];
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(projMatches.has(elementId))
            positions.push(i);
    }
    return positions;
}

// This function returns the match count this node contributes
// to the match count of its dominating node.
// If there is a result indexer, this match count is 0 (for the composed
// functions this is like registering to a data result).
// If no selection took place between the dominated indexer and this
// query result node (including this query result node)
// this is also zero.
// In all other cases, for active selection nodes this is simply 'matchCount'
// as defined on the node while for inactive (selection) nodes this is 1 (the
// contribution of the matches of the node's root query calculation
// node).
// If the root query calculation node does not have a selection
// defined under it, this is also 1 (the node should be active in both
// cases).

InternalQueryResult.prototype.getDomMatchCount = 
	internalQueryResultGetDomMatchCount;

function internalQueryResultGetDomMatchCount()
{
    if(this.resultIndexer)
        return 0;
    
    if(!this.matchCount)
        return this.isPureProjection ? 0 : 1;

    return (this.query && this.query.isProjection()) ? 
        1 : this.matchCount;
}

//////////////////////
// Updating Matches //
//////////////////////

// This function receives a list of data element IDs whose match count
// should be increased by the given 'matchCount'. This function may be
// called either by this node's root query calculation node (in which
// case 'matchCount' is always 1) or by a result node dominated by
// this node (in which case the match count is that of the result
// node, if it active, or 1, if it isn't). If matchCount is undefined,
// it is set to 1 (for updates received from result nodes which are 
// not query result nodes and therefore are not aware of the need to
// provide a match count). If this node is active and
// its match count is at least 2, the function increases the counts of
// the given data elements in its own match table by the amount given
// by 'matchCount'. Those elements whose count reached this node's
// match count as a result of this are the new matches for this
// node. Otherwise, all elements in elementIds are new matches. If the
// root query calculation node of this node has a projection under it,
// the new matches are added as new projection matches for the root
// query calculation node. Otherwise (if the query is a selection) the
// new matches are propagated either to the result indexer (if exists) or
// to the result nodes dominating this node(calling addMatches on those 
// nodes with the match count of this node).

InternalQueryResult.prototype.addMatches =
    internalQueryResultAddMatches;

function internalQueryResultAddMatches(elementIds, source, matchCount)
{
    var l;

    if(!elementIds.length || matchCount == 0)
        return;

    if(!this.isActiveStar() || this.pendingSetData || this.pendingRootRefresh) {
        // not active star, but received updates, this means that we are
        // in the process of activation and the matches should be
        // buffered until the process is completed.
        if(this.pendingAddMatches === undefined)
            this.pendingAddMatches = [];
        this.pendingAddMatches.push({
            elementIds: elementIds.slice(0),
            source: source,
            matchCount: matchCount
        });
        return;
    }

    if(!this.isActive() && !this.dominating)
        return; // not active and not dominated, nothing to do

    if(matchCount === undefined)
        matchCount = 1;

    if (this.matchCount <= 1) {
        this.pushNewMatches(elementIds, source, matchCount);
    } else if (this.matchCount === matchCount) {
        // all elements are new
        l = elementIds.length;
        if(!this.matches)
            this.matches = new IntHashMapUint(this.matchCount, l);
        else
            this.matches.expectSize(l);
        
        for(var i = 0 ; i < l; ++i) {
            var elementId = elementIds[i];
            this.matches.set(elementId, matchCount);
        }
        this.pushNewMatches(elementIds, source, this.matchCount);
    } else {

        var thisMatchCount = this.matchCount;
        var newMatches = []; // new full matches on this node 

        // this node is active and we need to update the match counts
        l = elementIds.length;
        if(!this.matches)
            this.matches = new IntHashMapUint(this.matchCount, l);
        else
            this.matches.expectSize(l);
        
        for(var i = 0 ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.matches.inc(elementId, matchCount) == thisMatchCount)
                newMatches.push(elementId);
        }
        
        this.pushNewMatches(newMatches, source, this.matchCount);
    }
}

// Given a list (array) of new selection matches for this result node, this 
// function pushes them to the next node in the query calculation chain.
// In case this is not a selection, this is simply the root query calculation 
// node. In case of a selection, this is the result indexer (if exists)
// or the dominating node (if defined) or the active composed results.
// 'matchCount' indicates the count with which the match count of each of
// these elements should be increased.

InternalQueryResult.prototype.pushNewMatches =
    internalQueryResultPushNewMatches;

function internalQueryResultPushNewMatches(newMatches, source, matchCount)
{
    if(!newMatches.length)
        return; // no new matches

    if(this.rootQueryCalc && !this.rootQueryCalc.isSelection()) {
        this.rootQueryCalc.addProjMatches(newMatches, this.getId());
        return;
    }

    if(this.resultIndexer) {
        this.resultIndexer.addProjMatches(newMatches, this.getId(), 0);
        return;
    }

    if(this.dominating) {
        if(source == this.rootQueryCalc)
            source = this; // for other nodes, the result node is the source
        this.dominating.addMatches(newMatches, source, matchCount);
        return;
    }

    for(var resultId in this.composedActive)
        this.composedActive[resultId].addMatches(newMatches, this, 
                                                 this.matchCount);
}

//
// Removing matches
//

// This function receives a list of data element IDs whose match count
// should be decreased by the given 'matchCount'. This function may be
// called either by this node's root query calculation node
// (in which case 'matchCount' is always 1) or by a result node
// dominated by this node (in which case the match count is that of
// the result node, if it active, or 1, if it isn't).
// If 'matchCount' is undefined, it is replaced by 1 (this is in case 
// the source of the matches is a result node which is not a query 
// result node).
// If this node is active and its match count is at least 2,
// the function decreases the counts of the given data elements in its own
// match table by the amount given by 'matchCount'. Those elements
// whose count drops under the match count of this node as a result of this are
// the matches removed from this node. Otherwise (if the match count of this
// node is less than 2) all elements in elementIds are considered removed
// matches for this node. The removed matches are then propagated. If the
// root query calculation node of this result node does not have a selection
// under it, the removed matches are propagated by removing them as
// projection matches from the root query calculation node. Otherwise
// (if the query is a selection) the removed matches are removed from the
// result indexer (if exists) or the dominating node (if this node 
// is not active or from the active composed result nodes.

InternalQueryResult.prototype.removeMatches =
    internalQueryResultRemoveMatches;

function internalQueryResultRemoveMatches(elementIds, source, matchCount)
{
    if(!elementIds.length || matchCount == 0)
        return;
    
    if(matchCount === undefined)
        matchCount = 1;

    var removedMatches; // full matches removed from this node 
    
    if(this.matchCount > 1) {
        // this node is active and we need to update the match counts

        var thisMatchCount = this.matchCount;
        var l = elementIds.length;
        removedMatches = [];

        // don't decrease buffer sizes while decreasing
        this.matches.suspendMinFill();
        
        for(var i = 0 ; i < l ; ++i) {
            var elementId = elementIds[i];
            var newCount = this.matches.dec(elementId, matchCount);
            if(newCount + matchCount === thisMatchCount)
                removedMatches.push(elementId);
        }

        this.matches.resetMinFill(); // resize the 'matches' buffer, if needed
        
    } else
        removedMatches = elementIds;

    // forward the removed matches
    this.pushRemovedMatches(removedMatches, source,
                            this.matchCount ? this.matchCount : matchCount);
}

// This function is called by the function result node which is the
// data object of this query result when it has removed all its matches.
// 'source' is the result node which called this function. At this point,
// the matches are still available, so this node simply fetches those
// matches and removes them. If the dominated match count of 'source'
// is zero, there is nothing to do here.

InternalQueryResult.prototype.removeAllMatches =
    internalQueryResultRemoveAllMatches;

function internalQueryResultRemoveAllMatches(source)
{
    var domMatchCount = source.getDomMatchCount();

    if(domMatchCount === 0)
        return;

    this.removeMatches(source.getDominatedMatches(), source, domMatchCount);
}

// Given a list (array) of selection matches just removed from this
// node, this function pushes their removal to the next node in the
// query calculation chain.  In case this is not a selection, this is
// simply the root query calculation node. In case of a selection,
// this is the result indexer (if exists) or the dominating node (if
// defined) or the active composed results.

InternalQueryResult.prototype.pushRemovedMatches =
    internalQueryResultPushRemovedMatches;

function internalQueryResultPushRemovedMatches(removedMatches, source,
                                               matchCount)
{
    if(!removedMatches.length)
        return; // nothing to remove

    if(this.rootQueryCalc && !this.rootQueryCalc.isSelection()) {
        this.rootQueryCalc.removeProjMatches(removedMatches, this.getId());
        return;
    }
    
    if(this.resultIndexer) {
        this.resultIndexer.removeProjMatches(removedMatches, this.getId(), 0);
        return;
    }

    if(this.dominating) {
        if(source == this.rootQueryCalc)
            source = this; // for other nodes, the result node is the source
        this.dominating.removeMatches(removedMatches, source, matchCount);
        return;
    }

    for(var resultId in this.composedActive)
        this.composedActive[resultId].removeMatches(removedMatches, this, 
                                                    this.matchCount);
}

/////////////////////////////
// Projection Match Update //
/////////////////////////////

// This function calls the setProjMatches() function of the root query
// calculation node (in case it exists and is not a selection - it is up to
// the calling function to verify that it is not a selection). This function
// is called when the selection which the result node imposes on the
// root query calculation node has changed in a way which requires
// re-initialization. The update here is, therefore, non-incremental.
// All this function needs to do is call the root query calculation's
// setProjMatches() function (this function then pulls the matches from this
// result node).
// In addition, this function also notifies the projection whether it
// currently restricts the projections or not (this can be done after
// setting the projection, as it only applies to future updates).

InternalQueryResult.prototype.setProjMatches = 
    internalQueryResultSetProjMatches;

function internalQueryResultSetProjMatches()
{
    this.rootQueryCalc.setProjMatches(this.getId());
    this.rootQueryCalc.
        refreshProjMustGenerateMatches(this.getId(),
                                       this.projMustGenerateMatches());
}

// This function is called by a terminal projection node (simple or
// selection projection node), belonging to the root query calculation node
// of this result node, when projection matches (for this result) are added
// to the node. This function then propagates these matches to the
// result indexer (if exists) or the active composed result node.

InternalQueryResult.prototype.addTerminalProjMatches = 
	internalQueryResultAddTerminalProjMatches;

function internalQueryResultAddTerminalProjMatches(terminalProj, projMatches)
{
    if(this.pendingIndexerReplace)
        // pending replacement: matches did not change, so no need to propagate
        return;
    
    if(projMatches === undefined || !projMatches.length)
        return;

    if(this.resultIndexer)
        this.resultIndexer.addProjMatches(projMatches, this.getId(), 
                                          terminalProj.getId());
    else if(this.rootQueryCalc.getTerminalGeneratingProjNum() > 1) {
        // this is a multi-projection, but all active composed results
        // support multi-projections (otherwise, a result indexer would have
        // been created).
        for (var resultId in this.composedActive) {
            this.composedActive[resultId].addProjMatches(projMatches, 
                                                         this.getId(), 
                                                         terminalProj.getId());
        }
    } else { // not a multi-projection, use 'addMatches'
        // if this query does not select on the indexer, forward matches only
        // to non-query composed results (as composed queries attach directly
        // to the indexer
        var nonQueryOnly = this.hasNoSelectionOnIndexer();
        for (var resultId in this.composedActive) {
            var result = this.composedActive[resultId];
            if(nonQueryOnly && (result instanceof InternalQueryResult))
                continue;
            result.addMatches(projMatches, this);
        }
    }
}

// This function is called by a terminal projection node (simple or
// selection projection node), belonging to the root query calculation node
// of this result node, when projection matches (for this result) are removed
// from the node. This function then propagates these removals to the
// result indexer (if exists) or the active composed result node.

InternalQueryResult.prototype.removeTerminalProjMatches = 
	internalQueryResultRemoveTerminalProjMatches;

function internalQueryResultRemoveTerminalProjMatches(terminalProj, projMatches)
{
    if(this.pendingIndexerReplace)
        // pending replacement: matches did not change, so no need to propagate
        return;
    
    if(projMatches === undefined || !projMatches.length)
        return;

    if(this.resultIndexer)
        this.resultIndexer.removeProjMatches(projMatches, this.getId(), 
                                             terminalProj.getId());
    else if(this.rootQueryCalc.getTerminalGeneratingProjNum() > 1) {
        // this is a multi-projection, but all active composed results
        // support multi-projections (otherwise, a result indexer would have
        // been created).
        for (var resultId in this.composedActive) {
            this.composedActive[resultId].
                removeProjMatches(projMatches, this.getId(), 
                                  terminalProj.getId());
        }
    } else { // not a multi-projection, use 'removeMatches'
        // if this query does not select on the indexer, forward matches only
        // to non-query composed results (as composed queries attach directly
        // to the indexer
        var nonQueryOnly = this.hasNoSelectionOnIndexer();
        for (var resultId in this.composedActive) {
            var result = this.composedActive[resultId];
            if(nonQueryOnly && (result instanceof InternalQueryResult))
                continue;
            result.removeMatches(projMatches, this);
        }
    }
}

// This function receives as input a terminal projection node of the 
// query under the root query calculation node of this query result.
// This function then removes all the matches due to this terminal projection.
// If the query result has a result indexer, the matches are removed
// from the result indexer. Otherwise, they are removed directly
// from the active composed results. In this case, since there is 
// no result indexer, it is assumed that all active composed results
// support this operation.

InternalQueryResult.prototype.removeAllTerminalProjMatches = 
	internalQueryResultRemoveAllTerminalProjMatches;

function internalQueryResultRemoveAllTerminalProjMatches(terminalProj)
{
    var matches;

    if(this.resultIndexer) {
        matches = terminalProj.getProjMatches(this.getId());
        this.resultIndexer.
            removeProjMatches(matches, this.getId(), terminalProj.getId());
    } else {
        var matches;
        
        // since there is no result indexer, it is assumed that all 
        // active composed results can handle this operation

        // if this query does not select on the indexer, forward
        // the removal only to non-query composed results (as composed
        // queries attach directly to the indexer). For non-query results,
        // it is more efficient to notify them to remove all matches than to
        // explicity create a list of matches to remove.
        
        var nonQueryOnly = (this.hasNoSelectionOnIndexer() ||
                            this.composedQueryResultNum == 0);

        if(nonQueryOnly) {
            for(var resultId in this.composedActive) {
                var result = this.composedActive[resultId];
                if(result instanceof InternalQueryResult)
                    continue;

                result.removeAllMatches(this);
            }
        } else {
            for(var resultId in this.composedActive) {
            
                var result = this.composedActive[resultId];
                if(result instanceof InternalQueryResult)
                    result.removeAllMatches(this);
                else {
                    if(!matches)
                        matches = terminalProj.getProjMatches(this.getId());
                    result.removeMatches(matches, this);
                }
            }
        }
    }
}

////////////////////
// Result Indexer //
////////////////////

// Maximal number of active* function result nodes composed with this node 
// for which composition without a result indexer is supported.
InternalQueryResult.prototype.maxDirectComposedNum = 3;

// This function returns true if a result indexer should be used and
// false if not. If the function is called with 'newDataObj' undefined,
// this will refer to the current situation and otherwise this refers
// to the situation when 'newDataObj' will become the data object of this
// query result (this is to be used in the process of changing the
// data object, when one wants to determine whether a result indexer
// is needed before the data object is set).
// For the specific criteria for the creation of result indexer, see
// the body of the function.

InternalQueryResult.prototype.useResultIndexer = 
    internalQueryResultUseResultIndexer;

function internalQueryResultUseResultIndexer(newDataObj)
{
    if(!this.rootQueryCalc || !this.rootQueryCalc.isCompiled() ||
       !this.calcIsActive())
        // cannot determine whether to use a result indexer before the
        // query is known. Don't create a result indexer on a non-active
        // node (as this only represents a partial result).
        return false;

    // if no selections are made between the indexer and this result query
    // (including) there is no need to create a result indexer (as the
    // matches are exactly those in the source indexer).
    // 'this.assumeNonZeroDomMatchCount' indicates that this is likely to
    // change, so can create the resutl indexer already now.
    if(this.isPureProjection && !this.assumeNonZeroDomMatchCount) {
        if(newDataObj === undefined && this.matchCount == 0)
            return false;
        if(newDataObj !== undefined && newDataObj.getDomMatchCount() == 0)
            return false;
    }
    
    if(this.rootQueryCalc.getTerminalGeneratingProjNum() > 1 &&
       this.composedActiveNum > this.composedSupportMultiProjNum)
        // multi-projection and not all active composed results support this
        return true;

    if(useResultIndexers == false)
        return false; // global flag to disable result indexers (for debugging)

    // finally, the decision is based on the number of selection made
    // on top of the result of this query.
    return (this.composedSelectingNum > this.maxDirectComposedNum);
}

// This is called when the result indexer needs to be created as a result
// of a change in the composed functions, not the query. Since the
// query did not change, this only influences the composed result nodes.
// The result indexer is created, the projections of the query are 
// registered to it, and the matches are added to the result indexer.
// Since this happens before the composed functions are notified of the change
// in indexer (and even before the QueryResultQueryCalc object is
// registered to the merge indexer, if needed) adding the matches to
// the result indexer does not generate any notifications to the composed
// functions.
// After having set up the result indexer, composed query result nodes are
// notified to update their match counts and the counts of their matches
// (and remove partial matches which are not matched on this query result).
// Finally, the composed results are notified of the change in indexer and
// paths, by calling 'replaceIndexerAndPaths()', which indicates to
// the composed result nodes that even though the indexer
// and path changed, the actual set of matching element IDs did not.
 
InternalQueryResult.prototype.insertResultIndexer = 
    internalQueryResultInsertResultIndexer;

function internalQueryResultInsertResultIndexer()
{
    if(this.resultIndexer)
        return; // already created

    if(this.doDebugging)
        this.debugMessage("inserting result indexer at query result ",
                          this.getId());
    
    if(this.qcm.indexerIsScheduled(this.getIndexer())) {
        this.insertResultIndexerWithRefresh();
        return;
    }
    
    // store the match count before the insertion of the result indexer
    var prevMatchCount = this.getDomMatchCount();
    
    // creates the result indexer (but don't yet register the result indexer
    // query calc, so that no notifications will be sent when the data is
    // added to the indexer.
    this.resultIndexer = new MergeIndexer(this.qcm);

    // set the mappings and matches on the result indexer
    if(this.setMappingsOnResultIndexer()) {

        // set matches on the result indexer. This will not update the
        // composed functions, as they did not yet register on this indexer

        if(this.rootQueryCalc.isSelection())
            this.resultIndexer.addProjMatches(this.getSelectionMatches(), 
                                              this.getId(), 0);
        else {
            var projs = this.rootQueryCalc.getTerminalGeneratingProjs();
            for(var i = 0, l = projs.length ; i < l ; ++i) {
                var proj = projs[i];
                var projMatches = proj.getProjMatches(this.getId());
                if(projMatches !== undefined) {
                    this.resultIndexer.
                        addProjMatches(projMatches, this.getId(), proj.getId());
                }
            }
        }
    }

    if(this.composedQueryResultNum < this.composedActiveNum) {
        // register a query calculation node to the result indexer,
        // to receive updates when nodes are added or removed.
        // Since the matches were already added to the result indexer, there
        // will not be any initial notification through this query calc node
        this.resultIndexerQueryCalc = new QueryResultQueryCalc(this);
    }

    var prevPrefixPathId = this.rootQueryCalc ?
        this.getProjectionPathId() : this.qcm.getRootPathId();
    var newPrefixPathId = this.qcm.getRootPathId();
    
    // notify the composed results that the indexer (and path) changed
    // but that the result remains unchanged
    var resultMatches = (this.resultIndexer.paths !== undefined) ?
        this.resultIndexer.paths.nodes : undefined;
    for(var resultId in this.composedActive) {
        // remove partial matches on composed results for elements not matched
        // on this node and decrease the match count for those matched
        var composed = this.composedActive[resultId];
        if(composed instanceof InternalQueryResult)
            composed.removeNonResultIndexerMatches(resultMatches,
                                                   prevMatchCount);
        else
            composed.decreaseMatchCount(prevMatchCount, resultMatches, this);
        
        // replace the indexer and path, but no need to update matches
        composed.replaceIndexerAndPaths(prevPrefixPathId, newPrefixPathId, 1,
                                        this);
    }

    this.refreshProjProperties();

    if(this.isPureProjection && !this.assumeNonZeroDomMatchCount)
        this.dataObj.updateComposedSelectingNum(1 - this.composedSelectingNum,
                                                true);
}

// This is called when the result indexer needs to be created as a result
// of a change in the composed functions, not the query and when the
// result indexer cannot be inserted without a complete refresh of all
// the composed result (if a complete refresh is not needed,
// insertResultIndexer() can do the job). Since the query did not change,
// this only influences the composed result nodes. First, all the existing
// matches are removed from the composed results.
// The result indexer is then created, the projections of the query are 
// registered to it and the composed results are notified of the new
// indexer (and projection path in the indexer). The matches are then
// added to the result indexer (which then pushes them to all active composed
// results).
 
InternalQueryResult.prototype.insertResultIndexerWithRefresh = 
    internalQueryResultInsertResultIndexerWithRefresh;

function internalQueryResultInsertResultIndexerWithRefresh()
{
    if(this.resultIndexer)
        return; // already created

    // clear existing matches from active composed functions
    var removedMatches = this.getDominatedMatches();
    
    for(var resultId in this.composedActive)
        this.composedActive[resultId].removeMatches(removedMatches, this, 
                                                    this.matchCount);

    // creates the result indexer and notify the composed functions of
    // the indexer change
    
    this.createResultIndexer();
    for(var resultId in this.composedActive)
        this.composedActive[resultId].refreshIndexerAndPaths(this);

    // set the mappings on the result indexer
    if(!this.setMappingsOnResultIndexer())
        return; // no query yet defined (will be set later)

    // set matches on the result indexer (this will also update 
    // the composed functions, which registered on the result indexer, 
    // either directly, if they are query result nodes, or through the
    // ResultIndexerData object).

    if(this.rootQueryCalc.isSelection())
        this.resultIndexer.addProjMatches(this.getSelectionMatches(), 
                                          this.getId(), 0);
    else {
        var projs = this.rootQueryCalc.getTerminalGeneratingProjs();
        for(var i = 0, l = projs.length ; i < l ; ++i) {
            var proj = projs[i];
            this.resultIndexer.addProjMatches(proj.getProjMatches(this.getId()),
                                              this.getId(), 
                                              proj.getId());
        }
    }
    
    if(this.isPureProjection && !this.assumeNonZeroDomMatchCount)
        this.dataObj.updateComposedSelectingNum(1 - this.composedSelectingNum,
                                                true);
}

// This function creates the result indexer object and, if needed, also
// registers to it the query result query calculation node.

InternalQueryResult.prototype.createResultIndexer = 
    internalQueryResultCreateResultIndexer;

function internalQueryResultCreateResultIndexer()
{
    if(this.resultIndexer === undefined) {
        this.resultIndexer = new MergeIndexer(this.qcm);
        this.refreshProjProperties();
    }
    
    if(this.composedQueryResultNum < this.composedActiveNum &&
       this.resultIndexerQueryCalc === undefined) {
        // register a query calculation node to the result indexer,
        // to receive updates when nodes are added or removed
        this.resultIndexerQueryCalc = new QueryResultQueryCalc(this);
    }
}

// This function is called when the existing result indexer is no longer
// needed because a change in the composed functions, not because
// of a change to the query. This has, therfore, only influence on the
// composed result nodes. Moreover, the full matches of those composed
// result nodes do not change. This function first removes the result indexer
// from this node (so that functions looking at this result node will not
// see the indexer) but does not destroy it yet (so as not to send a
// match removal update to the composed nodes). Next, the active
// composed function nodes are notified that they should replace their
// dominated indexer and path. They are then also notified to update the
// counts in the match tables and the match counts (this does not affect
// the actual list of full matches, but does increase the counts of the
// full matches and adds some partial matches which were not in the
// removed result indexer). After the composed functions changed their
// their dominated indexer, the result indexer can finally be destroyed
// (the composed queries are no longer registered on the result indexer
// and therefore will not receive updates when the indexer is destroyed).

InternalQueryResult.prototype.removeResultIndexer = 
    internalQueryResultRemoveResultIndexer;

function internalQueryResultRemoveResultIndexer()
{
    if(!this.resultIndexer)
        return; // already removed

    if(this.doDebugging)
        this.debugMessage("removing result indexer at query result ",
                          this.getId());
    
    if(this.qcm.indexerIsScheduled(this.getIndexer()) ||
       this.qcm.indexerIsScheduled(this.resultIndexer)) {
        this.removeResultIndexerWithRefresh();
        return;
    }

    // notify the composed function nodes

    var prevPrefixPathId = this.qcm.getRootPathId();
    var newPrefixPathId = this.rootQueryCalc ?
        this.getProjectionPathId() : this.qcm.getRootPathId();

    // remove the result indexer so that the operation below could take
    // place as if the result indexer is not there anymore, but without
    // actually destroying the result indexer so that it does not send
    // notification to the registered query calculation nodes before these
    // can be removed. The result indexer will be destroyed below
    var resultIndexer = this.resultIndexer;
    this.resultIndexer = undefined;

    // get the match count increase
    var matchCount = this.getAccumulatedMatchCount();

    // increase match count on dominating nodes and update the counts of
    // the existing matches to adjust for this update. This also adds
    // the matches of 'this' and lower result nodes which are now counted
    // on dominating nodes.
    if(matchCount > 0)
        for(var resultId in this.composedActive) {
            var composed = this.composedActive[resultId];
            if(composed instanceof InternalQueryResult)
                composed.addCountsUnderRemovedIndexer(this, matchCount);
            else
                composed.increaseMatchCount(matchCount,
                                            resultIndexer.paths.nodes, this);
        }
    
    // notify the composed results that the indexer (and path) changed
    // but that the result remains unchanged
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        // replace the indexer and path, but no need to update matches
        // (this removes all registrations from the result indexer, so
        // that any subsequent updates to the result indexer will not be
        // received by the composed nodes).
        composed.replaceIndexerAndPaths(prevPrefixPathId, newPrefixPathId,
                                        matchCount ? -1 : 0, this);
    }
    
    // now we can restore the result indexer and destroy it
    this.resultIndexer = resultIndexer;
    this.destroyResultIndexer();
}

// This function is called when the existing result indexer is no longer
// neede because a change in the composed functions, not because
// of a change to the query. This has, therefore, only influence on the
// composed function. In addition, this function is only called when
// either the result indexer or the indexer on which the query of this
// result node is registered has some pending updates (if no such updates
// are pending, removeResultIndexer() can perform this update in a more
// incremental manner, with fewer removals and additions of matches). 
// This function begins by removing the existing matches from the
// result indexer (thus forwarding this removal to the composed 
// nodes). Next, the result indexer is destroyed and the composed results
// are notified of the new indexer and path).

InternalQueryResult.prototype.removeResultIndexerWithRefresh = 
    internalQueryResultRemoveResultIndexerWithRefresh;

function internalQueryResultRemoveResultIndexerWithRefresh()
{
    if(!this.resultIndexer)
        return; // already removed

    // clear the result indexer (this also propagates the removal to 
    // all composed functions).
    this.resultIndexer.clear();

    // destroy the result indexer
    this.destroyResultIndexer();

    // refresh the composed result with the change of indexer
    for(var resultId in this.composedActive)
        this.composedActive[resultId].refreshIndexerAndPaths(this);

    // push the matches of this node
    var matches = this.getDominatedMatches();
    for(var resultId in this.composedActive)
        this.composedActive[resultId].addMatches(matches, this, 
                                                 this.matchCount);
}

// This function should be called when the result indexer is no longer needed
// (or when the uery result node is about to be destroyed). It destroys
// the result indexer and the result indexer query calculation node
// (if it exists). This function does not send any match updates. If such
// match updates need to be send, they should be sent before this function
// is called.

InternalQueryResult.prototype.destroyResultIndexer = 
    internalQueryResultDestroyResultIndexer;

function internalQueryResultDestroyResultIndexer()
{
    if(this.resultIndexer === undefined)
        return;
    
    if(this.resultIndexerQueryCalc !== undefined) {
        this.resultIndexerQueryCalc.destroy();
        this.resultIndexerQueryCalc = undefined;
    }

    // remove the registration of the query to the result indexer
    if(this.rootQueryCalc !== undefined) {
        var projMappings = this.rootQueryCalc.getGeneratingProjMappings();
        if(projMappings !== undefined) {
            var _self = this;
            projMappings.forEach(function(mapping, projId) {
                _self.resultIndexer.removeMapping(_self, projId);
            });
        }
    }
    
    this.resultIndexer.destroy();
    this.resultIndexer = undefined;

    if(!this.destroyed) {
        this.refreshProjProperties();
    
        if(this.dataObj && this.isPureProjection &&
           !this.assumeNonZeroDomMatchCount) {
            this.dataObj.
                updateComposedSelectingNum(this.composedSelectingNum - 1, true);
        }
    }
}

/////////////////////
// Debug Functions //
/////////////////////

// This function creates a DebugInternalTo object representing the result
// of this query. This is based on the result returned by 
// 'getDominatedMatches()' and will, therefore, return, for an inactive
// selection query, just the selections of that query (without intersection
// with the result of lower queries). 

InternalQueryResult.prototype.debugGetQueryResult = 
    internalQueryResultDebugGetQueryResult;

function internalQueryResultDebugGetQueryResult()
{
    var matches = this.getDominatedMatches();
    var indexer = this.getDominatedIndexer();
    var projPathId = this.getDominatedProjPathId();

    if(!indexer || !matches || matches.length == 0)
        return new DebugInternalTo(this.qcm); // empty object

    return indexer.debugGetDataUnder(matches, projPathId);
}

// This function creates a DebugInternalTo object representing the input
// of this query. If this query is composed with another query, this is
// based on the result of that query. Otherwise, this uses the root query
// calculation node to get the indexer and projection path inside that indexer
// and get the result from there.

InternalQueryResult.prototype.debugGetQueryInput = 
    internalQueryResultDebugGetQueryInput;

function internalQueryResultDebugGetQueryInput()
{
    if(this.dataObj)
        return this.dataObj.debugGetQueryResult();

    if(!this.rootQueryCalc)
        return new DebugInternalTo(this.qcm); // empty object

    // otherwise, get the indexer and path from the root query calculation node
    var indexer = this.rootQueryCalc.indexer;
    var projPathId = this.rootQueryCalc.prefixProjPathId;

    if(!indexer)
        return new DebugInternalTo(this.qcm); // empty object

    return indexer.debugGetDataUnder(undefined, projPathId);
}

// Print a string representing the query as defined in the indexer storing
// the query description.

InternalQueryResult.prototype.debugPrintQuery =
    internalQueryResultDebugPrintQuery;

function internalQueryResultDebugPrintQuery()
{
    if(this.query === undefined || this.query.indexer === undefined)
        return "<undefined>";
    
    return this.query.debugGetQueryDesc();
}

// Returns a string with the description of this query result

InternalQueryResult.prototype.debugPrintDesc =
    internalQueryResultDebugPrintDesc;

function internalQueryResultDebugPrintDesc()
{
    return "" + this.getId() + "<" + this.constructor.name + ">: " +
        this.debugPrintQuery();
}
