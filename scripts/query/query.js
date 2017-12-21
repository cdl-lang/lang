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

// This file implements the object which compiles a query and generates
// specific query calculation instances for this query when it is
// applied to data.
//
// A query is defined by an indexer, a path ID and one or more
// data element IDs (whose path must be a prefix of (or equal to) the 
// given path ID). However, these data elements are not allowed to have 
// children whose path is a proper prefix of the path ID defining the 
// root of the query. This allows, among other things, the query description 
// to be the result of a query.
// We write Q(I,P,D) for the query description defined by the indexer
// I, the path P and the set of data elements D. We write T(I,P,D) for
// the set of terminal data nodes (data nodes with a simple value) in
// I, at a path equal to or extending P and dominated by one of the
// data elements in D.
//
// The indexer, path and data elements defining the query may change 
// dynamically. <Query>.refreshIndexerAndPaths() is called to 
// set and change the indexer and path and addMatches() and removeMatches()
// are called to update the data elements defining the roots 
// of the query description. This is carried out by the FuncResult
// mechanism (see 'Source of the Query Description' below). 
//
// The query object registers on the indexer and receives updates
// adding and removing nodes from the set T(I,P,D). These updates
// are in the form of tuples [<path ID>, <data element ID>, <value>]
// (where the data element ID is a lowest data element on the path
// and therefore the two together define a unique data node).
// The <value> is an object { type: <type>, key: <key> } where 
// the key is either a simple value or a range object.
//
// Given the set T = T(I,P,D), the query tree represents union, intersection,
// negation and simple query nodes. An intersection query 
// node is a collection of simple, negation and union query nodes 
// while a union node is a collection of intersection, negation and simple 
// nodes. A negation node is a collection of intersection and simple nodes. 
// A simple node defines a path and one or more simple values at that path.
//
//
// Source of the Query Description
// ===============================
//
// The Query object inherits the FuncResult class and implements the 
// 'composed' interface required by this base class, that is,
// the part which allows it to take another FuncResult object as 
// a data result object and receive from it an indexer, path and 
// list of data element IDs which are the roots of the query description.
// For the purpose of this interface, the query object is considered
// active* when at least one root query calculation node is registered to it.
//
// Algorithm
// =========
//
// Collecting Updates
// ------------------
//
// The query object maintains a 'queryTree' (see the 'Object
// Structure' section for full details) which is a table indexed by
// data element IDs.  One of these entries has a virtual data element
// ID of 0, which is the root of the query structure.  We will refer
// to these as the entries of the query tree table.  Under each data
// element we store a list of paths and under each such path either a
// terminal key or a list of data element IDs, which we will refer to
// as the dominated data elements. Under each dominated data element a
// terminal key may sometimes be stored. If not, the dominated data
// element entry carries no meaningful value and simply stores 'true'.
// Each entry in the query tree table may also carry a field 'negationId'
// which stores a data element ID. This the indicates that the node
// represented by that entry is negated (the data element ID stored under
// negationId represents the negation node dominating it).
//
// The structure of the table is:  
//
// queryTree: <Map>{
//     <data element ID>: {
//          negationId: <data element ID>
//          paths: <Map>{
//              <path ID>: {
//                  type: <terminal value type>,
//                  key: <simple value or range object or negation object>
//                  queryCalcs: <Map>{
//                      <root ID>: <query calculation node>,
//                      .....
//                  }
//              }
//              //   or
//              <path ID>: {
//                   number: <number of data elements below> // xxxx can be removed
//                   dominated: <Map>{
//                       <dominated data element>: true | 
//                              {
//                                 type: <terminal value type>,
//                                 key: <simple value or range object
//                                       or negation object>
//                                 queryCalcs: <Map>{
//                                     <root ID>: <query calculation node>,
//                                     .....
//                                 }
//                              }
//                       .........
//                   },
//                   numSimpleValues: <number>,
//                   unionQueryCalcs: <Map>{
//                       <root ID>: <query calculation node>,
//                       .....
//                   }
//                   simpleQueryCalcs: <Map>{
//                       <root ID>: <query calculation node>,
//                       .....
//                   }
//              }
//         }
//         childCount: <Map>{ // used to determine the 'has sibling' property
//              <path ID>: <number of child data elements at this path>,
//              ......
//         },
//         queryCalcs: <Map>{
//              <root ID>: <query calculation node>,
//              .....
//         }
//     }
//     .........
// }
//
// When a { type: <>, key: <> } entry is stored under a path ID, it 
// represents a simple query while a list of dominated data elements
// represents a potential union node. If the node has a 'negationId'
// field, this field gives the ID of the negation node dominating it.
// (all this will be explained in more detail below).
//
// The query is compiled by adding (and removing) terminal nodes.
// A terminal node is given by a path, the lowest data element
// above it and the terminal value: <p, d, v>. v is an object holding
// the type of the value and its key: { type: <type>, key: <key> }.
// <key> is usually either a simple value or a range key object.
// The negation node is also received by such an update, whose 
// value has type "negation" and its key has the value 0 (this value 
// is meaningless). This update does not contain the information of 
// which nodes are being negated by this negation node. This is 
// implied structurally: data elements at path p which are direct children
// of d are negated by the negation value at <p,d>.
//
// In all cases, the update <p, d, v> is stored in the entry of d by 
// storing v under p. In case of a negation value, this will result in
// a search for existing negated nodes (which were already added to the 
// structure of the query). These are then marked as negated and added
// to the list of negated nodes stored under the entry for <p,d>
//
// We then consider the update <p,d,v>. This update is propagated up
// the chain of data elements dominating d, until a data element is reached
// whose path is equal or shorter to the path defining the query.
// Then, the update is propagated one last time to the special data
// element entry with the ID 0. This virtual element ID is considered
// the parent of top data elements of the query and represents the
// root of the query.
//
// As long as we have not reached the top, the update <p,d,v> must
// be propagated up the parent chain of d. The update <p,d,v>
// may, however, be modified before being propagated.
//
// Having stored <p,e,v> under d (at the first step, e == d but afterwards, 
// this may not hold, see below), we now need to propagate it further
// to P(d) (unless d is already a top data element). At every step in 
// the propagation, the propagated triple <p,e,v> must satisfy the condition
// that if v is a specific value (and not 'true') then <p,e> must specify
// uniquely the data node at which v is stored (p must be the path of this
// data node and e must be a data element node such that there are no 
// lower data elements dominating v which have siblings). Which update
// is being propagated to P(d) depends on d and on the entry for 
// p,e under d (which we write as v(d,p,e)) where, in case e = d is
// the value stored under p in the entry for d:
// 1. If the entry of d stores multiple paths under it but d has 
//    no siblings (a sibling of a data element is another data element at 
//    the same path and with the same parent data element), then 
//    if d == e then <p,d,v(d,p,e)> is propagated to P(d) 
//    and otherwise <p,d,true> is propagated to P(d).
// 2. If the entry of d stores only a single path under it but d has 
//    siblings then if p == p(d) (which implies e == d) and v(d,p,e) 
//    is a simple value (that is, not a projection or negation) then 
//    <p(d),e,v(d,p,e)> is propagated and, otherwise, <p(d),e, true> 
//    is propagated to P(d), where p(d) is the path of the data element d.
// 3. If the entry of d stores multiple paths under it and d has 
//    siblings, the pair <p(d),d,true> is propagated to P(d) (here, v 
//    is replaced by 'true', if it wasn't 'true' before).
// 4. When an update is propagated to a negation node (that is, to
//    the data element with ID 'negationId') the propagation stops
//    (the negation node is not updated - the data element should already
//    be stored in the negation value of that data element under the path
//    of the node being propagated).
// 5. When the update <p,e,v> is a negation update (the 'type' of v
//    is 'negation') then for any e' negated by <p,e,v> any previous
//    propagation must be removed. If the update removes the negation,
//    then each e' negated by it must be propagated to its parent.
//    The negation value under e and path p is updated. This value is 
//    propagated further just like any other terminal value.
//
// In case none of the above holds, we simply propagate <p,e,v> ==
// <p,e,v(d,p,e)>. This implies that given d, P(d), p, e and v(d,p,e) 
// the propagation of each entry stored in the entry of d can be determined.
//
// Once we have reached in this process the virtual root data element
// with ID 0, the propagation stops.
//
// As a result of the propagation rules, the following always holds:
// 1. The original update value is propagated as long as the propagated
//    path and data element are equal to those of the original value.
// 2. If a data element d has siblings, it is only propagated with one 
//    path and this is also the path with which all its siblings are
//    propagated. This means that such siblings only add a single 
//    path under the entries of dominating data elements.
// 3. If multiple data elements are dominated by a parent data element
//    under different paths, these data elements are not propagated
//    and only the parent data element is dominated with all these
//    paths.
// 4. Combining 1 and 2, only the data element and its path are propagated,
//    completely hiding the updates the data element received.
// 5. When a data element has no siblings and stores only a single
//    path in its entry, it is transprent: the updates go through it 
//    unchanged. Indeed, such a data element could have been omitted
//    from the structure without changing the query.
//  
// At the end of this process, data elements with multiple paths under
// them represent intersection nodes in the query, while paths with
// multiple data elements under them represent union nodes. The
// propagation rules ensure that intersection nodes hide the union
// nodes under them (by propagating the single data element of the
// intersection node instead of the multiple data elements of the
// union node dominated by it) and union nodes hide the intersection
// nodes under them (by propagating only the single path of the union
// node and not the multiple paths of the intersection node under it).
//
// In addition, the propagation rules ensure that when multiple intersection
// nodes dominate each other (without an intervening union node)
// the top of these nodes immediately carries all the paths for the
// full intersection (thus resulting in only one intersection being
// created). This is the result of the rule that data elements without
// siblings allow paths to be propagated through them without change.
//
// Similarly, when multiple union nodes dominate each other (without 
// an intervening intersection node) the top of these nodes (the shortest
// path) immediately carries all the lowest data elements in these
// union. This is the result of the rule that data elements with a single
// path under them allow data elements to be propagated though them without
// change. 
//
// Negation nodes are seen as terminal nodes by the nodes above them
// (because they propagate as <d,p,negation value> where <d,p> define the 
// negation node and the negation value is the collection of nodes 
// negated by this node). When the system comes to insert them as nodes into 
// the query, their value is used. This value is the list of data elements
// which are dominated by the negation node. The process therefore creates
// negation nodes and continues the query generation process with the 
// data elements stored in the negation value.
//
// Incremental Update
// ------------------ 
//
// As the structure of the query can change incrementally, we need to
// be able to update the structures described above incrementally.
// Given a set of terminal updates (removal of a terminal, addition of
// a terminal or the replacement of the value of a terminal) we the update
// proceeds as follows:
// 1. We first update the entries of the data elements directly dominating 
//    these terminals. At this stage, data elements are added or removed from
//    the query tree. In addition, removed propagations are immediately
//    propagated. This includes both propagations removed as a result
//    of the removal of a terminal or propagations which may have to be 
//    re-propagated as a result of changes in the propagation conditions
//    (due to the addition/removal of paths or data element siblings).
//    Terminals added or replaced and propagations which need to be 
//    re-propagated are queued for propagation.
// 2. The propagations collected in the first step are stored in a max-heap 
//    (the top node holding the maximal value) based on the path IDs
//    of the element IDs of the entries under which they were updated. In
//    this way we ensure that all updates are made on the entry of a
//    data element before proceeding to its parent data element. In
//    this way the path number and 'has siblings' properties are
//    determined before the propagation is made and there is no need
//    to recalculate a propagation when these properties change.
// 3. We pop propagations from the top of the heap and perform one 
//    propagation step at a time. If the propagtion needs to be propagated
//    again, it is again pushed into the heap.
//    The queue may contain updates to be propagated which are no longer
//    in the query tree. Such queued propagations are ignored (these updates
//    may have been removed between the time they were queued for propagation
//    and the time the propagation has been scheduled).
//
// The Query Calculation Tree
// --------------------------
//
// The information stored by the process decribed above allows us to
// construct the query calculation tree. In principle, we need to
// construct an intersection query calculation node for data
// element entries storing multiple paths under them and union query
// calculation nodes for path entries storing multiple data elements
// under them. However, as explained above, if an intersection node
// directly dominates another intersection node or a union node
// directly dominates a union node, we only want to create the top
// node and let it dominated directly the nodes of the other kind
// (intersection, negation or simple nodes for union nodes and union,
// negation or simple nodes for intersection nodes). This can easily
// be done because update propagation implies that the information stored 
// in the top intersection or union node directly points at the dominated 
// nodes we need.
//
// The test to determine whether a query calculation node needs to be
// created at a certain data element entry (intersection query calculation
// node) or path entry (negation, union or simple query calculation node)
// is whether the full information available at that entry for the
// construction of the query calculation node can be propagated to the 
// dominating node. If not all the information needed can be propagated,
// a query calculation node needs to be created. This tests applies also
// to the root data elements of the query, if there is more than one 
// such root data element, even though no propagation
// actually takes place for those nodes (because they have no parent).
// When such multiple root data elements exist, a union query calculation
// node is created for them and therefore propagation through these nodes
// needs to be considered. The test is then applied to these nodes as if they 
// had a parent (note that in this case the 'has siblings' property is
// always true, by definition).
//
// For a data element entry, if all the paths under the entry may 
// be propagated (which means that the data element has no siblings),
// then no query calculation node needs to be assigned to that entry.
// In other words:
//
//    An intersection query calculation node is assigned iff the element
//    entry has multiple paths and either has siblings or is negated.
//
// For a path entry (path under a data element entry), if the path entry
// carries a value, there is no need to create a query calculation
// node iff that value is propagated, which is iff the data element
// has no siblings or the path of the data element is equal to the 
// path of the entry. That is:
//
//    A query calculation node is assigned to a path entry carrying
//    a single value iff the data element has siblings ; and the element
//    entry has multiple paths or the path of the data element is not equal 
//    to the path of the path entry or the element entry is negated.
//
// If the path entry carries dominated data elements, a union query calculation
// node is not created iff the data elements are propagated. However, a
// simple query calculation node may also be created at this node if
// some of the dominated data elements carry values (not 'true') under them. 
// This means that the same path node may carry several query calculation nodes:
// a union node (for all dominated nodes, whether they carry a value
// under them or not) and a simple node, for those dominated data elements
// which directly carry a value under their entry. In addition, for 
// every negation and projection value appearing under a dominated data 
// element, a negation/projection query calculation node needs to be created.
// The rules are therefore:
//
//    A union query calculation node is created at a path entry if 
//    this is not the only path entry in the element entry and it
//    has more than one dominated entry and at least one dominated element 
//    entries which do not carry a value (or carry a negation or projection 
//    value).
//
//    A simple query calculation node is created at a path entry carrying
//    dominated data elements iff this is not the only path entry in 
//    the element entry or the element has siblings ; and there are some 
//    dominated data element entries carrying a value under them, which is 
//    not a negation or projection.
//
//    A negation/projection query calculation node is created for every 
//    dominated data element entry carrying a negation/projection value 
//    under it if the element entry has more than one path or the 
//    element has siblings.
//
// Active Data Elements
// --------------------
//
// We define 'active data elements' to be data element IDs for which query 
// calculation nodes may be assigned. This includes the following 
// possibilities:
// 1. Query calculation nodes are assigned to the element entry (an intersection
//    query calculation node).
// 2. Query calculation nodes are assigned to the single path entry under
//    the element entry.
// 3. The element is a dominated element in a path entry (of a higher
//    higher element entry) such that query calculation nodes are assigned
//    to that dominated entry or such that the dominated entry carries
//    a simple value and the path entry carries query calculation nodes.
//
// Any element ID appearing in a negation value and any dominated element ID 
// appearing in a path entry to which query calculation nodes are assigned,
// must be an active element. Because of the propagation rules, given
// the element ID of an active data element, the query calculation 
// nodes can be found as follows:
// 1. First, check whether the element entry for that element ID has 
//    query calculation nodes assigned to it.
//    If that failed, the entry must have a single path under it.
// 2. Check whether the single path entry under the element entry 
//    has query calculation nodes assigned to it.
// 3. If the path entry holds a single dominated element, check whether
//    that dominated entry has a query calculation node assigned to it
//    (this can happen only under if the element entry is negated).
// 4. Using the single path in the element entry, loop up the parent
//    chain and look for the same path's entry in those parent. This
//    path entry has a dominated element entry for the element we are
//    looking for. Look for the query calculation nodes on that entry.
//    If they do not exist, check for simple query calculation nodes
//    defined on the path entry. If this too does not exist, continue
//    to the parent element entry.
//    This step does not apply to negated elements, as they do not
//    propagate upwards.
//    Note that in this step there is no need to check which type of
//    value the element carries: the first query calculation nodes
//    we find (by searching in the order specified) is the right one.
//
// Query Calculation Update Process
// --------------------------------
//
// The rules above allow the algorithm to determine locally for every 
// data element entry and path entry whether query calculation nodes
// need to be assigned to it. Because of the identification of the query 
// calculation nodes with data elements and or <data element, path> pairs 
// in the structure of the query description, and because the data element 
// tree structure can only be modified by adding and removing data elements, 
// but the paths and parents of existing data elements cannot change, it 
// holds that the query calculation node structure can only change by: 
// 1. A node being added (possibly inserted between existing nodes)
// 2. A node being removed
// 3. The terminal value(s) assigned to a query calculation node change
//    (in case of multiple values, they may be added and removed).
// This means that no structure changes are possible which involve only
// a change in the structure of existing query calculation nodes. Wherever
// the structure changes, a query calculation node needs to be added
// or removed or a value needs to change.
//
// Because of the close link between the decision whether to assign
// a query calculation node and the update propagation properties, 
// it is possible to update the query calculation node assigned to a
// given element entry or path entry when the updates from that 
// element entry or path entry are propagated to the parent.
//
// When terminal values and propagations are removed, the corresponding
// values are removed from the query calculation nodes (at the entry
// at which the removal took place). When an element entry or path entry
// is removed, it is first emptied, which means that the query calculation
// node at that entry was also emptied, implying that it can be discarded
// (even if the element or path entry is created again within the same
// update cycle, there is no reason to keep the old entry, as all its
// information has been discraded).
//
// When the propagation process arrives a a certain element entry and
// path entry (that is, all values of that entry were already updated
// and now need to be propagated) it is already possible to determine
// whether query calculation nodes need to be assigned to that entry
// (and what kind of query calculation nodes). Moreover, whenever there
// is need to add query calculation nodes to entries which did not have any
// before or to remove query calculation nodes from entries which did have
// them, it is guaranteed that the node will be reached in the update
// propagation process (because it is the propagation properties which
// determine whether query calculation nodes need to be assigned).
//
// In addition, any terminal value which need to be updated on the query
// calculation nodes are coded in the queuedByPathId table (every value
// which was added or changed will be queued for propagation).
//
// The query calculation nodes are allowed to queue the changes they
// receive and wait with thier application until they receive a signal
// from the query object. This signal is received at the end of the
// propagation process.
//
// The initial construction of the query calculation node structure
// (that is, for root query calculation nodes which were added after or
// during the query update cycle), takes place in exactly the same way
// as described here, except that all element entries and path entries
// are traversed and all terminal values need to be set on the relevant
// query calculation nodes. 
//
// Object Structure
// ================
// 
// {
//     indexer: <indexer>,
//     rootPathId: <path ID>,
//     rootElementIds: <Map>{
//        <element ID>: true,
//        .....
//     }
//     monitorId: <monitor ID allocated by the indexer>
//
//     id: <ID for this query>,
//     pendingDestroy: undefined|true
//     destroyed: undefined|true
//
//     lockedActive: undefined|<Map>{
//         <lock name>: true,
//         .....
//     }
//
//     queryTree: <Map>{
//         <data element ID>: {
//              negationId: <data element ID>
//              paths: <Map>{
//                  <path ID>: {
//                      type: <terminal value type>,
//                      key: <simple value or range object or negation object>
//                      queryCalcs: <Map>{ //simple, negation or projection
//                          <root ID>: <query calcualtion node>,
//                          .....
//                      }
//                  }
//                  //   or
//                  <path ID>: {
//                       number: <number of data elements below> // xxxx can be removed
//                       dominated: <Map>{
//                           <dominated data element>: true | 
//                                {
//                                    type: <terminal value type>,
//                                    key: <simple value or range object
//                                          or negation object>
//                                    queryCalcs: <Map>{
//                                       // negation and projection
//                                       <root ID>: <query calcualtion node>,
//                                       .....
//                                     }
//                                }
//                           .........
//                       },
//                       numSimpleValues: <number>,
//                       unionQueryCalcs: <Map>{
//                           // union query calculation nodes 
//                           <root ID>: <query calculation node>,
//                           ......
//                       },
//                       simpleQueryCalcs: <Map>{
//                           // simple query calculation nodes 
//                           <root ID>: <query calculation node>,
//                           ......
//                       }
//                  }
//              },
//              childCount: <IntHashMapUint>{
//                  <path ID>: <number of child data elements at this path>,
//                  ......
//              }
//              queryCalcs: <Map>{  // intersection query calculation nodes
//                  <root ID>: <query calculation node>,
//                  .....
//              }
//         }
//         .........
//     }
//
//     numTerminals: <number>,
//     numProjTerminals: <number>,
//
//     pendingUpdates: false|true
//     propagationHeap: <heap>
//     queuedByPathId: <Map>{ 
//         <data element path ID>: <Map>{
//              <element ID>: <Map>{
//                  <update path ID>: <Map>{
//                      <dominated element ID>: true,
//                     ......
//                  }
//                  // or
//                  <update path ID>: true
//              }
//              .....
//         }
//         .....
//     }
//
//     rootQueryCalcs: <Map>{
//         <root ID>: <root query calculation node>
//         .......
//     },
//
//     pendingAddedRootQueryCalcs = <Map>{
//         <root ID>: <root query calculation node>
//         .......
//     }
// }
//
// indexer: this is the indexer storing the query description which 
//     is constructed by this Query object. This may be changed by the
//     data result object. The function refreshIndexerAndPaths() is
//     then called.
// rootPathId: this is the path (relative to the root of the indexer)
//     at which the root of the query is found. The function 
//     refreshIndexerAndPaths() is then called.
// rootElementIds: this is a list of data element IDs in the indexer
//     which, together with the path ID, define the roots of the sub-trees
//     which store the query description. 
// monitorId: when this query object registers as a sub-tree monitor to
//     the indexer, it receives a monitor ID (allocated by the indexer).
//     This ID is stored here, as it is required for subsequent interfacing
//     with the indexer. This is set to undefined when the query object is
//     unregistered from the indexer.
// 
// id: a unique ID for this query. This ID must be unique among all objects
//     which are used as queries.
// pendingDestroy: this flag is set to true when the destroy function is
//     called but there still are some root query calculation nodes registered
//     to this query. This then waits with the destruction until all 
//     root query calculation nodes are removed.
// destroyed: this flag is set to true when the destroy process begins, to
//     indicate to removal functions called within the destroy function that
//     the object is about to be destroyed and there is, therefore, no need
//     to update the object.
//
// lockedActive: this field can store a list of lock names (added by calling
//     'lockActive()' and removed by calling 'unlockActive()'). As long as
//     the list of locks is not empty, the query is active, regardless
//     of whether any root query calculation nodes are registered to it.
//     When the list of names becomes empty, the table is destroyed and
//     'lockedActive' is set to undefined. The query is then active iff
//     there are some root query calculation nodes registered to it.
//
// queryTree:
//     this field stores a representation of the structure of the
//     query. As terminal nodes are added or removed from the query 
//     description, they are added to this table and propagated according
//     to the algorithm described above. 
//     Note that all paths stored here are relative to the root of the
//     query description and not relative to the root of the indexer.
//     This means that when looking up in the indexer data element table
//     the path of a data element, this too needs to be converted 
//     to be relative to the root of the query description.
//
//     numSimpleValues: this field appears only if the 'dominated' field
//         is used (meaning that dominated element IDs are stored under
//         the path entry). This counter then counts the number of dominated
//         entries which hold a simple value (not 'true' but also not
//         a negation or projection value).
//     
//     The 'childCount' table stores the number of direct child data elements
//     of this data element, under each path. This count only includes
//     data elements added to the queryTree table (every new data element
//     added to the query tree increases the count under the
//     relevant path in its parent entry). These counts are then used to
//     determine the 'hasSibling' property (which is, therefore, relative
//     to the current state of the query tree and not relative to the 
//     current state of the indexer).
//
//     queryCalcs/unionQueryCalcs/simpleQueryCalcs:
//
//     In several places in the queryTree structure, query calculation nodes 
//     may be stored. Under each such field (instance of queryCalcs, 
//     unionQueryCalcs or simpleQueryCalcs) the query calculation nodes
//     representing a single node in the query structure are stored.
//     The list holds one entry for each root query calcualtion node registered
//     to the query. Each query calculation node is then stored under the 
//     <root ID> which is the ID of the root query calculation node it
//     belongs to.
//
// numTerminals: this is the number of terminal nodes in the query tree.
//     This includes all simple value nodes which are part of the query,
//     including range and projector nodes. It also includes all empty
//     negation nodes (that is, nodes n() where there is no negated query
//     inside the n()). This number is continuously updated as elements
//     are added and remove and does not wait for the update propagation step
//     to take place. Therefore, this may temporarily differ fro the structure
//     as refelected in the query calculation node structure induced
//     by this query (once the updates are propagated, these two should agree).
// numProjTerminals: this is the number of terminals of type 'projector'
//     in the query. This number is continuously updated as elements are added
//     and remove and does not wait for the update propagation step
//     to take place. Therefore, this may temporarily differ fro the structure
//     as refelected in the query calculation node structure induced
//     by this query (once the updates are propagated, these two should agree).
//
// pendingUpdates: this is set to true when a terminal value is added
//     or removed from the query tree. This is set back to undefined
//     after all queued changes have been propagated and query calculation
//     nodes were assigned.
// propagationHeap: this is a heap structure, which stores data elements
//     which have entries in the queryTree table together with the path ID
//     of these data elements. It is used to schedule propagations out of
//     the queuedByPathId table so that the the entries are updated in
//     decreasing order of path ID and element ID. This ensures
//     that the updates for all data elements dominated by another data element
//     take place before the entry for the dominating data element is updated.
// queuedByPathId: list of queued update propagations, indexed by the path ID
//     of the data element from whose entry these updates need to be 
//     propagated. Under every path ID there is a list of data elements
//     (which have this path as their path, relative to the query 
//     description). Under that, the updates which need to be propagated
//     are registered. If a path ID with a value 'true' is stored, then all
//     updates for that path must be propagated. Otherwise, there is 
//     a list of dominated data element IDs and only updates for these
//     dominated data element IDs need to be propagated.
//     This table may refer to updates which are no longer in the query tree.
//     In this case, they must be ignored.  
//
// rootQueryCalcs: this is the list of all root query calculation
//     nodes which were registered to this Query. Each node is stored in
//     the table under a unique ID (which is simply the ID of that 
//     root query calculation node). Each of these root query calculation
//     nodes is assigned a query calculation node structure based on 
//     the query tree stored in queryTree.
// pendingAddedRootQueryCalcs: this is a table to temporarily store
//     root query calculation nodes which are added during an update
//     cycle of the query description. These additions are then queued 
//     in this table and actually carried out only at the end of 
//     the update cycle.
// 

