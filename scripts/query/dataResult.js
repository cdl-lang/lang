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


// This object, which is a derived class of the FuncResult base class,
// provides the indexer and path which are the starting point for a chain 
// of function applications. This object simply implements the 
// FuncResult interface required by result nodes which are the data 
// of other result nodes and allows access to the indexer through this
// interface.
//
// If this object does not have any active composed objects which 
// are not query result objects, it can be completely passive: it simply
// defines the indexer, path and identification ID but does not
// need to register on the indexer path node, since the queries
// will do so. The 'domianted match count' of this node is then 0.
//
// When there are active composed result nodes which are not query
// result nodes, this function needs to register itself as a projection
// query on the indexer path node and notify the composed result nodes
// (those which are not queries) of nodes added and removed.
//
// The indexer, path ID and identification ID of the DataResult object 
// a fixed and cannot be changed after construction.
// 
// The path ID is allocated by this object (an released when the object is
// destroyed) to ensure that it remains valid.
//
// Object Structure
// ----------------
//
// {
//      indexer: <the indexer>,
//      pathId: <the path ID>,
//      identificationId: <identification ID>
//
//      isReplaceable: true|false
//
//      registeredToIndexer: true|false
// }
//
// isReplaceable: indicates whether this object should be replaced as
//     the data result of one of its composed result nodes a result of
//     a call to 'setTerminalData()' on that composed result node.
//
// registeredToIndexer: this is true if this object is currently 
//     registered as a query calculation node to the indexer and
//     false if it isn't. This node is registered to the 
//     indexer as a query calculation node in case at least one of 
//     its active composed results is not a query result (and therefore
//     does not itself register to the indexer).

// %%include%%: "funcResult.js"

inherit(DataResult, FuncResult); 

// Constructor

// This object is constructed with a fixed indexer, path ID and 
// identification ID. These never change. identificationId is allowed
// to be undefined.
// 'isReplaceable' should be set to true if this
// object should be replaced as the data result of one of its composed 
// result nodes a result of a call to 'setTerminalData()' on that
// composed result node.

function DataResult(internalQCM, indexer, pathId, identificationId, 
                    isReplaceable)
{
    this.FuncResult(internalQCM);
    
    this.indexer = indexer;
    
    this.pathId = pathId;
    // allocate this path ID to make sure it is not released while this
    // object is still in use.
    this.qcm.allocatePathIdByPathId(pathId);

    this.identificationId = identificationId;
    this.isReplaceable = !!isReplaceable;

    this.registeredToIndexer = false;
}

DataResult.prototype.destroy = dataResultDestroy;

function dataResultDestroy()
{
    this.qcm.releasePathId(this.pathId);

    if(this.registeredToIndexer)
        this.indexer.removeQueryCalcFromPathNode(this);
}

// The data result is never active of its own right. It is only active*
// as a result of composed active* result nodes.

DataResult.prototype.isActive = dataResultIsActive;

function dataResultIsActive()
{
    return false;
}

// The data result is a terminal result node (it does not take a result
// node as its source of data).

DataResult.prototype.isTerminalResult = dataResultIsTerminalResult;

function dataResultIsTerminalResult()
{
    return true;
}

// Whether the data result is repalceable or not is a proeprty determined
// upon construction (there should not be too many replacements anyway).

DataResult.prototype.isReplaceableTerminalResult = 
    dataResultIsReplaceableTerminalResult;

function dataResultIsReplaceableTerminalResult()
{
    return this.isReplaceable;
}

// This function is called when an active composed function result is
// about to be added to this node. The active composed function counters
// were already updated as this point. If this is the first active composed 
// result which is not a query result, this function registers itself to
// the indexer path it represents as a projection query
// (which means the path node is being traced and this result node receives
// updates when nodes are added and removed at the path node).

DataResult.prototype.aboutToAddActiveComposed = 
    dataResultAboutToAddActiveComposed;

function dataResultAboutToAddActiveComposed()
{
    if(this.composedQueryResultNum < this.composedActiveNum && 
       !this.registeredToIndexer) {
        //register to indexer
        this.registeredToIndexer = true;
        this.indexer.addQueryCalcToPathNode(this);
    }
}

// If this node became active*, need to push its matches to any active
// composed nodes which are not query result nodes (and therefore do not
// pull the matches directly from the indexer).

DataResult.prototype.becameActiveStar = 
    dataResultBecameActiveStar;

function dataResultBecameActiveStar()
{
    if(this.composedQueryResultNum == this.composedActiveNum)
        return; // all active composed nodes are query result nodes

    var matches = this.getDominatedMatches();

    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(composed instanceof InternalQueryResult)
            continue;
        composed.addMatches(matches, this);
    }
}

