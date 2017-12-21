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

// This file implements the base class for the query calculation nodes for 
// the internal QCM. The base class implements some basic common
// functionality. On top of this, specific derived classes are defined for
// each of the specific node types: intersection, union, negation,
// projection (terminal projection node) and simple (terminal values
// which are not projections).
//
// Data Representation
// ===================
//
// For a full description (with examples) of how the data is represented,
// see internalQCMIndexer.js which is responsible for storing the data
// in this representation (as well as indexing and compressing it, as
// necessary).
//
// In short, the data is represented as a set of data nodes, a subset
// of which are data elements. Each data node is defined at some path
// (represented by a path ID). Data nodes at the empty path (zero
// length path, also called the 'root path') must all be data elements
// and do not have a parent data element. All other data elements have
// a single parent data element, which must have a path which is a prefix of
// the path of the data element it is a parent of.
// A data element is said to be dominated by its parent data element and,
// recursively, by the dominating data elements of its parent data 
// element.
// A data node (whether a data element or not) is defined by its path ID
// and by its lowest dominating data element. If the node is a data element,
// it is its own lowest dominating data element. If the data node is
// not a data element, there is a unique data element which is the lowest
// dominating data element of the data node. The path of this data element
// must be a prefix of the path of the data node (if the paths are 
// equal then the data node is equal to the data element, by the definition
// just given).
// A data node x is said to dominate a data node y if the path of x
// is a prefix of the path of y and lowest dominating data element of
// x dominates (or equals) the lowest dominating data element of y. 
// The following must always hold:
//
//    If a data element d1 is the parent of a data element d2 then
//    if d1 is also dominates a data node n at a path equal or extending
//    the path of d2 then there must be a data element at the path of d2
//    whose parent is d1 and which dominates n (may be equal to n).
//
// In other words, once a data element d2 at a path P is defined
// to be a child of d1, d1 cannot dominate data nodes at paths 
// extending P with out having a child data element at P dominating
// those data nodes.
//
// By assigning IDs to data elements, it is possible to have multiple
// data nodes at the same path. At the same time, these data elements 
// need only be assigned where multiple data nodes appear at the same path.
//
// A data node n at path is P and with lowest data element d is a terminal
// node if d does not dominate any data node at a path extending P.
//
// A simple value may be assigned to any data node. It is required that
// a simple value be defined for every terminal data node. 
// 
// An indexer is used to store data using the representation described
// here (the indexer may then also index or compress this data, as necessary).
// For a somewhat easier introduction, with some examples, see the 
// introduction to internalQCMIndexer.
 