// %%include%%: "../utils/heap.js"
// %%include%%: "simpleQueryCalc.js"
// %%include%%: "projectionQueryCalc.js"
// %%include%%: "unionQueryCalc.js"
// %%include%%: "negationQueryCalc.js"
// %%include%%: "trueQueryCalc.js"
// %%include%%: "intersectionQueryCalc.js"
// %%include%%: "internalRootQueryCalc.js"
// %%include%%: "funcResult.js"
// %%include%%: "negationKey.js"

// for debugging

// %%include%%: "debugInternalTo.js"

inherit(Query, FuncResult);

// Constructor

function Query(internalQCM)
{
    this.FuncResult(internalQCM);

    this.rootElementIds = new Map();

    this.lockedActive = undefined;
    
    this.queryTree = new Map();

    this.numTerminals = 0;
    this.numProjTerminals = 0;
    
    this.rootQueryCalcs = new Map();

    this.pendingUpdates = false;
}

// This function should be called when the Query is no longer needed.
// If there are still root query calculation nodes registered to this
// query object, the query object cannot be destroyed. Instead, the
// destruction is suspended until the last root query calculation node
// is removed.

Query.prototype.destroy = queryDestroy;

function queryDestroy()
{
    if(this.rootQueryCalcs.size > 0) {
        // cannot destroy yet, must wait until all root query calculation
        // nodes are removed.
        this.pendingDestroy = true;
        return;
    }

    // indicate to functions called below that this happens inside a destroy
    this.destroyed = true;

    // remove registration from indexer
    this.detachFromIndexer();

    this.FuncResult_destroy();
}

// Lock the query in an active state. Each lock has a name, so that several
// modules can independently lock the activation of the query. As long as there
// is at least one lock, the query is active. The query becomes active (if it
// hasn't been active before) and will remain active, regardless of
// the number of root query calculation nodes assigned to it, until
// the last lock is removed.

Query.prototype.lockActive = queryLockActive;

function queryLockActive(lockName)
{
    if(this.lockedActive) {
        if(!this.lockedActive.has(lockName))
            this.lockedActive.set(lockName, true);
        return; // already locked
    }

    var wasActive = this.isActive();
    
    this.lockedActive = new Map();
    this.lockedActive.set(lockName, true);
    if(!wasActive)
        this.activated();
}

// This function removes any lock set on the active state of the query.
// Once this lock is removed, whether the query is active depends
// on whether any root query calculation nodes are assigned to the query
// (if there are any, it means there are active function result nodes
// making use of this query). If after removing the lock the query is
// no longer active, this function deactivates this query.

Query.prototype.unlockActive = queryUnlockActive;

function queryUnlockActive(lockName)
{
    if(this.lockedActive === undefined)
        return; // no lock to remove

    if(!this.lockedActive.has(lockName))
        return; // lock not found

    if(this.lockedActive.size > 1) {
        // not last lock
        this.lockedActive.delete(lockName);
        return;
    }

    // no more locks left
    
    this.lockedActive = undefined;

    if(!this.isActive())
        this.deactivated();
}

/////////////////////////////////////////
// Access to Compiled Query Properties //
/////////////////////////////////////////

// This function returns true if the query tree contains at least one
// projector node.
// Note that this property reflects the current state of the terminal nodes
// of the query tree. If the update propagation did not yet take place, this
// may differ from the same property as determined by the query calculation
// node trees constructed for this query. After the propagation of updates,
// these two should agree.

Query.prototype.isProjection = queryIsProjection;

function queryIsProjection()
{
    return this.numProjTerminals > 0;
}

// This function returns true if the query tree contains exactly one
// terminal and that terminal is a projector.
// Note that this property reflects the current state of the terminal nodes
// of the query tree. If the update propagation did not yet take place, this
// may differ from the same property as determined by the query calculation
// node trees constructed for this query. After the propagation of updates,
// these two should agree.

Query.prototype.isPureProjection = queryIsPureProjection;

function queryIsPureProjection()
{
    return (this.numProjTerminals == 1 && this.numTerminals == 1);
}

////////////////////////////////////////
// Interface Query Description Source //
////////////////////////////////////////

// The functions below implement the interface required from this object
// as a FuncResult object which can be composed with another function
// result object (which provides it with its description).

// The query description cannot be read from a source which is 
// a multi-projection (this needs to be hidden behind a merge indexer).

Query.prototype.supportsMultiProj = querySupportsMultiProj;

function querySupportsMultiProj()
{
    return false;
}

// The query object is active if there are any root query calculation nodes
// registered to it.

Query.prototype.isActive = queryIsActive;

function queryIsActive()
{
    return this.lockedActive !== undefined || this.rootQueryCalcs.size > 0;
}

// In addition to the standard (FuncResult) deactivation, we here also
// need to detach from the indexer (so as not to receive additional
// updates).

Query.prototype.deactivated = queryDeactivated;

function queryDeactivated()
{
    if(this.isActiveStar())
        return;

    this.detachFromIndexer();

    this.FuncResult_deactivated();
}

// This function is called when the indexer and/or the path inside the indexer
// where the query description is stored change. This is called by 
// by the data result object defining the query description source
// when its dominated indeer or path changes and is also called when the
// data result object is replaced. 
// If this is called when a previous indexer and path pair was already set, 
// this function first detaches from the existing path. The function then
// registers to the new indexer and path as a sub-tree monitor.
// Later, when addMatches() is called with the specific data element IDs
// identifying the data nodes (at the path) which are the root(s) of the
// query description, this object will register itself as a monitor
// on these specific sub-trees. 

Query.prototype.refreshIndexerAndPaths = queryRefreshIndexerAndPaths;

function queryRefreshIndexerAndPaths()
{
    // get the new indexer and path
    var indexer = this.dataObj ? this.dataObj.getDominatedIndexer() : undefined;
    var rootPathId = 
        this.dataObj ? this.dataObj.getDominatedProjPathId() : undefined;

    if(this.indexer == indexer && this.rootPathId == rootPathId)
        return; // nothing changed

    // detach from a previous indexer, if any
    this.detachFromIndexer();

    // set the new indexer and path ID
    this.indexer = indexer;
    this.rootPathId = rootPathId;
    
    if(this.indexer === undefined || this.rootPathId === undefined)
        return; // not yet defined, cannot attach

    // attached to the given indexer and path
    this.monitorId = this.indexer.addSubTreeMonitor(this.rootPathId, this);
}

// this function is called after a new data object has been set.
// It should pull the matches from the new data object and add them 
// as roots of the query description. If 'indexerAndPathChanged' is true, 
// either the indexer or the root path changed and the function 
// 'refreshIndexerAndPaths()' was called just before
// this function. In this case, all matches of the new data result object
// need to be added. If this is false, the indexer and path did not change.
// In this case, the function is also provided with the old data result
// object (which was just removed as the source of the query desscription).
// The function then fetches both the new and old matches, compares them
// and adds those matches which were not in the old data result object
// but are in the new one.

Query.prototype.addDataObjMatches = queryAddDataObjMatches;

function queryAddDataObjMatches(oldDataObj, indexerAndPathChanged)
{
    if(indexerAndPathChanged) {
        this.addMatches(this.dataObj.getDominatedMatches());
        return;
    }

    // indexer and path did not change.
    // get the new and old matches, and find those matches which are
    // new and add them.
    var newMatches = this.dataObj.getDominatedMatches();
    var oldMatches = newDataObj.getDominatedMatchesAsObj();
    var addedMatches = [];

    for(var i = 0, l = newMatches.length ; i < l ; ++i) {
        var elementId = newMatches[i];
        if(!oldMatches.has(elementId))
            addedMatches.push(elementId);
    }

    this.addMatches(addedMatches);
}

// this function is called when a new data object is about to be set.
// It should pull the matches from the old data object and remove them 
// as root of the query description. If 'indexerAndPathChanged' is true, 
// either the indexer or the root path changed and the function 
// 'refreshIndexerAndPaths()' will be called just after
// this function. In this case, all roots of the query description
// are removed. If this is false, the indexer and path did not change.
// In this case, the function is also provided with the new data result
// object (which is about to be set as the source of the query desscription).
// The function then fetches both the new and old matches, compares them
// and removes those matches which were in the old data result object
// but not in the new one.

Query.prototype.removeDataObjMatches = queryRemoveDataObjMatches;

function queryRemoveDataObjMatches(newDataObj, indexerAndPathChanged)
{
    if(indexerAndPathChanged) {
        this.removeAllRootElements();
        return;
    }

    // indexer and path did not change.
    // get the new and old matches, and find those matches which are
    // removed and remove them as roots of the query.
    var oldMatches = this.dataObj.getDominatedMatches();
    var newMatches = newDataObj.getDominatedMatchesAsObj();
    var removedMatches = [];

    for(var i = 0, l = oldMatches.length ; i < l ; ++i) {
        var elementId = oldMatches[i];
        if(!newMatches.has(elementId))
            removedMatches.push(elementId);
    }

    this.removeMatches(removedMatches);
}

