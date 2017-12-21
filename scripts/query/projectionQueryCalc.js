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

// This object extends the base class InternalQueryCalc for terminal  
// projection query calculation nodes. This projection node is defined
// by an indexer and a path in that indexer, which are assigned to the node 
// at the time of construction and never changes afterward. This means
// that the definition of the node is static, though it may need to 
// refresh as a result of changes in other nodes in the query structure.
// For example, whether the projection node needs to add its selection
// matches to the parent node depends on the query calculation nodes
// dominating this node.
//
// Basically, all this node needs to do is forward to the result node 
// the element IDs representing the intersection between the data nodes 
// stored by the indexer at the projection path and the projection matches
// of the match parent node. If the parent node requires it, this node
// may also need to add its selection matches to the parent.  
// 
// When the projection node needs to add matches to the parent node, 
// it first requests the indexer to provide it with all matches (through 
// its 'addMatches()'. Afterwards, nodes added and removed from the path
// are reported by the indexer (whether the node needs to add its matches 
// to the parent or not) and added or removed from the matches of the parent.
//
// When projection matches are added or removed by the parent, the projection 
// node lets the indexer filter them for those matches which are defined at
// the projection path and forwards this filtered list to the result node.
// Similarly, when the indexer notifies the projection node that nodes
// were added or removed from the projection path, the projection node 
// lets the parent node filter them against its projection matches and
// sends the filtered list to the result node.
//
// This describes the full calculation of the projection matches. Often,
// however, there is no need to calculate these matches explicitly.
// In many cases, the result nodes which receive these matches as input
// are themselves registered to the indexer. Therefore, they will not select
// any matches which do not exist at the projected path node. Therefore,
// there is no need for this node to filter the projection matches
// received from the match parent against the nodes in the indexer.
// When such filtering does not take place, there is also no need to
// store the projection matches on this node (since they can be retrieved
// from the parent node at any time). Finally, in such cases there is
// no need to register to the indexer to receive updates when nodes are
// added and removed fro the path.
//
// We will refer to cases where the projection matches need to be filtered
// against the indexer and stored here as 'explicit match tracking'.
// Explicit match tracking is determined for each result registered to
// this root query calculation node separately. Once it is detemrined that
// the matches must be explicitly tracked for a given result node,
// an entry is created for that result in the 'projMatches' table.
// The existence of such an entry is seen as an indication that explicit
// match tracking is required.
//
// One special case is when the projection path is equal to the prefix
// path of the root query calculation node. In this case, there never any need
// to explicitly track the matches (they are always equal to the projection
// matches of the match parent, or, if there is no such parent, to the
// nodes at the root path of the indexer). 
//
// An additional property which determines the operation of the projection
// query calculation node is whether it receives projection match updates
// from its match parent (that is, whether its addProjMatches() and
// removeProjMatches() are called with updates) and whether it needs to
// add its 'selection matches' to its match parent. If the node does not
// receive projection matches from its parent or if it must add its
// selection matches to the parent, the projection query calculation node
// must register to the indexer and forward the match updates received from
// the indexer.
//
// These two properties are determined both based on the structure of the
// query and on properties of the result nodes registered to the query:
// 1. The match parent must be updated with the selection matches if
//    this node is dominated by an intersection node which is a
//    multi-projection (that is, intersects more than one projection sub-query).
// 2. The match parent does not send projection match updates if both
//    the following hold:
//    a. there is no dominating intersection node
//    b. the result node does not restrict the projection. This property may
//       therefore be different for each result node.
// When either 1 or 2 holds (for at least one result node) the projection
// query calculation node must register to the indexer. It then processes
// the matches added and removed from the indexer. When 1 holds, these
// matches are forwarded to the parent. When 2 holds, the matches are
// also forwarded to the result nodes (for those result nodes for which
// this property holds).
//
// These properties are determined during the structural refresh of the
// query or are set by the result node (when its match count changes).
// These properties are independent of the 'explicit tracking' property.

// Object Structure
// ----------------
//
// This object does not make use of the 'matches' field which is used in 
// all other query calculation objects. If it needs to add its matches
// to the parent, it requests the indexer to provided it with the matches,
// when needed.
//
// {
//    pathId: <path ID>,
//
//    matchPoints: <Map>{
//        <path ID>: 1
//        ......
//    }
//
//    projMatches: <Map>{
//       <result ID>: <Map object>: {
//          <data element ID>: 1
//          ....
//       }
//       ....
//    }
//
//    mustGenerateMatches: undefined|<Map>{
//        <result ID>: true,
//        .....
//    }
//
//    initialRefreshCompleted: false|true
//    registeredToIndexerForMatches: false|true
// }
//
// pathId: this is the projection path ID, relative to the root of the indexer.
//   This is set during construction and not modified afterwards.
// 
// matchPoints: all match points added by the indexer to this node. These
//   are all prefixes of this.pathId (including this.pathId itself)
//   which carry data elements (that is, there is a data element at that path).
//
// projMatches: this is the set of data element IDs which represent the 
//   intersection of the data nodes at the path being projected and the 
//   projection matches of the parent node. No counting is required here,
//   so the count is always 1. There is one table per result node containing
//   this projection query calculation node.
//
// mustGenerateMatches: this table stores the IDs of the result nodes
//   for which projection matches need to be generated by this projection
//   query calculation node. This means that no projection matches are
//   received here for this result node fro the match parent and that the
//   result node is interested in the projection matches.
//   This table is undefined if structurally projection matches are
//   generated (that is, there is a dominating intersection node which
//   provides this node with projection matches from the match parent).
//   Otherwise, this table is created. Result IDs are then added to this table
//   when the table is created (for all result nodes registered) and when
//   the result node explicitly indicates that it requires projection matches
//   to be generated. Result IDs are removed from this
//   table when an update is received from the indexer and it turns out that
//   the result node no longer requires the generation of the projection
//   matches or when the result node explciitly indicates that it does
//   require the generation of the matches.
//   For these result nodes the projection query calculation node must
//   register to the indexer and forward the matches received from the indexer
//   to the result node. See introduction for more details.
//
// initialRefreshCompleted: this flag is set once the initial refresh of the
//   query has been completed. This happens once, since this node cannot
//   change (except that additional function results can make use of it). 
// registeredToIndexerForMatches: true if this query calculation node
//   registered to the indexer to receive match updates (needed only if
//   the matches received from the match parent need to be filtered against
//   the actual matches on the indexer). Note that some sort of registration
//   to the indexer is always needed to receive match point updates.
//   However, if no updates for matches are required, the projection
//   query calculation node is registered as requiring no updates and
//   the only updates it will receive is for the match points.

