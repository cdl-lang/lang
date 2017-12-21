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

// This object extends the base class InternalQueryCalc for union
// nodes. A union node matches any node matched by any of its sub-nodes.
// When any of the sub-nodes of a union node is a projection, all
// sub-nodes of the union node need to project. For selection 
// sub-nodes, this means that they become selection-projections.
// A selection-projection projects those elements which it selects
// and which are in the projection selections of its parent node.
// These projection selections must then be raised to the prefix path
// of the query. See introduction to internalQueryCalc.js for more details.
//
// Implementation
// ==============
//
// The implementation of the union query calculation node is straight forward
// because it mainly propagates updates it receives from its sub-nodes
// to its parent node and updates it receives from its parent node to
// its sub-nodes. The only thing the union node needs to make sure is
// that it does not forward the same update twice (for example, if two
// sub-nodes add the same match, this match needs to be forwarded only
// once to the parent node).
//
// The union node does not need to perform any raising (of matches)
// or lowering (of projection matches). All necessary raising and lowering
// happens already on the sub-nodes or parent node. For example, 
// since all match points of the sub-nodes are also match points
// of the union node, the parent node can already lower projection matches
// to the match points required by the sub-nodes of the union.
//
// All match points added by the sub-nodes are added to the matchPoint
// table of this node, with a counter indicating the number of sub-nodes
// from which the match points were received (to allow for correct removal).
// Each match point is added once to the parent node.  
//
// Similarly, all matches received from the sub-nodes are added to
// the 'matches' table, with a count. Each match is forwarded once
// to the parent node. Note that if the union node is a projection and 
// does not need to forward its selections then its sub-nodes also do not
// need to forward their selections, so the union node will not receive
// any match updates.
//
// The union node does not need to maintain any projection matches.
// Its projection matches are simply identical to the projection matches
// of its parent. The filterProjMatches() function of the union node
// simply calls the filterProjMatches() function of the parent node.
// addProjMatches() and removeProjMatches() calls are simply forwarded
// to all sub-nodes (there is no need for a count here, as there is 
// only one parent node).
//
// When the type of a union node changes (between projection and selection)
// its selection sub-nodes need switch between selection-projection and
// selection. It is the responsibility of the union node to indicate
// to the sub-nodes that this has happened. 
//
// 
// Object Structure
// ================
//
// {
//    matches: <Map object>: {
//       <data element ID>: <count>
//       .......
//    }
//
//    matchPoints: <Map>{
//       <path node ID>: <count>
//       ........
//    }
//
//    projSubNodes: {
//        <query calc ID>: <InternalQueryCalc>,
//        ......
//    },
//    projSubNodeNum: <number of sub-projections>
//
//    // refresh fields
//    
//    justBecameProjection: true|undefined
//    justStartedAddingMatches: true|undefined
// }
//
// matches: this holds all matches received from sub-nodes. In a union
//    node, either all sub-nodes need to add their matches or none has
//    to add its matches. For each match, the table maintains a count
//    of the number of sub-nodes it was received from. Each match is 
//    forwarded once to the parent node.
//
// matchPoints: this table holds all match points (path IDs) received
//    from the sub-nodes. For each match point, the table holds the count
//    of the number of sub-nodes from which it was received. Each match
//    point is forwarded once to the parent node.
//
// projSubNodes: This is the list of sub-nodes which are projections.
// projSubNodeNum: number of elements in 'projSubNodes'.
//
// justBecameProjection: this flag is set to true during the refresh
//    process when the union node just became a projection and is not
//    dominated by a generating projection node. This is set during 
//    the structural refrsh step to indicate to the match
//    update step that it should initialize projection calculation 
//    on selection sub-nodes of the union node which were not modified 
//    (and therefore will not be otherwise refreshed). This is only done
//    if the node is not dominated by a generating projection node
//    because in case of domination by a generating projection node
//    the selection projection nodes under the union are not generating
//    projections and there is no need to calculate their projection matches. 
//
// justStartedAddingMatches: this flag is set to true during the refresh
//    process on a projection union node when as a result of the query refresh
//    the union node now needs to add its matches to the dominating node and,
//    as a result, the sub-nodes need to add their matches to the union node.
//    This flag is set during the structural stage of the refresh and is 
//    used to determine the match update required in the match refresh
//    step. This flag is removed at the end of the query refresh.
//
//    Note: the justBecameProjection and justStartedAddingMatches flags
//    are mutually exclusive because justBecameProjection is set only if
//    the node is not dominated by a generating projection node which 
//    is iff the union node does not need to add its matches (a dominating
//    generating projection node must be an intersection with multiple
//    projection sub-nodes).


