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

// This object extends the base class InternalQueryCalc for intersection
// nodes. An intersection node matches only those data elements which 
// were matched by all its selecting query calculation sub-nodes. When the data 
// elements matched by the sub-nodes are lower than the common path
// of the intersection, 'raising' may need to take place (see details
// below).
//
//
// Calculating the Intersection
// ============================
//
// An intersection node matches those data elements which are matched on 
// all its selecting sub-nodes. If the intersection node is a selection,
// all its sub-nodes are selecting sub-nodes. If the intersection is 
// a projection, all its selection sub-nodes are selecting and its projection
// sub-node(s) are selecting iff one of the following holds:
// 1. There are at least two projection sub-nodes.
// 2. The parent node requires this projection node to add its selections
//    (this means that the parent node is dominated by an intersection
//    node which has at least two projection sub-nodes).
//
// Each selecting sub-node of the intersection node calls the
// addMatches and removeMatches functions of the intersection node to
// add and remove its own matches (an array of data element ID). In the
// most simple case, the intersection node then simply counts the
// number of times each data element ID has been added and removed by
// the sub-nodes and if the count reaches the number of selecting
// sub-nodes, the data element is considered selected.
//
// As described in the introduction to InternalQueryCalc, this simple 
// algorithm may fail if the sub-queries select data elements whose
// path is longer than the common path of all sub-queries. In this case,
// it may be that each sub-query will add a different data element to
// the matches, but that these different data element (none of which 
// reaches the count required for a match) are all dominated by the same
// data element. If we then also increase the count of the dominating data
// element, we get a match on that dominating data element. This will 
// be referred to as 'raising' of matches.
//
// Raising of matches must be performed correctly in order no to add false
// matches. Consider the following example (taken from the introduction 
// to InternalQueryCalc):
//
// Data:
// o({
//      a: o({ b:1, c:2 }, { b:2, c:1 })
//   },
// )
// The data elements here correspond to the the paths (where i0,i1,i2,.... 
// designate positions in the ordered set)
// i0,
// i0:a:i0
// i0:a:i1
//
// The query { a: { b:1, c:1 }} consists of two simple selections:
// a:b:1,
// a:c:1
// Matching by the queries must begin with the lowest data element.
// In this case both a:b:1 and a:c:1 match a data element at path [a],
// but not the same one: a:b:1 matches i0:a:i0 and a:c:1 matches i0:a:i1.
// While these two data elements have the same parent (i0) this is not 
// considered a match.
//
// The problem in this example is that both simple selections have 
// a common prefix and there are data elements at that prefix: i0:a:i0
// and i0:a:i1. Because this is a common prefix for the two queries,
// we cannot raise these data elements to the domianting data element
// at i0 when their match count is only 1. The match count for these
// data elements must be 2.
//
// Generally, before raising a data element to its parent data element,
// the match count for that data element must reach the number of 
// selecting sub-queries which have the path of this data element as 
// a prefix to their path.
//
// To implement this, we define match point and their count.
//
// Match Points
// ------------
//
// Match points are path IDs. These are the path IDs along the path of 
// a query where data element are defined in the indexer. A simple query 
// calculation node (simple or projection) is defined for a path and 
// all paths in the indexer which are prefixes of this path (including 
// the path itself) which carry data elements are match points of the
// terminal query calculation node. Note that the root path is always
// a match point (there are always data elements defined at the root path).
//
// For compound query calculation nodes, the match points are those
// match points received from their selecting sub-nodes. Each match point then
// gets a count which is the number of sub-nodes from which that match
// node was received.
//
// On an intersection node, only match points with a maximal count are
// added as match points to the parent node. Because the root path is
// always a match point (on any query calculation node), the count of
// the root path match point must be maximal. It is therefore simple 
// to determine the maximal match point count. 
//
// When data element IDs are received as matches from sub-nodes, their count 
// in the 'matches' table is increased. If this match count reaches the
// maximal match point count (that is, the number of selecting sub-queries)
// then this is an intersection match. If the match count reaches the 
// count of the match point which is the path of the data element 
// but this count is not maximal, then the data element was matched
// on all sub-queries on which it should have been matched and can
// be raised to its parent data element. The match count of the child
// data element is then add to the match count of the parent data element.
// The process then continues recursively in this way.
//
// Only matches with a maximal count (== number of selecting sub-nodes)
// are considered as matches of the intersection and are added to the
// dominating node.
//
// Projection Matches
// ------------------
//
// When a query calculation node is a projection (or a selection-projection)
// its projection matches are also calculated. In principle, the projection 
// matches of a node are the intersection of its matches with the 
// projection matches of the parent. The parent notifies its projection
// sub-nodes of changes in its projection matches (through the 
// addProjMatches and removeProjMatches functions of the sub-node).
//  
// In principle, the operation of calculating the projection matches
// (an intersection of the parent projection matches and the node's 
// own projection) is simple. However, this operation is somewhat complicated
// when match raising takes place. In that case, the projection matches
// of the parent node (which, by definition, are a subset of the parent's 
// matches) may dominate data elements which are matches of the sub-node.
// Therefore, when calcualting projection matches we may need to lower 
// the projection matches of the parent query calculation node to the 
// matches of the sub-node.
//
// This lowering is the responsibility of the parent node, as the parent
// node is where the raising needs to take place. This means that 
// when an intersection node adds or removed projection matches from
// any of its projection sub-nodes, it must first lower them, if those
// sub-nodes have lower match points. A projection sub-node may also
// call the 'filterProjMatches()' function on the intersection node,
// with a subset of the matches of the sub-node. This function then
// returns the subset of this input set which is also a projection match of
// the intersection node. In this case, too, it is up to the intersection
// node to check whether any raising of the input elements is necessary.
// 
// The lowering of projection matches is calculated in two different ways, 
// depending on whether raising took place for selection matches for 
// the relevant match points or not.
//
// When an intersection node is a projection, it holds two lists of 
// match points: 'matchPoints' holds those match points received from
// selecting sub-queries and 'projMatchPoints' holds those match points
// received from projetion sub-queries. If projection sub-queries need
// to add their selection matches to the intersection node, the 
// 'projMatchPoints' list is contained in the 'matchPoints' list. Otherwise,
// there may still be overlaps between the two lists (the same match point
// can appear both in a projection and a selection sub-query) but the 
// counts of the match points received from the projection sub-query
// are not included in the counts in 'matchPoints'.
//
// Match points which only appear in the projMatchPoints list but not in 
// the matchPoints list are called 'pure projection match points' and
// are stored in the 'pureProjMatchPoints' list.
// 
// Lowering to a match point which is in 'matchPoints' can only take
// place to element IDs which were actually matched on that match
// point (that is, their match count is equal to the count of the match
// point). This lowering must, therefore, take place by looking at
// the 'raisedMatches' table which tracks matches which were raised during
// matching (only raised matches can be lowered for these match points).
// Lowering to pure projection match points can take place without checking
// for a match: all children of a projection match data element which  
// are at a pure match point path are considered projection matches.
// 
// When a data element ID is found which is in the intersection of the
// selection matches and the projection matches of the parent, it is
// added to the projection matches of the intersection. We then check
// whether the element ID can be lowered. First, we check in the 
// 'raisedMatches' table whether it was raised from a lower element ID
// on a match point in 'projMatchPoints' (if the match point is not in 
// projMatchPoints, the data element cannot dominate a node in the 
// projection). If it was, the entry in the raisedMatches table holds
// those data element from which it was raised. These can be added
// to the projection matches being propagated to the projection sub-nodes.
// The process can continue recursively with these nodes. Since 
// the match point was found in the 'raisedMatches'
// table, it must be in the 'matchPoint' table. If the data element
// also has children under paths which are pure projection match points
// (that is, are in projMatchPoints but not in matchPoints), then all 
// those children can also be added to the projection matches being 
// propagated to the projection sub-nodes (since the match point does not 
// appear in 'matchPoints' no selection takes place on its path and it can 
// always be included if the dominating node is a projection match).
//
// Note that while the lowered projection matches at match points which
// are not pure projection match points are stored in the this.projMatches
// table, the lowered projection matches at pure projection match points 
// are not stored in the this.projMatches table of this node. This is because 
// the cleanup of these data elements is difficult (this node does not 
// necessarily know when they are removed) and there seems to be little 
// advantage to storing these lowered matches as the incremental update 
// should make sure that each node only has to be lowered once upon adding 
// it and once upon removing it. 
// 
// When pure projection match points exist, it is possible that there
// are selection match points with a maximal count which are lower than
// the common prefix of all sub-queries, including the projection.
// Matches on these match points need to be raised further, because
// otherwise they will not dominate all the data elements which need
// to be projected. For example, consider the following data and query:
//
// Data: o({ a: o(1,2), b: o({ c: 1, d: 1}, { c: 2, d: 2})})
// Query: { a: _, { b: { c: 1, d: 1 }}}
//
// The data elements of the data are:
//
// i0
// i0:a:i0
// i0:a:i1
// i0:b:i0
// i0:b:i1
//
// The match points are at path [] and [b], both of which have count 2,
// while path [a] is a pure projection match point. The query has a match 
// count of 2 on the data element i0:b:i0 on the match point [b]. While this
// has a maximal match count, this data element does not allow us to
// calculate the projection matches, which are i0:a:i0 and i0:a:i1 because
// it does not dominate them. The matches need to be raised to i0 
// in order to allow the projection matches to be calculated. As show already
// above, however, we do not want to keep on raising to the highest 
// match point, as this too may result in incorrect matches (see example
// at the beginning of the selection matching section). Therefore, to 
// determine that such raising is required, we need to check whether the
// match point with the maximal count is also a projection match point.
// If it is not, raising must continue.
//
// Note that pure projection match points only exist when the intersection
// has a sub-node which does not add its selection matches. This means
// that also the intersection node does not need to add its selection
// matches to the parent. This means that the list of matches is calcualted 
// only in order to find the list of projections. 
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
//    raisedMatches: <Map object>: { // only when needed (see below)
//       <data element ID>: <Map object>: {
//            <match point ID>: <count> // if this is a selection match point 
//            <match point ID>: { // if this is a projection match point and
//                                // the projection adds its matches
//                 <data element ID>: true
//                 .......
//            }
//            .....
//       }
//    }
//
//    // for projections only
//
//    // common fields for all result nodes
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
//    pureProjMatchPoints: <Map>{
//        <path ID>: true
//        .......
//    }
//
//    // per-result projection fields
//
//    projMatches: { // on projection and selection-projection nodes
//       <result ID>: <Map  object>: {
//          <data element ID>: <count>
//          ....
//       }
//       ....
//    }
//
//    // refresh fields
//
//    selectionBecameProjection: {
//        <query calculation ID>: true,
//        .......
//    }
// }
//
// The following fields are used in calculating the selection of this node
// (whether this is a selection or a projection node). Some of these fields
// are common to this query calculation node and other types of query
// calculation nodes. Below are given only those fields which are not
// described in internalQueryCalc.js or whose use in this class is not
// identical to that in other classes.
//
// matches: holds match counts for data elements which were (partially)
//   matched on this node. A data element is considered partially matched
//   if its count is equal to the count of the corresponding match point 
//   (the path of the data element). A data element is considered fully
//   matched if the count of its match point is maximal, that is, equal
//   to the match point count on the root path ID match point count.
//   For more details, see the introduction. 
//
// matchPoints: the keys of this object are path node IDs and the
//   values are the number of query calculation sub-nodes where this path ID 
//   appears in the match points. Match points are created only for paths 
//   where data elements are stored in the indexer. The match point count
//   on each node is then the number of query calculation sub-nodes which 
//   have this path as a prefix of its path. Typically, this list is probably 
//   very short.
//
// raisedMatches: this table is used only when there are some match points 
//   with a count lower than the maximal count (the maximal count is the 
//   count of the root path ID match point).  In this case, there is
//   'raising' of data elements: a match on a data element is
//   translated into an increased count for the match of its parent
//   data element (see the introduction for more details). In this
//   case, we need to track for each such parent data element where
//   its count came for. All its children which belong to the same
//   match point (path in the indexer) may only contribute once to its
//   count (the contribution is equal to the count of the child's
//   match point). Therefore, the raisedMatches table keeps track, for
//   every data element whose match is a result of raising, of the
//   total number of matched children belonging to each match
//   point. For every such entry (non-zero count) the match count of
//   the parent is increased by the count of the match point.  The
//   'number' attribute under each data element entry in the table is
//   the number of match points in the entry (because match point IDs
//   are numbers, there is no possible name conflict here).  When the
//   match point under a given data element in the raisedMatches table
//   is on a projection path (that is, the path ID represents a prefix
//   of the path of a simple projection node) then we do not only
//   store the number of data elements which were raised from this
//   match point but also store the IDs of those data elements (and
//   the 'number' field stores their number). This allows us later to
//   trace back down the path to the projected data elements.  The
//   existence of the raisedMatches table is considered an indication
//   that there are match points with count lower than the maximal
//   count.
//
// projSubNodes: This is the list of sub-nodes which are projections.
// projSubNodeNum: number of elements in 'projSubNodes'.
// projMatchPoints: This is stored only on intersection projection nodes 
//   (that is, intersection nodes which dominate, directly or not, simple 
//   projection nodes). This is a list of those match points which were 
//   received from sub-nodes which are projection nodes and a count of 
//   how many such sub-nodes the match point came from. If the projection
//   sub-nodes are not required to add their matches to this node 
//   (see the 'subProjMustAddMatches() function) these match points 
//   do not necessarily appear in the 'matchPoints' table.
// pureProjMatchPoints: this is a list of all match points which appear in 
//   projMatchPoints but not in matchPoints. When calculating projection
//   matches we need to check for each data element ID in the projection
//   match list whether it has children at the paths appearing in 
//   pureProjMatchPoints. If it does, these children are also projection
//   matches (see description of projection match calculation algoithm).
//   Note that this table is always empty if the projection sub-nodes
//   add their selection matches to this node.
//
// Remark: none of the above fields appears on a selection-projection node.
//   a projection selection node does, however, have a 'projMatches'
//   field (see below).
//
// projMatches: this field appears on (intersection) projection nodes and on 
//   selection-projection nodes. For projection nodes, 
//   this field holds a subset of the data elements stored in 'matches'.
//   This is calculated separately for each result node which makes use
//   of the root query calculation node to which this node belongs.
//   Data elements are included in 'projMatches' iff they fulfill the 
//   following requirements:
//   1. The match is a full match of the intersection node and is 
//      in the projection matches of the parent node or can be raised
//      to such a projection match. This is checked by calling the
//      parent node's filterProjMatches(). 
//   2. The match has the count of its match point (not necesarily
//      a maximal match count) and its parent data element is in the
//      projMatches table. 
//   For selection-projection nodes, this table does not hold the data elements
//   as described here, but the full matches of the selection which can be
//   raised to a projection match of parent node (as determined by the
//   parent's filterProjMatches() function) and then raised to the 
//   first match point which is higher or equal the query's 
//   prefix path. If such raising is required, the count of each element
//   in the projMatches table indicates how many matched elements were
//   raised to it (so that matches can be properly deleted). In all other
//   cases, the count is always 1.
//
// selectionBecameProjection: during the query refresh process, this table 
//   has an entry for the ID of each sub-node of this query calculation 
//   node which is not a new sub-node, was a selection before the refresh
//   and is a projection after the update (this can happen only to compound
//   sub-nodes, where a new projection terminal is added somewhere under the 
//   compound node).
//

// %%include%%: "internalQueryCalc.js"

inherit(IntersectionQueryCalc, InternalQueryCalc);

//
// Constructor
//

// The constructor takes one argument: the root query calculation node
// which created it.

function IntersectionQueryCalc(rootQueryCalc)
{
	// call base constructor
	this.InternalQueryCalc(rootQueryCalc);
    // initialize to store counts which fit in 1 byte (may be modified later)
    this.matches = new IntHashMapUint(0);
}

// destruction function (most work takes place in the base class)

IntersectionQueryCalc.prototype.destroy = intersectionQueryCalcDestroy;