// %%include%%: "internalQueryCalc.js"

inherit(ProjectionQueryCalc, InternalQueryCalc);

//
// Constructor
//

// The constructor receives as input, in addition to the root query
// calculation node which owns it, also the ID of the path in the indexer
// which it projects. This path is given relative to the root of the indexer.

function ProjectionQueryCalc(rootQueryCalc, pathId)
{
    // call base constructor
	this.InternalQueryCalc(rootQueryCalc);

    // initialize derived class fields (selection-projection related fields are
    // constructed only when needed).

    this.projMatches = undefined;

    this.pathId = pathId;
    // increase the path ID allocation count so that this node now
    // owns this path ID (this way it can be properly released)
    this.indexer.qcm.allocatePathIdByPathId(pathId);

    this.mustGenerateMatches = undefined;
    
    this.initialRefreshCompleted = false;
    this.registeredToIndexerForMatches = false;
    this.doNotIndex = true; // projection never requires indexing
}

// destruction function
// In addition to the base class destruction, this function must also 
// detach the query calculation node from the indexer and release
// its allocation of the path ID.

ProjectionQueryCalc.prototype.destroy = projectionQueryCalcDestroy;

function projectionQueryCalcDestroy()
{
    // remove as generating projection
    this.rootQueryCalc.removeGeneratingProj(this);

    // detach from indexer (base class function)
    this.detachFromIndexer();

	// base class destroy (this also detaches from the root query calculation
    // node if this is the top query calculation node)
	this.InternalQueryCalc_destroy();
}

///////////////////////////////
// Property Access Functions //
///////////////////////////////

// This function is called by the indexer to determine what sort of match
// updates need to be delivered to this query calculation node.
// If registeredToIndexerForMatches is true, all projection matches
// (all matches at the path) need to be updated.
// If registeredToIndexerForMatches is false, only matches which were
// specifically selected by this query (that is, none) should be updated.

ProjectionQueryCalc.prototype.isSelection = projectionQueryCalcIsSelection;

function projectionQueryCalcIsSelection()
{
	return this.registeredToIndexerForMatches ? false : true;
}

// Returns always true, as this is always a projection node.

ProjectionQueryCalc.prototype.isProjection = projectionQueryCalcIsProjection;

function projectionQueryCalcIsProjection()
{
	return true;
}

// A terminal projection node is always a generating projection node,
// so this function always returns true.

ProjectionQueryCalc.prototype.isGeneratingProjection = 
	projectionQueryCalcIsGeneratingProjection;

function projectionQueryCalcIsGeneratingProjection()
{
    return true;
}

// This node is a trivial projection if the suffix path it adds to the
// prefix path of the root node is empty (the root path).

ProjectionQueryCalc.prototype.isTrivialProj = projectionQueryCalcIsTrivialProj;

function projectionQueryCalcIsTrivialProj()
{
    return this.pathId == this.rootQueryCalc.prefixProjPathId;
}

// This is a pure projection query if this is the only query calculation
// node under the root query calculation node. This is determined by
// the root query calculation node.

ProjectionQueryCalc.prototype.isPureProj = projectionQueryCalcIsPureProj;

function projectionQueryCalcIsPureProj()
{
    return this.rootQueryCalc.isPureProjection();
}

// This function returns true if the projection matches of this projection
// node for the given result ID are explicitly tracked here (which means
// that the proejction matches of the parent are filtered against the
// nodes found in the indexer at the projection path). Whether such tracking
// takes place or not is determined by there being an entry in the projMatches
// table for storing these matches.

ProjectionQueryCalc.prototype.hasExplicitProjMatches =
    projectionQueryCalcHasExplicitProjMatches;

function projectionQueryCalcHasExplicitProjMatches(resultId)
{
    return (this.projMatches !== undefined && this.projMatches.has(resultId));
}

///////////
// Modes //
///////////

// This function returns true if a registration to the indexer for
// receiving match updates is required
// under the current setup. As explained in the introduction, such
// a registration is required if one of the following holds:
// 1. projection matches need to be tracked explicitly (this is determined
//    by the 'projMatches' table being not empty)
// 2. The matches of this projection need to be added as selection matches
//    to the parent node. This is determined by the 'mustAddMatches'
//    property.
// 3. There are some result nodes for which no projection matches are
//    received from the match parent but the result node still needs to
//    receive the projection matches (this is determined by the
//    this.mustGenerateMatches table, which should be non-empty).

ProjectionQueryCalc.prototype.needsToRegisterToIndexerForMatches =
    projectionQueryCalcNeedsToRegisterToIndexerForMatches;

function projectionQueryCalcNeedsToRegisterToIndexerForMatches()
{
    return ((this.projMatches !== undefined && this.projMatches.size > 0) ||
            this.mustAddMatches ||
            (this.mustGenerateMatches !== undefined &&
             this.mustGenerateMatches.size > 0));
}

// Re-register this query calculation node to the indexer. Whether match
// updates will be received from the indexer depends on the value of
// registeredToIndexerForMatches, which is recalculated here.
// If this did not change, the function does nothing (the first
// registration takes place directly in 'refreshMatchPoints()'.

ProjectionQueryCalc.prototype.registerToIndexer =
    projectionQueryCalcRegisterToIndexer;

function projectionQueryCalcRegisterToIndexer()
{
    var registeredToIndexerForMatches =
        this.needsToRegisterToIndexerForMatches();
    
    if(this.registeredToIndexerForMatches === registeredToIndexerForMatches)
        return; // no change

    this.registeredToIndexerForMatches = registeredToIndexerForMatches;
    this.indexer.addQueryCalcToPathNode(this);
}

// This function refreshes the mustGenerateMatches table based on the
// current state of the projection query calculation node and the result
// nodes which make use of this projection node. As a result, the node
// may register to the indexer or detach from the indexer.

ProjectionQueryCalc.prototype.refreshMustGenerateMatches =
    projectionQueryCalcRefreshMustGenerateMatches;