// Selection and Projection
// ========================
//
// The input set to which a query calculation is applied is given 
// by an indexer, a path (the 'prefix projection path') and a subset of 
// the data nodes stored by the indexer at this path. As decribed above, 
// since all these data nodes are at the same path, it is sufficient to 
// describe them by providing the IDs of the lowest data elements above them.
// The indexer and prefix projection path are stored in the root query
// calculation node at the root of the query calculation structure
// (the current implementation does not allow these to change - when
// they change, the whole query calculation structure is destroyed
// and a new one is created, since a change in the indexer or the 
// prefix projection path requires full recalculation of the query).  
// 
// A selection would extract a subset of the input data set, which can then 
// simply be described as a subset of the set of data element IDs defining
// the input.
//
// A projection will extract at each projection site a set of data nodes
// at the projection path of the projection site. The prefix projection
// path of the query is always a prefix (possibly equal) of the path
// of each projection site in the query. Because the path of the 
// projection site is fixed, all data nodes extracted at that path 
// can simple be represented by the IDs of their lowest dominating
// data elements.
//
// For a projection with a single projection site, this is already
// a sufficient representation of the projection. When a single 
// query has mutiple projection sites, the individual projections
// at each projection site must be combined into a single projection
// result. This is not performed by the query calculation nodes but
// by the query indexer (see documentation of the QueryIndexer class).
//
// Selection Matches
// -----------------
//
// Selection is calculated at each query calculation node by determining
// the set of data elements (represented by their IDs) which belong
// to the selection.
//
// Simple Queries:
//
// At a simple query calculation node, defined by one or more terminal
// values (possibly ranges, but not a projection terminal) the indexer 
// provides the simple query calculation node with a list of data element 
// IDs which define data nodes at the path of the simple node such that 
// the values of those data nodes match the selection criteria of 
// the query calculation node. The indexer updates the simple query calculation
// incrementally as the data in the indexer changes or the selection 
// values defined by the query calculation node change.
// This list of data element IDs is the selection of the simple query
// calculation node (for more details, see the documentation of 
// the SimpleQueryCalc class).
//
// Unions:
//
// The selection of a union query calculation node is also simple.
// It is simply the union of the sets of data element IDs which are
// the selections of its query calculation sub-nodes.
//
// Negation:
//
// The selection of a negation is also simple. The negation has a path ID
// and receives from the indexer a list of data element IDs representing 
// all data nodes at that path. It then receives from its query calculation
// sub-nodes the list of data element IDs representing the matches of those
// nodes. The matches of the negation node are then, roughly, those 
// data element IDs it received from the indexer which are not matched
// by any of its sub-node. This is not entirely accurate, because it
// may be that the data element IDs received from a query calculation 
// sub-node are at a longer path than the path of the negation node 
// and therefore will not appear in the list of data elements defined
// at the negation node. We therefore have to replace such data element IDs
// received from the sub-nodes by the data elements dominating them
// which are lowest dominating data elements at the negation path.  
// For more details, see the documentation of NegationQueryCalc.
//
// Intersection: 
//
// The selection of an intersection is, in principle, also simple:
// it is the set of data element IDs which appear in the selection 
// of each of its query calculation sub-nodes. However, since the
// query calculation sub-nodes represent queries on different paths,
// it may happen that the lowest data element for the data node matched
// by each query calculation sub-node is different but that there is
// a common data element dominating these data nodes. In this case,
// we may still sometimes want to have a match, but not any time that
// the data element IDs returned by the query calculation sub-nodes 
// have a common dominating node do we want to have a match (example
// will be given below). To describe the problem and its solution, 
// we introduce the concept of 'match points'.
//
// Match Points:
//
// Match Points are path IDs. Every simple query calculation node has 
// match points (a sequence of path node IDs) which are updated by 
// the indexer. The match points consist of the IDs of all paths 
// in the indexer carrying data elements and which are a prefix of
// (possibly equal to) the path of the simple query calculation node.
//
// When a query is composed of several child query calculation nodes,
// their match points may consist of common path IDs. These
// common path IDs are exactly those on the common prefix of the paths
// of the child query calculation nodes.
//
// In case of an intersection of several such child queries, if a query
// matched a data element then that data element is necessarily carried
// on one of the path nodes in the query's match points. If that 
// path node appears in the match points of some other simple query
// in the same intersection, that query must also match the same data 
// element for the intersection to match.
//
// First, consider the following example, which shows that it is not enough 
// for two sub-queries to match on a dominating data element:
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
// The match points of both these queries consist of the root path node 
// [] (data element i0) and the path node [a] (data elements i0:a:i0 and
// i0:a:i1). Matching by the queries must begin with the lowest data element.
// In this case both a:b:1 and a:c:1 match a data element at path [a],
// but not the same one: a:b:1 matches i0:a:i0 and a:c:1 matches i0:a:i1.
// While these two data elements have the same parent (i0) this is not 
// considered a match.
//
// Now consider the data:
// o({
//      a: o({ b:1, c:1 }, { b:2, c:2 })
//      d: 1
//   },
// )
// and the query { a: { b:1, c: 1}, d: 1 }.
// Here, as in the previous case, the two queries a:b:1 and a:c:1 must 
// both match on the same data element at path [a] in order to match
// (in this modified example this holds because both queries match i0:a:i0).
// The third query in the intersection d:1, does not have the path [a] 
// in its match points. The only path in its match points is []
// (this path is appears in the match points of all queries).
// Therefore, after establishing the match of i0:a:i0 for all queries
// which have the corresponding path in their match points,
// we raise the data element to its parent data element, i0. This is now
// in path [] which is common to all three queries and therefore must be
// matched by all three queries. This is indeed the case here.
//
// The exact implementation of this algorithm is detailed in the
// documnetation of IntersectionQueryCalc.
//
// The Query Result:
//
// The actual result of a selection must always be given in terms of data
// elements higher that then prefix path of the root of the query.
//
// Assume the following variation of the first example:
//
// Data:
// o({
//      a: o({ b:1, c:1, d:2 }, { b:2, c:2, d:1 })
//   },
// )
// with the same query { a: { b:1, c: 1 }}.
// 
// Here, both simple queries match on data element i0:a:i0. However,
// this is not the result of the query. Rather, its dominating parent
// i0 must be the result of the query. This is because the selection is 
// on the top ordered set of the data and the result must be given
// in terms of data element under that ordered set. When the query
// { a: { d: 1 }} is now composed with this result:
//
// [{ a: { d: 1 }} [{a: { b:1, c:1 }}, <data>]]
//
// The query d:1 matches i0:a:i1, but the path [a] is now only in the
// match points of the query { d:1 }  and not in the match points
// of the result of the first query (the only match point of the 
// result is [], as this is the match point of the prefix path of
// the root). Therefore, we raise i0:a:i1 to i0 and this is matched
// also by the result and therefore we have a match here.
//
// To implement this, result nodes carry the match points of the
// root prefix path and any data element they receive as matched from
// the query calculation nodes is raised until it reaches one of these
// match points.
//
// (see the documentation of InternalQueryResult and InternalRootQueryCalc
// for more details).
//
// Adding and Removing Matches
// ---------------------------
//
// Matching is implemented through a 'addMatches' and 'removeMatches'
// interface which allows the indexer to add and remove matches from
// a simple query calculation node and allows the children of a
// query calculation node to add to or remove matches from their parent
// (a union, negation, intersection or root query calculation node). 
// Each type of node then processes these add and remove match calls
// slightly differently. Most of them need to keep track of the number of
// times each data element ID was added and removed (since each can
// be reeived from multiple sub-nodes).
//
// The details for each type of node are described in the documentation
// of the relevant class.
//
// Projections
// ===========
//
// A node is defined to be a projection if it is a simple projection
// node (which defines a path which needs to be projected) or if it is 
// a compound node (intersection, union or negation) with
// at least one child which is a projection. Moreover, all direct children
// of a projection union are considered projections. If these nodes
// are selection nodes (are not themselves projections, that is, dominate no 
// simple projections) then these are considered 'selection-projection' 
// nodes (nodes which project their selection). These nodes are assigned 
// the prefix path of the query as their projection path. See more details 
// below.
//
// Each projection node defines its set of projection matches. This
// is essentially an intersection of its own 'selection matches'
// and the projection matches of its dominating node (or the root query
// calculation node, for the top query calculation node). The dominating
// node may also indicate that it does nto restrict the projections
// of the sub-node. In this case, the 'selection matches' are 
// immediately also the projection matches.
//
// Simple Projection:
//
// For a simple projection query calculation node, the 'selection matches'
// are the data element IDs representing all data nodes at the path of 
// the projection (this list is provided by the indexer). These are then
// intersected with the projection matches of the dominating node.
//
// Union Projection:
//
// Union nodes are transparent to the calculation of projection matches.
// This is because any 'selection match' of a sub-node is immediately
// also a selection match of the union node. Therefore, they do not restrict 
// the projections in any way (but the node which dominates the union node 
// may still do so).
//
// Negation:
//
// Negation nodes do not negate their projection sub-nodes. However, if 
// the same negation node dominates both selection and projection nodes,
// the selection nodes are negated and the projection nodes project only
// under this negation. When the negation node node is dominated by an 
// intersection node with multiple projection sub-queries, the projection
// sub-queries (including the negation) are required to adde their 
// matches to the selection. In this case, the projection nodes under
// the negation add their node to the selection of the negation node.
// These selections are not negated. Therefore, the selection matches
// of the negation node are, in this case, those nodes which are matched
// by at least one projection sub-node but not by any selection sub-node. 
//
// Intersection:
//
// When an intersection has a single projection sub-query, the projection
// is calculated by first calculating the intersection of the selection 
// of the other (selection) sub-queries. These are the 'selection matches'
// of the intersection node and are intersected with the projection 
// matches of the dominating node to produce the projection matches of
// the intersection. The projection sub-node of the intersection then 
// intersects its own selection matches with these projection matches
// to calculate its own projection matches. For this reason, there
// was no need to include the selection matches of the projection sub-node
// in the calculation of the selection matches of the intesection 
// node.
//
// Example:
//
// { a: 1, b: 2, c: _ }
//
// The intersection node's selection matches are those elements of the
// data which have a:1 and b: 2. They may or may not have a path c.
// Assuming these selection matches are also the projection matches
// of the query (we assume there is no further restriction by composition
// with another query) these elements are then intersected with those
// elements which have a path c (the 'selection matches' of the projection
// query on c). This results in the nodes under path c for elements
// with a:1 and b: 2.
//
// When an intersection projection has multiple projection under it
// (say { a: 1, b:_, c:_ }) we have to include the selection matches
// of the projection nodes in calculating the selection matches
// of the intersection node. This is because the projection is only
// allow to project under data nodes which have a value under each
// of te projected paths. For example, { a: 1, b:_, c:_ } projects
// the values under b and c under all nodes which have a:1 and have
// both b and c defined. If the selections under b and c were not
// propagated to the intersection node, it would not have been possible
// to determine at the projection nodes for b and c which nodes
// may be projected and which not.
//
// For more details, see the documentation of IntersectionQueryCalc.
//
// Selection-Projections
// ---------------------  
//
// Selection-projection nodes are nodes which are themselves selection
// node (do not dominate a projection node) but are members of a
// projection union (some other member of the union is a projection).
// The projection set of these node is calculated similarly to the process
// described above except that the data elements must be raised until they
// reach a path which is at least as high as the query's 
// prefix path. This is implemented by calculating the projection 
// set in the standard way (intersecting the matches of the node with
// the projection set of the parent) and then raising the data elements
// which are too low.
//
// Example:
// 
// Data:
// o(
//    {
//       a: o(
//              { b: 1, c: 1, d: 2 },
//              { b: 2, c: 3, d: 4 },
//              { b: 3, c: 5, d: 6 }
//          ),
//       e: 1
//    },
//    {
//       a: o(
//              { b: 1, c: 7, d: 8 },
//              { b: 2, c: 9, d: 10 },
//              { b: 3, c: 11, d: 12 }
//          ),
//       e: 1
//    },
//    {
//       a: o(
//              { b: 1, c: 1, d: 14 },
//              { b: 2, c: 9, d: 16 },
//              { b: 3, c: 11, d: 18 }
//          ),
//       e: 2
//    },
// )
//
// query:
// { a: o({ b: 1, c: 1}, { b:2, c: 9, d:_ }), e:1 }
// 
// The query union consists of one projection and one selection. The selection
// is, therefore, a selection-projection. As a selection, this matches
// the data elements i0:a:i0 and i2:a:i0. The projection in this union 
// matches the data elements i1:a:i1 and i2:a:i1. These data elements are
// then also matched by the union node, and raised to the parent nodes
// i0, i1 and i2 on the top intersection node. There, only i0 and i1
// receive the full match count of 2 because e:1 only matches those
// two data elements. The projection of the intersection node therefore
// consists of i0, i1, i2 and the data elements raised to these nodes,
// namely, i0:a:i0 and i1:a:i1. On the projection node in the union
// (the query { b:2, c: 9, d:_ }) the projection is then the intersection
// of the node's matches with the projection of the union node, namely
// i1:a:i1. On the selection-projection node, however, the projection
// is first calculated in the same way, resulting in i0:a:i0 but this
// data element must then be raised to a match point at least as high as
// the prefix path of the query (we assume [] in this case). This results
// in the data element i0.
//
// Representation of Projections
// -----------------------------
//
// The query calculation nodes are responsible for calculating the 
// projection at each projection site (simple projection query calculation
// node) separately. When there are multiple projection sites, these
// need to be combined. This is taken care of by the root query calculation
// node (see 'Generating Projection Queries' in the documentation of 
// InternalRootQueryCalc) this result node and the query indexer
// (see documentation for InternalQueryResult and QueryIndexer).
//
// Multiple Query Results Using Same Query
// ---------------------------------------
//
// When multiple query result nodes make use of the same root query calculation
// node, they can share the calculation of the matches of the query calculation
// nodes (as these only depend on properties of the root query calculation
// node) but may require separate handling of the projection matches for
// each query result node. This is because the projection calculation process
// is top-down and requires the matches of each node to be intersected with
// the projection matches of the node above it. This holds also for the matches
// of the different result nodes: when these result nodes use different
// data nodes (that is, the input to the query is different) the projection
// matches should be intersected with the matches of these data result
// nodes and may, thereofore, differ among result nodes. Therefore, the
// projection matches are calculated separately for every result node
// making use of the root query calculation node to which a query calculation
// node belongs. This means that the relevant tables (e.g. projMatches,
// preProjMatches, see details below) are repeated per result ID.
//
// Query (Re-)Compilation
// ----------------------
//
// When the query changes, the Query object recompiles it. This translates
// into different operations applied to the query calculation nodes:
// 1. Query calculation are destroyed.
// 2. New query calculation nodes are created.
// 3. A query calculation node is inserted under another query calculation
//    node.
// 4. A union node is spliced out of the structure when it has only one
//    sub-node. The union node is destroyed its sub-node is inserted
//    as a sub-node of the node which dominated the union node.
// 5. The selection values of a simple node may be added, removed or changed.
//
// The node removal operations, in which a node is destroyed and removed
// from its dominating node, are processed immediately, while node creation
// and modification operations are queued: the node is immediately added to 
// the list of sub-nodes of its dominating node, but no further update takes
// place. The node is registered to the this.updatedSubNodes list of
// its new parent. Modified nodes or nodes which have some node modified
// or added under them are also added to the this.updatedSubNodes list
// of the dominating node. This means that starting at the top node,
// we can use the this.updatedSubNodes table to go down all changed 
// branches of the query. During the refresh cycle which takes place after the 
// query (re-)compilation is completed, the refresh process refreshes
// all nodes which are found in this.updatedSubNodes (and this happens
// recursively).
// 
// Therefore, there are two different sets of functions to deal with 
// the refresh of the query:
// 1. Node removal functions. These functions are used to refresh the
//    query after the removal of a single sub-node of a compound node
//    (intersection, union or negation). For every removal, the query 
//    is completely refreshed.
//    Since a single removal takes place, there are several restriction
//    on what kind of changes can take place.
//    For full details on the update algorithm for node removal, see
//    the introduction to the "Sub-Query Removal" section of the code below. 
// 2. Query Refresh functions. These update the modifications and
//    new nodes which were queued earlier. Since nodes can only be 
//    added in this refresh (or the selection values of a simple selection
//    can change) there are several restrictions on the changes
//    that can take place in the query.
//    For full details on the update algorithm for the query refresh, see
//    the introduction to the 'Query Refresh' section of the code below. 
//
// Object Structure
// ================
//
// {
//    indexer: <InternalQCMIndexer>,
//
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
//    // for projections only
//
//    // common fields for all result nodes
//
//    projSubNodes: {
//        <query calc ID>: <InternalQueryCalc>,
//        ......
//    },
//    projSubNodeNum: <number of sub-projections>
//    mustAddMatches: true|undefined
//
//    // per-result projection fields
//
//    projMatches: <Map>{ // on projection and selection-projection nodes
//       <result ID>: <Uint31HashSet>
//       ....
//    }
//
//    // refresh (temporary) fields
//
//    suspendedMatches: <Map object> {
//        <data element ID>: true,
//        ......
//    }
//    projectionSuspended: true|undefined
// }
//
// indexer: this is the internal indexer used in calculating this query.
//    the indexer is fixed for the root query calculation node so it
//    is also fixed for the query calculation nodes (if the indexer needs
//    to be replaced, the query calculation nodes are destroyed and 
//    new nodes are created).
//
// The following fields are used in calculating the selection of this node
// (whether this is a selection or a projection node).
//
// matches: holds match counts for data elements which were (partially)
//   matched on this node. The interpretation of the counts and whether
//   they mean that the data element was matched or not depends on the
//   type of node. See more in the 'selection' section of the code.
//   The projection noe does not make use of this field (and therefore
//   it is intialized in the derived classes and not the base class).
//
// matchPoints: the keys of this object are path node IDs and the
//   values are the number of sub-nodes where this path ID appears in 
//   the match points (for simple nodes this is always 1). Typically, 
//   this list is probably very short.
//
// Projection Fields:
//
// projSubNodes:
//   For a union, negation or intersection node, this is the list of sub-nodes
//   which are projections.
// projSubNodeNum: number of elements in 'projSubNodes'.
// mustAddMatches: this field is only used on projection and
//   selection-projection query calculation nodes. It is set to true
//   if the node is required to add its 'selection matches'
//   to the dominating query calculation nodes. Whether this is
//   require or not is determined by the subProjMustAddMatches()
//   function on the parent node (basically, if this projection node
//   is part of a multi-projection intersection but does not cover all its
//   projection sites - see more details in the documentation of
//   subProjMustAddMatches()). The mustAddMatches stores this property
//   so that the function subProjMustAddMatches() does not have to be
//   called repeatedly and (much more importantly) so that during the
//   query refresh process the previous value of this property is
//   known.
//   Note: the top query calculation node always calls 'addMatches()' with
//   its selection matches on its match parent, which is the root query
//   calcualtion node. This, however, is not considered a case of 
//   'must add matches' because this does not affect the way the selection
//   matches are calculated (projection sub-nodes do not need to add their
//   matches).
//
// Remark: most of the above fields do not appear on a selection-projection 
//   node. A projection selection node does, however, have a a 'mustAddMatches'
//   field and a 'projMatches' field (see below).
//
// projMatches: this field stores the projection matches of the node.
//   Different types of node have different definitions for the matches 
//   which are stored in this table (see, especially, the intersection node).
//   This table consists of multiple tables, one for each result node 
//   registered to the root query calculation node. Each table is
//   a Uint31HashSet object, which allows to store a set of IDs (without
//   any additional information about these IDs, as we have no match
//   counts for the projection matches).
//
// suspendedMatches: in the process of refreshing the query structure
//   (when a sub-node is removed or during the query refresh) the node
//   may be suspended. When this node is suspended, the full matches
//   are stored in this table, so that when the node matches are
//   recalculated, it would be possible to compare the list of full
//   matches before and after the refresh and notify the matching
//   parent with this difference.
//   As long as the 'suspendedMatches' list exists, the getMatches() and
//   getMatchesAsObj() functions should return this list of matches
//   and will not recalculate the full matches.
// projectionSuspended: this is set to true when projection is suspended
//   on this node (including the case where the node is fully suspended).
//   This is reset to undefined when the node is unsuspended.