// This function is called when an active composed function result is
// removed from this node. If this is the last active composed result 
// which is not a query result, this function unregisters itself from
// the indexer path it represents.

DataResult.prototype.activeComposedFuncRemoved = 
    dataResultActiveComposedFuncRemoved;

function dataResultActiveComposedFuncRemoved()
{
    if(this.composedQueryResultNum == this.composedActiveNum && 
       this.registeredToIndexer) {
        //unregister from indexer
        this.registeredToIndexer = false;
        this.indexer.removeQueryCalcFromPathNode(this);
    }
}

// Returns the indexer of this node

DataResult.prototype.getDominatedIndexer = dataResultGetDominatedIndexer;

function dataResultGetDominatedIndexer()
{
    return this.indexer;
}

// returns the path ID of this node

DataResult.prototype.getDominatedProjPathId = dataResultGetDominatedProjPathId;

function dataResultGetDominatedProjPathId()
{
    return this.pathId;
}

// always return 1

DataResult.prototype.getDominatedProjPathNum = 
    dataResultGetDominatedProjPathNum;

function dataResultGetDominatedProjPathNum()
{
    return 1;
}

// the mapping here (with projection ID 0) maps the projection path of
// this node to the root path ID.

DataResult.prototype.getDominatedProjMappings = 
    dataResultGetDominatedProjMappings;

function dataResultGetDominatedProjMappings()
{
    var mapping = new Map();
    mapping.set(0, [this.qcm.getRootPathId(), this.pathId]);

    return mapping;
}

// The terminal projection matches are simply the inexer matches
// at the given path (projId should always be 0).

DataResult.prototype.getTerminalProjMatches =
    dataResultGetTerminalProjMatches;

function dataResultGetTerminalProjMatches(projId)
{
    return this.indexer.getAllMatches(this.pathId);
}

// The terminal projection matches are simply the indexer matches
// at the given path (projId should always be 0) so we filter against
// the indexer.

DataResult.prototype.filterTerminalProjMatches =
    dataResultFilterTerminalProjMatches;

function dataResultFilterTerminalProjMatches(projId, elementIds)
{
    return this.indexer.filterDataNodesAtPath(this.pathId, elementIds);
}

// zero match count (always)

DataResult.prototype.getDomMatchCount = dataResultGetDomMatchCount;

function dataResultGetDomMatchCount()
{
    return 0;
}

// This function returns an array with all data element IDs found in the nodes
// table of the path node

DataResult.prototype.getDominatedMatches = dataResultGetDominatedMatches;

function dataResultGetDominatedMatches()
{
    return this.indexer.getAllMatches(this.pathId);
}

// This function simply returns the Map object of nodes of the path node. 

DataResult.prototype.getDominatedMatchesAsObj = 
    dataResultGetDominatedMatchesAsObj;

function dataResultGetDominatedMatchesAsObj()
{
    return this.indexer.getDataNodesAtPath(this.pathId);
}

// This fuction receives as input a list (array) of data element IDs
// and returns an array with a subset of the input array of element IDs
// which are matches of this data result, which means they are
// IDs of nodes at the indexer and path defined by this data result.

DataResult.prototype.filterDominatedMatches =
    dataResultFilterDominatedMatches;

function dataResultFilterDominatedMatches(elementIds)
{
    var filtered = [];
    var nodes = this.indexer.getDataNodesAtPath(this.pathId);
    if(nodes === undefined)
        return filtered;
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(nodes.has(elementId))
            filtered.push(elementId);
    }
    return filtered;
}

// This fuction receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are matches of this data result, which means they are in
// IDs of nodes at the indexer and path defined by this data result.

DataResult.prototype.filterDominatedMatchPositions =
    dataResultFilterDominatedMatchPositions;

function dataResultFilterDominatedMatchPositions(elementIds)
{
    var positions = [];
    var nodes = this.indexer.getDataNodesAtPath(this.pathId);
    if(nodes === undefined)
        return positions;
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        if(nodes.has(elementIds[i]))
            positions.push(i);
    }
    return positions;
}

// returns the identification defined for this node

DataResult.prototype.getDominatedIdentification = 
    dataResultGetDominatedIdentification;

function dataResultGetDominatedIdentification()
{
    return this.identificationId;
}

//////////////
// Ordering //
//////////////

