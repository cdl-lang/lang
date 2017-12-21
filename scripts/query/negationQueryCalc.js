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

// This object extends the base class InternalQueryCalc for negation
// query calculation nodes. A negation node is defined by a set of sub-nodes
// (the 'negated query calculation nodes') and a path ID (the 'negation path'),
// which must be a prefix of the path IDs of all terminal (and negation) 
// nodes dominated by this negation node. 
// The negation path cannot change after the node is constructed.
//
// The selection of the negation node is then the set of data nodes 
// at the negation path which are not selected by any of the negated 
// sub-nodes.
//
// Calculating the Negation
// ------------------------
//
// A negation receives match updates from two sources: the indexer
// (to receive the list of nodes at the negation path) and the negated
// sub-nodes. The negation query 'addMatches' and 'removeMatches' interface 
// makes use of the 'source' argument of these functions to determine
// whether the matches were added from the indexer, from a selection
// sub-node or from a projection sub-node.
//
// In the 'matches' list of the negation node, the count of every data 
// element ID received from the indexer is increased by 1. The count of 
// every data element ID received from any of the selection sub-nodes 
// is increased by 2. In this way, the matches of the negation node are 
// exactly those data element IDs whose count in the 'matches' table is 1. 
// When the count of an element ID in the 'matches' table reaches 0, it can 
// be deleted.
//
// The data elements received from the sub-nodes may have to be raised
// if their path is lower than the negation path. There is no need
// to store the original data elements received from the sub-nodes:
// it is enough to update the count of the raised data element.  
//
// When the negation has no negated sub-nodes (that is, the negation is
// the match-all query n()) no 'matches' table is created, as the matches
// of the query are exactly those received from the indexer (and can be
// fetched again from the indexer, if needed).
//
// Projections
// -----------
//
// Projection sub-nodes of the negation are not negated. This means that
// the negation calculation described above applies only to selection 
// sub-nodes. If the projection sub-nodes do not need to add their matches
// to the negation node, then the selection calculation can proceed
// exactly as described above (for the selection nodes only).
//
// If, however, the projection sub-nodes have to add their matches 
// (because the negation is dominated, directly or indirectly, by 
// a multi-projection intersection node) then the selection matches
// of the projections (after any required raising to the negation path) 
// need to be counted (separately from the match count of the selection
// sub-nodes). Each element ID with a count of at least 1 in this list
// adds a 1 to the count of that element in the 'matches' table.
// At the same time, there is no need to increase the count for matches
// received from the indexer: the selection matches of projections 
// must be a subset of the matches received from the indexer (after 
// appropariate raising, if necessary). In this way, an element ID is 
// then still considered matched on the negation node
// iff its count in the match table is 1.
//
// This method means that while the matches of the selection sub-nodes are
// negated, those of the projection sub-nodes are not. Exactly as in the 
// case where no negation takes place, a multi-projection intersection 
// will only project under elements which project a node under each 
// of the intersection's sub-projections.
//
// Having calculated the selection matches of the negation, the projection
// matches are calculated in the usual way: as an intersection of the
// selection matches with the projection matches of the dominating node.
// These matches must then be lowered to the match points of the projections.
//
// Match Points
// ------------
//
// Since all matches are raised to the negation path (or higher) before
// being passed on to the dominating node, it is enough for the dominating 
// node to receive from this node the match points which are equal to 
// or a prefix of the negation path. This can be deduced independently of
// the sub-nodes by simply registering the negation query calculation node
// to receive match point updates from the indexer. This registeration
// takes place, just as with a terminal query calculation  node, to 
// the path node in the indexer for the negation path.
//
// this.matchPoints holds the match points received from the indexer.
// This is not really used by the negation node itself, but is needed if
// a dominating node requests this list of match points. 
//
// The negation node also needs to keep track of the match points of the 
// sub-nodes in order to know whether raising of matches received from 
// those nodes is necessary. For this purpose, however, it is enough to
// keep track of how many of these match points are lower than the negation
// path (if none are, there is no need to raise matches). 
// this.numLowerMatchPoints is used to track these match points
// (we do not need to know which match points these are, only whether
// they exist).
// This count includes only match points received from sub-nodes which need
// to add their selection matches to this node (that is, either selection
// sub-nodes or projection sub-nodes which need to add their selections). 
//
// Finally, if the negation has projection sub-nodes, it needs to know
// which of these match points are lower than the negation path, as 
// projection matches need to be lowered to these paths (if possible).
// For this purpose, we track match points lower than the negation path
// and received from projection sub-nodes in the projMatchPoints table.
// Here, too, if we know that there are no such lower match points there
// is no need to try to lower projection matches. Therefore, we also count
// these match points.
//
// Object Structure
// ----------------
//
// {
//    pathId: <path ID>
//
//    matches: undefined|<Map object>: {
//       <data element ID>: <count>
//       .......
//    }
//
//    matchPoints: <Map>{
//        <path ID>: 1
//        ......
//    }
//    numLowerMatchPoints: <number>
//
//    projSubNodes: {
//        <query calc ID>: <InternalQueryCalc>,
//        ......
//    },
//    projSubNodeNum: <number of sub-projections>
//
//    projMatchPoints: <Map>{
//        <path node ID>: <count>
//        .....
//    }
//
//    projMatches: { // on projection and selection-projection nodes
//       <result ID>: <Map object>: {
//          <data element ID>: <count>
//          ....
//       }
//       ....
//    }
//
//    // projection sub-node selection matching
//
//    projSelectionMatches: <Map object>: {
//       <element ID>: <count>,
//       ......
//    }

//    // refresh fields
//
//    initialUpdate: true|undefined,
//    selectionBecameProjection: {
//        <query calculation ID>: true,
//        .......
//    }
//
//    pendingUpdates: [
//        {
//            elementIds: <array of element IDs>,
//            source: <source>,
//            isProjection: true|false,
//            isAdd: true|false
//        },
//        .....
//    ]
// }
//
// pathId: this is the path in the indexer which defines the
//   universe of the negation operation. The universe of the negation
//   operation is the set of nodes from which the matches of the sub-nodes
//   are removed to calculate the matches of the negation.  
//   This field must have the name 'pathId', as this is what the indexer
//   expects.
//
// matches: holds match counts for data elements. A count of 1 means 
//   that the data element was matched on this node.
//   All data elements stored here are above the negation path (have 
//   a path shorter or equal to the negation path). When lower data elements
//   are added as matches from sub-nodes, they are first raised, before
//   being added here. Element IDs added by selection nodes increase the
//   count by 2. In case projection sub-nodes add their matches, element IDs 
//   in the projSelectionMatches table get their count increased by 1.
//   If projection sub-nodes do not add their matches, each data element 
//   received from the indexer gets it count increased by 1.
//   When this node has no sub-nodes (that is, it is the query n()), the
//   'matches' table is not constructed, as the matches of the query
//   are exactly the matches received from the indexer.
//
// matchPoints: the attributes of this object are path node IDs and the
//   value is always 1. As explained in the introduction, these match
//   points are only those added by the indexer as a result of the registration
//   to the path node of the negation path. This, therefore, only holds
//   match points which are at the negation path or higher. These match 
//   points are forwarded to the matching parent of this node.
// numLowerMatchPoints: this is a counter of the number of match points
//   received from selection sub-nodes which are lower (have a longer path)
//   than the negation path. This number is increased by 1 for each 
//   such match point added and decreased for each such match point removed.
//   If this counter is not 0, raising of selection has to take place.
//   If this counter is 0, no such raising needs to take lace, which means
//   that element IDs can be added immediately to the 'matches' list without
//   first checking their path.
//
// projSubNode: this is a list of the projection sub-nodes of this node. 
//    This is a subset of the nodes in this.subNodes.
// projSubNodeNum: number of elements in 'projSubNodes'.
//
// projMatchPoints: if this node dominates projection sub-nodes, this 
//   table holds the match points (received from those nodes) which are
//   lower (longer path) than the negation path. For each match point
//   this table holds a counter for the number of projection match points
//   from which it was received (this is only needed in order to be able to
//   remove these match points correctly). When updating the projection 
//   matches, this object attempts to lower projection matches to the paths
//   in 'projMatchPoints'. 
//
// projMatches: this field appears on negation projection nodes and on 
//   negation selection-projection nodes. For a projection node, 
//   this field holds a subset of the matches of the node (those which
//   are also projection matches of the dominating node, if it restricts
//   the projection). This does not store the lowering of these projection
//   matches to match points of the sub-projections.
//   For a selection-projection node, this field holds the selection
//   matches of this node, intersected with the projection matches
//   of the parent (if the parent restricts the projection) and then 
//   raised to the prefix path of the query.
//   If such raising is required, the count of each element
//   in the projMatches table indicates how many matched elements were
//   raised to it (so that matches can be properly deleted). In all other
//   cases, the count is always 1.
//
// projSelectionMatches: when projection sub-nodes need to add their 
//   selection matches to this node, these selection matches are 
//   counted in this table, after being raised to the negation path.
//   Any element ID in this table (non-zero count) increases by 1 the
//   count of the same element ID in the main 'matches' table. 
//
// initialUpdate: this is set to true before and during the first time the
//   query refresh functions are called on this function. This is 
//   deleted at the end of the first refresh.
// selectionBecameProjection: during the query refresh process, this table 
//   has an entry for the ID of each sub-node of this query calculation 
//   node which is not a new sub-node, was a selection before the refresh
//   and is a projection after the update (this can happen only to compound
//   sub-nodes, where a new projection terminal is added somewhere under the 
//   compound node).
//
// pendingUpdates: this field may store an array which buffers addMatches
//   and removeMatches updates. Each entry in the array is one such update
//   (in the order received). Each object stores the arguments of
//   the addMatches/removeMatches ('isProjection' is an optional argument
//   of the 'removeMatches' function). As long as this array exists, any
//   new update will be pushed on it (instead of being processed) until
//   it is decided to process the updates (at which time this field will
//   be set back to undefined).
//   Currently this queue is used when a removal is received from a source
//   which is not the indexer (that is, the removal is received from one
//   of the queries being negated). If at this point the indexer has pending
//   removals for the negated path, all updates are buffered until
//   the update for the negated path is received. This is because
//   a removal of a set of elements from the indexer translates into two
//   updates: one for the negated query and one for the negated path. If the
//   negated query notification is processed first, this seems as if all
//   the removed nodes have become matches of the negation query (even though
//   they are about to be removed). Therefore, it is important to
//   remove the nodes from the negation path first.
//   When nodes are added, the updates should be processed in the opposite
//   order (first the negated query and then the negated path). Under the
//   current scheduling regime, longer paths are scheduled first, so there
//   is no need to perform any buffering.

//
// 

// %%include%%: "internalQueryCalc.js"

inherit(NegationQueryCalc, InternalQueryCalc);

//
// Constructor
//

// The constructor receives as input, in addition to the root query
// calculation node which owns it, also the ID of the path in the indexer
// which defines its universe (the set from which the matches of the 
// sub-nodes are deducted). This is the 'negation path ID' which should
// be given relative to root of the indexer. 

function NegationQueryCalc(rootQueryCalc, negationPathId)
{
    // call base constructor
	this.InternalQueryCalc(rootQueryCalc);

    // initialize derived class fields (projection related fields are
    // constructed only when needed).
    
    this.matches = undefined; // may change when the negation is initialized

    this.pathId = negationPathId;
    // increase the path ID allocation count so that this node now
    // owns this path ID (this way it can be properly released)
    this.indexer.qcm.allocatePathIdByPathId(negationPathId);
    this.numLowerMatchPoints = 0;

    this.initialUpdate = true;
    this.pendingUpdates = undefined;
}

// destruction function
// In addition to the base class destruction, this function must also 
// detach the query calculation node from the indexer and release
// its allocation of the negation path ID.