function projectionQueryCalcRefreshMustGenerateMatches()
{
    if(this.matchParent != this.rootQueryCalc &&
       this.matchParent.addsProjMatchesToSubNodes()) {
        // projection matches are generated strcturally (because of the
        // structure of the query and not because of the result node) so destroy
        // the mustGenerateMatches table
        if(this.mustGenerateMatches === undefined)
            return; // situation did not change
        
        this.mustGenerateMatches = undefined;
        this.registerToIndexer(); // re-registers if needed
        return;
    }

    // no projection matches generated structurally

    if(this.mustGenerateMatches !== undefined)
        return; // situation did not change
    
    // create the table

    this.mustGenerateMatches = new Map();

    var results = this.rootQueryCalc.getQueryResults();

    var _self = this;
    results.forEach(function(queryResult, resultId) {

        if(!queryResult.projMustGenerateMatches())
            return; // restricts projection, so adds projection matches

        _self.mustGenerateMatches.set(resultId, true);
    });

    if(this.mustGenerateMatches.size > 0)
        this.registerToIndexer(); // registers only if not registered already
}

// This function should be called when the 'projection must generate matches'
// property of a result node using this query changes. This is then used to
// update the entry for this result in the 'mustGenerateMatches'
// (if the table exists, which is determine by the structure of the query)
// a result node should be added to it iff it requires the projection
// to generate the matches.
// 'mustGenerate' should be true if the query result node requires
// the projection to generate matches and false if not.
// A projection is required to generate its projection matches if the
// result node does not restrict the projection (that is, does not
// have a list of selection matches which is then added at the root
// of the query as projection matches to restrict the projection) and
// if the result node actually needs to get the projection matches
// (sometimes there is no need for this as the projection merely changes
// the projection path for subsequent queries).

ProjectionQueryCalc.prototype.refreshProjMustGenerateMatches =
    projectionQueryCalcRefreshProjMustGenerateMatches;

function projectionQueryCalcRefreshProjMustGenerateMatches(resultId,
                                                           mustGenerate)
{
    if(this.mustGenerateMatches === undefined)
        return; // structurally, projection matches are added for all results 

    if(!mustGenerate) {
        if(this.mustGenerateMatches.has(resultId)) {
            this.mustGenerateMatches.delete(resultId);
            this.registerToIndexer(); // re-registers if needed
        }
    } else if(!this.mustGenerateMatches.has(resultId)) {
        this.mustGenerateMatches.set(resultId, true);
        this.registerToIndexer(); // only if needed
    }
}

// This function is called when the given result is removed from this
// query. In addition to carrying out the base class cleanup,
// this function removes the result ID from the 'mustGenerateMatches'
// table.

ProjectionQueryCalc.prototype.removeResultProjMatches =
    projectionQueryCalcRemoveResultProjMatches;

function projectionQueryCalcRemoveResultProjMatches(resultId)
{
    if(this.mustGenerateMatches !== undefined &&
       this.mustGenerateMatches.has(resultId))
        this.mustGenerateMatches.delete(resultId);

    this.InternalQueryCalc_removeResultProjMatches(resultId);

    this.registerToIndexer(); // re-registers if needed
}

//////////////////
// Match Points //
//////////////////

// This function receives the initial list (array) of match points for 
// the projection path after registering to the indexer. The function then 
// updates its 'matchPoints' table with these match points and forwards
// these match points to its match parent.
// This function is called just once, when this node is registered to
// the indexer.

ProjectionQueryCalc.prototype.setMatchPoints = 
	projectionQueryCalcSetMatchPoints;

function projectionQueryCalcSetMatchPoints(matchPoints)
{
    this.matchPoints = new Map();
    
	for(var i = 0, l = matchPoints.length ; i < l ; ++i) {
		var pathId = matchPoints[i];
		this.matchPoints.set(pathId, 1);
		this.matchParent.addToMatchPoints(pathId, this);
	}
}

// This function is called by the indexer when a new match point is 
// added (that is, when the first data element is created at the given
// path, which is a prefix of the path of this query calculation node).
// This function adds the match point to the match point table and 
// forwards it to the parent. 

ProjectionQueryCalc.prototype.addToMatchPoints = 
	projectionQueryCalcAddToMatchPoints;

function projectionQueryCalcAddToMatchPoints(pathId)
{
    this.matchPoints.set(pathId, 1);
	this.matchParent.addToMatchPoints(pathId, this);
}

// This function is called by the indexer when a match point is 
// removed (that is, when the last data element is removed at the given
// path, which is a prefix of the path of this query calculation node).
// This function removes the match point from the match point table and 
// forwards the removal to the parent. 

ProjectionQueryCalc.prototype.removeFromMatchPoints = 
	projectionQueryCalcRemoveFromMatchPoints;

function projectionQueryCalcRemoveFromMatchPoints(pathId)
{
    this.matchPoints.delete(pathId);
	this.matchParent.removeFromMatchPoints(pathId, this);
}

///////////////////
// Query Refresh //
///////////////////

// This function is called in the structural phase of the query refresh.
// Since structurally, the projection query calculation node never changes, 
// there is little to do here. The only thing to be done is add this 
// as a simple generating projection the first time this projection node
// is refreshed (this is determined by checking the 'initialRefreshCompleted'
// flag).

ProjectionQueryCalc.prototype.refreshQueryStructure = 
    projectionQueryCalcRefreshQueryStructure;

function projectionQueryCalcRefreshQueryStructure()
{
    if(this.initialRefreshCompleted)
        return; // not initial update, nothing to do

    // add this as a generating projection
    this.rootQueryCalc.addSimpleGeneratingProj(this);
    return;
}

// This function is called in the match point phase of the query refresh.
// This only registers to the indexer to receive match point updates.

ProjectionQueryCalc.prototype.refreshMatchPoints = 
    projectionQueryCalcRefreshMatchPoints;

function projectionQueryCalcRefreshMatchPoints()
{
    // first register only to get match point updates
    this.indexer.addQueryCalcToPathNode(this);
    return;
}

// This function is called at the end of the refresh process, when
// the structure and the match points of the query were already set
// and after the matches of all dominating nodes have been set.
// There is no need to update selection matches here because if the
// node needs to add matches to the parent, the parent would have pulled
// the 'old' matches (before the 'refreshMatches()' of this node is called)
// but because these are pulled directly from the indexer, they are already
// up to date.
// If projection matching was suspended on this node, the projection matches
// need to be updated. This is done by calling 'unsuspend()' (this a
// function in the base class which eventually calls 'setProjMatches()'
// which is implemented below). Otherwise, there is no need to refresh here, 
// as updates from the indexer (addMatches/removeMatches) and from 
// the parent node (addProjMatches/removeProjMatches) are enough to
// drive the projection match update.
// This function is a good place to check whether properties which depend
// on the structure of the query need to be updated. This function therefore
// checks whether the 'mustGenerateMatches' table needs to be
// created or destroyed.