// Get the ordering of the nodes as defined by the indexer. It may be that
// this is just the default ordering (by element ID) and then the returned
// CompInfo is undefined. In other cases (when the indexer is a merge
// indexer) this ordering may be inherited from the mapping(s) which
// mapped the nodes to the indexer. This comparison information is returned
// here, if available.

DataResult.prototype.getDominatedComparison = 
    dataResultGetDominatedComparison;

function dataResultGetDominatedComparison()
{
    if(this.indexer && this.indexer.getDominatedComparisonAtPath !== undefined)
        return this.indexer.getDominatedComparisonAtPath(this.pathId);

    return undefined;
}

// This function is called to add 'composedFunc' as a composed function
// of this result function node which is order*. When this function is
// called, 'composedFunc' is already registered as an active* composed
// function of this node.
// In addition to the standard update (in the FuncResult base class),
// this function also continues the propagation of this call through
// a merge indexer to the function results which are the input to the
// merge indexer.

DataResult.prototype.addOrderStarFunc = dataResultAddOrderStarFunc;

function dataResultAddOrderStarFunc(composedFunc)
{
    var wasOrderStar = this.isOrderStar();
    
    this.FuncResult_addOrderStarFunc(composedFunc);

    if(wasOrderStar)
        return;

    if(this.indexer === undefined ||
       this.indexer.addOrderStarFuncAtPath === undefined)
        return;

    this.indexer.addOrderStarFuncAtPath(this, this.pathId);
}

// This function is called to remove 'composedFunc' as a composed function
// of this result function node which is order*. This function may be called
// either because 'composedFunc' was just removed as an active* composed
// function or because it stopped being an order* function (though it
// continues to be an active* composed function). When this function is
// also remvoed as composed active*, it is first removed as composed active*
// (including notifying the doinated function result nodes) and only then is
// this function called.
// In addition to the standard update (in the FuncResult base class),
// this function also continues the propagation of this call through
// a merge indexer to the function results which are the input to the
// merge indexer.

DataResult.prototype.removeOrderStarFunc = dataResultRemoveOrderStarFunc;

function dataResultRemoveOrderStarFunc(composedFuncId)
{
    var wasOrderStar = this.isOrderStar();

    this.FuncResult_removeOrderStarFunc(composedFuncId);

    if(!wasOrderStar || this.isOrderStar())
        return; // did not stop being order*

    // stopped being order*, need to remove this as order* from the
    // dominated nodes

    if(this.indexer === undefined ||
       this.indexer.removeOrderStarFuncAtPath === undefined)
        return;

    this.indexer.removeOrderStarFuncAtPath(this.id, this.pathId);
}

/////////////////////////////////////////
// Interface as Query Calculation Node //
/////////////////////////////////////////

// when registered as a query calculation node to the indexer, this 
// indicates that this query calculation node should be treated as
// a projection (it should be updated whenever nodes are added or removed
// from the path node).

DataResult.prototype.isSelection = dataResultIsSelection;

function dataResultIsSelection()
{
    return false;
}

// When this data result is registered to the indexer as a query calculation
// node, this function receives a list (array) of data element IDs
// which were added at the indexer path node to which this node is 
// registered. These matches are forwarded to all active composed 
// result nodes which are not query result nodes.

DataResult.prototype.addMatches = dataResultAddMatches;

function dataResultAddMatches(elementIds, source)
{
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(composed instanceof InternalQueryResult)
            continue;
        composed.addMatches(elementIds, this);
    }
}

// When this data result is registered to the indexer as a query calculation
// node, this function receives a list (array) of data element IDs
// which were removed at the indexer path node to which this node is 
// registered. These removals are forwarded to all active composed 
// result nodes which are not query result nodes.

DataResult.prototype.removeMatches = dataResultRemoveMatches;

function dataResultRemoveMatches(elementIds, source)
{
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(composed instanceof InternalQueryResult)
            continue;
        composed.removeMatches(elementIds, this);
    }
}

// This function is called by the indexer to which this data result node
// is registered when the path node in the indexer to which it is registered
// is cleared. Since the DataResult node does not store any data,
// it only has to forward this call to its active composed functions.
// This is forwarded as a call to 'removeAllMatches()' on these functions.
// Just as in the 'addMatches()' and 'removeMatches()' functions, there
// is no need to forward this to query result nodes, as these are registered
// to the indexer and are notified directly).

DataResult.prototype.removeAllIndexerMatches =
    dataResultRemoveAllIndexerMatches;

function dataResultRemoveAllIndexerMatches()
{
    for(var resultId in this.composedActive) {
        var composed = this.composedActive[resultId];
        if(composed instanceof InternalQueryResult)
            continue;
        composed.removeAllMatches(this);
    }
}