// This function can be called to remove all root elements from this
// query (and thus clear the query). This can happen either when replacing
// the data source or when destroying the query.
// This function removes the sub-tree monitoring registrations with the
// indexer for all root elements. This operation will also result in the
// clearing of the whole query tree.
// After removing the monitoring registrations, the list of root 
// element IDs is cleared.  

Query.prototype.removeAllRootElements = queryRemoveAllRootElements;

function queryRemoveAllRootElements()
{
    // first remove the specific registrations on sub-trees.
    var _self = this;
    this.rootElementIds.forEach(function(t, elementId) {
        _self.indexer.unregisterSubTreeRetrievalOnNode(_self.rootPathId, 
                                                       elementId, 
                                                       _self.monitorId);
    });
    this.rootElementIds = new Map();
}

// This function detaches the Query object from the indexer it is currently
// registered to. This function first checks whether the Query is already
// registered to some indexer (by checking whether it has a monitor ID 
// assigned). If it is, it first removes the registrations for specific
// sub-trees in the indexer (rooted at the data element IDs stored in 
// this.rootElementIds) and then removes the registration as a monitor of
// the path. This function then sets the monitor ID to undefined.
// In the process of removing the registrations, the indexer removes from
// the Query object all the terminal values it added to it. In this way,
// the query is cleared.

Query.prototype.detachFromIndexer = queryDetachFromIndexer;

function queryDetachFromIndexer()
{
    if(this.monitorId === undefined)
        return; // not attached to any indexer

    // first, remove all remaining root elements
    this.removeAllRootElements();

    // remove monitor registration from path
    this.indexer.removeSubTreeMonitor(this.rootPathId, this.monitorId);
    // clear the monitor ID
    this.monitorId = undefined;
}

// This function receives updates from the data source with the data
// element IDs of the root nodes added to the query description (an
// array of element IDs).  These updates are received only after the
// Query object has registered itself as a monitor to the appropriate
// indexer. This function then adds the given element IDs to the
// 'rootElementIds' table and registers to the indexer a sub-tree
// retrieval request on each of the given element IDs.

Query.prototype.addMatches = queryAddMatches;

function queryAddMatches(elementIds)
{
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        if(this.rootElementIds.has(elementId))
            continue; // already added
        if(!this.indexer.isOperand(elementId, this.rootPathId)) {
            this.rootElementIds.set(elementId, true);
            this.indexer.registerSubTreeRetrievalOnNode(this.rootPathId, 
                                                        elementId, 
                                                        this.monitorId, this);
        }
    }
}

// another interface for addMatches (since only a single projection 
// path of the description source is supported, these are equivalent).

Query.prototype.addProjMatches = queryAddProjMatches;

function queryAddProjMatches(elementIds)
{
    this.addMatches(elementIds);
}

// This function receives updates from the data source with the data
// element IDs of the root nodes removed from the query description (an
// array of element IDs).  These updates are received only after the
// Query object has registered itself as a monitor to the appropriate
// indexer. This function then removes the given element IDs from the
// 'rootElementIds' table and removes the Query object's registration
// to the indexer for sub-tree retrieval on these nodes.

Query.prototype.removeMatches = queryRemoveMatches;

function queryRemoveMatches(elementIds)
{
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        
        var elementId = elementIds[i];
        if(!this.rootElementIds.has(elementId))
            continue; // nothing to remove, was not added

        this.indexer.unregisterSubTreeRetrievalOnNode(this.rootPathId, 
                                                      elementId, 
                                                      this.monitorId);
        this.rootElementIds.delete(elementId);
    }
}

// another interface for removeMatches (since only a single projection 
// path of the description source is supported, these are equivalent).

Query.prototype.removeProjMatches = queryRemoveProjMatches;

function queryRemoveProjMatches(elementIds)
{
    this.removeMatches(elementIds);
}

///////////////////////////////////////
// Root Query Calculation Assignment //
///////////////////////////////////////

// Because different types of query objects may potentially exist,
// each with its own root query calculation class, it
// is up to the Query object to allocate the correct type of object.

Query.prototype.newRootQueryCalc = queryNewRootQueryCalc;

function queryNewRootQueryCalc(indexer, prefixProjPathId, key) 
{
    return new InternalRootQueryCalc(this, indexer, prefixProjPathId, key);
}

// This function allows for a new root query calculation node to be
// registered to this query. This node should then be added to the list of
// root query calculation nodes. However, if the query is in the midst of 
// an update cycle, this addition must wait until the update cycle is completed.
// The root query calculation node is then stored in a list of pending
// root query calculation additions and actually added only at the end of
// the update cycle.

Query.prototype.addRootQueryCalcNode = queryAddRootQueryCalcNode;

function queryAddRootQueryCalcNode(rootQueryCalc)
{
    // The node is stored under its ID.
    var rootId = rootQueryCalc.getId();
    
    if(this.rootQueryCalcs.has(rootId))
        return; // already registered

    if(this.pendingUpdates) {
        if(this.pendingAddedRootQueryCalcs === undefined)
            this.pendingAddedRootQueryCalcs = new Map();
        this.pendingAddedRootQueryCalcs.set(rootId, rootQueryCalc);
        return;
    }
    
    this.rootQueryCalcs.set(rootId, rootQueryCalc);
    if(this.rootQueryCalcs.size == 1)
        this.activated();

    this.generateQueryCalcs(rootId);
    rootQueryCalc.refreshQuery();
}

// This function is called when the query update cycle has completed.
// It checks whether there are any root query calculation nodes
// which were added during the query update cycle and were queue for
// addition when the update cycle reaches its end. For these root
// query calculation nodes, this function generates query calculation
// nodes (based on the structure of the query tree).

Query.prototype.addPendingRootQueryCalcs =
    queryAddPendingRootQueryCalcs;

function queryAddPendingRootQueryCalcs()
{
    if(this.pendingAddedRootQueryCalcs === undefined)
        return;

    var _self = this;
    this.pendingAddedRootQueryCalcs.forEach(function(rootQueryCalc, rootId) {
        if(_self.rootQueryCalcs.has(rootId))
            return;
        _self.rootQueryCalcs.set(rootId, rootQueryCalc);
        if(_self.rootQueryCalcs.size == 1)
            _self.activated();
    });

    this.generateQueryCalcs(this.pendingAddedRootQueryCalcs);

    this.pendingAddedRootQueryCalcs = undefined;
}

// This function removes a root query calculation node from this query.
// The removal is by ID, which should be the ID of the root query calculation
// node. This function removes this node from the 'rootQueryCalcs'
// table and destroys all the query calculation nodes generated for
// this root query calculation node.
// This function does not destroy the root query calculation node.

Query.prototype.removeRootQueryCalcNode = queryRemoveRootQueryCalcNode;

function queryRemoveRootQueryCalcNode(rootId)
{
    if(this.pendingAddedRootQueryCalcs !== undefined && 
       this.pendingAddedRootQueryCalcs.has(rootId)) {
        // root query calculation node addition is still pending, just remove
        // it from the pending list
        this.pendingAddedRootQueryCalcs.delete(rootId);
    } else if(!this.rootQueryCalcs.has(rootId))
        return;
    else {
        this.destroyQueryCalcsForRoot(rootId);
        this.rootQueryCalcs.delete(rootId);
        // if this is the last root query calculation node and a destroy is
        // pending, this is the time to destroy the query
        if(this.rootQueryCalcs.size == 0) {
            if(this.pendingDestroy)
                this.destroy();
            else if(!this.isActive())
                this.deactivated();
        }
    }
}

/////////////////////////
// Auxiliary Functions //
/////////////////////////

// This function returns true if 'type' holds a value type string which is 
// the name of a simple type. All value types are simple except for 
// "negation", "projector" and "true". An undefined 'type' will also return
// false.

Query.prototype.isSimpleType = queryIsSimpleType;

function queryIsSimpleType(type)
{
    return (!!type && type != "negation" && type != "projector" &&
            type != "true");
}

// This function returns the data element ID of the parent data element
// in the query structure for the data element with the given ID.
// Usually, this is the parent data element of the data element as stored
// in the indexer. However, if the path of the parent data element is
// strictly shorter than the root path of the query, then the parent 
// is returned only if the path of the child data element is longer 
// than the root path of the query. Otherwise, the virtual element ID 0
// is returned.

Query.prototype.getParentDataElement = queryGetParentDataElement;

function queryGetParentDataElement(elementId)
{
    if(elementId == 0) // parent of the virtual root data element is undefined
        return undefined;

    var parentId = this.indexer.getParentDataElement(elementId);

    if(parentId == undefined)
        return 0; // the parent is the virtual root node

    var parentPathId = this.indexer.getDataElementPathId(parentId);

    if(parentPathId >= this.rootPathId)
        return parentId;

    if(this.indexer.getDataElementPathId(elementId) <= this.rootPathId)
        return 0;
    else
        return parentId;
}

// This function returns true if the path ID in the second argument is
// a prefix of the path ID in the first argument.

Query.prototype.isPathPrefixOf = queryIsPathPrefixOf;

function queryIsPathPrefixOf(pathId, prefixId)
{
    return this.indexer.qcm.isPrefixOf(pathId, prefixId);
}

// This function receives a data element ID which is currently stored in 
// the query tree and returns true if it has siblings stored in the 
// query tree. This mean that it returns true if there is another 
// data element stored in the query tree which has the same parent 
// data element and the same path.
// This is determined by checking the child count for the data
// element's path in the parent data element's entry.
// The root data element (ID 0) has no siblings, by definition.

Query.prototype.hasSiblings = queryHasSiblings;

function queryHasSiblings(elementId)
{
    if(elementId == 0)
        return false;

    // get the parent data element
    var parentId = this.getParentDataElement(elementId);

    var parentEntry = this.queryTree.get(parentId);
    
    if(!parentEntry)
        return false;

    // get this data element's path (relative to the query)
    var pathId = this.getElementPathId(elementId);

    return (parentEntry.childCount.get(pathId) > 1);
}

// This function returns the path of the given data element, relative to
// the root of the query description. This returns the empty path ID 
// (indexer.getRootPathId()) for data elements higher than the root path 
// of the query and for the virtual root node (element ID 0).

Query.prototype.getElementPathId = queryGetElementPathId;

function queryGetElementPathId(elementId)
{
    if(elementId == 0) // the virtual root, use the empty path
        return this.indexer.getRootPathId();

    // get the path ID in the indexer
    var pathId = this.indexer.getDataElementPathId(elementId);
    var elementPathId = 
        this.indexer.qcm.diffPathId(pathId, this.rootPathId);
    return (elementPathId === undefined ? 
            this.indexer.getRootPathId() : elementPathId);
}

//////////////////////////
// Data Element Entries //
//////////////////////////

// This function returns the entry for the data element in the 'queryTree'
// table. If the entry does not exist, it is created. Recursively,
// this may also create the entries for the parent data element entries.
// If the entry was created by this function call, the function increases 
// the child count of the parent entry for the path of the data 
// element 'elementId'.
// This function checks whether the node added is negated (this is iff 
// the path entry for the path of this element ID under its parent entry
// is a negation value). If it is, this function also updates this negation
// relation. 

Query.prototype.getElementEntry = queryGetElementEntry;

function queryGetElementEntry(elementId)
{
    var entry = this.queryTree.get(elementId);

    if(entry !== undefined)
        return entry;

    // create new entry
    entry = { paths: new Map() };
    this.queryTree.set(elementId, entry);

    // if this data element is not the root data element, get the entry
    // of its parent and increase the child count on the parent's
    // entry for the path of this data element.
    
    if(elementId == 0)
        return entry;
    
    var parentId = this.getParentDataElement(elementId);
    this.increaseChildCountAndUpdateNegation(parentId, elementId);

    return entry;
}

// This function removes the element entry for the given data element ID.
// If there is a dominating data element, this removes it from the list
// of child entries of the entry of that parent. This may result in 
// the recursive removal of the parent entry.
// If the element entry carries query calculation nodes, these need to 
// be destroyed (all query calculation nodes dominated by them should have
// already been destroyed). 

Query.prototype.removeElementEntry = queryRemoveElementEntry;

function queryRemoveElementEntry(elementId)
{
    var entry = this.queryTree.get(elementId);

    if(!entry)
        return; // nothing to remove

    // destroy any query calculation nodes assigned to this entry
    if(entry.queryCalcs !== undefined)
        this.destroyQueryCalcs(entry.queryCalcs);

    if(entry.negationId) {
        // dominated by a negation node, remove from the negation
        // (negative elementId means: remove!)
        this.updateNegationValue(this.getElementPathId(elementId), 
                                 entry.negationId, -elementId);
    }

    if(elementId != 0) {
        var parentId = this.getParentDataElement(elementId);
        this.decreaseChildCount(parentId, elementId);
    }

    this.queryTree.delete(elementId);
}

// This function is given two data element IDs: the data element of a parent
// ID and a data element of one of its direct children. This then increases
// the count for the path of the child under the the parent node's entry.
// This count is used to track the number of children a node has under each 
// path, to allow for the 'has siblings' property to be calculated for those
// child nodes.
// Since only a counter is stored, this function should be called exactly
// once for every parent-child pair.
// If a sibling of the child data element already has an entry in the child 
// count table of the parent data element and if that was the only sibling 
// up to this moment, updates propagated from that first sibling may have 
// to be re-propagated (this is done by removing their previous 
// propagations and queueing their new propagations).
// In addition to increasing the child count, this function also checks whether
// the element with ID 'childId' is negated. If it is negated, this is coded
// on the path entry with the path of the child data element inside the
// the parent element entry. If this entry stores a 'negation' type 
// value, the child data element is negated. In this case, the negation
// relation with childId is updated both on path entry holding the "negated" 
// type an on the childId element entry.

Query.prototype.increaseChildCountAndUpdateNegation = 
    queryIncreaseChildCountAndUpdateNegation;

function queryIncreaseChildCountAndUpdateNegation(parentId, childId)
{
    var parentEntry = this.getElementEntry(parentId);
    var pathId = this.getElementPathId(childId);

    if(parentEntry.childCount === undefined)
        parentEntry.childCount = new IntHashMapUint(undefined, 8);

    if(parentEntry.childCount.inc(pathId, 1) == 2) {
        // the other child data element at the same path now has 
        // a sibling (the node added here). May need to re-propagate
        // (if there's more than 1 path: since 'pathId' is the path
        // with which the current childId will be propagated, if it is
        // not in th elist of paths, it will soon be added, so this
        // also counts as more than one path)
        if(parentEntry.paths.size > 1 || !parentEntry.paths.has(pathId))
            this.repropagateUnder(parentId, pathId, parentEntry);
    }

    // update negation if there is a negation relation.
    var parentPathEntry;
    if((parentPathEntry = parentEntry.paths.get(pathId)) !== undefined && 
       parentPathEntry.type == "negation") {
        this.addNegation(parentId, pathId, parentPathEntry.key, childId);
        this.queueUpdatePropagation(parentId, pathId);
    }
}

// This function is given two data element IDs: the data element of a parent
// ID and a data element of one of its direct children. This then decreases
// the count for the path of the child under the the parent node's entry.
// This count is used to track the number of children a node has under each 
// path, to allow for the 'has siblings' property to be calculated for those
// child nodes.
// Since only a counter is stored, this function should be called at most
// once after a call to increaseChildCountAndUpdateNegation for every 
// parent-child pair.
// If no updates are stored on that parent and after the decrease in the 
// child count there are no more child entries on the parent entry, that 
// parent entry is recursively removed.

Query.prototype.decreaseChildCount = queryDecreaseChildCount;

function queryDecreaseChildCount(parentId, childId)
{
    var parentEntry = this.queryTree.get(parentId);
    var pathId = this.getElementPathId(childId);
    var newCount = parentEntry.childCount.dec(pathId, 1);
    
    if(newCount == 0 && parentEntry.childCount.size == 0 &&
       parentEntry.paths.size == 0)
        this.removeElementEntry(parentId);
    else if(newCount == 1) { // may be undefined
        // the remaining child data element at the same path now has no 
        // sibling. May need to re-propagate (if there's more than 1 path)
        if(parentEntry.paths.size > 1)
            this.repropagateUnder(parentId, pathId, parentEntry);
    }
}

//////////////////
// Path Entries //
//////////////////

// This function returns the entry for the given path inside the entry 
// for the data element 'elementId'. 'pathId' is the path relative to 
// the root of the query. If the entry does not exist, it is created.
// If this is the second path added under the same data element entry,
// it may modify the propagation of updates stored under the first 
// path under this data element entry. These propagated updates
// are then removed and the updates under the first path are scheduled
// for re-propagation.

Query.prototype.getPathEntry = queryGetPathEntry;

function queryGetPathEntry(elementId, pathId)
{
    var elementEntry = this.getElementEntry(elementId);
    var pathEntry = elementEntry.paths.get(pathId);

    if(pathEntry !== undefined)
        return pathEntry;

    if(elementId != 0 && elementEntry.paths.size == 1 && 
       !elementEntry.negationId) {
        // check whether the updates stored on the existing path in this
        // entry need to be re-propagated
        var _self = this;
        elementEntry.paths.forEach(function(existingPathEntry, existingPathId){
            if(existingPathEntry.dominated === undefined)
                // if there are no dominated IDs (but a value), the propagation
                // does not change, so there is nothing to do
                return;
            existingPathEntry.dominated.forEach(function(entry, dominatedId){
                _self.removePropagation(elementId, existingPathId, 
                                        dominatedId);
                _self.queueUpdatePropagation(elementId, existingPathId, 
                                             dominatedId);
            });
        });
    }

    pathEntry = {};
    elementEntry.paths.set(pathId, pathEntry);
    return pathEntry;
}

////////////////////////
// Update Propagation //
////////////////////////

// This function adds an update to the queue of updates which need to
// be propagated. The update is given by the elementId of the entry on
// which the update can be found and the pathId under that entry where
// the update is stored. If 'dominatedId' is omitted, all updates
// under that path are queued for propagation. If 'dominatedId' is given,
// then the update for the given dominated data element under the given 
// path is queued for propagation.
// All this function does is store the arguments given to the function
// in the queuedByPathId table. If this is the first entry under this 
// path and element ID, the path ID of the data element path and the element ID
// are pushed (as one object) onto the propagation
// heap, which ensures that propagations are carried out bottom up.
// The virtual top node (element ID 0) may also be queued for propagation 
// here. This is not for the sake of propagation (as there is nowhere to
// propagate it to) but for the same of query calculation update
// (which is handled together with the update propagation).  