// %%include%%: "internalQueryCalc.js"

inherit(UnionQueryCalc, InternalQueryCalc);

//
// Constructor
//

// The constructor takes one argument: the root query calculation node
// which created it.

function UnionQueryCalc(rootQueryCalc)
{
	// call base constructor
	this.InternalQueryCalc(rootQueryCalc);
    // initialize to store counts which fit in 1 byte (may be modified later)
    this.matches = new IntHashMapUint(0);
}

// destruction function (most work takes place in the base class)

UnionQueryCalc.prototype.destroy = unionQueryCalcDestroy;

function unionQueryCalcDestroy()
{
	// base class destroy (this also detaches from the root query calculation
    // node if this is the top query calculation node)
	this.InternalQueryCalc_destroy();
}

// This function is called when the union node has only one sub-node 
// left. It then attaches the sub-node of the union node where the 
// union node was previously attached. This should be entirely transparent
// to the parent node, a union node with a single sub-node is logically
// identical to that sub-node. Therefore, the replacement takes place
// without any refresh to the sub-node under the union or the parent node
// of the union.
// This function is called by the query compiler. It is up to the compiler
// to make sure this function is only called when it has a single sub-node
// under it (also zero sub-nodes are allowed, but not more than 1 sub-node).

UnionQueryCalc.prototype.splice = unionQueryCalcSplice;

function unionQueryCalcSplice()
{
    // get the single sub-node
    var subNode;
    var subNodeId;
    var id = this.getId(); // ID of this union node
    
    for(subNodeId in this.subNodes)
        subNode = this.subNodes[subNodeId];

    if(!subNode)
        this.destroy();

    subNode.matchParent = this.matchParent;
    subNode.parent = this.parent;

    if(this.matchParent == this.rootQueryCalc)
        // spliced from under the root query calculation node
        this.rootQueryCalc.queryCalc = subNode;
    else {
        // splice from under a query calculation node
        delete this.matchParent.subNodes[id];
        this.matchParent.subNodes[subNodeId] = subNode;
        if(this.matchParent.projSubNodes[id]) {
            delete this.matchParent.projSubNodes[id];
            this.matchParent.projSubNodes[subNodeId] = subNode;
        }
    }

    this.destroy();
}

///////////////////////////////
// Property Access Functions //
///////////////////////////////

// Returns true if this node is a projection node (but not a 
// selection-projection node) and false otherwise.

UnionQueryCalc.prototype.isProjection = unionQueryCalcIsProjection;

function unionQueryCalcIsProjection()
{
	return (!!this.projSubNodeNum);
}

// This function returns true, because this is a union node.

UnionQueryCalc.prototype.isUnion = unionQueryCalcIsUnion;

function unionQueryCalcIsUnion()
{
	return true;
}

// This function returns true if this node needs to add its selection
// matches to its match parent. This returns 'false' (no need to add
// the matches) only if this is a projection and the this.mustAddMatches 
// property is not true.

UnionQueryCalc.prototype.shouldAddMatches = 
	unionQueryCalcShouldAddMatches;

function unionQueryCalcShouldAddMatches()
{
    return (!this.isProjection() || this.mustAddMatches);
}

// A union node is never a generating projection node

UnionQueryCalc.prototype.isGeneratingProjection = 
	unionQueryCalcIsGeneratingProjection;

function unionQueryCalcIsGeneratingProjection()
{
    return false;
}