// %%include%%: "queryCalc.js"

inherit(InternalQueryCalc, QueryCalc);

//
// Constructor
//

// The constructor takes one argument: the root query calculation node
// which created it.

function InternalQueryCalc(rootQueryCalc)
{
	// call base constructor
	this.QueryCalc(rootQueryCalc);

	this.indexer = rootQueryCalc.getIndexer();
	this.matchPoints = new Map();
}

// Destroy function (derived classes should define their own destruction 
// function which calls this function).

InternalQueryCalc.prototype.destroy = internalQueryCalcDestroy;

function internalQueryCalcDestroy()
{
	// base class destroy (this also detaches from the root query calculation
    // node if this is the top query calculation node)
	this.QueryCalc_destroy();

    // release the allocation of the path ID.
    if(this.pathId)
        this.indexer.qcm.releasePathId(this.pathId);
}

// Auxiliary function used when destroying query calculation nodes registered
// to the indexer (negation, simple and projection).
// This function removes the registration of the query calculation node
// from the indexer and releases the allocatino of the path ID.

InternalQueryCalc.prototype.detachFromIndexer = 
    internalQueryCalcDetachFromIndexer;

function internalQueryCalcDetachFromIndexer()
{
    // detach from indexer
    this.indexer.removeQueryCalcFromPathNode(this);
}

///////////////////////////////
// Property Access Functions //
///////////////////////////////

// Returns true if this node is a simple selection node and false otherwise.

InternalQueryCalc.prototype.isSelection = internalQueryCalcIsSelection;

function internalQueryCalcIsSelection()
{
	return (this.nodeType == "simple" && this.valueType != "projector");
}

// Returns true if this node is a projection node (but not a 
// selection-projection node) and false otherwise.

InternalQueryCalc.prototype.isProjection = internalQueryCalcIsProjection;

function internalQueryCalcIsProjection()
{
	return (!!this.projSubNodeNum || this.valueType == "projector");
}

// This function returns true if this is a union node and false
// otherwise. The implementation here is for all node types except 
// the union node (which overrides this function, of course).

InternalQueryCalc.prototype.isUnion = internalQueryCalcIsUnion;

function internalQueryCalcIsUnion()
{
	return false;
}

// This function returns true if this is a negation node and false
// otherwise. The implementation here is for all node types except 
// the negation node (which overrides this function, of course).

InternalQueryCalc.prototype.isNegation = internalQueryCalcIsNegation;

function internalQueryCalcIsNegation()
{
	return false;
}


// This function should be called to determine whether whether projection
// sub-nodes of this node need to call the 'addMatches' function
// of this query calculation node with their selection matches. This is 
// required in case the projection sub-node does not cover all projection
// terminals in the query. The implementation in the base class is
// for nodes other than the intersection query calculation node 
// (which has its own implementation of this function). The implementation
// here simply checks the same property on the parent node. This is
// for union nodes and negation nodes (simple and projection nodes
// do not have sub-nodes, so this function is never called on such 
// query calculation nodes).
// See also the 'this.mustAddMatches' proeprty which is set on the sub-nodes
// which need to add their matches.

InternalQueryCalc.prototype.subProjMustAddMatches = 
	internalQueryCalcSubProjMustAddMatches;

function internalQueryCalcSubProjMustAddMatches()
{
	return (!!this.parent && this.parent.subProjMustAddMatches());
}

// This function returns true if this node needs to add its selection
// matches to its match parent. This returns 'false' (no need to add
// the matches) only if this is a projection and the this.mustAddMatches 
// property is not true or if this is a selection projection node and
// the parent (which must be a union) does not have this.mustAddMatches true). 
// This is a default implmentation which may be overridden in some
// derived classes (e.g. union, which cannot be a selection projection
// and therefore does not need to check this condition).

InternalQueryCalc.prototype.shouldAddMatches = 
	internalQueryCalcShouldAddMatches;

function internalQueryCalcShouldAddMatches()
{
    return ((this.mustAddMatches || !this.isProjection()) && 
            (!this.isSelectionProjection() || this.matchParent.mustAddMatches));
}

// This function returns true if this node is a selection-projection node.
// A node is a selection-projection node if it is not a projection
// node but its parent is a projection union.
// The union node overrides this default implementation (the union node
// always returns false for this function).

InternalQueryCalc.prototype.isSelectionProjection = 
	internalQueryCalcIsSelectionProjection;

function internalQueryCalcIsSelectionProjection()
{
	return (!!this.parent && this.parent.isUnion() && 
            !!this.parent.isProjection() && !this.isProjection());
}

// This function should only be called on a projection query calculation
// node. The function returns true if this node structurally adds projection
// matches to its projection sub-nodes. This is true if this is an
// intersection node with at least two sub-queries or if the match parent
// of this node has this property. Here, we implement the default case
// (used by all classes except the intersection node).

InternalQueryCalc.prototype.addsProjMatchesToSubNodes = 
	internalQueryCalcAddsProjMatchesToSubNodes;

function internalQueryCalcAddsProjMatchesToSubNodes()
{
    if(this.matchParent === undefined ||
       this.matchParent == this.rootQueryCalc)
        return false;

    return this.matchParent.addsProjMatchesToSubNodes();
}

//////////////////
// Match Points //
//////////////////	

// This function returns true iff there are match points with a full match 
// count on this node which are lower than the query prefix path.
// The implementation below is the default implementation, for all
// query calculation node types except intersection. The 
// Intersection derived class has another implementation for this function.

InternalQueryCalc.prototype.lowerThanQueryPrefixFullMatches = 
    internalQueryCalcLowerThanQueryPrefixFullMatches;

function internalQueryCalcLowerThanQueryPrefixFullMatches()
{
	var prefixPathId = this.rootQueryCalc.prefixProjPathId;

    var isLower = false;
    
    this.matchPoints.forEach(function(count, pathId) {
        if(pathId > prefixPathId)
            isLower = true;
    });

	return isLower;
}

// This function returns a Map object whose keys are the match points
// (path IDs) whose count is equal or larger than the count required for
// a match at this query calculation node. For all nodes, except the
// intersection query calculation node, this is 1, so all match points 
// are full count match points and the function simple needs to 
// return the match point table. For the intersection query calculation 
// node there is a separate implementation, in the derived class.

InternalQueryCalc.prototype.getFullCountMatchPoints = 
    internalQueryCalcGetFullCountMatchPoints;

function internalQueryCalcGetFullCountMatchPoints()
{
    return this.matchPoints;
}

///////////////////////
// Sub-Query Removal //
///////////////////////

