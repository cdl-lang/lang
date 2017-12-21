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

// This file implements the root query calculation node for queries
// carried out by the internal QCM (query calculation module).
//
// The root query calculation node is an interface between the Query
// object (which compiles the query) the result nodes and the query calculation
// nodes. For every query, indexer and prefix path (in the indexer)
// a different root query calculation node needs to be created. Once created,
// the Query object, indexer and prefix path cannot change (if they need
// to change, a new root query caluclation node needs to be created - in any
// case the new query requires complete recalculation in this case).
//
// The root query calculation node provides several services at the interface
// between the Query and the query calculation node and at the interface
// between the result nodes and the query calculation node.
//
// Query - Query Calculation Interface
// ===================================
//
// For the Query object, the root query calculation node is responsible for
// creating the query calculation nodes and refreshing them when the
// query compilation object calls its refreshQuery() function.
//
// Query Result - Query Calculation Interface
// ==========================================
//
// Multiple results may make use of the same root query calculation node.
// This multiplicity is hidden by the root query calculation node from
// the query calculation nodes under it. Moreover, even when only one
// result node makes use of a root query calculation node, the root
// query calculation node may be required to perform certain conversion
// operations at the interface between the (top) query calculation node
// and the result node.
//
// One simple service the root query calculation node provides for the
// result nodes registered to it is access to properties of the structure
// of the query (as represented by the query calculation node tree).
// This allows the result nodes to know whether the query is a selection
// or a projection and, in case it is a projection, how many projection
// paths there are and what these paths are (actually, what these paths
// are is only available when there is a single projection path, if there
// are multiple paths, the result nodes do not need this information and
// it is not provided).
//
// Beyond this simple service, the most important role of the root
// query calculation node is in the calculation of the selection
// and projection matches. Depending on the configuration, the calculation
// of these matches requires slightly different operations. The root
// query calculation node hides some of this complexity from the result
// nodes above it and the query calculation nodes below it.
//
// (Selection) Matches
// -------------------
//
// The selection matches of the (top) query calculation node need to
// be propagated to the query result nodes which make use of them.
// If the query result node has a data result node (that is, its
// input data is the result of a query) and this makes use of the same
// indexer as the query, the result node needs to intersect the matches
// of the data result node with those of the query calculation nodes to
// produce the matches of the query. Result nodes composed with this
// result node then make use of these matches (as input data) for their
// own queries. This produces a sequence of match intersections which is
// sometimes collapsed to a single intersection (see 'internalQueryResult.js'
// for more details).
//
// To implement this, the (top) query calculation node calls 'addMatches'
// or 'removeMatches' to notify the result nodes which make use
// of it that matches were added or removed. These functions are called
// on the 'matchParent' of the node, which is the root query calculation
// node. This node may then perform the following actions before forwarding
// the (possibly modified) list of added/removed matches to the result
// node(s):
// 1. If some of the matches reported by the query calculation node
//    are lower (have a longer path) than the prefix path of the root
//    query calculation node, the matches are raised to their parent
//    data element until their path is shorter or equal the root query
//    calculation node's prefix path (all these paths are defined
//    based on the indexer assigned to the root query calculation node).
//    Because several lower data elements may be raised to the same
//    parent data element, this raising includes a count (the number
//    of nodes raised to a parent node) so that removal can take place
//    correctly.
//    The result node(s) using the root query calculation node receive
//    notifications only for the raised matched data elements (and only
//    once for every raised match, even if it is raised from several
//    different lower matches). These can then be directly intersected
//    with the matches of the data result node (if exists). The result
//    nodes are ignorant of raising (and, in general, of the structure
//    of the data).
// 2. If multiple result nodes are registered to the root query calculation
//    node, the root query calculation node is registered as the
//    match parent of the top query calculation node and is responsible
//    for forwarding the matches added/removed from the query calculation
//    nodes to the different result nodes. If raising needs to take place
//    (as in case 1 above) this takes place once for all result nodes.
// When neither of these situations applies, the addMatches / removeMatches
// calls of the query calculation node can be forwarded directly to the result
// nodes.
//
// The root query calculation node stores only those matches which
// it raised. Matches which are not raised need not be stored (they are
// fetched from the top query calculation node, if needed).
//
// Projection Matches
// ------------------
//
// When the query is a projection, the projection matches are
// calculated top-down by intersecting the projection matches of the parent
// node with the (selection) matches of the node (see
// internalQueryCalc.js for more details). When the result node
// composed with another results node (that is, has a data result node)
// the projection matches of the query are restricted by the
// matches of the result node with which it is composed, 
// so the projection matches of the query calculation nodes are calculated 
// separately for each result node registered to the root query calculation
// node. This takes place on the query calculation node, but
// the root query calculation node is responsible for providing the
// top query calculation node with the 'projection matches' of the
// result node (with which the top query calculation node's matches
// are intersected). The 'projection matches' of the result node are
// based on its selection matches but may require lowering, so that 
// they can be properly intersected with the matches of the top query
// calculation node.
//
// Lowering of the projection matches is the responsibility of the root 
// query calculation node. Just as internally among query calculation
// nodes, the top query calculation node expects to receive from the
// root query calculation node a list of projection matches which is
// already lowered to the match points of the query calculation node.
// Note that the projection matches are allowed to consist of data elements
// which dominate each other, as it is the intersection with the 
// selection matches of the query calculation nodes which will eventually
// determine the projection matches.
//
// Just as among query calculation nodes, lowering takes place in two
// different ways. When the root query calculation node calls addProjMatches()
// or removeProjMatches() on the top query calculation node, it 
// must include in the list of projection matches not only the matches
// recieved from the result node for addition or removal, but also their
// lowering to any match point which appears in the lowerMatchPoints
// table.
//
// The second interface is a 'filtering' interface. When the query 
// calculation node adds matches, it can call the function 
// filterProjMatches() on the root query calculation node, providing
// it with this list of matches. The function then returns a subset of
// this list of those matches which are dominated by a match of the 
// result node.
//
// One extreme (but common) case is when a result node is not composed
// with another result node or composed with a result node which does not
// restrict the projection (or the query uses a different indexer from 
// that used by the data result node). In this case, the result node does 
// not restrict the projection matches of the query calculation node. 
// In this case, there is no need to intersect the selection matches of
// the top query calculation node with projection matches of the result node.
// The filterProjMatches() function then simply return the input it 
// receives, without any filtering. AddProjMatches() and removeProjMatches()
// are then never called on of by the root query calculation node.
//
// Lowering Projection Matches
// ---------------------------
//
// When the result node does restrict the projections, the projection matches
// of the root query calculation node (for that result node) start with the
// selection matches of the result node. If no lowering is required, then
// these selection matches are the required projection matches. In this
// case, the root query calculation node does not need to process 
// the projection matches, it simply retrieves them from the result node, 
// when needed.
//
// To determine whether lowering is needed, the root query calculation node
// stores the match points it receives from the top query calculation node
// which are lower (have a longer path) than the prefix path of the 
// root query calculation node. Lowering is required iff such match points
// exist.
//
// Given these lower match points, the root query calculation node can
// calculate the lower projection matches. When the result node calls
// 'addProjMatches' or 'removeProjMatches' to add or remove matches,
// the root query calculation node checks whether the data elements 
// given by the result node have children at any of the lower match
// points. If yes, these children are added to the list of projection
// matches added or removed. 
//
// When the top query calculation node requests the root query calculation
// node to filter a list of matches for projection matches, the root
// query calculation node checks the path of each of the data elements
// given and raises those which are lower than the query prefix path 
// to the prefix path. It then checks, whether, after raising, the element
// is a selection match of the result. If it is, the original element ID
// (before raising) is considered matched.
//
// Match Update
// ------------
//
// The root query calculation node serves merely as an interface between
// the top query calculation node and the result nodes. Therefore, it never
// initiates a calculation of the matches (selection or projection). It
// merely handles requests for getting the current matches ('getMatches()'
// from the result node) for filtering matches (filterMatches() from
// the result node) and projection matches (filterProjMatches() from 
// the query calculation node), and update notifications ('addMatches()',
// and 'removeMatches()' from the query calculation
// node and 'addProjMatches()' and 'removeProjMatches()', from
// the result nodes). It is up to the top query calculation node and
// the result nodes to initiate these calls when necessary.
//
// Generating Projection Queries
// =============================
//
// The calcualtions described so far only construct an internal representation
// of the query result. In order to construct an external query result
// (which can be interpreted by other modules independently of the 
// query structure) we need to construct a new data set (coded in one way
// or another) based on the various matches stored on the query on the 
// calculation nodes or on the result node. In case of a selection, this 
// process is straightforward and can be carried out directly from the
// matches list of the result node. In case of a projection, this is 
// somewhat more complicated, especially in cases where there are multiple
// projection sites.
//
// In order to generate the external result for a projection, we need to
// determine which query calculation nodes should be used to generate
// the result and how they are related to each other. For this, we define
// the generating projection query calculation nodes (in short,
// the 'generating projections')  to consist of the following nodes
// (this only applies if the query is a projection):
//
//  1. All terminal projection query calculation nodes.
//  2. All intersection projection nodes with at least 2 sub-projections.
//  3. All selection-projection query calculation nodes (selection 
//     query nodes under a projection union) which are not dominated
//     by another generating projection node.
//
// For the first two types of nodes, whether the node is a generating
// projection or not is determined only by the structure of the node
// itself (for intersection nodes this includes the count of the 
// projection aub-nodes). For the third type, this may also depend
// on other nodes (e.g. the addition/removal of a simple projection node under
// an intersection node dominating the selection-projection node may 
// make that intersection node into a generating/non-generating projection
// and then influence the status of the selection-projection node as
// generating).
//
// To simplify the processing, all selection-projection nodes are 
// registered to the root query calculation node (see the 
// generatingProjs table, below). Those entries which have a parent
// generating projection are clearly (by definition) not generating 
// projections.
//
// The root query calculation node is responsible for receiving 
// updates from the query calculation nodes when generating nodes are
// added or removed. It then calculates the parent/child relations
// among these nodes and determines their paths. The external result
// object (if any) is then notified of any changes in this structure.  
//
// Multi-Projection
// ----------------
//
// When a query has multiple projection nodes, a merge indexer is used to
// combine the projections received from the different generating projections
// into a single data structure. This process is describe below and in 
// MergeIndexer.js.
//
// Each terminal projection registers to the merge indexer with a mapping
// defining the translation from the paths in the source indexer
// to the paths in the merge indexer (the result). Each terminal 
// projection is registered here as a separate mapping. The 'mapping' is 
// described by an array which has the following format:
// [<mappedPathId(P1)>, <pathId(P1)>,...., <mappedPathId(Pn)>, <pathId(Pn)>]
// where each Pi is a proper (but not necessarily immediate) prefix of Pi+1. 
// <mappedPathId(Pi)> is the path (in the target indexer) to which Pi should 
// be mapped. Each <mappedPathId(Pi)> should be a proper (but not
// necessarily immediate) prefix of <mappedPathId(Pi+1)>. 
// The path <mappedPathId(P1)> may, but does not need to, be the root
// (empty) path. If it is the root path, the data element IDs under
// which the result is to be placed do not need to be specified.
// These data element IDs are then generated based on the data
// extracted from the source indexer.
//
// We will refer to the paths <pathId(Pi)> as the source paths of the mapping
// and to the paths <mappedPathId(Pi)> as the result paths of the mapping.
// Paths which extend <pathId(Pn)> will be referred to as 'extending source
// paths' and paths extending <mappedPathId(Pn)> will be referred to as 
// 'extending result paths'.
//
// For more information on the general interface, see MergeIndexer.js.
// Below the mapping defined by the root query calcualtion nodes for
// multi-projections.
//
// Path Mapping in the Root Query Calculation Node
// -----------------------------------------------
//
// The path translation is entirely determined by the query structure
// together with the prefix projection path of the query (which reflects
// the projections performed by previous queries in the query composition
// chain). When the query is a projection with multiple projection 
// sites (and therefore has multiple generating projections), it may be 
// that different generating projections induce a different path translation.
// Therefore, the same path in the input indexer may be translated into
// two different paths in the result indexer or that two different
// paths in the input indexer are translated into the same path in the
// result indexer. However, for a given generating projection, the translation
// is one to one (for those paths under the projection path - other paths
// in the input indexer are irrelevant for that generating projection).
//
// The path translation is therefore always defined relative to a terminal 
// generating projection. Since all notifications from the query calculation
// are given from such terminal generating projections, it is always known
// relative to which terminal generating projection the translation should
// be calculated.
//
// Examples:
//
// Assume a query with a single projection site: { a: { b: _ }}
// and assume the prefix projection path of the query is x.y.
// For any path x.y.a.b.z1.....zn in the input indexer (these are the 
// only paths relevant to the projection) the corresponding path in the
// result indexer is z1.....zn. This is simply the suffix of the path
// for the prefix path x.y.a.b.
//
// It should be noted that the path ID stored on the generating projection
// query calculation node (the node representing the terminal projection
// node) already carries the projection path prefixed by the prefix
// projection path (that is, x.y.a.b. in the example). 
//
// Assume a query with multiple projection sites: o({ a: _ }, { b:_ })
// and a prefix projection path x.y. Here there are two generating 
// projections which carry the paths x.y.a and x.y.b. The first projection
// maps any path x.y.a.z1.....zn in the input indexer to z1....zn in 
// the result indexer while the second generating projection 
// maps any path x.y.b.z1.....zn in the input indexer to z1....zn in 
// the result indexer. Therefore, the two generating projections
// map different paths into the same path. To separate the values under
// these paths, the result indexer must assign different data element IDs
// to the values under each of these generating projections (see more 
// details in the section 'Data Element Translation').
//
// Assume the query o({ a: _ }, { a: { b:_ }}) (with a prefix projection
// path x.y). Since the path of one generating projection is a prefix of 
// the path of the other, there are paths in the input indexer which 
// are mapped by both generating projections (all paths of the form
// x.y.a.b.z1....zn). Each such path is mapped into different paths
// in the result indexer. The first generating projection maps 
// x.y.a.b.z1....zn to b.z1....zn while the second generating projection
// maps it to z1....zn.
//
// For the purpose of mapping, a selection is seen here as a simple 
// projection (with a single projection path which is the prefix projection
// path of the selection). 
//
// Intersection Generating Projection
// ----------------------------------
// 
// When the query has intersection generating projections (intersection
// nodes with multiple projections under them) these infulence the 
// path translation. The projection path of such a node is defined to
// be the common prefix of the paths of the generating projections 
// under it. To every projection path under it, it prefixes the path mapping 
// by that projection path with the first attribute along that path
// after the common prefix.
//
// For example, assume the query { a: { b: _, c: _}} with prefix 
// projection path x.y. The terminal projections have paths x.y.a.b
// and x.y.a.c. Therefore, the common path of the intersection is 
// x.y.a. A path x.y.a.b.z1...zn is the mapped (for the projection 
// a.b) to the path b.z1....zn and the path x.y.a.c.z1....zn is mapped
// to c.z1.....zn.
//
// Multiple levels of intersection generating projections each add their
// own attribute to the mapping. For example, assume the following 
// query: { a: { b: { c: _, d: _ }} e: _ } (with the usual prefix projection
// path x.y). The projection with path x.y.a.b.c then maps every path
// x.y.a.b.c.z1....zn to a.c.z1....zn (the 'b' attribute is removed since
// it is common to all paths under x.y.a).
//
// The general rule for paths which extend the path of a terminal 
// generating projection is the following:
//
//    Given a projection path P (including the prefix projection path),
//    the mapping it induces for every path P.z1....zn (in the input indexer)
//    is a1...am.z1....zn where a1....am are the first attributes after
//    the path of each intersection generating projection dominating
//    the terminal generating projection (in the order of domination).
//    
// Remark 1: this maps P to a1....am
// Remark 2: having determined the attributes a1....am, the mapping is 
//   trivial to carry out.
//
// Data Element Paths
// ------------------
//
// Until now, we only considered the translation of paths P.z1....zn
// by a terminal generating projection node with path P. Since the projection
// only projects nodes under paths P.z1....zn (including the path P),
// this suffices when the query does not contain intersection generating 
// projections.
//
// However, when the query has intersection generating projections, we
// sometimes also need to translate prefix paths of P, as these may map
// to different points along the attribute prefix of the result indexer
// path added by the intersection points. At these points data elements may
// have to be assigned to reflect the corresponding structure in the
// input indexer.
//
// The translation for these paths then follow the same rule as above,
// adjusted for the fact that the path is now a prefix of the path of
// the terminal generating projection (the mapping is always calculated
// relative to a specific terminal generating projection node, as this
// defines the dominating intersection generating projections). The rule
// then is:
//
//    Given a projection path P (including the prefix projection path),
//    the mapping it induces for every prefix path P' of P
//    is a1...ak where a1....ak are the first attributes in the path P' after
//    the path of each intersection generating projection dominating
//    the terminal generating projection (in the order of domination).
//
// It is implied by the definition that only intersection generating projection
// nodes whose path is a proper prefix of P' participate in contributing
// attributes ai to the path (because only for these intersections
// the 'first attribute following the path of the intersection' is well
// defined.
//
// Consider, again the example above with the query 
// { a: { b: { c: _, d: _ }} e: _ }. For the terminal projection 
// with path x.y.a.b.c and the path x.y.a.b, we only consider the 
// intersection generating projection with path x.y (and not the one with
// the path x.y.a.b, because this is not a proper prefix of x.y.a.b
// and does not have a next attribute in this path). Therefore, 
// a.y.a.b is mapped to 'a'. Note that also the path x.y.a will be mapped
// to the path 'a'.
//
// Object Structure
// ================
//
// {
//     qcmKey: <string>
//     query: <Query>,
//     destroyed: true|undefined
//     queryCalc: <query calculation node>,
//     indexer: <InternalQCMIndexer>,
//     prefixProjPathId: <ID of the prefix projection path>
//     projPathId: undefined|<ID of the projection path>
//     results: <Map>{
//         <query result ID>: <InternalQueryResult>
//         ......
//     }
//
//     // matching
//
//     lowerMatchPoints: <Map>{
//         <path ID>: 1,
//         .....
//     },
//     raisedMatches: <Map object> {
//         <element ID>: <count>
//         .....
//     }
//     suspendedRaisedMatches: <same structure as raisedMatches>
//
//     queuedAllMatchUpdates: <Map>{
//         <query result ID>: <InternalQueryResult>
//         ......
//     }
//
//     // generating query calculation nodes
//
//     generatingProjs: <Map>{
//         <queryCalc ID>: {
//             queryCalc: <InternalQueryCalc>
//             pathId: <path of this query>,
//             parent: <query calculation ID>,
//             parentAttr: <string>,
//             mappedPathId: <path ID>,
//             children: {
//                 <queryCalc ID>: true
//                 .....
//             },
//             selections: {
//                 <queryCalc ID>: true
//                 .....
//             }
//         },
//         .......
//     }
//     terminalGeneratingProjNum: <number>
//     modifiedGeneratingProjs: <Map>{
//         <queryCalc ID>: true,
//         .....
//     }
// }
//
// qcmKey: the key (string) under which this node is stored in the QCM.
//    (this is needed for clean-up).
// query: the Query object which this root query calculation node
//    was assigned to.
// destroyed: this is set to true when the node is being destroyed
//    (this would then block updates received from the query calculation
//    nodes).
// queryCalc: this is the highest (in the Query tree) query calculation node
//    assigned to this root query. All other query calculation nodes assigned
//    to this query (for this root query calculation node) are descendants
//    of this node.
// indexer: the QCM indexer for which this node was constructed. This 
//    cannot change after construction.
// prefixProjPathId: this is the ID of a node in the path structure
//    of the indexer which describes the projection path of the input data
//    realative to the root of the indexer. This is set upon construction
//    and cannot be changed afterwards. This is just a 'prefix' because
//    if the query defined under this root query calculation node is 
//    a projection, it will extend this projection path further.
// projPathId: if this is not a multi-projection then this holds the ID of
//    the single projection path of this query. If this is a selection,
//    this projection path is simply the prefix projection path in 
//    'prefixProjPathId'. If this is a projection with a single 
//    projection node, then this is the path ID assigned to the terminal
//    projection query calculation node. If this query is a multi-projection
//    (a projection with multiple projection terminals) then this 
//    is undefined. 
// results: this is a list of result (InternalQueryResult) objects
//    which currently make use of this root query calculation node.
//
// lowerMatchPoints: these are the match points received from the
//    top query calculation node which are lower (have a longer path)
//    than the root query calculation node's prefix path. These
//    match points are used when lowering projection matches. This
//    is needed only when the query is a projection, but we store
//    these match points also in case of a selection, as the number of
//    these match points is probably small and this simplifies the
//    update.
//    If the number of these match points is zero, no raising needs to 
//    take place for matches added or removed by the top query calculation 
//    node and no lowering of projection matches needs to take place. 
// raisedMatches: this table is used only in case lowerMatchPoints is
//    not empty and the query is a selection. This table lists the elements 
//    which were raised from matches of the top query calculation node 
//    (the elements listed in the table are the result of the raising). 
//    For each fully raised element, the table records the number of lower 
//    elements from which it was raised (this is in order to allow proper
//    removal when the lower elements are removed from the list of matches).
// suspendedRaisedMatches: this is used only during the query refresh 
//    process. If at the beginning of the query refresh process a
//    'raisedMatches' table exists, this field is used to point at this 
//    table. If during the refresh process the table is removed (because
//    after the refresh there is no more need for raising) this continues
//    to hold a copy of the raisedMatches table until the end of the 
//    refresh. In this way, if the dominated query calculation node 
//    removed older matches (which still need to be raised, as they 
//    come from the old query structure) this copy of the table allows
//    then to be raised properly.
//
// queuedAllMatchUpdates: this table holds a list of result nodes
//    which should be a subset of the result nodes registered
//    in the 'results' table. For these result nodes, no incremental
//    updates of the matches of this root query calculation node takes place
//    (when addMatches / removeMatches is called on the root query calculation
//    node). Instead, after the query is refreshed, the full matches (after
//    the refresh) are added to these result nodes. The table is then cleared.
//
// generatingProjs: this is a table holding the query calculation nodes
//    under this root which actually generate the result of the query
//    when the query is a projection. See the 'Generating Projection Queries'
//    section above for more information.
//    The entry for each node is stored under its query calculation node ID.
//    The entry holds the following fields:
//      queryCalc: the query calculation node for which this entry was
//        created.
//      pathId: the path for this generating projection. For simple 
//        projections this is simply the path found on the query calculation
//        node (this cannot change). For intersection nodes this is the
//        common prefix of all the child generating projections and
//        for selection-projection nodes this is always the prefix projection
//        path of the root query calculation node.
//      parent: if there is a generating projection which dominates
//        this generating projection, its ID is stored here 
//        (this ID must appear in this table). When a selection-projection
//        node has a parent defined, it is not a generating projection
//        (see the introduction for an explanation why this is stored here).
//        It is easy to recognize such nodes because they are the only nodes
//        with a path equal to the root query node's prefix projection path
//        and a defined parent. 
//      parentAttr: if this node has a parent and is a generating projection
//        (that is, it is not a selection-projection), this field holds
//        the first attribute in the path of this node after the prefix
//        path which is the path of the parent node (e.g. if the path of 
//        the parent is a:b and the path of the child is a:b:c:d:e then 
//        this field is "c".
//      mappedPath: path ID of the path constructed from the parentAttr
//        of this node and all dominating generating projections, where
//        the attributes are ordered from the top parent down.
//        This path ID is allocated here, so it also needs to be 
//        released when this node is destroyed. 
//      children: this is the list of generating projections directly
//        dominated by this generating projection. This must be an 
//        intersection node and it must have at least two children
//        (otherwise it is not a generating projection). Other generating 
//        projections do not carry this field.
//        Selection-projection nodes are not included in this list, rather,
//        they are stored in the 'selections' field (see below).
//      selections: this is a list of all selection-projections directly
//        dominated by this generating projection. These selection-projections
//        are not generating projections.
// terminalGeneratingProjNum: the number of entries in the 'generatingProjs'
//    table which is a terminal generating projection. These are the simple
//    projections and the selection-projections which do not have a parent
//    generating projection.
// modifiedGeneratingProjs: this is a list of terminal generating projections
//    whose position in the generating projection tree has changed. This
//    includes terminal generating projections which were added or removed,
//    and terminal generating projections for which the parent attribute 
//    path has changed (the parent attribute path is the sequence of 
//    'parentAttr' strings for the terminal generating projection and all
//    its parents, ordered from the highest parent to terminal). 
//    In addition, if at the beginning of the update process this query was
//    a selection (had no generating projections), an entry for 
//    projection ID 0 is created in this table to store this information.
//
// Derived Classes
// ===============
//
// Functions which need to be integrated into the query calculation chain
// may do so by defining a derived class of this class (and an appropriate
// query calculation node class). Such a derived class must define
// the functions isSelection() and isProjection(), both of which should
// return false.
// This derived class will then receive (from the query application chain)
// updates of the set of data element IDs which represent its input set.
// This is received through the 'projection matches' interface of this class.
// The derived class should override the functions of this interface,
// as the implementation below is only intended for selection and projection
// queries. The derived class should override the following functions 
// (see documentation next to the default function implementation below):
// 
// setProjMatches(....)
// addProjMatches(....)
// removeProjMatches(....)
//
// If the result of the of the function implemented in by the derived class
// is a subset of the nodes at a single path in the indexer (with which 
// this root node was constructed) other functions can be composed with 
// it in the query application chain (that is, its output can be used as
// the input to some other query function, without having to re-index
// this output). To allow this to take place, the derived class must define
// the following function:
//
// getSingleGeneratingProj(<projection ID>): This should return a node 
//    'generatingProj' such that
//    generatingProj.getProjMatchesAsObj(<result ID>) returns a
//    Map object whose keys are the data element IDs representing
//    the output of the function calculate by this root query
//    calculation node (and generatingProj.getProjMatches(<result ID>)
//    returns the same element IDs in an array).
//    When there is only one projection path, <projection ID> need
//    not be specified. When there are multiple projection paths,
//    the projection ID should be given and then the object for that 
//    specific projection is returned. 
// 
// This function is only called when this root query calculation node is
// composed with another so that this node is the input to the other node.
// Functions which avoid this (by not generating an appropriate label
// node, see QueryApplication) do not need to implement this function.
//
// Cleanup:
// The following function should be implemented in the derived class to 
// perform any clean-up which should take place as late as possible in 
// the clean-up cycle (it is called from the update epilogue of the
// internal content module of each result node which makes use
// of this root query calculation node). If this function does not need
// to do anything, there is no need to implement it:
//
// cleanupAfterUpdate(....)
//
// If the result of the function defined by the derived class is defined
// by a path mapping (see QueryIndexer for details) on the indexer,
// it could be indexed by a result indexer. For this purpose, the 
// derived classes should also make sure that to provide an appropriate
// interface to their 'projection nodes' which by default are assumed
// to be a single node carrying the result of the function, where this result
// is a subset of the data element IDs at the indexer path node with ID
// prefixProjPathId. This is the case for all functions which return
// a subset of the set they received as input. The default implementation 
// of the functions below must suffice for this purpose, if the class 
// is properly initialized (see below for details). Otherwise, the 
// derived class may have to override these functions:
// 
// getTerminalGeneratingProjNum(): In the default case mentioned above,
//    this function should return 1.
// getGeneratingProjMappings(): In the case of functions that return a
//    subset of the set they receive as input, the default implementation
//    should suffice. Otherwise, read the documentation of this function.
//
// In the standard case, where there is a single <query calc> node carrying 
// the result and the result is defined as a set of data nodes in the 
// indexer at the path prefixProjPathId (the function 
// <query calc>.getProjMatchesAsObj() should return a Map object whose keys
// are the data element IDs defining the result and 
// <query calc>.getProjMatches() should return the same data element IDs in
// an array) it is sufficient for the derived class to call (once):
//     <derived class>.addSimpleGeneratingProj(<query calc>)
// and the default implementation of the functions described above 
// should work properly (to replace the query  calculation node, one
// should call <derived class>.removeGeneratingProj(<old query calc>)
// and then <derived class>.addSimpleGeneratingProj(<new query calc>).