function intersectionQueryCalcDestroy()
{
    // if this was a generating projection, remove it from the list
    // of generating projections on the root query calculation nodes.
    if(this.rootQueryCalc && this.isGeneratingProjection())
        this.rootQueryCalc.removeGeneratingProj(this);

	// base class destroy (this also detaches from the root query calculation
    // node if this is the top query calculation node)
	this.InternalQueryCalc_destroy();
}

///////////////////////////////
// Property Access Functions //
///////////////////////////////

// Returns true if this node is a projection node (but not a 
// selection-projection node) and false otherwise.

IntersectionQueryCalc.prototype.isProjection = 
    intersectionQueryCalcIsProjection;

function intersectionQueryCalcIsProjection()
{
	return (!!this.projSubNodeNum);
}

// This function should be called by a sub-node of this query calculation 
// node to determine whether it need to call the 'addMatches' function
// of this query calculation node with its selection matches. This is 
// required in case the projection sub-node does not cover all projection
// terminals in the query. This holds if either this intersection node
// has additional projection sub-nodes or if this property holds
// recursively for the parent node. Note that this function looks at
// 'this.parent' and not 'this.matchParent' since it is only interested
// in dominating query calculation nodes and not in the root query 
// calculation node.

IntersectionQueryCalc.prototype.subProjMustAddMatches = 
	intersectionQueryCalcSubProjMustAddMatches;

function intersectionQueryCalcSubProjMustAddMatches()
{
	return (this.projSubNodeNum > 1 || 
            (!!this.parent && this.parent.subProjMustAddMatches()));   
}

// This function returns true if this node is a generating projection
// An intersection node is a generating projection candidate in 
// one of the following case:
// 1. It has more than one sub-projection
// 2. It is a selection-projection node which is not which is not dominated
//    by another generating projection.
// In the second case, to test whether the node is dominated by another
// generating projection, we check the 'mustAddMatches' property of
// the parent (union) node. This is the corect test because a dominating 
// generating projection must be an intersection with multiple projection
// sub-nodes and this forces the 'mustAddMatches' property to be turned on
// on its projection sub-nodes. The parent of a selection projection
// must be prjection node and therefore will have this property set in case
// it is dominated by a generating projection. 

IntersectionQueryCalc.prototype.isGeneratingProjection = 
	intersectionQueryCalcIsGeneratingProjection;

function intersectionQueryCalcIsGeneratingProjection()
{
	return (this.projSubNodeNum >= 2 || 
            (this.isSelectionProjection() && !this.matchParent.mustAddMatches));
}

// a intersection node is a terminal generating projection only if it is
// a selection projection and not dominated by an intersection 
// multi-projection (which can be inferred from the 'mustAddMatches' property).

IntersectionQueryCalc.prototype.isGeneratingProjectionTerminal = 
	intersectionQueryCalcIsGeneratingProjectionTerminal;

function intersectionQueryCalcIsGeneratingProjectionTerminal()
{
	return (this.isSelectionProjection() && !this.matchParent.mustAddMatches);
}

// This function should only be called on a projection query calculation
// node. The function returns true if this node structurally adds projection
// matches to its projection sub-nodes. This is true if this is an
// intersection node with at least two sub-queries or if the match parent
// of this node has this property.

IntersectionQueryCalc.prototype.addsProjMatchesToSubNodes = 
	intersectionQueryCalcAddsProjMatchesToSubNodes;

function intersectionQueryCalcAddsProjMatchesToSubNodes()
{
    if(this.subNodeNum >= 2)
        return true;
    
    if(this.matchParent === undefined ||
       this.matchParent == this.rootQueryCalc)
        return false;

    return this.matchParent.addsProjMatchesToSubNodes();
}

//////////////////
// Match Points //
//////////////////

// This function calculates the maximal count of a match point on this node
// by calculating the number of sub-nodes which need to adde their 
// matches to this node. This is the number of non-projection sub-nodes
// if the subProjMustAddMatches() property on this node is false
// and it is the total number of sub-nodes (selection and projection)
// if that property is true.
// This function should be used in the match point refresh phase,
// where the counts of the root path match point cannot be used to determine 
// the maximla count but the number of sub-nodes and the values 
// of the subProjMustAddMatches() property are known.
// After the match point refresh, it is better to use getFullMatchCount(),
// as it is probably slightly faster.

IntersectionQueryCalc.prototype.calcMaxMatchPointCount = 
	intersectionQueryCalcCalcMaxMatchPointCount;

function intersectionQueryCalcCalcMaxMatchPointCount()
{
    return (!this.projSubNodeNum || this.subProjMustAddMatches()) ? 
        this.subNodeNum : (this.subNodeNum - this.projSubNodeNum);
}

// This function checks whether match raising is required on this node.
// Match raising is required in two cases:
// 1. There are match points with a count which is smaller than the
//    maximal match point count.
// 2. The intersection is a projection and there are match points 
//    (with maximal count) which are not projection match points.
//    This can happen only if the sub-projection does not add its
//    matches to the selection matches of this node, in which case
//    its match points are not added to the 'matchPoints' table and
//    therefore the maximal match point count is smaller than the number
//    of sub-nodes.    

IntersectionQueryCalc.prototype.calcRaisingRequired = 
	intersectionQueryCalcCalcRaisingRequired;

function intersectionQueryCalcCalcRaisingRequired()
{
	if(this.matchPoints.size <= 1)
		return false;
	
	var maxCount = this.calcMaxMatchPointCount();

    var mustRaise = false;
    var _self = this;
    
    if(this.isProjection() && maxCount < this.subNodeNum) {
        this.matchPoints.forEach(function(count, pathId) {
		    if(!_self.projMatchPoints.has(pathId) || count < maxCount)
			    mustRaise = true;
        });
    } else {
        this.matchPoints.forEach(function(count, pathId) {
		    if(count < maxCount)
			    mustRaise = true;
        });
    }

	return mustRaise;
}

// This function calculates whether lowering of projection matches is required.
// This can happen only if there are projection match points where the 
// match point count is not equal to the maximal match point count
// If the projection sub-nodes must add their matches then the maximal 
// match point count must be equal to the number of sub-nodes. Otherwise,
// there can be at most one projection sub-node and the maximal match point 
// count is equal to the number of non-projection sub-nodes. 

IntersectionQueryCalc.prototype.calcLoweringRequired = 
	intersectionQueryCalcCalcLoweringRequired;

function intersectionQueryCalcCalcLoweringRequired()
{
    if(!this.isProjection() || this.projMatchPoints === undefined)
        return false;

    var maxCount = this.calcMaxMatchPointCount();

    var loweringRequired = false;

    this.projMatchPoints.forEach(function(count, pathId) {
        if(count != maxCount)
            loweringRequired = true;
    });
    
    return loweringRequired;
}

// This function returns true if, in order to determine whether a match
// is a full match it is enough to check whether its count is maximal.
// This is true except for the case where this is a projection whose
// projection sub-node does not add its matches (and therefore the maximal
// match point count is smaller (by 1) than the number of sub-nodes)
// and there are match points with maximal count which are not 
// projection match points. 

IntersectionQueryCalc.prototype.calcMaxCountIsFullMatch = 
	intersectionQueryCalcCalcMaxCountIsFullMatch;

function intersectionQueryCalcCalcMaxCountIsFullMatch()
{
    if(!this.isProjection())
        return true;

    var maxCount = this.getFullMatchCount();

    if(maxCount == this.subNodeNum)
        return true;

    var isFullMatch = true;
    var _self = this;
    this.matchPoints.forEach(function(count, pathId) {
        if(count == maxCount && !_self.projMatchPoints.has(pathId))
            isFullMatch = false;
    })

    return isFullMatch;
}

// This function returns true iff there are match points with a full match 
// count on this node which are lower than the query prefix path.
// This function should not be called during the match point refresh 
// process.	

IntersectionQueryCalc.prototype.lowerThanQueryPrefixFullMatches = 
    intersectionQueryCalcLowerThanQueryPrefixFullMatches;

function intersectionQueryCalcLowerThanQueryPrefixFullMatches()
{
	var maxMatch = this.getFullMatchCount();

	var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    var isLower = false;

    this.matchPoints.forEach(function(count, pathId) {
		if(pathId > prefixPathId && count >= maxMatch)
			isLower = true;
	});

	return isLower;
}

// This function returns an object whose attributes are the match points
// (path IDs) whose count is equal to the count of the match point
// of the root path. At the beginning of the match point refresh
// (during query refresh) this returns the list of full count match 
// points from before the refresh. 

IntersectionQueryCalc.prototype.getFullCountMatchPoints = 
    intersectionQueryCalcGetFullCountMatchPoints;

function intersectionQueryCalcGetFullCountMatchPoints()
{
	var maxMatch = this.getFullMatchCount();
    var fullCount = new Map();

    this.matchPoints.forEach(function(count, pathId) {
        if(count == maxMatch)
            fullCount.set(pathId, true);
    });

	return fullCount;
}

// This function returns true if the top match point (empty path)
// has been already updated for all sub-nodes. This means that the
// total count for this match point in the matchPoints and
// (if this is a projection node which does not add matches) projMatchPoints
// tables together is equal to the number of sub-nodes of this node.
// In this case, this function returns true and otherwise false.
// When a sub-node is added, its top match point is added last,
// so when this function returns true, we know that also the lower match
// points were added (but some later incremental updates may have not 
// taken place yet).

IntersectionQueryCalc.prototype.topMatchPointUpdatedForAll = 
    intersectionQueryCalcTopMatchPointUpdatedForAll;

function intersectionQueryCalcTopMatchPointUpdatedForAll()
{
    if(this.subNodeNum === undefined || this.matchPoints === undefined)
        return false; // not initialized yet

    var rootPathId = this.indexer.qcm.getRootPathId();

    if(this.matchPoints.get(rootPathId) == this.subNodeNum)
        return true;

    if(this.mustAddMatches)
        // needs to add matches, so the matchPoints count should be equal to 
        // the number of sub-nodes.
        return false;

    if(this.projMatchPoints === undefined || 
       this.projMatchPoints.get(rootPathId) === undefined)
        return false; // cannot compensate for the missing match points

    return (this.matchPoints.get(rootPathId) +
            this.projMatchPoints.get(rootPathId) ==
            this.subNodeNum);
}

// This function is called by a sub-query when a match point (path ID)
// is added to that sub-query. 'source' is the 'this' pointer of the object
// which called this function.
// If the sub-query is a projection, the match point must be added
// to the 'projMatchPoints' table. If the projection sub-query does
// not need to add its matches to this intersection node, there is 
// no need to add this match point to 'matchPoints' or to propagate
// this match point to the match parent.
// If this match point was not received from a sub-projection or the
// sub-projection is required to add its matches to the intersection,
// the count of this match point in the 'matchPoints' table is 
// increased by 1. If the count of this path ID has just reached 
// the number of matching sub-nodes (that is, sub-nodes which add
// their matches to this intersection: all selection sub-queries and, 
// if subProjMustAddMatches() returns true, also all sub-projections)
// this function calls itself recursively on the match parent node (with 
// the same path ID).
// The match point counts determine whether raising has to take place
// when updating the matches. Since we now modified the match point count,
// this property may have changed. We therefore need to set here the 
// way in which this intersection node ads and removed matches (with or
// without raising). Since we do not know whether this is the last match 
// point to be added, it may be that this decision will soon change,
// but we cannot postpone making this decision, as we do not know whether
// additional match point updates are on the way. However, if the 
// match point count for the root path ID is not yet maximal, we know
// that additional match point additions are on the way and can postpone
// setting the match point addition and removal method.
// This function may either be called in the match point refresh phase
// of the query refresh or when data elements are created in the indexer
// at a path which did not previously carry any data elements.

IntersectionQueryCalc.prototype.addToMatchPoints = 
	intersectionQueryCalcAddToMatchPoints;

function intersectionQueryCalcAddToMatchPoints(pathId, source)
{
    if(source.isProjection()) {
        this.addToProjMatchPoints(pathId);
        if(!this.subProjMustAddMatches()) {
            // no need to add to normal match points or to propagate to
            // match parent. Check whether the mode needs to be updated
            // (see similar call below for explanation)
            if(this.topMatchPointUpdatedForAll())
		        this.setMode();
            return;
        }
	}

	var count;

	if(this.matchPoints.has(pathId)) {
		count = this.matchPoints.get(pathId) + 1;
        this.matchPoints.set(pathId, count);
	} else {
		count = 1;
        this.matchPoints.set(pathId, 1);
        if(this.pureProjMatchPoints && this.pureProjMatchPoints.has(pathId)) {
            // was just added to matchPoints, so is no longer a pure
            // projection match point
            this.pureProjMatchPoints.delete(pathId);
        }
	}

	if(count == this.calcMaxMatchPointCount())
		this.matchParent.addToMatchPoints(pathId, this);

    // if the count of the root path match point has not reached (on 
    // selection together with projection) the count of the sub-nodes, 
    // we know that there will be more match points
    // added. Otherwise, we must check the 'has lower count matches'
    // to determine which set of add/remove match function to use
    // (this may be called somewhat superfluously several times during 
    // the update, as match points are added to the different terminal
    // query calculation nodes, but changing the add/remove match functions
    // is very cheap, as no recalculation of matches actually takes place).
    // Outside of the query refresh, only new match points can be added,
    // but the match count of existing match point cannot be increased.
    // Therefore, outside of the query refresh, this can only activate 
    // raising, but not deactivate it.
    if(this.topMatchPointUpdatedForAll())
		this.setMode();
}

// This is an auxiliary function, which increases the count of the 
// given path ID in the projMatchPoints table.

IntersectionQueryCalc.prototype.addToProjMatchPoints = 
	intersectionQueryCalcAddToProjMatchPoints;

function intersectionQueryCalcAddToProjMatchPoints(pathId)
{
    if(!this.projMatchPoints) {
        this.projMatchPoints = new Map();
        this.projMatchPoints.set(pathId, 1);
    } else if(!this.projMatchPoints.has(pathId))
        this.projMatchPoints.set(pathId, 1);
    else {
        var count = this.projMatchPoints.get(pathId) + 1;
		this.projMatchPoints.set(pathId, count);
    }

    if(!this.matchPoints.has(pathId) && !this.subProjMustAddMatches()) {
        // this match point will not be added to 'matchPoints' if it is
        // not already in 'matchPoints', it is a pure match point.
        if(!this.pureProjMatchPoints)
            this.pureProjMatchPoints = new Map();
        this.pureProjMatchPoints.set(pathId, true);
    }
}

// This function increases by 1 the count of the given path ID in the 
// matchPoints table of this query calculation node.
// This function also updates the pureProjMatchPoints table.

IntersectionQueryCalc.prototype.increaseMatchPointCount = 
    intersectionQueryCalcIncreaseMatchPointCount;

function intersectionQueryCalcIncreaseMatchPointCount(pathId)
{
    if(this.matchPoints.has(pathId)) {
        var count = this.matchPoints.get(pathId) + 1;
        this.matchPoints.set(pathId, count);
    } else {
		this.matchPoints.set(pathId, 1);
        if(this.pureProjMatchPoints && this.pureProjMatchPoints.has(pathId)) {
            // this match point was a pure projection match point but not
            // any longer, delete it from the list.
            this.pureProjMatchPoints.delete(pathId); 
        }
	}   
}


// This function is called by a sub-query when a match point (path ID)
// is removed from that sub-query. 'source' is the 'this' pointer of the
// object which called this function.
// If the sub-query is a projection, the match point count should be
// decreased in the 'projMatchPoints' table. If the projection sub-query does
// not need to add its matches to this intersection node, there is 
// no need to remove this match point from 'matchPoints' (which is used
// for selection) and there is no need to propagate this removal to
// the match parent.
// If this match point was not received from a sub-projection or the
// sub-projection is required to add its matches to the intersection,
// the count of this match point in the 'matchPoints' table is 
// decreased by 1. If the count of this path ID was just decreased from
// the number of matching sub-nodes (that is, sub-nodes which add
// their matches to this intersection: all selection sub-queries and, 
// if subProjMustAddMatches() returns true, also all sub-projections)
// this function calls itself recursively on the match parent node (with 
// the same path ID).
// The match point counts determine whether raising has to take place
// when updating the matches. Since we now modified the match point count,
// this property may have changed. Since a match point is removed it
// can only be that we previously had to raise matches and now no longer
// need to do so. This can happen only if the count of the match dropped
// to zero. Therefore, if the count just dropped to zero, we check 
// whether raising is necessary. If it is not necessary, we set the 
// method for adding and removing matches to one which does not attempt
// to raise matches (it may be that the query calculation node was already
// in this mode: this is tested inside the function which sets the mode). 
// This function may either be called when query calcualtion nodes are 
// removed or when data elements are removed from the indexer. In the first
// case, match node is removed after then matches were removed, but before
// the sub-query is removed.