// When a query calculation node is removed from the query calculation
// structure, the query structure, the match points, the matches
// and the projection matches are all updated. This happens immediately,
// to simplify the update logic.
//
// The removal of a projection node can affect the types of other nodes
// in the query. If this was the last projection sub-node under a compound
// node, that compound node will become a selection (or a selection-projection).
// This effect may then propagate further up the query calculation 
// domination chain (in case each projection which becomes a selection
// was the last projection under the dominating node). This may also
// affect nodes which do not dominate the projection node removed.
// If a union node changes from a projection to a selection, by one
// of its sub-nodes changing from a projection to a selection, then
// all other sub-nodes change from being selection-projections to being
// selections.
//
// In addition, the removal of a projection node can change the 'must add
// selections' property of projection nodes. This happens in case 
// one of two projections under an intersection node becomes a selection
// (or is removed). In this case, the remaining projection, which did 
// had to add its selection matches to dominating node so far
// now does not need to do so anymore.
//
// The possible changes are, therefore:
// 1. projection -> selection: this happens if a projection node was
//    removed from under this node (and this node is not a multi-projection).
// 2. selection-projection -> selection: this happens when the node is 
//    a sub-node of a union or negation and another sub-node of that union
//    or negation was the only projection sub-node and has become 
//    a selection.
// 3. adding projection -> non-adding projection: this happens when one
//    of two projection under an intersection is removed or becomes
//    a selection. The remaining projection nodes under the intersection
//    (unless they are dominated by another multi-projection intersection)
//    then become non-adding projections.
//
// Note that the changes only affect a single path in the query tree:
// the path goes up from the node removed up its dominating nodes
// as long as the removal causes the dominating node to change from
// a projection to a selection. If a union node is reached and that
// node changes from a projection to a selection, its other sub-nodes
// change from selection-projections to selections. This does not
// affect the matches of those sub-nodes (it only requires them to
// clear their projection matches and remove themselves as generating 
// projections from the root query calculation node).  
// If the update propagation reached an intersection node
// which previously had two sub-projections and now has a single 
// sub-projection (and did not itself have to add its selection matches
// to the parent) the propagation up the domianting chain stops 
// (the node remains a projection) and continues down the remaining
// sub-projection chain (which change from adding to non-adding).
// 
// Since the effects of the removal only affect a single path in the
// query tree, it is possible to perform the structural change, the 
// match point update and the match update in one cycle (as opposed to 
// query refresh, where different branches of the query can change 
// and where structurual refresh must be compeleted before the match point
// update takes place and match point update must be completed before
// match update can take place). 
//
// The update first performs the structural changes (removal from the 
// list of projection sub-nodes and removal as generating projection,
// as necessary) and then propagates the update from the removed node along 
// the path affected by the change. On the way out of this recursion,
// the match points and matches are updated. This, therefore, happens
// 'backwards' so that each node can first update its match points and
// matches based on the structural change and its own match point
// change but based on the old match points and matches of the previous
// nodes in the affected path and then receive incremental updates
// from the previous nodes in this chain, as they become updated.
// The various derived classes must make sure that while they recursively
// call the update function on the next node in the chain, their 
// getMatches() and getFullCountMatchPoints() continue to return the 
// values from before the update (later they should propagate any
// changes using the standard interfaces).
//
// For this update, all compound nodes must implement the function
// updateQueryAfterNodeRemoval(<sub-node>). This function is called
// when a sub-node was removed from the query structure. <sub-node> is
// a sub-node of this node such that either <sub-node> is the node
// removed (it is then no longer found in this.subNodes) or it is the
// sub-node under which the removal took place. In the second case,
// the removed node must have been a projection node (otherwise its
// removal would have had no consequences for this node).
//
// The function updateQueryAfterNodeRemoval() is also defined on the
// root query calculation node. It should be called by the top 
// query calculation node when it changes from a projection to a selection
// as the result of the removal of a projection sub-node.
//
// A compound node must also implement the function 
// unsetSubProjsMustAddMatches() which is called when the node is a projection
// node and as a result of the node removal changed from a node which
// needs to add its selection matches to the parent to a node which
// does not need to do so. This should be defined in each derived class
// separately.

//

// This function is called when this node is detached from its 
// previous parent node. All this function needs to do is suspend
// its projection calculation and wait for the query refresh.

InternalQueryCalc.prototype.clearParent = internalQueryCalcClearParent;

function internalQueryCalcClearParent(subNode)
{
	if(this.destroyed)
        return; // no need to update, this node was already destroyed
    
    this.suspendProjection();
}

// This function is called when the sub-node 'subNode' of this query 
// calculation node is removed.
// If the node itself is already destroyed, this does nothing.
// Otherwise, it performs the removal, using the derived class
// function (see introduction above).

InternalQueryCalc.prototype.clearSubNode = internalQueryCalcClearSubNode;

function internalQueryCalcClearSubNode(subNode)
{
	if(this.destroyed)
        return; // no need to update, this node was already destroyed
    
    this.updateQueryAfterNodeRemoval(subNode);
}

// This function is called on a projection node (intersection, union,
// negation or terminal projection) or a selection-projection node by
// its parent query calculation node to indicate that from now on it
// does not need to add its selection matches to the parent. This is called
// during the removal of a query calculation node.  This function checks whether
// it previously needed to add its selection matches to the
// parent. If it did not, there is nothing more to do. Otherwise,
// it needs to check whether it also applies to its projection sub-nodes 
// that they do not need to add their matches to their parent and if 
// that is indeed so, unsets the property also on those nodes
// (this step is carried out by the function this.unsetSubProjsMustAddMatches
// which is defined only in derived classes for query calculation nodes 
// with sub-nodes).

InternalQueryCalc.prototype.unsetMustAddMatches = 
	internalQueryCalcUnsetMustAddMatches;

function internalQueryCalcUnsetMustAddMatches()
{
    if(!this.mustAddMatches) 
        // property did not change for this node, so also not for sub-nodes
        return;

    this.mustAddMatches = false;

    // unsetSubProjsMustAddMatches exists only in some derived classes
    if(this.unsetSubProjsMustAddMatches && !this.subProjMustAddMatches())
        this.unsetSubProjsMustAddMatches();
}

// This function is called on a selection query calculation node which is
// a direct child of a union node when that union node changes from a 
// projection node to a selection node as a result of the removal of
// a projection sub-node directly or indirectly under the union node
// (note: this function is not called on the sub-node under which the
// removal took place because that node was a projection, not a 
// selection-projection before that change).
// This function performs the required cleanup. This include clearing
// the this.projMatches table (which is no longer needed) and 
// removing this node's registration as a generating projection node
// with the root query calculation node.

InternalQueryCalc.prototype.unsetSelectionProjection = 
    internalQueryCalcUnsetSelectionProjection;

function internalQueryCalcUnsetSelectionProjection()
{
    if(this.projMatches)
        this.projMatches = undefined;
    this.rootQueryCalc.removeGeneratingProj(this);
}

// This function is called on a selection query calculation node which is
// a direct child of a union node when that union node changes from a 
// selection node to a projection node and its selection sub-nodes
// (including this node) become generating selection-projection node
// (it is the responsibility of the calling function to verify that the
// selection node is a generating projection node). This function then
// registers this node as a generating selection projection to the
// root query calculation node. All projection match initialization will
// take place later.

InternalQueryCalc.prototype.setSelectionProjection = 
    internalQueryCalcSetSelectionProjection;

function internalQueryCalcSetSelectionProjection()
{
    this.rootQueryCalc.addSelectionGeneratingProj(this);
}


///////////////////
// Query Refresh //
///////////////////