// A union node is never a selection-projection node

UnionQueryCalc.prototype.isSelectionProjection = 
	unionQueryCalcIsSelectionProjection;

function unionQueryCalcIsSelectionProjection()
{
    return false;
}

//////////////////
// Match Points //
//////////////////

// This function is called by a sub-query when a match point (path ID)
// is added to that sub-query. 'source' is the 'this' pointer of the object
// which called this function.
// This function increments by 1 the count of this match point in 
// the 'matchPoints' table. If the count just became 1, the match point
// is forwarded to the parent node.

UnionQueryCalc.prototype.addToMatchPoints = 
	unionQueryCalcAddToMatchPoints;

function unionQueryCalcAddToMatchPoints(pathId, source)
{
    if(!this.matchPoints.has(pathId)) {
        this.matchPoints.set(pathId, 1);
        this.matchParent.addToMatchPoints(pathId, this);
    } else {
        var count = this.matchPoints.get(pathId) + 1;
        this.matchPoints.set(pathId, count);
    }
}

// This function is called by a sub-query when a match point (path ID)
// is removed from that sub-query. 'source' is the 'this' pointer of the object
// which called this function.
// This function decrements by 1 the count of this match point in 
// the 'matchPoints' table. If the count just became 0, the match point
// is removed from the parent node.

UnionQueryCalc.prototype.removeFromMatchPoints = 
	unionQueryCalcRemoveFromMatchPoints;

function unionQueryCalcRemoveFromMatchPoints(pathId, source)
{
    var count = this.matchPoints.get(pathId) - 1;
    if(count === 0) {
        this.matchPoints.delete(pathId);
        this.matchParent.removeFromMatchPoints(pathId, this);
    } else
        this.matchPoints.set(pathId, count);
}

///////////////////////
// Sub-Query Removal //
///////////////////////

// The following functions handle the update of the union node when 
// a node is removed from the query structure. If the node removed is
// a sub-node of the union node, the union node must remove the 
// match points and matches received from that sub-node. In addition, 
// if the removed sub-node was the last projection sub-node under the 
// union, the union node changes from a project to  a selection.
// In this case, it needs to propagate this update to the parent node
// and must notify its selection sub-nodes that they are no longer 
// selection-projections (but standard selections).
//
// Similarly, it may be that, as a result of the removal of a lower 
// projection node, a sub-node of the union changed from a projection
// into a selection. This should be handled in a way similar to the
// removal of the last projection sub-node under a union node.

//

// This function is called when a sub-node was removed from the query
// structure. 'subNode' is a sub-node of this node such that either 
// 'subNode' is the node removed (it is then no longer found in 
// this.subNodes) or it is the sub-node under which the removal took
// place. In the second case, the removed node must have been
// a projection node (otherwise its removal would have had no direct 
// consequences for this node).
//
// First, this function must update the structure of the node, 
// removing the sub-node (if it was a projection) from the this.projSubNodes
// table. If this resulted in the removal of the last projection sub-node,
// this function has to notify the parent node (that the union node
// changed from a projection into a selection) and all its remaining
// sub-node (which were selection-projection and now became selections).
//
// After notifying the other nodes of the structural changes, this function
// updates the matching (match points and matches). If subNode was actually
// removed, it removes its match points and matches from the union node.
// If the union node changed from a projection to a selection and the 
// sub-nodes did not previously have to add their matches, the union node
// reads the selection matches from all its sub-nodes. This happens before
// the sub-node updates its own match points and matches. When the sub-node
// updates, these updates are received as an incremental update by the 
// union node.

UnionQueryCalc.prototype.updateQueryAfterNodeRemoval = 
    unionQueryCalcUpdateQueryAfterNodeRemoval;