NegationQueryCalc.prototype.destroy = negationQueryCalcDestroy;

function negationQueryCalcDestroy()
{
    // detach from indexer
    this.detachFromIndexer();

	// base class destroy (this also detaches from the root query calculation
    // node if this is the top query calculation node)
	this.InternalQueryCalc_destroy();
}

// Return the maximal match count that needs to be stored in the 'matches'
// table. Each sub-query contributes 2 to this number (see introduction)
// + 1 for the indexer matches.

NegationQueryCalc.prototype.maxMatchCount = negationQueryCalcMaxMatchCount;

function negationQueryCalcMaxMatchCount()
{
    return this.subNodeNum * 2 + 1;
}

///////////////////////////////
// Property Access Functions //
///////////////////////////////

// This function is called by the indexer to determine whether indexing is
// needed. For a negation node, no indexing is needed.

NegationQueryCalc.prototype.isSelection = negationQueryCalcIsSelection;

function negationQueryCalcIsSelection()
{
	return false;
}

// Returns true if this node is a projection node (but not a 
// selection-projection node) and false otherwise. For a negation node,
// this is determined by the existence of projection sub-nodes.

NegationQueryCalc.prototype.isProjection = negationQueryCalcIsProjection;

function negationQueryCalcIsProjection()
{
	return !!this.projSubNodeNum;
}

// This function returns true, because this is a negation node (other
// nodes return false).

NegationQueryCalc.prototype.isNegation = negationQueryCalcIsNegation;

function negationQueryCalcIsNegation()
{
	return true;
}

// Is a generating projection only if it is a selection-projection and
// is not dominated by another generating projection. Such a dominating
// projection must be an intersection with multiple projection sub-node.
// This holds iff the parent (union) node needs to add its selection
// matches, so we simply check the 'mustAddMatches' property on the parent
// node (which, if this is a selection-projection, must be a union node).

NegationQueryCalc.prototype.isGeneratingProjection = 
	negationQueryCalcIsGeneratingProjection;

function negationQueryCalcIsGeneratingProjection()
{
    return this.isSelectionProjection() && !this.matchParent.mustAddMatches;
}

//////////////////
// Match Points //
//////////////////

// This function receives the initial list (array) of match points for 
// the negation path after registering to the indexer. The function then 
// updates its 'matchPoints' table with these match points and forwards
// these match points to its match parent. As all these match points must
// be higher than (or equal to) the negation path, all these match points
// need to be forwrded to the match parent.
// This function is called just once, when this node is registered to
// the indexer. This happens the first time the refreshMatchPoints()
// function is called. As this is the initial registration to the indexer,
// we know that the 'matchPoints' table was previously empty.

NegationQueryCalc.prototype.setMatchPoints = 
	negationQueryCalcSetMatchPoints;

function negationQueryCalcSetMatchPoints(matchPoints)
{
	for(var i = 0, l = matchPoints.length ; i < l ; ++i) {
		var pathId = matchPoints[i];
		this.matchPoints.set(pathId, 1);
		if(this.matchParent)
			this.matchParent.addToMatchPoints(pathId, this);
	}
}

// This function can be called by either the indexer, a selection sub-node
// or a projection sub-node to increase the match point count for the
// match point given by 'pathId'. For each of these sources, this function
// needs to perform a different update. The 'source' argument is the 
// object which called this function. It is therefore either the indexer
// or the sub-node.
// In case the source is the indexer, the match point needs to be added
// to the 'matchPoints' table and forwarded to the match parent (this
// match point is necessarily equal to, or a prefix of, the negation path).
// If the source of the match point is a query calculation sub-node,
// this function first checks whether pathId is larger than the negation
// path. If it is not, there is nothing to do, as we are only interested
// in the sub-node match points for raising and lowering purposes (see 
// introduction for more details). If the match point 'pathId' is lower 
// than the negation path, then:
// 1. If source is a selection match point or if projection sub-nodes
//    must add their selections, the counter of lower match points is
//    increased.
// 2. If the source is a projection sub-node, the counter for that match
//    point in the projMatchPoints table is increased.    

NegationQueryCalc.prototype.addToMatchPoints = 
	negationQueryCalcAddToMatchPoints;

function negationQueryCalcAddToMatchPoints(pathId, source)
{
    if(source == this.indexer) { // add to match points and propagate
        // must be a new match point
        this.matchPoints.set(pathId, 1);
        this.matchParent.addToMatchPoints(pathId, this);
        return;
    }

    // match point received from sub-node
    
    if(pathId <= this.pathId)
        return; // no need to add: higher than negation path

    var isProjection = source.isProjection();
    
    // Does this sub-node add its selection matches?
    // if a projection sub-node must add its selection matches this can 
    // only be because of a node dominating the negation node, so here it 
    // is enough to check whether the negation node needs to add its 
    // matches 
    if(!isProjection || this.mustAddMatches)
       this.numLowerMatchPoints++;

    if(isProjection) {
        if(!this.projMatchPoints)
            this.projMatchPoints = new Map();
        if(!this.projMatchPoints.has(pathId)) {
            this.projMatchPoints.set(pathId, 1);
        } else {
            count = this.projMatchPoints.get(pathId) + 1;
            this.projMatchPoints.set(pathId, count);
        }
    }
}

// This function can be called by either the indexer, a selection sub-node
// or a projection sub-node to decrease the match point count for the
// match point given by 'pathId'. For each of these sources, this function
// needs to perform a different update. The 'source' argument is the 
// object which called this function. It is therefore either the indexer
// or the sub-node.
// In case the source is the indexer, the match point needs to be removed
// from the 'matchPoints' table and the removal need to be forwarded to 
// the match parent (this match point is necessarily equal to, or a prefix of, 
// the negation path).
// If the source of the match point is a query calculation sub-node,
// this function first checks whether pathId is larger than the negation
// path. If it is not, there is nothing to do, as we are only interested
// in the sub-node match points for raising and lowering purposes (see 
// introduction for more details). If the match point 'pathId' is lower 
// than the negation path, then:
// 1. If source is a selection match point or if projection sub-nodes
//    must add their selections, the counter of lower match points is
//    decreased.
// 2. If the source is a projection sub-node, the counter for that match
//    point in the projMatchPoints table is decreased.    

NegationQueryCalc.prototype.removeFromMatchPoints = 
	negationQueryCalcRemoveFromMatchPoints;

function negationQueryCalcRemoveFromMatchPoints(pathId, source)
{
    if(source == this.indexer) { // remove from match points and propagate
        // must be an existing match point
        this.matchPoints.delete(pathId);
        this.matchParent.removeFromMatchPoints(pathId, this);
        return;
    }

    // match point received from sub-node
    
    if(pathId <= this.pathId)
        return; // no need to remove: higher than negation path

    var isProjection = source.isProjection();
    
    // Does this sub-node add its selection matches?
    // if a projection sub-node must add its selection matches this can 
    // only be because of a node dominating the negation node, so here it 
    // is enough to check whether the negation node needs to add its 
    // matches 
    if(!isProjection || this.mustAddMatches)
        this.numLowerMatchPoints--;

    if(isProjection) {
        var count = this.projMatchPoints.get(pathId) - 1;
        if(count === 0)
            this.projMatchPoints.delete(pathId);
        else
            this.projMatchPoints.set(pathId, count);
    }
}

///////////////////////
// Sub-Query Removal //
///////////////////////

// The functions in this section handle the update of the negation
// query calcualtion node in the case a query calculation node is removed.
// This includes both the direct removal of a sub-node of the negation
// query calcualtion node and the indirect effects of removing a 
// query calculation node elsewhere in the query structure.
//
// For a general description of the algorithm for handling such a removal,
// see the introduction to the code selction "Sub-Query Removal" in
// InternalQueryCalc.js. The documentation below is for the specific
// implementation of that algorithm for the negation query calculation
// node.

//

// This function is called when a sub-node was removed from the query
// structure. 'subNode' is a sub-node of this node such that either 
// 'subNode' is the node removed (it is then no longer found in 
// this.subNodes) or it is the sub-node under which the removal took
// place. In the second case, the removed node must have been
// a projection node (otherwise its removal would have had no direct 
// consequences for this node).
//
// If a projection sub-node was removed or a projection sub-node
// changed from a projection to a selection, and if, as a result, the
// negation node changed from a projection into a selection, then this
// change needs to be propagated to the parent node. In all other
// cases, only the match changes need to be forwarded to the
// dominating nodes. The propagation of the structural change
// (projection -> selection) to the parent takes place before the
// matches of the negation node are recalculated, so that when the
// matches of the negation node are recalculated, these could be
// forwarded directly to the parent, which is already structurally
// updated.
//
// If the dominating node is the root query calculation node, the
// change (from a projection to a selection) is also propagated, to
// allow the root query calculation node to prepare itself for
// notifications for the new query structure.
//
// After the structure is updated and the propagated to the parent, 
// the matches and match points are updated. This takes place
// together, as the match point update needs to take place after 
// old matches are removed but before new matches are added.

NegationQueryCalc.prototype.updateQueryAfterNodeRemoval = 
    negationQueryCalcUpdateQueryAfterNodeRemoval;

function negationQueryCalcUpdateQueryAfterNodeRemoval(subNode)
{
    var subProjAddedMatches = 
        this.isProjection() && this.subProjMustAddMatches(); // before update
    var subNodeId = subNode.getId();
    // true if sub-node was removed under this node.
    var subNodeRemoved = !(subNodeId in this.subNodes);
    var wasProjection = 
        (this.projSubNodes !== undefined && (subNodeId in this.projSubNodes));

    if(wasProjection) {
        // the projection sub-node was removed or changed into a selection
        delete this.projSubNodes[subNodeId];
        this.projSubNodeNum--;

        if(this.projSubNodeNum == 0) {
            // changed from a projection to a selection, propagate the change
            // to the match parent (that is, also to the root query calculation
            // node if this is the top query calculation node).
            this.matchParent.updateQueryAfterNodeRemoval(this);
            // this may have become a selection-projection node and threfore
            // a generating projection
            if(this.isGeneratingProjection())
                this.rootQueryCalc.addSelectionGeneratingProj(this);
        }
    }

    // update matches and match points
    this.updateMatchingAfterRemoval(subNode, wasProjection, subNodeRemoved, 
                                    subProjAddedMatches);
}

// This function is called on this query calculation node (which must
// be a projection) during the processing of a node removal. This
// node removed must have been a projection and resulted in the change
// of the 'sub-projections must add matches' property on this node
// from true to false (the node removed was not removed under this node,
// but under a common parent). This function then first updates its own
// match points and matches to accomodate for this change (using 
// the sub-projection's match points and matches from 
// before the update). The function then removes the 'mustAddMatches'
// property from its projection sub-nodes, which may, in turn, 
// propagate this property update further down its projection sub-nodes.
// This recursive operation may incrementally update the match points
// of this node.
// To update the match points, all we need to do is deduct the count in 
// this.numProjMatchPoints from this.numLowerMatchPoints (as the projections
// no longer contribute to the selection match points).
// To update the matches, this function calls this.clearProjSelectionMatches()
// to remove the projection nodes' selection matches (and recalculate
// the matches of this node).

NegationQueryCalc.prototype.unsetSubProjsMustAddMatches = 
    negationQueryCalcUnsetSubProjsMustAddMatches;

function negationQueryCalcUnsetSubProjsMustAddMatches()
{    
    // update the lower match point counts
    if(this.projMatchPoints !== undefined)
        this.numLowerMatchPoints -= this.projMatchPoints.size;
    
    // update the matches (this also forwards updates to the parent)
    this.clearProjSelectionMatches();

    // propagate this change to the projection sub-nodes
    for(var id in this.projSubNodes)
        this.projSubNodes[id].unsetMustAddMatches();
}