// Query refresh is called after the Query object which compiles this 
// query has completed its update cycle. At this point, all removals
// of query calculation nodes have already taken place, but the addition
// of new query calculation nodes and the update of the values (addition 
// and removal) of the simple terminal query calculation nodes have not 
// yet taken place.
//
// The refresh has three steps: first, the structure of the query
// calculation node tree is determined (the 'structure refresh' step),
// next the match points are updated and then the matches and
// projection matches are updated (the 'match refresh' step).
//
// Structure Refresh:
//
// To determine the structure of the tree, we need to determine how
// many sub-nodes each compound node has and how many of these are
// projections. Compound nodes dominating projection node then also 
// become projection nodes. Selections inside a projection union become
// selection-projections (see introduction to InternalQueryCalc).
// Since at this stage query calculation nodes can only be added, but not 
// removed, a compound selection node can become a projection, 
// or a selection node can become a selection-projection but not
// the other way around.
//
// In addition, we need to determine, for projection nodes, whether
// they need to perform an 'addMatches' operation on their parent 
// node. When an intersection node has at least two projection 
// sub-nodes, it turns this property on its projection sub-nodes and, 
// recursively, on their projection sub-nodes. When this property 
// was turned on (did ot exist before) the projection sub-node
// is considere a new sub-node for subsequent refresh steps.
//
// The structual refresh proceeds top-down, starting at the top query 
// calculation node and going down recursively to all sub-nodes which 
// appear in the updatedSubNodes list. This ensures that the process goes 
// down all branches of the query structure which have changed.
//
// The recursive step simply updates the 'matchParent', 'projSubNode'
// and 'projSubNodeNum' fields of the compound query calculation
// nodes. The update of 'matchParent' takes place on the way into the
// recursion while the update of 'projSubNode' and 'projSubNodeNum'
// takes place on the way out of the recursion, so it actually takes
// place bottom-up (for each branch of the tree). The update of the
// 'projSubNodeNum' indirectly also updates the 'isProjection()'
// property and the 'mustAddMatches' property (see above for some more
// details). As this step can only add query calcualtion nodes, it can
// only increase 'projSubNodeNum'. Therefore, the property
// 'isProjection()' can only change from false to true and
// 'mustAddMatches' can change from false to true (the opposite
// changes happen when query calculation nodes are removed).
//
// When not defined, 'matchParent' should be set equal to the 'parent' of 
// the node and, if 'parent' is not defined, to the root query
// calculation node. However, it is also sometimes allowed for extra
// nodes to be inserted between a query calculation node and its 'parent'.
// In this case, 'matchParent' may point at such an intermediate node.
// Such an insertion may be perfromed by a high node (e.g. a negation
// node can insert such an intermediate node between an intersection 
// and its sub-projection). This replacement will take place on the way 
// out of the recursion, as it is only then that the domianting node
// knows the types (selection/projection) of the nodes under it. 
//
// Finally, this step also determines which query calculation nodes are
// candidate generating projections (see isGeneratingProjection() above
// and the documentation of InternalRootQueryCalc for the definition 
// of these). This property depends only on the structure updated
// in the structure refresh phase, so it can be updated immediately
// on the root query calculation node. Simple projection nodes 
// are always generating projections. Intersection nodes are generating
// projections if either they dominate more than one projection node
// (in which case, the refresh of the node itself can update the 
// property) or if the node is a selection-projection. Whether a node
// is a selection-projection depends on its parent (union or negation) node.
// While the intersection node may not have been updated at all
// it may change from a selection to a selection-projection due to 
// cahnges to other sub-nodes of its parent. Therefore, it is the parent
// node which has to update the generating projection status of its
// sub-nodes. Note that during the refresh phase, a selection node
// may become a selection-projection, but not the other way around
// (as no projections can be removed, only added).
//
// Match Point Refresh:
//
// After having determined the number of sub-queries for each compound
// node and after having determined how many of them are projections,
// we can proceed to update the match points on the query calculation nodes.
// This can only take place after the number of sub-projections is known,
// as match points are added from a projection sub-node of an intersection node
// to the intersection node only if that projection node adds its matches
// to the intersection node.
//
// Just like the structual refresh, this refresh proceeds recursively, 
// top-down. Each step starts at the top query calculation node and
// goes down recursively to all sub-nodes which appear in the 
// updatedSubNodes list. This ensures that the process goes down all 
// branches of the query structure which have changed.
//
// Having already updated the projection properties, we update the match points.
// This happens top-down. Each new query calculation sub-node added under 
// a compound query calculation node, adds its match points to its
// parent node (see details in the match point section). New simple
// and projection query calculation nodes are registered to the indexer and are 
// updated by the indexer with their match points. Each match point 
// update is propagated immediately to the parent query calculation node,
// so this results in the full update of the match points.
//
// Each query calculation node has a refreshMatchPoints() function.
// This function refreshes the match point count on that node. This function 
// also recursively calls the match point refresh on the sub-nodes.
// This function is responsible for updating its match parent with 
// match points which were added and removed (relative to the match 
// point list at the beginning of the refresh), using the standard 
// 'addToMatchPoints' and 'removeFromMatchPoints' interface.
// This function does not, however, need to deal with cases where the 
// relation with the parent has changed, including:
// 1. this is a new sub-node of the parent, in which case also existing 
//    match points need to be added to the parent.
// 2. this node is not a new sub-node of its parent but has now changed from
//    a selection to a projection and as a result of that no longer needs
//    to add its selection matches to the parent (in which case its 
//    match points are no longer added to the match points of the parent).
// It is the responsibility of the parent to add or remove the existing
// (before the refresh) matches of its sub-nodes, where needed, before 
// refreshing their match points and receiving match point updates from them.  
//
// Match Refresh:
//
// This step again takes place recursively, with the recursion going down
// all sub-nodes appearing in the updatedSubNodes list. The actual refresh
// takes place when the recursion is exited, so it is actually a bottom-up
// refresh.
//
// Simple query calculation nodes refresh the indexer with their new
// selection values and the indexer returns the new matches of the 
// simple query calculation node. These matches are then updated on
// the parent node. New sub-nodes update all their matches on their parent
// node, while existing sub-nodes only update the parent with changes
// to the matches.
//
// Projection nodes which previously did not need to add their selection
// matches to the parent node but now need to do so, need to add those matches.
// This takes place because these nodes were marked as 'new sub-nodes'
// by the structural refresh step.
//
// Each query calculation node may define a function suspend()
// which allows its matching to be suspended. This means that 
// the function stores the matches and projection matches at the
// time the 'suspend()' function was issued. The 'getMatches()' and
// getProjMatches() functions would then continue to return the matches
// at the time of suspension until the node is unsuspended. While
// suspended, the node may handle match and projection matching
// as it wishes, but may not forward any match changes to its dominating
// node or projection match changes to its sub-nodes (or to the 
// result node). At the end of its refresh, the node itself is 
// responsible for unsuspending itself. It should then notify the
// relevant nodes with the difference between its matches or projection
// matches before the suspension and after the suspension.
// 
// Each qery calculation must define a function 'suspendProjection()'
// which is similar to 'suspend()' but only suspends the projections
// (in the way described above). The root query calculation node will 
// suspend the projection of the top query calculation
// node when it detaches from it, if it is a projection. When a projection 
// query calculation node is destroyed, but its projection sub-node is not, 
// the projection of the sub-node is also suspended. 'suspendProjection()'
// should be a subset of 'suspend()' so if both are applied, 
// 'unsuspend()' should unsuspend them both.

//

// This is a simple function in the base class. It is called by the
// query compilation object to indicate that the query has changed and
// its query calculation nodes need to be refreshes. This is called
// only on the top query calculation node of the query. The result
// of the refresh takes place through the specific refresh functions
// called here, which recursively call the refresh functions on the 
// new and modified sub-nodes.
// The refresh process is documented at the beginning of this section. 

InternalQueryCalc.prototype.refreshQuery = internalQueryCalcRefreshQuery;

function internalQueryCalcRefreshQuery()
{
	debugStartTimer("query", "query calc refresh");

    // the three refresh phases, described above.
    this.refreshQueryStructure();
    this.refreshMatchPoints();
    
    // after the structure and match points have been refreshed, but before
    // refreshing the matches, we need to allow the root query calculation
    // node to refresh itself based on the new structure. This may also 
    // suspend new terminal projection nodes if some result node is
    // already active.
    this.rootQueryCalc.queryStructureRefreshed();
    
    this.refreshMatches();

	debugStopTimer("query calc refresh");
}

// This function is called on a projection node (intersection, union,
// negation or terminal projection) or a selection-projection node by
// its parent query calculation node to indicate that from now on it
// needs to add its selection matches to the parent. This is called
// during the query structure refresh.  This function checks whether
// it previously already needed to add its selection matches to the
// parent. If it did, there is nothing more to do (the property is
// then also set on the projection sub-nodes of this node). Otherwise,
// it needs to propagate this property also to its own projection
// sub-nodes (whether this is needed depends on the existence of the
// function this.setSubProjsMustAddMatches which is defined only in
// derived classes for query calculation nodes with sub-nodes).

InternalQueryCalc.prototype.setMustAddMatches = 
	internalQueryCalcSetMustAddMatches;

function internalQueryCalcSetMustAddMatches()
{
    if(this.mustAddMatches)
        // property did not change for this node, so also can't change
        // for sub-nodes
        return false;

    this.mustAddMatches = true;

    if(this.setSubProjsMustAddMatches) // exists only in some derived classes
        this.setSubProjsMustAddMatches();

    return true;
}

/////////////////////////
// Match Parent Update //
/////////////////////////

// This is a small auxiliary function, allowing the root query
// calculation node to set itself as the match parent of the top query
// calcualtion node. If the root query calcualtion node is not yet the
// match parent of this node, the function sets the root query
// calculation node as the match parent of this node.  It then also
// updates the matches: the projection matches are cleared and the
// selection matches of this node are added to the match parent, which
// is the root query calculation node.

InternalQueryCalc.prototype.setRootAsMatchParent =
    internalQueryCalcSetRootAsMatchParent;

function internalQueryCalcSetRootAsMatchParent()
{
    if(this.matchParent == this.rootQueryCalc)
        return; // nothing more to do
    
    this.matchParent = this.rootQueryCalc;

    // suspend the projection matches of the query (until the query is 
    // refreshed).
    this.suspendProjection();
    
    // if there are any matches on the query calculation node, propagate
    // them to the root node. If there are no matches, don't do anything,
	// as this may indicate that initialization has not yet been completed.
	var matches = this.getMatches();
	if(matches.length > 0)
		this.matchParent.addMatches(matches, this);
} 

////////////////
// Suspension //
////////////////

// The following functions are used to suspend a node during query refresh.
// There are two type of suspension: projection suspension (where only
// the projection matches are not updated) and full suspension, where both
// selection and projection matches are not updated.
// Not all nodes must support suspension (as it is the node's own choice
// whether to suspend itself), but all nodes must support projection 
// suspension.
//
// During suspension, the selection matches of a node are stored under
// this.suspendedMatches and these are the matches that need to be returned
// by 'getMatches()' and 'getMatchesAsObj()' as long as the node is 
// suspended. The existence of this field is seen as an indication 
// that the node is suspended. Each derived class must modify its
// addMatches and removeMatches functions so that the 'matches' are 
// updated on the node, but not the 'projMatches' table and no match
// updates are forwarded to the parent node or the sub-nodes.
// During projection suspension (and during full suspension)
// this.addProjMatches is set to equal this.addProjMatchesDoNothing and 
// this.removeProjMatches is set to equal this.removeProjMatchesDoNothing.
// These two function are defined in the base class and do nothing.
// Therefore, as long as projection is suspended, this.projMatches should
// remain unchanged.
//
// The derived class needs to define several functions:
//
// this.suspendSelection():
//    this function should store the current selection matches on 
//    this.suspendedMatches. The function must then 
//    prepare the 'matches' table to be updated by this.addMatchesToSuspended
//    and this.removeMatchesFromSuspended.
// this.suspendProjMatches():
//    This function should add to 'this.projMatches' all lowered projection
//    matches which are not stored there normally. This ensures that
//    whatever change takes place on the node, the list of projection
//    matches before the suspension can be retrieved.
// this.setSuspendedMode(): this should change the mode of the node so
//    that the addMatches and removeMatches functions only update
//    the 'matches' table but do not propagate these changes to the 
//    parent node or the sub-nodes and do not update the projection 
//    matches. Different derived classes may implement this in different
//    ways.
// this.setSuspendedProjectionMode(): this should change the mode of the node so
//    that the projection matches are not updated. Different derived classes
//    may implement this in different ways.
// this.calcNewFullMatchesAfterSuspension():
//    This function is called when the node is unsuspended (but before
//    projection is unsuspended). The function should complete the calculation
//    of the 'matches' table (if necessary) and, if this.shouldAddMatches()
//    is true, return an array with the new full matches which are not 
//    found in this.suspendedMatches.
// this.calcRemovedSuspendedMatches():
//    This function is called after calcNewFullMatchesAfterSuspension() was
//    called. It returns an array with the list of matches found in 
//    this.suspendedMatches which are not full matches in this.matches.

//

// This function returns true if this is a suspended node.
// When a node is suspended, matches from sub-nodes can be
// added and removed from it, but no raised matches are calculated
// and no matches are forwarded to the parent node. Projection match
// update is also suspended.
// The existence of this.suspendedMatches is considered an indication
// as to whether the node is suspended or not.