function unionQueryCalcUpdateQueryAfterNodeRemoval(subNode)
{
    var subProjAddedMatches = 
        this.isProjection() && this.subProjMustAddMatches(); // before update
    var subNodeId = subNode.getId();
    // true if sub-node was removed under this node.
    var subNodeRemoved = !(subNodeId in this.subNodes);
    var wasProjection = this.projSubNodeNum && (subNodeId in this.projSubNodes);

    if(wasProjection) {
        // the projection sub-node was removed or changed into a selection
        delete this.projSubNodes[subNodeId];
        this.projSubNodeNum--;

        if(this.projSubNodeNum == 0) {
            // changed from a projection to a selection, propagate the change
            // to the match parent (that is, also to the root query calculation
            // node if this is the top query calculation node).
            this.matchParent.updateQueryAfterNodeRemoval(this);
            if(!subProjAddedMatches) {
                // the remaining sub-nodes changed from a selection-projection
                // to a selection. Since the sub-projections did not add
                // their matches, this node is not dominated by a higher
                // generating projection, so the selection-projections 
                // were generating projections. Notify those nodes of 
                // the change.
                for(var id in this.subNodes) {
                    if(id == subNodeId)
                        continue;
                    this.subNodes[id].unsetSelectionProjection();
                }
            }
        }
    }

    // update match points and matches
    this.updateMatchingAfterRemoval(subNode, wasProjection, subNodeRemoved, 
                                    subProjAddedMatches);
}

// This function is called to update match points and matches on this
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
// the node).
// These three properies can then be used to determine how the match points
// and matches of this node need to be updated.
// At the time this function is called, the match points and matches
// of subNode have not (yet) been updated, so all function here which read
// the match points and matches from the sub-node get the values from before
// the removal of the sub-node.
// If 'subNodeRemoved' is true (the node removed is a sub-node of this
// union node) this function must remove the match points of subNode
// from its own match points, Otherwise, there is no need to update
// the match points.
// If the union node added its matches before the change (it was a selection
// or a projection which adds its matches) and subNode was removed, the
// matches of subNode must be removed from the union node (after the removal 
// the node must continue to add matches).
// In addition, if the union node changed from a projection to a selection
// as a result of the removal and it did not previously have to add
// its matches, the matches from all sub-node have to be added to the
// union node.

UnionQueryCalc.prototype.updateMatchingAfterRemoval = 
    unionQueryCalcUpdateMatchingAfterRemoval;

function unionQueryCalcUpdateMatchingAfterRemoval(subNode, wasProjection, 
                                                  subNodeRemoved, 
                                                  subProjAddedMatches)
{
    if(subNodeRemoved) {

        // update match points
        var _self = this;
        subNode.getFullCountMatchPoints().forEach(function(count, pathId) {
            _self.removeFromMatchPoints(pathId, subNode);
        });

        // if the node added its matches (was a selection or a projection
        // adding its matches) remove the matches of the removed sub-node.
        if((!wasProjection && !this.isProjection()) || subProjAddedMatches)
            this.removeMatches(subNode.getMatches(), subNode);
    }
    
    if(wasProjection && !this.isProjection() && !subProjAddedMatches) {
        // changed from projection to selection and did not previously
        // have to add its matches, add matches from all sub-nodes
        for(var id in this.subNodes)
            this.addMatches(this.subNodes[id].getMatches(), this.subNodes[id]);
    }
}

// This function is called on this query calculation node (which must
// be a projection) during the processing of a node removal. This
// node removed must have been a projection and resulted in the change
// of the 'sub-projections must add matches' property on this node
// from true to false. For the union node all this means is that it 
// can clear its 'matches' table and propagates this property update
// to its sub-nodes (all of them, including the selection sub-nodes).

UnionQueryCalc.prototype.unsetSubProjsMustAddMatches = 
	unionQueryCalcUnsetSubProjsMustAddMatches;

function unionQueryCalcUnsetSubProjsMustAddMatches()
{
    // no need to calculate matches anymore
    this.matches = new IntHashMapUint(this.subNodeNum);

    for(var id in this.subNodes)
        this.subNodes[id].unsetMustAddMatches();
}

///////////////////
// Query Refresh //
///////////////////

//
// Structure Refresh
//