Query.prototype.queueUpdatePropagation = queryQueueUpdatePropagation;

function queryQueueUpdatePropagation(elementId, pathId, dominatedId)
{
    if(!this.queuedByPathId)
        this.queuedByPathId = new Map();
    
    // set to -1 for the virtual root (to ensure that even if this happens
    // inside the update propagation loop when processing the top entries
    // with the empty path, the virtual entry will still get processed).
    var elementPathId = elementId ? this.getElementPathId(elementId) : -1;
    var elementPathEntry;
    var inHeap = true;
    
    if(!this.queuedByPathId.has(elementPathId)) {
        elementPathEntry = new Map();
        this.queuedByPathId.set(elementPathId, elementPathEntry);
        inHeap = false;
    } else
        elementPathEntry = this.queuedByPathId.get(elementPathId);
    
    var elementEntry;

    if(!elementPathEntry.has(elementId)) {
        elementEntry = new Map();
        elementPathEntry.set(elementId, elementEntry);
        inHeap = false;
    } else
        elementEntry = elementPathEntry.get(elementId);

    if(!inHeap) { // push this path ID + element ID into the heap
        if(!this.propagationHeap) {
            // create a heap (with reverse numeric sorting, as we want the 
            // maximum at the top of the heap)
            this.propagationHeap =
                new Heap(
                    function(a,b) {
                        return (b.pathId === a.pathId) ?
                            b.elementId - a.elementId : b.pathId - a.pathId;
                    });
        }
        this.propagationHeap.addSingle({pathId: elementPathId,
                                        elementId: elementId });
    }
    
    if(dominatedId === undefined)
        elementEntry.set(pathId, true); // overwrites any specific updates
    else {
        var pathEntry;
        if((pathEntry = elementEntry.get(pathId)) === true)
            return; // nothing more to add
        if(pathEntry === undefined) {
            pathEntry = new Map();
            elementEntry.set(pathId, pathEntry);
        }
        pathEntry.set(dominatedId, true);
    }
}

// This function adds an update with the value given in 'value' to the
// entry of data element 'elementId' under path 'pathId' (this path ID
// is already relative to the root of the query). If 'dominatedId' is
// given, the value is stored under that dominated data element and
// if 'dominatedId' is undefined, the value is stored directly under
// the path entry.
// After adding the update, the function checks whether it needs to be
// propagated, and if it does, queues it for propagation.
// 'value' can either be 'true' or an object { type: <type>, key: <key> }
// where <type> is a string and <key> is either a simple value 
// (number, string, boolean) or an object which supports a 'simpleCopy()'
// function, which produces a constant copy of the original key object
// (RangeKey and NeagtionKey currently support this operation).
// Note that if no dominatedId is specified, 'value' cannot be 'true'
// (since 'true' values can only be stored under dominated IDs, see 
// introduction).
// If the update value is 'true' and the 'true' value is already 
// stored under the dominate ID, the function exits (and no further
// propagation takes place). If the value is a specific value, the new
// value is not compared with the old value, as it is assumed that this
// function is ony called if the value changed (in the worst case,
// a few superfluous steps are carried out).

Query.prototype.addUpdate = queryAddUpdate;

function queryAddUpdate(elementId, pathId, dominatedId, value)
{
    var pathEntry = this.getPathEntry(elementId, pathId);
    var prevType;
    var prevKey;
    var dominatedEntry; // previous dominated entry, if dominated ID give
    
    if(dominatedId !== undefined) {
        if(pathEntry.type !== undefined) { // should not happen
            // This is not compatible with the new update. This update is
            // removed. The (new and empty) path entry object is returned by 
            // this function.
            pathEntry = this.removeUpdate(elementId, pathId, undefined, true);
        }
        if(pathEntry.dominated === undefined) {
            pathEntry.numSimpleValues = 0;
            pathEntry.dominated = new Map();
        } else
            dominatedEntry = pathEntry.dominated.get(dominatedId);

        if(dominatedEntry !== undefined && dominatedEntry !== true) {
            prevType = dominatedEntry.type;
            prevKey = dominatedEntry.key;
        }
        
        if(value == true) {
            if(this.isSimpleType(prevType))
                pathEntry.numSimpleValues--; // just wrote over a simple value
            pathEntry.dominated.set(dominatedId, true);
        } else {
            pathEntry.numSimpleValues += 
            (this.isSimpleType(value.type) ? 1 : 0) - 
                (this.isSimpleType(prevType) ? 1 : 0);
            if(dominatedEntry === undefined || dominatedEntry === true) {
                dominatedEntry = {};
                pathEntry.dominated.set(dominatedId, dominatedEntry);
            }
            dominatedEntry.type = value.type;
            dominatedEntry.key = ((typeof(value.key) == "object") ? 
                                  value.key.simpleCopy() : value.key);
        }
    } else {
        if(pathEntry.dominated !== undefined) {
            // This is not compatible with a terminal value. These updates must 
            // be removed (a removal for them should arrive soon).  The (new 
            // and empty) path entry object is returned by this function.
            pathEntry = this.removeUpdate(elementId, pathId, undefined, true);
        } else {
            prevType = pathEntry.type; 
            prevKey = pathEntry.key;
        }

        // update the terminal counts
        
        if(prevType === undefined)
            this.numTerminals++;
        if(prevType !== value.type) {
            if(prevType == "projector" && value.type != "projector")
                this.numProjTerminals--;
            else if(prevType != "projector" && value.type == "projector")
                this.numProjTerminals++;
        }
        
        pathEntry.type = value.type;
        pathEntry.key = (typeof(value.key) == "object") ? 
            value.key.simpleCopy() : value.key;
    }

    // Clear any previous values from the query calculation nodes
    // (if any). This does not add the new value yet (will be added later)
    this.clearQueryCalcsAfterValueChange(pathEntry, dominatedId, 
                                         dominatedEntry, prevType, prevKey);

    // propagate this update. 
    this.queueUpdatePropagation(elementId, pathId, dominatedId);
}

// This function removes the update stored in the entry of data element
// 'elementId' under path 'pathId' and dominated data element 'dominatedId'.
// 'dominatedId' may be omitted. In that case, if the entry for 'pathId'
// stores dominated data elements (and not a value) then all entries 
// under the path are removed.
// In addition to removing the update entry from the data element entry for
// 'elementId', this function also propagates this removal to the 
// dominated data element, if necessary. The propagation needs to take
// place if no other update entry under this data element propagates
// the same update to the dominating node:
// 1. If this is the last update entry under this data element, the 
//    propagation needs to be removed.
// 2. If this is not the last update stored under the entry:
//    a. If the data element has no siblings (and therefore the path is 
//       propagated unchanged) the removal must be propagated
//       unless the data element entry stores additional paths and the
//       the path entry being removed stores additional dominated data elements
//       which are not being removed.
//    b. If the data element has siblings (and therefore the path is replaced
//       upon propagation by the path of the data element) its propagation 
//       needs to be removed iff there is no other path under the data element
//       entry (if there is another path, all propagations are the same
//       for all updates).
// These conditions are logically equivalent to propagating iff one of the 
// following holds:
// 1. there is only one path in the data element entry.
// 2. the data element has no siblings and the last dominated data element 
//    under the path is being removed. 
// If 'keepPathEntry' is true, the path entry is not removed from the 
// data element entry, but the object representing it may be replaced 
// (to save the tediousness of removing one element after the other). 
// This should be used in cases where a new update is about to be written 
// to the same path entry. This function then returns the new path entry.
// If 'keepPathEntry' is not 'true' and as a result of this removal
// the number of paths under the data element entry falls from 2 to 1,
// the propagation rules for the updates under the remaining path
// change if these store dominated data elements (if a value is stored
// directly under the path, the propagation remains unchanged). In
// this case, the function removes the (single) update propagated by
// these entries from the parent data element entry and queues the
// update(s) for propagation.
// If there are any query calculation nodes associated with the removed
// updates, these query calculation nodes are updated or destroyed.
// This function destroys all query calculation nodes belonging to 
// the dominated entries and path entry removed. If a dominated simple 
// value which does not itself have query calculation nodes assigned to it
// is removed and if the path entry has simple query calculation nodes
// defined for it, this value should be removed from the simple query
// calculation nodes. If this is the last simple value (which is not 
// a negation or projection value) the simple query calculation nodes
// should also be destroyed. 
// If a single dominated entry remains, the union query calculation nodes
// (if exist) should be destroyed. The single set of query calculation nodes 
// still defined under the path entry needs to be inserted directly under
// the parent of the union quwry calculation nodes.
// The function returns the path entry from which the removal took place.
// This may be undefined if the path entry was destroyed (and not replaced).

Query.prototype.removeUpdate = queryRemoveUpdate;

function queryRemoveUpdate(elementId, pathId, dominatedId, keepPathEntry)
{
    // get the path entry (sometimes it may already have been removed)
    var elementEntry = this.queryTree.get(elementId);

    if(elementEntry === undefined)
        return undefined;

    var pathEntry = elementEntry.paths.get(pathId);

    if(pathEntry === undefined)
        return undefined;
    
    // a necessary (but not sufficient) condition for the propagation
    // of this removal is that the element is not the root element ID (0) 
    var mayPropagate = (elementId != 0 && !elementEntry.negationId);

    if(pathEntry.type == "negation")
        return this.removeNegationUpdate(elementId, elementEntry, pathId,
                                         pathEntry, dominatedId, keepPathEntry)
    else if(dominatedId !== undefined)
        return this.removeDominatedUpdate(elementId, elementEntry, pathId,
                                          pathEntry, dominatedId,
                                          keepPathEntry);
    else if(pathEntry.dominated !== undefined) {
        var _self = this;
        pathEntry.dominated.forEach(function(entry, dominatedId) {
            pathEntry = _self.removeDominatedUpdate(elementId, elementEntry,
                                                    pathId, pathEntry,
                                                    dominatedId, keepPathEntry);
        });
        return pathEntry;
    }
    
    if(pathEntry.type === undefined)
        return pathEntry;

    // terminal removal
    
    // update the terminal counts?
    this.numTerminals--;
    if(pathEntry.type == "projector")
        this.numProjTerminals--;
    // propagate the removal?
    if(mayPropagate &&
       (elementEntry.paths.size == 1 || !this.hasSiblings(elementId)))
        this.removePropagation(elementId, pathId);

    return this.removePathEntry(elementId, elementEntry, pathId, pathEntry,
                                keepPathEntry);
}

// This function implements removeUpdate() for the case where the removed
// update is a negation node. In case 'dominatedId' is given, this is
// interpreted as a removal of the negated value under the negation node
// with the given ('dominatedId') ID.
// The argument to this function are the same as those received as
// input for removeUpdate() together with 'elementEntry' and 'pathEntry'
// which are the entries from the compiled query tree for the
// given element ID ('elementEntry') and for the given path ID under
// the given element ID ('pathEntry').
// This function returns the path entry remaining after this operation
// (this may be undefined if the path entry became empty and
// 'keepPathEntry' is not set, see more documentation in the introduction
// to removeUpdate()).

Query.prototype.removeNegationUpdate = queryRemoveNegationUpdate;

function queryRemoveNegationUpdate(elementId, elementEntry, pathId, pathEntry,
                                   dominatedId, keepPathEntry)
{
    // a necessary (but not sufficient) condition for the propagation
    // of this removal is that the element is not the root element ID (0) 
    var mayPropagate = (elementId != 0 && !elementEntry.negationId);
    
    var negationKey = pathEntry.key;
 
    if(dominatedId !== undefined) {
        // only remove this ID from the list of negated nodes
        this.removeNegation(elementId, pathId, negationKey, dominatedId,
                            pathEntry.queryCalcs);
        // propagate the new negation value
        if(mayPropagate &&
           (elementEntry.paths.size == 1 || !this.hasSiblings(elementId)))
            this.propagateUpdate(elementId, pathId);
        // the path entry remains, even if the negation is empty
        return pathEntry;
    } else {
        // remove all negations
        var _self = this;
        negationKey.getNegated().forEach(function(e, negatedId) {
            _self.removeNegation(elementId, pathId, negationKey, negatedId,
                                 pathEntry.queryCalcs);
        });
        if(mayPropagate &&
           (elementEntry.paths.size == 1 || !this.hasSiblings(elementId)))
            this.removePropagation(elementId, pathId);
    }

    // remove the path entry
    return this.removePathEntry(elementId, elementEntry, pathId, pathEntry,
                                keepPathEntry);
}

// This function implements removeUpdate() for the case where the removal
// applies to 'dominatedId' which is a dominated node propagated to
// the path 'pathId' under the element 'elementId'. This function may
// be called repeatedly by the removeUpdate() in case removeUpdate()
// needs to remove all dominated elements under the given 'elementId'
// and 'pathId'.
// In addition to the arguments 'elementId', 'pathId', 'dominatedId' and
// 'keepPathEntry' which are identical to the arguments with the same name
// received by removeUpdate() ('dominatedId' may also be the result of looping
// over all dominated IDs under 'elementId' and 'pathId') this function
// also receives as arguments 'elementEntry' and 'pathEntry'
// which are the entries in the query tree for 'elementId' and for
// 'elementId' + 'pathId' (respectively).
// The function returns each time the remaining path entry (after the removal).
// In case of repeated removal of dominated IDs, all but the last removal
// return the original entry (except that one dominated ID was deleted).

Query.prototype.removeDominatedUpdate = queryRemoveDominatedUpdate;

function queryRemoveDominatedUpdate(elementId, elementEntry, pathId,
                                    pathEntry, dominatedId, keepPathEntry)
{
    var dominatedEntry;
    if(pathEntry.dominated === undefined || 
       (dominatedEntry = pathEntry.dominated.get(dominatedId)) === undefined)
        return pathEntry;
    
    // propagate the removal?
    if(elementId != 0 && !elementEntry.negationId &&
       (elementEntry.paths.size == 1 ||
        (pathEntry.dominated.size == 1 && !this.hasSiblings(elementId))))
        this.removePropagation(elementId, pathId, dominatedId);
    
    if(this.isSimpleType(dominatedEntry.type))
        pathEntry.numSimpleValues--;
    
    pathEntry.dominated.delete(dominatedId);
    
    // remove query calculation nodes
    this.removeDominatedEntryQueryCalcs(pathEntry, dominatedId, 
                                        dominatedEntry, 
                                        dominatedEntry.type);
    if(pathEntry.dominated.size > 0)
        return pathEntry;

    // remove the path entry
    return this.removePathEntry(elementId, elementEntry, pathId, pathEntry,
                                keepPathEntry);
}

// This function removes the path entry in the query tree for element
// 'elementId' and path 'pathId'. 'elementEntry' is the entry in the
// query tree for the element 'elementId' and 'pathEntry' is the
// entry in the query tree for path 'pathId' under element 'elementId'
// (this is the entry beign removed). Thsi function returns undefined,
// unless 'keepPathEntry' is true, in which case the function returns a
// new empty object as which is not the path entry for the given
// element ID and path ID.

Query.prototype.removePathEntry = queryRemovePathEntry;

function queryRemovePathEntry(elementId, elementEntry,
                              pathId, pathEntry, keepPathEntry)
{
    this.removePathEntryQueryCalcs(pathEntry);

    if(keepPathEntry) {
        // remove any content stored in the path entry and return
        // this new entry
        pathEntry = {};
        elementEntry.paths.set(pathId, pathEntry);
        return pathEntry;
    }

    elementEntry.paths.delete(pathId);
    
    if(elementEntry.paths.size === 0) {
        // last path removed from this data element entry. If it has no
        // child data elements, the element entry can be removed
        if(!elementEntry.childCount || elementEntry.childCount.size === 0)
            this.removeElementEntry(elementId);
    } else if(elementEntry.paths.size == 1 && !elementEntry.negationId) {
        // check whether the remaining path entry stores dominated IDs. If it 
        // does, the propagation of the update(s) should be removed and 
        // the updates rescheduled for propagation
        var _self = this;
        elementEntry.paths.forEach(function(pathEntry, remainingPathId) {
            if(pathEntry.dominated !== undefined) {
                // stores dominated data elements. Because there were two
                // paths until now, there is only one propagation to remove
                _self.removePropagation(elementId, remainingPathId);
                // indicate that these updates need to be re-propagated
                _self.queueUpdatePropagation(elementId, remainingPathId);
            }
        });
    }

    return undefined;
}

// This function is given and update in the query tree (which was
// possibly just removed) stored on the entry of data element with ID
// 'elementId'. The update is/was at path with ID 'pathId' and
// (possibly) for dominated data element 'dominatedId' ('dominatedId'
// may be omitted, in which case all updates under the given path have
// been removed). This function is called when it has been determined
// that the propagation of this update should be removed from the
// dominating data element.
// This means that this function does not actually check whether the
// propagation should be removed. For example, if the parent node is a
// negation node negating 'elementId', this function should not be
// called, and this function does not check for this situation.  This
// function first determines the data element to which the update
// should be propagated (if there is none, the function exits) and
// then determined the update which should be removed.

Query.prototype.removePropagation = queryRemovePropagation;

function queryRemovePropagation(elementId, pathId, dominatedId)
{
    if(elementId == 0)
        return; // top node: nowhere to propagate to

    var parentId = this.getParentDataElement(elementId);

    // check whether we need to propagate dominatedId or elementId
    var propagatedElementId = 
        (!dominatedId || this.queryTree.get(elementId).paths.size > 1) ?
        elementId : dominatedId;
    
    // determine the path to propagate
    var propagatedPathId = (this.hasSiblings(elementId)) ? 
        this.getElementPathId(elementId) : pathId;

    this.removeUpdate(parentId, propagatedPathId, propagatedElementId);
}

// This function is called with a data element ID and a path under which 
// this data element has children. The function also receives the entry
// in the query tree table for the data element. This function then
// finds all updates stored in this entry whose source is a child data 
// element of the given data element at the given path. These updates
// are then removed (and this removal is propagated) and are then 
// queued for re-propagation. This is typically called when the 
// 'has siblings' property has just changed for the child data elements
// at the given path under the given data element.

Query.prototype.repropagateUnder = queryRepropagateUnder;