ProjectionQueryCalc.prototype.refreshMatches = 
    projectionQueryCalcRefreshMatches;

function projectionQueryCalcRefreshMatches()
{
    // check whether the 'mustGenerateMatches' table has been influenced
    // by the structural change.
    this.refreshMustGenerateMatches();
    if(!this.initialRefreshCompleted)
        // this is a new node, so check whether matche need to be tracked
        // explicitly (for all those result nodes already registered)
        this.checkRequiredExplicitProjMatches();
    
    this.unsuspend(); // will do something only if projection is suspended

    this.initialRefreshCompleted = true;
}

////////////////
// Suspension //
////////////////

// The projection matches of this node may be suspended when structural
// change has taken place. All this function needs to do is make sure that
// the current projection matches are stored in the 'projMatches'
// table. If this object is not required to store these matches, this
// function needs to fetch these matches now and store them, so
// that when the node is later unsuspended, it could calculate the difference
// between the old and the new projection matches. This does not take place
// if the initial 'setProjMatches()' was not called (as the initial matches
// were not set yet).

ProjectionQueryCalc.prototype.suspendProjMatches = 
	projectionQueryCalcSuspendProjMatches;

function projectionQueryCalcSuspendProjMatches()
{
    if(this.isTrivialProj())
        return; // no need to do anything, this cannot change structurally

    if(!this.initialRefreshCompleted)
        return; // no matches added yet
    
    // go over the result nodes registered to the root query calculation
    // node and check whether they all have an explicit list of projection
    // matches stored. If not, fetch that list from the parent.

    var results = this.rootQueryCalc.getQueryResults();

    var _self = this;
    results.forEach(function(queryResult, resultId) {
        if(_self.projMatches !== undefined && _self.projMatches.has(resultId))
            return;

        _self.registerToIndexer(); // will happen only once
        
        var projMatches = _self.getProjMatches(resultId);
        var thisProjMatches = _self.getProjMatchesEntry(resultId);

        for(var i = 0, l = projMatches.length ; i < l ; ++i)
            thisProjMatches.set(projMatches[i], 1);
    });
}

///////////////////////
// Node Mode Setting //
///////////////////////

// Since the projection node uses the same addMatches, removeMatches, 
// addProjMatches and removeProjMatches in all cases, the mode
// setting functions do nothing.

ProjectionQueryCalc.prototype.setSelectionMode = 
    projectionQueryCalcSetSelectionMode;

function projectionQueryCalcSetSelectionMode()
{
    return;
}

ProjectionQueryCalc.prototype.setProjectionMode = 
    projectionQueryCalcSetProjectionMode;

function projectionQueryCalcSetProjectionMode()
{
    return;
}

ProjectionQueryCalc.prototype.setSuspendedProjectionMode = 
	projectionQueryCalcSetSuspendedProjectionMode;

function projectionQueryCalcSetSuspendedProjectionMode()
{
    return;
}

//////////////////////
// Updating Matches //
//////////////////////

// This function is called by the indexer with a list (array) of data
// element IDs representing data nodes which were just added at the
// path of this query. This function then lets the parent node filter
// them against its own projection matches (separately for each result
// node). Those elements which are also projection matches of the
// parent node are added to the projection matches of this node (and
// forwarded to the result nodes). In case this node has to add its 
// selection matches to the parent, this function also adds all 'matches'
// to the parent. In this case, the 'addProjMatches()' function is 
// disabled, as this function updates the projection matches directly. 
//
// Note: this function is not used by the indexer to add the set of 
// data nodes stored in the indexer at the projection path when this 
// query calculation node is registered to the indexer. This initial 
// update takes place by either pulling the data nodes from the indexer
// or by just using the indexer to filter the projection matches 
// received from the match parent node.

ProjectionQueryCalc.prototype.addMatches = projectionQueryCalcAddMatches;

function projectionQueryCalcAddMatches(matches, source)
{
    if(matches.length == 0)
        return;

    if(this.mustAddMatches) {
        // disable the projection update and forward the matches to the
        // parent node
        this.projectionSuspended = true;
        this.matchParent.addMatches(matches, this);
        this.projectionSuspended = undefined; // reactivate projection update
    }

    // update the projection matches

    var results = this.rootQueryCalc.getQueryResults();

    if(this.projMatches !== undefined && this.projMatches.size > 0) {
        var _self = this;
        this.projMatches.forEach(function(thisProjMatches, resultId) {
            var projMatches =
                _self.matchParent.filterProjMatches(matches, resultId);

            var addedProjMatches = [];
            
            for(var i = 0, l = projMatches.length ; i < l ; ++i) {
                var elementId = projMatches[i];
                thisProjMatches.set(elementId, 1);
                addedProjMatches.push(elementId);
            }
            
            if(addedProjMatches.length)
                results.get(resultId).addTerminalProjMatches(_self,
                                                             addedProjMatches);
        });
    }

    // forward to result nodes which do not add projection matches
    this.addMatchesToMustGenerateMatches(matches);
}

// This function is called by 'addMatches()' to forward the update
// received from the indexer to the result nodes for which matches
// must be generated by this node (see introduction). Before adding
// matches to the result nodes stored in the table 'mustGenerateMatches'
// this function first verifies that the result node indeed still requires
// the projection matches to be generated. If the result node no longer
// requires this, it is removed from the list.
// Matches are not added to result nodes which are in 'this.projMatches'
// because this was already done by the 'addMatches()'

ProjectionQueryCalc.prototype.addMatchesToMustGenerateMatches =
    projectionQueryCalcAddMatchesToMustGenerateMatches;

function projectionQueryCalcAddMatchesToMustGenerateMatches(matches)
{
    if(this.mustGenerateMatches === undefined ||
       this.mustGenerateMatches.size == 0)
        return; // nothing more to do

    // for thoe result nodes which do not add projection matches and
    // were not handled above, forward the match update as is.

    var results = this.rootQueryCalc.getQueryResults();
    
    var _self = this;
    this.mustGenerateMatches.forEach(function(t,resultId) {
        var result = results.get(resultId);
        if(!result.projMustGenerateMatches()) {
            // it no longer holds that no projection matches are added
            _self.mustGenerateMatches.delete(resultId);
            _self.registerToIndexer(); // re-registers if needed
            return;
        }
        if(_self.projMatches !== undefined && _self.projMatches.has(resultId))
            return; // already added in the loop above

        result.addTerminalProjMatches(_self, matches);
    });
}