// The root query calculation node is created for a specific indexer,
// query and projection path (represented by the path ID as defined in the
// indexer). Changing any of these requires the construction
// of a new root query calculation node.
// qcmKey is the key under which this root query calculation node is stored
// in the QCM (this is needed for clean-up)

// %%include%%: "rootQueryCalc.js"

inherit(InternalRootQueryCalc, RootQueryCalc);

function InternalRootQueryCalc(query, indexer, prefixProjPathId, qcmKey)
{
	// call the base class constructor
	this.RootQueryCalc();

	this.qcmKey = qcmKey;
	this.query = query;
	this.indexer = indexer;
	this.prefixProjPathId = prefixProjPathId;
	this.results = new Map();
    this.resultNum = 0;
    
    this.terminalGeneratingProjNum = 0;

	this.query.addRootQueryCalcNode(this);
	this.projPathId = this.getProjectionPathId();
}

// The destroy function removes the root query calculation node from the
// associated query.

InternalRootQueryCalc.prototype.destroy = internalRootQueryCalcDestroy;

function internalRootQueryCalcDestroy()
{
    this.destroyed = true;

	this.query.removeRootQueryCalcNode(this.getId());

    if(this.generatingProjs) {
        var _self = this;
        this.generatingProjs.forEach(function(entry, queryId) {
            if(entry.mappedPathId !== undefined)
                _self.indexer.qcm.releasePathId(entry.mappedPathId);
        });
    }
}