function queryRepropagateUnder(elementId, childPathId, elementEntry)
{
    // find paths which are equal to 'childPathId' or extend it. These 
    // are the relevant updates

    var _self = this;
    
    elementEntry.paths.forEach(function(pathEntry, pathId) {
        if(!_self.isPathPrefixOf(pathId, childPathId))
            return;

        if("type" in pathEntry)
            // the only type currently possible here is "negation" and for
            // this the propagation does not change.
            return;
        
        // remove the updates (this also propagates the removal)
        if(pathEntry.dominated !== undefined) {
            pathEntry.dominated.forEach(function(e, dominatedId) {
                // queue the propagation of the updated from its source
                _self.queueUpdateSourceForPropagation(elementId, pathId, 
                                                      dominatedId);
                // remove the update
                _self.removeUpdate(elementId, pathId, dominatedId);
            });
        }
    });
}

// This function is given a data element ID on whose entry a
// propagated update is/was registered under path 'pathId' and under
// the given dominated data element. This function finds the source of
// this update and queues it for re-propagation. To find the source,
// it first needs to find the direct child of 'elementId' which
// carries this update. Usually, this will be 'dominatedId', but 
// sometimes (where propagations preserve the original dominated ID)
// this will be the parent of dominatedId which is the direct child of
// 'elementId'. We therefore loop up from 'dominatedId' to 'elementId'
// along the parent chain. Once we found the entry from which this
// propagation took place, we have to mark for re-propagation all 
// paths which extend 'pathId'.

Query.prototype.queueUpdateSourceForPropagation = 
    queryQueueUpdateSourceForPropagation;

function queryQueueUpdateSourceForPropagation(elementId, pathId, dominatedId)
{
    var parentId;

    for( ; elementId != (parentId = this.getParentDataElement(dominatedId)) ;
         dominatedId = parentId);

    var sourceEntry = this.queryTree.get(dominatedId);

    if(!sourceEntry)
        return;

    var _self = this;

    sourceEntry.paths.forEach(function(pathEntry, updatePathId) {
        if(!_self.isPathPrefixOf(updatePathId, pathId))
            return;
        // add this path to the propagation queue
        _self.queueUpdatePropagation(dominatedId, updatePathId);
    });
}

// This function propagates the update specified by the input arguments
// to the entry of the parent of elementId. 'elementId' is the ID of 
// the data element under whose entry the update is stored. 'pathId'
// is the ID of path entry inside that entry which carries the update
// (this path is already relative to the root of the query).
// 'dominatedId' is optional. If it is given, only the update under that
// dominated data element is propagated. If 'dominatedId' is undefined,
// all updates under 'elementId' and 'pathId' are propagated. 
// It may turn out that the update(s) specified are not found (because
// they were removed since they were added). In this case, no
// propagation takes place.
// When an update is propagated, it is set on the entry of the 
// parent data element and, if further propagation is necessary,
// queued for the next propagation.
// This function implements the propagation rules described in the 
// introduction to this file.
// In addition to propagation, this function is also responsible for
// assigning query calculation nodes at the entries which are scheduled
// for propagation. When the propagation only propagates some of the 
// information required for the query calculation node at a certain
// entry, a query calculation node must be created at that entry.
// If however, all the information stored in the query calculation node
// is propagated, there is no need to create query calculation nodes
// (as they can be created at the higher node to which the information is
// propagated).
// Because of the need to update the assignment of query calculation nodes,
// this function may be called even if 'elementId' has no parent and
// therefore no propagation can take place. Therefore, we check that
// a parent element ID is indeed defined. If not, the function exits.

Query.prototype.propagateUpdate = queryPropagateUpdate; 

function queryPropagateUpdate(elementId, pathId, dominatedId)
{    
    var elementEntry = this.queryTree.get(elementId);
    if(elementEntry === undefined || elementEntry.negationId)
        return;

    var parentId = this.getParentDataElement(elementId);

    var pathEntry = elementEntry.paths.get(pathId);
    if(pathEntry === undefined)
        return; 

    var hasSiblings = this.hasSiblings(elementId);

    // determine the path to propagate and the parent to propagate to    
    var propagatedPathId = hasSiblings ? 
        this.getElementPathId(elementId) : pathId;

    if(dominatedId) {
        var value = pathEntry.dominated === undefined ? 
            undefined : pathEntry.dominated.get(dominatedId);
        if(value === undefined)
            return;
        var propagatedValue = value;
        if(propagatedPathId !== pathId)
            propagatedValue = true; // by the propagation rules
        // determine the propagation element ID
        var propagatedElementId = 
            elementEntry.paths.size > 1 ? elementId : dominatedId;
        if(propagatedElementId != dominatedId)
            propagatedValue = true; // by the propagation rules
        this.addUpdate(parentId, propagatedPathId, propagatedElementId, 
                       propagatedValue);
    } else {
        if(pathEntry.dominated !== undefined) { 
            // propagate all updates (for each dominated ID).
            if(elementEntry.paths.size > 1) {
                // all updates have the same propagation (with a 'true' value)
                this.addUpdate(parentId, propagatedPathId, elementId, true);
            } else { // the dominated data elements are propagated
                var _self = this;
                pathEntry.dominated.forEach(function(domEntry, dominatedId) {
                    _self.addUpdate(parentId, propagatedPathId, dominatedId, 
                                   hasSiblings ? true : domEntry);
                });
            }
        } else if(pathEntry.type) { // path entry carries a single value
            // value to propagate
            var value = (propagatedPathId == pathId && 
                         (!hasSiblings || this.isSimpleType(pathEntry.type))) ? 
                         pathEntry : true;
            this.addUpdate(parentId, propagatedPathId, elementId, value);
        }
    }
}

// This function propagates all updates queued for propagation. New
// updates may be queued for propagation within this function call
// and all these propagations are carried out too (the path of
// a newly queued propagation must be shorter than that of the propagation
// which caused it to be queued, so this process must end).
// This function pops <path ID, data element ID> pairs from the
// propagation heap, which ensures that each time we get the highest path ID
// and element ID such that the data element has queued propagation. Given
// this path and element ID, the function reads the corresponding entry in
// the queuedByPathId table and propagates the updates stored in that entry.
// At each step, after propagating the updates, the query calculation
// nodes for the given element entry, path entry or dominated element 
// entry are updated.
// Under the virtual node (element ID 0 and path ID -2) there is no need
// to propagate the updates (there is nowhere to propagate them to)
// but there is still need to update the query calculation nodes.

Query.prototype.propagateQueuedPropagations = queryPropagateQueuedPropagations;

function queryPropagateQueuedPropagations()
{
    if(!this.propagationHeap)
        // in case there is nothing to propagate (e.g. if all data elements
        // are root data elements).
        return;

    var queuedEntry;
    var queuedPathId;
    var pathQueue;

    while(queuedEntry = this.propagationHeap.pop()) {
        if(queuedPathId !== queuedEntry.pathId)
            pathQueue = this.queuedByPathId.get(queuedEntry.pathId);
        var elementId = queuedEntry.elementId;

        // perform the specific propagations under the element entry
 
        var elementQueue = pathQueue.get(elementId);

        var _self = this;
        
        elementQueue.forEach(function(entry, updatePathId) {
            if(entry === true) {
                if(elementId != 0)
                    _self.propagateUpdate(elementId, updatePathId);
                _self.updatePathEntryQueryCalcs(elementId, updatePathId);
            } else {
                entry.forEach(function(t, dominatedId) { 
                    if(elementId != 0)
                        _self.propagateUpdate(elementId, updatePathId, 
                                              dominatedId);
                    _self.updateDominatedEntryQueryCalcs(elementId, 
                                                         updatePathId, 
                                                         dominatedId);
                });
            }
        });
        // update the query calculation nodes of the element entry
        this.updateElementEntryQueryCalcs(elementId, elementQueue);
    }

    this.queuedByPathId = new Map();
}

// Given an element ID, this function finds all data element entries in 
// the query tree dominated by the data element with this ID and removes
// them from the tree (this includes the entry for the given data element,
// 'rootElementId'). To ensure proper clean-up, the function first finds
// terminal data element entries (those that do not have children and
// are not negation nodes) and removes all updates from those nodes.
// This will result in the complete removal of those nodes and all the nodes 
// which dominate them. 

Query.prototype.removeDominated = queryRemoveDominated;

function queryRemoveDominated(rootElementId)
{
    // get all (active) data elements dominated by the given data element
    var dominated = this.indexer.getAllDominatedDataElements(rootElementId);

    for(var i = 0, l = dominated.length ; i < l ; ++i) {
        var dominatedId = dominated[i];
        var entry = this.queryTree.get(dominatedId);
        if(!entry)
            continue;
        if(!entry.childCount || entry.childCount.size === 0) {
            // remove the updates from this node
            var _self = this;
            entry.paths.forEach(function(pathEntry, pathId) {
                _self.removeUpdate(dominatedId, pathId, undefined, false);
            });
        }
    }
}

//////////////////////
// Terminal Updates //
//////////////////////

// This function receives a single update for a terminal value in the
// query description. 'pathId' is the path of the terminal, relative
// to the root of the query description and 'elementId' is the lowest data 
// element dominating this terminal node. 'type' is then the type of 
// the terminal node and 'key' is its simple value (boolean, number, string, 
// or range key). This terminal may either be new or replace an existing 
// terminal at the same path and under the same data element.
// This function then updates the query tree with this terminal, according
// to the algorithm described in the introduction.

Query.prototype.updateSimpleElement = 
	queryUpdateSimpleElement;

function queryUpdateSimpleElement(pathId, elementId, type, key)
{
    this.pendingUpdates = true;

    if(type == "negation") { 
        this.updateNegationValue(pathId, elementId);
        return;
    }

    if(type == "boolean" && key === true)
        type = "true"; // special handling of this type
    
    // write the update value to the query tree and queue for proapagtion
    // (if necessary)
    this.addUpdate(elementId, pathId, undefined, { type: type, key: key });
}

// This function is called to remove the terminal value at the given 
// 'pathId' and 'elementId' from the the structure of the query.
// 'pathId' is the path relative to the root of the query description
// (which is not necessrily the root of the indexer).
// The function then fetches the query tree entry for the given 
// data element and removes the update(s) stored under that entry 
// for the given path.
// Removals take place immediately and are not queued.

Query.prototype.removeSimpleElement = queryRemoveSimpleElement;

function queryRemoveSimpleElement(pathId, elementId)
{
    this.pendingUpdates = true;
    
    // remove the update
    this.removeUpdate(elementId, pathId, undefined, false);
}

// This function is called when the update of elements in a single 
// sub-tree in the indexer to which this Query object is registered
// is completed. We do not de here anything because the Query object
// may be registered on several sub-trees in the indexer and, therefore,
// when this function is called we do not yet know whether all updates
// from all sub-trees have been received.
// Instead, we wait for a call to querySubTreeUpdate() (which is called
// after all updates on all sub-trees at the same path have been 
// completed) and only then complete the query calculation.

Query.prototype.completeUpdate = queryCompleteUpdate;

function queryCompleteUpdate()
{
    return; // does nothing, as explained below
}

// This function is called by the indexer when all monitored sub-trees
// at the given path (which is also the path of the query) have been
// updated. 'elementIds' is the list of data elements which are roots 
// of sub-trees which changed. 'monitorId' is the ID of this Query object
// as a sub-tree monitor registered to the indexer.
// When this function is called, we know that all updates have been received
// and it is time to complete the compilation of the query (by calling
// refreshQuery()). This function may be called even if nothing in the 
// description of the query changed, if other sub-trees at the same path
// as the sub-tree(s) describing the query have changed. However, refreshQuery
// can easily check whether it needs to do anything, so there is no 
// harm in calling it.

Query.prototype.subTreeUpdate = querySubTreeUpdate;

function querySubTreeUpdate(pathId, elementIds, monitorId)
{
    this.refreshQuery();
}

// This function is called to complete the query compilation after
// receiving a sequence of updates (calles to updateSimpleElement()
// and removeSimpleElement()). This function then propagates the 
// queued updates in the query tree and (re-)assigns query 
// calculation nodes for existing root query calculation nodes.
// Afterwards, query calculation nodes are assigned to new 
// root query calculation.

Query.prototype.refreshQuery = queryRefreshQuery;

function queryRefreshQuery()
{
    if(!this.pendingUpdates)
        return; // nothing to do

    if(this.doDebugging)
        this.debugMessage("refreshing ", this.debugPrintQueryAndResults());
    
    // propagate the updates (this also updates the query calculation
    // nodes for root query calculation nodes registered before
    // the beginning of the update cycle)
    this.propagateQueuedPropagations();
    
    // generate query calculation nodes for root query calculation nodes
    // added after the update cycle has already began.
    this.addPendingRootQueryCalcs();

    this.pendingUpdates = false;

    // refresh the query under each of the root query calculation nodes
    this.rootQueryCalcs.forEach(function(rootQueryCalc, rootId) {
        rootQueryCalc.refreshQuery();
    });
}

/////////////////////
// Negation Update //
/////////////////////

// This function returns an array with the IDs of the element IDs negated
// by the negation node at 'elementId' and 'pathId'. It is assumed here, and
// not checked, that 'elementId' and 'pathId' indeed represent a negation
// node.
// The list of negated nodes is defined as the child data elements of
// 'elementId' at the path 'pathId'. These are retrieved from the 
// indexer, after prefixing the root path to 'pathId' (because we need a
// path relative to the root of the indexer). Since some of these 
// elements may not have been added to the query object yet, this list
// of data element IDs are filtered to contain only those which already have
// an element entry in the queryTree table (those which do not will be added
// to the negation when the negated node is added to the structure).  

Query.prototype.getNegatedIds = queryGetNegatedIds;

function queryGetNegatedIds(elementId, pathId)
{
    var queryNegatedIds = [];

    // get the list of negated data elements
    var negatedIds = this.indexer.getOperandDataElements(elementId, pathId);

    if(negatedIds !== undefined) {
        var _self = this;
        negatedIds.forEach(function(t,negatedId){
            if(_self.queryTree.has(negatedId)) // entry already created
                queryNegatedIds.push(negatedId);
        });
    }

    return queryNegatedIds;
}

// This function handles a simple update whose value type is "negation".
// An update of this type may have three types of keys:
// 1. A data element ID: this indicates that the given data element ID
//    should be added to the list of nodes negated by the node
//    under data element 'elementId' and at path 'pathId'.
// 2. A negative data element ID: this indicates that the data element
//    whose ID is the additive complement of the given key should be 
//    removed from the list of nodes negated by the node given
//    by 'elementId' and 'pathId'.
// 3. undefined: this indicates that the function must retrieve by itself
//    the list of negated IDs. These are defined as the child data element IDs
//    of 'elementId' under the path 'pathId'. These are fetched from the
//    indexer (after converting 'pathId' to be relative to the indexer root).
// First, if the previous update for the same elementId and pathId
// was not a negation value, the previous value is removed.
// Next, if not yet created, a negation value entry is created under the 
// path entry for 'pathId' in the element entry for 'elementId'.
// Finally, the list of negated nodes to remove or add is created.
// The function then goes over these lists and adds or removes 
// negation relations.

Query.prototype.updateNegationValue = 
	queryUpdateNegationValue;

function queryUpdateNegationValue(pathId, elementId, key)
{
    // get the previous path entry and, if it is not a negation value,
    // remove all updates under it.
    var pathEntry = this.getPathEntry(elementId, pathId);
    if(pathEntry.type != "negation") {
        if(pathEntry.dominated || pathEntry.type) // not empty, remove previous
            pathEntry = this.removeUpdate(elementId, pathId, undefined, true);
        pathEntry.type = "negation";
        pathEntry.key = new NegationKey();
        // as long as this remains empty, it is a terminal node
        this.numTerminals++;
        // has parent to propagate to
        if(elementId != 0)
            this.queueUpdatePropagation(elementId, pathId);
    }

    var negationKey = pathEntry.key;
    var queryCalcs = pathEntry.queryCalcs;

    if(key == undefined) {
        var negated = this.getNegatedIds(elementId, pathId);
        for(var i = 0, l = negated.length ; i < l ; ++i)
            this.addNegation(elementId, pathId, negationKey, negated[i]);
    } else if(key < 0) {
        // removal of a negation relation
        if(negationKey.isNegated(-key))
            this.removeNegation(elementId, pathId, negationKey, -key, 
                                queryCalcs);
    } else {
        // addition of a negation relation.
        if(!negationKey.isNegated(key))
            this.addNegation(elementId, pathId, negationKey, key);
    }
    this.queueUpdatePropagation(elementId, pathId);
}

// This function is called to add 'negatedId' as a negated node to
// the nagation node at 'elementId' and 'pathId'. 'negationKey' is the
// negation key object stored at the entry for 'elementId' and
// 'pathId'.
// The function gets the entry for the negated node and checks whether
// it is already negated by another node. If it is, this negation is 
// replaced. Otherwise, the negated node must be removed from the 
// 'childCount' list of its previous parent (if any) and the propagations 
// of its updates must be removed from the parent. It is then added as a 
// negated node to the negating node. There is no need to propagate
// its updates (as there is no propagation through a negation node).

Query.prototype.addNegation = queryAddNegation;

function queryAddNegation(elementId, pathId, negationKey, negatedId)
{
    var negatedEntry = this.getElementEntry(negatedId);

    if(negatedEntry.negationId) {
        if(negatedEntry.negationId == elementId)
            return; // nothing changed
        // remove from the negating node and add to this node
        var prevNegating = this.getPathEntry(negatedEntry.negationId, pathId);
        prevNegating.key.removeNegated(elementId);
        if(prevNegating.key.numNegated() == 0)
            this.numTerminals++; // became a terminal
    } else if(negatedEntry.paths.size > 0) {
        // remove the propagations
        var _self = this;
        negatedEntry.paths.forEach(function(subPathEntry, subPathId) { 
            _self.removePropagation(negatedId, subPathId);
        });
    }

    // add the new negation
    if(negationKey.numNegated() == 0)
        this.numTerminals--; // was a terminal, but isn't any longer
    negatedEntry.negationId = elementId;
    negationKey.addNegated(negatedId);
}

// This function is called to remove 'negatedId' as a negated node from
// the nagation node at 'elementId' and 'pathId'. 'negationKey' is the
// negation key object stored at the entry for 'elementId' and
// 'pathId'.
// If 'queryCalcs' is given, it carries a list of negation query calculation 
// nodes representing the negation node being updated. These need to be 
// updated with the removal (using the 'removeSubNode()' function).