// This function is called by the indexer with a list (array) of data
// element IDs representing data nodes which were just removed at the
// path of this query. This function then checks which of these 
// element IDs appears in its projection matches (this.projMatches) 
// and removes them from the projection matches (this is for each
// result node separately). The removed projection matches are then
// removed from the result node.
// In case this node has to add its selection matches to the parent,
// this function also removes all 'matches' from the parent. In this
// case, the 'removeProjMatches()' function is disabled, as this
// function updates the projection matches directly.

ProjectionQueryCalc.prototype.removeMatches = projectionQueryCalcRemoveMatches;

function projectionQueryCalcRemoveMatches(matches)
{
    if(this.mustAddMatches) {
        // disable the projection update and forward the match removal to the
        // parent node
        this.projectionSuspended = true;
        this.matchParent.removeMatches(matches, this);
        this.projectionSuspended = undefined; // reactivate projection update
    }

    // update the projection matches

    var results = this.rootQueryCalc.getQueryResults();

    if(this.projMatches !== undefined && this.projMatches.size > 0) {

        var _self = this;
        
        this.projMatches.forEach(function(thisProjMatches, resultId) {
            
            var removedProjMatches = [];

            for(var i = 0, l = matches.length ; i < l ; ++i) {
                
                var elementId = matches[i];
                
                if(!thisProjMatches.has(elementId))
                    continue; // not a projection match
            
                thisProjMatches.delete(elementId);
                removedProjMatches.push(elementId);
            }

            if(removedProjMatches.length) {
                results.get(resultId).
                    removeTerminalProjMatches(_self, removedProjMatches);
            }
        });
    }

    this.removeMatchesFromMustGenerateMatches(matches);
}

// This function is called by 'removeMatches()' to forward the update
// received from the indexer to the result nodes for which projection
// matches must be generated by this node (see introduction). Before removing
// matches from the result nodes stored in the table 'mustGenerateMatches'
// this function first verifies that the result node indeed still requires
// the projection to generate matches. If the result node no longer requires
// the projection matches to be generated by the projection, the result
// node is removed from the list.
// Matches are not removed from result nodes which are in 'this.projMatches'
// because this was already done by the 'removeMatches()'

ProjectionQueryCalc.prototype.removeMatchesFromMustGenerateMatches =
    projectionQueryCalcRemoveMatchesFromMustGenerateMatches;

function projectionQueryCalcRemoveMatchesFromMustGenerateMatches(matches)
{
    if(this.mustGenerateMatches === undefined ||
       this.mustGenerateMatches.size == 0)
        return; // nothing more to do

    // for thoe result nodes which do not add projection matches and
    // were not handled above, forward the match update as is.

    var results = this.rootQueryCalc.getQueryResults();
    
    var _self = this;
    this.mustGenerateMatches.forEach(function(t,resultId) {
        var result = results.get(resultId);
        if(!result.projMustGenerateMatches()) {
            // it no longer holds that no projection matches are added
            _self.mustGenerateMatches.delete(resultId);
            _self.registerToIndexer(); // re-registers if needed
            return;
        }
        if(_self.projMatches !== undefined && _self.projMatches.has(resultId))
            return; // already added in the loop above

        result.removeTerminalProjMatches(_self, matches);
    });
}

// This function is called by the indexer when all data nodes at the 
// projection path are about to be removed. This function then reads
// the matches from the indexer (these should still be stored on the
// indexer at this point) and removes them (using the standard removeMatches()).

ProjectionQueryCalc.prototype.removeAllIndexerMatches = 
    projectionQueryCalcRemoveAllIndexerMatches;

function projectionQueryCalcRemoveAllIndexerMatches()
{
    this.removeMatches(this.indexer.getAllMatches(this.pathId));
}

/////////////////////////////////
// Updating Projection Matches //
/////////////////////////////////

// This function receives a list of new projection matches just added
// to its parent for the result node with ID 'resultId'. If there is no
// explicit tracking of the projection matches of this projection for
// the given result ID, this function simply forwards the input projection
// matches to the result node. If the matches are explicitly tracked
// (there is an entry for this result ID in the 'projMatches' table)
// then this function first lets the indexer filter these projection matches
// for matches which are stored in the indexer at the projection path. These
// matches are then added to the projection matches of this node and
// forwarded to the result node.
// If projection calculation is suspended, this function does nothing.

ProjectionQueryCalc.prototype.addProjMatches =
    projectionQueryCalcAddProjMatches;

function projectionQueryCalcAddProjMatches(projMatches, resultId)
{
    if(this.isSuspendedProjection() || projMatches.length == 0)
        return;

    if(this.hasExplicitProjMatches(resultId)) {

        // filter the projection matches and store them
        
        var thisProjMatches = this.getProjMatchesEntry(resultId);

        projMatches = this.indexer.filterDataNodesAtPath(this.pathId, 
                                                         projMatches);

        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
            
            var elementId = projMatches[i];
            
            thisProjMatches.set(elementId, 1);
        }
    } else if(this.mustGenerateMatches !== undefined &&
              this.mustGenerateMatches.has(resultId))
        // since projection matches were added here, we must make sure that
        // they all exist at this path (some may be parent nodes which
        // were lowered to other nodes at this path).
        projMatches = this.indexer.filterDataNodesAtPath(this.pathId, 
                                                         projMatches);     

    var result = this.rootQueryCalc.getQueryResults().get(resultId);
    result.addTerminalProjMatches(this, projMatches);
}

// This function receives a list of projection matches just removed
// from its parent for the result node with ID 'resultId'. If there is no
// explicit tracking of the projection matches of this projection for
// the given result ID, this function simply forwards the input projection
// matches to the result node. If the matches are explicitly tracked
// (there is an entry for this result ID in the 'projMatches' table)
// this function removes those of these matches which are found in
// this.projMatches (for the given result node) from this.projMatches and
// from the result node.
// If projection calculation is suspended, this function does nothing.

ProjectionQueryCalc.prototype.removeProjMatches =
    projectionQueryCalcRemoveProjMatches;