// This function is called to update match points and matches on this
// node after a node is removed from the structure of the query.
// 'subNode' is a sub-node of this node such that either 
// 'subNode' is the node removed (it is then no longer found in 
// this.subNodes) or it is the sub-node under which the removal took
// place. In the second case, the removed node must have been
// a projection node (otherwise its removal would have had no direct 
// consequences for this node).
// At the time this function is called, the match points and matches
// of subNode have not (yet) been updated, so all function here which
// read the match points and matches from the sub-node get the values
// from before the removal of the sub-node.
// 
// 'wasProjection' indicates whether subNode was a projection before the
// update. 'subNodeRemoved' indicates whether subNode was removed
// from this node (otherwise, it changed from a projection to a selection).
// Finally, 'subProjAddedMatches' indicates whether projection sub-nodes
// of this node had to add their selection matches to this node before 
// the removal (this property may change as a result of the removal of 
// the node).
// These three properties can then be used to determine how the match
// points and matches of this node need to be updated. Since the matches
// of each kind of sub-node (selection/projection/adding projection)
// are treated differently, each is handled in a different step:
// 1. The node was a selection:
//      The node must have been removed. The only thing to do is call
//      'removeMatches()' with the matches of the removed sub-node.
//      The rest of the update will take place in the normal incremental way.
// 2. The sub-node is a projection that had to add its matches:
//    a. If after this operation the negation node is still a projection
//       (and therefore there are still projection sub-nodes which need
//       to add their matches) a standard call to 'removeMatches()' with
//       the matches of the sub-node suffices. At this point, the sub-node
//       may already have become a selection, but its matches have not
//       yet been updated.
//    b. If after this update the negation node is no longer a projection,
//       all projection selection matches can be cleared and matching 
//       without the selection matches of projections is initialized.
// 3. The sub-node is a projection which did not have to add its matches:
//    a. If after this operation the negation node is still a projection,
//       there is nothing to do. The only projection matches which 
//       can be removed are those projection matches which were lowered to 
//       match points which only belong to the projection sub-node.
//       These match points are not stored in this.projMatches, so there
//       is nothing to clear.
//    b. If after this operation the negation node is not a projection anymore,
//       all projection matches can be cleared. This node may have become
//       a selection-projection. In this case, the selection-projection
//       matches need to be calculated and forwarded to the result node.
// 4. If the projection became a selection: the selection matches of the 
//    sub-node have to be added using the standard 'addMatches()'.
// Steps 1-3, which remove matches, take place using the old match points and
// mode of the node. Before step 4, the match
// points are updated and the mode is reset. Step 4 takes place using the
// updated mode and match points (since it adds matches).
// Remark: for a single node, we could have cases 2+4 or 3+4. In case 2,
// this may result in two match updates begin sent to the parent node.
// Given that this case is probbly not very frequent, there was no attempt
// made to optimize this here.

NegationQueryCalc.prototype.updateMatchingAfterRemoval = 
    negationQueryCalcUpdateMatchingAfterRemoval;

function negationQueryCalcUpdateMatchingAfterRemoval(subNode, wasProjection, 
                                                     subNodeRemoved, 
                                                     subProjAddedMatches)
{
    // process the different cases, as described above
    
    if(!wasProjection) { // case 1
        this.removeMatches(subNode.getMatches(), subNode);
    } else {
        // the sub-node was a projection

        if(!this.isProjection()) // cases 2b and 3b
            this.resetProjMatchesAfterNodeRemoval(subProjAddedMatches);
        else if(subProjAddedMatches) { // case 2a
            // call removeMatches, signaling that the sub-node is a projection,
            // even if the sub-node is no projection anymore
            this.removeMatches(subNode.getMatches(), subNode, true);
        } // else: case 3a (nothing to do)
    }

    // update match points and set the mode before adding new matches
    this.updateMatchPointsAfterRemoval(subNode, wasProjection, 
                                       subNodeRemoved, subProjAddedMatches);

    if(!subNodeRemoved) // case 4 (must have become a selection)
        this.addMatches(subNode.getMatches(), subNode);

    this.unsuspend(); // in case the node was suspended
}

// This function is called to update match points on this
// node after a node is removed from the structure of the query.
// 'subNode' is a sub-node of this node such that either 
// 'subNode' is the node removed (it is then no longer found in 
// this.subNodes) or it is the sub-node under which the removal took
// place. In the second case, the removed node must have been
// a projection node (otherwise its removal would have had no direct 
// consequences for this node).
// 'wasProjection' indicates whether subNode was a projection before the
// update. 'subNodeRemoved' indicates whether subNode was removed
// from this node (otherwise, it changed from a projection to a selection).
// Finally, 'subProjAddedMatches' indicates whether projection sub-nodes
// of this node had to add their selection matches to this node before 
// the removal (this property may change as a result of the removal of 
// the node). These three properies can then be used to determine how the 
// match points need to be updated.  
// At the time this function is called, the match points of subNode have not 
// (yet) been updated. This function loops over all the full count match
// points of the sub-node. It only looks at those which are lower (longer
// path) than the negation path. There are then several (not mutually 
// exclusive) posibiilities:
// 1. If the sub-node was removed and was either a selection node or a
//    projection node which had to add its matches, the 'numLowerMatchPoints'
//    counter is decreased by 1 for each match point of the sub-node
//    which is lower than the negation path.
// 2. If the sub-node was a projection node, the match points lower than
//    the negation node are removed from the projection match point table.
// 3. If the sub-node was not removed (and is, therefore, a projection
//    which became a selection) and the projection did not previously add
//    its matches, the count of 'numLowerMatchPoints' is increased
//    by 1 for each match point of the sub-node which is lower than
//    the negation path.
// At the end of this function, the mode is reset. The mode is dependent
// both on the match points and on the structure of the query 
// (projection/adding projection/selection).

NegationQueryCalc.prototype.updateMatchPointsAfterRemoval = 
    negationQueryCalcUpdateMatchPointsAfterRemoval;

function negationQueryCalcUpdateMatchPointsAfterRemoval(subNode, wasProjection, 
                                                        subNodeRemoved, 
                                                        subProjAddedMatches)
{
    if(this.numLowerMatchPoints ||
       (this.projMatchPoints !== undefined && this.projMatchPoints.size > 0)) {
        // lower match points exist - otherwise there is nothing to update

        // loop over sub-node match points
        var _self = this;
        subNode.getFullCountMatchPoints().forEach(function(count, pathId) {
            if(pathId <= _self.negated)
                return;
            if(subNodeRemoved && (!wasProjection || subProjAddedMatches))
                _self.numLowerMatchPoints--;
            if(wasProjection) {
                var projCount = _self.projMatchPoints.get(pathId) - 1;
                if(projCount === 0)
                    _self.projMatchPoints.delete(pathId);
                else
                    _self.projMatchPoints.set(pathId, projCount);
            }
            if(!subNodeRemoved && !subProjAddedMatches)
                _self.numLowerMatchPoints++;
        });
    }
}

///////////////////
// Query Refresh //
///////////////////

// During the query refresh phase, sub-nodes may only be added and 
// selection sub-nodes may become projection sub-nodes (but not the
// other way around). The refresh takes place in three phases: 
// structural refresh, match point refresh and match refresh.
// For a general introduction to the query refresh, see the introduction
// to the "Query Refresh" section of InternalQueryCalc.js. For the specific
// details for the negation query calculation node, see the introduction
// to the individual functions below.
//
// Until its matches are refreshed, the getMatches() (and getMatcheAsObj())
// function is required to return the same matches as those before the refresh.
// Since the matches of the sub-nodes are updated only after the matches
// of this node are refreshed, the 'matches' table of this node remains
// unchanged until the matches are updated and, therefore, the node continues
// to return the same list of matches.

//

// This function is called in the structure refresh phase of the query
// refresh (for full documentation, see the 'query refresh' section 
// of the base class). This first refreshes the structure of the sub-queries
// and then updates its own list of sub-projections and their number.
// It is also responsible for recording which (existing, not new) 
// sub-nodes changed from a selection into a projection (this is used
// when refreshing the match points and matches).

NegationQueryCalc.prototype.refreshQueryStructure = 
    negationQueryCalcRefreshQueryStructure;

function negationQueryCalcRefreshQueryStructure()
{
    var prevProjSubNodeNum = this.projSubNodeNum ? this.projSubNodeNum : 0;

    // loop over the modified and new sub-nodes
    for(var id in this.updatedSubNodes) {
        
        var isNew = this.updatedSubNodes[id];
        var subQueryCalc = this.subNodes[id];
        var wasProjection = subQueryCalc.isProjection(); // before the refresh

        // recursively updated the lower nodes
        subQueryCalc.refreshQueryStructure();
        
        // is this a new node which is a projection or a selection which
        // became a projection ? Update the projection count
        if((isNew || !wasProjection) && subQueryCalc.isProjection()) {
            if(!this.projSubNodes)
                this.projSubNodes = {};
            this.projSubNodes[id] = subQueryCalc;
            if(!this.projSubNodeNum)
                this.projSubNodeNum = 1;
            else 
                this.projSubNodeNum++;            
            
            if(!isNew) { // a selection which became a projection
                if(!this.selectionBecameProjection)
                    this.selectionBecameProjection = {};
                this.selectionBecameProjection[id] = true;
            }
        }
    }

    if(this.projSubNodeNum > 0 && prevProjSubNodeNum == 0)
        // this may have been a selection-projection generating projection
        // if it wasn't, the removal here does no harm.
        this.rootQueryCalc.removeGeneratingProj(this);

    if(this.parent && this.parent.subProjMustAddMatches())
        // calls setSubProjsMustAddMatches() if this property is new
        this.setMustAddMatches();
}

// This function is called on this query calculation node (which must
// be a projection) during the structure refresh phase to indicate that 
// the sub-projections of this negation need to add their 
// selection matches to this node. This function is only called if
// prior to the query refresh the projection sub-nodes were not required
// to add their selection matches.
// This function sets the projection sub-nodes of this node to be treated
// as new sub-nodes in the next update steps. This function then 
// deletes all projection match points so that when the match points
// of the projection sub-nodes are later added, they will add all their
// match points ot this node.

NegationQueryCalc.prototype.setSubProjsMustAddMatches = 
	negationQueryCalcSetSubProjsMustAddMatches;

function negationQueryCalcSetSubProjsMustAddMatches()
{
    // clear the projection match points
    this.projMatchPoints = new Map();

    // set this property on the projection sub-nodes 
    for(var id in this.projSubNodes) {
        this.projSubNodes[id].setMustAddMatches();
        // in the following steps of the refresh, update this sub-node 
        // as new (adding all its matches).
        this.addUpdatedSubNode(id, true);
    }
}

//
// Match Point Refresh
//

// This function refreshes the match point tables and counts on this node 
// and recursively refreshes the match points on the sub-nodes. 
// This function is responsible for the intial registration to the 
// indexer at the negtion path. To determine whether such a registration
// took place, the function checks whether the root path ID appears in 
// the match point table. Since the root path is always a match point,
// this indicates that this is the initial refresh of this node.
// When this function registers itself to the indexer, the match points
// dominating the negation node are added (using setMatchPoints())
// to the match point table (and these match points are propagated
// to the parent node). This only needs to happen once, at the initial
// refresh. This should not happen before this function is called, as it
// is assumed by all query calculation nodes that the match points are added
// only during the match point refresh phase of the query refresh 
// (before that it is not always known which query calculation nodes
// are projections, information which is necessary for the correct 
// update of match points). 
// The second part of this function refreshes the match points on this 
// negation node based on the structural changes applied in the structural
// refresh pahase but using the match points of the sub-nodes as
// calculated before the refresh (often these match point lists are empty,
// as the initial refresh of those nodes did not yet take place).
// After this step, the sub-nodes which changed (or a are new) are allowed
// to refresh their match points. These updates may be propagated to
// this node using the standard 'addToMatchPoints()' and 
// 'removeFromMatchPoints()' functions.