IntersectionQueryCalc.prototype.removeFromMatchPoints = 
	intersectionQueryCalcRemoveFromMatchPoints;

function intersectionQueryCalcRemoveFromMatchPoints(pathId, source)
{
    if(source && source.isProjection()) {
        this.decreaseProjMatchPointCount(pathId);
        if(!this.subProjMustAddMatches())
            // no need to remove from normal match points. 
            return;
	}

	var origCount = this.matchPoints.get(pathId);
    this.decreaseMatchPointCount(pathId);

	if(origCount == this.calcMaxMatchPointCount())
		this.matchParent.removeFromMatchPoints(pathId, this);

    // as a result of the removal of this match point, it may be that 
    // raising of matches on this intersection node became unnecessary
    // (but not the other way around). This can only happen if we
    // just removed the last count for this match point (origCount == 1)
    // We therefore update here the way matches are added and removed
    // if origCount == 1 and there are no longer any match counts lower 
    // than the maximal match count.
	if(origCount == 1 && !this.calcRaisingRequired())
		this.setMode();
}

// This function decreased by 1 the count of the given path ID in the 
// projMatchPoints table of this query calculation node. It is 
// assumed that this function is called only if the mach point is indeed
// in the projMatchPoints table.
// This function also updates the pureProjMatchPoints table.

IntersectionQueryCalc.prototype.decreaseProjMatchPointCount = 
    intersectionQueryCalcDecreaseProjMatchPointCount;

function intersectionQueryCalcDecreaseProjMatchPointCount(pathId)
{
    var count = this.projMatchPoints.get(pathId) - 1;
    if(count === 0) {
        this.projMatchPoints.delete(pathId);
        if(this.pureProjMatchPoints && this.pureProjMatchPoints.has(pathId))
            this.pureProjMatchPoints.delete(pathId);
        // as a result of the removal of this projection match point it
        // may be that lowering of projections is not longer necessary.
        if(!this.calcLoweringRequired())
            this.setMode();
    } else
        this.projMatchPoints.set(pathId, count);
}

// This function decreased by 1 the count of the given path ID in the 
// matchPoints table of this query calculation node. It is 
// assumed that this function is called only if the mach point is indeed
// in the matchPoints table.
// This function also updates the pureProjMatchPoints table.

IntersectionQueryCalc.prototype.decreaseMatchPointCount = 
    intersectionQueryCalcDecreaseMatchPointCount;

function intersectionQueryCalcDecreaseMatchPointCount(pathId)
{
    var count = this.matchPoints.get(pathId) - 1;

    if(count === 0) {
		this.matchPoints.delete(pathId);
        if(this.projMatchPoints && this.projMatchPoints.has(pathId)) {
            // this match point became a pure projection match point
            if(!this.pureProjMatchPoints) {
                this.pureProjMatchPoints = new Map();
            }
            this.pureProjMatchPoints.set(pathId, true); 
        }
	} else
        this.matchPoints.set(pathId, count);
}

///////////////////////
// Sub-Query Removal //
///////////////////////

// The functions in this section handle the update of the intersection 
// query calcualtion node in the case a query calculation node is removed.
// This includes both the direct removal of a sub-node of the intersection
// query calcualtion node and the indirect effects of removing a 
// query calculation node elsewhere in the query structure.
//
// For a general description of the algorithm for handling such a removal,
// see the introduction to the code selction "Sub-Query Removal" in
// InternalQueryCalc.js. The documentation below is for the specific
// implementation of that algorithm for the intersection query calculation
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
// First, the node is suspended, freezing its matches until they are 
// recalculated. This is done before any match point update, as the 
// match calculation may be affected by the changes in the match points.
// While the update could, in some cases, also be calcualted without
// suspension, this simplifies the code (as the standard match adding
// and removal functions can be used) and considering the nature of
// the operation seems not too expensive.  
//
// This function then checks whether the removed node was a selection
// (and was removed directly under this node). In this case, there is
// only need to update the match points and matches of this node
// and the rest of the update takes place by propagation through
// the standard addToMatchPoints(), removFromMatchPoints(), addMatches()
// and removeMatches().
//
// Otherwise, subNode was a projection and was either removed or
// changed into a selection. The function updates this node's list
// of projection nodes and removes this node as a generating projection
// of the root query calculation node, if the number of projection
// sub-nodes dropped from 2 to 1.
//   
// If this node changed from a projection to a selection as a result
// of this update, the change is then propagated to the dominating node.
// These dominating nodes then refresh their match points and matches
// based on the old (before the update) match points and matches
// of this node. If the dominating node is the root query calculation node,
// the change is also propagated, to allow the root query calculation node
// to prepare itself for notifications for the new query structure.
//
// In the next step, the match points and matches of this node are
// updated. This happens while the node is suspended.
//
// Finally, if this node previously required its projection sub-nodes
// to add their selection matches and now no longer requires this,
// the (single) remaining projection sub-node must be notified of this
// change of property, as this may also affect this property
// for this sub-projection and its projection sub-nodes.
//
// Finally, the node is unsuspended, completing the recalculation 
// of the matches and notifying other nodes of the changes in 
// matches. 

IntersectionQueryCalc.prototype.updateQueryAfterNodeRemoval = 
    intersectionQueryCalcUpdateQueryAfterNodeRemoval;