//////////////////////
// Access Functions //
//////////////////////

// Return the key under which this node is stored in the QCM.

InternalRootQueryCalc.prototype.getQCMKey = internalRootQueryCalcGetQCMKey;

function internalRootQueryCalcGetQCMKey()
{
	return this.qcmKey;
}

// Return the indexer used with this root query calculation node.

InternalRootQueryCalc.prototype.getIndexer = internalRootQueryCalcGetIndexer;

function internalRootQueryCalcGetIndexer()
{
	return this.indexer;
}

// This function returns true if the query under this root node has multiple
// projection paths and false otherwise.

InternalRootQueryCalc.prototype.hasMultipleProjPaths = 
	internalRootQueryCalcHasMultipleProjPaths;

function internalRootQueryCalcHasMultipleProjPaths()
{
    return (this.terminalGeneratingProjNum > 1); 
}

// This function returns the number of terminal generating projections
// of this query. This is zero if the query is a selection.

InternalRootQueryCalc.prototype.getTerminalGeneratingProjNum = 
	internalRootQueryCalcGetTerminalGeneratingProjNum;

function internalRootQueryCalcGetTerminalGeneratingProjNum()
{
    return this.terminalGeneratingProjNum; 
}


// This function returns the projection path of the query defined 
// under this root query calculation node, if there is a single such 
// projection path. If the query defines multiple projection paths, this
// function returns undefined.
// If the query is a selection, this is simply the projection path defined 
// on the root query calculation node.
// If there is a single terminal generating projection path, this is
// the path ID assigned to that node.
// If there are multiple terminal generating projection paths, the function
// returns undefined.

InternalRootQueryCalc.prototype.getProjectionPathId = 
	internalRootQueryCalcGetProjectionPathId;

function internalRootQueryCalcGetProjectionPathId()
{
	if(!this.terminalGeneratingProjNum)
		return this.prefixProjPathId;
    
    if(this.terminalGeneratingProjNum > 1)
        return undefined;

    var pathId;
    
    // if there is exactly one terminal generating projection, there can only
    // be one entry in the 'generatingProjs' table
    this.generatingProjs.forEach(function(entry, projId) {
        pathId = entry.pathId;
    });

    return pathId;
}

// This function determines whether the query under this root query calculation
// node is a selection or not. This is done by checking the isProjection()
// property on the top query calculation node. If this node is not defined,
// true is returned.
// Note: derived classes which do not implement a relational query 
// (not projection or selection, e.g. ordering or size functions) should 
// override this function and return false.

InternalRootQueryCalc.prototype.isSelection = 
	internalRootQueryCalcIsSelection;

function internalRootQueryCalcIsSelection()
{
	return !this.queryCalc || !this.queryCalc.isProjection();
}

// This function determines whether the query under this root query calculation
// node is a projection or not. This is done by checking the isProjection()
// property on the top query calculation node. If this node is not defined,
// false is returned.
// Note: derived classes which do not implement a relational query 
// (not projection or selection, e.g. ordering or size functions) should 
// override this function and return false.

InternalRootQueryCalc.prototype.isProjection = 
	internalRootQueryCalcIsProjection;

function internalRootQueryCalcIsProjection()
{
	return !!this.queryCalc && this.queryCalc.isProjection();
}

// This function returns true if this query consists of a single projection
// and nothing else (that is, no additional selection or multiple projections)

InternalRootQueryCalc.prototype.isPureProjection = 
	internalRootQueryCalcIsPureProjection;

function internalRootQueryCalcIsPureProjection()
{
	return (this.queryCalc !== undefined &&
            (this.queryCalc instanceof ProjectionQueryCalc));
}

// This is a trivial projection if it is a pure projection and the
// projection path is the root path.

InternalRootQueryCalc.prototype.isTrivialProjection = 
	internalRootQueryCalcIsTrivialProjection;

function internalRootQueryCalcIsTrivialProjection()
{
    return (this.isPureProjection() &&
            this.getProjectionPathId() === this.indexer.rootPathNodeId);
}

// This function returns true if the query nder this root query calculation
// node is a projection and explicitly tracks the projection matches for
// the result with the give ID. If the query is a multi-projection, this
// is always true (regardless of the result ID). If there is a single
// projection node, it is checked on the projection node whether it
// explicitly tracks matches for the given result ID.

InternalRootQueryCalc.prototype.hasExplicitProjMatches = 
	internalRootQueryCalcHasExplicitProjMatches;

function internalRootQueryCalcHasExplicitProjMatches(resultId)
{
    var projNum = this.getTerminalGeneratingProjNum();

    switch(projNum) {
    case 0:
        return false; // a selection has no projection matches
    case 1:
        // check on the single projection node whether it tracks the matches
        var proj = this.getSingleGeneratingProj();
        return proj.hasExplicitProjMatches(resultId);
    default:
        return true; // multi-projections always explicitly track their matches
    }
}


// This function returns true if this query was compiled (that is, the
// query calculation node tree was created from the query description)
// and false if not (if this returns true, it does not mean that there
// cannot be any pending changes in the query description which were
// not yet compiled, but it does mean that the initial compilation
// already took place).

InternalRootQueryCalc.prototype.isCompiled = 
	internalRootQueryCalcIsCompiled;

function internalRootQueryCalcIsCompiled()
{
	return (this.queryCalc !== undefined);
}

// This function returns true if the query is a projection and there are
// data elements along the projection path (which means that selections
// may need to be lowered to the projections at the projection path).

InternalRootQueryCalc.prototype.needToLower = 
	internalRootQueryCalcNeedToLower;

function internalRootQueryCalcNeedToLower()
{
    return this.isProjection() &&
        (this.lowerMatchPoints !== undefined && this.lowerMatchPoints.size > 0);
}

// This function returns the 'results' table which lists all result nodes
// which make use of this root query calculation node. The result nodes
// are each listed under its ID.

InternalRootQueryCalc.prototype.getQueryResults = 
	internalRootQueryCalcGetQueryResults;

function internalRootQueryCalcGetQueryResults()
{
	return this.results;
}

// If a projection ID is specified, this function returns the terminal 
// generating projection node with this ID. If projId is undefined
// and if this query has a single terminal generating projection node, 
// this function returns that terminal node. Otherwise, it returns 
// undefined.
// Remark: by default, if this.terminalGeneratingProjNum == 1 and
// the 'generatingProjs' table is empty, this function returns 
// this.queryCalc. Derived classes which allow composition of their result
// inside the query composition chain but do not wish to return 
// this.queryCalc, should override this function (see introduction to file).

InternalRootQueryCalc.prototype.getSingleGeneratingProj =
    internalRootQueryCalcGetSingleGeneratingProj;

function internalRootQueryCalcGetSingleGeneratingProj(projId)
{
    if(projId !== undefined)
        return this.generatingProjs.get(projId).queryCalc;

    if(this.terminalGeneratingProjNum != 1)
        return undefined;

    if(this.generatingProjs.size == 0)
        // the generatingProjs table was empty, return the top query calculation
        // node
        return this.queryCalc;
    
    var queryCalc;
    // single iteration
    this.generatingProjs.forEach(function(entry, projId) {
        queryCalc = entry.queryCalc;
    });

    return queryCalc;
}

//////////////////////////////////////////////
// Add/Remove Query Results Using this Node //
//////////////////////////////////////////////

// Add the given query result to the list of query results which make use
// of this root query calculation node.

InternalRootQueryCalc.prototype.addQueryResult = 
	internalRootQueryCalcAddQueryResult;

function internalRootQueryCalcAddQueryResult(queryResult)
{
	if(!queryResult)
		return;

	var id = queryResult.getId();

	if(this.results.has(id))
        return; // already added

	this.results.set(id, queryResult);
    this.resultNum++;
}

// Remove the query result given from the list of query results 
// which make use of this root query calculation node. The function returns
// true if there are still query results making use of this root query
// calculation node and false if there are no such query results.

InternalRootQueryCalc.prototype.removeQueryResult = 
	internalRootQueryCalcRemoveQueryResult;

function internalRootQueryCalcRemoveQueryResult(queryResult)
{
	if(!queryResult)
		return !!this.resultNum;

	var queryResultId = queryResult.getId();

	if(!this.results.has(queryResultId))
		return !!this.resultNum;

    // remove this query result from the query calculation nodes (needed only
    // if this is a projection)
    if(this.queryCalc && this.isProjection())
        this.queryCalc.removeResultProjMatches(queryResultId);
    
	this.results.delete(queryResultId);
    return !!(--this.resultNum);
}