NegationQueryCalc.prototype.refreshMatchPoints = 
    negationQueryCalcRefreshMatchPoints;

function negationQueryCalcRefreshMatchPoints()
{
    // if the root path is not in the match point table, this node 
    // is being refreshed for the first time.
    this.initialUpdate = 
        !this.matchPoints.has(this.indexer.qcm.getRootPathId());
    
    if(this.initialUpdate)
        // need to register the node to the indexer
        this.indexer.addQueryCalcToPathNode(this);

    var _self = this;
    
    for(var id in this.updatedSubNodes) {
        var subNode = this.subNodes[id];
        if(this.updatedSubNodes[id]) {
            // new sub-node, add its existing match points, if any
            subNode.getFullCountMatchPoints().forEach(function(count, pathId){
                if(pathId <= _self.pathId)
                    return; // match point too high (see introduction)
                _self.addToMatchPoints(pathId, subNode);
            });
        } else if(this.selectionBecameProjection && 
                  this.selectionBecameProjection[id]) {
            // add match points as projection match points
            var lowerMatchPointCount = 0;
            subNode.getFullCountMatchPoints().forEach(function(count, pathId){
                if(pathId <= _self.pathId)
                    return; // match point too high (see introduction)
                lowerMatchPointCount++;
                _self.addToMatchPoints(pathId, subNode);
            });
            // need to remove the match points as selection match points
            // (if projections need to add their selections, the match
            // points were just added now again, so in any case we need
            // to remove the match point count from before the update).
            this.numLowerMatchPoints -= lowerMatchPointCount;
        }

        subNode.refreshMatchPoints();
    }
}

//
// Match Refresh
//

// This function is called at the end of the query refresh cycle to refresh 
// the matches of the negation node. At this point, the match points 
// on all nodes have already been updated. However, when this function is 
// called, the matches on this node and all its sub-nodes have not yet
// been updated and therefore, getMatches() on this node and all sub-nodes 
// should still return the matches as they were before the refresh.
//
// First, for every selection which became a projection, we remove the 
// matches of the selection (even if projections need to add their matches,
// as this is done in a different way) and add the matches as a projection
// selection matches (if adding selection matches by sub-projections was
// already turned on, otherwise, these matches are added below). 
//
// Next, if selection matching by projections is turned on, this function 
// attempts to initialize this mode. If selection matching by projections 
// was already initialized, this does nothing. This initialization must suspend
// the node (if not previously suspended) as all matches are temporarily lost.
// 
// Finally, if new sub-nodes were added, the existing matches of these sub-nodes
// are added. This includes all projection sub-nodes (including existing
// sub-nodes) in case addition of matches by projection sub-nodes
// was just turned on.
//
// If any of these updates takes place, this node is suspended.
// Before the function exits, the node is unsuspended.

NegationQueryCalc.prototype.refreshMatches = negationQueryCalcRefreshMatches;

function negationQueryCalcRefreshMatches()
{
    if(this.initialUpdate)
        this.initialRefreshMatches();
    else {

        if(this.subNodeNum > 0) {
            if(this.matches === undefined) {
                var negationUniverse = this.indexer.getAllMatches(this.pathId);
                // create the 'matches' table and add the previous matches to
                // it, which are simply the indexer matches
                this.matches = new IntHashMapUint(this.maxMatchCount(),
                                                  negationUniverse.length);
                for(var i = 0, l = negationUniverse.length ; i < l ; ++i)
                    this.matches.set(negationUniverse[i], 1);
            } else {
                // check whether the number of bytes needed for storing
                // the counts has changed
                this.matches.adjustByteNumber(this.maxMatchCount());
            }
        }
        
        if(this.selectionBecameProjection) { // cannot be initial update
            this.suspend();
            for(var id in this.selectionBecameProjection) {
                var subNode = this.subNodes[id];
                // call removeMatches with thrid argument 'false' to force
                // this to be treated as a selection
                this.removeMatches(subNode.getMatches(), subNode, false);
            }
        }
    
        if(this.isProjection() && this.mustAddMatches)
            // may already be initialized: this function first checks this
            this.initProjSelectionMatches();

        for(var id in this.updatedSubNodes) {

            var subNode = this.subNodes[id];
            
            // if this sub-node needs to add matches and it is new, add 
            // its existing matches before updating its matches (which will
            // result in an incremental update)
            
            if(this.updatedSubNodes[id] &&
               (!this.projSubMatches || !(id in this.projSubNodes) || 
                subProjMustAddMatches)) {
                this.suspend(); // if not already suspended
                // new sub-node which is a selection or an adding projection
                
                this.addMatches(subNode.getMatches(), subNode);
            }

            // update the matches of the sub-node (with incremental update
            // of this node)
            subNode.refreshMatches();
        }

        if(this.subNodeNum == 0 && this.matches !== undefined)
            this.matches = undefined; // not needed after the refresh
    }

    this.unsuspend(); // if was suspended

    this.updatedSubNodes = undefined;
    this.initialUpdate = undefined;
    if(this.selectionBecameProjection)
        this.selectionBecameProjection = undefined;
}

// This function implements refreshMatches for the case where this is 
// the initial update.

NegationQueryCalc.prototype.initialRefreshMatches = 
    negationQueryCalcInitialRefreshMatches;

function negationQueryCalcInitialRefreshMatches()
{
    if(this.subNodeNum > 0)
        this.matches = new IntHashMapUint(this.maxMatchCount());
    
    var subProjAddsMatches = this.isProjection() && this.mustAddMatches;

    if(subProjAddsMatches)
        // projection sub-nodes add their matches
        this.initProjSelectionMatches();
        
    // first, add the matches of the selection sub-nodes and refresh
    // those sub-nodes (receiving an incremental update). This does not
    // create any full matches yet
    
    for(var id in this.subNodes) {
        if(this.projSubNodes && (id in this.projSubNodes))
            continue;
        var subNode = this.subNodes[id];
        // first add existing matches of the sub-node (if any)
        // then update the sub-node (with incremental update)
        this.addMatches(subNode.getMatches(), subNode);
        subNode.refreshMatches();
    }

    if(subProjAddsMatches) {
        // add the matches of the projection sub-nodes and refresh
        // those sub-nodes (receiving an incremental update). This creates
        // the full matches
        for(var id in this.projSubNodes) {
            var subNode = this.subNodes[id];
            // first add existing matches of the sub-node (if any)
            // then update the sub-node (with incremental update)
            this.addMatches(subNode.getMatches(), subNode);
            subNode.refreshMatches();
        }
    } else {
        // add the matches from the indexer (this creates full matches) 
        var negationUniverse = this.indexer.getAllMatches(this.pathId);
        this.addMatches(negationUniverse, this.indexer);
    }
}

////////////////
// Suspension //
////////////////


// This function is called when a negation query calculation node 
// is suspended. This function stores the matches of the node 
// under this.suspendedMatches. From that moment on, getMatches() returns
// these stored matches, until the node is unsuspended. 

NegationQueryCalc.prototype.suspendSelection = 
    negationQueryCalcSuspendSelection;

function negationQueryCalcSuspendSelection()
{
    // copy the matches to 'this.suspendedMatches'.
    this.suspendedMatches = new Map();

    if(this.initialUpdate)
        return; // no matches yet

    if(this.matches === undefined) { // only indexer matches
        var negationUniverse = this.indexer.getAllMatches(this.pathId);
        for(var i = 0, l = negationUniverse.length ; i < l ; ++i)
            this.suspendedMatches.set(negationUniverse[i], 1);
        return;
    }
    
    var _self = this;
    this.matches.forEach(function(count, elementId) {
        if(count == 1)
            _self.suspendedMatches.set(elementId, true);
    });
}

// This function is called when projection calculation is suspended on 
// this node. If resultId is defined, projection matches are suspended
// only for this result node (this is used to reset the projection matches
// in setProjMatches()). If resultId is not defined, the suspension is 
// for all result nodes.
// This function first checks that the node has projection match points
// (which means that the node is a projection and that lowering to 
// the projection sub-nodes needs to take place). If it does, 
// this function makes sure that 'this.projMatches'
// stores all projection matches of this node, including lowered
// projection matches which are not normally stored in this table.
// As only lower projection matches at projection match points are not
// stored in this.projMatches, this function does not do anything if
// there are no projection match points. If there are projection match
// points, the matches in this.projMatches are lowered to these projection
// match points and these lowered matches are added to this.projMatches.

NegationQueryCalc.prototype.suspendProjMatches = 
	negationQueryCalcSuspendProjMatches;

function negationQueryCalcSuspendProjMatches(resultId)
{
    if(this.projMatchPoints === undefined || !this.projMatchPoints.size === 0)
        return; // this is not a projection or there is no need for lowering

    if(!this.projMatches)
        return; // no projection matches to suspend

    var dataElements = this.indexer.getDataElements();
    var projMatchPoints = [];
    this.projMatchPoints.forEach(function(count, pathId) {
        projMatchPoints.push(pathId);
    });
    var resultIds;
    if(resultId)
        resultIds = [resultId];
    else {
        resultIds = [];
        this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                              resultId) {
            resultIds.push(resultId);
        });
    }

    for(var r = 0, lr = resultIds.length ; r < lr ; ++r) {
        
        var resultId = resultIds[r];
        var thisProjMatches = this.projMatches.get(resultId);

        if(thisProjMatches === undefined)
            continue; // no matches to suspend
        
        var projMatches = [];
        thisProjMatches.forEach(function(count, elementId) {
            projMatches.push(elementId);
        });

        var numOrigProjMatches = projMatches.length;
        projMatches = dataElements.lowerDataElementsTo(projMatches,
                                                       projMatchPoints);

        for(var i = numOrigProjMatches, l = projMatches.length ; i < l ; ++i) 
            thisProjMatches.set(projMatches[i], 1);
    }
}

// This function is called when the node is unsuspended. If this 
// node needs to add selection matches to it match parent, this function
// returns an array with the current selection matches (in the 'matches'
// table) which are not found in this.suspendedMatches. Otherwise,
// the function returns immediately.

NegationQueryCalc.prototype.calcNewFullMatchesAfterSuspension = 
	negationQueryCalcCalcNewFullMatchesAfterSuspension;

function negationQueryCalcCalcNewFullMatchesAfterSuspension()
{
    if(!this.shouldAddMatches())
        return;

    if(this.suspendedMatches.size == 0)
        return this.getMatches();
    else if(this.matches === undefined) {
        // matches are the full negation universe
        var negationUniverse = this.indexer.getAllMatches(this.pathId);
        var added = [];
        for(var i = 0, l = negationUniverse.length ; i < l ; ++i) {
            var elementId = negationUniverse[i];
            if(!this.suspendedMatches.has(elementId) ||
               this.suspendedMatches.has(elementId) != 1)
                added.push(elementId);
        }
        return added;
    } else {
        var added = [];
        var _self = this;
        this.matches.forEach(function(count, elementId) {
            if(count == 1 &&
               (!_self.suspendedMatches.has(elementId) ||
                _self.suspendedMatches.has(elementId) != 1))
                added.push(elementId);
        });
        return added;
    }
}

// This function should be called when a suspended node is unsuspended.
// It should be called after the new matches of the node have already
// been calculated. It then goes over all suspended matches and returns
// an array of all suspended matches which are no longer matches.

NegationQueryCalc.prototype.calcRemovedSuspendedMatches = 
	negationQueryCalcCalcRemovedSuspendedMatches;