function projectionQueryCalcRemoveProjMatches(projMatches, resultId)
{
    if(this.isSuspendedProjection() || projMatches.length == 0)
        return;

    var removedProjMatches;
    
    if(this.hasExplicitProjMatches(resultId)) {
    
        var thisProjMatches = this.getProjMatchesEntry(resultId);

        removedProjMatches = [];

        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
            
            var elementId = projMatches[i];

            if(!thisProjMatches.has(elementId))
                continue; // was not a projection match of this node
        
            thisProjMatches.delete(elementId);
            removedProjMatches.push(elementId);
        }

        if(removedProjMatches.length == 0)
            return;

    } else
        removedProjMatches = projMatches;


    var result = this.rootQueryCalc.getQueryResults().get(resultId);
    result.removeTerminalProjMatches(this, removedProjMatches);
}

// This function sets the projection matches on this node. If 'resultId'
// is given, this is performed only fo this result ID and, otherwise,
// for all result nodes.
// This function is called in the following cases:
// 1. when this node has been suspended and is now unsuspended (in which
//    case all the projection matches for all results are explicitly stored
//    on the 'projMatches' object when the node is suspended).
// 2. if this node is the root of the query (the query is a pure projection)
//    or if this node is dominated by a union node which is itself the
//    root of the query. In this case, this function is either only called
//    for the initial update of the projection (which means that there were
//    no previous projection matches) or in cases where the projection
//    matches are explicitly tracked (e.g. in the case of a union, which
//    is a multi-projection).
// This function first fully calculates the projection matches by
// fetching the projection matches of its parent node. If this is
// 'undefined' (possible only if the parent node is the root query
// calculation node or a union node which is the root of the query)
// then the parent does not restrict the projection and the projection
// matches of this node are simply all nodes in the indexer at the
// projection path. If the projections for the result node are explicitly
// tracked, these matches are filtered by the indexer for
// element IDs which represent a data node at the projection path in
// the indexer. Otherwise, no filtering takes place.
// Having calculated the new set of projection matches, this function 
// compares this with the previous list of projection matches (stored 
// in this.projMatches when entering the function) and notifies the result
// node with the projection matches actually added and removed.
// In case there is no list of previous projection matches, the list of
// previous projection matches is considered empty.
// If the projections were previously stored on this.projMatches, this
// list is updated to hold the new projection matches.

ProjectionQueryCalc.prototype.setProjMatches =
    projectionQueryCalcSetProjMatches;

function projectionQueryCalcSetProjMatches(resultId)
{
    var results = this.rootQueryCalc.getQueryResults();
    var resultIds;
    if(resultId === undefined) {
        resultIds = [];
        results.forEach(function(queryResult, resultId) {
            resultIds.push(resultId);
        });
    } else
        resultIds = [resultId];

    var dataNodes;
    
    for(var r = 0 ; r < resultIds.length ; ++r) {
        resultId = resultIds[r];

        // existing matches (there is a difference between undefined
        // and an empty Map object, which indicates the matches are
        // explicitly tracked).
        var prevProjMatches = this.projMatches ? 
            this.projMatches.get(resultId) : undefined;

        var result = results.get(resultId);
        if(prevProjMatches === undefined &&
           result.requiresExplicitProjMatches(this.rootQueryCalc)) {
            // need to explicitly keep track of projection matches
            prevProjMatches = new Map(); // dummy, will be created below
        }

        var thisProjMatches;
        
        if(prevProjMatches !== undefined) {        
            // re-initialize to be empty
            thisProjMatches = this.initEmptyProjMatches(resultId);
            this.registerToIndexer(); // will happen only once
        }
        
        var projMatches = this.matchParent.getProjMatches(resultId);

        if(projMatches !== undefined && prevProjMatches !== undefined) {
            // filter projection matches on indexer
            projMatches = 
                this.indexer.filterDataNodesAtPath(this.pathId, projMatches);
        }
        
        if(projMatches == undefined) {
            // projection matches not restricted by the parent node,
            // all data nodes in the indexer at the projection path
            // are projection matches (this is retrieved only once for
            // all result nodes).
            if(!dataNodes)
                dataNodes = this.indexer.getAllMatches(this.pathId);
            projMatches = dataNodes;
        }

        // 'projMatches' now holds the new list of projection matches

        var addedProjMatches;
        var removedProjMatches;
        
        if(prevProjMatches !== undefined) {
        
            // update the this.projMatches and calculate difference with
            // previous projection matches
        
            // if not done above, re-initialize to be empty
            if(thisProjMatches === undefined)
                thisProjMatches = this.initEmptyProjMatches(resultId);
            
            if(prevProjMatches.size == 0) {
                // no previous matches, just store the projection matches
                for(var i = 0, l = projMatches.length ; i < l ; ++i)
                    thisProjMatches.set(projMatches[i],1);
                addedProjMatches = projMatches;
            } else { 
                // previous projection matches exist, check which of the
                // projection matches were added and which already exists
                addedProjMatches = [];
                for(var i = 0, l = projMatches.length ; i < l ; ++i) {
                    var elementId = projMatches[i];
                    thisProjMatches.set(elementId,1);
                    if(!prevProjMatches.has(elementId))
                        addedProjMatches.push(elementId);
                    else
                        prevProjMatches.delete(elementId);
                }

                removedProjMatches = [];
                prevProjMatches.forEach(function(count, elementId) {
                    removedProjMatches.push(elementId);
                });
            }
        } else
            addedProjMatches = projMatches;
        
        // update the result node
        
        if(addedProjMatches.length)
            result.addTerminalProjMatches(this, addedProjMatches);
        if(removedProjMatches !== undefined && removedProjMatches.length)
            result.removeTerminalProjMatches(this, removedProjMatches);
    }
}

// This function is called when this projection node is created
// (at the end of its initial refresh). If there are any result nodes
// already registered to the root query calculation node of this
// projection node, this node goes over those result nodes and
// check for which of them explicit tracking of the projection matches
// is required. For those where this is required, an initial (empty)
// set of matches is initialized.

ProjectionQueryCalc.prototype.checkRequiredExplicitProjMatches =
    projectionQueryCalcCheckRequiredExplicitProjMatches;

function projectionQueryCalcCheckRequiredExplicitProjMatches()
{
    var results = this.rootQueryCalc.getQueryResults();

    if(results.size === 0)
        return;

    var _self = this;
    
    results.forEach(function(result, resultId) {
        if(result.requiresExplicitProjMatches(_self.rootQueryCalc))
            // initialize an empty list of projections
            _self.initEmptyProjMatches(resultId);
    });
}