/////////////////////////////
// Query Calculation Nodes //
/////////////////////////////

// This generates a new intersection query calculation node for 
// the query calculation tree under this root query calculation node.

InternalRootQueryCalc.prototype.newIntersectionQueryCalc = 
	internalRootQueryCalcNewIntersectionQueryCalc;

function internalRootQueryCalcNewIntersectionQueryCalc()
{
	return new IntersectionQueryCalc(this);
}

// This generates a new union query calculation node for 
// the query calculation tree under this root query calculation node.

InternalRootQueryCalc.prototype.newUnionQueryCalc = 
	internalRootQueryCalcNewUnionQueryCalc;

function internalRootQueryCalcNewUnionQueryCalc()
{
	return new UnionQueryCalc(this);
}

// This generates a new negation query calculation node for 
// the query calculation tree under this root query calculation node.
// 'negationPathId' is the path in the indexer which defines the
// universe of the negation. This path is realtive to the root of the query,
// so it must first be appended to the query's prefix path before
// creating the query calculation node (the query calculation node must
// have a path relative to the root of the indexer).
 
InternalRootQueryCalc.prototype.newNegationQueryCalc = 
	internalRootQueryCalcNewNegationQueryCalc;

function internalRootQueryCalcNewNegationQueryCalc(negationPathId)
{
    // append the given path to the prefix path of this query
    negationPathId = 
        this.indexer.qcm.allocateConcatPathId(this.prefixProjPathId, 
                                              negationPathId);
	var queryCalc = new NegationQueryCalc(this, negationPathId);
    // the path ID is allocated again inside the query calculation node
    this.indexer.qcm.releasePathId(negationPathId);

    return queryCalc;
}

// This generates a new simple query calculation node for 
// the query calculation tree under this root query calculation node.
// 'pathId' is the path for which the simple query (a terminal, non-projection
// query) is defined. This path is realtive to the root of the query,
// so it must first be appended to the query's prefix path before
// creating the query calculation node (the query calculation node must
// have a path relative to the root of the indexer).

InternalRootQueryCalc.prototype.newSimpleQueryCalc = 
	internalRootQueryCalcNewSimpleQueryCalc;

function internalRootQueryCalcNewSimpleQueryCalc(pathId)
{
    // append the given path to the prefix path of this query
    pathId = 
        this.indexer.qcm.allocateConcatPathId(this.prefixProjPathId, pathId);
	var queryCalc = new SimpleQueryCalc(this, pathId);
    // the path ID is allocated again inside the query calculation node
    this.indexer.qcm.releasePathId(pathId);

    return queryCalc;
}

// This generates a new terminal projection query calculation node for 
// the query calculation tree under this root query calculation node.
// The given path is realtive to the root of the query,
// so it must first be appended to the query's prefix path before
// creating the query calculation node (the query calculation node must
// have a path relative to the root of the indexer).

InternalRootQueryCalc.prototype.newProjectionQueryCalc = 
	internalRootQueryCalcNewProjectionQueryCalc;

function internalRootQueryCalcNewProjectionQueryCalc(pathId)
{
    // append the given path to the prefix path of this query
    pathId = 
        this.indexer.qcm.allocateConcatPathId(this.prefixProjPathId, pathId);
	var queryCalc = new ProjectionQueryCalc(this, pathId);
    // the path ID is allocated again inside the query calculation node
    this.indexer.qcm.releasePathId(pathId);

    return queryCalc;
}

// This generates a new terminal 'true' query calculation node (one
// implementing the terminal 'true' query) for the query calculation
// tree under this root query calculation node.  The given path is
// realtive to the root of the query, so it must first be appended to
// the query's prefix path before creating the query calculation node
// (the query calculation node must have a path relative to the root
// of the indexer).
// In addition to the path ID, the caller must supply a value ID for
// the 'false' value which is registered by this 'true' query (the
// true query is n(false)). This value should be determined in the same
// way as the value IDs for standard values in a simple query calculation
// node (this is often the dominating element ID for the node carrying the
// value in the query description).

InternalRootQueryCalc.prototype.newTrueQueryCalc = 
	internalRootQueryCalcNewTrueQueryCalc;

function internalRootQueryCalcNewTrueQueryCalc(pathId, valueId)
{
    // append the given path to the prefix path of this query
    pathId = 
        this.indexer.qcm.allocateConcatPathId(this.prefixProjPathId, pathId);
	var queryCalc = new TrueQueryCalc(this, pathId, valueId);
    // the path ID is allocated again inside the query calculation node
    this.indexer.qcm.releasePathId(pathId);

    return queryCalc;
}

///////////////////
// Query Refresh //
///////////////////

// This function is called by the Query object every time the query is 
// recompiled. This function then notifies the query calculation nodes
// under it that they should refresh.

InternalRootQueryCalc.prototype.refreshQuery = 
	internalRootQueryCalcRefreshQuery;

function internalRootQueryCalcRefreshQuery()
{
	if(!this.queryCalc) {
        // the query may have become empty.
        this.queryStructureRefreshed();
		return;
    }

    debugStartTimer("query", "query refresh");

    if(this.raisedMatches)
        this.suspendedRaisedMatches = this.raisedMatches;

	this.queryCalc.refreshQuery();
    
    if(this.suspendedRaisedMatches !== undefined)
        this.suspendedRaisedMatches = undefined;

	debugStopTimer("query refresh");
}

//
// Structural update
//

// This function is called by the top query calculation node (or by
// the 'detachFromQueryCalc()' function of the root query calculation
// node itself) when the query changes, as a result of the removal of
// a projection sub-node, from a projection into a selection.
// This is part of the interface defined by the root query calculation node
// at a 'match parent' of the top query calculation node (this interface
// also applies among query calculation nodes). Here, this function does not
// need to do anything (the relevant refresh is triggered separately at the
// end of the query refresh).

InternalRootQueryCalc.prototype.updateQueryAfterNodeRemoval = 
    internalRootQueryCalcUpdateQueryAfterNodeRemoval;

function internalRootQueryCalcUpdateQueryAfterNodeRemoval()
{
}

// This function is called by the top query calculation node when the 
// structure of the query has been updated but before
// matches were updated. This allows the root query calculation node
// to prepare itself (and the result nodes which make use of it)
// to handling updates for the new query structure.
// When this query changes from a projection to a selection, this
// function is called immediately when the change occurs (and before
// match points were updated). In other cases it is called after the
// match points were updated.
// If one of the result nodes is already active, this will also 
// suspend the projection of any new generating terminal projection
// node, allowing it to be refreshed by being unsuspended at the 
// end of the query refresh. 

InternalRootQueryCalc.prototype.queryStructureRefreshed = 
    internalRootQueryCalcQueryStructureRefreshed;

function internalRootQueryCalcQueryStructureRefreshed()
{
    // refresh the projection path ID
    this.projPathId = this.getProjectionPathId();

    // notify the result nodes in case the terminal generating projection
    // structure has changed.
    // This also suspends new generating terminal projections in 
    // case some of the result nodes are already active.
    this.notifyModifiedGeneratingProjs();
}

//////////////////////////////////////////
// Assignment of Query Calculation Node //
//////////////////////////////////////////

// This function assigned the given query calculation node to be the root
// of this structure compiled from the query.

InternalRootQueryCalc.prototype.assignQueryCalc = 
	internalRootQueryCalcAssignQueryCalc;

function internalRootQueryCalcAssignQueryCalc(queryCalc)
{
	if(this.queryCalc == queryCalc)
		return;

    if(queryCalc !== undefined && !queryCalc.isProjection())
        // new selection query, record the 0 projection ID as having changed
        this.addModifiedGeneratingProj(0);

    this.detachFromQueryCalc();
	this.queryCalc = queryCalc;
    this.projPathId = this.getProjectionPathId();

    if(!this.queryCalc)
        return;
    
    // re-initialize matching
    this.initializeMatching();
}

// This removes the current query calculation node assignment without
// creating a new assignment.

InternalRootQueryCalc.prototype.detachFromQueryCalc = 
	internalRootQueryCalcDetachFromQueryCalc;

function internalRootQueryCalcDetachFromQueryCalc()
{
	if(!this.queryCalc || this.destroyed)
		return;

    // determine whether this was a projection or a selection before 
    // detaching from the query calculation node
    var isSelection = this.isSelection();

    if(this.resultNum && isSelection)
        // clear the matches due to the previous top query calculation node
        // (this needs to be called before this.queryCalc is changed).
        this.removeAllSelectionMatches();
    
	this.queryCalc.removeTheRoot();
    delete this.queryCalc;

    if(!isSelection)
        this.updateQueryAfterNodeRemoval();
}

//////////////////
// Match Points //
//////////////////

// This function is called by the top query calculation node when a
// match point with full count is added to it. 'pathId' is the ID of this
// match point. This function then checks whether the match point is lower
// (has a longer path) than the prefix path of this root query calculation
// node and if it is, adds it to the lowerMatchPoints table.
// If this is the first match point added, the 'raisedMatches' table is created.
// The implementation here is for selections and projections. Derived
// classes of this class (which have a query calculation node which 
// calls this function) should override it.

InternalRootQueryCalc.prototype.addToMatchPoints = 
	internalRootQueryCalcAddToMatchPoints;

function internalRootQueryCalcAddToMatchPoints(pathId)
{
    if(pathId > this.prefixProjPathId) {
        if(this.lowerMatchPoints === undefined) {
            this.lowerMatchPoints = new Map();
        }
        this.lowerMatchPoints.set(pathId, 1);
        if(this.raisedMatches === undefined)
            this.raisedMatches = new Map();
    }
}

// This function is called by the top query calculation node when a
// match point with full count is removed from it. 'pathId' is the ID of this
// match point. This function then checks whether the match point is lower
// (has a longer path) than the prefix path of this root query calculation
// node and if it does, removes it from the 'lowerMatchPoints' table.
// If the table just became empty as a result of this operation,
// the 'raisedMatches' table is destroyed.
// The implementation here is for selections and projections. Derived
// classes of this class (which have a query calculation node which 
// calls this function) should override it.

InternalRootQueryCalc.prototype.removeFromMatchPoints = 
	internalRootQueryCalcRemoveFromMatchPoints;

function internalRootQueryCalcRemoveFromMatchPoints(pathId)
{
    if(pathId > this.prefixProjPathId) {
        this.lowerMatchPoints.delete(pathId);
        if(this.lowerMatchPoints.size === 0)
            this.raisedMatches = undefined;
    }
}

/////////////
// Matches //
/////////////

// This function returns the domain of this query. The domain of the query
// is the set of data nodes in the indexer at the query's prefix projection
// path. All nodes returned in the result of the query must be dominated
// by these node (but, of course, the query result need not contain a
// node dominated by each of the domain nodes - the domain is an upper bound).
// Note that pending updates are taken into account in the set returned
// here: removed nodes such that the removal update is still pending are
// included in this list but added nodes whose addition is still pending are
// not included.
// This function returns an array of data element IDs.

InternalRootQueryCalc.prototype.getDomain = internalRootQueryCalcGetDomain;

function internalRootQueryCalcGetDomain()
{
    return this.indexer.getAllMatches(this.prefixProjPathId);
}

// This function returns the domain of this query. The domain of the query
// is the set of data nodes in the indexer at the query's prefix projection
// path. All nodes returned in the result of the query must be dominated
// by these node (but, of course, the query result need not contain a
// node dominated by each of the domain nodes - the domain is an upper bound).
// Note that pending updates are taken into account in the set returned
// here: removed nodes such that the removal update is still pending are
// included in this list but added nodes whose addition is still pending are
// not included.
// This function returns a Map object whose keys are the domain.

InternalRootQueryCalc.prototype.getDomainAsObj =
    internalRootQueryCalcGetDomainAsObj;

function internalRootQueryCalcGetDomainAsObj()
{
    return this.indexer.getAllMatchesAsObj(this.prefixProjPathId);
}

// This function returns an array holding the data element IDs of all
// matches of this root query calculation node. These matches are
// the 'selection' matches of this node. When the query under the
// root query calculation node is a projection, this list is empty.
// This is because even if the root query calculation node stores a query
// which performs selection (in addition to projection) this selection
// is invisible to the result node dominating it. Instead, the matches
// of the remaining inputs to the result node are pushed down to the
// root query calculation node, which is responsible for intersecting
// them with its own selection matches and then calculating the projection.

InternalRootQueryCalc.prototype.getMatches = internalRootQueryCalcGetMatches;