function negationQueryCalcCalcRemovedSuspendedMatches()
{
    if(this.suspendedMatches.size == 0)
        return [];

    var removed = [];

    if(this.matches === undefined) {
        // matches are the full negation universe
        var suspendedMatches = [];
        this.suspendedMatches.forEach(function(count, elementId) {
            if(count == 1)
                suspendedMatches.push(elementId);
        });
        // filter against the nodes in the indexer
        var diff = this.indexer.filterDataNodesAtPathWithDiff(this.pathId,
                                                              suspendedMatches);

        return diff.removed;
    } else {
        var _self = this;
        this.suspendedMatches.forEach(function(count, elementId) {
            if(count == 1 && _self.matches.get(elementId) != 1)
                removed.push(elementId);
        });
    }

    return removed;
}

///////////////////////
// Node Mode Setting //
///////////////////////

// These functions set the mode of the function. Because the negation 
// node uses the same addMatches, removeMatches, addProjMatches and 
// removeProjMatches in all cases, these functions do nothing.
// These functions must be implemented because they are called by the
// base class when the node is unsuspended.

NegationQueryCalc.prototype.setSelectionMode = 
    negationQueryCalcSetSelectionMode;

function negationQueryCalcSetSelectionMode()
{
    return;
}

NegationQueryCalc.prototype.setProjectionMode = 
    negationQueryCalcSetProjectionMode;

function negationQueryCalcSetProjectionMode()
{
    return;
}

// Since the negation node uses the same addMatches, removeMatches, 
// addProjMatches and removeProjMatches also when suspended, the following
// function, which is called when the node is suspended, does nothing.

NegationQueryCalc.prototype.setSuspendedMode = 
	negationQueryCalcSetSuspendedMode;

function negationQueryCalcSetSuspendedMode()
{
    return;
}

// Since the negation node uses the same addMatches, removeMatches, 
// addProjMatches and removeProjMatches also when suspended, the following
// function, which is called when the node is suspended, does nothing.

NegationQueryCalc.prototype.setSuspendedProjectionMode = 
	negationQueryCalcSetSuspendedProjectionMode;

function negationQueryCalcSetSuspendedProjectionMode()
{
    return;
}

///////////////////////////////////
// Match Calculation Mode Change //
///////////////////////////////////

// This function initializes selection matching which includes the
// matches of the projection sub-nodes. If the selections of the
// projection sub-nodes are already included in the selection
// calculation, this function does not do anything. Otherwise, the
// node is suspended. Until now, each data element ID received from
// the indexer for the negation path has its count increased by 1 in
// the 'matches' table. From now on, we want this to happen only to
// element IDs matched by at least one projection. First, we decrease
// by 1 the count of every entry in the 'matches' table with an odd
// count. We then create the projSelectionMatches table. The
// matches of all the projection sub-nodes will be added by the 
// refreshMatches function, as in case matching by projection sub-nodes
// is activated, all these projection sub-nodes are marked as new. 
// In case this is the initial update, there is no need to suspend the 
// node or to update the match table. 

NegationQueryCalc.prototype.initProjSelectionMatches = 
    negationQueryCalcInitProjSelectionMatches;

function negationQueryCalcInitProjSelectionMatches()
{
    if(this.projSelectionMatches)
        return; // selections from projection subnodes already included

    this.projSelectionMatches = new Map();

    if(this.initialUpdate)
        return; // nothing more to do

    this.suspend(); // must suspend this node before applying this function

    if(this.matches === undefined)
        return; // nothing to do
    
    // decrease the count of every match with an odd value by one
    // (and if it becomes zero, delete the entry).
    this.matches.forEach(function(count, elementId) {
        if((count % 2) !== 0) {
            var newCount = count - 1;
            if(newCount == 0)
                this.matches.delete(elementId);
            else
                this.matches.set(elementId, newCount);
        }
    });
}

// This function is called when a change occurs such that before the 
// change this node had projection sub-nodes which added their selection
// matches and after this change there are no such sub-nodes anymore
// (this may be the result of the removal of the last projection node
// or its transformation in a selection node or a result of a change in 
// the 'sub-projection must add matches' property).
// This operation increases the number of matches. It gets from the indexer
// the set of element IDs at the negation path and adds these to the 
// 'matches' table as follows:
// 1. If the count in the 'matches' table is odd, there is nothing to 
//    do - this was previously matched by the projection selection 
//    matches.
// 2. If the count is even (negative, non-zero): add 1 to the count
//    (this was matched by some of the selection, so there is no match).
// 3. If there is no entry in the 'matches' table (a count of zero),
//    set the entry to 1. This is a new match.
// The new matches found in case 3 are forwarded to the match parent,
// unless the node is suspended.
// If the node is still a projection and projection is not suspended, the 
// new matches are filtered by the projection matches of the parent
// and added to the projection matches of this node.
// If this node just became a selection-projection, it must be suspended
// so no update of the projection matches needs to take place here
// (this will happen when the node is unsuspended). 
// Note: it may (very rarely) happen that the nodes received from the 
// indexer do not contain all the nodes which were previously matched by the 
// projections. However, this can only be a temporary state, in case
// some nodes were removed from the indexer but this update was not yet
// propagated. Therefore, we can soon expect these element IDs 
// to be removed by the indexer from this node. This will then correctly 
// complete the update. Therefore, this is only a temporary state (and 
// not a frequent one).

NegationQueryCalc.prototype.clearProjSelectionMatches = 
    negationQueryCalcClearProjSelectionMatches;

function negationQueryCalcClearProjSelectionMatches()
{
    if(!this.projSelectionMatches)
        return; // no selection matches from sub-projections 

    delete this.projSelectionMatches;

    // all data nodes at the negation path
    var negationUniverse = this.indexer.getAllMatches(this.pathId);
    var addedMatches = [];

    for(var i = 0, l = negationUniverse.length ; i < l ; ++i) {
        var elementId = negationUniverse[i];
        if(!this.matches.has(elementId)) {
            this.matches.set(elementId, 1);
            addedMatches.push(elementId);
        } else {
            var count = this.matches.get(elementId);
            if((count % 2) !== 0)
                continue;
            else
                this.matches.set(elementId, count + 1);
        }
    };

    if(this.isSuspended())
        return;

    if(this.isProjection()) {
        // add the added matches to the parent node (with projection update
        // disabled, as we are about to update the projections directly)
        this.disableProjUpdateAndAddMatchesToParent(addedMatches);

        // check which new matches are projection matches of the parent,
        // these are added to the projection matches of this node
        if(!this.isSuspendedProjection())
            this.addNewMatchesToProjMatches(addedMatches);
    } else if(this.shouldAddMatches())
        this.matchParent.addMatches(addedMatches, this);
}

/////////////
// Matches //
/////////////

// This is the addMatches() function for this node. This function is
// never replaced by another function (as happens on other query calculation
// nodes). When processing the added matches, this function needs to look
// at the source of the update (the 'source' argument). Having 
// determined the source of the update, this function calls the appropriate
// function to handle this update.

NegationQueryCalc.prototype.addMatches =
    negationQueryCalcAddMatches;

function negationQueryCalcAddMatches(elementIds, source)
{
    if(elementIds.length == 0)
        return;

    if(this.pendingUpdates !== undefined) { // buffer the update
        this.pendingUpdates.push({ elementIds: elementIds, source: source,
                                   isAdd: true });
        return;
    }
    
    // the source can either be the indexer or one of the sub-nodes. 
    // Among the sub-nodes, we need to distinguish between selection and
    // projection sub-nodes.

    if(source == this.indexer)
        this.addIndexerMatches(elementIds);
    else if(source.isProjection())
        this.addProjSelectionMatches(elementIds);
    else
        this.addSelectionMatches(elementIds);
}

// This is the removeMatches() function for this node. This function is
// never replaced by another function (as happens on other query calculation
// nodes). When processing the removed matches, this function needs to look
// at the source of the update (the 'source' argument). Having 
// determined the source of the update, this function calls the appropriate
// function to handle this update.
// The third argument 'isProjection' is optional. If given, this overrides
// the source.isProjection() property. This should be used during query 
// refresh when the sub-node node changed from a projection to a selection
// or the other way around but we want to remove the old matches of that
// sub-node from this node.
// The argument 'applyingPendingUpdates' is also optional. If true,
// this function is called with a pending update, so the update must be
// applied (even if there are pending removals on the indexer, as these
// were just removed now by the calling function).

NegationQueryCalc.prototype.removeMatches =
    negationQueryCalcRemoveMatches;

function negationQueryCalcRemoveMatches(elementIds, source, isProjection,
                                        applyingPendingUpdates)
{
    // the source can either be the indexer or one of the sub-nodes. 
    // Among the sub-nodes, we need to distinguish between selection and
    // projection sub-nodes.

    if(source == this.indexer)
        this.removeIndexerMatches(elementIds);
    else {

        // check whether there are removals pending on this indexer
        // for the negated path. If yes (and if they are used in
        // determining the result of the query, see the special case
        // of projections) queue this removal until those updates are
        // received (to avoid having matches added and removed)
        if(!applyingPendingUpdates &&
           (this.pendingUpdates !== undefined ||
            (!(this.isProjection() && this.mustAddMatches) &&
             this.indexer.pathHasRemovalsPending(this.pathId, this.id)))) {
            // store the update to be processed later
            if(this.pendingUpdates === undefined)
                this.pendingUpdates = [];
            this.pendingUpdates.push({ elementIds: elementIds, source: source,
                                       isProjection: isProjection,
                                       isAdd: false });
            return;
        }
        
        // source is a sub-node, determine whether we want to treat it as
        // a selection or as a projection
        if(isProjection === undefined)
            isProjection = source.isProjection();

        if(isProjection)
            this.removeProjSelectionMatches(elementIds);
        else
            this.removeSelectionMatches(elementIds);
    }
}

// This function is called to add the matches received from the indexer.
// These matches are the element IDs of new data nodes created in 
// the indexer at the negation path of this node. 'elementIds' is an
// array holding these data element IDs.
// If projection sub-nodes need to add their matches, this function 
// does nothing (as the matches are defined as the selection matches
// of the projection matches which are not matched by the selection
// sub-node matches - see introduction for more details).
// Otherwise, this function increases by 1 the count in the 'matches'
// table of every element ID in 'elementIds' whose count is even 
// (or is not in the table). We need to verify that the count is even
// because it may sometimes happen that nodes are added through this
// function which were already read by this node directly from the 
// indexer during the initial refresh of this node (this should not
// happen often, but is possible).
// Matches which have a count of 1 after this operation are new matches
// of this node. If this node adds its matches to the parent, 
// these matches are added to the parent and the projection matches
// of this node are also updated, if it is a projection node. 

NegationQueryCalc.prototype.addIndexerMatches =
    negationQueryCalcAddIndexerMatches;

function negationQueryCalcAddIndexerMatches(elementIds)
{
    if(elementIds.length == 0)
        return;
    
    if(this.isProjection() && this.mustAddMatches)
        return; // selection is determined by sub-nodes only (see introduction)

    if(this.matches === undefined) { // empty negation n(), forward the matches
        this.matchParent.addMatches(elementIds, this);
        return;
    }

    this.matches.expectSize(elementIds.length);
    
    var addedMatches = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];

        if(!this.matches.has(elementId)) {
            this.matches.set(elementId, 1);
            addedMatches.push(elementId);
        } else {
            var count = this.matches.get(elementId);
            if((count % 2) == 0)
                this.matches.set(elementId, count+1);
        }
    }

    if(addedMatches.length == 0 || this.isSuspended())
        return;

    // update the parent 
    if(this.isProjection() || this.isSelectionProjection()) { 
        // update the parent and the projection matches
        if(this.shouldAddMatches())
            this.disableProjUpdateAndAddMatchesToParent(addedMatches);
        if(!this.isSuspendedProjection())
            // update the projection matches directly
            this.addNewMatchesToProjMatches(addedMatches);
    } else // update the parent
        this.matchParent.addMatches(addedMatches, this);
}