function intersectionQueryCalcUpdateQueryAfterNodeRemoval(subNode)
{
    var subProjAddedMatches = 
        this.isProjection() && this.subProjMustAddMatches(); // before update

    var subNodeId = subNode.getId();
    // true if sub-node was removed under this node.
    var subNodeRemoved = !(subNodeId in this.subNodes);
    var wasProjection = 
        (this.projSubNodes !== undefined && (subNodeId in this.projSubNodes));

    // suspend the node (this makes match point and match updates easier)
    this.suspend();

    if(wasProjection) {
        // the projection sub-node was removed or changed into a selection
        delete this.projSubNodes[subNodeId];
        this.projSubNodeNum--;

        if(this.projSubNodeNum == 1) // dropped from 2 to 1
            // remove this as a generating projection
            this.rootQueryCalc.removeGeneratingProj(this);

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

    // update match points and matches
    this.updateMatchingAfterRemoval(subNode, wasProjection, subNodeRemoved, 
                                    subProjAddedMatches);

    if(wasProjection && this.projSubNodeNum == 1) { // dropped from 2 to 1
        // check whether the remaining sub-projection still needs to 
        // add its matches
        if(!this.subProjMustAddMatches())
            this.unsetSubProjsMustAddMatches();
    }

    this.unsuspend();
}

// This function is called on this query calculation node (which must
// be a projection) during the processing of a node removal. This
// node removed must have been a projection and resulted in the change
// of the 'sub-projections must add matches' property on this node
// from true to false. This function then first updates its own
// match points and matches to accomodate for this change (using 
// the single sub-projection's match points and matches from 
// before the update). The node is suspended while this operation takes 
// place (to make the update simpler). It then removes the 'mustAddMatches'
// property from its projection sub-nodes, which may, in turn, 
// propagate this property update further down its projection sub-nodes.
// This recursive operation may incrementally update the match points
// of this node.

IntersectionQueryCalc.prototype.unsetSubProjsMustAddMatches = 
	intersectionQueryCalcUnsetSubProjsMustAddMatches;

function intersectionQueryCalcUnsetSubProjsMustAddMatches()
{
    var wasSuspended; // was this node suspended upon entering the function

    if(!(wasSuspended = this.isSuspended())) // suspend, if not yet suspended
        this.suspend();

    for(var id in this.projSubNodes) {
        var projSubNode = this.projSubNodes[id];
        // the following function is called with 'false' as second argument
        // so that only the match points and not the projection match points
        // are removed.
        this.removeSubNodeMatchPoints(projSubNode, false);
        // remove the sub-node matches (this node is suspended)
        this.removeMatches(projSubNode.getMatches(), projSubNode);
        projSubNode.unsetMustAddMatches();
    }

    if(!wasSuspended) 
        // the suspension took place inside this function, so it must be undone
        // here too
        this.unsuspend();
}

//
// Matching (Match Points and Matches) Update after Node Removal
//

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
// and matches of this node need to be updated. For the different 
// specific cases, see the code below.
// At the time this function is called, the match points and matches
// of subNode have not (yet) been updated, so all function here which read
// the match points and matches from the sub-node get the values from before
// the removal of the sub-node. This node is suspended throught
// the operation of this function.

IntersectionQueryCalc.prototype.updateMatchingAfterRemoval = 
    intersectionQueryCalcUpdateMatchingAfterRemoval;

function intersectionQueryCalcUpdateMatchingAfterRemoval(subNode,
                                                         wasProjection,
                                                         subNodeRemoved, 
                                                         subProjAddedMatches)
{
    var subNodeMatches;

    // cases below where the matches need to be updated
    if(!wasProjection || !!subNodeRemoved == !!subProjAddedMatches)
        subNodeMatches = subNode.getMatches();

    if(!wasProjection) {
        this.removeSubNodeMatchPoints(subNode, false);
        this.removeMatches(subNodeMatches, subNode);
        return;
    }
        
    // remove the match points and matches of the removed projection node
    if(subNodeRemoved) {
        if(subProjAddedMatches) {
            // remove sub-node's match points
            this.removeSubNodeMatchPoints(subNode, true);
            this.removeMatches(subNodeMatches, subNode);
        } else { // only remove from the projection match points
            this.removeSubNodeMatchPointsAsProj(subNode);
            // no need to update matches, the projection matches will
            // be updated when the node is unsuspended.
        }
    } else {
        // node changed from projection to selection. Remove its match 
        // points from the projection match points of this node
        this.removeSubNodeMatchPointsAsProj(subNode);
        if(!subProjAddedMatches) {
            // the sub-node did not add its matches to this node before
            // the change, so need to add the sub-node's match points
            // as match points of this node.
            this.addSubNodeMatchPoints(subNode);
            this.addMatches(subNodeMatches, subNode);
        }
    }
}

//
// Match Point Removal and Addition after Node Removal
//

// This function removes the match points of subNode (which is or was
// a sub-node of this node) from the match points of this node.
// 'removeProjMatchPoints' indicates whether the subNode match points should 
// also be removed from the projMatchPoint list. 'removeProjMatchPoints' can 
// only be true if subNode is a projection, but it may also be false if subNode
// is a projection. This is used in case subNode had to add its selection
// matches before the sub-node removal but does not have to do that anymore
// after the removal. In this case, we want to remove the match points
// of subNode (which is *not* the sub-node removed or the one the removal 
// took place under) from the matchPoints list, but not from the 
// 'projMatchPoints' list.
// Since all the match points of a sub-node are removed, it follows
// that the maximal match count is also decreased by 1. Therefore, all
// match points which previously had a maximal count remain match points
// with a maximal count. This operation can, therefore, only add match
// points to the dominating query calculation node.

IntersectionQueryCalc.prototype.removeSubNodeMatchPoints = 
    intersectionQueryCalcRemoveSubNodeMatchPoints;

function intersectionQueryCalcRemoveSubNodeMatchPoints(subNode, 
                                                       removeProjMatchPoints)
{
    var prevMatchPoints = this.getFullCountMatchPoints();

    var _self = this;
    subNode.getFullCountMatchPoints().forEach(function(t, pathId) {
        if(removeProjMatchPoints)
            _self.decreaseProjMatchPointCount(pathId);
        _self.decreaseMatchPointCount(pathId);
    });

    // find the maximal count match points which were added by this 
    // operation and add them to the parent.

    this.getFullCountMatchPoints().forEach(function(t, pathId) {
        if(!prevMatchPoints.has(pathId))
            _self.matchParent.addToMatchPoints(pathId, _self);
    });
}

// This function removes the match points of subNode from the 
// projMatchPoints table of this node, but not from the matchPoints
// table if this node (this is in case the sub-node did not add its
// selection matches to this node before the removal of the sub-node
// or if the sub-node changed from a projection to a selection and 
// did add it selection matches before the change).  

IntersectionQueryCalc.prototype.removeSubNodeMatchPointsAsProj = 
    intersectionQueryCalcRemoveSubNodeMatchPointsAsProj;

function intersectionQueryCalcRemoveSubNodeMatchPointsAsProj(subNode) 
{
    var _self = this;
    subNode.getFullCountMatchPoints().forEach(function(t, pathId){
        _self.decreaseProjMatchPointCount(pathId);
    });
}

// This function adds the match points of subNode, which is a sub-node
// of this node and was a projection and has now become a selection.
// This function is called in case the projection did not previously 
// add its selection matches to this node. Since this increases
// the maximal match point count, this may remove full match points.
// This function therefore first stores the list of full match points
// and then compares this old list with the new list (after the update)
// and removes the difference from the parent node (using the standard
// 'removeFromProjMatches()' function). 

IntersectionQueryCalc.prototype.addSubNodeMatchPoints = 
    intersectionQueryCalcAddSubNodeMatchPoints;

function intersectionQueryCalcAddSubNodeMatchPoints(subNode, 
                                                    removeProjMatchPoints)
{
    var prevMatchPoints = this.getFullCountMatchPoints();

    var _self = this;
    subNode.getFullCountMatchPoints().forEach(function(count, pathId) {
        _self.increaseMatchPointCount(pathId);
    });

    // find the maximal count match points which were removed by this 
    // operation and remove them from the parent.
    
    var newMatchPoints = this.getFullCountMatchPoints();

    prevMatchPoints.forEach(function(t, pathId) { 
        if(!newMatchPoints.has(pathId))
            _self.matchParent.removeFromMatchPoints(pathId, _self);
    });
}

///////////////////
// Query Refresh //
///////////////////

//
// Structure Refresh
//

// This function is called in the structure refresh phase of the query
// refresh (for full documentation, see the 'query refresh' section 
// of the base class). This first refreshes the structure of the sub-queries
// and then updates its own number of sub-projections.
// This function is also responsible for detecting changes in the 
// subProjMustAddMatches() property. If the number of projection sub-nodes 
// after the refesh is at least 2, the subProjMustAddMatches() 
// property must be set on all sub-projections of this node. This
// takes place in the function setSubProjsMustAddMatches() which 
// also takes care of distinguishing between this being a new 
// proeprty or an already existing property (from before the refresh)
// of this node.
// If the number of sub-projections under this nodes increased from 
// less than 2 to 2 or more, this query calculation node has become
// a generating projection and the root query calculation node needs
// to be notified. The status of this node can also change to be a generating
// projection if the parent node becomes a projection but this node
// is a selection (in which case this node becomes a selection-projection).
// It is then the responsibility of the parent node to refresh the 
// generating projection status of this node.
//
// For the update of the match points and the matches (the following steps
// in the query refresh process), the following property is important:
//
//    a sub-node under an intersection query calculation node
//    can be identified by a path (this path is defined in the query
//    compilation process). This path cannot change, that is, when a
//    query calculation sub-node exists both before and after the refresh,
//    the path identifying it before and after the refresh is the same.
//    The match points with count larger than 1 are exactly those paths in the 
//    indexer which carry data elements and are a common prefix of two or
//    more of these paths, for the sub-nodes which add their matches to this
//    intersection node (that is, all sub-nodes, except, perhaps, for a single
//    projection sub-node).
//    This means that as long as no new sub-nodes are added and as 
//    long as no existing selection becomes a projection, there cannot
//    be any change in the set of match points with count larger than 1.  
//    
// Therefore, as long as no new sub-nodes are added or a selection
// sub-node becomes a projection, it is enough to refresh the 
// match points and the matches of the sub-nodes and there is nothing more 
// to do. This is because match points with count higher than 1 cannot 
// change their count while match points with count 1 are handled correctly by 
// the standard addToMatchPoints(), removeFromMatchPoints(), addMatches()
// and removeMatches() called from the update of lower sub-nodes. 
//
// In addition, if the maximal match point count is zero (that is, this
// is the initial update) there is no need to do anything except 
// refresh the sub-nodes.
//
// If this property does not hold, we need to suspend the node. This 
// means, among other things, that the current matches are stored.
// This need to be done before the match points are updated and before the
// projection sub-nodes are added, as this can affect the calculation
// of the list of matches.

IntersectionQueryCalc.prototype.refreshQueryStructure = 
    intersectionQueryCalcRefreshQueryStructure;

function intersectionQueryCalcRefreshQueryStructure()
{
    var prevProjSubNodeNum = this.projSubNodeNum ? this.projSubNodeNum : 0;
    // this is the initial update if there maximal match point count is 0
    var initialUpdate = (this.getFullMatchCount() == 0);

    // loop over the modified and new sub-nodes
    for(var id in this.updatedSubNodes) {
        
        var isNew = this.updatedSubNodes[id];
        var subQueryCalc = this.subNodes[id];
        var wasProjection = subQueryCalc.isProjection(); // before the refresh

        // recursively updated the lower nodes
        subQueryCalc.refreshQueryStructure();
        
        if(!initialUpdate && 
           (isNew || (!wasProjection && subQueryCalc.isProjection())))
            // need to suspend (see introduction)
            this.suspend();

        // is this a new node which is a projection or a selection which
        // became a projection ? Update the projection count
        if((isNew || !wasProjection) && subQueryCalc.isProjection()) {
            if(!this.projSubNodes)
                this.projSubNodes = {};
            this.projSubNodes[id] = subQueryCalc;
            if(!this.projSubNodeNum) {
                this.projSubNodeNum = 1;
                if(this.projMatchPoints === undefined)
                    this.projMatchPoints = new Map();
            } else 
                this.projSubNodeNum++;            
            
            if(!isNew) { // a selection which became a projection
                if(!this.selectionBecameProjection)
                    this.selectionBecameProjection = {};
                this.selectionBecameProjection[id] = true;
            }
        }
    }

    if(this.parent && this.parent.subProjMustAddMatches())
        // continues to update recursively if this property is new
        this.setMustAddMatches();
    else if(this.projSubNodeNum > 1)
        // indicate that sub-projections need to add their selection
        // matches (this recusively updates this property on lower nodes)
        this.setSubProjsMustAddMatches(); 
        
    if(this.projSubNodeNum > 1 && prevProjSubNodeNum <= 1)
        // just became a generating projection, notify the root query
        // calculation node
        this.rootQueryCalc.addIntersectionGeneratingProj(this);
    else if(this.projSubNodeNum > 0 && prevProjSubNodeNum == 0 && 
            !this.isGeneratingProjection())
        // this may have been a selection-projection generating projection
        // if it wasn't, the removal here does no harm.
        this.rootQueryCalc.removeGeneratingProj(this);
}

// This function is called on this query calculation node (which must
// be a projection) during the structure refresh phase to indicate that 
// the sub-projections of this intersection need to add their 
// selection matches to this node. The function first notifies its
// sub-projections of this requirement. These sub-nodes return true
// if this property has changed and false if it did not change.
// New projection sub-nodes always return true.
// If some node returns false, this property already held for this
// sub-node (which must be an existing projection). Otherwise 
// (if all sub-node returned 'true') all these sub-nodes are marked
// as new nodes in the this.updatedSubNodes table. This means that 
// their match point and matches will be updated on this node in 
// the next steps of the refresh. The projMatchPoints table is also
// cleared in this case, as all those match points will be added 
// again.

IntersectionQueryCalc.prototype.setSubProjsMustAddMatches = 
	intersectionQueryCalcSetSubProjsMustAddMatches;

function intersectionQueryCalcSetSubProjsMustAddMatches()
{
    // this is set to true if it turns out that the existing sub-projections
    // had to add their selection matches already before this refresh.
    var propertyAlreadySet = false;

    // set this property on the projection sub-nodes 
    for(var id in this.projSubNodes) {
        if(!this.projSubNodes[id].setMustAddMatches())
            // not new property for this sub-node (this should be the same
            // for all existing projections, but new sub-nodes and 
            // selection which became projections always return 'true') 
            propertyAlreadySet = true;
        else if(!this.selectionBecameProjection || 
                !this.selectionBecameProjection[id])
            // this sub-node is new or was a projection also before the
            // refresh. We mark it as "new" (even if it is already marked so)
            // to make sure its match points and selection matches are 
            // properly updated.
            this.addUpdatedSubNode(id, true);
    }

    if(!propertyAlreadySet) {
        this.projMatchPoints = new Map();
        this.pureProjMatchPoints = new Map();
    }
}

//
// Match Point Refresh
//

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
// For the refresh of its own match points, the following property is 
// important in determining what this function needs to do:
//
//    a sub-node under an intersection query calculation node
//    can be identified by a path (this path is defined in the query
//    compilation process). This path cannot change, that is, when a
//    query calculation sub-node exists both before and after the refresh,
//    the path identifying it before and after the refresh is the same.
//    The match points with count larger than 1 are exactly those paths in the 
//    indexer which carry data elements and are a common prefix of two or
//    more of these paths, for the sub-nodes which add their matches to this
//    intersection node (that is, all sub-nodes, except, perhaps, for a single
//    projection sub-node).
//    This means that as long as no new sub-nodes are added and as 
//    long as no existing selection becomes a projection, there cannot
//    be any change in the set of match points with count larger than 1.  
//    
// Therefore, as long as no new sub-nodes are added or a selection
// sub-node becomes a projection, it is enough to refresh the 
// match points of the sub-nodes and there is nothing more to do.
// This is because match points with count higher than 1 cannot change their
// count while match points with count 1 are handled correctly by 
// the standard addToMatchPoints() and removeFromMatchPoints() called
// from the update of the sub-nodes.
//
// In addition, if the maximal match point count is zero (that is, this
// is the initial update) there is no need to do anything except 
// refresh the sub-nodes.
//
// If this is not the initial update and either new sub-nodes were added
// or a selection became a projection, the structural refresh function
// already suspended this node.
// 
// To refresh its own match points, this function needs to do the following:
// 1. If this node was suspended:
//    a. The function determines the list of full count match points (those 
//       match points whose count was equal to the maximal count) before 
//       the refresh.
//    b. Next, this.subNodeNum is increased by 2. This ensures that during
//       the update process, all math point counts will be lower than
//       the calculated maximal match point count and therefore the match
//       parent will not be updated with added and removed match points.
//       Moreover, updates of the node mode (e.g. with regard to raising)
//       which wait for the actual match point count on the root path to
//       reach its expected value, will also not take place.
// 2. The match points of the sub-nodes are then refreshed. In addition,
//    if the node is suspended:
//    a. For new sub-nodes, before their match points are refreshed, 
//       the existing match points are first added.
//    b. For each existing sub-node which changed from a selection to a 
//       projection, the match points of the node need to be added to the 
//       projection match point table. If there is exactly one such node
//       and its matches do not need to be added to this intersection node,
//       its match points (which were previously added to the match points of
//       this intersection node) need to be removed from the list of 
//       match points.
// 3. If the node was suspended, then after all sub-node math points 
//    have been refreshed, this.subNodeNum is decreased by 2 (after
//    being increased at the beginning of the refresh by 2). The new
//    full count match points of this node can now be calculated. This
//    list is compared with the original list created at the beginning
//    of the refresh and the match parent is notified of the
//    difference (through the standard addToMatchPoints() and
//    removeFromMatchPoints() interface).
// 4. If the node was not suspended, the mode of the node (whether raising 
//    of matches needs to take place) is updated. Otherwise, this will
//    wait until selection matching on the node is unsuspended (after
//    the matches are refreshed).

IntersectionQueryCalc.prototype.refreshMatchPoints = 
    intersectionQueryCalcRefreshMatchPoints;

function intersectionQueryCalcRefreshMatchPoints()
{
    if(!this.isSuspended()) { // only refresh the sub-nodes

        for(var id in this.updatedSubNodes)
            this.subNodes[id].refreshMatchPoints();
        
        this.setMode(); // set the mode

    } else { 
        // suspended: not initial update and new sub-nodes added or
        // sub-selection became projection

        // store the current list of full count match points
        var prevFullCountMatchPoints = this.getFullCountMatchPoints();
        var subProjMustAddMatches = this.subProjMustAddMatches();
        this.subNodeNum += 2; // suspends various updates (see documentation)
        var _self = this;
        
        for(var id in this.updatedSubNodes) {
        
            var subQueryCalc = this.subNodes[id];

            if(this.updatedSubNodes[id]) { // is new sub-node
                // add the existing match points on the sub-node (if any)
                // before refreshing that node (usually, but not always, this
                // list is empty)
                subQueryCalc.getFullCountMatchPoints().
                    forEach(function(t, pathId) {
                        _self.addToMatchPoints(pathId, subQueryCalc);
                    });
            } else if(this.selectionBecameProjection && 
                      this.selectionBecameProjection[id]) {
                subQueryCalc.getFullCountMatchPoints().
                    forEach(function(t,pathId) {
                        // add the match point to the projection match points
                        _self.addToProjMatchPoints(pathId);
                        if(!subProjMustAddMatches) 
                            // we call the function with 'undefined' as the
                            // second argument so as to remove the match point
                            // from 'matchPoints' but not from 'projMatchPoints'
                            _self.removeFromMatchPoints(pathId, undefined);
                    });
            }

            subQueryCalc.refreshMatchPoints();
        }

        this.subNodeNum -= 2; // unsuspend

        var newFullCountMatchPoints = this.getFullCountMatchPoints();
        
        // add to the parent new full count match points
        newFullCountMatchPoints.forEach(function(t, pathId) {
            if(!prevFullCountMatchPoints.has(pathId))
                _self.matchParent.addToMatchPoints(pathId, _self);
        });
        
        // remove from the parent old full count match points
        prevFullCountMatchPoints.forEach(function(t, pathId) {
            if(!newFullCountMatchPoints.has(pathId))
                _self.matchParent.removeFromMatchPoints(pathId, _self);
        });
    }
}

//
// Match Refresh
//

// The match refresh phase starts by refreshing the matches of the 
// sub-nodes. If matching was not suspended by the structural refresh,
// this is enough to update the matches also on the parent node 
// (and also updates the projection matches on this node, if necessary).
// Note that during this refresh, matches may be removed by sub-nodes
// for match points which are no longer in the match point table.
// As explained in the introduction to the match point refresh,
// this means that these match points had a count of 1 and therefore,
// the match removal functions handle them correctly (the match point
// count is undefined and this indicates a match).
//
// This function recursively calls the match refresh function on the 
// updated sub-nodes. This then results in an incremental update
// from the sub-nodes. In case of structural change, this function 
// must first update its matches based on the matches of the sub nodes
// before the refresh. This needs to be done in the following cases:
// 1. If a selection became a projection and projections do not need
//    to add their matches. In this case, all the matches of the 
//    selection need to be removed from this node.
// 2. If a sub-node is new and it has to add its matches, all its existing
//    matches need to be added (often, the list of existing matches
//    is empty, because the sub-node is new and has not yet refreshed
//    its matches, but we do not know this for certain).
// Note: when adding of selection matches by projection sub-nodes is
// turned on, the projection sub-nodes which were not previously selections
// are marked as new to ensure that their matches are added here.
//
// If matching was suspended, it is unsuspended after refreshing 
// the matches of the sub-node. At that point, the 'matches' table
// is already updated with the new match counts, but no raising 
// took place. As the list of matches from before the refresh was stored
// during suspension, the unsuspend() function can notify 
// the parent with the matches added and removed relative to the suspended
// list of matches. The unsuspend() function is responsible for
// performing raising, where necessary, and calculating the difference
// with the suspended matches and notifying the parent node of this
// difference.

IntersectionQueryCalc.prototype.refreshMatches = 
    intersectionQueryCalcRefreshMatches;

function intersectionQueryCalcRefreshMatches()
{
    var subProjMustAddMatches = this.subProjMustAddMatches();

    // make sure the match table can store the required count
    this.matches.adjustByteNumber(this.subNodeNum);
    
    // if projections don't need to add their matches, remove matches
    // of existing sub-nodes which changed from selection to projection 
    if(!subProjMustAddMatches && this.selectionBecameProjection) {
        for(var id in this.selectionBecameProjection) {
            var subNode = this.subNodes[id];
            this.removeMatches(subNode.getMatches(), subNode);
        }
    }

    for(var id in this.updatedSubNodes) {
        
        // if this sub-node needs to add matches and it is new, add 
        // its existing matches before updating its matches (which will
        // result in an incremental update)

        var subNode = this.subNodes[id];

        if(this.updatedSubNodes[id] &&
           (this.projSubNodes === undefined || !(id in this.projSubNodes) || 
            subProjMustAddMatches))
            // new sub-node which is a selection or an adding projection
            this.addMatches(subNode.getMatches(), subNode);

        // update the matches of the sub-node (with incremental update
        // of this node)
        subNode.refreshMatches();
    }

    // unsuspend, if needed
    this.unsuspend();

    // clear fields at end of update
    this.updatedSubNodes = undefined;
    if(this.selectionBecameProjection)
        this.selectionBecameProjection = undefined;
}

////////////////
// Suspension //
////////////////

// This function is called when the node is suspended. It should be called 
// after the suspension mode has been set (so that projection matches 
// will not be updated). The function stores all the full matches 
// in a temporary table (this.suspendedMatches) and clears all raised matches. 
// The suspension takes place before the match points are updated, so 
// the match point table is still that with which the matches were calculated. 
// This function does not change the projection matches on this node
// (if any). After the node is unsuspended, it will recalculate the
// projection matches and then update its sub-projection with the
// difference between the old projection matches and the new ones.

IntersectionQueryCalc.prototype.suspendSelection = 
	intersectionQueryCalcSuspendSelection;

function intersectionQueryCalcSuspendSelection()
{
    this.suspendedMatches = this.getMatchesAsObj();

	if(this.raisedMatches) {

		// remove matches which appear in the 'raisedMatches' table
		
        var _self = this;
        
        this.raisedMatches.forEach(function(entry, elementId) {
            entry.forEach(function(count, matchPoint) {
                var count = _self.matches.get(elementId) -
                    _self.matchPoints.get(matchPoint);
				if(count == 0)
					_self.matches.delete(elementId);
                else
                    _self.matches.set(elementId, count);
			});
		});

		this.raisedMatches = new Map();
	}
}

// This function is called when projection calculation is suspended on 
// this node. If resultId is defined, projection matches are suspended
// only for this result node (this is used to reset the projection matches
// in setProjMatches()). If resultId is not defined, the suspension is 
// for all result node.
// This function first checks that the node is a projection 
// node. If it is, this function makes sure that 'this.projMatches'
// stores all projection matches of this node, including lowered
// projection matches which are not normally stored in this table.
// As only lower projection matches at pure projection match points are not
// stored in this.projMatches, this function does not do anything if
// there are no pure projection match points. If there are pure match
// points, the matches in this.projMatches are lowered to these pure match
// points and these lowered matches are added to this.projMatches.

IntersectionQueryCalc.prototype.suspendProjMatches = 
	intersectionQueryCalcSuspendProjMatches;

function intersectionQueryCalcSuspendProjMatches(resultId)
{
    if(!this.isProjection())
        return;

    if(this.pureProjMatchPoints === undefined ||
       this.pureProjMatchPoints.size === 0)
        return; // no lowering needed

    if(!this.projMatches)
        return; // no projection matches added yet

    if(resultId === undefined) {
        var _self = this;
        this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                              resultId) {
            _self.suspendProjMatches(resultId);
        });
        return;
    }

    if(!this.projMatches.has(resultId))
        return; // no projection matches yet for this result ID
    
    var pureProjMatchPoints = [];

    this.pureProjMatchPoints.forEach(function(t,pathId){
        pureProjMatchPoints.push(pathId);
    });

    var thisProjMatches = this.projMatches.get(resultId);
    var projMatches = [];
    thisProjMatches.forEach(function(count, elementId) {
        projMatches.push(elementId);
    });

    var numOrigProjMatches = projMatches.length;
    projMatches = this.indexer.getDataElements().
        lowerDataElementsTo(projMatches, pureProjMatchPoints);

    for(var i = numOrigProjMatches, l = projMatches.length ; i < l ; ++i) 
        thisProjMatches.set(projMatches[i], 1);
}