function internalRootQueryCalcGetMatches()
{
    if(this.isProjection())
        return [];
    
    if(this.lowerMatchPoints === undefined || this.lowerMatchPoints.size === 0)
        // no raising required, so we can simply return the full matches
        // of the top query calculation node
        return this.queryCalc ? this.queryCalc.getMatches() : [];

    // if some matches need to be raised, we get from the top query calculation
    // node the matches which do not require further raising and get from
    // the 'raisedMatches' the matches which were raised (these two lists
    // are, by definition, disjoint).

    var matches = this.queryCalc ? this.queryCalc.getFullyRaisedMatches() : [];

    if(this.raisedMatches && this.raisedMatches.size > 0) {
        matches = matches.concat(); // duplicate the array
        this.raisedMatches.forEach(function(count, elementId) {
            matches.push(elementId);
        });
    }

    return matches;
}

// This function is identical to getMatches except that it returns its 
// result as a Map object whose keys are the matches

InternalRootQueryCalc.prototype.getMatchesAsObj = 
    internalRootQueryCalcGetMatchesAsObj;

function internalRootQueryCalcGetMatchesAsObj()
{
    if(this.isProjection())
        return new Map();
    
    if(this.lowerMatchPoints === undefined || this.lowerMatchPoints.size === 0)
        // no raising required, so we can simply return the full matches
        // of the top query calculation node
        return this.queryCalc ? this.queryCalc.getMatchesAsObj() : new Map();

    // if some matches need to be raised, we get from the top query calculation
    // node the matches which do not require further raising and get from
    // the 'raisedMatches' the matches which were raised (these two lists
    // are, by definition, disjoint).

    var matches = this.queryCalc ?
        this.queryCalc.getFullyRaisedMatchesAsObj() : new Map();

    if(this.raisedMatches && this.raisedMatches.size > 0) {
        if(matches.size > 0) {
            var origMatches = matches;
            matches = new Map();
            origMatches.forEach(function(count, elementId) {
                matches.set(elementId, count);
            });
        } else if(this.queryCalc !== undefined)
            matches = new Map();
        this.raisedMatches.forEach(function(count, elementId) {
            matches.set(elementId,1);
        });
    }

    return matches;
}

// This function receives as input a list (array) of data element IDs
// and returns (in a new array) the subset of these elements which are
// matched by the selection of this node (this should not
// be called if this query is a projection).
// If no raising needs to take place on this node, we can simply
// use the 'filterMatches()' function of the top query calculation node.
// Otherwise, we need to use both the 'filterMatches()' function of 
// the top query calculation node and add to the matches filtered by 
// that function the matches which are found in 'raisedMatches'.

InternalRootQueryCalc.prototype.filterMatches = 
    internalRootQueryCalcFilterMatches;

function internalRootQueryCalcFilterMatches(elementIds)
{
    if(!this.queryCalc)
        return [];

    var matches = this.queryCalc.filterMatches(elementIds);

    if(this.lowerMatchPoints === undefined ||
       this.lowerMatchPoints.size === 0 || !this.raisedMatches || 
       this.raisedMatches.size == 0)
        return matches; // no raised nodes to check

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(this.raisedMatches.has(elementId))
            matches.push(elementId);
    }

    return matches;
}

// This function receives as input a list (array) of data element IDs
// and returns an array with the positions in the input array of element IDs
// which are matched by the selection of this node (this should not
// be called if this query is a projection).
// If no raising needs to take place on this node, we can simply
// use the 'filterMatchPositions()' function of the top query calculation node.
// Otherwise, we need to use both the 'filterMatchPositions()' function of 
// the top query calculation node and add to the matches filtered by 
// that function the matches which are found in 'raisedMatches'.
// This function is similar to 'filterMatches()' except that instead
// of returning a subset of the original array, it returns an array
// containing the positions (in the original array) of the elements which
// are matches of this query.

InternalRootQueryCalc.prototype.filterMatchPositions = 
    internalRootQueryCalcFilterMatchPositions;

function internalRootQueryCalcFilterMatchPositions(elementIds)
{
    if(!this.queryCalc)
        return [];

    var positions = this.queryCalc.filterMatchPositions(elementIds);

    if(this.lowerMatchPoints === undefined ||
       this.lowerMatchPoints.size === 0 || !this.raisedMatches || 
       this.raisedMatches.size == 0)
        return positions; // no raised nodes to check

    var posInPos = 0;
    var lastPos = positions[posInPos]; 

    var allPositions = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        if(i == lastPos) {
            allPositions.push(i);
            lastPos = positions[++posInPos];
        } else {
            var elementId = elementIds[i];
            if(this.raisedMatches.has(elementId)) {
                allPositions.push(i);
            }
        }
    }

    return allPositions;
}


// This function initializes matching when a new query calculation node
// becomes the top query calculation node. This function clears all its
// current matches (and those of its result nodes, if necessary)
// and sets itself as the new matching parent of the query calculation
// node. This then will cause the query calculation node to add its
// matches to this root query calculation node (resulting in a complete
// refresh of the matches).
// Note: derived classes of this class should override this function 
// (or assignQueryCalc which calls it) if they wish to replace the 
// existing queryCalc object with another. This function assumes that 
// the query calculation node is either a selection or a projection.

InternalRootQueryCalc.prototype.initializeMatching = 
	internalRootQueryCalcInitializeMatching;

function internalRootQueryCalcInitializeMatching()
{
    // reset matching
    if(this.lowerMatchPoints !== undefined)
        this.lowerMatchPoints = new Map();
    if(this.raisedMatches)
        delete this.raisedMatches;

    // read the match points of the (new) top query calculation node
    if(this.queryCalc) {
        var queryMatchPoints = this.queryCalc.getFullCountMatchPoints();
        var _self = this;
        queryMatchPoints.forEach(function(count, pathId) {
            _self.addToMatchPoints(pathId);
        });
    }

    if(this.lowerMatchPoints !== undefined && this.lowerMatchPoints.size !== 0)
        this.raisedMatches = new Map();

    // this will also add any matches already calculated for the top
    // query calculation node.
    this.queryCalc.setRootAsMatchParent();
}

//
// Adding Matches
//

// This function is called by the top query calculation node with a list
// (an array of data element IDs) of new matches for that node. This should
// only be called if the query is a selection. This function propagates 
// these matches to the result nodes which make use of it (except for 
// those listed in this.queuedAllMatchUpdates, which will get a full 
// update later).
// If no raising needs to be carried out, the list of matches can be used
// as is (transferred to the result nodes). If raising may need to take place, 
// each matched element is first checked for raising.
// A new list of fully raised matches is created, which is then sent to 
// the result nodes.

InternalRootQueryCalc.prototype.addMatches = 
	internalRootQueryCalcAddMatches;

function internalRootQueryCalcAddMatches(elementIds)
{
    if(this.destroyed)
        return; // called in the process of begin destroyed

    var matches;
    
    if(this.lowerMatchPoints === undefined || this.lowerMatchPoints.size === 0)
        // no raising necessary, pass the matches as is
        matches = elementIds;
    else // selection with raising
        matches = this.addMatchesToSelectionRoot(elementIds);

    // add matches to those result nodes which do not appear in 
    // the this.queuedAllMatchUpdates list (these will get a full update
    // later).

    var _self = this;

    this.results.forEach(function(queryResult, resultId) {
        if(!_self.queuedAllMatchUpdates ||
           !_self.queuedAllMatchUpdates.has(resultId))
            queryResult.addMatches(matches, _self);
    });
}

// This function implements part of the 'addMatches' function for the
// case where raising may be necessary (the query is a selection).
// This function takes as input the list of matches being added (by the top
// query calculation node) performs raising (where necessary) and returns
// a list (an array) of fully raised matches which can then be passed on to the
// result nodes. This function also updates the 'raisedMatches' table.

InternalRootQueryCalc.prototype.addMatchesToSelectionRoot = 
	internalRootQueryCalcAddMatchesToSelectionRoot;

function internalRootQueryCalcAddMatchesToSelectionRoot(elementIds)
{
    var matches = [];
    var l = elementIds.length;
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.prefixProjPathId;

    if(!this.raisedMatches)
        this.raisedMatches = new Map();
        
    // raise matches where necessary
    for(var i = 0 ; i < l ; ++i) {

        var raisedId; // the element before raising
        var elementId = raisedId = elementIds[i];

        elementId = dataElements.raiseToPath(elementId, prefixPathId);

        if(elementId != raisedId) {
            // raising took place
            if(!this.raisedMatches.has(elementId)) {
                this.raisedMatches.set(elementId, 1);
                matches.push(elementId); // first match
            } else
                this.raisedMatches.set(elementId,
                                       this.raisedMatches.get(elementId)+1);
        } else // no raising took place
            matches.push(elementId);
    }
    
    return matches;
}

// This function is given a query result node which makes use of this
// root query calculation node. The function queues this result node
// to have its addMatches function called with all matches of this
// root query calculation node. This could happen after the matches of
// this root query calculation node have been updated (possibly after
// a query refresh). As long as this update is queued, no incremental updates
// go from the root query calculation node to the given result node
// (or through it to result nodes which dominate it).

InternalRootQueryCalc.prototype.queueAddAllMatchesToDominating =
    internalRootQueryCalcQueueAddAllMatchesToDominating;

function internalRootQueryCalcQueueAddAllMatchesToDominating(queryResult)
{
    if(!queryResult)
        return;
    
    if(!this.queuedAllMatchUpdates)
        this.queuedAllMatchUpdates = new Map();

    this.queuedAllMatchUpdates.set(queryResult.getId(), queryResult);
}

// This function goes over all result nodes stored in 'queuedAllMatchUpdates'
// and checks whether they are still registered as result nodes making use
// of this root query calculation node. For each one which is, all matches
// of the root query calculation node are added to the result node
// (using the standard 'addMatches'). The 'queuedAllMatchUpdates' list is
// then cleared.

InternalRootQueryCalc.prototype.addAllMatchesToQueuedResults =
    internalRootQueryCalcAddAllMatchesToQueuedResults;

function internalRootQueryCalcAddAllMatchesToQueuedResults()
{
    if(!this.queuedAllMatchUpdates || !this.results)
        return; // no queued result nodes

    if(this.isSelection()) {
        var matches;

        var _self = this;
        
        this.queuedAllMatchUpdates.forEach(function(queryResult, resultId) {
            if(_self.results.has(resultId)) {
                // still a result composed with this result node

                if(!matches)
                    matches = _self.getMatches();

                queryResult.addMatches(matches, _self);
            }
        });
    }

    this.queuedAllMatchUpdates = undefined;
}

//
// Removing Matches
//

// This function is called by the top query calculation node with a list
// (an array of data element IDs) of matches which were just removed from
// that node. If tihs function is called, the query must be a selection.
// This function then propagates the removal of these matches to the result 
// nodes which make use of it (except for those listed in 
// this.queuedAllMatchUpdates, which will get a full update later).
// If no raising needs to be carried out, the list is transferred to
// the result nodes as is. If raising may need to take place, each matched
// element is first checked for raising and a new list of fully raised matches
// is created. This list is then sent to the result nodes.

InternalRootQueryCalc.prototype.removeMatches = 
	internalRootQueryCalcRemoveMatches;

function internalRootQueryCalcRemoveMatches(elementIds)
{
    if(this.destroyed)
        return; // called in the process of begin destroyed

    var removedMatches;
    
    if(!this.suspendedRaisedMatches &&
       (this.lowerMatchPoints === undefined ||
        this.lowerMatchPoints.size === 0 || 
        !this.raisedMatches || this.raisedMatches.size == 0))
        // no raising necessary, pass the matches as is
        removedMatches = elementIds;
    else
        removedMatches = this.removeMatchesFromSelectionRoot(elementIds);

    // remove matches from those result nodes which do not appear in 
    // the this.queuedAllMatchUpdates list (these will get a full update
    // later).

    var _self = this;
    this.results.forEach(function(queryResult, resultId) {
        if(!_self.queuedAllMatchUpdates ||
           !_self.queuedAllMatchUpdates.has(resultId))
            queryResult.removeMatches(removedMatches, _self);
    });
}

// This function implements part of the 'removeMatches' function for the
// case where raising may be necessary (the query is a selection).
// This function takes as input the list of matches being removed (by the top
// query calculation node) performs raising (where necessary) and returns
// a list (an array) of fully raised matches which can then be passed on to the
// result nodes. This function also updates the 'raisedMatches' table.
// If no 'raisedMatches' table exists, this function is being called as part
// of the query refresh process and the 'suspendedRaisedMatches' table
// is used instead.

InternalRootQueryCalc.prototype.removeMatchesFromSelectionRoot = 
	internalRootQueryCalcRemoveMatchesFromSelectionRoot;