// This function is called to remove matches received from the indexer.
// These matches are the element IDs of data nodes just removed from 
// the indexer at the negation path of this node. 'elementIds' is an
// array holding these data element IDs.
// If projection sub-nodes need to add their matches, this function 
// does nothing (as the matches are defined as the selection matches
// of the projection matches which are not matched by the selection
// sub-node matches - see introduction for more details).
// Otherwise, this function decreases by 1 the count in the 'matches'
// table of every element ID in 'elementIds' whose count is odd.
// We need to verify that the count is odd because it may sometimes 
// happen that nodes are removed through this function which were not 
// read by this node directly from the indexer during the initial refresh 
// of this node (this should not happen often, but is possible).
// Matches which have a count of 0 as a result of this operation are 
// matches of this node which should be removed. If this node adds 
// its matches to the parent, these matches are removed from the parent 
// and the projection matches of this node are also updated, if it is 
// a projection node. 

NegationQueryCalc.prototype.removeIndexerMatches =
    negationQueryCalcRemoveIndexerMatches;

function negationQueryCalcRemoveIndexerMatches(elementIds)
{
    if(elementIds.length == 0)
        return;
    
    if(this.isProjection() && this.mustAddMatches)
        return; // selection is determined by sub-nodes only (see introduction)

    if(this.matches === undefined) { // empty negation n(), forward the removal
        if(!this.isSuspended())
            this.matchParent.removeMatches(elementIds, this);
        return;
    }
    
    var removed = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        var count;

        if(this.matches.dec(elementId, 1) == 0)
            removed.push(elementId);
    }

    if(removed.length != 0 && !this.isSuspended()) {

        // update the parent 
        if(this.isProjection() || this.isSelectionProjection()) { 
            // update the parent and the projection matches
            if(this.shouldAddMatches())
                this.disableProjUpdateAndRemoveMatchesFromParent(removed);
            if(!this.isSuspendedProjection())
                // update the projection matches directly
                this.removeOldMatchesFromProjMatches(removed);
        } else // update the parent
            this.matchParent.removeMatches(removed, this);
    }

    // add/remove pending matches

    if(this.pendingUpdates !== undefined)
        this.applyPendingUpdates();
}

// This function applies all pending updates (add/remove matches) and
// clears the 'penidngUpdates' field (so that no more updates will be queued).

NegationQueryCalc.prototype.applyPendingUpdates =
    negationQueryCalcApplyPendingUpdates;

function negationQueryCalcApplyPendingUpdates()
{
    if(this.pendingUpdates === undefined)
        return;

    var updates = this.pendingUpdates;
    // remove the list before updating, to avoid the updates being queued again
    this.pendingUpdates = undefined;

    for(var i = 0, l = updates.length ; i < l ; ++i) {

        var update = updates[i];

        if(update.isAdd)
            this.addMatches(update.elementIds, update.source);
        else
            this.removeMatches(update.elementIds, update.source,
                               update.isProjection, true);
    }
}

// This function is called directly by the indexer when a path node is 
// cleared and it needs to notify the query calculation node that all 
// matches received from the indexer (at the negation path) should be
// removed.
// This function is similar to removeIndexerMatches() except that it
// it does not receive a list of matches to remove, but, instead, 
// decreases by 1 the count of each match whose count is odd. If the match 
// count drops to 0 as a result of this, a match has just beeen removed
// (these matches are then removed from the parent node or from the projection
// matches, as needed). 
// If this node is a projection node which needs to add its matches to the
// parent node, then this function does nothing, since the matches 
// are based on the selection matches of the sub-projections (these probably
// will be or were already removed). 

NegationQueryCalc.prototype.removeAllIndexerMatches =
    negationQueryCalcRemoveAllIndexerMatches;

function negationQueryCalcRemoveAllIndexerMatches()
{
    if(this.isProjection() && this.mustAddMatches)
        return; // selection is determined by sub-nodes only (see introduction)

    if(this.matches === undefined) {
        // empty negation n() removal full negation universe
        if(!this.isSuspended()) {
            var negationUniverse = this.indexer.getAllMatches(this.pathId);
            this.matchParent.removeMatches(negationUniverse, this);
        }
        return;
    }
    
    var removedMatches = [];
    var _self = this;
    
    this.matches.forEach(function(count, elementId) {

        if((count % 2) == 1) {
            if(--count == 0) {
                _self.matches.delete(elementId);
                removedMatches.push(elementId);
            } else
                _self.matches.set(elementId, count);
        }
    });

    if(removedMatches.length === 0 || this.isSuspended()) {
        // no need to update the parent, but need to flush pending updates
        if(this.pendingUpdates !== undefined)
            this.applyPendingUpdates();
        return;
    }
        
    // update the parent 
    if(this.isProjection() || this.isSelectionProjection()) { 
        // update the parent and the projection matches
        if(this.shouldAddMatches())
            this.disableProjUpdateAndRemoveMatchesFromParent(removedMatches);
        if(!this.isSuspendedProjection())
            // update the projection matches directly
            this.removeOldMatchesFromProjMatches(removedMatches);
    } else // update the parent
        this.matchParent.removeMatches(removedMatches, this);

    // add/remove pending matches

    if(this.pendingUpdates !== undefined)
        this.applyPendingUpdates();
}

// This function is called to add the matches received from a selection
// sub-node of this negation node. 'elementIds' is an array of element IDs
// which are new matches of a selection sub node. The function first 
// checks whether raising to the negation path is required. If yes,
// the data element IDs are first raised to the negation path before 
// updating the 'matches' table. For each such match (after raising), 
// we increase the count in the 'matches' table of the element ID 
// (after raising) by 2. When multiple matches are raised to the same 
// element ID, this updates the count in the 'matches' table multiple
// times. If the count in the matches table was 1 before this update,
// this is a removed match for the negation node.
// After this update, the function has a list of removed matches.
// If this node has to add matches to its parent, these matches
// are removed from the parent. If the node is a projection node, 
// the projection match update is disabled while updating the match parent.
// The projections matches are then updated directly, by removing
// the removed matches from teh projection matches (this may require
// lowering) and forwarding the updates to the projection sub-nodes.

NegationQueryCalc.prototype.addSelectionMatches =
    negationQueryCalcAddSelectionMatches;

function negationQueryCalcAddSelectionMatches(elementIds)
{
    var removedMatches = [];

    this.matches.expectSize(elementIds.length);
    
    if(this.numLowerMatchPoints) { // raising required
        var dataElements = this.indexer.getDataElements();
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId =
                dataElements.raiseToPath(elementIds[i], this.pathId);
            // increase count by 2
            if(!this.matches.has(elementId))
                this.matches.set(elementId, 2);
            else {
                var count = this.matches.get(elementId) + 2;
                this.matches.set(elementId, count);
                if(count == 3) // match count was 1 before this operation
                    removedMatches.push(elementId);
            }
        }
    } else { // no raising required
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            // increase count by 2
            if(!this.matches.has(elementId))
                this.matches.set(elementId, 2);
            else {
                var count = this.matches.get(elementId) + 2;
                this.matches.set(elementId, count);
                if(count == 3) // match count was 1 before this operation
                    removedMatches.push(elementId);
            }
        }
    }

    if(removedMatches.length == 0 || this.isSuspended())
        return;

    // update the parent 
    if(this.isProjection() || this.isSelectionProjection()) { 
        // update the parent and the projection matches
        if(this.shouldAddMatches())
            this.disableProjUpdateAndRemoveMatchesFromParent(removedMatches);
        if(!this.isSuspendedProjection())
            // update the projection matches directly
            this.removeOldMatchesFromProjMatches(removedMatches);
    } else // update the parent
        this.matchParent.removeMatches(removedMatches, this);
}

// This function is called to remove the matches received from a selection
// sub-node of this negation node. 'elementIds' is an array of element IDs
// which are matches just removed from a selection sub node. The function first 
// checks whether raising to the negation path is required. If yes,
// the data element IDs are first raised to the negation path before 
// updating the 'matches' table. For each such match (after raising), 
// we decrease the count in the 'matches' table of the element ID 
// (after raising) by 2. When multiple matches are raised to the same 
// element ID, this updates the count in the 'matches' table multiple
// times. If the count in the matches table becomes 1 after this update,
// this is an added match for the negation node.
// After this update, the function has a list of added matches.
// If this node has to add matches to its parent, these matches
// are added to the parent. If the node is a projection node, 
// the projection match update is disabled while updating the match parent.
// The projections matches are then updated directly, by adding
// the added matches to the projection matches (this may require
// lowering) and forwarding the updates to the projection sub-nodes.

NegationQueryCalc.prototype.removeSelectionMatches =
    negationQueryCalcRemoveSelectionMatches;

function negationQueryCalcRemoveSelectionMatches(elementIds)
{
    var addedMatches = [];

    if(this.numLowerMatchPoints) { // raising required
        var dataElements = this.indexer.getDataElements();
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId =
                dataElements.raiseToPath(elementIds[i], this.pathId);
            // decrease count by 2
            if(this.matches.dec(elementId, 2) == 1)
                // became a match
                addedMatches.push(elementId);
        }
    } else { // no raising required
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            // decrease count by 2
            if(this.matches.dec(elementId, 2) == 1)
                // became a match
                addedMatches.push(elementId);
        }
    }

    if(addedMatches.length == 0 || this.isSuspended())
        return;

    // update the parent 
    if(this.isProjection() || this.isSelectionProjection()) { 
        // update the parent and the projection matches
        if(this.shouldAddMatches())
            this.disableProjUpdateAndAddMatchesToParent(addedMatches);
        if(!this.isSuspendedProjection())
            // update the projection matches directly
            this.addNewMatchesToProjMatches(addedMatches);
    } else // update the parent
        this.matchParent.addMatches(addedMatches, this);
}

// This function is called to add the selection matches received from 
// a projection sub-node of this negation node. This should only be called
// if the projection sub-nodes have to add their matches, but this is
// checked again by the function. 'elementIds' is an array of element IDs
// which are new selection matches of a projection sub node. The function first 
// checks whether raising to the negation path is required. If yes,
// the data element IDs are first raised to the negation path before 
// updating the 'matches' table. For each such match (after raising), 
// we increase the count in the 'projSelectionMatches' table of the element ID 
// (after raising) by 1. When multiple matches are raised to the same 
// element ID, this updates the count in the 'projSelectionMatches' table 
// multiple times. If the count in 'projSelectionMatches' just became 1, 
// the count of the element in the 'matches' table is increased by 1.
// If the count in the 'matches' table just became 1 as a result of this,
// the element ID is a new match of the negation node.
// After this update, the function has a list of added matches.
// These matches are added to the parent. 
// The projection match update is disabled while updating the match parent.
// The projections matches are then updated directly, by adding
// the added matches from the projection matches (this may require
// lowering) and forwarding the updates to the projection sub-nodes.

NegationQueryCalc.prototype.addProjSelectionMatches =
    negationQueryCalcAddProjSelectionMatches;