// This function is called when the result node has determined that
// projection matches must be tracked explicitly and the result node
// knows which initial projection matches need to be set on the node
// (up to filtering against the indexer). These matches should be given
// in the array 'elementIds' (which must already have the matches lowered
// to the projection path, but may contain element IDs which do not appear
// on the projection path - these will be filtered out below). If 'elementIds'
// is undefined, the projection matches are initialized to an empty list.
// This happens, for example, upon adding a result node to the root query
// calculation node dominating this projection node when
// it has been determined that this result node requires projection matches
// to be tracked explicitly. Since the result node was just added, no projection
// matches could have been added so far, so the list is initialized empty.

ProjectionQueryCalc.prototype.initExplicitProjMatches =
    projectionQueryCalcInitExplicitProjMatches;

function projectionQueryCalcInitExplicitProjMatches(resultId, elementIds)
{
    var thisProjMatches = this.initEmptyProjMatches(resultId);

    this.registerToIndexer(); // will happen only once
    
    if(elementIds !== undefined) {
        elementIds =
            this.indexer.filterDataNodesAtPath(this.pathId, elementIds);
        thisProjMatches.expectSize(elementIds.length);
        for(var i = 0, l = elementIds.length ; i < l ; ++i)
            thisProjMatches.set(elementIds[i], 1);
    }
}

// This function is called to indicate that from now on, the projection
// matches for the given result must be tracked explicitly. It is
// assumed that this function is called after the query has already
// been constructed and the initial matches added, so this function
// first gets the full set of projection matches from the parent
// (and if this does not restrict the projections, directly from the
// indexer). If the projection matches were not received from the indexer,
// this then find which of the matches are not available on the projection
// path. These are removed from the list and the result is notified of
// this removal. The projection matches are stored in the 'projMatches'
// table.

ProjectionQueryCalc.prototype.setExplicitProjMatches =
    projectionQueryCalcSetExplicitProjMatches;

function projectionQueryCalcSetExplicitProjMatches(resultId)
{
    if(this.isTrivialProj())
        return; // never need to track on trivial projection
    
    if(this.hasExplicitProjMatches(resultId))
        return; // already has explicit tracking

    // set the projection matches
    var thisProjMatches = this.initEmptyProjMatches(resultId);

    this.registerToIndexer(); // will happen only once

    if(!this.initialRefreshCompleted)
        return; // explicit matches will be added later
    
    // get the projection matches from the match parent

    var projMatches = this.matchParent.getProjMatches(resultId);
    var removedMatches;
    
    if(projMatches !== undefined) {
        // filter projection matches on indexer
        var filteredMatches = 
            this.indexer.filterDataNodesAtPathWithDiff(this.pathId,
                                                       projMatches);
        projMatches = filteredMatches.matches;
        removedMatches = filteredMatches.removed;
        
    } else {
        // projection matches not restricted by the parent node,
        // all data nodes in the indexer at the projection path
        // are projection matches.
        projMatches = this.indexer.getAllMatches(this.pathId);
    }

    // since registration to path node only takes place below, it may be
    // that the path node does not yet exist and that 'projMatches' is
    // undefined (the matches will be added later)
    if(projMatches !== undefined)
        for(var i = 0, l = projMatches.length ; i < l ; ++i)
            thisProjMatches.set(projMatches[i], 1);

    if(removedMatches === undefined || removedMatches.length == 0)
        return;

    // 'mustGenerateMatches' represents the state before this change.
    // If the matches were pushed from the indexer, there is no need to correct
    // here for bogus matches.
    if(this.mustGenerateMatches !== undefined &&
       this.mustGenerateMatches.has(resultId))
        return;

    // notify of the removed matches
    var result = this.rootQueryCalc.getQueryResults().get(resultId);
    result.removeTerminalProjMatches(this, removedMatches);
}

// This function is called to indicate that from now on, the projection
// matches for the given result do not need be tracked explicitly. If no
// explicit tracking on matches takes place for this result, the function
// does not do anything. Otherwise, it gets the full set of projection
// matches from its parent (if the parent restricts the projections).
// It checks which of these matches are not in the 'projMatches'
// table for this projection. These matches have to be added (as from now
// on they will be considered matches of this projection).
// The entry in the 'projMatches' table for this result is then removed.

ProjectionQueryCalc.prototype.releaseExplicitProjMatches =
    projectionQueryCalcReleaseExplicitProjMatches;

function projectionQueryCalcReleaseExplicitProjMatches(resultId)
{
    if(this.isTrivialProj())
        return; // never need to track on trivial projection
    
    if(!this.hasExplicitProjMatches(resultId))
        return; // has no explicit tracking

    // get the projection matches from the match parent

    var projMatches = this.matchParent.getProjMatches(resultId);
    var addedMatches;
    
    if(projMatches !== undefined) {
        // find which parent projection matches were filtered out
        var prevProjMatches = this.getProjMatchesEntry(resultId);
        var addedMatches = [];
        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
            var elementId = projMatches[i];
            if(!prevProjMatches.has(elementId))
                addedMatches.push(elementId);
        }
    }
    
    // remove the projection matches
    this.projMatches.delete(resultId);

    this.registerToIndexer(); // re-register if needed
    
    if(addedMatches === undefined || addedMatches.length == 0)
        return;

    // 'mustGenerateMatches' represents the state after this update.
    // If the matches will be pushed from the indexer, there is no need
    // to add here the bogus matches.
    if(this.mustGenerateMatches !== undefined &&
       this.mustGenerateMatches.has(resultId))
        return;

    
    // notify of the removed matches
    var result = this.rootQueryCalc.getQueryResults().get(resultId);
    result.addTerminalProjMatches(this, addedMatches);
}

///////////////////////
// Access to Matches //
///////////////////////

// This function returns an array of element IDs representing the selection 
// matches of this projection node. This function simply fetches this list
// from the indexer.

ProjectionQueryCalc.prototype.getMatches = projectionQueryCalcGetMatches;

function projectionQueryCalcGetMatches()
{
    return this.indexer.getAllMatches(this.pathId);
}

// This function returns a Map object whose keys are the element IDs 
// representing the selection matches of this projection node. This function 
// simply fetches this list from the indexer.

ProjectionQueryCalc.prototype.getMatchesAsObj = 
    projectionQueryCalcGetMatchesAsObj;

function projectionQueryCalcGetMatchesAsObj()
{
    return this.indexer.getAllMatchesAsObj(this.pathId);
}