// This function is called in the structure refresh phase of the query
// refresh (for full documentation, see the 'query refresh' section 
// of the base class). As the refresh process recursion is top-down
// but the refresh of each node depends on the nodes under it, this first 
// refreshes the structure of the sub-queries and then updates its own 
// structure (table and number of sub-projections).
//
// In the refresh phase, sub-nodes can only be added, so the number
// of projection sub-nodes can only increase (the projection sub-nodes
// may either be new or selection sub-nodes which became projections).
//
// Since the union node treats all sub-nodes equally (either all as 
// selections or all as projections) there is no need to track here 
// the individual structural changes of sub-node. All this function
// needs to track is whether the union node changed from a selection to
// a projection. If it did, the selection sub-nodes have to be notified that
// they have become selection-projections. 

UnionQueryCalc.prototype.refreshQueryStructure = 
    unionQueryCalcRefreshQueryStructure;

function unionQueryCalcRefreshQueryStructure()
{
    var prevProjSubNodeNum = this.projSubNodeNum ? this.projSubNodeNum : 0;
    // this is the initial update if there maximal match point count is 0

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
        }
    }

    if(this.isProjection() && !prevProjSubNodeNum && !this.mustAddMatches) {
        // union just became a projection.
        // If this union projection node must add matches then it is dominated
        // by a multi-projection intersection node and therefore its
        // selection sub-nodes are not generating selection-projections.
        // Therefore, the refresh below is only needed in casr the union
        // node does not need to add its matches.

        // record that this just became a projection for the next steps
        this.justBecameProjection = true;

        // set all selection sub-nodes as selection-projections. 
        // suspend the projection matches of all selection sub-nodes
        // which are scheduled to be updated. This will ensure that
        // projection matching will be unsuspended, resulting in the
        // calculation of the projection matches.
        
        for(var id in this.subNodes) {
            var subNode = this.subNodes[id];
            if(!subNode.isProjection()) {
                if(this.updatedSubNodes[id])
                    subNode.suspendProjection();
                subNode.setSelectionProjection();
            }
        }
    }
}

// This function is called on this query calculation node (which must
// be a projection) during the structure refresh phase to indicate that 
// the sub-projections of this intersection need to add their 
// selection matches to this node. The function first notifies its
// sub-projections of this requirement, buy calling the setMustAddMatches()
// function on these nodes. The function then sets the flag 
// this.justStartedAddingMatches to ensure that in the match refresh
// step the matches will be read from all sub-nodes.
// If the flag this.justBecameProjection is set, it must be turned off,
// since the 'mustAddMatches' implies that it is dominated by a generating
// projection (an intersection with multiple projection sub-nodes) 
// and therefore its selection sub-nodes are no longer generating 
// projections (whose initialization is the reason we need the 
// this.justBecameProjection flag). Because of the depth-first nature
// of the structural refresh, it may happen that the this.justBecameProjection
// is set before the second projection is added under the dominating 
// intersection node and therefore it is first incorrectly set only to be
// reset here.

UnionQueryCalc.prototype.setSubProjsMustAddMatches = 
	unionQueryCalcSetSubProjsMustAddMatches;

function unionQueryCalcSetSubProjsMustAddMatches()
{
    // this property need only be set on the projection sub-nodes
    // (selection sub-nodes check the mustAddMatches property of the
    // union node). On the selection sub-nodes, we turn off the 
    // selection-projection.
    for(var id in this.subNodes) {
        var subNode = this.subNodes[id];
        if(subNode.isProjection())
            subNode.setMustAddMatches();
        else
            subNode.unsetSelectionProjection();
    }

    this.justStartedAddingMatches = true;
    if(this.justBecameProjection)
        delete this.justBecameProjection;
}