Query.prototype.removeNegation = queryRemoveNegation;

function queryRemoveNegation(elementId, pathId, negationKey, negatedId, 
                             queryCalcs)
{
    var negatedEntry = this.getElementEntry(negatedId);

    // remove the negation
    negatedEntry.negationId = undefined;
    negationKey.removeNegated(negatedId);
    if(negationKey.numNegated() == 0)
        this.numTerminals++; // became a terminal

    // remove from the negation query calculation node (if any)
    if(queryCalcs !== undefined)
        this.removeSubQueryCalcs(queryCalcs,
                                 this.getQueryCalcsForElement(negatedId));
}

////////////////////////////////////////////////////
// Query Calculation Construction and Destruction //
////////////////////////////////////////////////////

// This function is called when query calculation nodes need to be created
// at a node of the query tree where previously there were no such nodes.
// The function is provided with a single argument 'createFunc' which should
// be a function which takes a root query calculation node as input and
// uses it to create a query calculation node (belonging to that root node)
// which the 'createFunc' must also return. This function loops over all
// the root query calculation nodes and uses 'createFunc' to generate
// the query calculation nodes for these root nodes and store them
// (by root query calculation ID) inside a 'queryCalcs' table which is
// created and returned by this function.

Query.prototype.createAllQueryCalcs = queryCreateAllQueryCalcs;

function queryCreateAllQueryCalcs(createFunc)
{
    var queryCalcs = new Map();

    this.rootQueryCalcs.forEach(function(rootQueryCalc, rootId) {
        var queryCalc = createFunc(rootQueryCalc);
        queryCalcs.set(rootId, queryCalc);
    });

    return queryCalcs;
}

// This function is similar to createAllQueryCalcs() except that here
// some query calculation nodes may already exist on the relevant
// query tree node. The list of query calculation node for the relevant
// queyr tree node are given by 'queryCalcs' (which may also be missing,
// in which case it is created here and returned). 'newRootIds' should
// be a Map object whose keys are the IDs of the root query calculation
// nodes for which a query calculation node should be created here.
// The function loops over these IDs, finds their root query calculation
// nodes, generates the query calculation node and stores it inside the
// queryCalcs object.

Query.prototype.createNewQueryCalcs = queryCreateNewQueryCalcs;

function queryCreateNewQueryCalcs(queryCalcs, newRootIds, createFunc)
{
    if(queryCalcs === undefined)
        queryCalcs = new Map();

    var _self = this;
    newRootIds.forEach(function(e, rootId) {
        var rootQueryCalc = _self.rootQueryCalcs.get(rootId);
        var queryCalc = createFunc(rootQueryCalc);
        queryCalcs.set(rootId, queryCalc);
    }); 

    return queryCalcs;
}

// This function adds the value defined by 'valueId' and 'type' and 'key'
// to a simple query calculation node for each of the root query calculation
// nodes given as the keys of the object 'newRootIds'. The simple query
// calculation nodes are stored on the object 'queryCalcs' (each under the
// ID of its root). If a simple query calculation node does not exist
// yet, it is created. If the object 'queryCalcs' does not exist, it is
// created and returned. If the query calculation node already exists,
// the value is added to the existing object.

Query.prototype.addValueToSimpleQueryCalc = queryAddValueToSimpleQueryCalc;

function queryAddValueToSimpleQueryCalc(queryCalcs, newRootIds, pathId,
                                        valueId, type, key)
{
    if(queryCalcs === undefined)
        queryCalcs = new Map();

    var _self = this;
    newRootIds.forEach(function(e, rootId) {
        var rootQueryCalc = _self.rootQueryCalcs.get(rootId);
        var queryCalc = queryCalcs.get(rootId);
        if(queryCalc === undefined) {
            queryCalc = rootQueryCalc.newSimpleQueryCalc(pathId);
            queryCalcs.set(rootId, queryCalc);
        }
        queryCalc.addValue(valueId, type, key);
    });

    return queryCalcs;
}

// Destroys the query calculation node stored under ID 'rootId' in
// 'queryCalcs' and removes it from the queryCalcs object.

Query.prototype.destroyQueryCalc = queryDestroyQueryCalc;

function queryDestroyQueryCalc(queryCalcs, rootId)
{
    if(queryCalcs === undefined)
        return;
    var queryCalc = queryCalcs.get(rootId);
    if(queryCalc !== undefined)
        queryCalc.destroy();

    queryCalcs.delete(rootId);
}

// Destroys all query calculation nodes stored in the table 'queryCalcs',
// which should be a Map structure whose keys are the root IDs
// (the ID of the root query calculation node) of the query calculation nodes.

Query.prototype.destroyQueryCalcs = queryDestroyQueryCalcs;

function queryDestroyQueryCalcs(queryCalcs)
{
    queryCalcs.forEach(function(queryCalc, rootId) {
        queryCalc.destroy();
    });
}

// Given is a set of query calculation node 'queryCalcs' at a certain node
// and a set of sub-nodes of these query calculation nodes 'subQueryCalcs',
// where each of 'queryCalcs' and 'subQueryCalcs' is a Map object whose
// keys are root query calculation node IDs and the values are query
// calculation nodes belonging to the corresponding root query calculation
// node.
// This function removes each query calculation node in subQueryCalcs
// as a sub-node of the corresponding query calculation node in queryCalcs
// (based on the root query calculation node ID).

Query.prototype.removeSubQueryCalcs = queryRemoveSubQueryCalcs;

function queryRemoveSubQueryCalcs(queryCalcs, subQueryCalcs)
{
    if(queryCalcs === undefined || subQueryCalcs === undefined)
        return;

    queryCalcs.forEach(function(queryCalc, rootId) {
        queryCalc.removeSubNode(subQueryCalcs.get(rootId).getId());
    });
}

//////////////////////////////////////////////////
// Query Calculation Node Assignment and Update //
//////////////////////////////////////////////////

// Given an active element ID (see definition in the introduction), 
// this function returns the query calculation nodes
// which are the root of the query structure at the given node. 
// As specified in the introduction, the search process is as follows:
// 1. First, check whether the element entry for that element ID has 
//    query calculation nodes assigned to it.
//    If that failed, the entry must have a single path under it.
// 2. Check whether the single path entry under the element entry 
//    has query calculation nodes assigned to it.
// 3. If the path entry holds a single dominated element, check whether
//    that dominated entry has a query calculation node assigned to it
//    (this can happen only under if the element entry is negated).
// 4. Using the single path in the element entry, loop up the parent
//    chain and look for the same path's entry in those parents. This
//    path entry has a dominated element entry for the element we are
//    looking for. Look for the query calculation nodes on that dominated 
//    entry. If they do not exist, check for simple query calculation nodes
//    defined on the path entry. If this too does not exist, continue
//    to the parent element entry.
//    This step does not apply to negated elements, as they do not
//    propagate upwards.
//    Note that in this step there is no need to check which type of
//    value the element carries: the first query calculation nodes
//    we find (by searching in the order specified) is the right one.

Query.prototype.getQueryCalcsForElement = queryGetQueryCalcsForElement;

function queryGetQueryCalcsForElement(elementId)
{
    var entry = this.queryTree.get(elementId);

    if(!entry)
        return undefined;

    if(entry.queryCalcs)
        return entry.queryCalcs;

    if(entry.paths.size === 0)
        return undefined; // possibly already removed
    
    var pathEntry;
    
    entry.paths.forEach(function(e, pathId) {
        // should only hold a single path
        pathEntry = e;
    });

    if(pathEntry.queryCalcs) 
        // a simple value
        return pathEntry.queryCalcs;
    else if(pathEntry.unionQueryCalcs) 
        // multiple dominated nodes, including some which are not simple
        return pathEntry.unionQueryCalcs;
    else if(pathEntry.simpleQueryCalcs)
        // one or more dominated nodes, all simple (not negation/projection)
        return pathEntry.simpleQueryCalcs;
        
    // in case of a negated node, possibly a single dominated node
    if(entry.negationId) {
        if(pathEntry.dominated !== undefined && pathEntry.dominated.size == 1) {
            var dominatedEntry;
            pathEntry.dominated.forEach(function(e, dominatedId) {
                dominatedEntry = e;
            });
            return dominatedEntry.queryCalcs;
        } else {
            // not a negated node, may have been propagated upward
            for(var parentId = this.getParentDataElement(elementId) ; parentId ;
                parentId = this.getParentDataElement(parentId)) {
                var parentEntry = this.queryTree.get(parentId);
                if((pathEntry = parentEntry.paths.get(pathId)) === undefined)
                    return undefined;
                var dominatedEntry;
                if(!pathEntry.dominated || 
                   !(dominatedEntry = pathEntry.dominated.get(elementId)))
                    return undefined; // the element was not propagated
                if(dominatedEntry.queryCalcs)
                    return dominatedEntry.queryCalcs;
                if(pathEntry.simpleQueryCalcs)
                    return pathEntry.simpleQueryCalcs;
            }
        }
        
        return undefined;
    }
}

// Given an active element ID (see definition in the introduction)
// which is an intersection node, this function returns the query
// calculation nodes for the given path under this element ID. These
// are found through the path entry for the given path ID (this
// function should be called only if such an entry exists, if it does
// not exist, the function returns undefined).  If the path entry
// holds a terminal value, the query calculation nodes are found
// inside the path entry. Next, the function checks whether the path
// entry has unionQueryCalcs defined, and if this is not defined,
// simpleQueryCalcs. If both of these are not defined, the path entry
// can only hold a single dominated element. If the value under that 
// dominated entry is 'true', the search should continue recursively for 
// the same path and the dominated element (since the dominated element
// has no siblings, the path was propagated without shortening). 
// Otherwise, the dominated entry must carry the queryCalcs. 

Query.prototype.getQueryCalcsForPath = queryGetQueryCalcsForPath;

function queryGetQueryCalcsForPath(elementId, pathId)
{
    var elementEntry = this.queryTree.get(elementId);
    if(!elementEntry)
        return undefined;

    var pathEntry = elementEntry.paths.get(pathId);
    if(!pathEntry)
        return undefined;

    return this.getQueryCalcsForPathEntry(pathId, pathEntry);
}

// This function implements getQueryCalcsForPath() after the path entry
// for the given element ID and path ID has been retrieved (this should
// be 'pathEntry' and 'pathId' should be the path under which it was stored).
// This allows function which already retrieved 'pathEntry' to skip the
// repeated lookup of this path entry which would take place if
// getQueryCalcsForPath() was called.

Query.prototype.getQueryCalcsForPathEntry = queryGetQueryCalcsForPathEntry;

function queryGetQueryCalcsForPathEntry(pathId, pathEntry)
{
    if(pathEntry.queryCalcs !== undefined)
        return pathEntry.queryCalcs;
    if(pathEntry.unionQueryCalcs !== undefined)
        return pathEntry.unionQueryCalcs;
    if(pathEntry.simpleQueryCalcs !== undefined)
        return pathEntry.simpleQueryCalcs;
    
    // remaining possibility: a single dominated node
    var queryCalcs;
    var _self = this;
    pathEntry.dominated.forEach(function(domEntry, dominatedId) {
        if(domEntry == true)
            queryCalcs = _self.getQueryCalcsForPath(dominatedId, pathId);
        else
            queryCalcs = domEntry.queryCalcs;
    });

    return queryCalcs;
}

// This function is either called during the update propagation process at the
// end of the update propagation for updates under the element entry 
// for the element with ID 'elementId' or when query calcualtion nodes
// are assigned to new root query calculation nodes. In the first case, 
// newRootIds is undefined and the function applies to all root query 
// calculation nodes and in the second case, newRootIds is an attribute-value
// object whose attributes are the IDs of the root query calculation nodes
// for which query calculation nodes need to be added.
// In both cases, this function is called when the entry for this 
// element and all dominated nodes in the queryTree structure have
// already been updated and the required query calculation nodes 
// were assigned to the dominated nodes in the query structure
// (including the path entries under this element entry). In the first case
// (no 'newRootIds') This function may also receives (in 'updatedPathIds') 
// an object whose attributes are the path IDs of those path entries
// under the element entry of 'elementId' for which an update just took
// place.
// This function then determines whether this element entry represents an 
// intersection node and should be assigned intersection query calculation 
// nodes. 
// If it should, but no query calculation nodes were yet assigned, or
// a newRootIds list is given, this function creates the intersection
// query calculation nodes for this element entry (for the root query
// calculation nodes in newRootId, if given and otherwise for all root
// query calculation nodes) and inserts the dominated query
// calculation nodes under them.
// If query calculation nodes should be assigned, and intersection
// query calculation nodes were already assigned (and no 'newRootId'
// list is given), this function goes over the list of updated path
// IDs and for each of these paths, re-inserts the query calculation
// nodes associated with that path under the intersection query
// calculation nodes (this insertion may be superfulous, but costs
// little, as the intersection query calculation node can immediately
// determine whether a certain query calculation sub-node is new or
// not).
// If no query calculation nodes should be assigned to this 
// element entry but such nodes are assigned, these nodes are destroyed
// (this should not happen when newRootIds is given).
// This function is also responsible for assigning the root query 
// calculation node to the top query calculation node. The top 
// query calculation node is the query calculation node assigned to the
// entry of element ID 0, or, if no query calculation node is assigned
// to that entry, the query calculation node assigned to the single path
// of that entry. As this function is called for element ID at the
// end of every update cycle in which the top query calculation node
// may need to be assigned, this is the right place to determine the
// top query calculation node. 

Query.prototype.updateElementEntryQueryCalcs = 
    queryUpdateElementEntryQueryCalcs;

function queryUpdateElementEntryQueryCalcs(elementId, updatedPathIds, 
                                           newRootIds)
{
    if(this.rootQueryCalcs.size == 0)
        return; // nothing to update

    var elementEntry = this.queryTree.get(elementId);
    if(!elementEntry)
        return; // element entry deleted since queued

    // should this element entry intersection carry query calculation nodes?
    var requiresQueryCalcs = (elementEntry.paths.size > 1 && 
                              (elementId == 0 ||
                               elementEntry.negationId !== undefined ||
                               this.hasSiblings(elementId)));

    if(!requiresQueryCalcs) {
        this.removeAllElementEntryQueryCalcs(elementId, elementEntry);
        return;
    }

    // find the sub-nodes to insert into the intersection query
    // calculation nodes. If creating new intersection nodes, for each path 
    // there should be one, otherwise, only for the updated paths
    var subNodesByPath = new Map();
    var _self = this;
    if(updatedPathIds !== undefined)
        updatedPathIds.forEach(function(entry, pathId){
            var pathEntry = elementEntry.paths.get(pathId);
            var subQueryCalcs = pathEntry === undefined ? undefined :
                _self.getQueryCalcsForPathEntry(pathId, pathEntry);
            if(subQueryCalcs !== undefined)
                subNodesByPath.set(pathId, subQueryCalcs);
        });
    else
        elementEntry.paths.forEach(function(pathEntry, pathId) {
            subNodesByPath.set(pathId,
                               _self.getQueryCalcsForPathEntry(pathId,
                                                               pathEntry));
        });

    var queryCalcs = elementEntry.queryCalcs;
    
    if(queryCalcs && !newRootIds) {
        // update the existing intersection query calculation nodes
        // with the (possibly) modified sub-nodes.
        subNodesByPath.forEach(function(subNodes, pathId) {
            queryCalcs.forEach(function(queryCalc, rootId) {
                queryCalc.addSubNode(subNodes.get(rootId));
            });
        }); 
    } else { // create the intersection query calculation nodes, as needed

        var createFunc = function(rootQueryCalc) {
            var queryCalc = rootQueryCalc.newIntersectionQueryCalc();
            var rootId = rootQueryCalc.getId();
            subNodesByPath.forEach(function(subNodes, pathId) {
                queryCalc.addSubNode(subNodes.get(rootId));
            });
            if(elementId == 0)
                queryCalc.assignAsRoot();
            return queryCalc;
        };

        if(queryCalcs === undefined)
            elementEntry.queryCalcs = this.createAllQueryCalcs(createFunc);
        else if(newRootIds !== undefined)
            this.createNewQueryCalcs(queryCalcs, newRootIds, createFunc);
    }
}

// This function implements updateElementEntryQueryCalcs() for the case
// where it has been determined that there should not be any query
// calculation nodes at the element entry 'elementEntry' which is the
// entry for 'elementId' in the query tree. This function removes any
// existing query calculation nodes at 'elementEntry'

Query.prototype.removeAllElementEntryQueryCalcs = 
    queryRemoveAllElementEntryQueryCalcs;

function queryRemoveAllElementEntryQueryCalcs(elementId, elementEntry) 
{
    if(elementEntry.queryCalcs) { // remove the existing query calculation nodes
        this.destroyQueryCalcs(elementEntry.queryCalcs);
        elementEntry.queryCalcs = undefined;
    }

    if(elementId !== 0)
        return;
    
    // assign the path query calculation nodes as the top query 
    // calculation nodes (this does no harm even if already set).
    var top;
    var _self = this;
    elementEntry.paths.forEach(function(pathEntry, pathId) {
        // single iteration
        top = _self.getQueryCalcsForPathEntry(pathId, pathEntry);
        top.forEach(function(queryCalc, rootId) {
            queryCalc.assignAsRoot();
        });
    });
}

// This function is either called after all the updates at the given path entry
// under the given element entry were propagated or when query calculation 
// nodes are assigned to new root query calculation nodes. In the first case, 
// newRootIds is undefined and the function applies to all root query 
// calculation nodes and in the second case, newRootIds is an attribute-value
// object whose attributes are the IDs of the root query calculation nodes
// for which query calculation nodes need to be added. 
// The function checks whether query calculation nodes need to be assigned 
// at this path entry. Query calculation nodes which were already assigned 
// but no longer need to be assigned, are destroyed (this should not happen
// when newRootIds is defined). Query calculation nodes which were not
// yet assigned but should be assigned, are created and their sub-nodes
// or values are assigned to them. If newRootIds is given, query calculation
// nodes are only created for the root query calculation nodes in this 
// list.
// This function is responsible for both the query calculation nodes
// at the path entry and for the query calculation nodes at the dominated
// entries under the path entry.
// The function updateTerminalEntryQueryCalcs() is used to perform the
// update for the individual dominated entries in the pathEntry
// (if dominated entries exist) or for the single terminal value
// at the path entry. The descision whether query calculation
// nodes for these terminal values are needed depend on whether
// these values a propagated further or not.
// If the path entry holds dominated entries then after updating the 
// query calculation node for those dominated entries, this function
// determines whether a union node needs to be created for the whole
// path entry.