InternalQueryCalc.prototype.isSuspended = 
	internalQueryCalcIsSuspended;

function internalQueryCalcIsSuspended()
{
	return !!this.suspendedMatches;
}

// This function returns true if projection match calculation is suspended 
// on this node. The projection matches are not updated as long as the node
// is in this mode. When the node is suspended, its projection match
// calculation is also suspended, but not the other way around (that is,
// projection matching may be suspended, but selection calculation 
// may continue as before).

InternalQueryCalc.prototype.isSuspendedProjection = 
	internalQueryCalcIsSuspendedProjection;

function internalQueryCalcIsSuspendedProjection()
{
    return !!this.projectionSuspended;
}

// When a query calculation node is suspended, all its 
// full matches are stored.
// The node should be suspend while the match points still have their
// old counts (that is, before the match points are refreshed) so that
// we can determine which matches were full matches which should be 
// stored. Projection matches are not modified.
// From that moment on, matches added or removed (by the sub-nodes) are 
// recorded, but not forwarded to or removed from the parent. 
// Projection matches are not updated.
// When the node is unsuspended, the unsuspension function calculates 
// the new full matches. It reports to the parent the difference 
// between the original full matches and the new full matches.
// It also calculates the difference between the old projection matches
// (still stored in projMatches) and the new projection matches
// and updates them on its projection sub-nodes.

InternalQueryCalc.prototype.suspend = 
	internalQueryCalcSuspend;

function internalQueryCalcSuspend()
{
	if(this.isSuspended())
		return; // already suspended

    if(!this.isSuspendedProjection())
        this.suspendProjection();

    // set the suspended mode
	this.setSuspendedMode();

    // store the current selection matches and prepare the 'matches'
    // table to be updated during suspension (this is specific to the
    // derived class).
	this.suspendSelection();
}

// This function only suspends projection match calculation on this node.
// First, this suspends the projection matches. This operation is specific
// to the derived class. After this operation, all projection matches,
// including the lowered projection matches should be stored in
// this.projMatches. After suspending the projection matches, 
// the 'addProjMatches' and 'removeProjMatches' functions are replaced 
// by functions that do nothing. In this way, the projection matches 
// remain unchanged until the node is unsuspended.

InternalQueryCalc.prototype.suspendProjection = 
	internalQueryCalcSuspendProjection;

function internalQueryCalcSuspendProjection()
{
    if(this.isSuspendedProjection())
        return;

    this.suspendProjMatches();

    this.projectionSuspended = true;
    this.setSuspendedProjectionMode();
}

// This function unsuspends a node. It can be used both
// to unsuspend a full suspension and to unsuspend projection suspension.
// It is assumed that before this operation, the match points are up-to-date 
// and that the matches from the sub-nodes were already recorded on this node, 
// but that, if the node was fully suspended, full matches may not yet have 
// been fully calculated (on nodes where this requires an extra step beyond
// recording the matches of the sub-node: this is a choice of the derived
// class). If fully suspended, it is also assumed that 
// this.suspendedMatches holds the matches of this node before the suspension.
// If this is a projection node, it is assumed (wether only projection
// was suspended or the node was fully suspended) that this.projMatches 
// holds the list of projection matches before the suspension.
// If fully suspended, this function completes the calcualtion of full 
// matches, if necessary (depending on the derived class), and 
// then calculates the difference between the matches before the suspension 
// and the current matches. This difference is updated on the parent node 
// (this still does not update the projection matches of this node). 
// Next, if this is a projection (and whether full or only projection 
// suspension took place), this function also calculates the new projection
// matches of this node, calculates the difference with the projection 
// matches before the suspension and updates the difference on the 
// projection sub-nodes (or to the result node, if this is a terminal node).

InternalQueryCalc.prototype.unsuspend = 
	internalQueryCalcUnsuspend;

function internalQueryCalcUnsuspend()
{
	if(!this.isSuspendedProjection())
		return; // nothing to unsuspend

    if(this.isSuspended()) {

        this.setSelectionMode();

        // complete the calculate of the new matches, compare them
        // with the matches stored in this.suspendedMatches and update
        // the parent node with the difference. This will not add
        // projection matches to this node, as this update is still
        // suspended.  If the node does not need to add its matches,
        // we still complete the calculate of the matches, but don't
        // calculate the difference with the original matches and do
        // not update the matches of the dominating node (the
        // dominating node, if necessary, will clear all its matches).
        if(!this.shouldAddMatches())
            this.calcNewFullMatchesAfterSuspension();
        else {
            this.matchParent.
                addMatches(this.calcNewFullMatchesAfterSuspension(), this);
            this.matchParent.removeMatches(this.calcRemovedSuspendedMatches(),
                                           this);
        }
    
        this.suspendedMatches = undefined;
    }
    
    // set the add/remove projection matches function. These functions
    // will be used in updating the projection matches below.
	this.setProjectionMode();

    if(this.isProjection() || this.isSelectionProjection())
        // refresh the projection matches
        this.setProjMatches();

    this.projectionSuspended = undefined; // unset the projection suspension
}

//////////////
// Matching //
//////////////

// This function returns the required count of a match on this node.
// When a match reaches this count, it is a full match.
// For all nodes except the intersection node, this number 
// is always 1. This is implemented in the base class. The intersection
// node overrides this implementation.

InternalQueryCalc.prototype.getFullMatchCount = 
    internalQueryCalcGetFullMatchCount;

function internalQueryCalcGetFullMatchCount()
{
    return 1;
}

////////////////////////////////
// Setting Projection Matches //
////////////////////////////////

// This function is called by the result node to indicate a possible change
// in its 'projection must generate matches' property. 'mustGenerate' is
// the current value of this property. This function simply propagates this
// property down the query (it is only relevant to projection query
// calculation nodes, which override this default implementation).

InternalQueryCalc.prototype.refreshProjMustGenerateMatches =
    internalQueryCalcRefreshProjMustGenerateMatches;

function internalQueryCalcRefreshProjMustGenerateMatches(resultId, mustGenerate)
{
    if(this.projSubNodeNum == 0)
        return;

    for(var id in this.projSubNodes) {
        this.projSubNodes[id].
            refreshProjMustGenerateMatches(resultId, mustGenerate);
    }
}

// This function re-sets the projection matches for the given result ID.
// If no resultId is given, this function performs this operation for
// all result nodes registered to the root query calculation node.
// This function may be called when projection has been suspended or
// not. In case projection has been suspended, this.projMatches holds
// all projection matches before the suspension, including lowered 
// projection matches which are not normally stored in this.projMatches.
// If the node is not suspended, this function first adds all such lowered
// matches to this.projMatches (by calling 'suspendProjMatches()').
// Next, this function lets the dominating node filter its matches 
// for projection matches (the parent node intersects this list of 
// matches with its own list of projections, performing any necessary
// raising). These projection matches are then lowered and stored 
// in this.projMatches (the previous projection matches are set aside
// for comparison in the next step). This function then compares the new
// projection matches with the old projection matches. It creates two lists: 
// of added projection matches and of removed projection matches. These 
// added and remove projection matches are forwarded to the sub-nodes 
// (or, in case this is a terminal generating node, to the result node).
// This function also applies to selection-projection nodes. In these
// nodes, instead of lowering, raising to the query prefix path may 
// need to take place.
// This is a default implementation which applies to most query calculation
// node types. For union and terminal projection nodes, there is a separate 
// implementation.
// 'matches' is an optional argument to be used only in the recursive
// call of this function.

InternalQueryCalc.prototype.setProjMatches = internalQueryCalcSetProjMatches;

function internalQueryCalcSetProjMatches(resultId, matches)
{
    if(resultId !== undefined && this.isProjection() && this.projMatches &&
       this.projMatches.has(resultId) && !this.isSuspendedProjection())
        this.suspendProjMatches(resultId);

    if(matches === undefined)
        matches = this.getMatches();

    if(resultId === undefined) {
        var results = this.rootQueryCalc.getQueryResults();
        var _self = this;
        results.forEach(function(queryResult, resultId) {
            _self.setProjMatches(resultId, matches);
        });
        return;
    }

    var prevProjMatches = this.projMatches ? 
        this.projMatches.get(resultId) : undefined; // existing matches
        
    // re-initialize to be empty
    var thisProjMatches = this.initEmptyProjMatches(resultId);

    // calculate the new projection matches
    var projMatches = this.matchParent.filterProjMatches(matches, resultId);
    // lower if this is a projection and raise if this is a 
    // selection-projection (in both cases: update this.projMatches).
    projMatches = this.isProjection() ?
        this.lowerProjMatchesAndAdd(projMatches, resultId) :
        this.calcNewSelectionProjMatches(projMatches, resultId);

    // find those projection matches which were not projection matches
    // previously.

    var addedProjMatches;
    // overlap with old projection matches
    var existingProjMatches = new Uint31HashSet();

    if(prevProjMatches == undefined) {
        for(var i = 0, l = projMatches.length ; i < l ; ++i)
            thisProjMatches.set(projMatches[i], 1);
        addedProjMatches = projMatches;
    } else {
        addedProjMatches = [];
        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
            var elementId = projMatches[i];
            thisProjMatches.set(elementId, 1);
            if(!prevProjMatches.has(elementId))
                addedProjMatches.push(elementId);
            else
                existingProjMatches.set(elementId);
        }
    }
    
    var removedProjMatches = [];
    
    if(prevProjMatches)
        prevProjMatches.forEach(function(count, elementId) {
            if(!existingProjMatches.has(elementId))
                removedProjMatches.push(elementId);
        });
    
    // forward the changes to the projection sub-nodes or the result node
    
    if(this.projSubNodeNum) { // non-terminal projection node
	    for(var id in this.projSubNodes) {
            if(addedProjMatches.length)
		        this.projSubNodes[id].addProjMatches(addedProjMatches, 
                                                     resultId);
            if(removedProjMatches.length)
                this.projSubNodes[id].removeProjMatches(removedProjMatches, 
                                                        resultId);
        }
    } else { 
        // a terminal projection node (including selection-projection
        // nodes).
        var result = this.rootQueryCalc.getQueryResults().get(resultId);
        if(addedProjMatches.length)
            result.addTerminalProjMatches(this, addedProjMatches);
        if(addedProjMatches.length)
            result.removeTerminalProjMatches(this, removedProjMatches);
    }
}