function negationQueryCalcAddProjSelectionMatches(elementIds)
{
    if(!this.mustAddMatches)
        return; // no need to add selection matches from projections

    this.matches.expectSize(elementIds.length);
    
    var addedMatches = [];

    if(this.numLowerMatchPoints) { // raising required
        var dataElements = this.indexer.getDataElements();
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId =
                dataElements.raiseToPath(elementIds[i], this.pathId);
            // increase count
            if(!this.projSelectionMatches.has(elementId)) {
                this.projSelectionMatches.set(elementId, 1);
                // add to matches
                if(!this.matches.has(elementId)) {
                    this.matches.set(elementId, 1);
                    addedMatches.push(elementId);
                } else
                    this.matches.set(elementId,
                                     this.matches.get(elementId) + 1);
            } else {
                this.projSelectionMatches.
                    set(elementId, this.projSelectionMatches.get(elementId)+1);
            }
        }
    } else { // no raising required
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            // increase count
            if(!this.projSelectionMatches.has(elementId)) {
                this.projSelectionMatches.set(elementId, 1);
                // add to matches
                if(!this.matches.has(elementId)) {
                    this.matches.set(elementId, 1);
                    addedMatches.push(elementId);
                } else
                    this.matches.set(elementId,
                                     this.matches.get(elementId) + 1);
            } else {
                this.projSelectionMatches.
                    set(elementId, this.projSelectionMatches.get(elementId)+1);
            }
        }
    }

    if(addedMatches.length == 0 || this.isSuspended())
        return;

    // update the parent and the projection matches (this must be a projection,
    // though the projection may be suspended)

    if(this.shouldAddMatches())
        this.disableProjUpdateAndAddMatchesToParent(addedMatches);
    if(!this.isSuspendedProjection())
        // update the projection matches directly
        this.addNewMatchesToProjMatches(addedMatches);
}

// This function is called to remove the selection matches received from 
// a projection sub-node of this negation node. This should only be called
// if the projection sub-nodes have to add their matches, but this is
// checked again by the function. 'elementIds' is an array of element IDs
// which were just removed from the selection matches of a projection 
// sub node. The function first checks whether raising to the negation path 
// is required. If yes, the data element IDs are first raised to the negation 
// path before updating the 'matches' table. For each such match (after 
// raising), we decrease the count in the 'projSelectionMatches' table of 
// the element ID (after raising) by 1. When multiple matches are raised 
// to the same element ID, this updates the count in 
// the 'projSelectionMatches' table multiple times. If the count in 
// 'projSelectionMatches' drops to 0, the count of the element in the 
// 'matches' table is decreased by 1. If the count in the 'matches' table 
// just became 0 as a result of this, the element ID has just stopped being 
// a new match of the negation node.
// After this update, the function has a list of removed matches.
// These matches are removed from the parent. 
// The projection match update is disabled while updating the match parent.
// The projections matches are then updated directly, by removing
// the removed matches from the projection matches (this may require
// lowering) and forwarding the updates to the projection sub-nodes.

NegationQueryCalc.prototype.removeProjSelectionMatches =
    negationQueryCalcRemoveProjSelectionMatches;

function negationQueryCalcRemoveProjSelectionMatches(elementIds)
{
    if(!this.mustAddMatches)
        return; // no need to add selection matches from projections

    var removedMatches = [];

    if(this.numLowerMatchPoints) { // raising required
        var dataElements = this.indexer.getDataElements();
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId =
                dataElements.raiseToPath(elementIds[i], this.pathId);
            // decrease count
            var count = this.projSelectionMatches.get(elementId) - 1;
            if(count == 0) {
                this.projSelectionMatches.delete(elementId);
                // remove from matches
                var matchCount = this.matches.get(elementId) - 1;
                if(matchCount == 0) {
                    this.matches.delete(elementId);
                    removedMatches.push(elementId);
                } else
                    this.matches.set(elementId, matchCount);
            } else
                this.projSelectionMatches.set(elementId, count);
        }
    } else { // no raising required
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            // decrease count
            var count = this.projSelectionMatches.get(elementId) - 1;
            if(count == 0) {
                this.projSelectionMatches.delete(elementId);
                // remove from matches
                var matchCount = this.matches.get(elementId) - 1;
                if(matchCount == 0) {
                    this.matches.delete(elementId);
                    removedMatches.push(elementId);
                } else
                    this.matches.set(elementId, matchCount);
            } else
                this.projSelectionMatches.set(elementId, count);
        }
    }

    if(removedMatches.length == 0 || this.isSuspended())
        return;

    // update the parent and the projection matches (this must be a projection,
    // but projection matching may be suspended)

    if(this.shouldAddMatches())
        this.disableProjUpdateAndRemoveMatchesFromParent(removedMatches);
    if(!this.isSuspendedProjection())
        // update the projection matches directly
        this.removeOldMatchesFromProjMatches(removedMatches);
}

// This function should be called when this node has a match parent
// and we wish to add matches to that match parent without this 
// operation recursively updating the projection matches of this node.
// This should be used in cases where the calling function is responsible
// for updating the projection matches of the node.

NegationQueryCalc.prototype.disableProjUpdateAndAddMatchesToParent = 
	negationQueryCalcDisableProjUpdateAndAddMatchesToParent;

function negationQueryCalcDisableProjUpdateAndAddMatchesToParent(matches)
{
    if(matches.length == 0)
        return; // nothing to do

    if(this.isSuspendedProjection()) // already suspended
        this.matchParent.addMatches(matches, this);
    else { 
        // mark as suspended (this will disable the projection update)
        // and remove this suspension immediately after adding matches 
        this.projectionSuspended = true;
	    this.matchParent.addMatches(matches, this);
        this.projectionSuspended = undefined;
    }
}

// This function should be called on a node which has a match parent
// with the list (array) of matches just removed from this node.
// This function then calls the 'removeMatches' function of the parent node.
// However, before doing so, it disabled the 'removeProjMatches' of this node
// (which may already be disabled) so that projection matches removed
// from the parent node will not be removed recursively by the parent.
// This function should be called in cases where this node handles the 
// removal of its projection matches by itself (based on the matches removed). 

NegationQueryCalc.prototype.disableProjUpdateAndRemoveMatchesFromParent = 
	negationQueryCalcDisableProjUpdateAndRemoveMatchesFromParent;

function 
negationQueryCalcDisableProjUpdateAndRemoveMatchesFromParent(removedMatches)
{
    if(!removedMatches.length)
        return; // nothing to remove

    if(this.isSuspendedProjection()) // already suspended
        this.matchParent.removeMatches(removedMatches, this);
    else {
        // mark as suspended (this will disable the projection update)
        // and remove this suspension immediately after adding matches 
        this.projectionSuspended = true;
	    this.matchParent.removeMatches(removedMatches, this);
        this.projectionSuspended = undefined;
    }
}

////////////////////////
// Projection Matches //
////////////////////////

// This is the addProjMatches() function for this node. This function is
// never replaced by another function (as happens on other query calculation
// nodes).
// When projection is suspended, this function returns immediately.
// This function is called by the parent match node with a list (array) of new
// projection matches just added to the parent node (for the given 
// result node). This function then extracts from this list those
// element IDs which are selection matches on this node. These matches
// are then lowered (if necessary) and added to this node's projection
// matches (for the given result ID). The new projection matches on this
// node are then forwarded to the projection sub-nodes.

NegationQueryCalc.prototype.addProjMatches = 
    negationQueryCalcAddProjMatches;

function negationQueryCalcAddProjMatches(elementIds, resultId)
{
    if(this.isSuspendedProjection())
        return;

    var added = [];

    // find those projection matches of the parent node which are also
    // matches on this node.
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(this.matches.get(elementId) == 1)
            added.push(elementId);
    }
    
    if(this.isProjection()) {
        // lower the projection matches, as necessary, add them to the
        // projection matches of this node and forward to the projection
        // sub-nodes.
        added = this.lowerProjMatchesAndAdd(added, resultId);
        // add all element IDs to the projection sub-nodes
        for(var id in this.projSubNodes)
            this.projSubNodes[id].addProjMatches(added, resultId);
    } else // selection projection
        this.addSelectionProjMatches(added, resultId);
}

// This is the removeProjMatches() function for this node. This function is
// never replaced by another function (as happens on other query calculation
// nodes).
// When projection is suspended, this function returns immediately.
// This function is called by the parent match node with a list (array) of
// projection matches just removed from the parent node (for the given 
// result node). This function then extracts from this list those
// element IDs which are selection matches on this node. These matches
// are then lowered (if necessary) and removed from this node's projection
// matches (for the given result ID). The removed projection matches on this
// node are then forwarded to the projection sub-nodes.

NegationQueryCalc.prototype.removeProjMatches = 
    negationQueryCalcRemoveProjMatches;

function negationQueryCalcRemoveProjMatches(elementIds, resultId)
{
    if(this.isSuspendedProjection())
        return;

    var removed = [];

    // find those element IDs in the lsit which are also
    // matches on this node.
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(this.matches.get(elementId) == 1)
            removed.push(elementId);
    }

    if(this.isProjection())
        // lower the projection matches, as necessary, remove them from the
        // projection matches of this node and forward to the projection
        // sub-nodes.
        this.lowerAndRemoveProjMatches(removed, resultId);
    else // selection projection
        // raise, update the projMatches and forward to the result node
        this.removeSelectionProjMatches(removed, resultId);
}

// This function is called on a projection or selection-projection
// node and receives a list of selection matches which were just added
// to this node. This function then goes over all result nodes and
// filters these matches against the projection matches of the parent
// node (for each result ID). The set of element IDs which are the
// result of this filtering is added to the projection matches of this
// negation node and forwarded to the projection sub-nodes (if this is
// a projection) or to the result node (if this is a
// selection-projection).

NegationQueryCalc.prototype.addNewMatchesToProjMatches = 
    negationQueryCalcAddNewMatchesToProjMatches;

function negationQueryCalcAddNewMatchesToProjMatches(elementIds)
{
    var _self = this;
    
    this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                          resultId) {
        
        var projMatches = 
            _self.matchParent.filterProjMatches(elementIds, resultId);
        
        if(_self.isProjection()) {
            projMatches = _self.lowerProjMatchesAndAdd(projMatches, resultId);
            // add all element IDs to the projection sub-nodes
            for(var id in _self.projSubNodes)
                _self.projSubNodes[id].addProjMatches(projMatches, resultId);
        } else // selection-projection
            _self.addSelectionProjMatches(projMatches, resultId);
    });
}

// This function receives a list of element IDs which are known to 
// be both in the matches of this node and in the projection matches
// of the parent node for the given result ID (if it restricts the projection).
// It is assumed that these element IDs did not previously fulfill
// this condition (that is, they are either new matches on this node
// or new projection matches on the parent).
// This function checks whether the lowering of projection matches is
// required. If yes, the function performs lowering and appends the lowered
// projection matches at the end of 'elementIds'. Only non-lowered
// element IDs are added to this.projMatches. The function returns 
// 'elementIds'.

NegationQueryCalc.prototype.lowerProjMatchesAndAdd = 
    negationQueryCalcLowerProjMatchesAndAdd;

function negationQueryCalcLowerProjMatchesAndAdd(elementIds, resultId)
{
    var thisProjMatches = this.getProjMatchesEntry(resultId);

    // add to the projMatches table
    for(var i = 0, l = elementIds.length ; i < l ; ++i)
        thisProjMatches.set(elementIds[i], 1);
    
    if(this.projMatchPoints === undefined || this.projMatchPoints.size === 0)
        return elementIds;

    return this.lowerToProjMatchPoints(elementIds, this.projMatchPoints);
}

// This function is called on a projection or selection-projection node 
// and receives a list of
// selection matches which were just removed from this node. This function
// then goes over all result nodes and filters these matches against 
// the projection matches of the parent node (for each result ID). 
// The set of element IDs which are the result of this intersection 
// is removed from the projection matches of this negation node and 
// the removal is forwarded to the projection sub-nodes (if this is
// a projection) or to the result node (if this is a
// selection-projection).

NegationQueryCalc.prototype.removeOldMatchesFromProjMatches = 
    negationQueryCalcRemoveOldMatchesFromProjMatches;

function negationQueryCalcRemoveOldMatchesFromProjMatches(elementIds)
{
    var _self = this;
    
    this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                          resultId) {
        var projMatches = 
            _self.matchParent.filterProjMatches(elementIds, resultId);

        if(_self.isProjection())
            _self.lowerAndRemoveProjMatches(projMatches, resultId);
        else // selection-projection
            _self.removeSelectionProjMatches(projMatches, resultId);
    });
}