Query.prototype.updatePathEntryQueryCalcs = 
    queryUpdatePathEntryQueryCalcs;

function queryUpdatePathEntryQueryCalcs(elementId, pathId, newRootIds)
{
    if(this.rootQueryCalcs.size === 0)
        return; // nothing to update

    var elementEntry = this.queryTree.get(elementId);
    if(elementEntry === undefined)
        return;

    var pathEntry = elementEntry.paths.get(pathId);
    if(pathEntry === undefined)
        return;

    if(pathEntry.type !== undefined) {
        // the value is not propagated iff the element has siblings and
        // the path of the element (with ID elementId) is not equal 
        // to pathId or if the element entry is negated.
        var requiresQueryCalcs = (elementEntry.negationId !== undefined) ||
            (this.hasSiblings(elementId) &&
             (!this.isSimpleType(pathEntry.type) ||
              this.getElementPathId(elementId) != pathId));
        this.updateTerminalEntryQueryCalcs(elementId, pathEntry, pathId, 
                                           undefined, undefined, 
                                           requiresQueryCalcs, newRootIds);
    } else if(pathEntry.dominated !== undefined) {
        // the dominated values require a query calculation node if they
        // are not 'true' (this is determined inside 
        // updateTerminalEntryQueryCalcs) and if elementId has siblings 
        // or multiple paths or the element ID is the top one or a negated
        // node.
        var requiresQueryCalcs = 
            (elementEntry.negationId !== undefined || elementId == 0 || 
             this.hasSiblings(elementId) || elementEntry.paths.size > 1);
        var _self = this;
        pathEntry.dominated.forEach(function(domEntry, dominatedId) {
            _self.updateTerminalEntryQueryCalcs(elementId, pathEntry, pathId, 
                                                dominatedId, domEntry, 
                                                requiresQueryCalcs, newRootIds);
        });
    }

    // check whether union query calculation nodes are required and,
    // create or destroy them as needed. If needed, update with all 
    // dominated query calculation nodes.
    this.updateUnionQueryCalcs(elementId, elementEntry, pathEntry, undefined, 
                               undefined, newRootIds);
}

// This function is called after the dominated entry under the given
// path in the element entry of 'elementId' has been propagated.
// This is also called from within updatePathEntryQueryCalcs() for each
// dominated entry under the path entry (updatePathEntryQueryCalcs()
// is called when the whole path entry has been propagated).
// This function determines whether the dominated entry should
// be assigned query calculation nodes and whether the path entry needs
// to be assigned union or simple query calculation nodes to store
// the values or query calcualtion nodes of the dominated entry.
// It creates query calculation nodes where needed and destroys them
// where they are not needed.
// When the value of an existing entry has changed, this function 
// does not need to remove the old value from the query calculation 
// nodes (and destroy those nodes if they are not of the type required
// by the new value). This was already taken care of at the moment of
// update. This function needs to carry out the following updates:
// 1. If a dominated entry carries a value (not 'true') which is 
//    not propagated, a query calculation node needs to be created for
//    it. If the type of the value is 'negation' or 'projection',
//    query calculation nodes of the corresponding type need to be created
//    on the dominated entry itself. Otherwise (if the value is a
//    simple value) simple query calculation nodes need to be created
//    at the path entry and the value of the dominated entry added
//    to these simple query calculation nodes.
// 2. If the dominated element IDs are not propagated and there is
//    more than one such dominated element ID and there is at least
//    one dominated element ID which is not a simple value (that is,
//    'true', a projection or negation value) then union query calculation
//    nodes need to be created at the path entry. 

Query.prototype.updateDominatedEntryQueryCalcs = 
    queryUpdateDominatedEntryQueryCalcs;

function queryUpdateDominatedEntryQueryCalcs(elementId, pathId, dominatedId) 
{
    if(this.rootQueryCalcs.size === 0)
        return; // nothing to update

    var elementEntry = this.queryTree.get(elementId);
    if(elementEntry === undefined)
        return;

    var pathEntry = elementEntry.paths.get(pathId);
    if(pathEntry === undefined || pathEntry.dominated === undefined)
        return;

    var dominatedEntry = pathEntry.dominated.get(dominatedId);
    if(dominatedEntry === undefined)
        return;

    // is this a terminal value which is not propagated?
    var requiresQueryCalcs = 
        (dominatedEntry !== true && 
         (elementId == 0 || elementEntry.negationId !== undefined ||
          this.hasSiblings(elementId) || elementEntry.paths.size > 1));

    // update the query calculation nodes for this one terminal value
    this.updateTerminalEntryQueryCalcs(elementId, pathEntry, pathId, 
                                       dominatedId, dominatedEntry, 
                                       requiresQueryCalcs);

    // check whether union query calculation nodes are required and,
    // create or destroy them as needed. If needed and already exist,
    // update them with the query calculation nodes of the dominated entry.
    this.updateUnionQueryCalcs(elementId, elementEntry, pathEntry, dominatedId, 
                               dominatedEntry);
}

// This function is called to update the query calculation nodes for
// a single terminal value in the queryTree table, that is, either for
// a path entry carrying a single value or a dominated entry inside
// a path entry ('elementId' is the ID of the element entry inside which 
// the path entry is stored). If dominatedId is undefined, the update is for 
// a terminal value stored directly under the path entry given in 
// 'pathEntry' and otherwise, 'dominatedEntry' is the dominated entry
// carrying the terminal value. 'pathId' is the ID of the path under which
// 'pathEntry' is stored. 'requiresQueryCalcs' indicates
// whether query calculation nodes need to be created here for this
// terminal value (which is iff the value is not propagated).
// If the value fo the entry is 'true', 'requiresQueryCalcs' is always 
// set automatically to false.
// 'newRootId' may optionally be given. If given, it holds an object
// whose attributes are the IDs of the root query calculation nodes
// for which the update should take place. If this list is not provided,
// the update takes place for all root query calculation nodes. 

// If no query calculation nodes are required but they exist, this
// function destroys them (this should not happen when called with a
// newRootIds list). If they are required but do not exist (for the
// relevant query calculation nodes), they are created and updated
// with the required values. If they are required and exist, they are
// updated with the value.  This does not update the union query
// calculation nodes at the path entry. This is the responsibility of
// a different function.  Note: this function is not required to
// remove any old query calculation nodes or remove old values from
// the query calculation nodes because of type changes or the removal
// of old values. All these removals have already taken place.

Query.prototype.updateTerminalEntryQueryCalcs = 
    queryUpdateTerminalEntryQueryCalcs;

function queryUpdateTerminalEntryQueryCalcs(elementId, pathEntry, pathId, 
                                            dominatedId, dominatedEntry, 
                                            requiresQueryCalcs, newRootIds) 
{
    var entry = dominatedId ? dominatedEntry : pathEntry;

    if(!requiresQueryCalcs || entry === true) { // never requires query calcs
        // no query calcs required, remove any if they exist
        this.removeAllTerminalEntryQueryCalcs(elementId, pathEntry, pathId, 
                                              dominatedId, dominatedEntry);
        return;
    }
    
    if(entry.type == "negation") {
        this.updateNegationEntryQueryCalcs(entry, pathId, newRootIds);
        return;
    }
    
    var isSimple = this.isSimpleType(entry.type);
    // if simple value is stored directly under hte path, we use
    // 'queryCalcs' and not 'simpleQueryCalcs'
    var useSimpleQueryCalcs = (dominatedId && isSimple);
    var queryCalcs = useSimpleQueryCalcs ? 
        pathEntry.simpleQueryCalcs : entry.queryCalcs;

    if(isSimple) { 
        // update the value on the simple query calculation nodes on the
        // path entry (create the nodes if needed).
        var valueId = (dominatedId === undefined) ? elementId : dominatedId;
        if(queryCalcs !== undefined) {
            if(newRootIds !== undefined) {
                // some query calculation nodes exist and we only add values
                // the the new roots
                this.addValueToSimpleQueryCalc(queryCalcs, newRootIds,
                                               pathId, valueId, entry.type,
                                               entry.key);
            } else // no new roots, add the value only to existing query calcs
                queryCalcs.forEach(function(queryCalc, rootId) {
                    queryCalc.addValue(valueId, entry.type, entry.key);
                });
            return;
        }
        var createFunc = function(rootQueryCalc) {
            var queryCalc = rootQueryCalc.newSimpleQueryCalc(pathId);
            queryCalc.addValue(valueId, entry.type, entry.key);
            return queryCalc;
        };
        
    } else if(entry.type == "true") {
        // boolean 'true' query
        var valueId = (dominatedId === undefined) ? elementId : dominatedId;
        createFunc = function(rootQueryCalc) {
            return rootQueryCalc.newTrueQueryCalc(pathId, valueId);
        };

    } else { // projection
        createFunc = function(rootQueryCalc) {
            return rootQueryCalc.newProjectionQueryCalc(pathId);
        };
    }

    if(queryCalcs === undefined) {
        queryCalcs = this.createAllQueryCalcs(createFunc);
        if(useSimpleQueryCalcs)
            pathEntry.simpleQueryCalcs = queryCalcs;
        else
            entry.queryCalcs = queryCalcs;
    }
    else if(newRootIds !== undefined)
        this.createNewQueryCalcs(queryCalcs, newRootIds, createFunc);
}

// This function implements updateTerminalEntryQueryCalcs() for the
// case where query calculation nodes are not required on the relevant
// terminals. This function is called to remove all query calculation nodes for
// a single terminal value in the queryTree table, that is, either for
// a path entry carrying a single value or a dominated entry inside
// a path entry ('elementId' is the ID of the element entry inside which 
// the path entry is stored). If dominatedId is undefined, the update is for 
// a terminal value stored directly under the path entry given in 
// 'pathEntry' and otherwise, 'dominatedEntry' is the dominated entry
// carrying the terminal value. 'pathId' is the ID of the path under which
// 'pathEntry' is stored.

Query.prototype.removeAllTerminalEntryQueryCalcs = 
    queryRemoveAllTerminalEntryQueryCalcs;

function queryRemoveAllTerminalEntryQueryCalcs(elementId, pathEntry, pathId, 
                                               dominatedId, dominatedEntry)
{
    var entry = dominatedId ? dominatedEntry : pathEntry;
    var isSimple = this.isSimpleType(entry.type);
    // if simple value is stored directly under the path, we use
    // 'queryCalcs' and not 'simpleQueryCalcs'
    var useSimpleQueryCalcs = (dominatedId && isSimple);
    var queryCalcs = useSimpleQueryCalcs ? 
        pathEntry.simpleQueryCalcs : entry.queryCalcs;
    if(queryCalcs === undefined)
        return; // nothing to do

    // destroy the existing query calcualtion nodes
    this.destroyQueryCalcs(queryCalcs);
    
    if(useSimpleQueryCalcs)
        pathEntry.simpleQueryCalcs = undefined;
    else
        entry.queryCalcs = undefined;
}

// This function implements 'updateTerminalEntryQueryCalcs()' in the
// case that the entry type is "negation" and that query calculation
// nodes need to be assigned. Many of the decisions were already
// received by updateTerminalEntryQueryCalcs() (among other things,
// this function is only called if this entry requires query
// calculation nodes to be assigned to it) so this function receives a
// smaller set of iput arguments: 'negationEntry' is either a path
// entry or a dominated node entry which carries the negation key
// (list of negated nodes). 'pathId' is the path at which the negation
// takes place (this is the path of the path entry under which this
// negation falls).  Finally, 'newRootIds' is the same as in
// updateTerminalEntryQueryCalcs().  When this function is called, it
// is assumed that the query calculation nodes for the negated nodes
// dominated by this negation have already been generated, so here
// they are only fetched.

Query.prototype.updateNegationEntryQueryCalcs = 
    queryUpdateNegationEntryQueryCalcs;

function queryUpdateNegationEntryQueryCalcs(negationEntry, pathId, 
                                            newRootIds) 
{
    var queryCalcs = negationEntry.queryCalcs;

    // create negation nodes where needed
    
    if(!queryCalcs || newRootIds) {
        
        var createFunc = function(rootQueryCalc) {
            return rootQueryCalc.newNegationQueryCalc(pathId);
        }
        if(!queryCalcs) {
            queryCalcs = negationEntry.queryCalcs =
                this.createAllQueryCalcs(createFunc);
        } else
            this.createNewQueryCalcs(queryCalcs, newRootIds, createFunc);
    }
    
    // update the negated nodes on the negation node. We only have to
    // add the sub-nodes, as negated sub-nodes which were removed from the
    // negation value were already removed from the query calculation nodes.

    var _self = this;
    negationEntry.key.getNegated().forEach(function(e, negatedId) {
        var negatedQueryCalcs = _self.getQueryCalcsForElement(negatedId);
        if(newRootIds !== undefined) {
            newRootIds.forEach(function(e, rootId) {
                queryCalcs.get(rootId).
                    addSubNode(negatedQueryCalcs.get(rootId));
            });
        } else
            queryCalcs.forEach(function(queryCalc, rootId) {
                queryCalc.addSubNode(negatedQueryCalcs.get(rootId));
            });
    })
}


// This function updates the union query calculation nodes stored
// at the given path entry (which is stored under the given element entry).
// 'newRootId' may optionally be given. If given, it holds an object
// whose attributes are the IDs of the root query calculation nodes
// for which the update should take place. If this list is not provided,
// the update takes place for all root query calculation nodes. 
// If union query calculation nodes are required but do not yet exist, they are
// created. If they are not required but exist, they are destroyed
// (this should not happen if newRootIds is given).
// Optionally, a dominated element ID may be given, together the 
// entry for that dominated element under the path entry. If the dominated
// element ID is given, then this function was called after the query 
// calculation nodes for this dominated entry were updated. In this case,
// if the function determines that union query calculation nodes should
// be defined on the given path entry and such nodes are already defined,
// this function only makes sure that the query calculation nodes for
// the dominated entry are added to the union query calculation nodes
// (htey may already be inserted). In other case (if no dominated ID 
// is given or if the union query calculation nodes are created) the
// query calculation nodes of all dominated nodes are added under the 
// union node.

Query.prototype.updateUnionQueryCalcs = 
    queryUpdateUnionQueryCalcs;

function queryUpdateUnionQueryCalcs(elementId, elementEntry, pathEntry, 
                                    dominatedId, dominatedEntry, newRootIds) 
{
        // need union nodes? (iff there is no propagation and there is more than 
    // one sub-node and not all values are simple)
    var needUnion = 
        (pathEntry.dominated !== undefined && pathEntry.dominated.size > 1 &&
         pathEntry.dominated.size > pathEntry.numSimpleValues &&
         (elementId == 0 || elementEntry.paths.size > 1));

    if(!needUnion) {
        if(pathEntry.unionQueryCalcs) {
            // union nodes not required, remove the existing nodes
            // (should not be called when newRootIds is deifned).
            pathEntry.unionQueryCalcs.forEach(function(queryCalc, rootId) {
                queryCalc.splice();
            });
            pathEntry.unionQueryCalcs = undefined;
        }
        return;
    }
    
    // union node required
    var queryCalcs = pathEntry.unionQueryCalcs;
    if(!queryCalcs || newRootIds) {
        var createFunc = function(rootQueryCalc) {
            return rootQueryCalc.newUnionQueryCalc();
        };
        if(!queryCalcs) {
            queryCalcs = pathEntry.unionQueryCalcs =
                this.createAllQueryCalcs(createFunc);
        } else if(newRootIds)
            this.createNewQueryCalcs(queryCalcs, newRootIds, createFunc);

        // insert all dominated nodes under the union nodes
        var _self = this;
        pathEntry.dominated.forEach(function(dominatedEntry, dominatedId) { 
            _self.insertUnderUnionQueryCalcs(pathEntry, dominatedId, 
                                             dominatedEntry, newRootIds);
        });
    } else if(dominatedId !== undefined)
        // insert the given dominated node under the union node
        this.insertUnderUnionQueryCalcs(pathEntry, dominatedId, 
                                        dominatedEntry, newRootIds);
}

// This function receives a path entry on which union query calculation
// nodes are defined and the ID and entry of one of the dominated elements
// inside that path entry. It then finds the query calculation nodes
// for the given dominated element and inserts them under the corresponding
// union query calculation nodes.
// 'newRootId' may optionally be given. If given, it holds an object
// whose attributes are the IDs of the root query calculation nodes
// for which the update should take place. If this list is not provided,
// the update takes place for all root query calculation nodes. 

Query.prototype.insertUnderUnionQueryCalcs = 
    queryInsertUnderUnionQueryCalcs;

function queryInsertUnderUnionQueryCalcs(pathEntry, dominatedId, 
                                         dominatedEntry, newRootIds)
{
    var unionQueryCalcs = pathEntry.unionQueryCalcs;

    var dominatedQueryCalcs;
    if(dominatedEntry === true)
        // the dominated query calculation node is not stored here,
        // must retrieve it by element ID.
        dominatedQueryCalcs = this.getQueryCalcsForElement(dominatedId);
    else if(dominatedEntry.queryCalcs)
        dominatedQueryCalcs = dominatedEntry.queryCalcs;
    else // must be a simple type
        dominatedQueryCalcs = pathEntry.simpleQueryCalcs;

    if(!dominatedQueryCalcs)
        return; // may not be ready yet, will be added again later

    if(newRootIds !== undefined)
        newRootIds.forEach(function(e, rootId) {
            unionQueryCalcs.get(rootId).
                addSubNode(dominatedQueryCalcs.get(rootId));
        });
    else {
        unionQueryCalcs.forEach(function(queryCalc, rootId) {
            queryCalc.addSubNode(dominatedQueryCalcs.get(rootId));
        });
    }
}

// This function destroys all query calculation nodes stored under the
// given path entry in the queryTree table. This includes destroying 
// query calculation nodes stored under entries in the 'dominated'
// table of the path entry. After the query calculation nodes are destroyed,
// the table holding them in the path entry is replaced with undefined.