///////////////////////////////
// Adding Projection Matches //
///////////////////////////////

// This function adds projection matches to a selection-projection node. 
// This is a common function serving various types of nodes and implements
// only the raising of the matches to the query's prefix path. 
// 'projMatches' should be a subset of the selection matches of this node
// which is also contained in the projection matches of the parent node.
// These should either be new matches added to the selection of this node
// or new matches added to the projection matches of the parent node.
// In other words, this function assumes that the elements in 'projMatches' 
// are known to be pre-raised projection matches which are new.
// The function then first raises these matches, if necessary, and adds them
// to this.projMatch. The function then adds the new projection matches 
// of this node to the result node. When raising takes place, an element 
// is included in this list only the first time an element is raised to it.
// If this node is not a generating projection, there is nothing to do here.

InternalQueryCalc.prototype.addSelectionProjMatches = 
	internalQueryCalcAddSelectionProjMatches;

function internalQueryCalcAddSelectionProjMatches(projMatches,
                                                  resultId)
{
    if(!this.isGeneratingProjection())
        return;

    var projMatches = this.calcNewSelectionProjMatches(projMatches, resultId);
    // update the result node
    var results = this.rootQueryCalc.getQueryResults();
    results.get(resultId).addTerminalProjMatches(this, projMatches);
}

// This function calculates the new projection matches of 
// a selection-projection node and adds them to the this.projMatches table. 
// This is a common function serving various types of nodes and implements
// only the raising of the matches to the query's prefix path. 
// 'projMatches' should be a subset of the selection matches of this node
// which is also contained in the projection matches of the parent node.
// These should either be new matches added to the selection of this node
// or new matches added to the projection matches of the parent node.
// In other words, this function assumes that the elements in 'projMatches' 
// are known to be pre-raised projection matches which are new.
// The function then first raises these matches, if necessary, and adds them
// to this.projMatch. The function then returns an array with the new 
// projection matches of this node. When raising takes place, an element 
// is included in this list only the first time an element is raised to it.
// If this node is not a generating projection, there is nothing to do here.

InternalQueryCalc.prototype.calcNewSelectionProjMatches = 
	internalQueryCalcCalcNewSelectionProjMatches;

function internalQueryCalcCalcNewSelectionProjMatches(projMatches,
                                                      resultId)
{
    if(!this.isGeneratingProjection())
        return []; // nothing to do

    var thisProjMatches = this.getProjMatchesEntry(resultId);
    var newMatches;

    if(!this.lowerThanQueryPrefixFullMatches()) {
        // no raising needs to take place, simply store in this.projMatches
        newMatches = projMatches;
        for(var i = 0, l = projMatches.length ; i < l ; ++i)
			thisProjMatches.set(projMatches[i], 1);
    } else {
        // same as above, but with raising
        var dataElements = this.indexer.getDataElements();
        var prefixProjId = this.rootQueryCalc.prefixProjPathId;

        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
		
			var elementId = projMatches[i];

            // perform raising
            elementId = dataElements.raiseToPath(elementId, prefixProjId);

            if(!thisProjMatches.has(elementId)) {
				thisProjMatches.set(elementId, 1);
                newMatches.push(elementId);
            } else
                thisProjMatches.set(elementId,
                                    thisProjMatches.get(elementId)+1);
		}
    }

    return newMatches;
}

// This function should be set on the 'addProjMatches' field of a
// node when the node should not update its projection matches
// when the parent node has new projection matches. This holds for
// a suspended node, but also for intersection nodes and some simple 
// nodes which are still inside their call to 'addMatches'.

InternalQueryCalc.prototype.addProjMatchesDoNothing = 
	internalQueryCalcAddProjMatchesDoNothing;

function internalQueryCalcAddProjMatchesDoNothing()
{
	return;
}

/////////////////////////////////
// Removing Projection Matches //
/////////////////////////////////

// This function removes projection matches from a selection-projection node. 
// This is a common function serving various types of nodes and implements
// only the raising of the matches to the query's prefix path. 
// 'projMatches' should be a subset of the intersection of the selection 
// matches of this node and the projection matches of the parent node
// which has just been removed from this intersection (either because it
// was removed from the selection matches or because it was removed from
// the projection matches of the parent). In case no raising is required,
// this set is also allowed to contain matches which were not previously 
// in the intersection between the selection matches and the parent 
// projection matches, but if raising is required, all matches are 
// expected to have just been removed from the intersection of these two
// sets.
// The function then first raises these matches, if necessary, decreases
// their count in this.projMatches and removes them if necessary. 
// Those matches removed from this.projMatches are forwarded to 
// the result node.
// If this node is not a generating projection, there is nothing to do here.

InternalQueryCalc.prototype.removeSelectionProjMatches = 
	internalQueryCalcRemoveSelectionProjMatches;

function internalQueryCalcRemoveSelectionProjMatches(projMatches,
                                                     resultId)
{
    if(!this.isGeneratingProjection())
        return; // nothing to do

    var thisProjMatches = this.getProjMatchesEntry(resultId);
    var removedMatches = [];

    if(!this.lowerThanQueryPrefixFullMatches()) {
        // no raising needs to take place, need to check which elements
        // were in this.projMatches
        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
            var elementId = projMatches[i];
			if(thisProjMatches.has(elementId)) {
                thisProjMatches.delete(elementId);
                removedMatches.push(elementId);
            }
        }
    } else {
        // raising required
        var dataElements = this.indexer.getDataElements();
        var prefixProjId = this.rootQueryCalc.prefixProjPathId;

        for(var i = 0, l = projMatches.length ; i < l ; ++i) {
		
			var elementId = projMatches[i];

            // perform raising
            elementId = dataElements.raiseToPath(elementId, prefixProjId);

            var newCount = thisProjMatches.get(elementId) - 1;
            if(newCount == 0) {
				thisProjMatches.delete(elementId);
                removedMatches.push(elementId);
            } else
                thisProjMatches.set(elementId, newCount);
		}
    }

    // notify the result node of the new projection matches
    var results = this.rootQueryCalc.getQueryResults();
    results.get(resultId).removeTerminalProjMatches(this, removedMatches);
}

// This function should be set on the 'removeProjMatches' field of a
// node when the node should not update its projection matches
// when the parent node removes projection matches. This holds for
// a suspended node, but also for intersection nodes and some simple 
// nodes which are still inside their call to 'removeMatches'.

InternalQueryCalc.prototype.removeProjMatchesDoNothing = 
	internalQueryCalcRemoveProjMatchesDoNothing;

function internalQueryCalcRemoveProjMatchesDoNothing()
{
	return;
}

// Given an array 'projMatches' holding a set of data elemetn IDs,
// and a Map object 'projMatchPoints' whose keys are match points 
// (path IDs), this function appends to this array the lowering of 
// the given element IDs to the match points (that is, the data elements which 
// are children of the data elements in 'projMatches' and whose path
// is a match point in 'projMatchPoints'). Multiple lowering steps may take
// place (that is, a lowered data element may be lowered again).
// This function returns the original input array (which was appended
// with the lowered data element IDs).

InternalQueryCalc.prototype.lowerToProjMatchPoints = 
    internalQueryCalcLowerToProjMatchPoints;

function internalQueryCalcLowerToProjMatchPoints(projMatches, projMatchPoints)
{
    if(!projMatchPoints)
        return projMatches;

    if(projMatchPoints.size == 0)
        return projMatches; // no lowering required

    var projMatchPointArray = [];
    projMatchPoints.forEach(function(t, pathId) {
        projMatchPointArray.push(pathId);
    });
    
    projMatches = this.indexer.getDataElements().
        lowerDataElementsTo(projMatches, projMatchPointArray);

    return projMatches;
}

//////////////////////////////////////////////////
// Projection Match Initialization And Clearing //
//////////////////////////////////////////////////

// This function creates empty projMatches entries. If the function is 
// called with a specific result ID, it will only create an entry for
// that result ID, leaving all other entries (if exist) unchanged.
// It would then also return the empty object created for the projection
// matches of this result node. 
// If resultId is not given (is undefined) this function initializes 
// an empty projMatches table. It clears any existing entries and creates 
// a separate empty entry for every result node making use of this query
// (as defined on the root query calculation node). In this case, 
// the function returns nothing.

InternalQueryCalc.prototype.initEmptyProjMatches =
    internalQueryCalcInitEmptyProjMatches;

function internalQueryCalcInitEmptyProjMatches(resultId)
{
    if(resultId) {
        if(!this.projMatches)
            this.projMatches = new Map();
        var entry = new Uint31HashSet();
        this.projMatches.set(resultId, entry);
        return entry;
    }

    this.projMatches = new Map();
    
    if(this.rootQueryCalc) {
        var _self = this;
        this.rootQueryCalc.getQueryResults().forEach(function(queryResult,
                                                              resultId) {
            _self.projMatches.set(resultId, new Uint31HashSet());
        });
    }                                                
}

// This function initializes an object of arrays, one array for each
// result ID appearing in the projMatches table. It returns an object
// of the form:
// {
//    <result ID>: [],
//    ......
// }

InternalQueryCalc.prototype.makeEmptyProjMatchArrays =
    internalQueryCalcMakeEmptyProjMatchArrays;

function internalQueryCalcMakeEmptyProjMatchArrays()
{
    var obj = {};

    if(this.projMatches !== undefined)
        this.projMatches.forEach(function(entry, resultId) {
            obj[resultId] = [];
        });

    return obj;
}

// This function is called when the result node with the given 'resultId'
// no longer makes use of the root query calculation node which this
// query calculation node belongs to. It then may be necessary to remove
// the projection matches of that result node from this query calculation
// node and its sub-nodes. This only needs to take place for projection
// uery calculation nodes. This operation takes place here.

InternalQueryCalc.prototype.removeResultProjMatches =
    internalQueryCalcRemoveResultProjMatches;