// This function receives a list of element IDs which are known to 
// have just been removed from the intersection of the matches of this node 
// and the projection matches of the parent node (if the parent node
// restricts the projection).
// This function checks whether the lowering of projection matches is
// required. If yes, the function performs lowering. Non-lowered 
// elements are removed from the this.projMatches table, but all element IDs
// (before and after lowering) are then removed from the projection 
// sub-nodes.

NegationQueryCalc.prototype.lowerAndRemoveProjMatches = 
    negationQueryCalcLowerAndRemoveProjMatches;

function negationQueryCalcLowerAndRemoveProjMatches(elementIds, resultId)
{
    var thisProjMatches = this.getProjMatchesEntry(resultId);
    var origLength = elementIds.length;

    if(this.projMatchPoints === undefined || this.projMatchPoints.size === 0) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i)
            thisProjMatches.delete(elementIds[i]);
    } else {

        // remove these element IDs from the projection matches stored here
        // (only non-lowered element IDs are stored here, so this takes
        // place before any lowering below).
        for(var i = 0, l = elementIds.length ; i < l ; ++i)
            thisProjMatches.delete(elementIds[i]);

        // lower the matches before forwarding this to sub-queries
        // (the lowered element IDs are appended at the end of the array
        // and will be removed at the end).
        var projMatchPoints = [];
        this.projMatchPoints.forEach(function(count, pathId) {
            projMatchPoints.push(pathId);
        });
        var dataElements = this.indexer.getDataElements();
        elementIds = dataElements.lowerDataElementsTo(elementIds,
                                                      projMatchPoints);
    }

    // remove all element IDs from the projection sub-nodes
    for(var id in this.projSubNodes)
        this.projSubNodes[id].removeProjMatches(elementIds, resultId);
    
    // reset the length of the array (in case lowering took place)
    elementIds.length = origLength;
}


/////////////////////////////////
// Clearing Projection Matches //
/////////////////////////////////

// This function resets the projection matches of this negation
// query calculation node after a (projection) sub-node has been removed. 
// This is used when the node was a projection node and now became 
// a selection node (as the result of removing a projection sub-node 
// dominated by this negation node). If the flag 'subProjAddedMatches' 
// is true, the projection sub-nodes of this node had to add their selection 
// matches (before this change). This function then calls 
// 'clearProjSelectionMatches()' which changes the selection
// match calculation from one which requires matching by the projections
// to one that does not. This results in added matches, which are 
// immediately forwarded to the parent (if the node is not suspended).
// It may be that this node just became a selection-projection. This 
// function checks whether the node is a generating projection and, if it
// is, initializes its projection matches based on the selection matches.
// These are then forwarded to the result nodes.

NegationQueryCalc.prototype.resetProjMatchesAfterNodeRemoval = 
    negationQueryCalcResetProjMatchesAfterNodeRemoval;
    
function negationQueryCalcResetProjMatchesAfterNodeRemoval(subProjAddedMatches)
{
    if(!this.isGeneratingProjection())
        this.projMatches = undefined;
    else { // this became a selection-projection
        this.initEmptyProjMatches();
        // suspend projection calculation (will unsuspended later)
        this.suspendProjection();
    } 

    if(subProjAddedMatches)
        this.clearProjSelectionMatches();
}

///////////////////////
// Access to Matches //
///////////////////////

// This function returns an array with data element IDs of all selection
// matches of this node. These are the data elements with count 1. 

NegationQueryCalc.prototype.getMatches = negationQueryCalcGetMatches;

function negationQueryCalcGetMatches()
{
	var matches = [];

    // when the node is suspended, we return the suspended matches
    if(this.suspendedMatches) {
        this.suspendedMatches.forEach(function(count, elementId) {
            matches.push(elementId);
        });
        return matches;
    }

    if(this.matches === undefined) {

        if(this.initialUpdate)
            return []; // no matches added yet
        
        // empty negation n(), get matches from indexer
        return this.indexer.getAllMatches(this.pathId);
    }
    
    this.matches.forEach(function(count, elementId) {
		if(count == 1)
			matches.push(elementId);
	});
		
	return matches;
}

// This function is identical to 'getMatches' except that it returns
// the matches as a Map object whose keys are the matches.

NegationQueryCalc.prototype.getMatchesAsObj = negationQueryCalcGetMatchesAsObj;

function negationQueryCalcGetMatchesAsObj()
{
    // when the node is suspended, we return the suspended matches
    if(this.suspendedMatches)
        return this.suspendedMatches;

    if(this.matches === undefined) {

        if(this.initialUpdate)
            return new Map(); // no matches added yet
        
        // empty negation n(), get matches from indexer
        return this.indexer.getAllMatchesAsObj(this.pathId);
    }
    
	var matches = new Map();

    this.matches.forEach(function(count, elementId) {
        if(count == 1)
			matches.set(elementId, 1);
	});
		
	return matches;
}

// This function returns an array with data element IDs of all 
// data elements with a match on this node which are
// also higher (or at) the root node's prefix path (these are matches
// which do not need to be raised any further). If the match points on
// the node indicate that no raising is necessary, the function simply
// calls 'getMatches'. Otherwise, the function must go over all matches
// and check the match count and the match point of each element and
// return only those elements which have a short enough path and a match
// count of 1. In case this node is suspended, this function must go over 
// the suspended matches and check their path. 

NegationQueryCalc.prototype.getFullyRaisedMatches =
    negationQueryCalcGetFullyRaisedMatches;

function negationQueryCalcGetFullyRaisedMatches()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatches();

    var matches = [];
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    if(this.suspendedMatches) {
        this.suspendedMatches.forEach(function(count, elementId) {
            if(dataElements.getPathId(elementId) <= prefixPathId)
                matches.push(elementId);
        });
    } else if(this.matches === undefined) {

        if(this.initialUpdate)
            return []; // no matches added yet
        
        // empty negation n(), get matches from indexer
        var negationUniverse = this.indexer.getAllMatches(this.pathId);
        for(var i = 0, l = negationUniverse.length ; i < l ; ++i) {
            var elementId = negationUniverse[i];
            if(dataElements.getPathId(elementId) <= prefixPathId)
                matches.push(elementId);
        }
    } else {
        this.matches.forEach(function(count, elementId) {
            if(count == 1 && dataElements.getPathId(elementId) <= prefixPathId)
                matches.push(elementId);
        });
    }
		
    return matches;
}

// This function is identical to 'getFullyRaisedMatches' except that it returns
// the matches as a Map object whose keys are the matches.

NegationQueryCalc.prototype.getFullyRaisedMatchesAsObj =
    negationQueryCalcGetFullyRaisedMatchesAsObj;

function negationQueryCalcGetFullyRaisedMatchesAsObj()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatches();

    var matches = new Map();
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    if(this.suspendedMatches) {
        this.suspendedMatches.forEach(function(count, elementId) {
            if(dataElements.getPathId(elementId) <= prefixPathId)
                matches.set(elementId, 1);
        });
    } else if(this.matches === undefined) {

        if(this.initialUpdate)
            return new Map(); // no matches added yet
        
        // empty negation n(), get matches from indexer
        var negationUniverse = this.indexer.getAllMatches(this.pathId);
        for(var i = 0, l = negationUniverse.length ; i < l ; ++i) {
            var elementId = negationUniverse[i];
            if(dataElements.getPathId(elementId) <= prefixPathId)
                matches.set(elementId, 1);
        }
    } else {
        this.matches.forEach(function(count, elementId) {
            if(count == 1 && dataElements.getPathId(elementId) <= prefixPathId)
                matches.set(elementId, 1);
        });
    }
		
    return matches;
}

// This fuction receives as input a list (array) of data element IDs
// and returns (in a new array) the subset of element IDs which are
// selection matches on this query calculation node. 
// In case the node is suspended, this function checks which of the 
// elements in the given list is in the suspendedMatches list.

NegationQueryCalc.prototype.filterMatches = 
    negationQueryCalcFilterMatches;

function negationQueryCalcFilterMatches(elementIds)
{
    var matches = [];
    
    if(this.suspendedMatches) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.suspendedMatches.has(elementId))
                matches.push(elementId);
        }
    } else if(this.matches === undefined) {

        if(this.initialUpdate)
            return []; // no matches added yet
        
        // empty negation n(), filter against the indexer
        return this.indexer.filterDataNodesAtPath(this.pathId, elementIds);
    } else {

        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.matches.get(elementId) == 1)
                matches.push(elementId);
        }
    }

    return matches;
}

// This function receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are selection matches on this query calculation node. 
// In case the node is suspended, this function checks which of the 
// elements in the given list is in the suspendedMatches list.
// This function is similar to 'filterMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

NegationQueryCalc.prototype.filterMatchPositions = 
    negationQueryCalcFilterMatchPositions;

function negationQueryCalcFilterMatchPositions(elementIds)
{
    var positions = [];
    
    if(this.suspendedMatches) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.suspendedMatches.has(elementId))
                positions.push(i);
        }
    } else if(this.matches === undefined) {

        if(this.initialUpdate)
            return []; // no matches added yet
        
        // the empty negation n(), filter against the indexer
        return this.indexer.filterDataNodesAtPathPositions(this.pathId,
                                                           elementIds);
    } else {

        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.matches.get(elementId) == 1)
                positions.push(i);
        }
    }

    return positions;
}

// Returns an array with the projection matches of this node. If there
// are no pure projection match points, this simply returns the
// section for the given result node in the projMatches
// table. Otherwise, the projection matches stored in this.projMatches
// (for the given result node) must first be lowered to the pure
// projection match points. The function then returns both the element
// IDs found in this.projMatches and the lowered matches.  The result
// of this function is returned as an array of element IDs.

NegationQueryCalc.prototype.getProjMatches = 
	negationQueryCalcGetProjMatches;

function negationQueryCalcGetProjMatches(resultId)
{
    var thisProjMatches;

    if(!this.projMatches || !(thisProjMatches = this.projMatches.get(resultId)))
        return undefined;

    var projMatches = []; // convert into an array

    thisProjMatches.forEach(function(count, elementId) {
        projMatches.push(elementId);
    });
    if(this.projMatchPoints === undefined || this.projMatchPoints.size === 0)
        return projMatches; // no lowering required
    
    // lower the matches in the array
    return this.lowerToProjMatchPoints(projMatches, this.projMatchPoints);
}

// This function receives a list of matches from a projection sub-node and
// returns the subset of these matches which are also projection matches
// on this node. If this node has no projection match points,
// it is enough to check for each match whether it is in the projMatches
// table of this node. If projection match points exist, we need
// to check for matches from these match points whether they can be
// raised to a match in this.projMatches.  

NegationQueryCalc.prototype.filterProjMatches = 
	negationQueryCalcFilterProjMatches;

function negationQueryCalcFilterProjMatches(matches, resultId)
{
    var projMatches = [];
    var thisProjMatches;
    
    if(!this.projMatches || !(thisProjMatches = this.projMatches.get(resultId)))
        return projMatches; // empty set

    // If there are no projection matches and in case the node is 
    // suspended, all projection matches are in this.projMatches.
    if(this.projMatchPoints === undefined || this.projMatchPoints.size === 0 ||
       this.isSuspendedProjection()) {
        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var elementId = matches[i];
            if(thisProjMatches.has(elementId))
                projMatches.push(elementId);
        }
    } else {
        
        var dataElements = this.indexer.getDataElements();

        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var elementId = matches[i];
            if(thisProjMatches.has(elementId))
                projMatches.push(elementId);
            else {
                var raisedId = elementId; // before raising
                var elementEntry;
                while(this.projMatchPoints.has(
                    (elementEntry =
                     dataElements.getEntry(elementId)).pathId)) {
                    if(thisProjMatches.has(elementId = elementEntry.parent)) {
                        projMatches.push(raisedId);
                        break;
                    }
                }
            }
        }
    }

    return projMatches;
}