// This function refreshes the match point count on this node and recursively
// refreshes the match points on the sub-nodes. This function is responsible 
// for updating its match parent with match points which were added and 
// removed, using the standard 'addToMatchPoints' and 'removeFromMatchPoints' 
// interface. This function does not, however, need to deal with cases 
// where the relation with the parent has changed (this is a new sub-node
// of the parent or this is an existing sub-node but changed from a 
// selection to a projection in the last refresh). It is the responsibility
// of the parent to handle this change in relationship, adding or removing
// the existing match points (before the refresh) of its sub-nodes, 
// as necessary.
// This function goes over all new sub-nodes and adds their match points
// to the union node. These are still the old match points of these sub-nodes,
// as this takes place before the match points of those nodes are refreshed.
// Often this list of match points is empty. After adding these match points,
// this function calls the match point refresh function on the sub-nodes.
// This will result in an incremental match point update from those nodes.

UnionQueryCalc.prototype.refreshMatchPoints = 
    unionQueryCalcRefreshMatchPoints;

function unionQueryCalcRefreshMatchPoints()
{
    for(var id in this.updatedSubNodes) {

        var subNode = this.subNodes[id];

        if(this.updatedSubNodes[id]) { 
            // new sub-node, add its match points before refresh (the 
            // refresh will produce an incremental update)
            var _self = this;
            subNode.getFullCountMatchPoints().forEach(function(count, pathId){
                _self.addToMatchPoints(pathId, subNode);
            });
        }

        subNode.refreshMatchPoints();
    }
}

// This function is called to refresh the matches of this union node
// and all its updated sub-nodes during the refresh of the query.
// There are two flags which may be set and indicate how the refresh
// should take place:
// 1. justBecameProjection: if this flag is set, this function must
//    loop over all sub-nodes (whether updated or not). For those which
//    were not updated (and must be selections, as before the refresh
//    this union node was a selection) this function calls setProjMatches()
//    to initialize the calculation of these selection-projections.
//    For updated node, it is enough to call the refresh function for
//    those nodes (the projection matching on those nodes was suspended,
//    so a refresh will recalculate their projections).
//    This flag is set in case the sub-nodes do not need to add matches
//    to the union node, so any matches already in its matches table are
//    cleared.
// 2. justStartedAddingMatches: this flag is set on a projection union
//    where the sub-nodes did not add their matches and now do need to
//    add matches. The function loops over all sub-nodes, gets their matches
//    and adds them to its own matches. It then refreshes all sub-nodes
//    (also those which did not change, as their 'add matches' property
//    changed (we did not ad these nodes to the list of new sub-nodes as
//    this would have also added their match points).
// 3. If neither of these flags is set, the function refreshes the matches
//    on the updated sub-nodes. If the union node is a selection node
//    or a projection node which adds its matches, this function first adds the
//    matches of all new sub-nodes.

UnionQueryCalc.prototype.refreshMatches = 
    unionQueryCalcRefreshMatches;

function unionQueryCalcRefreshMatches()
{
    if(this.justBecameProjection) {

        // delete the node's own matches
        this.matches = new IntHashMapUint(this.subNodeNum);

        for(var id in this.subNodes) {
            if(!(id in this.updatedSubNodes)) 
                // not updated, is a selection, initialize selection-projections
                this.subNodes[id].setProjMatches();
            else
                this.subNodes[id].refreshMatches();
        }

    } else if(this.justStartedAddingMatches) {

        // make sure the match table can store the required count
        this.matches.adjustByteNumber(this.subNodeNum);
        
        for(var id in this.subNodes) {
            subNode = this.subNodes[id];
            this.addMatches(subNode.getMatches(), subNode);
            subNode.refreshMatches();
        }
    } else {

        // make sure the match table can store the required count
        this.matches.adjustByteNumber(this.subNodeNum);
        
        var addMatches = !this.isProjection() || this.mustAddMatches;

        for(var id in this.updatedSubNodes) {
        
            var subNode = this.subNodes[id];

            if(addMatches && this.updatedSubNodes[id]) // new sub-node
                this.addMatches(subNode.getMatches(), subNode);
            
            // update the matches of the sub-node (with incremental update
            // of this node)
            subNode.refreshMatches();
        }
    }

    // unsuspend, just in case the node was suspended externally
    this.unsuspend();

    // clear fields at end of update
    this.updatedSubNodes = undefined;
    if(this.justBecameProjection)
        this.justBecameProjection = undefined;
    if(this.justStartedAddingMatches)
        this.justStartedAddingMatches = undefined;
}