function internalQueryCalcRemoveResultProjMatches(resultId)
{
    if(this.projMatches === undefined || !this.projMatches.has(resultId))
        return;

    this.projMatches.delete(resultId);

    if(this.projSubNodeNum) // non-terminal projection node
	    for(var id in this.projSubNodes)
            this.projSubNodes[id].removeResultProjMatches(resultId);
}

// This is called when this query is a projection and the result node
// with ID 'result ID' requires the matches to be tracked explicitly
// (in the 'projMatches' table). This is the case when these projection
// must verify that there are no missing values at the projection path
// for projection matches received from the parent (when not explicitly
// tracked, any projection node on the parent query calculation node
// is also considered a match on the projection node, under the assumption
// that missing values will later be filtered out).
// This function is called only when this is detemined before the
// projection matches have been added for this result node (either because
// the query calculation node is new or because the result node was
// just added to the root query calculation node). If the matches were
// already added, one shoudl call 'setExplicitProjMatches()'
// This default implementation of the function propagates this call to
// its projection sub-node(s). The terminal projection node must then
// implement this function to actually construct the projection match
// tables.

InternalQueryCalc.prototype.initExplicitProjMatches =
    internalQueryCalcInitExplicitProjMatches;

function internalQueryCalcInitExplicitProjMatches(resultId)
{
    if(this.projSubNodeNum) // non-terminal projection node
	    for(var id in this.projSubNodes)
            this.projSubNodes[id].setExplicitProjMatches(resultId);
}

// This is called when this query is a projection and the result node
// with ID 'result ID' requires the matches to be tracked explicitly
// (in the 'projMatches' table). This is the case when these projection
// must verify that there are no missing values at the projection path
// for projection matches received from the parent (when not explicitly
// tracked, any projection node on the parent query calculation node
// is also considered a match on the projection node, under the assumption
// that missing values will later be filtered out).
// This function is called only when this is detemined after the
// projection matches have been added (as a result in a change in the
// conditions which determine this property). If the matches were
// not yet added, one should call 'setExplicitProjMatches()'
// This default implementation of the function propagates this call to
// its projection sub-node(s). The terminal projection node must then
// implement this function to actually construct the projection match
// tables.

InternalQueryCalc.prototype.setExplicitProjMatches =
    internalQueryCalcSetExplicitProjMatches;

function internalQueryCalcSetExplicitProjMatches(resultId)
{
    if(this.projSubNodeNum) // non-terminal projection node
	    for(var id in this.projSubNodes)
            this.projSubNodes[id].setExplicitProjMatches(resultId);
}

// This is called when this query is a projection and the result node
// with ID 'result ID' does (no longer) require the matches to be tracked
// explicitly (in the 'projMatches' table). This is the case when this
// projection is only followed by other queries, which can filter out
// element IDs which are passed on by this projection even though they
// do not exist on the projection path (but only on a higher path).
// This default implementation of the function propagates this call to
// its projection sub-node(s). The terminal projection node must then
// implement this function to actually remove the projection match
// tables.

InternalQueryCalc.prototype.releaseExplicitProjMatches =
    internalQueryCalcReleaseExplicitProjMatches;

function internalQueryCalcReleaseExplicitProjMatches(resultId)
{
    if(this.projSubNodeNum !== 1)
        return; // multi-projections must always track the matches

	for(var id in this.projSubNodes)
        this.projSubNodes[id].releaseExplicitProjMatches(resultId);
}

///////////////////////
// Access to Matches //
///////////////////////

// This function returns an array with data element IDs of all
// selection matches of this node. The implementation below is 
// the default implementation, which simply returns all data elements
// in the this.matches table. This implementation applies to simple
// and union node. Other nodes (such as intersection and negation nodes) 
// override this implementation.

InternalQueryCalc.prototype.getMatches = internalQueryCalcGetMatches;

function internalQueryCalcGetMatches()
{
    var matches = [];
    this.matches.forEach(function(count, elementId) {
        matches.push(elementId);
    });
	return matches;
}

// This function is identical to 'getMatches' except that it returns
// the matches as a Map object whose keys are the matches. The
// implementation below is the default implementation, which simply
// returns the this.matches table. This implementation applies to
// simple and union node. Other nodes (such as intersection and
// negation nodes) override this implementation.

InternalQueryCalc.prototype.getMatchesAsObj = internalQueryCalcGetMatchesAsObj;

function internalQueryCalcGetMatchesAsObj()
{
	return this.matches;
}

// This function returns an array with data element IDs of all data
// elements with a full match on this node which are also higher (or
// at) the root node's prefix path (these are matches which do not
// need to be raised any further). If the match points on the node
// indicate that no raising is necessary, the function simply calls
// 'getMatches'. Otherwise, the function must go over all matches and
// check the match point of each element and return only those
// elements which have a short enough path.  This implementation
// applies to simple and union node. Other nodes (such as intersection
// nodes) override this implementation.

InternalQueryCalc.prototype.getFullyRaisedMatches =
    internalQueryCalcGetFullyRaisedMatches;

function internalQueryCalcGetFullyRaisedMatches()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatches();

    var maxMatches = [];
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;
    

    this.matches.forEach(function(count, elementId) {
        if(dataElements.getPathId(elementId) <= prefixPathId)
            maxMatches.push(elementId);
    });
		
    return maxMatches;
}

// This function is identical to 'getFullyRaisedMatches' except that
// it returns the matches as a Map object whose attributes are the
// matches. This implementation applies to simple and union
// node. Other nodes (such as intersection nodes) override this
// implementation.

InternalQueryCalc.prototype.getFullyRaisedMatchesAsObj =
    internalQueryCalcGetFullyRaisedMatchesAsObj;

function internalQueryCalcGetFullyRaisedMatchesAsObj()
{
    if(!this.lowerThanQueryPrefixFullMatches())
        return this.getMatchesAsObj();

    var maxMatches = new Map();
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.rootQueryCalc.prefixProjPathId;
    
    this.matches.forEach(function(count, elementId) {
        if(dataElements.getPathId(elementId) <= prefixPathId)
            maxMatches.set(elementId, 1);
    });
		
    return maxMatches;
}

// Returns an array containing the projection matches of this node.
// The base class implementation simply creates an array of the
// keys of the entry in the this.projMatches table of this query
// calculation node for the given result ID (if such a table exists,
// otherwise, undefined is returned). This is sufficient for terminal
// projection nodes (simple projection nodes and generating
// selection-projection node). For other types of nodes (projection
// intersection, projection negation and projection union) this
// function does not return the correct projection matches (it does
// not perform lowering to lower match points).  These classes
// override this function to return the correct result.

InternalQueryCalc.prototype.getProjMatches = 
	internalQueryCalcGetProjMatches;

function internalQueryCalcGetProjMatches(resultId)
{
    var projMatches;

    if(!this.projMatches || !(projMatches = this.projMatches.get(resultId)))
        return undefined;

    var projMatchArray = [];
    projMatches.forEach(function(count, elementId) {
        projMatchArray.push(elementId);
    });
    return projMatchArray;
}

// Returns a Map object whose keys are the projection matches of
// this node.  The base class implementation simply returns the
// projMatches table of this query calculation node for the given
// result ID (if such a table exists, otherwise, undefined is
// returned). This is sufficient for terminal projection nodes (simple
// projection nodes and generating selection-projection node). For
// other types of node (projection intersection, projection negation
// and projection union) this function does not return the correct
// projection matches (it does not perform lowering to lower match
// points).  As this function is only used to access the projection
// matches of terminal projection nodes, this is sufficient.

InternalQueryCalc.prototype.getProjMatchesAsObj = 
	internalQueryCalcGetProjMatchesAsObj;

function internalQueryCalcGetProjMatchesAsObj(resultId)
{
    if(!this.projMatches)
        return undefined;

    return this.projMatches.get(resultId);
}

// Gets the entry for the given result object in the projMatches table of
// this query calculation object. If this does not exist, it is created.

InternalQueryCalc.prototype.getProjMatchesEntry = 
	internalQueryCalcGetProjMatchesEntry;

function internalQueryCalcGetProjMatchesEntry(resultId)
{
    if(!this.projMatches)
        this.projMatches = new Map();

    var entry;
    if((entry = this.projMatches.get(resultId)) === undefined) {
        entry = new Uint31HashSet();
        this.projMatches.set(resultId, entry);
    }

    return entry;
}

// This fuction receives as input a list (array) of data element IDs
// and returns (in a new array) the subset of element IDs which are
// selection matches on this query calculation node (this function
// should probably never be called if this query calculation node
// is a projection). This implementation applies to simple
// and union node. Other nodes (such as intersection nodes) override this 
// implementation.

InternalQueryCalc.prototype.filterMatches = internalQueryCalcFilterMatches;

function internalQueryCalcFilterMatches(elementIds)
{
    var matches = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(this.matches.has(elementId))
            matches.push(elementId);
    }

    return matches;
}

// This fuction receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are selection matches on this query calculation node (this function
// should probably never be called if this query calculation node
// is a projection). This implementation is the default implementation.
// Some query calculation nodes may override it.
// This function is similar to 'filterMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

InternalQueryCalc.prototype.filterMatchPositions =
    internalQueryCalcFilterMatchPositions;

function internalQueryCalcFilterMatchPositions(elementIds)
{
    var positions = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(this.matches.has(elementId))
            positions.push(i);
    }

    return positions;
}

// Returns an array containing the subset of the input array 'elementIds'
// which are projection matches of this node.
// The base class implementation simply filters the input array against
// the element Ids in the this.projMatches table of this query
// calculation node for the given result ID (if such a table exists,
// otherwise, undefined is returned). This is sufficient for terminal
// projection nodes (simple projection nodes and generating
// selection-projection node). For other types of nodes (projection
// intersection, projection negation and projection union) this
// function does not return the correct projection matches (it does
// not perform lowering to lower match points).  These classes
// override this function to return the correct result.

InternalQueryCalc.prototype.filterProjMatches = 
	internalQueryCalcFilterProjMatches;

function internalQueryCalcFilterProjMatches(resultId, elementIds)
{
    var projMatches;

    if(!this.projMatches || !(projMatches = this.projMatches.get(resultId)))
        return undefined;

    var filtered = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(projMatches.has(elementId))
            filtered.push(elementId);
    }

    return filtered;
}