// This function should be called for an intersection node which was
// suspended and after the match refresh already carries all the matches 
// it received from the sub-nodes, but raised matches were not calculated 
// and no matches were forwarded to the parent. This function then calculates 
// all raised matches and (by comparing with this.suspendedMatches) 
// return an array of element IDs which are the new full matches 
// of the intersection node, which were not matches before the suspension.

IntersectionQueryCalc.prototype.calcNewFullMatchesAfterSuspension = 
	intersectionQueryCalcCalcNewFullMatchesAfterSuspension;

function intersectionQueryCalcCalcNewFullMatchesAfterSuspension()
{
	var maxCount = this.getFullMatchCount();
    // addedMatches is undefined if there is no need to calculate
    // the difference with the previous match
	var addedMatches = this.shouldAddMatches() ? [] : undefined;
	// is this a projection with projection match points?
	var isProjection = this.isProjection();

    var _self = this;
    
	if(!this.calcRaisingRequired()) {
		// no raising, only forwarding of matches to parent
        if(!addedMatches)
            return; // no need to update parent
        this.matches.forEach(function(count, elementId) {
			if(count >= maxCount && !_self.suspendedMatches.has(elementId))
				addedMatches.push(elementId);
        });
	} else {

		var dataElements = this.indexer.getDataElements();
        this.matches.forEach(function(count, elementId) {

			if(_self.raisedMatches.has(elementId))
				return; // handled during raising

			while(1) {
				count = _self.matches.get(elementId);
                var elementEntry = dataElements.getEntry(elementId);
				var matchPoint = elementEntry.pathId;
				
				if(count != _self.matchPoints.get(matchPoint))
					break; // not a match

				if(count == maxCount) {
					if(addedMatches) { 
                        // not a projection or adds matches to parent
                        if(!_self.suspendedMatches.has(elementId))
						    addedMatches.push(elementId);
					    break; // is a full match
                    } else if(_self.projMatchPoints.get(matchPoint))
                        break; // is a full match
				}

				// raise to parent
				var parentId = elementEntry.parent;
				var entry;
                if(_self.raisedMatches.has(parentId))
                    entry = _self.raisedMatches.get(parentId);
                else {
                    entry = new Map();
                    _self.raisedMatches.set(parentId, entry);
                }
				if(!entry.has(matchPoint)) {
					if(isProjection && _self.projMatchPoints.get(matchPoint)) {
						var pointEntry = new Map();
                        entry.set(matchPoint, pointEntry);
						pointEntry.set(elementId, true);
					} else
						entry.set(matchPoint, 1);
				} else {
					if(isProjection && _self.projMatchPoints.get(matchPoint)) {
						var pointEntry = entry.get(matchPoint);
						pointEntry.set(elementId, true);
					} else
						entry.set(matchPoint, entry.get(matchPoint)+1);
					break; // already raised for this match point
				}
				if(!_self.matches.has(parentId))
					_self.matches.set(parentId, 1);
				else
					_self.matches.set(parentId, _self.matches.get(parentId)+1);

				elementId = parentId;
			}
		});
	}
	
    return addedMatches;
}

// This function should be called when a suspended node is unsuspended.
// It should be called after the new matches of the node have already
// been calculated. It then goes over all suspended matches and returns
// an array of all suspended matches which are no longer matches
// (that is, whose count in the matches table is no longer the maximal
// count).

IntersectionQueryCalc.prototype.calcRemovedSuspendedMatches = 
	intersectionQueryCalcCalcRemovedSuspendedMatches;

function intersectionQueryCalcCalcRemovedSuspendedMatches()
{
    var maxCount = this.getFullMatchCount();
    var removedMatches = [];
    var _self = this;

    this.suspendedMatches.forEach(function(count, elementId) {
        if(_self.matches.get(elementId) != maxCount)
            removedMatches.push(elementId);
    });

    return removedMatches;
}

///////////////////////
// Node Mode Setting //
///////////////////////

// This function sets the mode for the various non-suspended
// modes after determining the mode to be used. This is split into 
// determining the selection ode and the projection mode (these two
// need to be activated separately when unsuspending the intersection
// query calculation node)

IntersectionQueryCalc.prototype.setMode = intersectionQueryCalcSetMode;

function intersectionQueryCalcSetMode()
{
    this.setSelectionMode();
    this.setProjectionMode();
}

// This function sets the selection mode (which functions to use for 
// addMatches() and removeMatches() and whether a raisedMatches 
// table is needed) for the various non-suspended modes after determining 
// the mode to be used.

IntersectionQueryCalc.prototype.setSelectionMode = 
    intersectionQueryCalcSetSelectionMode;

function intersectionQueryCalcSetSelectionMode()
{
    // match add/remove

    if(this.calcRaisingRequired()) {
		if(!this.raisedMatches)
			this.raisedMatches = new Map();
		if(this.projSubNodeNum) { // is a projection intersection
			// set the intersection add/remove matches functions
			this.addMatches = this.addMatchesToProj;
			this.removeMatches = this.removeMatchesFromProj;
		} else { // selection intersection
			// set the intersection add/remove matches functions
			this.addMatches = this.addMatchesWithRaising;
			this.removeMatches = this.removeMatchesWithRaising;
		}
	} else {
		if(this.raisedMatches)
			delete this.raisedMatches;
		// set the non-raising intersection add/remove matches functions
		this.addMatches = this.addMatchesWithoutRaising;
		this.removeMatches = this.removeMatchesWithoutRaising;
	}
}

// This function sets the projection mode (which functions to use for 
// addProjMatches() and removeProjMatches()) for the various non-suspended 
// modes after determining the mode to be used.

IntersectionQueryCalc.prototype.setProjectionMode = 
    intersectionQueryCalcSetProjectionMode;

function intersectionQueryCalcSetProjectionMode()
{
    // projection match add/remove

    if(this.calcLoweringRequired()) { // must be a projection
        this.addProjMatches = this.addProjMatchesWithLowering;
		this.removeProjMatches = this.removeProjMatchesWithLowering;
    } else if(this.projSubNodeNum) { // projection, but without lowering
        this.addProjMatches = this.addProjMatchesWithoutLowering;
        this.removeProjMatches = this.removeProjMatchesWithoutLowering;
    } else { 
        // may be a selection-projection (otherwise, the functions below are
        // not called).
        this.addProjMatches = this.addProjMatchesToSelectionProj;
		this.removeProjMatches = this.removeProjMatchesFromSelectionProj;
    }
}

// This function sets this node in the suspended mode. This amounts 
// to setting the addMatches and removeMatches function to those which 
// implement this state.

IntersectionQueryCalc.prototype.setSuspendedMode = 
	intersectionQueryCalcSetSuspendedMode;

function intersectionQueryCalcSetSuspendedMode()
{
	// set the suspended intersection add/remove matches functions
	this.addMatches = this.addMatchesToSuspended;
	this.removeMatches = this.removeMatchesFromSuspended;
	this.addProjMatches = this.addProjMatchesDoNothing;
	this.removeProjMatches = this.removeProjMatchesDoNothing;
}

// This function sets this node in the suspended projection mode. This amounts 
// to setting the addProjMatches and removeProjMatches function to those which 
// do nothing.

IntersectionQueryCalc.prototype.setSuspendedProjectionMode = 
	intersectionQueryCalcSetSuspendedProjectionMode;

function intersectionQueryCalcSetSuspendedProjectionMode()
{
	// set the suspended intersection add/remove proj matches functions
	this.addProjMatches = this.addProjMatchesDoNothing;
	this.removeProjMatches = this.removeProjMatchesDoNothing;
}

//////////////////
// Match Update //
//////////////////

// This is a general description of the match update algorithm 

//
// Adding/Removing (selection) matches
//

// There are several different functions which provide different 
// implementations of the 'addMatches' and 'removeMatches' functions, which 
// are called to add matches to, and remove matches from, this node. 
// This often results in a recursive call to add/remove matches to/from 
// the parent node. The addMatches functions increase the match count of the 
// data elements added and, depending on the match point counts, raises nodes 
// to their data element parent. The removeMatches function perform 
// the opposite operation. Finally, these functions add new matches 
// to the match parent or remove removed matches from the match parent 
// by calling that node's 'addMatches' or 'removeMatches' functions.
//
// There are various implementations of these function, depending on
// whether raising is necessary (that is, there are match points whose count
// is smaller than the maximal match point count on the node), whether
// it is a projection node or a selection-projection node. These
// implementations appear below. After the system has determined the type 
// of the node, it assigns the appropriate function to this.addMatches
// and this.removeMatches.
//
// The following functions are given an array with data element IDs as
// elements (without repetition). The function then increases/decreases the
// match count of these elements on this query calculation node by 1.
// For each element for which a first match has been achieved this
// function then either raises the data element to its parent element
// ID (and increases the count of the parent) or adds a match for the
// element on the parent query calculation node. In case of removal,
// the opposite operation takes place. The exact details are documented
// next to the various implemenetations.

//
// Adding/Removing Projection Matches
//

// If the node is a projection node, we also need to update the
// projection matches, stored in projMatches table. The projMatches table 
// has to be updated both on this node and (possibly) on the projection 
// sub-nodes of this node (and so on, recursively down the projection nodes).
//
// For an intersection node, the projection matches are defined as
// the intersection of the selection matches of the intersection 
// with the projection matches of the parent node. The selection matches
// of this node may have to be raised before being intersected with the
// projection matches of the parent node. This raising is the responsibility
// of the parent node. This is implemented by the paren node's 
// filterProjMatches() function, which, given a set of selection matches
// on this node, returns a subset of the input set which it considers to 
// intersect with its projection matches.
//
// The projection matches stored in projMatches include not only fully 
// matches of the intersection (those whose count is equal to the 
// maximal match point count) but also elements whose count is 
// equal to their match point's count and whose parent is in projMatches.
//
// Having determined the projection matches of this node, the functions
// may need to add or remove projection matches from the projection 
// sub-nodes. This node may then need to perform lowering to the projection
// sub-nodes. For match points on the projection sub-nodes which are 
// not pure projection match points (that is, they are also match points
// on the selection sub-nodes) lowering can only take place to element IDs
// which were raised from the selection sub-nodes (as a match on these 
// elements is required). These projection matches are stored in 
// this.projMatches (see previous paragraph). For match points which are 
// pure projection match points, lowering can be performed to all children 
// of the data elements which are at the appropriate path. These
// matches are not stored in this.projMatches (as they are difficult
// to clear).
//
// Note that projection matches need to be calculated separately for
// each result node.
//
// The general algorithm is, therefore, as follows. When matches are
// added, they are first filtered by the parent node's filterProjMatches()
// function. These matches are added to this node's projMatches table.
// Those matches which are new (or need to be removed) are then lowered to
// the match points of the projection sub-nodes and added to the sub-nodes.
// 
// When the update is the result of the parent node adding or removing 
// projection matches, the fitering takes place on this node,
// by filtering out those elements which are not full matches on this node.
// Lowering to the sub-nodes takes place in the same way.
//
// Whether matches need to be added to the projection matches of a
// node needs to be determined after the projection matches of the
// parent have been updated. Moreover, in some cases, if projection
// matches are added to or removed from a node, its projection
// sub-nodes need to be notified of this change (as this may require
// them to update the data element in their own projection
// matches). At the same time, when matches are added to a projection
// node and its parent is a union, it is not enough to consider for
// addition those nodes which were added to the projection matches of
// the parents (because they may already have been projection matches
// on the parent for another sub-projection of that union).
//
// The projection matches of a node are updated only after the
// projection matches of the parent node have been updated. All this
// happens within the addMatches/removeMatches recursion, so when
// matches are added to or removed from a certain node, this is after
// matches have been added to or removed from one of its sub-nodes but
// before the projection matches were updated on that sub-node.
//
// We distinguish between the case where matches are updated on 
// the intersection node (and thus, indirectly, adding projection matches) 
// or that matches were update on some other node and are received as an update
// of the projection matches of the parent node.
//
// When the matches are not updated the intersection node itself,
// the update takes place as a result of updating matches at some other
// node in the query structure. The parent node then updates it
// projection matches and calls the intersection node's addProjMatches
// or removeProjMatches function. These must then only
// consider the projection matches added or removed from the parent.
// The projection matches of the intersection node are then updated
// and changes are propagated to the sub-nodes by calling their own 
// addProjMatches/removeProjMatches functions. 
//
// In case the matches (selection matches) were updated on the 
// interesection node, we block the recursive update of the projection 
// matches by a call of the parent to the intersection node's addProjMatches
// removeProjMatches. Instead, the intersection node's
// addMatches and removeMatches function must take care of update to 
// the projection matches them selves. Removal is easy: if a match is 
// removed from the selection matches, it must also be removed form 
// the projection matches. This then also includes matches which were
// raised to the math being removed.
//
// When adding selection matches to the itersection node, we need to 
// take care of several cases:
// 1. The node has raised matches: when a new match is raised to a
//    match already in the projection matches (and its match point
//    appear in 'projMatchPoints'), it is immediately added to the
//    projection matches (even before the matches are added to the
//    parent).
// 2. After the matches were added to the parent, all new matches 
//    are checked against the parent's projection matches (and added
//    if they appear in that list).
// 3. Each of the intersection's projection sub-nodes
//    needs to be updated with the new matches added to the intersection's
//    projection matches. This includes the sub-node which added the new
//    matches (if it is a projection).
//
// The projection matches update is implemented by the
// 'addProjMatches' and 'removeProjMatches' functions. There are
// several implementations of these functions, which are set on
// 'addProjMatches' and 'removeProjMatches'. When inside a call to the
// 'addMatches' or 'removeMatches' function the 'addProjMatches' or
// 'removeProjMatches' function may be different (disabled) from that
// used when not inside a call to 'addMatches' or 'removeProjMatches'.

// This function returns the count required of a match in order
// to be a full match on this node. In the case of an intersection node,
// this is the maximal count of a match point. 
// This is easy to calculate because the root path node ID is always
// a match point and always has maximal count.
// This should not be used during the match point refresh phase
// (during the match point refresh phase, use calcMaxMatchPointCount()).

IntersectionQueryCalc.prototype.getFullMatchCount = 
	intersectionQueryCalcGetFullMatchCount;

function intersectionQueryCalcGetFullMatchCount()
{
	var maxCount = this.matchPoints.get(this.indexer.qcm.getRootPathId());
	return maxCount ? maxCount : 0; // max count may be undefined
}

////////////////////
// Adding Matches //
////////////////////

// This is the general non-projection intersection case, with raising to 
// the parent data element. This does, however, cover the selection-projection
// case.

IntersectionQueryCalc.prototype.addMatchesWithRaising = 
	intersectionQueryCalcAddMatchesWithRaising;

function intersectionQueryCalcAddMatchesWithRaising(elementIds)
{
    if(elementIds.length == 0)
        return;

	var fullMatches = this.calcNewMatchesWithRaising(elementIds);

	if(fullMatches.length) {
		if(this.isSelectionProjection()) {
            if(this.mustAddMatches)
			    this.disableProjUpdateAndAddMatchesToParent(fullMatches);
			this.addProjMatchesToAddingSelectionProj(fullMatches);
		} else
			this.matchParent.addMatches(fullMatches, this);
	}
}

// This function implements an update loop for adding matches to an
// intersection node with raising. It receives a list (array) of data 
// element IDs. The counts of the matches for these data 
// elements are then increased by 1 and if there is a lower count match
// (a match on a match point with count lower than maximal) the match
// is raised to the parent of the data element (and so on,recusively).
// The function returns an array holding the data element IDs of the new
// full matches.

IntersectionQueryCalc.prototype.calcNewMatchesWithRaising = 
	intersectionQueryCalcCalcNewMatchesWithRaising;