////////////////
// Suspension //
////////////////

// The union node never suspends its selections, but may need to
// suspend its projections. This suspension is triggered externally
// (by the dominating node, usually the root query calculation node).
// It ensures the setProjMatches() is called on this node when the node
// is refreshed.
// The code specific to the union derived class only makes sure that
// while the projection is suspended, no projection updates take place.
// This applies to the addProjMatches and removeProjMatches functions,
// which are disabled.
// Below are a few function which are required by the base class implementation
// of projection suspension. These functions do nothing.

// Since the union node has no projMatches table of its own, this function
// does nothing.

UnionQueryCalc.prototype.suspendProjMatches = 
	unionQueryCalcSuspendProjMatches;

function unionQueryCalcSuspendProjMatches()
{
    return;
}

///////////////////////
// Node Mode Setting //
///////////////////////

// Since the union node uses the same addMatches, removeMatches, 
// addProjMatches and removeProjMatches in all cases, the mode
// setting functions do nothing.

UnionQueryCalc.prototype.setSelectionMode = unionQueryCalcSetSelectionMode;

function unionQueryCalcSetSelectionMode()
{
    return;
}

UnionQueryCalc.prototype.setProjectionMode = unionQueryCalcSetProjectionMode;

function unionQueryCalcSetProjectionMode()
{
    return;
}

UnionQueryCalc.prototype.setSuspendedProjectionMode = 
	unionQueryCalcSetSuspendedProjectionMode;

function unionQueryCalcSetSuspendedProjectionMode()
{
    return;
}

////////////////////
// Adding Matches //
////////////////////

// This is the implementation of the addMatches function for the union 
// node. If the union node does not need to add matches, the neither
// do its sub-nodes, so this function would not be called. 
// This function simply adds the matches to its 'matches' table and
// forwards to the parent node those matches which were first added
// to the matches table. This does not need to add projection matches,
// these are added through a recursive call from the parent. 

UnionQueryCalc.prototype.addMatches = 
	unionQueryCalcAddMatches;

function unionQueryCalcAddMatches(elementIds, source)
{
	var length = elementIds.length;

    if(length == 0)
        return;

	var newMatches = []; // matches to report to the parent

	for(var i = 0, l = elementIds.length ; i < l ; ++i) {
		
		var elementId = elementIds[i];

		if(!this.matches.has(elementId)) {
			this.matches.set(elementId, 1);
			newMatches.push(elementId);
		} else
			this.matches.set(elementId, this.matches.get(elementId) + 1);
	}

	if(newMatches.length)
		this.matchParent.addMatches(newMatches, this);
}

///////////////////
// Match Removal //
///////////////////

// This is the implementation of the removeMatches function for the union 
// node. If the union node does not need to add matches, the neither
// do its sub-nodes, so this function would not be called. 
// This function simply removes the matches from its 'matches' table and
// forwards to the parent node those matches which were completely removed
// from the matches table. This does not need to remove projection matches,
// these are removed through a recursive call from the parent. 

UnionQueryCalc.prototype.removeMatches = 
	unionQueryCalcRemoveMatches;

function unionQueryCalcRemoveMatches(elementIds, source)
{
	var removedMatches = []; // matches to report to the parent

	for(var i = 0, l = elementIds.length ; i < l ; ++i) {
		
		var elementId = elementIds[i];

        var newCount = this.matches.get(elementId) - 1;
		if(newCount == 0) {
			removedMatches.push(elementId);
			this.matches.delete(elementId);
		} else
            this.matches.set(elementId, newCount);
	}

	if(removedMatches.length)
		this.matchParent.removeMatches(removedMatches, this);
}

////////////////////////////////
// Setting Projection Matches //
////////////////////////////////

// Since the union node does not maintain its own list of projection
// matches, all this function does is call setProjMatches on each
// of its sub-nodes. If there is a higher generating projection
// node (an intersection with multiple projection sub-nodes) the 
// selection sub-nodes are not generating projections, so their
// projections don't need to be calculated. Otherwise, the projections
// of all sub-nodes need to be updated.