function internalRootQueryCalcRemoveMatchesFromSelectionRoot(elementIds)
{
    var removedMatches = [];
    var l = elementIds.length;
    var dataElements = this.indexer.getDataElements();
    var prefixPathId = this.prefixProjPathId;
    var raisedMatches = 
        this.raisedMatches ? this.raisedMatches :  this.suspendedRaisedMatches;

    // raise matches where necessary
    for(var i = 0 ; i < l ; ++i) {

        var raisedId; // the element before raising
        var elementId = raisedId = elementIds[i];

        elementId = dataElements.raiseToPath(elementId, prefixPathId);
        
        if(elementId != raisedId) {
            // raising took place
            if(raisedMatches.get(elementId) == 1) {
                raisedMatches.delete(elementId);
                removedMatches.push(elementId); // last match removed
            } else
                raisedMatches.set(elementId, raisedMatches.get(elementId)-1);
        } else // no raising took place
            removedMatches.push(elementId);
    }

    return removedMatches;
}

// This function removes from the result nodes all matches due to this
// root query calculation node, in case this is a selection query. If
// the query is a projection, the matches should be removed when the
// projection nodes are removed as generating projection from the
// root query calculation node.

InternalRootQueryCalc.prototype.removeAllSelectionMatches = 
	internalRootQueryCalcRemoveAllSelectionMatches;

function internalRootQueryCalcRemoveAllSelectionMatches()
{
    var removedMatches; // initially, undefined
    
    if(this.isSelection())
        var _self = this;
    this.results.forEach(function(queryResult, resultId) {
        if(removedMatches === undefined)
            removedMatches = _self.getMatches();
        queryResult.removeMatches(removedMatches, _self);
    });

    // clear the 'raisedMatches' table, if necessary
    if(this.raisedMatches)
        this.raisedMatches = new Map();
}

////////////////////////
// Projection Matches //
////////////////////////

// This function is called by the result node to indicate a possible change
// in its 'proj must generate matches' property. 'mustGenerate' is the current
// value of this property. This function simply propagates this property
// down the query (it is only relevant to projection query calculation nodes).

InternalRootQueryCalc.prototype.refreshProjMustGenerateMatches =
    internalRootQueryCalcRefreshProjMustGenerateMatches;

function internalRootQueryCalcRefreshProjMustGenerateMatches(resultId,
                                                             mustGenerate)
{
    if(this.queryCalc)
        this.queryCalc.refreshProjMustGenerateMatches(resultId, mustGenerate);
}

// Calls the function with the same name on the top query calculation
// node. See documentation in InternalQueryCalc.

InternalRootQueryCalc.prototype.initExplicitProjMatches =
    internalRootQueryCalcInitExplicitProjMatches;

function internalRootQueryCalcInitExplicitProjMatches(resultId, elementIds)
{
    if(this.queryCalc)
        this.queryCalc.initExplicitProjMatches(resultId, elementIds);
}

// Calls the function with the same name on the top query calculation
// node. See documentation in InternalQueryCalc.

InternalRootQueryCalc.prototype.setExplicitProjMatches =
    internalRootQueryCalcSetExplicitProjMatches;

function internalRootQueryCalcSetExplicitProjMatches(resultId)
{
    if(this.queryCalc)
        this.queryCalc.setExplicitProjMatches(resultId);
}

// Calls the function with the same name on the top query calculation
// node. See documentation in InternalQueryCalc.

InternalRootQueryCalc.prototype.releaseExplicitProjMatches =
    internalRootQueryCalcReleaseExplicitProjMatches;

function internalRootQueryCalcReleaseExplicitProjMatches(resultId)
{
    if(this.queryCalc)
        this.queryCalc.releaseExplicitProjMatches(resultId);
}

// This function returns a array holding the data element IDs
// of the projection matches of this root query calculation node for the given
// result node. If this returns undefined then the result node does not
// restrict the projection of the query.
// If this function is called for a result node which does restrict the
// projection of the query, the function calculates the projection matches
// by retrieving the selection matches of the result node and then adding
// to them, if necessary, their lowering to lower match points
// (this lowering is performed using a function of the InternalQueryCalc
// class).

InternalRootQueryCalc.prototype.getProjMatches =
    internalRootQueryCalcGetProjMatches;

function internalRootQueryCalcGetProjMatches(resultId)
{
    var result = this.results.get(resultId);

    if(!result.restrictsProjection())
        return undefined;

    // get the result selection matches
    var projMatches = result.getSelectionMatches();

    // append lowered projection matches (if needed) and return
    return this.queryCalc.lowerToProjMatchPoints(projMatches, 
                                                 this.lowerMatchPoints);
}

// This is the same as getProjMaches() except that the result is returned
// as a Map object (whose keys are the matches).

InternalRootQueryCalc.prototype.getProjMatchesAsObj =
    internalRootQueryCalcGetProjMatchesAsObj;

function internalRootQueryCalcGetProjMatchesAsObj(resultId)
{
    var result = this.results.get(resultId);

    if(!result.restrictsProjection())
        return undefined;

    if(this.lowerMatchPoints === undefined || this.lowerMatchPoints.size === 0)
        // no lowering, simply return the result selection matches
        return result.getSelectionMatchesAsObj();

    // need to lower
    
    var projMatches = result.getSelectionMatches();

    // append lowered projection matches
    this.queryCalc.lowerToProjMatchPoints(projMatches, 
                                          this.lowerMatchPoints);

    var projMatchesAsObj = new Map();
    
    for(var i = 0, l = projMatches.length ; i < l ; ++i)
        projMatchesAsObj.set(projMatches[i], true);

    return projMatchesAsObj;
}

// This function receives a list of matches from the top query calculation
// node (which is a projection) and checks which of these matches are
// projection matches for the query for the given result ID, that is, 
// are selected by the selection matches of the given result.
// First, we need to check whether the result object
// restricts the projection. If it does not restrict
// the projection, the given 'matches' can be returned as is. If it
// does restrict the projection, we fetch the selection matches 
// of the result node. The 'matches' are then checked against this 
// list of selection matches. If there are lower match points, this
// function raises lower data elements in 'matches' (to the query's
// prefix path) before comparing them with the selection matches of 
// the result nodes.
// The function returns an array holding the filtered matches. These are
// a subset of the input list given in 'matches'.

InternalRootQueryCalc.prototype.filterProjMatches =
    internalRootQueryCalcFilterProjMatches;

function internalRootQueryCalcFilterProjMatches(matches, resultId)
{
    var result = this.results.get(resultId);

    if(!result.isActive())
        return []; // not yet active, cannot filter

    if(!result.restrictsProjection())
        return matches; // the result does not restrict the projection

    var resultMatches = result.getSelectionMatchesAsObj();
    var filtered = [];

    if(this.lowerMatchPoints === undefined || this.lowerMatchPoints.size === 0){
        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var elementId = matches[i];
            if(resultMatches.has(elementId))
                filtered.push(elementId);
        }
    } else {
        // raising may be required
        var dataElements = this.indexer.getDataElements();
        var prefixPathId = this.prefixProjPathId;
        for(var i = 0, l = matches.length ; i < l ; ++i) {
            var elementId = matches[i];
            // perform raising
            var raisedId = elementId; // store ID before raising
            elementId = dataElements.raiseToPath(elementId, prefixPathId);
            if(resultMatches.has(elementId))
                filtered.push(raisedId);
        }
    }

    return filtered;
}

// This function is called by the result node (with ID 'resultId') 
// to (re-)initialize the projection matches of the result node on this 
// query. This usually happens when the query is first activated
// or when the 'restricts projection' property of the result node changes.
// The function then calls the top query calculation node, telling it
// to re-initialize its projection matches.

InternalRootQueryCalc.prototype.setProjMatches =
    internalRootQueryCalcSetProjMatches;

function internalRootQueryCalcSetProjMatches(resultId)
{
    if(this.destroyed)
        return; // called in the process of begin destroyed

    if(this.queryCalc)
        this.queryCalc.setProjMatches(resultId);
}

// This function is called by the result node with the given result ID
// when the given element IDs are added to the result node's
// matches (the result node's matches and projection matches are identical,
// by definition). This function first checks whether lowering needs to 
// take place, that is, whether the top query calculation node has match 
// points which are lower than the prefix path of this root query calculation
// node (the result node matches are at this path or higher).
// If lowering is required, this function lowers the element IDs provided
// by the result node and adds the lowered element IDs to the list 
// (the higher element IDs remain on the list, as this does not seem
// to cause any harm and simplifies the handling).
// After lowering, the projection matches are added to the top query
// calculation node.

InternalRootQueryCalc.prototype.addProjMatches =
    internalRootQueryCalcAddProjMatches;

function internalRootQueryCalcAddProjMatches(elementIds, resultId)
{
    if(this.destroyed)
        return; // called in the process of begin destroyed

    if(!elementIds.length || !this.queryCalc)
        return;

    var origLength;
    
    if(this.lowerMatchPoints !== undefined &&
       this.lowerMatchPoints.size !== 0) {
        origLength = elementIds.length;
        elementIds = this.lowerProjMatches(elementIds);
    }
    
    // add the projection matches to the top query calculation node
    this.queryCalc.addProjMatches(elementIds, resultId);

    // reset the length of the list (in case lowered elements were added)
    if(this.lowerMatchPoints !== undefined && this.lowerMatchPoints.size !== 0)
        elementIds.length = origLength;
}


// This function is called by the result node with the given result ID
// when the given element IDs are removed from the result node's
// matches (the result node's matches and projection matches are identical,
// by definition). This function first checks whether lowering needs to 
// take place, that is, whether the top query calculation node has match 
// points which are lower than the prefix path of this root query calculation
// node (the result node matches are at this path or higher).
// If lowering is required, this function lowers the element IDs provided
// by the result node and adds the lowered element IDs to the list 
// (the higher element IDs remain on the list, as this does not seem
// to cause any harm and simplifies the handling).
// After lowering, the projection matches are removed from the top query
// calculation node.

InternalRootQueryCalc.prototype.removeProjMatches =
    internalRootQueryCalcRemoveProjMatches;

function internalRootQueryCalcRemoveProjMatches(elementIds, resultId)
{
    if(this.destroyed)
        return; // called in the process of begin destroyed

    if(!elementIds.length || !this.queryCalc)
        return;

    var origLength;
    
    if(this.lowerMatchPoints !== undefined &&
       this.lowerMatchPoints.size !== 0) {
        origLength = elementIds.length;
        elementIds = this.lowerProjMatches(elementIds);
    }
    
    // add the projection matches to the top query calculation node
    this.queryCalc.removeProjMatches(elementIds, resultId);

    // reset the length of the list (in case lowered elements were added)
    if(this.lowerMatchPoints !== undefined && this.lowerMatchPoints.size !== 0)
        elementIds.length = origLength;
}

// This function receives an array of element IDs which are at or above
// the prefix path of this query and lowers them to the match points
// of the top query calculation node. The lowered element IDs are appended
// to the list and the extended list is returned by the function.
// Lowering is performed by the indexer.

InternalRootQueryCalc.prototype.lowerProjMatches =
    internalRootQueryCalcLowerProjMatches;

function internalRootQueryCalcLowerProjMatches(elementIds)
{
    if(this.lowerMatchPoints === undefined || this.lowerMatchPoints.size === 0)
        return elementIds;

    var lowerMatchPoints = [];
    this.lowerMatchPoints.forEach(function(t, pathId) {
        lowerMatchPoints.push(pathId);
    });
    
    return this.indexer.lowerDataElementsTo(elementIds, lowerMatchPoints);
}

// This function is identical in function to lowerProjMatches() except that
// its input and output are Map objects (whose keys are the set of matches).

InternalRootQueryCalc.prototype.lowerProjMatchesAsObj =
    internalRootQueryCalcLowerProjMatchesAsObj;

function internalRootQueryCalcLowerProjMatchesAsObj(elementIdObj)
{
    if(this.lowerMatchPoints === undefined || this.lowerMatchPoints.size === 0)
        return elementIdObj;

    // convert into an array
    var elementIds = [];

    elementIdObj.forEach(function(t,elementId) {
        elementIds.push(elementId);
    });

    var origLength = elementIds.length;
    
    elementIds = this.lowerProjMatches(elementIds);

    for(var i = origLength, l = elementIds.length ; i < l ; ++i)
        elementIdObj.set(elementIds[i], true);

    return elementIdObj;
}

// This function can be called with a query calculation object 'queryCalc'
// which is a terminal generating projection of this query to remove all
// its matches from the result node. This would typically be called when 
// the generating projection is removed (destroyed).
// This function goes over all result nodes registered to this function
// and notifies each of the to remove the projection matches it received
// from this node. The result node could then (optionally) fetch the 
// projection matches from the query calculation node. Therefore, it is
// asumed that when this function is called, the projection matches are
// still stored in the query calculatino node. 

InternalRootQueryCalc.prototype.removeAllTerminalProjMatches = 
    internalRootQueryCalcRemoveAllTerminalProjMatches;

function internalRootQueryCalcRemoveAllTerminalProjMatches(queryCalc)
{
    if(!this.resultNum)
        return; // no result nodes registered

    this.results.forEach(function(queryResult, resultId) {
        queryResult.removeAllTerminalProjMatches(queryCalc);
    });
}