function intersectionQueryCalcCalcNewMatchesWithRaising(elementIds)
{
	var length = elementIds.length;
	var fullMatches = []; // matches to report to the parent
	var maxCount = this.getFullMatchCount();
	var dataElements = this.indexer.getDataElements();
	var count;

	for(var i = 0 ; i < length ; ++i) {
		
		var elementId = elementIds[i];
		count = 1;

		while(1) {

			if(!this.matches.has(elementId))
				this.matches.set(elementId, count);
			else {
				count += this.matches.get(elementId);
                this.matches.set(elementId, count);
            }

            var elementEntry = dataElements.getEntry(elementId);
			var matchPoint = elementEntry.pathId;

			if(this.matchPoints.get(matchPoint) != count)
                // not first match (may temporarily be increased above the
                // match point count in case a deletion is pending).
				break;

			// first match

			if(count == maxCount) {
				// add to list of full matches (will be sent to parent)
				fullMatches.push(elementId);
				break;
			}
				
			// raise to the parent
			elementId = elementEntry.parent;
			var entry;
			if(!this.raisedMatches.has(elementId)) {
			    entry = new Map();
                this.raisedMatches.set(elementId, entry);
            } else
                entry = this.raisedMatches.get(elementId);
			if(!entry.has(matchPoint)) {
				entry.set(matchPoint, 1);
			} else {
				entry.set(matchPoint, entry.get(matchPoint)+1);
				break; // aleady raised for this match point
			}
		}
	}

	return fullMatches;
}

// This is the general case with raising for the special case 
// where the intersection node is also a projection node.

IntersectionQueryCalc.prototype.addMatchesToProj = 
	intersectionQueryCalcAddMatchesToProj;

function intersectionQueryCalcAddMatchesToProj(elementIds)
{
    if(elementIds.length == 0)
        return;

	var newMatches = this.calcNewMatchesInProj(elementIds);
    
    if(newMatches.fullMatches.length && this.mustAddMatches)
        this.disableProjUpdateAndAddMatchesToParent(newMatches.fullMatches);

	// add the new projection matches (if projection is not suspended)
    if(!this.isSuspendedProjection())
	    this.addProjMatchesToAdding(newMatches.fullMatches, 
								    newMatches.lowerProjMatches);
}

// This function implements an update loop for adding matches to a projection
// intersection node with raising. It receives a list (array) of data 
// element IDs. The counts of the matches for these data 
// elements is then increased by 1 and if there is a lower count match
// (a match on a match point with count lower than maximal) the match
// is raised to the parent of the data element (and so on,recusively).
// These raised matches are stored in the 'raisedMatches' table.
// In case they are raised from a projection match point, we need to
// explicitly store which data element they were raised from
// (and not just the count of these data elements) so that lowering 
// could be performed correctly.
// This function also determines the list of new projection matches for
// this node which are dominated by existing full matches of the node
// (that is, were raised to a data element ID which is already in
// the projMatches table).  
// The function returns an object holding two arrays of data element IDs:
// { 
//     fullMatches: fullMatches, 
//     lowerProjMatches: lowerProjMatches 
// }
// The first array holds the new full matches added by this
// operation. The second object holds, for each result ID in the
// projMatches table, those new lower count matches whose parent is
// already in the projMatches table for that result object. The full matches
// filtered by the parent node's filterProjMatches together with the 
// elements in lowerProjMatches are the highest new projection matches
// (these will later be lowered and stored in this.projMatches).

IntersectionQueryCalc.prototype.calcNewMatchesInProj = 
	intersectionQueryCalcCalcNewMatchesInProj;

function intersectionQueryCalcCalcNewMatchesInProj(elementIds)
{
	var length = elementIds.length;
	var fullMatches = []; // matches to report to the parent
    // lower projection matches, by result node
    var lowerProjMatches = this.makeEmptyProjMatchArrays();
    var resultIds = [];
    if(this.projMatches !== undefined)
        this.projMatches.forEach(function(e,resultId) {
            resultIds.push(resultId);
        });
    var numResultIds = resultIds.length;
	var maxCount = this.getFullMatchCount();
	var dataElements = this.indexer.getDataElements();
	var count;

	for(var i = 0 ; i < length ; ++i) {
		
		var elementId = elementIds[i];
		count = 1;

		while(1) {

			if(!this.matches.has(elementId))
				this.matches.set(elementId, count);
			else {
				count += this.matches.get(elementId);
                this.matches.set(elementId, count);
            }

            var elementEntry = dataElements.getEntry(elementId);
			var matchPoint = elementEntry.pathId;

			if(this.matchPoints.get(matchPoint) != count)
                // not first match (may temporarily be increased above the
                // match point count in case a deletion is pending).
				break;

			// matched, but does it require raising?

            // the count has to equal to the maximal selection count
            // and this must also be a match point for the projection 
            // sub-node(s), otherwise, this need to be raised further.
			if(count == maxCount && this.projMatchPoints.get(matchPoint)) {
				// add to list of full matches
				fullMatches.push(elementId);
				break;
			}
				
			// raise to the parent
			var parentId = elementEntry.parent;
			if(this.projMatchPoints.get(matchPoint)) {
                for(var r = 0 ; r < numResultIds ; ++r) {
                    var resultId = resultIds[r];
                    if(this.projMatches.get(resultId).has(parentId))
                        lowerProjMatches[resultId].push(elementId);
                }
            } 
				
			var entry;
            if(!this.raisedMatches.has(parentId)) {
                entry = new Map();
                this.raisedMatches.set(parentId, entry);
            } else
                entry = this.raisedMatches.get(parentId);
			if(!entry.has(matchPoint)) {
				if(this.projMatchPoints.get(matchPoint)) {
					var pointEntry = new Map();
                    entry.set(matchPoint, pointEntry);
					pointEntry.set(elementId, true);
				} else
					entry.set(matchPoint, 1);
			} else {
				if(this.projMatchPoints.get(matchPoint)) {
					var pointEntry = entry.get(matchPoint);
					pointEntry.set(elementId, true);
				} else
					entry.set(matchPoint, entry.set(matchPoint) + 1);
				break; // aleady raised for this match point
			}
			elementId = parentId;
		}
	}

	return { fullMatches: fullMatches, lowerProjMatches: lowerProjMatches };
}

// This is the specific intersection case where no raising is required.
// This is used for both selection and projection intersection nodes.

IntersectionQueryCalc.prototype.addMatchesWithoutRaising = 
	intersectionQueryCalcAddMatchesWithoutRaising;

function intersectionQueryCalcAddMatchesWithoutRaising(elementIds)
{
	var length = elementIds.length;

    if(length == 0)
        return;

	var fullMatches = []; // matches to report to the parent
	var maxCount = this.getFullMatchCount();
	var count;

	for(var i = 0 ; i < length ; ++i) {
		
		var elementId = elementIds[i];

		if(!this.matches.has(elementId))
			this.matches.set(elementId, count = 1);
		else
			this.matches.set(elementId,
                             count = (this.matches.get(elementId) + 1));

		if(count == maxCount)
			// first match, add to the list to be sent to parent
			fullMatches.push(elementId);
	}

	if(!fullMatches.length)
        return;

    if(this.shouldAddMatches())
        this.disableProjUpdateAndAddMatchesToParent(fullMatches);

    // add the new projection matches, if this is a projection node
    if(this.projSubNodeNum)
        this.addProjMatchesToAdding(fullMatches);
    else if(this.isSelectionProjection())
        this.addProjMatchesToAddingSelectionProj(fullMatches);
}

// This function should be called when this node has a match parent
// and we wish to add matches to that match parent without this 
// operation recursively updating the projection matches of this node.
// This should be used in cases where the calling function is responsible
// for updating the projection matches of the node.

IntersectionQueryCalc.prototype.disableProjUpdateAndAddMatchesToParent = 
	intersectionQueryCalcDisableProjUpdateAndAddMatchesToParent;

function intersectionQueryCalcDisableProjUpdateAndAddMatchesToParent(matches)
{
    if(matches.length == 0)
        return; // nothing to do

    if(this.isSuspendedProjection()) // already suspended
        	this.matchParent.addMatches(matches, this);
    else {
	    var prevAddProjMatches = this.addProjMatches;
	    this.addProjMatches = this.addProjMatchesDoNothing; // disable
	    this.matchParent.addMatches(matches, this);
	    this.addProjMatches = prevAddProjMatches; // re-enable
    }
}

// This is the specific intersection case used when the intersection is
// suspended. When the intersection is suspended, no raising or addition
// of matches to the parent node take place. Instead, the only thing
// the function does is increase (by 1) the count of the given elements.
// An intersection may be suspended during the query refresh.
// Raising of matches and adding matches to the parent then take place
// when the intersection node is unsuspended.
// Remark: if this is a projection node, no projection matches are
// added (these will be added later when the node is unsuspended).

IntersectionQueryCalc.prototype.addMatchesToSuspended = 
	intersectionQueryCalcAddMatchesToSuspended;

function intersectionQueryCalcAddMatchesToSuspended(elementIds)
{
	var length = elementIds.length;

	for(var i = 0 ; i < length ; ++i) {
		
		var elementId = elementIds[i];

		if(!this.matches.has(elementId))
			this.matches.set(elementId, 1);
		else
			this.matches.set(elementId, this.matches.get(elementId) + 1);
	}
}

///////////////////////////////
// Adding Projection Matches //
/////////////////////////////// 

// The general algorithm is documented at the beginning of the match 
// update section.

// This function is called on a projection intersection node matches
// to its match parent. This can be called whether lowering of
// projection matches needs to take place or not (lowering may take
// place if there are raised matches or if there are pure projection
// match points).  The function takes as input two lists (where the
// second one is only needed when raising takes place and is allowed
// to be undefined): the list of new full matches and a list of new
// lower-count matches whose data element parent is already in the
// projection matches list. This second list is actually a list of
// lists, one for each result node ID (as the projection matches are
// calculated seperately for each result node). The function then
// needs to check which of the elements in the first list is also a
// projection match on the parent (this is done by calling the
// parent's filterProjMatches() function). If lowering is required,
// all these projection matches must then be lowered. During lowering, all 
// these projection matches and their lowering which are matches (not
// necessarily with maximal count) on this node are added to
// this.projMatches. Lowered projection matches at pure 
// projection match points are not stored in the projMatches table but are
// forwarded as projection matches to lower query calculation nodes.
// All new projection matches and nodes lowered
// from them are forwarded to the projection sub-nodes.

IntersectionQueryCalc.prototype.addProjMatchesToAdding = 
	intersectionQueryCalcAddProjMatchesToAdding;

function intersectionQueryCalcAddProjMatchesToAdding(fullMatches, lowerMatches)
{
    var results = this.rootQueryCalc.getQueryResults();
    var _self = this;
    
    results.forEach(function(queryResult, resultId) {
        
        // filter the full matches which are considered projection matches
        // by the parent

        var projMatches = 
            _self.matchParent.filterProjMatches(fullMatches, resultId);
        
        if(lowerMatches !== undefined && (resultId in lowerMatches)) {
            if(projMatches.length)
                projMatches = projMatches.concat(lowerMatches[resultId]);
            else
                projMatches = lowerMatches[resultId];
        }

        if(projMatches === undefined || projMatches.length == 0)
            return;

        if(_self.raisedMatches ||
           (_self.pureProjMatchPoints !== undefined &&
            _self.pureProjMatchPoints.size > 0))
	        // lower all projection matches in projMatches which can
            // be lowered and append these lowered matches to the
            // projMatches list. Those projection matches which are
            // also selection matches are added to the projMatches
            // list for resultId.
            projMatches = _self.lowerProjMatchesAndAdd(projMatches, resultId);
        else {
            var thisProjMatches = _self.getProjMatchesEntry(resultId);
            for(var i = 0, l = projMatches.length ; i < l ; ++i)
                thisProjMatches.set(projMatches[i], 1);
        }

        // add the new projection matches to the projection sub-nodes
        for(var nodeId in _self.projSubNodes)
            _self.projSubNodes[nodeId].addProjMatches(projMatches, resultId);
    });
}

// This function receives a list (array) of projection matches which need to 
// be added to this intersection node. It then lowers these projection
// matches and adds both the given matches and the lowered matches
// which are selection matches to the projMatches list for result with ID 
// 'resultId'. The function returns the array projMatches appended with all 
// lowered projection matches.
//
// Lowering can take place in two ways:
// 1. If the data element is found in the 'raisedMatches' table, all 
//    data elements stored in that table as having been raised to it
//    are added as projection matches. These are projection matches
//    which are also selection matches (though not full matches). These
//    matches are stored in this.projMatches.
// 2. If the query calculation node has pure projection match points
//    then if the data element which is a projection match has 
//    children at a path which is a pure projection match point,
//    those children are also projection matches. These projection
//    matches are not added to the this.projMatches table.
//
// The lowered projection matches are appended at the end of the projection
// match array and the loop is extended to go over them too. In this way
// multiple lowering steps can take place. 

IntersectionQueryCalc.prototype.lowerProjMatchesAndAdd = 
    intersectionQueryCalcLowerProjMatchesAndAdd;

function intersectionQueryCalcLowerProjMatchesAndAdd(projMatches, resultId)
{
    var thisProjMatches = this.getProjMatchesEntry(resultId);
    var l = projMatches.length;
    
    // lowering to selection matches (projection matches are added to
    // this.projMatches).

    if(!this.raisedMatches) { // no selection raising, so no need to lower
        for(var i = 0 ; i < l ; ++i)
            thisProjMatches.set(projMatches[i], 1);
    } else {
        for(var i = 0 ; i < l ; ++i) {
            
            var elementId = projMatches[i];
            thisProjMatches.set(elementId, 1);
            
            if(this.raisedMatches.has(elementId)) {

                var raisedMatchesEntry = this.raisedMatches.get(elementId);
                var _self = this;
                raisedMatchesEntry.forEach(function(entry, matchPointId) {
                    
                    if(!(matchPointId in _self.projMatchPoints))
                        return;

                    entry.forEach(function(value, lowerId) {
                        // add the data elements which were raised at the
                        // end of the list (as they themselves may have been
                        // raised)
                        projMatches.push(lowerId);
                        l++;
                    });
                });
            }
        }
    }

    if(this.pureProjMatchPoints === undefined ||
       this.pureProjMatchPoints.size === 0)
        return projMatches;
    
    // lowering to pure projection match points (projection matches are
    // not added to this.projMatches), but appended to the array 'projMatches'
    // which is also returned.
    return this.lowerToPureProjMatchPoints(projMatches);
}

// Given an array 'projMatches' holding a set of data elemetn IDs,
// this function appends to this array the lowering of these element IDs
// to the pure projection match points (that is, the data elements which 
// are children of the data elements in 'projMatches' and whose path
// is a pure projection match point). Multiple lowering steps may take
// place (that is, a lowered data element may be lowered again).
// This function returns the original input array (which was appended
// with the lowered data element IDs).

IntersectionQueryCalc.prototype.lowerToPureProjMatchPoints = 
    intersectionQueryCalcLowerToPureProjMatchPoints;

function intersectionQueryCalcLowerToPureProjMatchPoints(projMatches)
{
    if(this.pureProjMatchPoints === undefined ||
       this.pureProjMatchPoints.size === 0)
        return projMatches;
    
    // perform the lowering (using base class function)
    return this.lowerToProjMatchPoints(projMatches, this.pureProjMatchPoints); 
}

//
// Adding Projection Added to the Parent
//

// The following are functions which implement the 'addProjMatches' function
// for various types of nodes. The 'addProjMatches' function is called 
// by the parent node when new projection matches are added to the parent
// node. The 'addProjMatches' is called with an array holding the IDs
// of the new elements added to the parent's projection matches and
// the ID of the result node on which this projection is calculated.
// These projection matches are already lowered (if necessary) so that
// they can be immeidately intersected with the full matches of this node.
// The 'addProjMatches' function should then intersect these new projection 
// matches with its own matches and add these nodes to its projection 
// matches (for the given result node) and propagate these matches to
// its sub-nodes. In some cases, this node may need to apply lowering
// to this set of projection matches.
// Depending on whether lowering is needed and whether the node is a
// projection or selection-projection node, this function can be
// implemented in different ways (including doing nothing at all, in
// case this is called in the process of adding selection matches).

//