UnionQueryCalc.prototype.setProjMatches = unionQueryCalcSetProjMatches;

function unionQueryCalcSetProjMatches(resultId)
{
    if(!this.isProjection())
        return; // nothing to do

    if(this.mustAddMatches) {
        // selection-projection nodes are not generating projections
        // (because there is a higher generating projection - an intersection
        // with multiple projection sub-nodes) so we only need to 
        // set the projections on the projection sub-nodes
        for(var id in this.projSubNodes)
            this.projSubNodes[id].setProjMatches(resultId);
    } else { // set the projection matches on all sub-nodes
        for(var id in this.subNodes)
            this.projSubNodes[id].setProjMatches(resultId);
    }
}

///////////////////////////////
// Adding Projection Matches //
///////////////////////////////

// Since the union node does not maintain its own list of projection
// matches, all this function does is call addProjMatches on each
// of its sub-nodes. If there is a higher generating projection
// node (an intersection with multiple projection sub-nodes) the 
// selection sub-nodes are not generating projections, so their
// projections don't need to be calculated. Otherwise, the projections
// of all sub-nodes need to be updated.

UnionQueryCalc.prototype.addProjMatches = unionQueryCalcAddProjMatches;

function unionQueryCalcAddProjMatches(parentProjMatches, resultId)
{
    if(this.mustAddMatches) {
        // selection-projection nodes are not generating projections
        // (because there is a higher generating projection - an intersection
        // with multiple projection sub-nodes) so we only need to 
        // add the projections to the projection sub-nodes
        for(var id in this.projSubNodes)
            this.projSubNodes[id].addProjMatches(parentProjMatches, resultId);
    } else { // add the projection matches to all sub-nodes
        for(var id in this.subNodes)
            this.projSubNodes[id].addProjMatches(parentProjMatches, resultId);
    }
}

/////////////////////////////////
// Removing Projection Matches //
/////////////////////////////////

// Since the union node does not maintain its own list of projection
// matches, all this function does is call removeProjMatches on each
// of its sub-nodes. If there is a higher generating projection
// node (an intersection with multiple projection sub-nodes) the 
// selection sub-nodes are not generating projections, so their
// projections don't need to be calculated. Otherwise, the projections
// of all sub-nodes need to be updated.

UnionQueryCalc.prototype.removeProjMatches = unionQueryCalcRemoveProjMatches;

function unionQueryCalcRemoveProjMatches(parentProjMatches, resultId)
{
    if(this.mustAddMatches) {
        // selection-projection nodes are not generating projections
        // (because there is a higher generating projection - an intersection
        // with multiple projection sub-nodes) so we only need to 
        // remove the projections from the projection sub-nodes
        for(var id in this.projSubNodes)
            this.projSubNodes[id].removeProjMatches(parentProjMatches, 
                                                    resultId);
    } else { // remove the projection matches from all sub-nodes
        for(var id in this.subNodes)
            this.projSubNodes[id].removeProjMatches(parentProjMatches, 
                                                    resultId);
    }
}

///////////////////////
// Access to Matches //
///////////////////////

// Returns an array holding the data element IDs which are the
// projection matches of this node. For a union node, these are
// identical to the projection matches of the parent.

UnionQueryCalc.prototype.getProjMatches = 
	unionQueryCalcGetProjMatches;

function unionQueryCalcGetProjMatches(resultId)
{
    return this.matchParent.getProjMatches(resultId);
}


// This function receives a list of matches from a (projection) sub-node and
// returns the subset of these matches which are also projection matches
// on this node. Since the union node does not maintain its own list of
// projection matches, the filtering takes place on the parent node.

UnionQueryCalc.prototype.filterProjMatches = 
	unionQueryCalcFilterProjMatches;

function unionQueryCalcFilterProjMatches(matches, resultId)
{
    return this.matchParent.filterProjMatches(matches, resultId);
}