// This function adds all current projection matches to the result
// node with the given result ID. The function goes over all the generating
// projections of this root query calculation node and checks which of
// them is a terminal generating projection. It then fetches the current 
// projection matches (for the given result ID) from these query calculation
// nodes and adds them to the result node, using 'addTerminalProjMatches()'.
// This is used for initilization of the result node when it becomes active
// (often it will have nothing to add, as no projection matches were
// calcualted yet, but sometimes, when the result is deactivated and 
// reactivated again, some matches remain stored and these are not
// reported by the incremental update).

InternalRootQueryCalc.prototype.addAllTerminalProjMatches =
    internalRootQueryCalcAddAllTerminalProjMatches;

function internalRootQueryCalcAddAllTerminalProjMatches(resultId)
{
    var result = this.results.get(resultId);

    if(!result)
        return;

    this.generatingProjs.forEach(function(entry, projId) {
        var queryCalc = entry.queryCalc;

        if(!queryCalc || !queryCalc.isGeneratingProjectionTerminal())
            return;

        result.addTerminalProjMatches(queryCalc, 
                                      queryCalc.getProjMatches(resultId));
    });
}

////////////////////////////
// Generating Projections //
////////////////////////////

// Given a query calculation node, this function returns 
// the entry in the 'generatingProjs' table for this node. If the entry
// does nto exist, it is created. The entry is created with only one
// field in it, 'queryCalc' which points at the query calculation object.

InternalRootQueryCalc.prototype.getGeneratingProj =
    internalRootQueryCalcCalcGetGeneratingProj;

function internalRootQueryCalcCalcGetGeneratingProj(queryCalc)
{
    if(!this.generatingProjs)
        this.generatingProjs = new Map();
    
    var entry;
    var queryId = queryCalc.getId();

    // entry may have existed as a selection-projection
    if(!this.generatingProjs.has(queryId)) {
        entry = { queryCalc: queryCalc };
        this.generatingProjs.set(queryId, entry);
    } else
        entry = this.generatingProjs.get(queryId);

    return entry;
}

// This function receives as input an entry in the generatingProjs table
// and returns true iff it is a terminal generating projection (based 
// in the information stored in the entry). The entry is terminal if
// it has no children (it is not an intersection node), and either has 
// a path which is longer than the prefix projection path of 
// the root query calculation node (meaning it cannot be 
// a selection-projection) or it has no parent (meaning that it is 
// a generating projection even if it is a selection-projection).

InternalRootQueryCalc.prototype.isTerminalGeneratingProj = 
    internalRootQueryCalcIsTerminalGeneratingProj;

function internalRootQueryCalcIsTerminalGeneratingProj(entry)
{
    return (!entry.children && 
            (!entry.parent || entry.pathId > this.prefixProjPathId));
}

// this function should be called with a simple query calculation node
// (under this root node) when it is first refreshed. This function
// adds this query calculation node to the generatingProjs table (if
// it is not yet in the table), sets its parent (if any) and sets the
// path on this node (and possibly also on its parent, if the parent
// path can now be calculated).

InternalRootQueryCalc.prototype.addSimpleGeneratingProj =
    internalRootQueryCalcAddSimpleGeneratingProj;

function internalRootQueryCalcAddSimpleGeneratingProj(queryCalc)
{
    var id = queryCalc.getId();
    var entry = this.getGeneratingProj(queryCalc);
    var parentEntry;

    if(!entry.pathId)
        // new entry, find the generating parent of this node (if any)
        parentEntry = this.findGeneratingParent(queryCalc, entry);

    // set the paths
    entry.pathId = queryCalc.pathId;

    // set the path of the parent (if not yet known) and calculate
    // the mapped path.
    if(parentEntry && !parentEntry.pathId) {
        if(!this.calcIntersectionGeneratingProjPath(entry.parent, parentEntry))
            this.calcMappedPathId(id, entry);
    } else
        this.calcMappedPathId(id, entry);
}

// This function should be called with a query calculation node which is 
// an intersection generating projection (an intersection with at least
// two projection sub-queries). This function adds this query calculation 
// node to the generatingProjs table (if it is not yet in the table),
// finds its children and parent (those which are already in the table)
// and sets the paths on this node and all affected nodes.

InternalRootQueryCalc.prototype.addIntersectionGeneratingProj =
    internalRootQueryCalcAddIntersectionGeneratingProj;

function internalRootQueryCalcAddIntersectionGeneratingProj(queryCalc)
{
    var id = queryCalc.getId();

    var entry = this.getGeneratingProj(queryCalc);

    if(entry.children)
        return; // nothing to do, not a new projection intersection

    // find direct children and set the parent-child relation with them

    entry.children = {};
    var subProjs = [queryCalc];
    
    for(var pos = 0 ; pos < subProjs.length ; ++pos) {
        var proj = subProjs[pos];
        var projId = proj.getId();
        var childEntry;
        if(id != projId && (childEntry = this.generatingProjs.get(projId)))
            this.setGeneratingParent(projId, childEntry, true, id, entry);
        else // continue to the sub-projections
            for(var subProjId in proj.projSubNodes)
                subProjs.push(proj.projSubNodes[subProjId]);
    }
    
    // determine the parent (if any)
    this.findGeneratingParent(queryCalc, entry);

    // set the path of this node (based on the paths of the children)
    // and calculate the mapped paths (if not done inside the path
    // calculation function).
    if(!this.calcIntersectionGeneratingProjPath(id, entry))
        this.calcMappedPathId(id, entry);
}

// this function should be called with a selection-projection query 
// calculation node (under this root node) when it becomes a 
// selection-projection (and therefore a generating projection candidate). 
// This function adds this query calculation node 
// to the generatingProjs table (if it is not yet in the table), and checks
// whether it has a parent generating projection in the table. If it does,
// the parent is set appropriately. This node does not become a child
// of the parent generating projection node because a selection-projection
// node dominated by another generating projection is not a generating 
// projection.

InternalRootQueryCalc.prototype.addSelectionGeneratingProj =
    internalRootQueryCalcAddSelectionGeneratingProj;

function internalRootQueryCalcAddSelectionGeneratingProj(queryCalc)
{
    var id = queryCalc.getId();
    var entry = this.getGeneratingProj(queryCalc);

    if(entry.pathId) { // existing entry, no need to find parent
        if(entry.parent) {

            var parentEntry = this.generatingProjs.get(entry.parent);

            if(parentEntry.children && parentEntry.children[id]) {
                // move from the 'children' to the 'selections' table
                delete parentEntry.children[id];
                if(!parentEntry.selections)
                    parentEntry.selections = {};
                parentEntry.selections[id] = true;
            }
        }
    } else {
        // find the parent
        this.findGeneratingParent(queryCalc, entry);
    }

    // set the paths (this can have no influence on the path of the parent)
    entry.pathId = this.prefixProjPathId;
    this.calcMappedPathId(id, entry);
}

// this function should be called with a query calculation node under this
// root node when it stops being a generating projection candidate
// (that is, it was, but no longer is, a simple projection, an intersection
// projection with at least two sub-projection or a selection-projection).
// This function removes the entry for this node from the generatingProjs
// table and updates its children and parent. It also updates all paths.

InternalRootQueryCalc.prototype.removeGeneratingProj =
    internalRootQueryCalcRemoveGeneratingProj;

function internalRootQueryCalcRemoveGeneratingProj(queryCalc)
{
    if(this.destroyed)
        return;

    if(!this.generatingProjs)
        return;

    var id = queryCalc.getId();
    var entry = this.generatingProjs.get(id);

    if(!entry)
        return;

    // path related update for this entry and clearing of matches from 
    // the result nodes.
    if(this.isTerminalGeneratingProj(entry)) {
        this.removeAllTerminalProjMatches(queryCalc);
        this.addModifiedGeneratingProj(id);
        this.terminalGeneratingProjNum--;
    }
    if(entry.mappedPathId)
        this.indexer.qcm.releasePathId(entry.mappedPathId);

    var parentEntry = 
        entry.parent ? this.generatingProjs.get(entry.parent) : undefined;

    if(parentEntry) {
        // reomve from the parent entry
        if(entry.pathId == this.prefixProjPathId) // a selection projection
            delete parentEntry.selections[id];
        else
            delete parentEntry.children[id];
    }

    // remove from generating children (there should be at most one)
    if(entry.children) {
        for(var childId in entry.children) {
            var childEntry = this.generatingProjs.get(childId);
            childEntry.parent = entry.parent; // may be undefined
            if(parentEntry)
                // update the parent with the child
                parentEntry.children[childId] = true;
            this.calcMappedPathId(childId, childEntry);
        }
    }

    // remove from dominated selection-projections
    if(entry.selections) {
        for(var selectionId in entry.selections) {
            var selectionEntry = this.generatingProjs.get(selectionId);
            if(!(selectionEntry.parent = entry.parent)) {
                // selection-projection became a generating projection
                // (has no parent anymore).
                this.calcMappedPathId(selectionId, selectionEntry);
            } else {
                // set on parent entry
                if(!parentEntry.selections)
                    parentEntry.selections = {};
                parentEntry.selections[selectionId] = true;
            }
        }
    }

    this.generatingProjs.delete(id);
}

// Given a (candidate) generating projection query calculation node and 
// its entry in generatingProjs, this function looks for its parent in 
// the generatingProjs table (if such a parent exists). It updates
// the parent / children / selections fields on these entries as needed.
// This function sould only be called if the parent of this entry 
// has not yet been determined. Once the parent is determined, changes
// to the structure are handled inclrementally (elsewhere).
// This function returns the parent's entry (if exists).

InternalRootQueryCalc.prototype.findGeneratingParent =
    internalRootQueryCalcFindGeneratingParent;

function internalRootQueryCalcFindGeneratingParent(queryCalc, entry)
{
    var parentId;
    var parentEntry;

    // find the generating parent of this node (if any)
    for(var parent = queryCalc.parent ; parent ; parent = parent.parent) {
        if(parentEntry = this.generatingProjs.get(parentId = parent.getId()))
            // parent found
            break;
    }
    
    if(!parentEntry) {
        entry.parent = undefined;
        return;
    }
    
    // set the parent-child relation
    this.setGeneratingParent(queryCalc.getId(), entry, queryCalc.isProjection(),
                             parentId, parentEntry);

    return parentEntry;
}

// Given two generating projection entries (together with their IDs) which 
// should have a parent-child relation, this function updates all 
// parent/children/selections fields on the entries to reflect this relation. 
// This includes update any previous parent of the child. The child may be 
// a projection or a selection projection (in which case it is stored in 
// the 'selections' table of the parent).
// 'childIsProjection' shoudl be true if the child node is a projection
// query (that is, not a selection-projection query) and false otherwise.

InternalRootQueryCalc.prototype.setGeneratingParent =
    internalRootQueryCalcSetGeneratingParent;

function internalRootQueryCalcSetGeneratingParent(childId, childEntry,
                                                  childIsProjection,
                                                  parentId, parentEntry)
{
    if(childEntry.parent == parentId)
        return; // nothing changed
    
    var prevParentEntry = childEntry.parent ? 
        this.generatingProjs.get(childEntry.parent) : undefined;

    if(childIsProjection) {
        // this is a projection node (not a selection-projection)
        if(prevParentEntry)
            // remove from current parent
            delete prevParentEntry.children[childId];
        parentEntry.children[childId] = true;
    } else { // this is a selection-projection
        if(prevParentEntry)
            delete prevParentEntry.selections[childId];
        if(!parentEntry.selections)
            parentEntry.selections = {};
        parentEntry.selections[childId] = true;
    }
    childEntry.parent = parentId;
}

// Given query ID and the entry 'entry' of this query in the
// generatingProjs table, this function calcualtes the 'mappedPathId'
// field of this entry based on the current values set on the entry
// and on its parent entry.  The mappedPathId is the path ID to which
// the projection path of this entry will be mapped. This is the path
// consisting of the concatenation of the parent attributes of all
// entries dominating this entry and this entry (beginning from the
// top dominating entry).  The parent attribute is the first attribute
// in the path of this entry which appears after the path of the
// parent entry (which must be a prefix of the path of this entry).
// If the mapped path ID changed, the calculation is repeated for the
// children of this entry.
// Based on the changes in the mapped path ID, this function can determine
// whether terminal generating projections were added, removed or modified.
// It then updates the 'modifiedGeneratingProjs' table and the 
// terminalGeneratingprojNum field accordingly. A selection-projection
// with a parent is assigned an undefined mapped path ID.

InternalRootQueryCalc.prototype.calcMappedPathId =
    internalRootQueryCalcCalcMappedPathId;