// This function implements the general case for intersection nodes
// which have raised matches. This function is not used if this node is
// in the process of adding new matches (in this case the projection 
// matches are updated by addProjMatchesToAdding()).
// The function receives the list of new projection matches of the parent
// and checks whether these are full matches on this node. For those
// which are, the function also lowers them to lower projection
// matches (see lowerProjMatchesAndAdd() for details). All these projection
// matches (including some of the lowered projection matches, see 
// lowerProjMatchesAndAdd() for details) are added
// to the list of projection matches for the result node with ID 'resultId'.
// After adding the new projection matches, the function continues
// to add these projections to its own projection sub-nodes.

IntersectionQueryCalc.prototype.addProjMatchesWithLowering = 
	intersectionQueryCalcAddProjMatchesWithLowering;

function intersectionQueryCalcAddProjMatchesWithLowering(parentProjMatches,
                                                         resultId)
{
	var maxCount = this.getFullMatchCount();
	var projMatches = []; // new matches added to this node
    var thisProjMatches = this.getProjMatchesEntry(resultId);

    // find projection matches on the parent which are also matched
    // on this node. Lowering will take place after this loop
	for(var i = 0, l = parentProjMatches.length ; i < l ; ++i) {
		
		var elementId = parentProjMatches[i];
		
		if(this.matches.get(elementId) != maxCount)
			continue; // not matched on this node
		
        if(thisProjMatches.has(elementId))
            continue; // already added

		projMatches.push(elementId);
	}

    // lower all projection matches in projMatches which can be lowered and
    // append these lowered matches to the projMatches list. Some of these 
    // matches (those which are not on pure projection match points)
    // are added to the projMatches list for resultId.
    projMatches = this.lowerProjMatchesAndAdd(projMatches, resultId);

	// add the new projection matches to the projection sub-nodes
	for(var nodeId in this.projSubNodes)
		this.projSubNodes[nodeId].addProjMatches(projMatches, resultId);
}

// This function implements addProjMatches for the case where no matches
// are raised and there are no pure projection match points (so there is 
// no need to check for lowering).
// This function is not used if this node is in the process of adding new 
// matches (in this case the projection matches are updated by 
// addProjMatchesToNoRaiseAdding()).
// The function receives the list of new projection matches of the parent
// and adds those which are full matches as projection matches on this node.
// After adding the new projection matches, the function continues
// to add these projections to its own projection sub-nodes. 

IntersectionQueryCalc.prototype.addProjMatchesWithoutLowering = 
	intersectionQueryCalcAddProjMatchesWithoutLowering;

function intersectionQueryCalcAddProjMatchesWithoutLowering(parentProjMatches,
                                                            resultId)
{
	var maxCount = this.getFullMatchCount();
	var projMatches = [];
    var thisProjMatches = this.getProjMatchesEntry(resultId);

	for(var i = 0, l = parentProjMatches.length ; i < l ; ++i) {
		
		var elementId = parentProjMatches[i];

		if(this.matches.get(elementId) == maxCount && 
           !thisProjMatches.has(elementId)) {
			thisProjMatches.set(elementId, 1);
			projMatches.push(elementId);
		}
	}
	
	// add the new projection matches to the projection sub-nodes
	for(var nodeId in this.projSubNodes)
		this.projSubNodes[nodeId].addProjMatches(projMatches, resultId);
}

// This function is called on a selection-projection intersection node 
// which has just added matches and, if needed, forwarded them to the parent.
// 'matches' are the new matches just added to this node (and forwarded to 
// the parent).
// This function then needs to update the projection matches of this node.
// The function first lets the parent node filter the projection matches
// out of these matches. It then raises these matches, if necessary,
// adds them to this.projMatches and forwards the (raised) projection 
// matches to the result node.

IntersectionQueryCalc.prototype.addProjMatchesToAddingSelectionProj = 
	intersectionQueryCalcAddProjMatchesToAddingSelectionProj;

function intersectionQueryCalcAddProjMatchesToAddingSelectionProj(matches)
{
    if(this.isSuspendedProjection())
        return; // projection suspended, will be calculated later

    if(!this.isGeneratingProjection())
        return;

    var results = this.rootQueryCalc.getQueryResults();

    var _self = this;
    results.forEach(function(queryResult, resultId) {
        var projMatches = this.matchParent.filterProjMatches(matches, resultId);
        // raise (if needed), update this.projMatches and notify the result
        _self.addSelectionProjMatches(projMatches, resultId);
    });
}

// This function implements 'addProjMatches' for the case where the
// node is an intersection node which is a selection-projection.
// A selection-projection node is not necessarily a generating
// projection (see definition in internalRootQueryCalc.js).
// If it is not a generating projection, there is nothing to do here.
// If this node is a generating projection, this function adds those
// matches of the parent which are also full matches of this node to
// the list of projection matches of this node.  Before adding the
// projection matches, the matches have to be raised to the prefix
// path of the query. Because multiple matches may be raised in this
// way to the same projection match, each projection match counts the
// number of matches raised to it (this allows for correct removal of
// the raised matches). This assumes that the updates received by this
// function a incremental, with no element added more than once.  This
// function does not added projection matches to its sub-nodes
// (because these are not projections).
// Since a selection-projection node is a terminal projection node,
// this function has to notify the result node of the projection matches
// added by this function.

IntersectionQueryCalc.prototype.addProjMatchesToSelectionProj = 
	intersectionQueryCalcAddProjMatchesToSelectionProj;

function intersectionQueryCalcAddProjMatchesToSelectionProj(parentProjMatches,
                                                            resultId)
{
    if(!this.isGeneratingProjection())
        return;

	var maxCount = this.getFullMatchCount();
    var projMatches = [];
    
    // extract those parent projection matches which are full matches
    
    for(var i = 0, l = parentProjMatches.length ; i < l ; ++i) {
		var elementId = parentProjMatches[i];
		if(this.matches.get(elementId) == maxCount)
            projMatches.push(elementId);
    }

    // raise (if needed), update this.projMatches and notify the result
    projMatches = this.addSelectionProjMatches(projMatches, resultId);
}

//////////////////////
// Removing Matches //
//////////////////////

// The following functions are the equivalent for removal of the 'addMatches'
// functions. Given an array of data element IDs, the functions below 
// decrease the count of the data element on this query calculation node 
// by 1 and, if needed as a result of this, remove matches from parent 
// nodes and removes raised matches (matches due to a match on a lower match 
// point).

// There are various implementations of this function, depending on on
// whether raising is necessary (that is, is it an intersection node
// with match points whose count is smaller than the maximal match
// point count on the node) and whether the node is a projection or a
// selection. These implementations appear below. After the system has
// determined the state of the node, it assigns the appropriate
// function to this.removeMatches

// Note: during query refresh, these functions may be called to remove 
// matches after the match points of these matches have been removed.
// As explained in the introduction to the match point refresh section,
// these match points must have had a count of 1. Therefore, the functions
// below treat all unknown match points as having a count of 1.  

//

// This is the general intersection case, with removal of raising to the parent
// data element. This is not used for a projection intersection.
// Note: when the data element structure changes, it may be that a
// match for a higher data element ID is replaced with a match for a lower
// data element ID (or the other way around). If the new match is added
// before the old one was removed, we may arrive at this function with
// a match count which is higher than that of the coresponding match point.
// In this case, the function decreases the match count, but does not
// take any further action (as the match remains unchanged).

IntersectionQueryCalc.prototype.removeMatchesWithRaising = 
	intersectionQueryCalcRemoveMatchesWithRaising;

function intersectionQueryCalcRemoveMatchesWithRaising(elementIds)
{
	var length = elementIds.length;
	var removedMatches = []; // matches to remove from the parent
	var maxCount = this.getFullMatchCount();
	var dataElements = this.indexer.getDataElements();
	var count; // count before the removal
	var remove; // how much to remove
	var elementId;

	for(var i = 0 ; i < length ; ++i) {
		
		elementId = elementIds[i];
		remove = 1;  

		while(1) {

			count = this.matches.get(elementId); // count before the removal

            var newCount = count - remove;
			if(newCount == 0)
				this.matches.delete(elementId);
            else
                this.matches.set(elementId, newCount);

            var elementEntry = dataElements.getEntry(elementId);
			var matchPoint = elementEntry.pathId;
            var matchPointCount;

			if((matchPointCount =
                this.matchPoints.get(matchPoint)) !== undefined &&
               count != matchPointCount)
                // was not a match or remains a match also after this removal
                // (see introduction for an explanation). If the match point 
                // count is undefined, this will return false, 
                // that is: 'was a match'.
				break;

			if(count == maxCount) {
				removedMatches.push(elementId);
				break; // was not raised to the parent (even if there is)
			}

			// was raised to the parent, continue to remove the parent
			elementId = elementEntry.parent;
			var raised = this.raisedMatches.get(elementId);
            var raiseCount = raised.get(matchPoint) - 1;
			if(raiseCount == 0) {
				raised.delete(matchPoint);
				if(raised.size == 0)
					this.raisedMatches.delete(elementId);
			} else {
                raised.set(matchPoint, raiseCount);
				break; // still matched due to another child
            }
			remove = count;
		}
	}

	if(removedMatches.length == 0)
        return;

	if(this.isSelectionProjection()) {
        this.removeMatchesFromRemovingSelectionProj(removedMatches);
        if(this.mustAddMatches)
			this.disableProjUpdateAndRemoveMatchesFromParent(removedMatches);
	} else
		this.matchParent.removeMatches(removedMatches, this);
}

// This function is identical to the function removeMatchesWithRaising
// except that it is used when the node is a projection node.
// When an intersection node is a projection node, the format of entries
// in the raised matches table is slightly different and therefore has
// to be removed differently. 
// In addition to removing the matches from the match list, this function also
// removes the matches from the projection match list. This is done by
// calling this node's 'removeProjMatchesWithLowering()' function
// with the list of matches which were actually removed (that is, where
// before the removal there was a full match).
// The 'removeProjMatchesWithLowering()' function is then responsible
// for removing entries from the projMatches table (including lowered
// entries) and then calling recursively the 'removeProjMatches' function
// of the projection sub-nodes.
// When this function calls the removeMatches function on the parent,
// it disables its 'removeProjMatches' function as any projection matches
// removed due to removal on the parent would have already been removed
// by this function.
// Note: when the data element structure changes, it may be that a
// match for a higher data element ID is replaced with a match for a lower
// data element ID (or the other way around). If the new match is added
// before the old one was removed, we may arrive at this function with
// a match count which is higher than that of the coresponding match point.
// In this case, the function decreases the match count, but does not
// take any further action (as the match remains unchanged).

IntersectionQueryCalc.prototype.removeMatchesFromProj = 
	intersectionQueryCalcRemoveMatchesFromProj;

function intersectionQueryCalcRemoveMatchesFromProj(elementIds)
{
    // matches to remove from the parent (only needed if this node need to
    // add its matches to the parent)
	var removedMatches = this.mustAddMatches ? [] : undefined;
	var toRemoveProjMatches = []; // a preliminary list
	var maxCount = this.getFullMatchCount();
	var dataElements = this.indexer.getDataElements();
	var count; // count before the removal
	var remove; // how much to remove
	var elementId;

	for(var i = 0, l = elementIds.length ; i < l ; ++i) {
		
		elementId = elementIds[i];
		remove = 1;  

		while(1) {

			count = this.matches.get(elementId); // count before the removal

            var newCount = count - remove; 
			if(newCount == 0)
				this.matches.delete(elementId);
            else
                this.matches.set(elementId, newCount);

            var elementEntry = dataElements.getEntry(elementId);
			var matchPoint = elementEntry.pathId;
            var matchPointCount;

            if((matchPointCount =
                this.matchPoints.get(matchPoint)) !== undefined &&
               count != matchPointCount)
                // was not a match or remains a match also after this removal
                // (see introduction for an explanation). If the match point 
                // count is undefined, this will return false, 
                // that is: 'was a match'.
				break;

			// since this was a match, it may be a projection match
			toRemoveProjMatches.push(elementId);

			if(count == maxCount) {
                if(removedMatches) {
				    removedMatches.push(elementId);
				    break; // was not raised to the parent (even if there is)
                } else if(this.projMatchPoints.get(matchPoint))
                    break; // was not raised to the parent (even if there is)
			}

			// was raised to the parent, continue to remove the parent
			if(this.projMatchPoints.get(matchPoint)) {
				var parentElementId = elementEntry.parent;
				var raised = this.raisedMatches.get(parentElementId);
                var matchPointEntry = raised.get(matchPoint);
                matchPointEntry.delete(elementId);
				elementId = parentElementId;
				if(matchPointEntry.size == 0) {
					raised.delete(matchPoint);
					if(raised.size == 0)
						this.raisedMatches.delete(elementId);
				} else
					break; // still matched due to another child
			} else {
				elementId = elementEntry.parent;
				var raised = this.raisedMatches.get(elementId);
                var raiseCount = raised.get(matchPoint) - 1;
				if(raiseCount == 0) {
					raised.delete(matchPoint);
					if(raised.size == 0)
						this.raisedMatches.delete(elementId);
				} else {
                    raised.set(matchPoint, raiseCount);
					break; // still matched due to another child
                }
			}
			remove = count;
		}
	}

	// remove projection matches
	if(toRemoveProjMatches.length && !this.isSuspendedProjection()) {
        var _self = this;
        this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                              resultId) {
		    _self.removeProjMatches(toRemoveProjMatches, resultId);
        });
    }

    if(removedMatches && removedMatches.length && this.parent)
		this.disableProjUpdateAndRemoveMatchesFromParent(removedMatches);
}

// This is the specific intersection case where no raising is required.
// This is used for both selection and projection intersection nodes.

IntersectionQueryCalc.prototype.removeMatchesWithoutRaising = 
	intersectionQueryCalcRemoveMatchesWithoutRaising;

function intersectionQueryCalcRemoveMatchesWithoutRaising(elementIds)
{
	var length = elementIds.length;
	var removedMatches = []; // matches to report to the parent
	var maxCount = this.getFullMatchCount();

	for(var i = 0 ; i < length ; ++i) {
		
		var elementId = elementIds[i];
        var count = this.matches.get(elementId);
        
		if(count == maxCount)
			removedMatches.push(elementId);
 
		if(--count == 0)
			this.matches.delete(elementId)
        else
            this.matches.set(elementId, count);
	}

	if(!removedMatches.length)
        return;

    if(this.shouldAddMatches())
        this.disableProjUpdateAndRemoveMatchesFromParent(removedMatches);

    if(!this.isSuspendedProjection()) {
		// first remove projection matches, if this is a projection or 
		// selection-projection node.
		if(this.projSubNodeNum) { // a projection node
            var _self = this;
            this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                                  resultId) {
                _self.removeProjMatches(removedMatches, resultId);
            });
		} else if(this.isSelectionProjection())
            this.removeMatchesFromRemovingSelectionProj(removedMatches);
    }
}

// This is the specific intersection case used when the intersection
// is suspended. When the intersection is suspended, no raising or
// removal of matches from the parent node take place. The projection
// matches are also not updated. Instead, the only thing the function
// does is decrease (by 1) the count of the given elements.

IntersectionQueryCalc.prototype.removeMatchesFromSuspended = 
	intersectionQueryCalcRemoveMatchesFromSuspended;