// This function returns an array of element IDs representing the subset
// of selection matches of this projection node whose path is a prefix
// (or equal) the prefix path of the query. This simply retrieves the
// full list of matches from the indexer and then (if needed) filters it
// by path ID of the data elements.

ProjectionQueryCalc.prototype.getFullyRaisedMatches = 
    projectionQueryCalcGetFullyRaisedMatches;

function projectionQueryCalcGetFullyRaisedMatches()
{
    var matches = this.indexer.getAllMatches(this.pathId);

    if(!this.lowerThanQueryPrefixFullMatches())
        return matches;
    
    var highMatches = [];
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    for(var i = 0, l = matches.length ; i < l ; ++i) {
        var elementId = matches[i];

        if(dataElements.getPathId(elementId) <= prefixPathId)
            highMatches.push(elementId);
    }

    return highMatches;
}

// This function is identical to getFullyRaisedMatches() except that 
// it returns an object whose attributes are the element IDs.

ProjectionQueryCalc.prototype.getFullyRaisedMatchesAsObj = 
    projectionQueryCalcGetFullyRaisedMatchesAsObj;

function projectionQueryCalcGetFullyRaisedMatchesAsObj()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatchesAsObj();
    
    var matches = this.indexer.getAllMatches(this.pathId);
    var highMatches = new Map();
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    for(var i = 0, l = matches.length ; i < l ; ++i) {
        var elementId = matches[i];

        if(dataElements.getPathId(elementId) <= prefixPathId)
            highMatches.set(elementId, true);
    }

    return highMatches;
}

// This fuction receives as input a list (array) of data element IDs
// and returns (in a new array) the subset of element IDs which are
// selection matches on this query calculation node. For this projection
// node, the selection matches are all nodes in the indexer at the
// projection path.

ProjectionQueryCalc.prototype.filterMatches = projectionQueryCalcFilterMatches;

function projectionQueryCalcFilterMatches(elementIds)
{
    return this.indexer.filterDataNodesAtPath(this.pathId, elementIds);
}

// This fuction receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of
// element IDs which are selection matches on this query calculation
// node. For this projection node, the selection matches are all nodes
// in the indexer at the projection path.
// This function is similar to 'filterMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

ProjectionQueryCalc.prototype.filterMatchPositions =
    projectionQueryCalcFilterMatchPositions;

function projectionQueryCalcFilterMatchPositions(elementIds)
{
    return this.indexer.filterDataNodesAtPathPositions(this.pathId, elementIds);
}

//////////////////////////////////
// Access to Projection Matches //
//////////////////////////////////

// Returns an array containing the projection matches of this node.
// If the matches are explicitly maintained by this node, the base class
// implementation is sufficient (which assumes these projection are stored
// under 'projMatches'). In cases where the projection matches are not
// stored explicitly, we need to get these matches from the match parent.

ProjectionQueryCalc.prototype.getProjMatches = 
	projectionQueryCalcGetProjMatches;

function projectionQueryCalcGetProjMatches(resultId)
{
    var projMatches = this.InternalQueryCalc_getProjMatches(resultId);

    if(projMatches !== undefined)
        return projMatches;
    
    // get the matches from the match parent (or the indexer)
    
    var projMatches = this.matchParent.getProjMatches(resultId);
    if(projMatches !== undefined) {
        if(this.mustGenerateMatches !== undefined &&
           this.mustGenerateMatches.has(resultId)) {
            projMatches = 
                this.indexer.filterDataNodesAtPath(this.pathId, projMatches);
        }
        return projMatches;
    }
    
    // projection matches not restricted by the parent node,
    // all data nodes in the indexer at the projection path
    // are projection matches.
    return this.indexer.getAllMatches(this.pathId);
}

// Returns a Map object whose keys are the projection matches of
// this node.  Similar to getProjMatches().

ProjectionQueryCalc.prototype.getProjMatchesAsObj = 
	projectionQueryCalcGetProjMatchesAsObj;

function projectionQueryCalcGetProjMatchesAsObj(resultId)
{
    var projMatches = this.InternalQueryCalc_getProjMatchesAsObj(resultId);

    if(projMatches !== undefined)
        return projMatches;
    
    // get the matches from the match parent (or the indexer)

    var projMatches;

    if(this.mustGenerateMatches !== undefined &&
       this.mustGenerateMatches.has(resultId)) {
        projMatches = this.matchParent.getProjMatches(resultId);
        if(projMatches !== undefined) {
            projMatches = 
                this.indexer.filterDataNodesAtPath(this.pathId, projMatches);
            // covert to object
            var projMatchesAsObj = new Map();
            for(var i = 0, l = projMatches.length ; i < l ; ++i)
                projMatchesAsObj.set(projMatches[i], true);
            return projMatchesAsObj;
        }
    } else {
        projMatches = this.matchParent.getProjMatchesAsObj(resultId);
        if(projMatches !== undefined)
            return projMatches;
    }
    
    // projection matches not restricted by the parent node, all data
    // nodes in the indexer at the projection path are projection matches.
    return this.indexer.getAllMatchesAsObj(this.pathId);
}

// Return the projection matches for the given result ID only if these
// are explicitly stored here (otherwise, returns undefined)

InternalQueryCalc.prototype.getExplicitProjMatches = 
	internalQueryCalcGetExplicitProjMatches;

function internalQueryCalcGetExplicitProjMatches(resultId)
{
    return this.InternalQueryCalc_getProjMatches(resultId);
}

// Returns an array containing the subset of the input array which are
// projection matches of this node.
// If the matches are explicitly maintained by this node, the base class
// implementation is sufficient (which assumes these projection are stored
// under 'projMatches'). In cases where the projection matches are not
// stored explicitly, we need to filter these matches against the match parent.

ProjectionQueryCalc.prototype.filterProjMatches = 
	projectionQueryCalcFilterProjMatches;

function projectionQueryCalcFilterProjMatches(elementIds, resultId)
{
    var filtered = this.InternalQueryCalc_filterProjMatches(elementIds,
                                                            resultId);

    if(filtered !== undefined)
        return filtered;
    
    // filter the matches against the match parent (or the indexer)
    filtered = this.matchParent.filterProjMatches(elementIds, resultId);
    
    if(filtered === elementIds)
        // no filtering took place, which means that the parent does not
        // restrict the projection. Need to filter against the indexer
        return this.indexer.filterDataNodesAtPath(this.pathId, elementIds);

    return filtered;
}