function internalRootQueryCalcCalcMappedPathId(queryId, entry)
{
    if(!entry.pathId)
        return; // cannot be calculated

    var mappedPathId;

    if(!entry.parent)
        mappedPathId = this.indexer.qcm.getRootPathId();
    else if(entry.pathId != this.prefixProjPathId) {
        // not a selection-projection with parent
        var parentEntry = this.generatingProjs.get(entry.parent);
        if(!parentEntry.pathId || !parentEntry.mappedPathId)
            return; // cannot be calculated
        // find the first attribute in the path of this entry which follows
        // the prefix which is the path of the parent entry
        var attr = 
            this.indexer.qcm.getFirstAttrAfterPrefix(parentEntry.pathId, 
                                                     entry.pathId);
        mappedPathId = 
            this.indexer.qcm.allocatePathId(parentEntry.mappedPathId, attr);
    }

    if(entry.mappedPathId)
        this.indexer.qcm.releasePathId(entry.mappedPathId);
        
    if(entry.mappedPathId == mappedPathId)
        return; // nothing changed

    if(!entry.children) { // possibly a terminal generating projection
        this.addModifiedGeneratingProj(queryId);
        if(!entry.mappedPathId)
            this.terminalGeneratingProjNum++;
        else if(!mappedPathId) // a selection-projection under a 
            this.terminalGeneratingProjNum--;
    }

    // set the mapped path ID. This may be undefined if the node is 
    // a selection-projection with a parent
    entry.mappedPathId = mappedPathId;
    
    // update the mapped path of the children based on this new path 
    if(entry.children)
        for(var childId in entry.children)
            this.calcMappedPathId(childId, this.generatingProjs.get(childId));
}

// Given the ID and entry of a generating intersection projection in the 
// generatingProjs table, this function attempts to calculate the 
// path of this node. This path is the common prefix of all child
// generating projections which have a path ID larger than 
// the prefix projection path of the root query calculation node
// (generating projections with a path equal to the prefix projection 
// path of the root query calculatino node are selection-projections 
// and are not included in this calculation). The calculation 
// fails if the number of children with such a path ID is less than 2.
// In that case, the path ID assigned to the node is undefined and the mapped 
// path ID of the entry is also set to undefined. Otherwise, the 
// path is assigned to the entry and the mapped path ID is calculated
// for this entry and for all child entries.
// If this entry has a parent and that parent does not yet have a path
// assigned, its path is calculated (as well as its mapped path, in which
// case this function does not have to calculate this entry's mapped
// path, since this is calculated recursively from the parent).
// This function returns true if it had calculated the mapped path for
// this entry (and therefore also for child entries) and false if it 
// had not done so).

InternalRootQueryCalc.prototype.calcIntersectionGeneratingProjPath =
    internalRootQueryCalcCalcIntersectionGeneratingProjPath;

function internalRootQueryCalcCalcIntersectionGeneratingProjPath(queryId, entry)
{
    var childPathIds = [];

    for(var childQueryId in entry.children) {
        var childEntry = this.generatingProjs.get(childQueryId);
        if(childEntry.pathId)
            childPathIds.push(childEntry.pathId); 
    }

    // set the path ID
    var pathId = (childPathIds.length < 2) ? 
        undefined : this.indexer.qcm.getCommonPrefix(childPathIds);

    if(pathId == entry.pathId)
        return false; // nothing changed

    entry.pathId = pathId;

    if(!pathId) {
        // the entry had a path Id, but not any longer, clear all related fields
        if(entry.mappedPathId) {
            this.indexer.qcm.releasePathId(entry.mappedPathId);
            entry.mappedPathId = undefined;
        }
        if(entry.parent) {
            var parentEntry = this.generatingProjs.get(entry.parent);
            this.calcIntersectionGeneratingProjPath(entry.parent, parentEntry);
        }
        return true;
    }

    var mappedPathsCalced = false;

    if(entry.parent) {
        // set the parent's path ID, if not yet known
        var parentEntry = this.generatingProjs.get(entry.parent);
        if(!parentEntry.pathId) {
            mappedPathsCalced = 
                this.calcIntersectionGeneratingProjPath(entry.parent, 
                                                        parentEntry);
        }
    } 
    
    if(!mappedPathsCalced)
        // calculate the mapped path ID of this entry
        this.calcMappedPathId(queryId, entry);

    return true;
}

// Given the ID of a query calculation node, this function adds it to
// the 'modifiedGeneratingProjs' table.

InternalRootQueryCalc.prototype.addModifiedGeneratingProj =
    internalRootQueryCalcAddModifiedGeneratingProj;

function internalRootQueryCalcAddModifiedGeneratingProj(queryId)
{
    if(!this.modifiedGeneratingProjs) {
        this.modifiedGeneratingProjs = new Map();
        if(queryId !== 0 && this.terminalGeneratingProjNum == 0)
            // indicate that this was a selection at the start of the update
            this.modifiedGeneratingProjs.set(0, true);
    }

    this.modifiedGeneratingProjs.set(queryId, true);
}

////////////////////////////////////////////////////////
// Generating Projections Interface with Result Nodes //
////////////////////////////////////////////////////////

// Given the ID of a query calculation node, this function returns an array
// with the mapping of the projection path of this generating 
// projection node. Let g1,...,gn be the sequence of generating projections
// dominating the generating projection with the ID 'queryId', where
// gi is the direct generating projection parent of gi+1, g1 has no parent
// and gn is the generating projection with ID 'queryId'.
// The function then return the following array:
// [<mappedPathId(g1)>, <pathId(g1)>, <mappedPathId(g2)>, <pathId(g2)>, 
//                                    ...., <mappedPathId(gn)>, <pathId(gn)>]
// where pathId(gi) and mappedPathId(gi) represent the value of the 
// corresponding fields in the generatingProjs entry of gi.
// Note: <mappedPathId(g1)> should always be the root path ID. 
// If the given ID is not the ID of a generating projection node,
// this function returns undefined (this includes the case where the
// node is a selecion-projection with a parent generating projection node).
// If the query ID is zero, this function checks whether this query is
// a selection. If it is, the mapping [<root path>, <prefix projection path>]
// is returned.

InternalRootQueryCalc.prototype.generatingProjMapping = 
     internalRootQueryCalcGeneratingProjMapping;

function internalRootQueryCalcGeneratingProjMapping(queryId)
{
    if(queryId == 0)
        return (this.isProjection() ? 
                undefined : [this.indexer.qcm.getRootPathId(), 
                             this.prefixProjPathId]);
    
    if(!this.generatingProjs || !this.generatingProjs.has(queryId))
       return undefined;

    var entry = this.generatingProjs.get(queryId);
    if(entry.pathId == this.prefixProjPathId && entry.parent)
        return undefined; // selection-projection with parent, not generating

    var mapping = 
        entry.parent ? this.generatingProjMapping(entry.parent) : [];

    mapping.push(entry.mappedPathId);
    mapping.push(entry.pathId);

    return mapping;
}

// This function returns a Map object whose keys are the IDs of all terminal
// generating projections and under each ID stores the mapping array
// for that projection (see generatingProjMapping() for the format of this
// array). Selection-projections which are dominated by a generating 
// projection are not returned here (because they are not generating 
// projections, see definition in the introduction to this file). 
// If there are no terminal generating projections, this function 
// returns the 'selection mapping': the projection ID is zero and 
// the mapping maps the prefix projection
// path of the root query calculation node to the root path.
// If no query is yet defined, this returns undefined.

InternalRootQueryCalc.prototype.getGeneratingProjMappings = 
     internalRootQueryCalcGetGeneratingProjMappings;

function internalRootQueryCalcGetGeneratingProjMappings()
{
    var mappings = new Map();

    if(!this.isProjection()) {
        // this is a selection or another non-projection function
        mappings.set(0, 
                     [this.indexer.qcm.getRootPathId(), this.prefixProjPathId]);

        return mappings;
    }

    var _self = this;
    this.generatingProjs.forEach(function(entry, projId) {
        if(_self.isTerminalGeneratingProj(entry))
            mappings.set(projId, _self.generatingProjMapping(projId));
    });

    return mappings;
}

// This function returns the list of terminal generating projections
// of this root query calculation node. This is returned in the form
// of an array of the terminal generating projection query 
// calculation nodes. If the query is not a projection, an empty array
// is returned.

InternalRootQueryCalc.prototype.getTerminalGeneratingProjs = 
    internalRootQueryCalcGetTerminalGeneratingProjs;

function internalRootQueryCalcGetTerminalGeneratingProjs()
{
    var terminalProjs = [];

    if(this.generatingProjs) {
        var _self = this;
        this.generatingProjs.forEach(function(entry, projId) {
            if(_self.isTerminalGeneratingProj(entry))
                terminalProjs.push(entry.queryCalc);
        });
    }

    return terminalProjs;
}

// This function should be called with the projection ID of one of the
// generating projections stored in the 'generatingProjs' table and
// the ID of a result registered to this root query calculation node.
// This function then returns an array with the matches returned by the
// getProjMatches() function of the relevant projection node for the given
// result ID.

InternalRootQueryCalc.prototype.getTerminalProjMatches =
    internalRootQueryCalcGetTerminalProjMatches;

function internalRootQueryCalcGetTerminalProjMatches(resultId, projId)
{
    if(projId === 0)
        return this.getMatches();
    
    if(this.generatingProjs === undefined)
        return [];

    var proj = this.generatingProjs.get(projId);

    if(proj === undefined)
        return [];

    return proj.queryCalc.getProjMatches(resultId);
}

// this function returns an array which is a subset of the input array
// <element IDs> such that the returned array only contains those
// elements in <element IDs> which are also in the array returned by
// getTerminalProjMatches(<projection ID>).

InternalRootQueryCalc.prototype.filterTerminalProjMatches =
    internalRootQueryCalcFilterTerminalProjMatches;

function internalRootQueryCalcFilterTerminalProjMatches(resultId, projId,
                                                        elementIds)
{
    if(projId === 0)
        return this.filterMatches(elementIds);
    
    if(this.generatingProjs === undefined)
        return [];

    var proj = this.generatingProjs.get(projId);

    if(proj === undefined)
        return [];

    return proj.queryCalc.filterProjMatches(elementIds, resultId);
}

// This function notifies the result nodes making use of this root query
// calculation node of changes to the terminal generating projection 
// structure (since the last notification).
// The 'updateTerminalProjs()' function of each result node is 
// called with an object whose attributes are the IDs of all terminal
// generating projections which had changed (this includes nodes which 
// are no longer terminal generating projections, modified terminal 
// generating projections and new terminal generating projections).
// Under each such attribute appears the new mapping of this generating 
// projection (see generatingProjMapping() for the exact format).
// This is undefined for nodes which are no longer terminal generating 
// projection nodes).
// A selection is represented as a projection with ID 0 and a mapping
// mapping the prefix projection path to the root path.
// In addition to notifying the result nodes, it also checks whether
// any result nodes are already active. If there is such a result node,
// any new generating terminal projection is suspended (it will be unsuspended
// at the end of the query refresh process).
// This function is also called when no generating projections changed
// (but possibly some other structural change took place). The function
// then calls the updateTerminalProjs() function of the result nodes
// with an undefined argument. This gives the result nodes a chance to
// check whether any structural change took place which may require
// them to update in some way (e.g. a change between a pure and a non-pure
// projections while the projection query calculation node itself did not
// change).

InternalRootQueryCalc.prototype.notifyModifiedGeneratingProjs = 
     internalRootQueryCalcNotifyModifiedGeneratingProjs;

function internalRootQueryCalcNotifyModifiedGeneratingProjs()
{
    if(!this.modifiedGeneratingProjs) {
        // no generating projections changed, but there may be some other
        // structural change, just notify the result nodes of this possibility
        this.results.forEach(function(queryResult, resultId) {
            queryResult.updateTerminalProjs(undefined);
        });
        return;
    }

    // create mappings of modified terminal projections (undefined
    // mapping means that the node is no longer a terminal generating
    // projection).

    var mappings = new Map();

    var _self = this;
    this.modifiedGeneratingProjs.forEach(function(t, projId) {
        mappings.set(projId, _self.generatingProjMapping(projId));
    });

    // notify the result objects of the new mappings

    var hasActiveResult = false;

    this.results.forEach(function(queryResult, resultId) {
        queryResult.updateTerminalProjs(mappings);
        if(queryResult.isActive())
            hasActiveResult = true;
    });

    if(hasActiveResult && this.generatingProjs !== undefined) {
        // if some result nodes are already active, the new terminal 
        // projections added must have their projection matches suspended
        // so that they can be refreshed at the end of the refresh process.
        var _self = this;
        this.modifiedGeneratingProjs.forEach(function(t,projId) {
            var projEntry = _self.generatingProjs.get(projId);
            if(projEntry === undefined || 
               !_self.isTerminalGeneratingProj(projEntry))
                return;
            projEntry.queryCalc.suspendProjection();
        });
    }

    this.modifiedGeneratingProjs = undefined;
}