function intersectionQueryCalcRemoveMatchesFromSuspended(elementIds)
{
	var length = elementIds.length;

	for(var i = 0 ; i < length ; ++i) {
		
		var elementId = elementIds[i];

        var count = this.matches.get(elementId) - 1;
		if(count == 0)
			this.matches.delete(elementId);
        else
            this.matches.set(elementId, count);
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

IntersectionQueryCalc.prototype.disableProjUpdateAndRemoveMatchesFromParent = 
	intersectionQueryCalcDisableProjUpdateAndRemoveMatchesFromParent;

function 
intersectionQueryCalcDisableProjUpdateAndRemoveMatchesFromParent(removedMatches)
{
    if(!removedMatches.length)
        return; // nothing to remove

    if(this.isSuspendedProjection()) // already suspended
        this.matchParent.removeMatches(removedMatches, this);
    else {
	    var prevRemoveProjMatches = this.removeProjMatches;
	    this.removeProjMatches = this.removeProjMatchesDoNothing; // disable
	    this.matchParent.removeMatches(removedMatches, this);
	    this.removeProjMatches = prevRemoveProjMatches; // re-enable
    }
}


/////////////////////////////////
// Removing Projection Matches //
/////////////////////////////////

// The following functions are an implementation of 'removeProjMatches'
// for various types of nodes and configurations. Depending on the node
// state (and possibly other properties) one of these functions is set on
// this.removeProjMatches.
// These functions receive a list (array) of data element IDs which 
// were removed either from the projection matches of the parent or 
// from the matches of this node. The functions must then remove these
// elements from the projection matches of this node and call the 
// this.removeProjMatches function of the projection
// sub-nodes of this node with the list of data elements actually removed
// from the projection matches list.
// If the node is an intersection node with raising, the removeProjMatches
// must remove lowered matches when their parent match is removed.
// If the node is a selection-projection, this function may have to raise
// the matches before removing. These various possibilities are covered
// by the functions below.

// This function implements 'removeProjMatches' for the general case
// of a projection intersection node, where lowering of projection
// matches is possible. It is assumed the function is called after the
// projection matches were removed from the parent or after matches
// were removed from the intersection node. If the match can be
// lowered, we lower it and remove any data element under it from the
// projection matches.

IntersectionQueryCalc.prototype.removeProjMatchesWithLowering = 
	intersectionQueryCalcRemoveProjMatchesWithLowering;

function intersectionQueryCalcRemoveProjMatchesWithLowering(removedMatches,
                                                            resultId)
{
    var l = removedMatches.length;
    var actuallyRemoved;

    if(this.raisedMatches === undefined)
        actuallyRemoved = removedMatches;
    else {
        var actuallyRemoved = [];
        // lowering search position in actuallyRemoved
	    var actuallyRemovedPos = 0;
	    var actuallyRemovedLength = 0; // length of actuallyRemoved
        var thisProjMatches = this.getProjMatchesEntry(resultId);

	    for(var i = 0 ; i < l ; ++i) {
		
		    var elementId = removedMatches[i];

		    if(!thisProjMatches.has(elementId))
			    continue;
		
		    thisProjMatches.delete(elementId);
		    actuallyRemoved.push(elementId);
		    actuallyRemovedLength++;

		    while(1) {

			    if(this.raisedMatches.has(elementId)) {

                    var raisedEntry = this.raisedMatches.get(elementId);
                    
                    raisedEntry.forEach(function(entry, matchPointId) {
				
					    if(this.projMatchPoints === undefined ||
                           !this.projMatchPoints.has(matchPointId))
						    return;

                        entry.forEach(function(value, lowerId) { 
						    // removed this lowered projection too (and add it
						    // to the list, as it may itself be raised)
						    thisProjMatches.delete(lowerId);
						    actuallyRemoved.push(lowerId);
						    actuallyRemovedLength++;
					    });
				    });
			    }
                
                if(++actuallyRemovedPos >= actuallyRemovedLength)
			        break;
                
		        elementId = actuallyRemoved[actuallyRemovedPos];
            }
        }
	}

    if(this.pureProjMatchPoints !== undefined &&
       this.pureProjMatchPoints.size > 0)
        // lower to pure projection match points (doesn't update the 
        // projMatches table).
        actuallyRemoved = this.lowerToPureProjMatchPoints(actuallyRemoved);
    
	// remove the projections actually removed from the projection sub-nodes
	for(var nodeId in this.projSubNodes)
		this.projSubNodes[nodeId].removeProjMatches(actuallyRemoved, resultId);
    
    // in case lowered matches were appended 
    removedMatches.length = l; 
}

// This function implements removeProjMatches for the case where no matches
// are raised (so there is no need to check for lowering).
// This makes the function much simpler than the general case
// (where raising of matches is possible). Every data element in 
// 'removedMatches' (which is an array of data element IDs) is checked
// against this.projMatches. If it is in this.projMatches it is 
// removed and added to the list of data elements which need to be removed
// from the projection sub-nodes.

IntersectionQueryCalc.prototype.removeProjMatchesWithoutLowering = 
	intersectionQueryCalcRemoveProjMatchesWithoutLowering;

function intersectionQueryCalcRemoveProjMatchesWithoutLowering(removedMatches,
                                                               resultId)
{
	var removedLength = removedMatches.length;
	var actuallyRemoved = [];
    var thisProjMatches = this.getProjMatchesEntry(resultId);
    
	for(var i = 0 ; i < removedLength ; ++i) {
		
		var elementId = removedMatches[i];

		if(!thisProjMatches.has(elementId))
			continue;
		
		thisProjMatches.delete(elementId);
		actuallyRemoved.push(elementId);
	}

	// remove the projections actually removed form the projection sub-nodes
	for(var nodeId in this.projSubNodes)
		this.projSubNodes[nodeId].removeProjMatches(actuallyRemoved,
                                                    resultId);
}

// This function is called on a selection-projection intersection node 
// which has just removed matches but did not yet forward these removals 
// to the parent.
// 'matches' are the matches just removed from this node.
// This function then needs to update the projection matches of this node.
// This function then first lets the parent node filter these matches
// by its projection matches. This is only needed in case raising
// of the projection matches to the query prefix path takes place and 
// we then want to avoid removing matches which were never raised
// (because they were not projection matches of the parent). Since we
// only track the number of matches raised, removing a match which was
// not added could result in an incorrect reference count.
// If no raising needs to take place, there is no need to filter the 
// removed matches, as we can check directly whether they are stored in
// the 'projMatches' table.
// After possibly filtering by the parent, this function updates
// the this.projMatches table and forwards the removed matches to the
// result node.

IntersectionQueryCalc.prototype.removeMatchesFromRemovingSelectionProj = 
	intersectionQueryCalcRemoveMatchesFromRemovingSelectionProj;

function intersectionQueryCalcRemoveMatchesFromRemovingSelectionProj(matches)
{
    if(this.isSuspendedProjection())
        return; // suspended, will be recalculated later

    if(!this.isGeneratingProjection())
        return;

    var _self = this;
    
    if(this.lowerThanQueryPrefixFullMatches()) {
        // raising needed, so must first filter on the parent
        this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                              resultId) {
            var projMatches = 
                _self.matchParent.filterProjMatches(matches, resultId);
            // raise (if needed), update this.projMatches and update 
            // the result node
            _self.removeSelectionProjMatches(projMatches, resultId);
        });
    } else {
        // no raising required, so no need to filter on parent
        this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                              resultId) {
            // update this.projMatches and update the result node
            _self.removeSelectionProjMatches(matches, resultId);
        });
    }
}

// This function implements the removeProjMatches() function for 
// selection-projection (intersection) nodes. 'removedMatches' are
// matches just removed from the projection matches of the parent node for
// the result with ID 'resultId'. If no raising to the prefix path of
// the query needs to take place, these matches can be removed directly
// from the projection matches of this node. If raising may take place, 
// this function must first extract from 'removedMatches' those matches
// which are selection matches on this node (otherwise, because multiple
// elements may be raised to the same higher element, and only a count
// is maintained of the number fo elements raised to each higher element,
// removing a node which was never added may corrupt the refrence count).

IntersectionQueryCalc.prototype.removeProjMatchesFromSelectionProj = 
	intersectionQueryCalcRemoveProjMatchesFromSelectionProj;

function intersectionQueryCalcRemoveProjMatchesFromSelectionProj(removedMatches,
                                                                 resultId)
{
    if(!this.isGeneratingProjection())
        return;

    if(this.lowerThanQueryPrefixFullMatches()) {
        // raising needed, so must first check which removed projection 
        // matches are matched on this node.
        var maxCount = this.getFullMatchCount();
        var projMatches = [];
        for(var i = 0, l = removedMatches.length ; i < l ; ++i) {
            var elementId = removedMatches[i];
            if(this.matches.get(elementId) == maxCount)
                projMatches.push(elementId);
        }
        // raise (if needed), update this.projMatches and update 
        // the result node
        this.removeSelectionProjMatches(projMatches, resultId);
    } else {
        // no raising required, so no need to filter
        // update this.projMatches and update the result node
        this.removeSelectionProjMatches(removedMatches, resultId);
    }
}

///////////////////////
// Access to Matches //
///////////////////////

// This function returns an array with data element IDs of all selection
// matches of this node. These are the data elements with a maximal count 
// match on this node. The function calcMaxCountIsFullMatch() is used to 
// determine whether this is enough. If not, it must also be checked whether
// the path ID of the data element is a projection match point.
// During the query refresh process, or when the query is recalculated
// as a result of the removal of a query calculation node, the node
// may store the full matches as they were before the update. This
// function returns these stored matches until the update is complete. 

IntersectionQueryCalc.prototype.getMatches = intersectionQueryCalcGetMatches;

function intersectionQueryCalcGetMatches()
{
    var maxMatches = [];
    
    // during the query refresh process (or the removal of a sub-node)
    // we return the matches from before the change until the update
    // is completed.
    if(this.suspendedMatches) {
        this.suspendedMatches.forEach(function(count, elementId) {
            maxMatches.push(elementId);
        });
        return maxMatches;
    }

	var maxCount = this.getFullMatchCount();
    var enoughToCheckCount = this.calcMaxCountIsFullMatch();

    if(enoughToCheckCount) {
        // enough to check for maximal match count
        this.matches.forEach(function(count, elementId) {
		    if(count >= maxCount)
			    maxMatches.push(elementId);
	    });
    } else {

        var dataElements = this.indexer.getDataElements();
        var _self = this;
        
        this.matches.forEach(function(count, elementId) {
		    if(count >= maxCount && 
               _self.projMatchPoints.get(dataElements.getPathId(elementId)))
			    maxMatches.push(elementId);
        });
    }
		
	return maxMatches;
}

// This function is identical to 'getMatches' except that it returns
// the matches as a Map object whose keys are the matches.

IntersectionQueryCalc.prototype.getMatchesAsObj = 
    intersectionQueryCalcGetMatchesAsObj;

function intersectionQueryCalcGetMatchesAsObj()
{
    // during the query refresh process (or the removal of a sub-node)
    // we return the matches from before the change until the update
    // is completed.
    if(this.suspendedMatches)
        return this.suspendedMatches;

	var maxCount = this.getFullMatchCount();
	var maxMatches = new Map();
    var enoughToCheckCount = this.calcMaxCountIsFullMatch();

    if(enoughToCheckCount) {
        // enough to check for maximal match count
        this.matches.forEach(function(count, elementId) {
		    if(count >= maxCount)
			    maxMatches.set(elementId, 1);
	    });
    } else {

        var dataElements = this.indexer.getDataElements();
        var _self = this;
        
        this.matches.forEach(function(count, elementId) {
		    if(count >= maxCount && 
               _self.projMatchPoints.get(dataElements.getPathId(elementId)))
			    maxMatches.set(elementId, 1);
        });
    }
		
	return maxMatches;
}

// This function returns an array with data element IDs of all 
// data elements with a full match on this node which are
// also higher (or at) the root node's prefix path (these are matches
// which do not need to be raised any further). If the match points on
// the node indicate that no raising is necessary, the function simply
// calls 'getMatches'. Otherwise, the function must go over all matches
// and check the match count and the match point of each element and
// return only those elements which have a short enough path and a high
// enough match count.
// In case the node is suspended, the function goes over the suspended
// matches and checks which of them is high enough.
// Note: in the case this is a projection, all match points higher than 
// the root node's prefix path must also be projection mach points, so 
// it is enough to check for maximal count to determine the full match.

IntersectionQueryCalc.prototype.getFullyRaisedMatches =
    intersectionQueryCalcGetFullyRaisedMatches;

function intersectionQueryCalcGetFullyRaisedMatches()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatches();

    var maxMatches = [];
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    if(this.suspendedMatches) {
        this.suspendedMatches.forEach(function(count, elementId) {
            if(dataElements.getPathId(elementId) <= prefixPathId)
                maxMatches.push(elementId);
        });
    } else {
        var maxCount = this.getFullMatchCount();

        this.matches.forEach(function(count, elementId) {
            if(count >= maxCount &&
               dataElements.getPathId(elementId) <= prefixPathId)
                maxMatches.push(elementId);
        });
    }
		
    return maxMatches;
}

// This function is identical to 'getFullyRaisedMatches' except that it returns
// the matches as an object whose attributes are the matches.

IntersectionQueryCalc.prototype.getFullyRaisedMatchesAsObj =
    intersectionQueryCalcGetFullyRaisedMatchesAsObj;

function intersectionQueryCalcGetFullyRaisedMatchesAsObj()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatchesAsObj();

    var maxMatches = new Map();
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    if(this.suspendedMatches) {
        this.suspendedMatches.forEach(function(count, elementId) {
            if(dataElements.getPathId(elementId) <= prefixPathId)
                maxMatches.set(elementId, 1);
        });
    } else {
        var maxCount = this.getFullMatchCount();

        this.matches.forEach(function(count, elementId) {
            if(count >= maxCount &&
               dataElements.getPathId(elementId) <= prefixPathId)
                maxMatches.set(elementId, 1);
        });
    }
		
    return maxMatches;
}

// This fuction receives as input a list (array) of data element IDs
// and returns (in a new array) the subset of element IDs which are
// selection matches on this query calculation node. This function
// should never be called if this query calculation node is a projection,
// so it is enough to check for maximal match count to determine which
// data elements are full matches. 
// In case the node is suspended, this function checks which of the 
// elements in the given list is in the suspendedMatches list.

IntersectionQueryCalc.prototype.filterMatches = 
    intersectionQueryCalcFilterMatches;

function intersectionQueryCalcFilterMatches(elementIds)
{
    var matches = [];

    if(this.suspendedMatches) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.suspendedMatches.has(elementId))
                matches.push(elementId);
        }
    } else {

        var maxCount = this.getFullMatchCount();

        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.matches.get(elementId) >= maxCount)
                matches.push(elementId);
        }
    }

    return matches;
}

// This fuction receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are selection matches on this query calculation node. This function
// should never be called if this query calculation node is a projection,
// so it is enough to check for maximal match count to determine which
// data elements are full matches. 
// In case the node is suspended, this function checks which of the 
// elements in the given list is in the suspendedMatches list.
// This function is similar to 'filterMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

IntersectionQueryCalc.prototype.filterMatchPositions = 
    intersectionQueryCalcFilterMatchPositions;

function intersectionQueryCalcFilterMatchPositions(elementIds)
{
    var positions = [];

    if(this.suspendedMatches) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.suspendedMatches.has(elementId))
                positions.push(i);
        }
    } else {

        var maxCount = this.getFullMatchCount();

        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(this.matches.get(elementId) >= maxCount)
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

IntersectionQueryCalc.prototype.getProjMatches = 
	intersectionQueryCalcGetProjMatches;

function intersectionQueryCalcGetProjMatches(resultId)
{
    var thisProjMatches;

    if(!this.projMatches || !(thisProjMatches = this.projMatches.get(resultId)))
        return this.getFullMatchCount() > 0 ? [] : undefined;

    // convert into an array and lower (if necessary)
    var projMatches = [];
    thisProjMatches.forEach(function(count, elementId) {
        projMatches.push(elementId);
    });
    return this.lowerToPureProjMatchPoints(projMatches);
}

// This function receives a list of matches from a projection sub-node and
// returns the subset of these matches which are also projection matches
// on this node. If this node has no pure projection match points,
// it is enough to check for each match whether it is in the projMatches
// table of this node. If pure projection match points exist, we need
// to check for matches from these match points whether they can be
// raised to a match in this.projMatches.  

IntersectionQueryCalc.prototype.filterProjMatches = 
	intersectionQueryCalcFilterProjMatches;

function intersectionQueryCalcFilterProjMatches(matches, resultId)
{
    var projMatches = [];
    var thisProjMatches;

    if(!this.projMatches || !(thisProjMatches = this.projMatches.get(resultId)))
        return projMatches; // empty set

    // If there are no pure projection matches and in case the node is 
    // suspended, all projection matches are in this.projMatches.
    if(this.pureProjMatchPoints === undefined ||
       this.pureProjMatchPoints.size === 0 || this.isSuspendedProjection()) {
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
                while(elementId !== undefined && 
                      this.pureProjMatchPoints.has(
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