Query.prototype.removePathEntryQueryCalcs = queryRemovePathEntryQueryCalcs;

function queryRemovePathEntryQueryCalcs(pathEntry)
{
    if(this.rootQueryCalcs.size == 0)
        return; // no query calculation nodes
    
    // destroy any dominated query calculation nodes stored on the dominated
    // entries
    if(pathEntry.dominated !== undefined) {
        var _self = this;
        pathEntry.dominated.forEach(function(dominatedEntry, dominatedId) {
            if(dominatedEntry === true ||
               dominatedEntry.queryCalcs === undefined)
                return;
            _self.destroyQueryCalcs(dominatedEntry.queryCalcs);
            dominatedEntry.queryCalcs = undefined;
        });
    }

    if(pathEntry.queryCalcs !== undefined) {
        this.destroyQueryCalcs(pathEntry.queryCalcs);
        pathEntry.queryCalcs = undefined;
    }

    if(pathEntry.unionQueryCalcs !== undefined) {
        this.destroyQueryCalcs(pathEntry.unionQueryCalcs);
        pathEntry.unionQueryCalcs = undefined;
    }

    if(pathEntry.simpleQueryCalcs !== undefined) {
        this.destroyQueryCalcs(pathEntry.simpleQueryCalcs);
        pathEntry.simpleQueryCalcs = undefined;
    }
}

// This function is called with a path entry in the queryTree
// structure and a dominated entry which is/was stored under it
// (dominatedId is the dominated element's ID). At the time this
// function is called, the dominated entry was already removed from
// the path entry or its value has changed, but the dominated entry is 
// still available and its previous type is available in 'prevType'. 
// This may be called when either the dominated entry is removed or
// its type changes in such a way that the same query calculation 
// nodes (if existed) can no longer be used. This function then clears
// the old query calculation nodes (but does not create any new ones - 
// this will happen later).
// The function destroys any query calculation nodes stored under the
// domianted entry. In addition, if the dominated entry previous type
// was a simple type, and the path entry has simple query calculation
// nodes defined, then this dominated entry's value must be removed
// from the simple query calculation nodes.  If this is the last
// simple value stored in the simple query calculation node, that node
// is destroyed.
// If union query calculation nodes are defined on the path entry and
// as a result of this operation only one query calculation node
// remains under the union node, the union node is not needed anymore at
// the moment. We do need, however, to distinguish between two case.
// In the first case, the single query calculation node dominated 
// by the union node is a simple query calculation node. This may hold
// multiple values. On the other hand, any other node under the 
// union query calculation node means that only one dominated 
// element is left at the path entry and therefore the removal which just
// took place changed the 'has siblings' property from true to false.
// This entails the scheduling of the re-propagation of that value. Since
// this repropagation will first remove the current update, the union 
// node will first be emptied, so we can wait with its destruction
// until this happens.

Query.prototype.removeDominatedEntryQueryCalcs = 
    queryRemoveDominatedEntryQueryCalcs;

function queryRemoveDominatedEntryQueryCalcs(pathEntry, dominatedId, 
                                             dominatedEntry, prevType)
{
    if(this.rootQueryCalcs.size == 0)
        return; // no query calculation nodes
    
    if(dominatedEntry.queryCalcs !== undefined) {
        this.destroyQueryCalcs(dominatedEntry.queryCalcs);
        dominatedEntry.queryCalcs = undefined;
    } else if(this.isSimpleType(prevType) && pathEntry.simpleQueryCalcs) {
        // remove the value from the query calculation nodes
        if(pathEntry.numSimpleValues == 0) {
            this.destroyQueryCalcs(pathEntry.simpleQueryCalcs);
            pathEntry.simpleQueryCalcs = undefined;
        } else {
            pathEntry.simpleQueryCalcs.forEach(function(queryCalc, rootId) {
                queryCalc.removeValue(dominatedId);
            });
        }
    }

    if(dominatedEntry.unionQueryCalcs !== undefined) {
        // should the union node be removed ?
        var dominatedNum = dominatedEntry.dominated === undefined ?
            0 : dominatedEntry.dominated.size;
        if(dominatedNum === 0) { // empty union node
            this.destroyQueryCalcs(pathEntry.unionQueryCalcs);
            dominatedEntry.unionQueryCalcs = undefined;
        } else if(dominatedNum == dominatedEntry.numSimpleValues) {
            // If all dominated values are simple (and therefore
            // handled by the simple query calculation node) the union
            // node should be spliced out of the chain.
            dominatedEntry.unionQueryCalcs.forEach(function(queryCalc, rootId){
                // This inserts the simple query calculation node directly under
                // the parent
                queryCalc.splice();
            });
            dominatedEntry.unionQueryCalcs = undefined;
        }
    }
}

// This function is called when the value under a path entry or a 
// dominated entry is changed (if 'dominatedId' is undefined, the change
// is directly under the path entry and otherwise under the dominated entry). 
// This function is not called if dominated entries were added or removed,
// so if 'dominatedId' is given, both the old and the new value are 
// stored under this dominated ID, and if dominatedId is not given, both
// the old and the new value are stored directly in the path entry. 
// The function is provided with the path entry, the previous
// type and key of the changed entry (path or dominated), and, if neede, the 
// dominated entry, and the ID of the dominated node. If given, the dominated 
// entry is the object stored under the dominated ID before the update, 
// but the update may have changed this object, if the same entry object 
// continues to be used (but if the dominated entry was replaced by 'true' then
// the dominated object received here is still the old one, which 
// may carry query calculation nodes). The path entry is the same 
// for the old value and the new value, and, when this function is called,
// already stores the new value.
// This function checks whether the type of the modified entry has changed
// in such a way that the query calculation nodes assigned to this
// modified entry (if any) cannot continue to store the new value.
// If this is the case, the query calculation nodes are destroyed
// (the new query calculation nodes will be assigned later, during the 
// propagation process).
// This function does not check whether query calculation nodes still
// need to be created for this modified entry. This will be checked 
// later. The only purpose of this function is to handle situations
// where query calculation node were required both before and after
// the update, but the query calculation nodes are different.
// This function also handles changes which replace an existing 
// negation key with a new negation key. In this case, the negated 
// nodes which appear in the old key but not in the new one need to
// be removed (the new negated keys do not need to be added here, they
// will be added later).  

Query.prototype.clearQueryCalcsAfterValueChange = 
    queryClearQueryCalcsAfterValueChange;

function queryClearQueryCalcsAfterValueChange(pathEntry, dominatedId, 
                                              dominatedEntry, prevType, prevKey)
{
    if(this.rootQueryCalcs.size == 0 || prevType == undefined)
        return; // nothing to do
    
    // the new type, may be undefined for a dominated entry
    var newType = dominatedId ? 
        pathEntry.dominated.get(dominatedId).type : pathEntry.type;
    var entry = dominatedId ? dominatedEntry : pathEntry;
    var queryCalcs;

    if(newType == "negation" && prevType == "negation") {
        if(!(queryCalcs = entry.queryCalcs))
            return; // no query calculation nodes to clear
        // need to compare the old and new key and remove those negated
        // nodes which appear in the old key but not in the new one
        var _self = this;
        prevKey.getNegated().forEach(function(e, negatedId) {
            if(entry.key.isNegated(negatedId))
                return; // remains negated in new key
            var negatedQueryCalcs = _self.getQueryCalcsForElement(negatedId);
            if(!negatedQueryCalcs)
                return; // already removed
            queryCalcs.forEach(function(queryCalc, rootId) {
                queryCalc.removeSubNode(negatedQueryCalcs.get(rootId).getId());
            });
        });
        return;
    }

    if(this.isSimpleType(prevType) != this.isSimpleType(newType) ||
       (prevType == "negation" && newType != "negation") ||
       (prevType == "projector" && newType != "projector")) {
        // the type changed in such a way that the old entry needs to 
        // be removed
        if(dominatedId)
            this.removeDominatedEntryQueryCalcs(pathEntry, dominatedId,
                                                dominatedEntry, prevType);
        else
            this.removePathEntryQueryCalcs(pathEntry);
    }
}

// This function receives an object 'rootIds' whose attributes are
// root query calculation IDs (or 'rootIds' may be a single such ID)
// and it generates the query calculation nodes for these root query
// calculation nodes (which should already be in the 'rootQueryCalcs'
// list). This function is implemented recursively by
// generateQueryCalcsFor() which it calls with the virtual root data
// element.

Query.prototype.generateQueryCalcs = queryGenerateQueryCalcs;

function queryGenerateQueryCalcs(rootIds)
{
    if(typeof(rootIds) != "object") {
        // the function below requires an object as input
        var rootIdMap = new Map();
        rootIdMap.set(rootIds, true);
        rootIds = rootIdMap;
    }

    this.generateQueryCalcsFor(rootIds, 0);
}

// This function receives an object 'rootIds' whose attributes are
// root query calculation IDs, a data element ID stored in queryTree
// and, optionally, a path ID (which should appear in the entry of
// this element). It then generates the query calculation nodes for
// the query under the given element ID and (if given) path for the
// give root query calculation nodes.
// The process is recursive, beginning at the top of the query tree
// and descending down the paths and the dominated node, but the actual
// construction of the query calculation nodes takes place bottom up,
// as the recursive calls return (in this way, the construction process
// is similar to the incremental update process, which is bottom-up).

Query.prototype.generateQueryCalcsFor = queryGenerateQueryCalcsFor;

function queryGenerateQueryCalcsFor(rootIds, elementId, pathId)
{
        var elementEntry = this.queryTree.get(elementId);
    if(!elementEntry)
        return; // query tree not updated yet

    var _self = this;
    
    if(pathId === undefined) {

        // continue recursively to the paths under this element entry
        elementEntry.paths.forEach(function(pathEntry, pathId) {
            _self.generateQueryCalcsFor(rootIds, elementId, pathId)
        });
        // assign intersection query calculation nodes at the element 
        // entry, if needed
        this.updateElementEntryQueryCalcs(elementId, undefined, rootIds);
    } else {
        // path entry (should always exist)
        var pathEntry = elementEntry.paths.get(pathId);
        if(pathEntry.dominated !== undefined &&
           pathEntry.numSimpleValues < pathEntry.dominated.size) {
            // there may be non-terminal dominated nodes under this path,
            // generate query calcs for them first
            pathEntry.dominated.forEach(function(dominatedEntry, dominatedId) {
                if(dominatedEntry === true)
                    _self.generateQueryCalcsFor(rootIds, dominatedId);
                else if(dominatedEntry.type == "negation")
                    _self.generateQueryCalcsForNegated(rootIds,
                                                       dominatedEntry.key);
            });
        } else if(pathEntry.type == "negation") {
            // continue to negated nodes
            this.generateQueryCalcsForNegated(rootIds, pathEntry.key);
        } else if(this.isSimpleType(pathEntry.type) && 
                  elementEntry.negationId === undefined &&
                  (!this.hasSiblings(elementId) || 
                   this.getElementPathId(elementId) == pathId)) {
            // simple type propagated, the query calculation nodes need
            // to be assigned at the parent node.
            this.generateQueryCalcsFor(rootIds, 
                                       this.getParentDataElement(elementId), 
                                       pathId);
            return;
        }
        
        this.updatePathEntryQueryCalcs(elementId, pathId, rootIds);
    }
}

// Given a negation key (object storing set of negated IDs) this function
// generates the query calculation nodes for the negated IDs listed in
// the object. 'rootIds' are as in 'generateQueryCalcsFor()'.

Query.prototype.generateQueryCalcsForNegated =
    queryGenerateQueryCalcsForNegated;

function queryGenerateQueryCalcsForNegated(rootIds, negationKey)
{
    var _self = this;

    negationKey.getNegated().forEach(function(e, negatedId) {
        _self.generateQueryCalcsFor(rootIds, negatedId);
    });
}

// This function receives the ID of a root query calculation node,
// and destroys all query calculation nodes constructed for this root 
// query calculation node. This function is implemented by calling 
// destroyQueryCalcsFor() on the root virtual element ID 0. 

Query.prototype.destroyQueryCalcsForRoot = queryDestroyQueryCalcsForRoot;

function queryDestroyQueryCalcsForRoot(rootId)
{
    this.destroyQueryCalcsFor(rootId, 0);
}

// This function receives the ID of a root query calculation node,
// an elementId and (optionally) a path ID. It then destroys all query 
// calculation nodes constructed for this root query calculation node under
// the given element entry (if pathId is undefined) or the given path entry
// (if pathId is defined). The function applies recursively to the
// query tree, top down. This top-down destruction ensures that 
// the destruction of lower query calculation nodes is not propagated
// as changes to the higher query calculation nodes (as each query
// calculation node is destroyed when its parent has already been destroyed).

Query.prototype.destroyQueryCalcsFor = queryDestroyQueryCalcsFor;

function queryDestroyQueryCalcsFor(rootId, elementId, pathId)
{
    var elementEntry;
    if(!(elementEntry = this.queryTree.get(elementId)))
        return; // query tree not yet created or already removed

    var _self = this;
    
    if(pathId === undefined) {
        this.destroyQueryCalc(this.getQueryCalcsForElement(elementId), rootId);
        // go down the path entries
        elementEntry.paths.forEach(function(pathEntry, pathId) {
            _self.destroyQueryCalcsFor(rootId, elementId, pathId);
        });
        return;
    }
    
    var pathEntry = elementEntry.paths.get(pathId);
    if(pathEntry.queryCalcs) {
        this.destroyQueryCalc(pathEntry.queryCalcs, rootId);
        if(pathEntry.type == "negation") // continue to negated nodes
            _self.destroyQueryCalcForNegated(rootId, pathEntry.key);
        return;
    }
    
    if(pathEntry.unionQueryCalcs) {
        this.destroyQueryCalc(pathEntry.unionQueryCalcs, rootId);
        // continue down the dominated nodes
        this.destroyQueryCalcAtDominatedEntries(rootId, pathEntry);
    }
    
    if(pathEntry.simpleQueryCalcs) {
        this.destroyQueryCalc(pathEntry.simpleQueryCalcs, rootId);
    } else if(pathEntry.dominated !== undefined &&
              pathEntry.dominated.size == 1) {
        // go down the single dominated node (with the same path -
        // because there are no siblings, the path was propagated
        // and the dominated node cannot be an intersection node).
        this.destroyQueryCalcAtDominatedEntries(rootId, pathEntry);
    }
}

// This function destroys the query calculation nodes for the root 
// query calculation node with ID 'rootId' which are stored under the 
// dominated entries of 'pathEntry' or at lower entries dominated by 
// these nodes. Since intersection and union query calculation nodes
// are not stored under dominated entries in the query tree, there 
// are only three possibilities here:
// 1. The dominated entry has a value 'true': this points at the 
//    corresponding element entry (the one for the dominated element ID)
//    and the destroy continues to that entry.
// 2. The dominated entry stores a query calculation node for a simple
//    or projection query calculation node. The node is destroyed and 
//    there are no lower nodes ot look for.
// 3. The dominated entry stores a query calculation node for a negation.
//    In this case, the sub-node of the query calculation node must
//    also be destroyed.

Query.prototype.destroyQueryCalcAtDominatedEntries = 
    queryDestroyQueryCalcAtDominatedEntries;

function queryDestroyQueryCalcAtDominatedEntries(rootId, pathEntry)
{
    var _self = this;
    
    // continue down the dominated nodes
    pathEntry.dominated.forEach(function(dominatedEntry, dominatedId) {
        if(dominatedEntry == true)
            _self.destroyQueryCalcsFor(rootId, dominatedId);
        else if(dominatedEntry.queryCalcs) {
            _self.destroyQueryCalc(dominatedEntry.queryCalcs, rootId);
            if(dominatedEntry.type == "negation")
                // continue to negated nodes
                _self.destroyQueryCalcForNegated(rootId, dominatedEntry.key);
        }
    });
}

// This function removes all negated query calculation nodes whose
// negated element ID is listed in 'negationKey' (a negation node key)
// belonging to the root query calculation node with ID 'rootId'.

Query.prototype.destroyQueryCalcForNegated = queryDestroyQueryCalcForNegated;

function queryDestroyQueryCalcForNegated(rootId, negationKey)
{
    var _self = this;
    negationKey.getNegated().forEach(function(e, negatedId) {
        _self.destroyQueryCalcsFor(rootId, negatedId);
    });
}

//
// Debug Functions
//

// This function returns a JavaScript object representing the query 
// description. 

Query.prototype.debugGetQueryDesc = queryDebugGetQueryDesc;

function queryDebugGetQueryDesc()
{
    if(!this.indexer)
        return "<undefined>";

    var debugObj = new DebugInternalTo(this.indexer.qcm);
    debugObj.setDataElementTable(this.indexer.getDataElements(), 
                                 this.rootPathId);

    this.queryTree.forEach(function(elementEntry, elementId) {
        elementEntry.paths.forEach(function(pathEntry, pathId) {
            if(pathEntry.type) {
                if(pathEntry.type == "negation")
                    debugObj.addValue(0, pathEntry.type, elementId, 
                                      pathId);
                else
                    debugObj.addValue(pathEntry.key, pathEntry.type, elementId, 
                                      pathId);
            }
        });
    });

    return debugObj.getDescStr();
}

// return a string with the query description together with the result ID
// of query result objects which make use of this query

Query.prototype.debugPrintQueryAndResults = queryDebugPrintQueryAndResults;

function queryDebugPrintQueryAndResults()
{
    var resultIds = [];

    // get the results which make use of this query
    
    this.rootQueryCalcs.forEach(function(rootQueryCalc, rootId) {

        var results = rootQueryCalc.getQueryResults();

        results.forEach(function(r, resultId) {
            resultIds.push(resultId);
        });
    });
    
    var resultIdStr;

    if(resultIds.length > 0) {

        resultIdStr = "results: ";
        
        for(var i = 0, l = resultIds.length ; i < l ; ++i) {
            resultIdStr += resultIds[i];
            if(i < l - 1)
                resultIdStr += ", ";
        }
    } else {
        resultIdStr = "<no results registered>"
    }    
    
    return "query " + this.id + " " + this.debugGetQueryDesc() +
        " "+ resultIdStr;
}
