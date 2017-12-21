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

// This file implements the indexer used by the internal QCM. The indexer
// is loaded with data which it indexes. It can then receive registrations
// from query calculation nodes which represent simple queries (a path + 
// simple value selection(s) or projection) and notifies these registered 
// queries of the elements which were matched by them. Every time the data 
// changes, the queries are notified of the changes.
//
// In addition, one can register sub-tree monitors at any data node
// in the tree. These monitors are then notified of all nodes in the indexer
// under the given node.
//
// Using sub-tree monitoring, the indexer is also responsible for
// calculating 'compressed values' for values stored in it (when
// needed).  The compressed values (which are integers) allow to
// determine quickly whether two values (simple or compound) are equal
// or not (this allows quick unification of sets when
// needed). Moreover, the compression values can be used to sort the
// elements in a set, thus allowing to determine quickly whether the
// two sets contain the same elements (ignoring the ordering of the
// sets).
//
// Data Representation (Paths and Data Elements)
// =============================================
//
// The indexer stores data nodes. Each data node is represented by the
// tuple: <path ID, data element ID, type, key>. 
//
// Type and Key
// ------------
//
// The type and key together define the simple value of the node. The type
// is a string which is the name of the type of the value being 
// stored at the data node. It can be something like "string" or "number"
// but also "weight" or "length". The key is a simple JavaScript value
// (number, string or boolean) which is compatible with the type. All keys
// for the same type must have the same JavaScript type. Only values of the
// same type are considered comparable. Therefore, the indexer
// keeps values of different types in separate indexes.
//
// Paths
// -----
//
// Paths are sequences of strings. Each string in such a path is
// called and 'attribute'. There is a central module which allocates
// IDs to these paths, so that anywhere in the system, the same sequence
// of strings is allocated the same path ID. This central path 
// allocation module also provides different auxiliary functions
// on these path ID (for example, finding the path ID of a prefix 
// of a path with a given path ID). For more information, see 
// internalQCMPathIdAllocator.js.
//
// Data Elements
// -------------
//
// A collection of tuples <path ID, type, key> is sufficient ot define 
// a tree data structure (an attribute-value structure). However,
// in order to allow multiple values at the same path (equivalent 
// to inserting an ordered set under a node in the attribute-value
// tree) we use data elements. It is then possible to store different
// simple values under the same path but under different data elements.
// Data elements are special data nodes inside the data which are allocated
// IDs (the 'data element IDs'). The data elements are essentially 
// the node 'immediately dominated by an ordered set'. Below we will
// give more detailed examples and a explanations as to how this 
// representation is related to an attribute-value + ordered-set
// representation, but first we given here the definitions:
//
// 1. A data element d has a path (represented by a path ID) and, unless
//    this path is the root (empty) path [], the data element d also has
//    a parent data element p, which must have a path which is a
//    prefix of the path of the data element d (if the paths of p and d
//    are equal then p is an operator, see below).
//    We say that d is a direct child of p (it is an indirect child of
//    the parent of p and the parent of the parent of p, etc.).
// 2. If a data element p has a direct child d at path P, it cannot 
//    have a direct child at any path P' extending P (that is, such that 
//    P is a strict prefix of P').
//
// For a data node <path ID, data element ID, type, key>, 
// it must hold that the data element with the given ID does not have any data 
// element children at a path which is equal to <path ID> or a prefix
// of <path ID>. We say that <data element ID> is the lowest data element 
// dominating the data node <path ID, data element ID, type, key>.
//
// To fully describe the data, one must provide a list of data node tuples, 
// as described above and the list of data elements. The list of data
// elements must specify, for each data element ID, a path ID and the
// data element ID of the parent data element (unless the path ID is 
// of the empty path []).
// 
// This data representation allows us to represent any data which can
// be represented by a structure built out of attribute-value and 
// ordered set objects, except for the following:
// 1. Immediately nested ordered sets are 'flattened' so one 
//    cannot see the difference between e.g. o(1,2,o(3,4)) and
//    o(1,2,3,4).
// 2. Empty ordered sets and attribute values must be represented by special
//    simple values.
//
// At the same time, this data representation allows storing simple
// values also at internal nodes of the data tree.
//
// Relation to Attribute-Value + Ordered-Set Structures
// ====================================================
//
// A data structure which can be represented by a combination of ordered
// sets and attribute-value structures will be referred to as a 
// set-tree structure below. 
//
// Several different definitions of a path through a set-tree
// structure will be used below. To avoid confusion, we first name and
// define these different types of paths.
// 
// By defining the paths through a set-tree structure, we can also
// define the alternative representation of the data structure which
// is used internally by the indexer and is described above. This data
// structure will be referred to as path and data element structure
// (or 'data element structure' for short) and will be defined below
// based on the set-tree structure. This definition provides a method
// for converting a set-tree based representation into a data element
// structure representation. Derived classes of the base indexer class
// can take set-tree input data and convert it into the data structure
// used by the indexer.  The indexer can also be initialized directly
// by a data element structure (typically, the output of a query).
//
// This file defines the base indexer class which only works with data
// element structures. The loading of the indexer from a set-tree structure
// (e.g. content node structure) is handled in the appropriate
// derived class (which is dependent on the format of input data).
//
// Even though the code in this file does not deal with set-tree
// structures, the documentation below begins with set-tree based 
// structures and defines the data element structure based on these structures.
// Ordered sets are assumed, just like attribute value structures,
// to hold their elements under attributes (just as in the content node
// structures). 
//
// Unique Paths
// ------------
//
// Given a root node, a 'unique path' uniquely defines a node in the
// set-tree tree under the root node. We write [(p1,..,pn),x] for the
// node under the unique path (p1,...,pn) in the tree rooted at x This
// is defined as follows:
// 1. [(),x] = x (an empty path returns the root node)
// 2. if x is an attribute value with attribute p1 then
//    [(p1,..,pn),x] = [(p2,...,pn),x.p1]
//    and otherwise
//    [(p1,..,pn),x] is undefined
// 3. if x is an ordered set with an element under attribute p1 then
//    [(p1,..,pn),x] = [(p2,...,pn),x.p1]
//    and otherwise
//    [(p1,..,pn),x] is undefined
// Here, the path specification must include the attributes of ordered set
// nodes through which the path passes.
//
// Query Paths
// -----------
//
// When queries specify paths, they do not explicitly specify the ordered-set
// attribute the path needs to pass through (as these are considered
// part of the internal representation of the ordered-set but not part
// of its semantics). Instead, the elements in the ordered set are considered
// 'equivalent' alternatives at the given point in the set-tree tree,
// which do not add anything to the path. So when a query path reaches
// an ordered set, it continues down each of the elements in the set, without
// assigning any part of the path to the ordered-set node.
//
// More precisely, we write [<p1,..,pn>,x] for the set of nodes
// under the query path <p1,...,pn>. This is defined as follows:
// 1. If x in a terminal node (not an attribute value or an ordered
//    set) then:
//    a. [<>,x] = o(x) (an empty path returns a set containing x)
//    b. [<p1,..,pn>,x] = o() (a non-empty path fails to match anything)
// 2. if x is an attribute value with attribute p1 then
//    [<p1,..,pn>,x] = [<p2,...,pn>,x.p1]
//    and otherwise
//    [<p1,..,pn>,x] = o() (an empty set)
// 3. if x is an ordered set x = o(x1,...,xm) then
//    [<p1,..,pn>,x] = union([<p1,...,pn>,x1],....,[<p1,...,pn>,xm])
//
// Each of the nodes under the query path has a unique path leading to
// it. Therefore, we can also see the result of applying a query path
// to a node as a set of unique paths. It is useful to see it this way
// when we want to look at prefixes of these unique paths.
//
// Projection Paths and Data Elements
// ----------------------------------
//
// Projection paths are query paths. A projection path <p1,....,pn>
// and a node x, together define a set of nodes
// [<p1,....,pn>, x], which is the projection of x on <p1,...,pn>.
//
// The node at a unique path (p1,...,pk) is a 'data element' if the
// node at (p1,...,pk) is not an ordered set but the node at
// (p1,...,pk-1) is an ordered set (this means that pk is an ordered
// set attribute). Specifically, the root node x is considered a data
// element if it is not an ordered set.  Given a unique path
// (p1,...,pn) there is a sequence of nodes along this which are data
// elements. If the node at (p1,...,pn) is not an ordered set, there
// must be at least one node along the path which is a data element.
//
// For a node x and a projection path <p1,...,pn> we define a set
// d(<p1,...,pn>, x) of data elements. A data element d is in this set
// iff the following holds:
// 1. The unique path (q1,...,qk) leading from x to d is a prefix
//    of a unique path (q1,...,qm) leading to a nod ein [<p1,...,pn>, x].
// 2. There is no longer prefix (q1,...,qk,qk+1,...,ql) of (q1,..,qm)
//    leading to a data element.
// We will also say that d(<p1,...,pn>,x) is the set of lowest data elements
// dominating the nodes in [<p1,..,pn>, x]. 
//
// The significance of the lowest data element set d(<p1,...,pn>, x)
// is that a data element in this set together with the path <p1,..,pn>
// uniquely defines a node in the set [<p1,...,pn>, x].
//
// If d1 is a data element at a unique path (p1,..,pk) from x and
// d2 is a data element at the unique path (p1,...,pk,pk+1,...,pm)
// from x and there is no l between k and m such that [(p1,....,pl), x]
// is a data element, then we say that d1 is the direct parent of d2.
// In the calculation of queries one often needs to 'raise' a data element
// d2 to its parent d1. 
//
// Internal Representation of the Data
// ===================================
//
// Internally, the indexer (and the query calculation nodes) represent
// the data (and the result of queries on the data) by paths
// and data elements. The indexer holds a tree structure such that the
// paths in the tree are the paths in the data indexed by the
// indexer. Each node in this structure represents a path
// (the edges in the tree are each labeled by a string which is an
// attribute along the path). Indexing takes place separately for each 
// such path node. On the node representing a path P we store a table 
// ('nodes') whose keys are the IDs of the data elements appearing 
// in the tuples <P, data element ID, type, key> for data nodes
// whose path ID is P. Under each element ID we 
// store the information relevant for the unique data node under the 
// given data element at path P. This information includes
// the type and key of the node. In case indexing is required, an index
// will be created for each type separately and the key will be used as the
// key of this data node in the index. A query
// which matches a set of keys will receive from the indexer a list
// of data element IDs (lowest data elements on the path P) which represent the 
// nodes matched by the query.
//
// This scheme of representing the data allows for fast an simple 
// calculation of queries. We here only give a simple example, 
// see internalQueryCalc.js for more details.
//
// Consider the following query and data:
//
// query: { a: { b: 1, c: 1 }, d: 1 }
//
// data: o(
//    {
//       a: {
//          b: 1,
//          c: 1
//       },
//       d: 1
//    },
//    {
//       a: o({
//               b: 2,
//               c: 1
//            },
//            {
//               b: 1,
//               c: 2
//            }
//       ),
//       d: 1 
//    },
//    {
//       a: o({
//               b: 1,
//               c: 1
//            },
//            {
//               b: 2,
//               c: 2
//            }
//       ),
//       d: 1 
//    }
// )
//
// Assume that the elements in every ordered set appear under the attributes
// "i0", "i1", "i2", .... (in the order given in the example).
//
// The paths being queried are [a,b], [a,c] and [d]. At the node assigned
// to [a,b] we index the nodes found at the following unique paths:
// i0:a:b
// i1:a:i0:b
// i1:a:i1:b
// i2:a:i0:b
// i2:a:i1:b
// The corresponding data elements at this path are i0, i1:a:i0, i1:a:i1,
// i2:a:i0 and i2:a:i1.
// Similarly, for the path [a,c] the unique paths are:
// i0:a:c
// i1:a:i0:c
// i1:a:i1:c
// i2:a:i0:c
// i2:a:i1:c
// and the corresponding data elements are the same: i0, i1:a:i0, i1:a:i1,
// i2:a:i0 and i2:a:i1.
// For the path [d] the unique paths are:
// i0:d
// i1:d
// i2:d
// with data elements: i0, i1 and i2.
//
// The query on [a,b] (a:b:1) matches data elements i0, i1:a:i1 and i2:a:i0
// The query on [a,c] (a:c:1) matches data elements i0, i1:a:i0 and i2:a:i0.
// The query on [d] (d:1) matches data elements i0, i1 and i2.
//
// i0 is clearly in the intersection of all these queries and therefore in
// the result of the query. i2:a:i0 is in the result of the first two queries.
// However, this data element is not a data element on the path [d],
// so it needs to be 'raised' to its parent data element 'i2'. This
// is also matched by the last part of the query, so i2 is also in the 
// result of the full query. This does not hold for the data elements
// under i1: each of i1:a:i1 and i1:a:i0 belongs to both paths but is
// matched only by one. Therefore, there is no match on i1.
//
// More details on how queries (including projections) are calculated
// can be found at 'internalQueryCalc.js'.
//
// Implementation
// ==============
//
// Preparation and Indexing
// ------------------------
//
// An internal QCM indexer is constructed for a given root node x.  In
// addition, it maintains a set of path nodes (typically representing
// the selection and projection paths which are/could be applied to
// x).  These path nodes may be added (and removed) after
// construction. When a query is applied, any path in the query which
// was not yet included in the set of paths defined on the internal
// QCM indexer is added to the internal QCM indexer (it may later be
// removed or not when the query is removed from the list of query
// application).
//
// The paths of the internal QCM indexer form a tree, where internal
// nodes in this tree may represent query paths and the tree may store
// the query paths of different queries.
//
// It is the responsibility of the appropriate derived class to
// process the data being indexed and store under each path the lowest
// data elements at that node and provide the type and key for each
// such data node. The data elements are represented by their IDs
// (which are allocated by the derived class). Sometimes two indexers
// can share the same data element IDs (in case one indexer stores the
// output of a query applied on the first indexer).
//
// When data elements are added, the indexer must be told (for each 
// data element) at which path it is defined and which data element
// is its parent (the parent must be added first).
//
// When indexing is required at a certain path, the data element IDs
// stored at that path node are inserted into an index under the keys
// stored for them. The data elements can then be looked up by a query
// specifying a certain value range.
//
// Keys of different types are stored in indexes of different types.
//
// Path Node Types
// ---------------
//
// The different paths indexed by the indexer may require different treatment
// depending on the needs of the queries registered to the indexer.
// The following properties (flags on the path node objects) determine
// the required treatment of indexed data at this path node (the actual
// implementation of part of this functionality may be the responsibility
// of the derived classes).
// trace: the data nodes at this path need to be traced. The path node should
//   be updated with all data nodes which can be found under this 
//   path. It is the responsibility of the derived class to provide these
//   data nodes, including their type and key and to keep updating this
//   list when nodes are aded or removed and when the type and/or key of 
//   a data node changes.
//   There may be path nodes which do not require tracing of all data nodes.
//   For example, when a compound object inside the data needs to be 
//   compressed, we need to have path nodes for the data nodes inside
//   this compound object. These data nodes need to be traced, but other
//   nodes at the same path do not need to be traced (the 'trace' flag
//   on the path node will not be set then).
// index: values at this path need to be indexed. The base class then
//   constructs sub-indexes for each type of values which need to be indexed.
//   The keys of the data nodes at this path are inserted into the approriate
//   sub-index, depending on its type. When the data nodes are updated,
//   the sub-indexes are also updated.
//   Every path node which has indexing turned on must also have tracing
//   turned on.  
// The index and trace properties can be set on path nodes
// through an API but are usually set automatically when query calculation 
// nodes are registered. A query calculation node registered to a 
// path node requires it and all its parents to be traced. A selection
// node which does not have th flag 'doNotIndex' set, requires indexing 
// (of the path node it was registered to).
//
// When query calculation nodes are removed, the requirement to index
// or trace may not exist anymore. The indexing and tracing are not stopped
// immediately (as the requirement to trace/index could be renewed and 
// re-indexing may be expensive). Instead, a garbage collection approach
// is used, to remove indexing and tracing only where it has not been 
// required for some time. 
//
// Responsibilities of the Derived Classes
// ---------------------------------------
//
// It is the responsibility of the derived class to add and remove
// data nodes from each path node and refresh their type and key.
// It is the responsibility of the base class to indicate to the 
// derived class what paths need to be traced.
// In addition, it is the responsibility of the base class to indicate
// to the derived class which paths hold nodes which are inside
// a monitored sub-tree (this is the sub-tree mode of the path) 
// and which specific nodes at that path are inside a monitored sub-tree.
// These properties can be directly checked by the derived class and 
// the base class must notify the derived class when any of these properties 
// change. Various interface functions are defined for this purpose 
// below (these all have 'activated' or 'deactivated' in their name). 
//
// Interface with the Derived Class
// --------------------------------
//
// The base class has exposes two properties to the derived class in 
// order to indicate to it which information needs to be collected 
// and updated in the indexer:
// 'trace': this is a property of a path node. When this property is set on
//    a path node, the derived class must keep track of and report 
//    all data nodes at that path (this means that the IDs of the lowest 
//    data elements dominating those nodes have to be reported using 
//    'addNonDataElementNode()', 'addDataElementNode()'  and 'removeNode()'
//    and the types and keys must be reported using 
//    setKeyValue(<path node>, <data element ID>, <type>, <key>)).
//    When the 'trace' property is set on a path node it must also be 
//    set on its parent path node.
// 'subTree': (this property also appears on each data node entry, but
//    here we refer to this property of the path node).
//    This property of the path node (which is implemented as a counter)
//    indicates when sub-tree monitoring is required for some nodes 
//    at this path (when this property is non-zero). This can happen 
//    on a path node P in one of two situations:
//    1. If sub-tree monitoring is registered on any of the data 
//       nodes at P as the root of the monitored sub-tree.
//    2. When a node at the prefix path node of P is inside a monitored
//      sub-tree and has an attribute leading to P.  
//    When this mode is active, the derived class is required to 
//    update the path node with nodes inside the monitored sub-trees.
//    Moreover, for nodes inside the monitored sub-tree it is required
//    to also update the base indexer with their attributes. 
//
// The interface to the base class which should be implemented by the derived
// class consists of the following pairs of functions which are used to
// notify the derived class of the activation or deactivation of the
// properties defined above.
//
// Activation:
//   pathNodeActivated(<path node>)
//   pathNodeDeactivated(<path node>)
//
//   These functions are called when the path node is activated or deactivated.
//   A path node is activated when tracing or sub-tree monitoring is turned on
//   on the path node where neither of these properties was previously
//   turned on and a path node is deactivated when the path node has tracing
//   or sub-tree monitoring turned off such that after this neither it turned
//   on. When a path node is not active, there is no need for any nodes
//   or keys to be updated on it. If the path node has no modules registered
//   awaiting a notification when the path is activated, the path node may
//   be removed. It is up to the derived class to actually decide what to
//   do when a path node is activated or deactivated.
//
// Tracing:
//   pathNodeTracingActivated(<path node>)
//   pathNodeTracingDeactivated(<path node>)
//
//   These notify the derived class that tracing has been activated or
//   deactivated for the given path node (see above for a description of
//   what this requires from the derived class). This means that the 
//   flag 'trace' was set or removed from the given path node.
//   These functions are not called in case pathNodeActivated()
//   or pathNodeDeactivated() were also called. This means that
//   pathNodeTracingActivated(<path node>) and
//   pathNodeTracingDeactivated(<path node>) are only called when
//   monitoring is active on path nodes at the time these functions
//   were called.
//
//   The data nodes collected by the derived class at a certain path
//   node need to be reported to the base class using the following functions:
//   
//   addNonDataElementNode(<path node>, <data element ID>): a call to this
//      function indicates that the given data element is a lowest data element
//      above a data node at this path.
//   addDataElementNode(<path node>, <data element ID>, 
//                      <parent data element ID>): 
//      a call to this function indicates that <data element ID> is 
//      a node at the given path whose parent is <parent data element ID>
//      (that is, this is the shortest path at which <data element ID> is
//      the lowest data element).
//      It is the responsibility of the derived class to assigned the 
//      data element IDs (and determine the parent of each data element).
//      When a data element is not dominated by any other data element
//      (data elements at the root path node), <parent data element ID>
//      should be undefined.
//   removeNode(<path node>, <data element ID>): this function removed
//      the data node on the given path node which has the data element
//      with the given ID as the lowest data element above it.
//
//   The derived class can assume that when tracing is activated on a path
//   node it has already been activated on its parent.
//
//   The type+key information is provided to the base indexer by the derived
//   class calling the function 
//   setKeyValue(<path node>, <data element ID>, <type>, <key>)
//   where <path node> and <data element ID> indicate the lowest 
//   data element and the path at which the value is found, and <type>
//   and <key> (which should be a boolean, string or number) specify
//   the key value at the node. If <type> is undefined, the current type
//   and key are deleted. Finally, if <data element ID> 
//   is negative, the given key should be removed (for -<data element ID>) 
//   rather than added. This is used internally by the base class to store 
//   the keys of removed nodes so that the keys could be removed in one 
//   batch after the nodes were removed).  
//
// Sub-Tree Monitoring:
//   
//   subTreeMonitoringActivated(<path node>)
//   subTreeMonitoringDeactivated(<path node>)
//
//   inSubTreeActivated(<path node>, <data element ID>)
//   inSubTreeDeactivated(<path node>, <data element ID>, <only as root>)
//
//   inSubTreeOnlyAsRootActivated(<path node>, <data element ID>)
//   inSubTreeOnlyAsRootDeactivated(<path node>, <data element ID>)
//
//   inSubTreeWithAttrActivated(<path node>, <data element ID>)
//   inSubTreeWithAttrDeactivated(<path node>, <data element ID>)
//
//   The first two functions, subTreeMonitoringActivated(<path node>) and 
//   subTreeMonitoringDeactivated(<path node>), are used to notify the 
//   derived class when the sub-tree mode of the path changes (that is,
//   when the counter 'subTree' on the path node changes between zero
//   and non-zero). Activation takes place when either the first node
//   at this path has sub-tree monitoring registered on it as root 
//   or when for the first time a node at the prefix path which is marked 
//   as having attributes (and such that the attribute leading to this path
//   is not marked as a non-attribute of the node) is inside a monitored
//   sub-tree. Deactivation takes place when neither of these conditions hold.
//   These functions are not called in case pathNodeActivated()
//   or pathNodeDeactivated() were also called. This means that
//   subTreeMonitoringActivated(<path node>) and
//   subTreeMonitoringDeactivated(<path node>) are only called when
//   tracing is active on path nodes at the time these functions
//   were called.
//
//   The second pair of functions, inSubTreeActivated(...) and 
//   inSubTreeDeactivated(...) are used to notify the derived class 
//   when a specific node becomes or stops being part of a monitored 
//   sub-tree. The <only as root> flag indicates whether before the
//   operation which resulted in this node not belonging to any retrieved
//   sub-tree anymore, this node was only part of the sub-tree rooted
//   at it or not. This property is sometimes important for the derived class
//   (see below for more). 
//
//   When a node becomes part of a monitored sub-tree immediately upon
//   construction, the inSubTreeActivated() function is not called.
//   This is because it is assumed that the calling function checks whether
//   the node is inside a monitored sub-tree when the function returns.
//   Similarly, when a node which was part of a retrieved sub-tree is 
//   removed, inSubTreeDeactivated() is not called (as the derived
//   must have been the one to remove the node and should take appropriate
//   action in case the node was inside a retrieved sub-tree).
//
//   Sub-tree monitoring of non-trivial trees (those which contain
//   more than a single terminal at the root) is based on nodes being
//   marked as having attributes. Optionally, one can exclude some attributes
//   from the monitored sub-tree by explicitly marking those attributes
//   as no belonging to the sub-tree (this is done on the dominating node
//   whose attribute it is) and can be set separately for each node.
//   This way, 'inivisible' attributes can be added under a node. The 
//   nodes under them are not monitored, but they can be used for querying.
//   When a node is marked as having no attributes, the same can 
//   be done: domianted nodes can be added under it. These are invisible
//   to monitoring but not to querying.  
//   Non-monitored attributes can be added to a node in exactly the same
//   way as a key. The type is then "nonAttribute".
//   This is done by calling the function
//   setKeyValue(<path node>, <data element ID>, <type>, <key>)
//   where <path node> and <data element ID> define the data node which 
//   has the non-attribute and <type> must be "nonAttribute".
//   <key> is then the attribute itself. If <key> is undefined, all 
//   non-attributes are removed. Finally, if <data element ID> is 
//   negative, the given non-attribute should be removed 
//   (for -<data element ID>) rather than added. This can be used when 
//   wishing to remove just one out of a set of multiple non-attributes.
//
//   Since non-attributes are provided through key updates, queries which 
//   do not request key updates do not receive them. When a query 
//   requests key updates, these updates will contain only subsequent
//   modifications. It is up to the entity registering the query calculation
//   node (e.g. a merge indexer) to directly retrieve the list of non-attributes
//   at the time of registration (if this information is required).
//
//   The derived indexer class is required to update the non-attributes on
//   nodes which are inside monitored sub-trees. Otherwise, the
//   derived indexer class is not required to update the non-attributes
//   themselves.
//
//   The property whether a node has attribute or not must always be
//   updated and is updated like any key. 
//   To indicate that a node has attributes, the derived class should
//   call setKeyValue(<path node>, <data element ID>, "attribute", true)
//   and to indicate that a node no longer has attributes, it should call
//   setKeyValue(<path node>, <data element ID>, "attribute", false).
//   A node is always created without attributes, so failing to call
//   queryKeyValue with type "attribute" and any specific attribute or
//   true will result in a node without attributes.
//   Note that setting a "nonAttribute" on a node does not make it into a node
//   with attributes.
//
//   The function 'hasAttrs(<node entry>)' returns true if the node
//   has attributes.
//
//   To retrieve the sub-tree under a node, the indexer relies on the
//   path nodes. If the node is marked as having attributes, it goes over 
//   the path nodes extending the path node on which the node is defined 
//   and checks which of these path nodes has nodes dominated by the
//   given node, skipping those path nodes whose attribute is marked as
//   a non-attribute on the dominating node.
//
//   This requires that all path nodes which carry nodes in a monitored
//   sub-tree be created (and updated with their nodes) even if they are not
//   traced. It is the responsibility of the derived class to take care 
//   of this. For example, in the RawIndexer, the data stored in the indexer
//   is, by definition, the full data. In a merge indexer, the merge indexer
//   must register monitoring on the source indexer when monitoring is required
//   on one of its node. It then creates all path nodes implied by the
//   monitor monitoring the sub-tree in the source indexer.
//
//  The second pair of notification functions, 
//  inSubTreeOnlyAsRootActivated(<path node>, <data element ID>) and
//  inSubTreeOnlyAsRootDeactivated(<path node>, <data element ID>)
//  notify the derived class when the inSubTreeOnlyAsRoot() property changes
//  for a node which was previously already in a sub-tree. This means that
//  inSubTreeOnlyAsRootActivated(...) is called only when the node
//  was previously inside multiple monitored sub-trees and after 
//  some of these were removed, the only sub-tree left is the one
//  whose root is at this node. This function is not called
//  when the node was not part of a retrieved sub-tree and then
//  a sub-tree monitor was registered to it as a root.
//  inSubTreeOnlyAsRootDeactivated() is called when the node becomes
//  part of a second monitored sub-tree after previously it was only
//  part of the sub-tree rooted at the node.
//  
//  The final pair of notification functions, 
//  inSubTreeWithAttrActivated(<path node>, <data element ID>) and
//  inSubTreeWithAttrDeactivated(<path node>, <data element ID>)
//  are used (respectively) to notify the derived class when 
//  a node inside a monitored sub-tree first becomes a node with attributes
//  and, respectively, when it becomes a node without attributes. The property
//  of having attributes or not is described above (search for 'hasAttrs'
//  above and read the preceding paragraphs).
//  These functions are called only when this property changes while the
//  node is already inside a monitored sub-tree. These functions are not
//  called to notify of the state of this property when this node becomes
//  part of a monitored sub-tree. 
//
// Indexing and Sub-Tree Retrieval
// -------------------------------
//
// Indexing is turned on for a path node while sub-tree retrieval is
// turned on for each data node separately. The derived class does not
// need to be aware of these two properties. All the information
// required to implement indexing and sub-tree retrieval should be
// conveyed to the derived class by setting the 'trace' property on
// the path node (for indexing) and the sub-tree monitoring properties on the
// node entry and the path node.
//
// For more on the interface to indexing and sub-tree retrieval, see
// the "Queries" and "Sub-Tree Monitoring" sections below.
//
// Operator Nodes
// ==============
//
// Operator nodes are nodes which are at the same path as the nodes they 
// dominate, which are their operands. This is required in cases where 
// we want to modify a certain set of sub-trees in the indexer by a certain
// operator without introducing an additionla attribute in the path for
// this purpose. 
//
// One example of an operator node would be the negation operation.
// A data node may have a "negation" type. If this data node is 
// at path P and under lowest data element d, then data element d may not
// be the lowest data element for any path extending P. The direct children 
// of d at paths extending P must be at path P. All nodes under these child
// data elements are negated by the negation node. It is the responsibility 
// of the derived indexer class to observe these rules and to add the nodes 
// appropriately.
//
// As a result of these rules, operator nodes have several special 
// properties:
// 1. The operator node and the operand nodes it dominates are stored under
//    the same path node.
// 2. If the operator node is itself a data element node (e.g. it is 
//    inside an ordered set or is inside another operator) then the
//    operator node data element and its child data element (the operand) 
//    are at the same path.
//
// Operator nodes have reserved types. For example, the type of a negation 
// node is "negation". The list of operands (e.g. the negated nodes)
// is given by the data element table (which stores its children under
// the given operator path). Therefore, the operand node key does not
// carry any value. However, in order to make sure it participates in the
// compression, its value is set to a constant 0.
//
// The operator node is required in order to be able to represent the 
// empty operators, for example, the empty negation n(). If, for example,
// negation were only marked on the negated nodes, the removal of the last 
// negated node would result in an empty set rather than in the empty 
// negation (which, as a query, matches everything).
//
// Creating the operator node (e.g. a node with type "negation") and the 
// operand nodes is sufficient to define the relation between them. 
// To determine whether a data element node is an operand, it is enough to
// check whether its parent data element ID has an entry in the same
// path node. The other way around is also simple: given a data node with 
// an operator type, the nodes it negates are the data element node children 
// of the data element under whose ID the operator node is stored (these 
// can be retrieved using the 
// getOperandDataElements(<negation element ID>, <negation path ID>)
// function.
//   
// Operators do not allow for the creation of a convex hull.
// Therefore, for example, a negation inside a range node immediately 
// forces this range to be interpreted as an ordered set. For example, 
// r(n(3), 5) is equivalent to o(n(3), 5) but n(r(3,5)) is the negation 
// of the range r(3,5).
//
// Range Nodes
// ===========
//
// The handling of range nodes is supported in the indexer base class.
// However, the derived indexer classes should know how to add
// a range node and the individual values under it to the indexer.
// 
// A range node is either handled as a single terminal node which is indexed
// and matched as the convex hull of the simple values defining it or as 
// an ordered set. Which of the two interpretations is used depends on the
// type of the simple values dominated by the range node (and whether they 
// are at the same path as the range node). If all these nodes are at the
// same path as the range node and have the same type, a single range node is 
// created, representing the convex hull of these values (for some discrete 
// types this convex hull may simply be the given set of values). Otherwise, 
// an ordered set is created, holding all the values under the range node. 
// It is enough if one node under the range node is of a different type 
// (or is an attribute value) for the range to be interpreted as an 
// ordered set.
//
// Depending on how the range node was added to the indexer, it may be 
// represented as a single data node (which stores all the information
// about the range) or as an operator range node dominating the 
// operand nodes representing the individual values from which the range
// was created. 
//
// When the convex hull interpretation is chosen, only the range node 
// is 'active', that is, only this node is put into the sub-index and 
// made visible to queries registered to the path node (whether selections
// or projections). This data node has a single key, which is an object 
// representing the range.
// When the ordered set interpretation is chosen (which is only possible
// if the range node also has operand nodes under it) the range node 
// becomes inactive (that is, invisible to the queries registered to the
// path node) while its operands are made visible (stored in the index
// and notified to the query calculation nodes). When the values under
// the range change, the key object of the range node is updated with
// these values. When this key object has determined that the convex hull
// interpretation is possible or no longer possible, the activation of 
// the range node and the operand nodes under it change. All the nodes
// remain stored in the 'nodes' table of the path node, but the query 
// calculation nodes are notified of the removal of the node(s) which 
// became inactive and the addition of the node(s) which became active.
//
// Whatever the interpretation chosen, all nodes under a range node (and 
// at the same path as the range node) need to be allocated their own data 
// element ID (as is the case withe any operand, see the discussion of
// operators above). This data element ID is used to identify these nodes
// in the range key object.  
//
// The derived class can choose between two different interfaces:
// 1. An interface where only the convex hull interpretation of 
//    the range node is supported and therefore ranges of nodes 
//    of mixed types are not supported (this can be used when the 
//    derived class can guarantee this, for example, when it is 
//    indexing data from another indexer and that indexer stores an
//    active range node). With this interface, a data node is created
//    for the range node and the keys are added directly to this node.
//    All keys are required to have the same type (and changing the type
//    will remove all keys with the previous type which were not provided
//    with a new value under the new type).
// 2. An interface which allows switching between the convex hull inerpretation
//    of the range and the ordered set interpretation of the range.
//    In this case, the nodes under the range must also be added
//    as data nodes and the keys are added to these nodes. The base class
//    then updates the dominating range node with these values and the
//    range node key object determines whether the convex hull or 
//    the ordered set interpretation should be used. For more details, 
//    see below.
// A derived class is allowed to use both these interfaces, but may not
// switch from one to the other on the same range node before emptying
// the node (that is, removing all keys under the range node).
// 
// When using the interface which allows for switching between the convex hull
// and the ordered set interpretation, the derived class must call the 
// 'addDataElementNode()' function for each simple node under the range,
// just like adding operands to any operator (see above).
// Internally, the base class adds a field 'rangeNodeId' to the operands of
// a range node pointing at the range node. The inverse pointer (from range 
// node to sub-nodes) is stored in the key object of the range node, 
// where the keys of the individual items in the range are added 
// under the data element ID. 
//
// When range nodes are nested (e.g. r(1, r(7,8)) ) it is the highest
// range node which can be interpreted as a convex hull which is interpreted
// as such. Therefore, r(1, r(7,8)) will be interpreted as a single convex
// hull (of 1,7,8) while r("a", r(7,8)) will be interpreted as an ordered
// set of "a" and the convex hull r(7,8). Note that if a lower range node
// must be interpreted as an ordered set then so must also the range node
// dominating it.
//
// The key of a range node is a RangeKey object which stores all the keys.
// The keys should be added to this object using the data element IDs
// allocated for them. The RangeKey object determines whether it is 
// active (all keys have the same type) or not. When active, the 
// RangeKey object provides the minimal and maximal key values.
// These two values are then used for indexing and compression.
//
// A range node is created with type "range". As long as there are no
// items under the range or when the ordered-set interpretation is chosen,
// the type of this node remains "range". When the range interpretation 
// is chosen and the range is not empty, the type of the elements in the
// range becomes the type of the range node (e.g. "number" or "weight").
//
// Open and Closed Ranges
// ----------------------
//
// A range can be open or closed at either of its end-points. This is
// a property of range andis independent of the values inside the range.
// This information is stored in the RangeKey object representing the key
// of the range. The default is to have the range closed on both ends.
//
// Interface for Convex Hull Only Interpretation
// ---------------------------------------------
// When using the 'convex hull interpretation only' interface, the 
// derived class can add the keys of the range node by using 
// the 'setKeyValue' function directly on the data element ID
// assigned to the range node. The type is then the simple type 
// of the sub-nodes of the range. The key must be:
// 1. For addition of keys: an array of the format 
//    [<data element ID 1>, <value 1>,.....,<data element ID n>, <value n>] 
//    where each consecutive pair of elements in the array defines one key: 
//    the first value in the pair is its identifying ID (the ID to be 
//    allocated to the corresponding sub-node in case of an ordered-set 
//    interpretation) and the second is the value of the pair. 
// 2. For the removal of keys: and array of data element IDs:
//    [<data element ID 1>, ..., <data element ID n>] which identify the
//    nodes to be removed.
// This update is incremental in the key values, but not in the
// type. This means that the update will delete or replace any keys
// which have a different type, but will not modify existing keys
// which do not appear in the update but have the same type as the
// update.  As in simple key updates, a negative data element ID can
// be used to delete key values (using the second format specified here).
//
// It is also possible to use a RangeKey object (or ConstRangeKey object) 
// as the key value update. This then replaces any existing value stored
// in the range node.
//
// Note that using this interface does not allow one to specify the
// open/closed properties of the ends of the range. Since the update is
// incremental, the existing open/closed properties are preserved.
// If no previous range node existed, the range is created closed on both
// sides. To specify the open/closed properties, one should initially
// create the node using a RangeKey object carrying this information
// or a "range" type key update (whose key is then the open/closed properties,
// see below).
//
// Interface for Convex Hull or Ordered Set Interpretation
// -------------------------------------------------------
//
// The interface here as exactly the same as that for operators in general.
// The range node is added like any other node, with type "range".
// The only difference is that in addition to the type ("range") a key
// may also be provided. This key is an array [<boolean>,<boolean>]
// indicating whether the range is open below (first element in pair)
// and or above (second element in pair).
// When a data element node is added at the same path as the range node 
// and dominated by it, it is recognized as an operand of the range node 
// (an the rest follows).
//
// Mixing and Switching between the Two Interfaces
// -----------------------------------------------
// It is not possible to mix the two interfaces. This means that:
// 1. It is not possible to sometimes update a node using one method
//    and sometimes another.
// 2. When range nodes are nested inside each other (e.g. r(r(1,2),3))
//    it is not possible to update the embedded ranges (e.g. r(1,2))
//    using the convex-hull interface (while the higher range node is 
//    updated using convex-hull or ordered-set interface).
// While such switching could be supported, it seems unnecessary. 
// 
// Generally, it is recomended that a derived class use either the one
// update interface or the other, but not both. However, if a derived
// class does need to switch between the two, it should always first
// clear all values from a range node before switching interface.
// 
// Under either interface, if a range node is updated with a key which 
// is a simple value, this turns it into a simple node. However, if node
// entries were created for the nodes under the range node, these are 
// not destroyed. It is up to the derived class to destroy these nodes.
//
// The compression of a range node, when interpreted as a convex hull, 
// is based on its minimal and maximal values (together with the type,
// of course). This means that r(1,3), r(1,2,3) and r(r(1,2),3) will all 
// be compressed to the same compressed value. When the minimum and
// the maximum are equal (e.g. r(2,2)), the compression is identical
// to that of the single value (2 in this example). When the range node 
// is interpreted as an ordered set, the compression does include the range
// node in the compression (so that r("a", 8) and o("a", 8) are not compressed
// into the same value). 
//
// Queries
// =======
//
// xxxxxxxxxxxxxxxxxxxxxx
//
// Sub-Tree Monitoring
// ===================
//
// Queries registered to the indexer define a specific path in the
// indexer they are interested in and at that path apply (potentially)
// to all data nodes, there are other operations which require to know
// all data nodes dominated by a specific data node (at all paths).
// We refer to all data nodes dominated by a single data node as a "sub-tree"
// and the top node is the "root" of the sub-tree.
//
// The definition of a sub-tree relies on the notion of domination. 
// Generally, domination in the indexer is defined as follows:
// 
//    A data node x dominates data node y if the path of x is a prefix 
//    of the path of y and the lowest data element dominating y is 
//    a descendant of the lowest data element dominating x.
//
// In the context of the definition of a sub-tree, there is an additional
// condition for the definition of domination, which requires that the
// nodes along the path from the dominating node to the dominated node
// are marked as having attributes (this includes the dominating node
// but not the dominated node) and that none of the attribute along the 
// path is marked as a 'nonAttribute' by the node dominating is on the path.
//
// Retrieving the sub-tree rooted at node x means retrieving all the terminal
// values stored at data nodes in the sub-tree rooted at x (including 
// the path and data element under which they are stored). Different
// modules may wish to monitor a sub-tree rooted at a certain data node x
// (e.g. an object which compiles a query from a sub-tree which is the
// query description). These objects then receive all terminal values
// in the sub-tree and are updated when these values change.
//
// The indexer also implements a special built-in sub-tree monitoring 
// object which performs compression. This calculates a single number
// (or, possibly, a short string) which represents the sub-tree structure
// uniquely (that is, two sub-trees are considered identical iff they are
// assigned the same compression). 
//
// To activate a sub-tree retrieval and register a sub-tree monitor object
// on one or more sub-trees, the module requesting this sub-tree retrieval
// must perform two steps:
// 1. Call addSubTreeMonitor(<path ID>, <monitor object>):
//      This registers the monitor object on the given path and returns
//      a registration ID which is needed in subsequent steps. 
//      The monitor object must support the following functions (where <ID>
//      is the ID returned by addSubTreeMonitor()):
//        subTreeUpdate(<path ID>, <array of element IDs>, <ID>): 
//           this receives the list <array of element IDs> of element IDs which 
//           are the root (at path <path ID>) of a retrieved sub-tree which has 
//           just changed. This list may contain element IDs which are not
//           monitored by this sub-tree monitor (the sub-tree monitor needs
//           to be able to separate them).
//    This provides a callback object for 'subTreeUpdate()' but it
//    does not request the monitoring of any specific sub-tree
//    yet. For this, the following step must be carried out.
// 2. Call one of the functions which registers sub-tree retrieval requests
//    for a specific data node (at the path to which the previous registration
//    step was applied). Note that the same monitor can be registered to 
//    multiple data nodes (as sub-tree roots) at the same path. The functions
//    used for such a registration are:
//      registerSubTreeRetrievalOnNode(<path ID>, <data element ID>, 
//                                     <monitor ID>, <monitor object>):
//         This function registers a request to retrieve the sub-tree
//         whose root is at <path ID> an <data element ID> and update 
//         <monitor object> (if given) with the terminal values of the 
//         sub-tree. <monitor ID> is the ID assigned to this monitor 
//         when it was registered to the path by the function in 1, above.
//         If <monitor object> is omitted, the request is interpreted
//         as a request for compression (equivalent to a call to the following
//         function). If <monitor object> is given, this object must also
//         implement the following functions:
//             updateSimpleElement(<path ID>, <element ID>, <type>, <key>, 
//                                 <simple compression value>):
//                This function receives an update for the value (<type> and
//                <key>) of a single terminal value in the monitored 
//                sub-tree. <path ID> and <element ID> define the data node
//                carrying the terminal value being updated (which must
//                be inside the sub-tree being monitored). <simple compression
//                value> may be provided if the simple compresion value for
//                <type> and <key> was already calculated.
//             removeSimpleElement(<path ID>, <element ID>): completely 
//                remove a simple value added by updateSimpleElement().
//             completeUpdate():
//                this function is called after all modifications to
//                a sub-tree have been reported to the monitor
//                through the updateSimpleElement() and
//                removeSimpleElement() functions. A call to this
//                function indicates to the monitor that it should not
//                expect any more updates in this update cycle and
//                that it can perform any operations required to
//                complete the update operation.
//                This function is called once per sub-tree being monitored
//                by this monitor. It is not provided with the ID of 
//                the root of the sub-tree for which it was called.

//         After receiving updates through these functions, the monitor
//         object can expect to receive a call to subTreeUpdate() at which 
//         time it can complete the processing of these updates.
//         Note the differences between completeUpdate() and 
//         subTreeUpdate(): 
//         1. compeleteUpdate() is called before subTreeUpdate().
//         2. completeUpdate() is called once per sub-tree monitored
//            by the monitor, while subTreeUpdate() is called once per monitor,
//            with a list of sub-tree roots where changes have occurred.
//            Not all of these monitored sub-tree roots must necessarily
//            be monitored by this monitor (the monitor has to filter
//            the relevant nodes by itself). 
//
//      registerCompressionOnNode(<path ID>, <data element ID>, <monitor ID>):
//         This is equivalent to calling registerSubTreeRetrievalOnNode()
//         without a <monitor object>. It requests compression to be
//         calculated for the sub-tree rooted at the data node given by 
//         <path ID> and <data element ID>. The monitoring module then 
//         receives its updates through the subTreeUpdate() interface
//         (see above) which notifies it that an updated compression value
//         is available (the monitor then needs to read this value, see 
//         interface description further below).
//
// Removal of registration takes place through similar function (each the
// counterpart of the corresponding registration function) where <ID> is
// the monitor ID returned by the call to addSubTreeMonitor():
//    removeSubTreeMonitor(<path ID>, <monitor ID>)
//    unregisterSubTreeRetrievalOnNode(<path ID>, <data element ID>, 
//                                     <monitor ID>)
//    unregisterCompressionOnNode(<path ID>, <data element ID>, <monitor ID>)
//
// Object Structure
// ================
//
// The InternalQCMIndexer object has the following structure:
//
// {
//    qcm: <InternalQCM>,
//    id: <ID of this indexer>
//    paths: <root path node>,
//    pathNodesById: {
//        <path node ID>: <path node>,
//        .......
//    }
//    numPathNodes: <number>
//    rootPathNodeId: <path node ID of root path node>,
//
//    pathActiveNotify: {
//        <path ID>: {
//            toNotify: {
//                 <object ID>: <object>
//                 .....
//            }
//            toNotifyNum: <number of entries in 'toNotify'>
//        }
//        .......
//    }
//
//    dataElements: <DataElements>
// }
//
// qcm: the InternalQCM object which s the owner of this index.
// id: an ID for this indexer. This ID should at least be unique
//   among all indexers generated by the same QCM. In practice, this
//   ID is globally unique among all internal QCM indexers. 
// paths: this holds the tree of paths which are queried by the internal
//    QCM. The 'paths' fields is a pointer to the root node of this tree.
//    Every node in this tree is an object with the following structure:
//    {
//        indexer: <pointer to the owner indexer>
//        pathId: <a number>
//        parent: <parent path node>
//        parentAttr: <attribute in parent under which this node is stored>
//        children: {
//            <attr>: <path node>
//            ......
//        },
//        tracingChildren: {
//            <attr>: <path node>,
//            .....
//        },
//        numTracingChildren: <number of entries in 'tracingChildren'>
//
//        keepActive: <number>
//        deactivateBlocked: true|false
//
//        nodes: <Map object>: {
//            <data element ID>: {
//                type: <the sub-index type for this node>,
//                key: <simple value or RangeKey>,
//                rangeNodeId: undefined|<ID of dominating range node>
//
//                hasAttrs: true|false
//                nonAttrs: <Map with attributes excluded from monitoring>
//                
//                subTree: <InternalSubTree>
//                numSubTreeRequests: <integer>
//                subTreeRoots: {
//                    <path ID>: <data element ID>
//                    .....
//                }
//                numSubTreeRoots: <number of entries in subTreeRoots>
//
//                simpleCompressedValue: <integer>,
//
//                /* additional information added by derived classes */
//            }
//            .......
//        },
//        hasDataElements: true|false
//        notifyWithElements: {
//            <query calc node ID>: <query calc node>
//            .......
//        }
//
//        operandCount: <number of operand nodes at this path>
//
//        queryMatchList: <IntHashMap>{
//           <query ID>: <IntHashMap>{
//               <data element ID>: <count>,
//               ....
//           }
//        },
//        addedNodes: <Map object>: { // temporary list during update
//             <data element ID>: true,
//             .....
//        },
//        removedNodes: <Map object>: { // temporary list during update
//             <data element ID>: true
//             .....
//        }
//        removedSubTrees: <Map>{ // temporary list during update
//             <data element ID>: <InternalSubTree>
//             .....
//        }
//
//        queryCalcs: <IntHashMap>{
//            <query ID>: <InternalQueryCalc>
//            .......
//        },
//        queryValueIds: {
//            <value ID>: <query ID>,
//            .......
//        },
//        nonIndexedQueryCalcs: <IntHashMap>{
//            <query ID>: <query calcualtion node>
//            .......
//        },
//        keyUpdateQueryCalcs: <IntHashMap>{
//            <query ID>: <query calculation node>
//            .......
//        },
//        currentlyUpdatedQueryCalc: undefined|<query ID>
//
//        // modes
//        needTracing: <number>,
//        trace: true|false,
//        subTree: <number>,
//
//        // indexing fields
//
//        needIndex: <number>,
//        alphabeticRanges: true|false 
//        subIndexes: {
//            <type>: <sub-index for this type>
//            ......
//        },
//        keyUpdateQueue: {
//            elementIds: <array of element IDs>,
//            types: <array of types (strings)>,
//            keys: <array of keys>,
//            prevTypes: <array of types (strings)>,
//            prevKeys: <array of keys>
//        },
//        prevKeys: <Map>{
//            <element ID>: {
//                type: <type (string)>,
//                key: <simple value or ConstRangeKey>
//                hasAttrs: undefined|true|false
//            }
//            .....
//        },
//
//        // sub-tree retrieval fields
//
//        subTreeMonitors: {
//             <monitor ID>: <monitor object>
//             .....
//        }
//        numSubTreeMonitors: <number of entries in subTreeMonitors>
//        parentSubTreeCount: <number>
//
//        subTreeRootUpdateIds: {
//            <element ID>: true,
//            ......
//        }
//        subTreeMonitorUpdateIds: {
//            <monitor ID>: { 
//                <element ID>: true,
//                .......
//            }
//            .....
//        }
//
//        scheduled: true|false
//    }
//
//    pathId: a number assigned to this node as ID. These IDs are
//       assigned by the internal QCM to ensure that these IDs are
//       assigned consistently across all indexers on the same QCM.
//       Higher (shorter path) nodes are always assigned a lower path ID 
//       than lower (longer path) nodes.
//    parent: this is the parent path node, which represents the 
//       perfix path. If this node represents the path <a1,...,an-1,an>
//       then the parent node represents the path <a1,...,an-1>.
//    parentAttr: if this node has a parent, this is the attribute in the
//       parent under which this node is stored. This is the last attribute
//       in the path leading to this node. 
//    children: this attribute holds the path nodes which continue the
//       path represented by this node. If the path represented by this
//       node is <a1,...,an> then the node under attribute attr
//       represents the path <a1,...,an,attr>. When there are no children,
//       the 'children' field is removed (to make it easier to check that
//       the list of contniuations is empty).
//    tracingChildren: this is a subset of the set of child path nodes
//       in 'children'. This consists of those children for which path node
//       tracing is set. In cases where only a small number of child path
//       nodes require tracing, this allows the system to decide more quickly
//       under which paths it needs to trace.
//    numTracingChildren: the number of entries in 'tracingChildren'.
//       If this is zero, no tracing needs to take place for paths extending
//       this path node.
//    keepActive: this is a reference count of the number of times this
//       an external module requested this path node to remain active
//       (usually temporarily, while performing various operations).
//       As long as this number is larger than 0, the path node cannot
//       be deactivated. When this drops to zero, the path node is deactivated
//       if there is no other reason to keep it active and 'deactivateBlocked'
//       is true.
//    deactivateBlocked: this is set to true if the path should have been
//       deactivate only this deactivation was blocked by 'keepActive'.
//       When 'keepActive' then drops to zero and there is no other
//       reason to keep the path ode active, it is deactivated
//       (this is to avoid dectivating a path node which was never active
//       but had its 'keepActive' increased and decreased back to zero.
//
//    nodes: this is a list of all data nodes at this path. Each is 
//       represented by the ID of the lowest data element node dominating 
//       it. The lowest data element ID together with the path ID uniquely 
//       define a node in the indexed data. The entry stores information 
//       about the data node. What this information exactly is may depend 
//       on the indexing requirements from the path node and on the derived 
//       class. The following information may be stored by the base
//       class for each data node in the table:
//         type: this is the type of the node's value and is the sub-index 
//            type in which the keys for this node should be stored. This 
//            is the attribute in the 'subIndexes' table under which the 
//            sub-index is stored (for some types, indexing is not supported). 
//            The type is provided by the derived class.
//            In case where this node is a range node, this field has the value
//            equal to the type of the RangeKey object stored under 
//            the 'key' field below. This type is the common type of the 
//            nodes in the range. If there is no such common type or
//            the RangeKey object is empty (there are no values in the
//            range) the type is "range". 
//         key: usually, this is a simple value (number, string or boolean) 
//            which is the simple key at this data node. The key should not,
//            in most cases, be undefined. However, for some types it 
//            may be allowed to be undefined. When the key is undefined,
//            the simple value of the node is not included in the compression.
//            For attribute-value nodes, we use the following scheme:
//            if the node is not part of a monitored sub-tree, the key
//            is undefined. If the node is part of a monitored
//            sub-tree (e.g. when compressing) the key is 0 if the
//            number of attributes is 0 and undefined if the number of
//            attributes is greater than 0 (in this way, the node does
//            not participate in the compression when it leads to
//            additional nodes, but an empty attribute-value is
//            compressed as if it was a special terminal).
//            Range nodes are an exception: their key is not a simple value
//            but a RangeKey object.
//         rangeNodeId: this appears on every node which appears directly
//            under a range node (that is, dominated by it and at the same 
//            path). This holds the data element ID for the range node
//            directly dominating this node (this is the parent data 
//            element ID for this node, but storing it here makes it easier
//            to access the range node).
//         hasAttrs: this is set to true if this node has attributes, that is,
//            if nodes dominated by it should be included in the sub-tree
//            rooted at this node. By default, this is false, which 
//            means that the node has no attributes.
//         nonAttrs: this is an Map object whose kays are the non-attributes
//            of this data node. These are attributes such that nodes dominated
//            by this node under that attribute will not be included in 
//            the sub-tree rooted at this node. This is only needed if the
//            node is marked as having attributes.
//
//         subTree: this field appears if a request has been registered
//            to this node which requires it to retrieve the sub-tree 
//            dominated by this node. This field then hold an InternalSubTree 
//            object. This object is then updated with changes to the 
//            terminal values in the sub-tree and is responsible for 
//            forwarding these modifications to the object which process
//            the sub-tree (e.g. a compression object or a query compilation
//            object).
//         numSubTreeRequests: this is the number of requests to retrieve
//            the sub-tree whose root is this data node which are registered.
//         subTreeRoots: this is a list of path IDs of prefix paths
//            of this path (parent path nodes of this path node) such that
//            the parent data node of this data node on those paths
//            are the roots of retrieved sub-trees (sub-trees for which a
//            retrieval request was registered) and such that this node is
//            part of those trees (iff the 'attrs' of each node along the
//            path fro the root to this node contains the attribute leading
//            to this node). The ID of the sub-tree root data element at each 
//            path is stored under the path ID. If a node has a subTreeRoots 
//            field and is itself a sub-tree root, its path ID must appear 
//            in its own subTreeRoots table.
//         numSubTreeRoots: number of entries in subTreeRoots.
//
//         simpleCompressedValue: this field appears if value compression
//            was requested for a sub-tree containing this node (that is,
//            whose root is either this node or a dominating node).
//            This field holds the compressed value calculated from
//            the 'type' and 'key' fields of this entry.
//            When a retrieved sub-tree which covers this node is updated
//            with the value of this node, it is provided with this
//            value (which is initially undefined). If the sub-tree 
//            received an undefined value an needs to calculate compression,
//            it will calculate the simple compression of the value and
//            return it. This value is then stored here, to be used
//            when updating other sub-trees which cover this node.
//            The simple compression value is cleared (and the compression
//            value released) in three cases: when the data node is 
//            destroyed, when the data node no longer belongs to any sub-tree
//            an when the value of the node changes. In this last case, 
//            the simpleCompressedValue will be set to undefined and 
//            will be calculated anew if any sub-tree this node belongs
//            to requires compression.
//    hasDataElements: this indicates whether any data elements are currently
//       defined at this path node. 
//       It is important for the query calculation process to know this 
//       (see 'match points' in the description of the query calculation nodes).
//       Note that it is possible for this number to be false while 'nodes'
//       is not empty (because 'nodes' holds the lowest data elements,
//       even for nodes which are not data elements themselves).
//       This only becomes false when the data elements are removed
//       from the data element table and not when they are released
//       (when their reference count is decreased). The data elements
//       are only removed in the update epilogue of the path node,
//       which may be somewhat later than the time at which they
//       were removed from the 'nodes' table of the path node. This is
//       because the queries are only updated in the update epilogue of
//       the path node and, in case of removal, this update needs to know 
//       whether there were data elements at this path before the 
//       nodes were removed. 
//    notifyWithElements: this is a list of query calculation nodes which
//       need to be notified when hasDataElements changes.
//       If there are no such query calculation nodes, this is undefined.
//    operandCount: this is the number of operand nodes at this path
//      (that is, the number of nodes whose directly dominating node
//      is at the same path, see 'operator nodes' above for more information).
//      This field may be undefined if there are no operand nodes at this
//      path node. As long as this number is greater than zero, this
//      path nodes has operands (and therefore also operators). When this
//      number drops to zero, there are no more operands. There may still 
//      be operators at this path, but these must all be empty operators,
//      which can be treated as terminals.
//    queryMatchList: this object holds the match updates for each selection
//      query registered to the indexer. Under each query ID, it holds 
//      a list of the data element IDs for which the match count changed
//      and the amount by which it changed. Because the same query 
//      calculation node may register several selection values under 
//      different value IDs, this count can be larger than 1 or smaller than -1.
//      This list is updated every time the key of a data node changes.
//      In the update epilogue, this list is used to update the queries
//      with the changes. The list is then cleared.
//    addedNodes: this is a temporary list of data element IDs maintained
//      during an update cycle when nodes are added and removed from this 
//      path node. This list stores all the data elements added to the 
//      'nodes' table during this cycle. This list is processed and 
//      emptied in the update epilogue of the path node.
//      This list is only updated if there are some non-indexed query
//      calculation nodes registered to the path (as the only use of this
//      queue is to update the non-indexed queries).
//    removedNodes: this is a temporary list of data element IDs maintained
//      during an update cycle when nodes are added and removed from this 
//      path node. This list stores all the data elements removed from the 
//      'nodes' table during this cycle. This list is processed and 
//      emptied in the update epilogue of the path node.
//      This list is only updated if there are some non-indexed query
//      calculation nodes registered to the path (as the only use of this
//      queue is to update the non-indexed queries).
//    removedSubTrees: this is a list of nodes removed during the update
//      cycle which were a sub-tree root at the time of removal. This table
//      stores the InternalSubTree objects which were attached to these removed
//      nodes, so that these could be restored during the update
//      cycle in case the node is removed and immediately added back again.
//      The sub-tree object contains some state (what kind of sub-tree retrieval
//      requests were made for this data node) which must be stored until
//      the update epilogue takes place, in case the node is added back before
//      the update epilogue (in which case, the external modules which made
//      the requests will never hear of the temporary removal of the node
//      and therefore will not be able to register the requests again). 
//    queryCalcs: list of all query calculation nodes registered
//      to this path node.
//    queryValueIds: a selection query may register multiple values to
//      the indexer. The sub-indexers require each lookup registered to 
//      them to have a different ID. Therefore, each simple selection 
//      query calculation node must identify each of its lookup values by 
//      a value ID which is unique across all queries. Each lookup value 
//      is therefore added to the indexer under a query ID and a value ID.
//      The queryValueIds table holds the translation from value ID to 
//      the ID of the query that registered that value ID (and therefore 
//      should be updated when its matches change).
//    nonIndexedQueryCalcs: list of query calculation nodes registered
//      to this path node which do not require indexing. These are
//      terminal projection nodes and 'match all' terminal selection
//      nodes. This is a sub-list of the 'queryCalcs' list. 
//    keyUpdateQueryCalcs: list of query calculation nodes registered
//      to this path node which need to receive updates when keys change. 
//      This is a sub-list of the 'queryCalcs' list (and may overlap with
//      the 'nonIndexedQueryCalcs').
//      To add a query to this list, call this.needKeyUpdateForQuery().
//      This should take place after registering the query with
//      addQueryCalcToPathNode() (to ensure the path node exists).
//      To remove a query from this list, call this.stopKeyUpdateForQuery().
//      This function is called automatically when the query is removed
//      using removeQueryCalcFromPathNode().
//
//    currentlyUpdatedQueryCalc: when matches are added or removed from
//      a query calculation node registered to this path node, this field
//      holds the ID of that query calculation node. This allows other
//      modules (mainly, other query calculation nodes) to check whether
//      they are still scheduled to receive an update (or whether they already
//      received an update). The query ID is stored here as is for addition
//      and the additive complement of the query ID is stored here for
//      removal. undefined is stored here when there is no update taking place.
//      0 is stored here when a complete removal of matches from this
//      path node is taking place but before the query calculation nodes
//      are notified of this.
//
//    Modes
//
//    needTracing: this is the number of registered queries which require
//      tracing at this path node + the number of child path node which
//      have tracing turned on. When this is larger than zero, the indexer
//      must trace all data nodes which are at this path node.
//    trace: this is either true or false and indicates whether tracing
//      is turned on on this path node. Thsi must be turned on immediately
//      when 'needTracing' becomes larger than zero, but does not need
//      to be turned off immediately when 'needTracing' drops to zero
//      (just in case 'needTracing' becomes positive again). Instead,
//      the path node is scheduled to have its tracing turned off.
//    subTree: this stores the number of sub-tree monitors registered to this
//      node (equal to <path node>.numSubTreeMonitors, see below) plus 1 if 
//      <path node>.parentSubTreeCount is not zero, that is, if there is 
//      any data node on this path which is in a sub-tree which is retrieved 
//      at a prefix path node. If this number is at least one, the path node 
//      is in 'sub-tree' mode. Many operations related to sub-tree
//      retrieval are only executed when sub-tree mode is active.
//
//    Indexing fields
//
//    needIndex: this is the number of queries registered to this path node
//      which require indexing. If this field is non-zero, all values at
//      this path should be indexed. However, when this number drops
//      again to zero, the indexing does not necessarily stop immediately
//      (in case indexing is required again, it is a waist to throw away
//      the indexes only to have to construct them again later).
//      Therefore, while a non-zeor count here requires the immediate
//      construction of the indexes, a value of zero does not mean that
//      the indexes are immediately removed. Instead, the indexes are only
//      scheduled to be removed. While scheduled for the removal of the indexes,
//      indexing continues as usual (values are added and removed from the
//      index). To check whether indexes are active, one should check whether
//      <path node>.subIndexes is undefined (no indexing) or not.
//    alphabeticRanges: this indicates whether lookup by string range
//      (ordered alphbetically) should be supported for string value or
//      only discrete lookup should be supported. To simplify the
//      administration of this property, it is set by default to false
//      and can be changed once to true. Once it is true, it cannot be
//      changed back to false unless indexing is turned off (to avoid the
//      need to convert back the indexer).
//      Range lookup is more powerful but also more costly (in time and
//      memory) and is usually not necessary.
//    subIndexes: This field appears only if indexing is turned on for
//      this path node. For every value type (for which there is/was a node
//      in the 'nodes' table with that type) this table holds the 
//      sub-index which is responsible for indexing values of that type. 
//    keyUpdateQueue: this object holds five arrays: 'elementIds',
//      'types', 'keys', 'prevTypes' and 'prevKeys'. Each position in these
//      arrays (the same in all arrays) defines a tuple
//      <elementId, type, key, previous type, previous key> which should be
//      forwarded to query calculation nodes which requested to be notified
//      of key changes. These key updates are added to the queue 
//      when keys are updated by a call to setKeyValue(). Keys are only put
//      on this queue in case key updates were requested before the 
//      call to setKeyValue(). It is assumed that keys added before that were
//      read by the query calculation node from the data nodes directly.
//      Moreover, keys of new nodes are not added to this queue, since
//      the query interested in these values receives a notification that
//      the node was added, so can then look up its value directly.
//      Similarly, key removals due to the removal of the node on which
//      they were stored are not added to this list (because the query
//      receives a notification of the removal) but the removal of a key
//      from a node which continues to exist is queued here (such a removal
//      is supported by the interface, but is probably seldom or never used).
//      This queue is forwarded to the query calculation nodes which 
//      requested updates in the update epilogue. The queue is then cleared.
//      All query calculation nodes are updated with the same queue.
//      It is up to each query calculation node to filter out the nodes
//      it is interested in.
//    prevKeys: this table is created in case some queries requested
//      to receive key updates. When nodes are removed or their keys
//      are changed, their previous key value is stored here. When a
//      query receives a notification that a node was removed, it can look
//      at this table to find the previous value of this node. For each node
//      at this path node whose key changed, this table holds the key
//      of the node at the time of the first modification since the last call
//      to the path node epilogue. If the query previously made use of the key
//      of this node, this is the key it used. Therefore, this allows it
//      access to the key it used last time it received an update.
//      Note that if the key was not removed or changed, it will not be
//      found here and the query needs to look at the value stored 'nodes'
//      table.
//      This table is removed at the end of the path node update epilogue.
//      Note: in case a key changed (and the node was not removed) the
//        key change is also queued on the 'keyUpdateQueue' (assuming some
//        query calculation node registered for key updates). These updates
//        carry both the new key value and the previous key value, so there
//        is no need to get the previous key from 'prevKeys'. 'prevKeys' is
//        therefore mainly useful for access to keys of nodes which were
//        removed (but also stores the previous key for keys which were
//        changed).
//
//    Sub-Tree Retrieval Fields
//
//    subTreeMonitors: this table holds the IDs of all requests for the
//      retrieval of sub-trees at this path node. Only one registration
//      is required here for a module retrieving sub-trees with roots
//      at this path node, even if multiple such trees are retrieved.
//      Each object registering here is considered a "sub-tree monitor".
//      The IDs themselves are assigned by the indexer when the
//      request is registered and are the "sub-tree monitor ID" which 
//      identifies this module and and registration in calls to other 
//      functions. The request registration must provide a sub-tree monitor
//      object which supports receiving 
//      updates when the retrieved sub-tree have changed. Such an object
//      must supprt at least the following functions (where <monitor ID> is 
//      the monitor ID provided by the indexer when the registration takes 
//      place):
//         subTreeUpdate(<path ID>, <array of element IDs>, <monitor ID>): 
//            this receive the list <array of element IDs> of element IDs which 
//            are the root (at path <path ID>) of a retrieved sub-tree which 
//            has just changed.
//
//    numSubTreeMonitors: the number of entries in the subTreeMonitors table.
//
//    parentSubTreeCount: this is the number of node at this path node
//      which are under sub-tree roots on parent path nodes (proper prefix
//      path of this path). When this count goes from 0 to 1, 
//      the subTree mode counter is increased by 1.
//
//    subTreeRootUpdateIds: this table is used to queue the list of data 
//      element IDs representing data nodes at this path for which sub-tree 
//      retrieval was requested and where some change took place in the
//      sub-tree structure since the last call to subTreeUpdateEpilog().
//      During a call to subTreeUpdateEpilog(), this list is provided
//      to the subTreeUpdate() function of all sub-tree monitors registered
//      to this path node.
//    subTreeMonitorUpdateIds: this table is used to queue the list of
//      monitor IDs representing sub-tree monitors which added registrations
//      for sub-tree retrieval since the last call to subTreeUpdateEpilog().
//      Under the entry of each monitor is stored the list of data elements
//      for which the registrations were made.
//      During a call to subTreeUpdateEpilog(), the monitors in this 
//      list are notified that they can now complete the initialization of
//      monitoring for these sub-trees. By delaying this to the 
//      subTreeUpdateEpilog(), we give the indexer the chance to update 
//      the retreived sub-tree before the monitor completes the initialization 
//      (otherwise, the monitor will complete the initialization based on 
//      an incomplete sub-tree, only to update it in the next round).
//
//    Note: the difference between subTreeRootUpdateIds and 
//      subTreeMonitorUpdateIds is that the first notifies existing monitors
//      of changes in the data while the second notifies new monitors
//      (even if there were no changes in the data, in which case 
//      subTreeRootUpdateIds will be empty).
//
//    scheduled: this is set to true when some update takes place on the 
//      path node which requires the path node update epilogue to be run.
//      The path node is the added to the path node queue. Once the the 
//      update epilogue runs, this flag is reset.
//
// pathNodesById: this table indexes all path nodes under 'paths' under
//    their path ID.
// numPathNodes: this is the number of entries in 'pathNodesById'.
// rootPathNodeId: the ID of the root path node. This never changes.
//
// pathActiveNotify: this table holds a list of objects which requested
//    to be notified when the 'active' status of a path changes 
//    (a path node is active if either the 'trace' or the 'subTree'
//    mode is set). Any object which has an ID allocated from the ID
//    pool of the InternalQCM of this indexer and which implements
//    the function pathActivated(<path ID>) and pathDeactivated(<path ID>)
//    can be registered into this table.
//    The table stores the objects by the path ID they requested to be
//    notified of (the same object can be requested to be notified 
//    for several path IDs). The entry for a specific path is removed 
//    when it becomes empty.
//    Note that entries can be added to this table before the path node
//    for the corresponding path ID is created (this is the reason this
//    table is stored outside the path node objects).
//
// dataElements: this is an object with an entry for every data element
//    encountered along the query paths. See the implementation of
//    this object in dataElements.js for more details.
//

// %%include%%: <scripts/utils/arrayUtils.js>
// %%include%%: <scripts/utils/intHashTable.js>
// %%include%%: "internalQCM.js"
// %%include%%: "dataElements.js"
// %%include%%: "internalSubTree.js"
// %%include%%: "rangeKey.js"
// %%include%%: "debugInternalTo.js"
// %%include%%: "index/discreteSubIndex.js"
// %%include%%: "index/linearSubIndex.js"

var internalQCMIndexerNextId = 1025;
var internalQCMIndexerNextDataElementId = 1025;

/////////////////
// Constructor //
/////////////////

// The constructor must be given a pointer to the internal QCM to which it
// belongs.

function InternalQCMIndexer(internalQCM)
{
	this.qcm = internalQCM;
	this.id = internalQCMIndexerNextId++;

    this.rootPathNodeId = this.qcm.getRootPathId(); // this will not change

    this.pathNodesById = {};
    this.numPathNodes = 0;
    
    this.dataElements = this.createDataElements();
}

// create the data element table for this object (may be modified by
// derived classes

InternalQCMIndexer.prototype.createDataElements =
    internalQCMIndexerCreateDataElements;

function internalQCMIndexerCreateDataElements()
{
    return new DataElements(this);
}

// Destructor

// There is not much to do here, as most cleanup work is carried out by the
// path node garbage collection.

InternalQCMIndexer.prototype.destroy = internalQCMIndexerDestroy;

function internalQCMIndexerDestroy()
{
    this.qcm.removeIndexerFromQueues(this.id);
}

// types which are considered 'alphabetic' (that is, can be ordered
// alphabetically is needed). These are the types whose keys are strings
InternalQCMIndexer.prototype.alphabeticTypes = {
    "string": true
};

// returns true if tihs type should not be indexed

InternalQCMIndexer.prototype.isUnindexedType = 
    internalQCMIndexerIsUnindexedType;

function internalQCMIndexerIsUnindexedType(type)
{
    return (type == "attributeValue" || type == "functionApplication" ||
            type == "defun" || type == "negation" || type == "range");
}

// The indexer must sometimes distinguish between the different element 
// reference types (area and pointer references, for now). For this reason,
// the type stored on each node entry in the indexer is the more specific
//"areaReference" or "pointerReference". However, in cases where one does
// not care which type of element reference it is, the function below allows
// one to check whether a certain type is an element reference or not. 

InternalQCMIndexer.prototype.isElementReferenceType = 
    internalQCMIndexerIsElementReferenceType;

function internalQCMIndexerIsElementReferenceType(type)
{
        return (type == "areaReference" || type == "pointerReference");
}

// Returns true if the given type (a string) is an operator type.
// Note that as long as a range node has type "range" it is considered an 
// operator but when a convex hull is created the type of the node
// changes to the type of the convex hull and this function will no longer
// consider this node to be an operator (though structurally it continues
// to dominate data elements at its own path.

InternalQCMIndexer.prototype.isOperatorType = 
    internalQCMIndexerIsOperatorType;

function internalQCMIndexerIsOperatorType(type)
{
        return (type == "negation" || type == "range");
}

// Returns true if the given 'key' is an instance of one of the range key 
// types.

InternalQCMIndexer.prototype.isRangeKey = 
    internalQCMIndexerIsRangeKey;

function internalQCMIndexerIsRangeKey(key)
{
        return ((key instanceof RangeKey) || (key instanceof ConstRangeKey));
}

// Return the ID of this indexer

InternalQCMIndexer.prototype.getId = internalQCMIndexerGetId;

function internalQCMIndexerGetId()
{
	return this.id;
}

// this function returns the ID of the root path node. This ID is static
// and never changes.

InternalQCMIndexer.prototype.getRootPathId = 
    internalQCMIndexerGetRootPathId;

function internalQCMIndexerGetRootPathId()
{
	return this.rootPathNodeId;
}

////////////////////////////////
// Adding/Removing Path Nodes //
////////////////////////////////

// Given a path ID (which must already have been allocated in the
// path ID allocator) this function creates all path nodes (which do not 
// yet exist) for this path and all its prefixes (existing path nodes 
// are not replaced).
// The path node for this path (whether new or already existing) is
// returned.

InternalQCMIndexer.prototype.addPath = internalQCMIndexerAddPath;

function internalQCMIndexerAddPath(pathId)
{
    var node;

    // get the path node. If it does not exist, create it (this will also
    // create all parent path nodes, if necessary)
    
    if(!(node = this.pathNodesById[pathId])) {
        var prefixPathId = this.qcm.getPrefix(pathId);
        if(prefixPathId && !this.pathNodesById[prefixPathId])
            this.addPath(prefixPathId);
        node = this.createPathNode(pathId);
        // place under parent
        if(!node.parent) // root path node
            this.paths = node;
        else {
            if(!node.parent.children)
                node.parent.children = {};
            node.parent.children[node.parentAttr] = node;
        }
    }

    return node;
}

// This creates a new object representing a path node for the given path ID. 
// The path ID must have already been allocated.
// This function is for internal use by the 'addPath' function.

InternalQCMIndexer.prototype.createPathNode = internalQCMIndexerCreatePathNode;

function internalQCMIndexerCreatePathNode(pathId)
{
    if(this.pathNodesById[pathId])
        return this.pathNodesById[pathId]; // already created

    var prefixId = this.qcm.getPrefix(pathId);
    var parent;

    if(prefixId) {
        // 'pathId' not the root path, so its reference count must be increased
        this.qcm.allocatePathIdByPathId(pathId);

        if(!(parent = this.pathNodesById[prefixId]))
            parent = this.addPath(prefixId);
    }
    
    var pathNode = {
        indexer: this,
        pathId: pathId,  
        parent: parent,
	    parentAttr: parent ? this.qcm.getLastPathAttr(pathId) : undefined,
        children: undefined,
        tracingChildren: undefined,
        numTracingChildren: 0,
        keepActive: 0,
        deactivateBlocked: false,
        nodes: new IntHashMap(),
        hasDataElements: false,
        notifyWithElements: undefined,
        operandCount: 0,
        queryMatchList: undefined,
        addedNodes: undefined,
        removedNodes: undefined,
        removedSubTrees: undefined,
        queryCalcs: undefined,
        queryValueIds: undefined,
        nonIndexedQueryCalcs: undefined,
        keyUpdateQueryCalcs: undefined,
        currentlyUpdatedQueryCalc: undefined,
        needTracing: 0,
        trace: false,
        subTree: 0,
        needIndex: 0,
        alphabeticRanges: false,
        subIndexes: undefined,
        keyUpdateQueue: undefined,
        prevKeys: undefined,
        subTreeMonitors: undefined,
        numSubTreeMonitors: 0,
        parentSubTreeCount: 0,
        subTreeRootUpdateIds: undefined,
        subTreeMonitorUpdateIds: undefined,
        scheduled: false
    };

    this.pathNodesById[pathNode.pathId] = pathNode;
    this.numPathNodes++;
    this.dataElements.updateNumPathNodes(this.numPathNodes);
    return pathNode;
}

// This function clears the given path node to reset the values of all
// fields to the values which were set upon construction.

InternalQCMIndexer.prototype.clearPathNode = internalQCMIndexerClearPathNode;

function internalQCMIndexerClearPathNode(pathNode)
{
    pathNode.children = undefined;
    pathNode.tracingChildren = undefined;
    pathNode.numTracingChildren = 0;

    this.removeAllNodesOnPathNode(pathNode);

    pathNode.keepActive = 0;
    pathNode.deactivateBlocked = false;
    
    pathNode.hasDataElements = false;
    pathNode.notifyWithElements = undefined;
    pathNode.operandCount = 0;
    pathNode.queryMatchList = undefined;
    pathNode.addedNodes = undefined;
    pathNode.removedNodes = undefined;
    pathNode.removedSubTrees = undefined;
    pathNode.queryCalcs = undefined;
    pathNode.queryValueIds = undefined;
    pathNode.nonIndexedQueryCalcs = undefined;
    pathNode.keyUpdateQueryCalcs = undefined;
    pathNode.currentlyUpdatedQueryCalc = undefined;
    pathNode.needTracing = 0;
    pathNode.trace = false;
    pathNode.subTree = 0;
    pathNode.needIndex = 0;
    pathNode.alphabeticRanges = false;
    pathNode.subIndexes = undefined;
    pathNode.keyUpdateQueue = undefined;
    pathNode.prevKeys = undefined;
    pathNode.subTreeMonitors = undefined;
    pathNode.numSubTreeMonitors = 0;
    pathNode.parentSubTreeCount = 0;
    pathNode.subTreeRootUpdateIds = undefined;
    pathNode.subTreeMonitorUpdateIds = undefined;
    pathNode.scheduled = false;
}

// This forces the path node to remain active even if for all other reasons
// it has become inactive. This is is to be used in cases where the
// node may become temporarily inactive (for example, as a result of
// first removing nodes and only then adding new ones). One should call
// 'releaseKeepPathNodeActive()' when this lock needs to be released.
// For every time 'keepPathNodeActive()' is called,
// 'releaseKeepPathNodeActive()' must also be called once to release the
// locking.

InternalQCMIndexer.prototype.keepPathNodeActive =
    internalQCMIndexerKeepPathNodeActive;

function internalQCMIndexerKeepPathNodeActive(pathNode)
{
    pathNode.keepActive++;
}

// Decrease the count of the lock which keeps this path inactive. If this
// drops to zero and there is no reason to keep the path active and
// '<path node>.deactivateBlocked' is true (meaning that a deactivate
// should have taken place while 'keepActive' was set) the path node
// is deactivated.

InternalQCMIndexer.prototype.releaseKeepPathNodeActive =
    internalQCMIndexerReleaseKeepPathNodeActive;

function internalQCMIndexerReleaseKeepPathNodeActive(pathNode)
{
    if(pathNode.keepActive === 0)
        return;
    
    if(--pathNode.keepActive === 0) {
        if(pathNode.trace || pathNode.subTree) {
            pathNode.deactivateBlocked = false;
            return; // still active for other reasons.
        }
        if(pathNode.deactivateBlocked) {
            pathNode.deactivateBlocked = false;
            this.pathNodeDeactivated(pathNode); // notify the derived class
            this.notifyPathDeactivated(pathNode); // notify other modules
        }
    }
}

// given a path node, this function removes this path node from the
// indexer. It is assumed that when this function is called, the path node
// may be removed. Moreover, if this path node may be removed, then
// so may also its child path nodes (if they still exist). This function
// then first removes the children and then removes the path node.

InternalQCMIndexer.prototype.removePathNode = internalQCMIndexerRemovePathNode;

function internalQCMIndexerRemovePathNode(pathNode)
{
    if(pathNode.children !== undefined) {
        for(var attr in pathNode.children)
            this.removePathNode(pathNode.children[attr]);
    }

    // clear the nodes (mainly, decrease data element reference count)
    this.removeAllNodesOnPathNode(pathNode);
    
    delete this.pathNodesById[pathNode.pathId];
    this.numPathNodes--;
    this.dataElements.updateNumPathNodes(this.numPathNodes);
    
    // the path node is destroyed by removing it from its parent
    
    var parent = pathNode.parent;
    if(!parent) {
        // this is the root node, remove it
        this.paths = undefined;
        return;
    }

	// this is not the root node, release the ID allocated
	this.qcm.releasePathId(pathNode.pathId);

    // remove from parent node
    delete parent.children[pathNode.parentAttr]; // destroy the path node
    if(isEmptyObj(parent.children))
        parent.children = undefined;
}

// This function can be called to remove all data nodes at a path
// node. It then removes the data nodes not only from that path node
// but also from all child path nodes (because every data node on a 
// path must be dominated by nodes on the prefix paths). 
// After clearing the child nodes, this function clears all the nodes
// stored in the 'nodes' table on the path node (removing any data
// elements which are no longer needed as a result of this operation),
// destroys any sub-indexes defined on the path node and notifies any
// queries registered to this path node that all matches were removed.
// This function does not change the list of queries registered to it
// or the properties of the path node which are a function of the
// queries registered to it (e.g. whether it requires indexing).
// If the 'dontClearDataElements' flag is set, this function will not 
// attempt to remove any data elements. This flag should not be set when
// calling this function but is used when calling this function recursively
// inside itself. This is used when the operation is first applied to the
// root path node so that all data nodes are removed and therefore the 
// data elements can simply be removed by destroying the data element 
// table.
// The third argument, 'recursiveCall' is also for internal use only,
// when calling this function recursively within itself. This flag is
// set when the function is called recursively, so that the function 
// knows that all data nodes of the parent node are also removed.
// This does not notify the derived class that the node were removed. It
// is assumed that the derived class initiated this process or was
// notified separately of this removal.

InternalQCMIndexer.prototype.clearAllDataNodes = 
    internalQCMIndexerClearAllDataNodes;

function internalQCMIndexerClearAllDataNodes(pathNode, dontClearDataElements,
                                             recursiveCall)
{
    if(!pathNode.parent) {
        // clearing the root path node, all nodes are cleared, so the data
        // elements can be cleared at the end
        dontClearDataElements = true;
    }

    // indicate that the removal is taking place
    pathNode.currentlyUpdatedQueryCalc = 0;
    
    // clear the data nodes from the paths extending this path (there 
    // cannot be data nodes on the child if there are no data nodes on the
    // parent). Mark this as a recursive call (third argument)
    for(var attr in pathNode.children)
        this.clearAllDataNodes(pathNode.children[attr], dontClearDataElements,
                               true);

    // remove any query updates still queued
    pathNode.queryMatchList = new IntHashMap();    
    
    if(pathNode.queryCalcs !== undefined && pathNode.queryCalcs.size > 0) {
        // store keys temporarily, in case some function needs them
        if(pathNode.prevKeys !== undefined) {
            // need to add the current keys to the list
            var prevKeys = pathNode.prevKeys;
            pathNode.nodes.forEach(function(entry, elementId) {
                if(!prevKeys.has(elementId))
                    prevKeys.set(elementId, entry);
            });
        } else // store the nodes, there will not be any other keys removed
            pathNode.prevKeys = pathNode.nodes;
        // schedule this path node (to make sure the prevKeys are cleared)
        if(!pathNode.scheduled)
            this.qcm.schedulePathNode(pathNode);

        // notify the queries that all nodes were removed
        pathNode.queryCalcs.forEach(function(queryCalc, queryId) {
            pathNode.currentlyUpdatedQueryCalc = -queryId;
            queryCalc.removeAllIndexerMatches();
            pathNode.currentlyUpdatedQueryCalc = undefined;
        });
    }

    pathNode.addedNodes = undefined;
    pathNode.removedNodes = undefined;
    
    pathNode.currentlyUpdatedQueryCalc = undefined; // all removals took place
    
    // clear data element table (if necessary)
    if(!dontClearDataElements)
        this.removeAllNodesOnPathNode(pathNode);

    // clear the node table
    pathNode.nodes = new IntHashMap();

    if(pathNode.hasDataElements)
        this.notifyPathHasNoDataElements(pathNode.pathId);
    
    // clear values from indexes (remove those indexes which do not have any
    // queries registered to them)
    if(pathNode.subIndexes) {
        for(var type in pathNode.subIndexes) {
            var subIndex = pathNode.subIndexes[type];
            if(subIndex.hasNoLookups())
                delete pathNode.subIndexes[type];
            else
                subIndex.clearValues();
        }
    }

    // clear any keys still being queued
	pathNode.keyUpdateQueue = undefined;

    // clear sub-tree retrieval counts
    if(pathNode.subTree) {
        if(recursiveCall)
            // all data nodes are about to be removed from the parent, so there
            // remains no data node on the parent path node which has this
            // path as an attribute.
            pathNode.parentSubTreeCount = 0;
        // if the parent still has some data nodes which are part of a 
        // retrieved sub-tree and have this path as an attribute, 1 still
        // remains in the sub-tree count.
        if(pathNode.parentSubTreeCount > 0)
            pathNode.subTree = 1;
        else {
            pathNode.subTree = 0;
            this.deactivateSubTreeMonitoringOnPath(pathNode);
        }
        pathNode.subTreeRootUpdateIds = {};
        pathNode.subTreeMonitorUpdateIds = {};
    }

    if(!pathNode.parent) // destroy the data element table
        this.dataElements = this.createDataElements();
}

// clear this indexer of all data

InternalQCMIndexer.prototype.clear = internalQCMIndexerClear;

function internalQCMIndexerClear()
{
    if (this.paths !== undefined) {
        this.clearAllDataNodes(this.paths);
    }
}

////////////////////////////
// Path Node Type Setting //
////////////////////////////

// This function is called each time tracing is required on the given path node
// (for example, each time a query calculation is registered to the path
// which requires tracing or when a child node has its trace count increase
// from zero to 1). This function then increases by 1 the trace count for the
// given path node. If the trace count increase from 0 to 1, the
// parent path node's (if any) trace count is first also increased by 1.
// Next, the derived class is notified that tracing has been activated
// (by calling pathNodeTracingActivated()).

InternalQCMIndexer.prototype.incPathNodeTracing = 
	internalQCMIndexerIncPathNodeTracing;

function internalQCMIndexerIncPathNodeTracing(pathNode)
{
    var parent;

    if(pathNode.needTracing > 0) {
        // not first time, just increase count
        pathNode.needTracing++;
        return;
    }

    // first time
    
	if((parent = pathNode.parent) !== undefined) {
        // increase the parent's trace count
		this.incPathNodeTracing(pathNode.parent);
    }

	pathNode.needTracing = 1;

    if(pathNode.trace) {
        // tracing was still active as a result of an earier requirement
        // (remvoe any scheduled request to turn off tracing).
        this.qcm.descheduleTraceDeactivation(pathNode);
        return;
    }

    
    if(parent) {
        
        // add this as a tracing child of the parent
        if(!parent.tracingChildren) {
            parent.tracingChildren = {};
            parent.numTracingChildren = 1;
        } else
            parent.numTracingChildren++;
        
        parent.tracingChildren[pathNode.parentAttr] = pathNode;
    }
    
    pathNode.trace = true;

    if(!pathNode.subTree) {
        // path just became active
        this.pathNodeActivated(pathNode); // notify the derived class
        this.notifyPathActivated(pathNode); // notify other modules
    } else
        // path was already active (monitored) so notify the derived class
        // that tracing should also be performed.
        this.pathNodeTracingActivated(pathNode);
}

// This function is called each time a tracing requirement is removed from
// the given path node (for example, when a query calculation node is
// de-registered or when a child path node tracing requirement drops to zero).
// This function then decreases the 'needTracing' count on this path node.
// If this dropped to zero, the path node is scheduled to have its tracing
// turned off (but tracing is not immediately turned off). The parent path
// node is alos notified to decerase its own 'needTracing' count.

InternalQCMIndexer.prototype.decPathNodeTracing = 
	internalQCMIndexerDecPathNodeTracing;

function internalQCMIndexerDecPathNodeTracing(pathNode)
{
    var parent;

    if(--pathNode.needTracing > 0)
        return; // did not drop to zero, so tracing still required

    // schedule tracing to be turned off
    this.qcm.scheduleTraceDeactivation(pathNode);
    
	if((parent = pathNode.parent) !== undefined) {
        // decrease the parent's need-tracing count
		this.decPathNodeTracing(pathNode.parent);
    }
}

// This function is called to remove tracing from the path node. This
// is called after the path node was scheduled to have its tracing turned off.
// The function first checks whether tracing can indeed be turned off:
// 1. 'needTracing' must be zero
// 2. no child path node may be tracing. Tracing child path nodes have
//    their tracing turned off immediately by this function, since they
//    must have been scheduled for stopping their tracing before this
//    path node.
// If allowed to turn off tracing, the function then turns tracing off.
// This does not include removing nodes from the 'nodes' table, as these
// are removed by the derived class 'pathNodeTracingDeactivated()' function.

InternalQCMIndexer.prototype.removePathNodeTracing = 
	internalQCMIndexerRemovePathNodeTracing;

function internalQCMIndexerRemovePathNodeTracing(pathNode)
{
	if(!pathNode.trace)
		return; // nothing to do, no tracing is active

    if(pathNode.needTracing > 0)
        return; // tracing still required, cannot removing tracing

    // if any of the child nodes requires tracing, 
    if(pathNode.numTracingChildren > 0) {
        // tracing must first be stopped on the children
        for(var attr in pathNode.tracingChildren)
            this.removePathNodeTracing(pathNode.tracingChildren[attr]);
        if(pathNode.numTracingChildren > 0)
            return; // failed to remove tracing on one of the children
    }

    // remove tracing
    
	pathNode.trace = false;

    var parent;
    if((parent = pathNode.parent) !== undefined) {
        delete parent.tracingChildren[pathNode.parentAttr];
        parent.numTracingChildren--;
    }

    if(!pathNode.subTree) { // path just became inactive
        if(pathNode.keepActive) {
            pathNode.deactivateBlocked = true;
            return;
        }
        this.pathNodeDeactivated(pathNode); // notify the derived class
        this.notifyPathDeactivated(pathNode); // notify other modules
    } else {
	    // path not deactivated (has monitoring), notify the derived class
        // that tracing has been deactivated
	    this.pathNodeTracingDeactivated(pathNode);
    }
}

// returns true if the path node for the given path ID exists and
// either has tracing or sub-tree monitoring set on it. 

InternalQCMIndexer.prototype.isPathActive = internalQCMIndexerIsPathActive; 

function internalQCMIndexerIsPathActive(pathId)
{
    if(!(pathId in this.pathNodesById))
       return false;

    var pathNode = this.pathNodesById[pathId];
    
    return pathNode.trace || !!pathNode.subTree;
}

////////////////////////////////
// Index Creation/Destruction //
////////////////////////////////

// This function increases the the count of the 'needIndex' property on the
// given path node. If this increased the 'needIndex' value from 0 to 1,
// indexing becomes required and will be activated (unless already active),
// which mean that all existing values stored on the path node are indexed.
// It may be that 'needIndex' was zero before this function was called and
// indexing was active if the needIndex property dropped to zero only
// temporarily.

InternalQCMIndexer.prototype.incPathNodeIndexing = 
	internalQCMIndexerIncPathNodeIndexing;

function internalQCMIndexerIncPathNodeIndexing(pathNode)
{
    if(pathNode.needIndex > 0) {
        pathNode.needIndex++;
        return; // nothing more to do
    }

    pathNode.needIndex = 1;

    // check whether the sub-indexes were removed (they may still exist if
    // indexing was only turned off temporarily)
    if(pathNode.subIndexes !== undefined) {
        // if the path node is still scheduled for removing its indexes,
        // de-schedule it.
        this.qcm.scheduleIndexDestroy(pathNode);
        return;
    }

    pathNode.subIndexes = {};
    
    // initialize the indexes with the keys of the data nodes already 
    // stored on this path node.
    this.loadDataIntoIndexes(pathNode);
}

// This function decrease the count of the 'needIndex' property. When this
// drops to zero, there is no longer any need to index on this path node.
// However, to avoid destroying the indexes only to have to construct them
// again, the indexes are not immediately destroyed (and the indexes
// become active, continuing to have value added and removed from them)
// but the path node is scheduled to have tis indexes removed. It is then
// up to the scheduling mechanism to decide when to destroy the indexes.

InternalQCMIndexer.prototype.decPathNodeIndexing = 
	internalQCMIndexerDecPathNodeIndexing;

function internalQCMIndexerDecPathNodeIndexing(pathNode)
{
    if(--pathNode.needIndex > 0)
        return; // still requires indexing

    this.qcm.scheduleIndexDestroy(pathNode);
}

// Calling this function turns on alphabetic ranges on this path node,
// that is, indexing of string values as an ordered set allowing for
// range lookup (e.g. r("a", "c")). If no indexing has yet been activated
// on this path node, this function only records the fact that alphabetic
// ranges were requested. If indexing is already turned on and alphabetic
// ranges were not previously requested, the string sub-index (if any)
// is converted from a discrete index to a linear index.

InternalQCMIndexer.prototype.setAlphabeticRanges = 
	internalQCMIndexerSetAlphabeticRanges;

function internalQCMIndexerSetAlphabeticRanges(pathNode)
{
    if(pathNode.alphabeticRanges)
        return; // alphabetic ranges already activated

    pathNode.alphabeticRanges = true;

    if(this.subIndexes === undefined)
        return; // no indexing required yet, so nothing to do for now

    // find the string based indexes, get their discrete sub-indexes
    // (if already created) and convert them into linear sub-indexes.
    // (this does not change the matches, so there is no need to
    // perform any further actions).
        
    for(var type in this.alphabeticTypes) {
        var subIndex = pathNode.subIndexes[type];
        if(!subIndex || subIndex.supportsIntervals())
            continue;
        var linearSubIndex = pathNode.subIndexes[type] =
            new LinearSubIndex(LinearSubIndex.stringCompare);
        // load the linear index from the discrete index
        linearSubIndex.loadFromDiscrete(subIndex);
    }
}

// This function loads the data nodes on the given path node into
// the indexes. It is assumed that no data was previously stored in the
// indexes. It may also be that the indexes have to be constructed. 
// It is not assumed, however, that the indexes do not exist or that no
// queries are already registered to the indexes. The function is optimized
// for the case where all data nodes stored on the path node are of the 
// same type (this is very likely, though not required).
// If some queries are already registered into the indexes, this stores the 
// matches for these queries in the 'queryMatchList' table of the path node.

InternalQCMIndexer.prototype.loadDataIntoIndexes = 
	internalQCMIndexerLoadDataIntoIndexes;

function internalQCMIndexerLoadDataIntoIndexes(pathNode)
{
    var type; // type of current index being updated
    var subIndex; // current sub-index being updated
    var _self = this;
    
    pathNode.nodes.forEach(function(entry, elementId) {

        // skip here inactive nodes (those dominated by an active range node)
        if(!_self.isActive(pathNode, elementId, entry))
            return;

        if(entry.type === undefined || entry.key === undefined)
            return; // not indexed
        if(type != entry.type) {
            type = entry.type;
            // get the sub-index for this type (if indexing is supported
            // for this type).
            if(!(subIndex = _self.getSubIndex(pathNode, type, true)))
                return; // indexing not supported for this type
        } else if(subIndex === undefined)
            // not a new type and indexing of this type is not supported.
            // continue to the next data node.
            return;

        var key = entry.key;
        var updates;

        // add data to index
        if(typeof(key) == "object")
            // if the key is an object, it must be a range
            updates = subIndex.addValue(elementId, key.getMinKey(), undefined,
                                        key.getMaxKey(), undefined,
                                        key.getMinOpen(), undefined, 
                                        key.getMaxOpen(), undefined);
        else
            updates = subIndex.addValue(elementId, key);

        // if there are lookups already registered, check whether matches
        // were added.
        if(!subIndex.hasNoLookups()) {
            var valueIds = updates.added;
            if(valueIds !== undefined && valueIds.length != 0) {
                for(var i = 0, l = valueIds.length ; i < l ; ++i)
                    _self.updateQueryMatchList(pathNode, valueIds[i], 
                                               elementId, 1);
                if(!pathNode.scheduled)
                    this.qcm.schedulePathNode(pathNode);
            }
        }
    });
}

// This function turns off indexing on this path node. It does so by removing
// all indexes and setting the 'subIndexes' pointer to undefined (which
// indicates that indexing is off). This should typically be called
// after the path node has been scheduled to have its index destroyed.
// If when this is called there are still requirements to index this
// path node, the indexes are not destroyed.

InternalQCMIndexer.prototype.destroyIndexAtNode = 
	internalQCMIndexerDestroyIndexAtNode;

function internalQCMIndexerDestroyIndexAtNode(pathNode)
{
    if(pathNode.needIndex > 0)
        return; // not allowed to destroy, the index is still needed
    if(pathNode.subIndexes === undefined)
        return; // no index to destroy

	pathNode.alphabeticRanges = false;
	pathNode.subIndexes = undefined;
}

////////////////////////////////////////////////
// Node and Data Element Addition and Removal //
////////////////////////////////////////////////

// Returns a new id that can be used for a new data element

InternalQCMIndexer.getNextDataElementId = function() { 
    return internalQCMIndexerNextDataElementId++;
}

// Claims a consecutive range of 'numberElements' data element ids, and
// returns the lowest id.

InternalQCMIndexer.getDataElementIdRange = function(numberElements) { 
    var firstId = internalQCMIndexerNextDataElementId;

    internalQCMIndexerNextDataElementId += numberElements;
    return firstId;
}

// This functions tells the indexer how additional data elements (on top
// of those already stored in the indexer) to expect. The data element
// table will then be set to a size large enough to accommodate this number
// of additional data elements. If the data element table is already
// larger it will not be made smaller.
// By setting this value correctly one can avoid unnecesary resizing of
// the tables and resizing these tables to be larger than actually needed.
// Note that this number is in addition to the existing number of data
// elements and that all data elements at all paths are counted here
// together.

InternalQCMIndexer.prototype.expectAdditionalDataElementNum = 
	internalQCMIndexerExpectAdditionalDataElementNum;

function internalQCMIndexerExpectAdditionalDataElementNum(dataElementNum)
{
    this.dataElements.expectAdditionalDataElementNum(dataElementNum);
}

// This functions tells the indexer how many data nodes to expect at the
// given path. The 'nodes' table will then be set to a size large enough
// to accommodate this number of nodes. If the 'nodes' table is already
// larger it will not be made smaller.
// By setting this value correctly one can avoid unnecesary resizing of
// the tables and resizing these tables to be larger than actually needed.

InternalQCMIndexer.prototype.expectNodeNum = 
	internalQCMIndexerExpectNodeNum;

function internalQCMIndexerExpectNodeNum(pathNode, numNodes)
{
    if(pathNode === undefined)
        return;

    pathNode.nodes.expectSize(numNodes);
}

// This functions tells the indexer how many additional data nodes to expect
// at the given path. The 'nodes' table will then be set to a size large enough
// to accommodate the existing nodes together with this number of new nodes.
// If the 'nodes' table is already larger it will not be made smaller.
// By setting this value correctly one can avoid unnecesary resizing of
// the tables and resizing these tables to be larger than actually needed.

InternalQCMIndexer.prototype.expectAdditionalNodeNum = 
	internalQCMIndexerExpectAdditionalNodeNum;

function internalQCMIndexerExpectAdditionalNodeNum(pathNode, numNodes)
{
    if(pathNode === undefined)
        return;

    pathNode.nodes.expectSize(pathNode.nodes.size + numNodes);
}

// This function is called by the derived class when it wants to 
// add a node entry in the 'nodes' table for a node which is not 
// a data element. In this case, the calling function (in the derived class)
// must provide the data element ID for this node (which was already 
// allocated at a higher path node). This function then creates an
// entry for this node (if it does not exist yet).
// It is up to the calling function to add any derived class specific
// fields to the node entry.
// This function checks whether the parent node (the node with the
// same data element ID on the parent path node) has this path as an attribute 
// and has sub-tree retrieval set on. If it does, the relevant sub-tree 
// retrieval fields are set on this node.

InternalQCMIndexer.prototype.addNonDataElementNode = 
	internalQCMIndexerAddNonDataElementNode;

function internalQCMIndexerAddNonDataElementNode(pathNode, dataElementId)
{
    if(pathNode.nodes.has(dataElementId))
        return; // node already exists

    var elementEntry = this.dataElements.incRef(dataElementId);

	var elementNode = this.newElementNode();
    pathNode.nodes.set(dataElementId, elementNode);

    // check whether this node already dominates data elements at this path:
    // this implies that it is an operator and we need to increase
    // the operand count at this path (this does not happen frequently)
    if(elementEntry.children && elementEntry.children.has(pathNode.pathId)) {
        var operandIds = elementEntry.children.get(pathNode.pathId);
        // increase the operand count with the number of children.
        if(pathNode.operandCount === undefined)
            pathNode.operandCount = operandIds.ids.size;
        else
            pathNode.operandCount += operandIds.ids.size;
    }

	// set dominating sub-tree roots, if any
    if(pathNode.parent !== undefined && pathNode.parent.subTree) 
	    this.setNewNodeSubTreeRoots(pathNode, elementNode, dataElementId, 
                                    dataElementId);

	// queue this node for completion of its addition in the epilogue
	this.queueAddedNode(dataElementId, pathNode);
}

// This function is called by the derived class when it wants to 
// add node entries in the 'nodes' table for nodes which are not 
// data elements. This is similar to addNonDataElementNode() except that
// it performs the operation for a set of elements.
// This function does not implement the insertion of an operator node
// above existing operand nodes, which is implemented in
// addNonDataElementNode(). If the calling function suspects that such an
// unlikely insertion may take place, it should use addNonDataElementNode().

InternalQCMIndexer.prototype.addNonDataElementNodes = 
	internalQCMIndexerAddNonDataElementNodes;

function internalQCMIndexerAddNonDataElementNodes(pathNode, elementIds)
{
    var mayBeInSubTree =
        (pathNode.parent !== undefined && !!pathNode.parent.subTree);
    
    var nodes = pathNode.nodes;
    nodes.expectSize(nodes.size + elementIds.length);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        if(elementId === undefined || nodes.has(elementId))
            continue; // node already exists

        this.dataElements.incRef(elementId);

	    var elementNode = this.newElementNode();
        nodes.set(elementId, elementNode);

	    // set dominating sub-tree roots, if any
        if(mayBeInSubTree) 
	        this.setNewNodeSubTreeRoots(pathNode, elementNode, elementId, 
                                        elementId);
    }

    // queue this nodes for completion of their addition in the epilogue
	this.queueAddedNodes(elementIds, pathNode);
}

// This function is called by the derived class when it wants to 
// add a node entry in the 'nodes' table for a node which is 
// a data element. The calling function (the derived class)
// provides this function with the data element ID of this node
// (it is the responsibility of the derived class to allocate this ID).
// The calling function must also provide the ID of the parent data element.
// This function creates the entry for this data element in the 'nodes' 
// table of the path node. If the entry already exists, it is simply 
// returned. 
// The function checks whether the parent node (the node with the
// parent data element Id on the parent path node) has this path as an
// attribute and has sub-tree retrieval set on. If it does, sub-tree retrieval 
// must also be set on this node. This function increases the data element 
// count on this path node (if the entry is new).
// This function can also be used to assign the base identity to the
// data element: both assigning a base identity to a new node and to
// an existing node. This base identity should be provided in the 
// argument 'baseIdentity'. If 'baseIdentity' is undefined, the default
// base identity is assigned (but only for a new node, for an existing
// node, if its base identity is not the default identity, one needs
// to assign the default identity explicitly by calling 
// 'dataElements.assignDefaultBaseIdentity()' (see dataElements.js). 
// This function returns the entry for this node in the 'nodes' table.
// 'groupId' and 'sourceId' are optional arguments used only in the
// merge indexer. These two values are then stored on the data element
// entry.

InternalQCMIndexer.prototype.addDataElementNode = 
	internalQCMIndexerAddDataElementNode;

function internalQCMIndexerAddDataElementNode(pathNode, dataElementId, 
											  parentDataElementId, baseIdentity,
                                              groupId, sourceId)
{
    if(pathNode.nodes.has(dataElementId)) {
        if(baseIdentity !== undefined)
            this.setBaseIdentityForExistingNode(dataElementId, baseIdentity);
        // nothing to do, the node exists already
        return pathNode.nodes.get(dataElementId);
    }

	// new data element: add its ID to the list of data elements 
    this.dataElements.addNewDataElement(pathNode.pathId, dataElementId,
                                        parentDataElementId, 
                                        baseIdentity, groupId, sourceId);
    
	// create a new node entry

	var elementNode = this.newElementNode();
    pathNode.nodes.set(dataElementId, elementNode);

    // if there is a node at this path with the ID of the parent data element
    // then this node is an operand node (directly dominated by an operator
    // node). We increase the count of operand nodes at this path. If the
    // operand is a range node, we mark this on this node.
    if(parentDataElementId !== undefined &&
       pathNode.nodes.has(parentDataElementId)) {
        if(pathNode.operandCount === undefined)
            pathNode.operandCount = 1;
        else
            pathNode.operandCount++;
        if(typeof(pathNode.nodes.get(parentDataElementId).key) == "object")
            elementNode.rangeNodeId = parentDataElementId;
    }

	// set sub-tree roots, if any
	this.setNewNodeSubTreeRoots(pathNode, elementNode, dataElementId, 
                                parentDataElementId);

    // queue this node for completion of its addition in the epilogue 
    this.queueAddedNode(dataElementId, pathNode);
	
    return elementNode;
}

// Creates a new object to store a node entry

InternalQCMIndexer.prototype.newElementNode = internalQCMIndexerNewElementNode;

function internalQCMIndexerNewElementNode()
{
    return new IndexerElementNode();
}

// Class for single node entry

function IndexerElementNode()
{
    this.type = undefined;
    this.key = undefined;
}

// This function is called by the derived class when it wants to remove
// the node with the given data element Id from the list of nodes
// on the given path node. The removal from the path node takes place
// immediately, including the removal of sub-tree retrieval. However, 
// the removal of the keys from the sub indexers, the notification to
// the affected queries and the decrease in the reference count of the 
// data element are postponed until the update epilogue.

InternalQCMIndexer.prototype.removeNode = internalQCMIndexerRemoveNode;

function internalQCMIndexerRemoveNode(pathNode, dataElementId)
{
	var entry = pathNode.nodes.get(dataElementId);

	if(!entry)
        return;

    // cleanup in case of sub-tree retrieval
    if(this.inSubTree(entry)) {
        this.removeSubTreeNode(entry, pathNode, dataElementId);
        if (pathNode.numSubTreeMonitors > 0 &&
            (dataElementId in pathNode.subTreeRootUpdateIds)) {
            delete pathNode.subTreeRootUpdateIds[dataElementId];
        }
    }

    // check whether this is an operator or operand node
    if(pathNode.operandCount) {
        var parentId = this.dataElements.getParentId(dataElementId);
        if(parentId !== undefined && pathNode.nodes.has(parentId))
            pathNode.operandCount--;
        var operandNum;
        // decrease the operand count for those operands still remaining
        pathNode.operandCount -=
            this.numOperandDataElements(dataElementId, pathNode.pathId);
    }
    
    // queue the node for the completion of its removal in the epilogue
    this.queueRemovedNode(dataElementId, pathNode, entry);
    pathNode.nodes.delete(dataElementId);

    // while the entry is destroyed immediately, the keys are only queued
    // here for update (and will be updated with all other key updates
    // in the path node epilogue).
    this.removeKeysOfRemovedNodes(pathNode, dataElementId, entry);
}

// Same as 'removeNode()' except that here a set of element IDs is given
// (in teh array 'elementIds'). The nodes for all these element IDs are
// removed from the given path. By calling this for a set of elements
// (instead of calling removeNode() repeatedly) certain optimizations
// can take place.

InternalQCMIndexer.prototype.removeNodes = internalQCMIndexerRemoveNodes;

function internalQCMIndexerRemoveNodes(pathNode, elementIds)
{
    var hasSubTrees = !!pathNode.subTree;

    // avoid resizing the node table prematurely
    pathNode.nodes.suspendMinFill();
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        if(elementId === undefined)
            continue;
        
        var entry = pathNode.nodes.get(elementId);
    
	    if(entry === undefined)
            continue;

        // cleanup in case of sub-tree retrieval
        if(hasSubTrees && this.inSubTree(entry)) {
            this.removeSubTreeNode(entry, pathNode, elementId);
            if (pathNode.numSubTreeMonitors > 0 &&
                (elementId in pathNode.subTreeRootUpdateIds)) {
                delete pathNode.subTreeRootUpdateIds[elementId];
            }
        }

        // check whether this is an operator or operand node
        if(pathNode.operandCount) {
            var parentId = this.dataElements.getParentId(dataElementId);
            if(parentId !== undefined && pathNode.nodes.has(parentId))
                pathNode.operandCount--;
            var operandNum;
            // decrease the operand count for those operands still remaining
            pathNode.operandCount -=
                this.numOperandDataElements(dataElementId, pathNode.pathId);
        }
    
        // queue the node for the completion of its removal in the epilogue
        this.queueRemovedNode(elementId, pathNode, entry);
        pathNode.nodes.delete(elementId);

        // while the entry is destroyed immediately, the keys are only queued
        // here for update (and will be updated with all other key updates
        // in the path node epilogue).
        this.removeKeysOfRemovedNodes(pathNode, elementId, entry);
    }

    // resize the table if needed
    pathNode.nodes.resetMinFill();
}

// This function adds the given data element ID to the list of (lowest
// data element ID above) nodes which were added at the path given
// by pathNode. This list will be processed by the update 
// epilogue. If this same data element is registered as queued for
// removal, it is removed from the 'removed' list, and its properties
// are reinstated.
// It is the responsibility of the queueRemovedDataElement function
// (which maintiains a corresponding list of nodes removed) to remove 
// a node from the added node list when it is removed.

InternalQCMIndexer.prototype.queueAddedNode =
	internalQCMIndexerQueueAddedNode;

function internalQCMIndexerQueueAddedNode(elementId, pathNode)
{
    if(pathNode.removedSubTrees !== undefined &&
       pathNode.removedSubTrees.size &&
       pathNode.removedSubTrees.has(elementId)) {
        var subTree = pathNode.removedSubTrees.get(elementId);
        // restore sub-tree retrieval registrations
        this.registerSubTreeRetrievalOnNode(pathNode, elementId, undefined,
                                            undefined, subTree);
        pathNode.removedSubTrees.delete(elementId);
    }
    
    if(pathNode.removedNodes !== undefined &&
       pathNode.removedNodes.has(elementId)) {
        pathNode.removedNodes.delete(elementId);
        return;
    }

    if(pathNode.nonIndexedQueryCalcs === undefined ||
       pathNode.nonIndexedQueryCalcs.size === 0)
        return;
    
    if(pathNode.addedNodes === undefined)
        pathNode.addedNodes = new Map();
    pathNode.addedNodes.set(elementId, true);

    if(!pathNode.scheduled)
        this.qcm.schedulePathNode(pathNode);
}

// This function is the same as queueAddedNode() except that it performs the
// operation in one batch for a set of element IDs. 

InternalQCMIndexer.prototype.queueAddedNodes =
	internalQCMIndexerQueueAddedNodes;

function internalQCMIndexerQueueAddedNodes(elementIds, pathNode)
{
    var addedElementIds;

    if(pathNode.removedSubTrees !== undefined &&
       pathNode.removedSubTrees.size !== 0) {

        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            
            var elementId = elementIds[i];
            if(elementId === undefined ||
               !pathNode.removedSubTrees.has(elementId))
                continue;

            var subTree = pathNode.removedSubTrees.get(elementId);
            // restore sub-tree retrieval registrations
            this.registerSubTreeRetrievalOnNode(pathNode, elementId,
                                                undefined, undefined,
                                                subTree);
            delete pathNode.removedSubTrees.delete(elementId);
        }
    }
    
    if(pathNode.removedNodes !== undefined) {

        addedElementIds = [];
        
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {

            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;

            if(!pathNode.removedNodes.has(elementId))
                addedElementIds.push(elementId);

            pathNode.removedNodes.delete(elementId);
            continue;
        }
    } else
        addedElementIds = elementIds;

    if(pathNode.nonIndexedQueryCalcs === undefined ||
       pathNode.nonIndexedQueryCalcs.size === 0)
        return;

    if(addedElementIds.length === 0)
        return;

    if(pathNode.addedNodes === undefined)
        pathNode.addedNodes = new Map();
    
    for(var i = 0, l = addedElementIds.length ; i < l ; ++i) {
        var elementId = addedElementIds[i];
        if(elementId !== undefined)
            pathNode.addedNodes.set(elementId, true);
    }

    if(!pathNode.scheduled)
        this.qcm.schedulePathNode(pathNode);
}

// This function adds the given data element ID to the list of (lowest
// data element ID above) nodes which were removed at the path given
// by pathNode. This list will be processed by the content module 
// epilogue. If this same data element is registered as queued for
// addition, it is removed from the 'added' list.
// It is the responsibility of the queueAddedDataElement function
// (which maintiains a corresponding list of nodes added) to remove 
// a node from the removed node list when it is added. 

InternalQCMIndexer.prototype.queueRemovedNode =
	internalQCMIndexerQueueRemovedNode;

function internalQCMIndexerQueueRemovedNode(elementId, pathNode, entry)
{
    // decrease the count of the data element. This does not,
    // however, remove the data element entry or decrease the data element
    // count on the path node (this happens at the end of the update cycle).
    this.dataElements.releaseDataElement(elementId);

    if(pathNode.addedNodes !== undefined &&
       pathNode.addedNodes.has(elementId)) {
        pathNode.addedNodes.delete(elementId);
        return;
    }

    // if the node entry had an InternalSubTree object stored under its
    // 'subTree' field, this object is stored until the final removal of
    // this node, so as to maintain the registration stored in it in case
    // the node is added back before the update epilogue.
    if(entry.subTree) {
        if(!pathNode.removedSubTrees)
            pathNode.removedSubTrees = {};
        pathNode.removedSubTrees[elementId] = entry.subTree;
    }

    if(pathNode.nonIndexedQueryCalcs === undefined ||
       pathNode.nonIndexedQueryCalcs.size === 0)
        return;

    if(pathNode.removedNodes === undefined)
        pathNode.removedNodes = new Map();
    
    pathNode.removedNodes.set(elementId, true);

    if(!pathNode.scheduled)
        this.qcm.schedulePathNode(pathNode);
}

// This function should be called when the given path node is cleared
// or destroyed. It is assumed that this happens only if:
// 1. there are no more queries and sub-tree monitoring registered to 
//    this path node.
// 2. the child path nodes were already cleared or destroyed.
// This function empties the 'nodes' table.
// Its most important task, however, is to remove data elements
// defined at this node from the indexer's 'dataElements' table.
// This is required because this table is not part of the path node
// and is not destroyed when the path node is destroyed. 

InternalQCMIndexer.prototype.removeAllNodesOnPathNode = 
	internalQCMIndexerRemoveAllNodesOnPathNode;

function internalQCMIndexerRemoveAllNodesOnPathNode(pathNode)
{
    // release the data element for each of the nodes still stored in
    // this entry. 

    var dataElements = this.dataElements;
    
    pathNode.nodes.forEach(function(entry, elementId) {
        dataElements.releaseDataElement(elementId);
	});

    pathNode.nodes = new IntHashMap();
}

// Given the ID of a path, this returns the 'nodes' table on the path node
// for the given path ID. If no such path node exists, an empty object is 
// returned. The calling function is not allowed to modify the return value
// of this function.

InternalQCMIndexer.prototype.getDataNodesAtPath = 
	internalQCMIndexerGetDataNodesAtPath;

function internalQCMIndexerGetDataNodesAtPath(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(!pathNode)
        return new IntHashMap();

    return pathNode.nodes;
}

// Given the ID of a path, this returns the 'prevKeys' table on the path node
// for the given path ID. If no such path node exists or no 'prevKeys' table
// exists, undefined is returned. The calling function is not allowed to
// modify the return value of this function.

InternalQCMIndexer.prototype.getPrevKeysAtPath = 
	internalQCMIndexerGetPrevKeysAtPath;

function internalQCMIndexerGetPrevKeysAtPath(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(!pathNode)
        return undefined;

    return pathNode.prevKeys;
}

// Given the ID of a path and an array of element IDs 'elementIds', this
// function returns the subset of the element IDs in 'elementIds' which
// are currently in the 'nodes' list of the path node and are not pending
// for addition (unless ignorePendingAdded is set) or are in the list
// of nodes pending for removal (unless ignorePendingRemoved is set)

InternalQCMIndexer.prototype.filterDataNodesAtPath = 
	internalQCMIndexerFilterDataNodesAtPath;

function internalQCMIndexerFilterDataNodesAtPath(pathId, elementIds,
                                                 ignorePendingAdded,
                                                 ignorePendingRemoved)
{
    var pathNode = this.pathNodesById[pathId];

    if(!pathNode)
        return [];

    var filtered = [];
    var nodes = pathNode.nodes;
    var addedNodes = ignorePendingAdded ? undefined : pathNode.addedNodes;
    var removedNodes = ignorePendingRemoved ? undefined : pathNode.removedNodes;

    if(removedNodes === undefined && addedNodes === undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId !== undefined && nodes.has(elementId))
                filtered.push(elementId);
        }
    } else if(removedNodes !== undefined && addedNodes === undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId !== undefined &&
               (nodes.has(elementId) || removedNodes.has(elementId)))
                filtered.push(elementId);
        }
    } else if(removedNodes === undefined && addedNodes !== undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId !== undefined && nodes.has(elementId) &&
               !addedNodes.has(elementId))
                filtered.push(elementId);
        }
    } else
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;
            if((nodes.has(elementId) && !addedNodes.has(elementId)) ||
               removedNodes.has(elementId))
                filtered.push(elementId);
        }
    
    return filtered;
}

// This function is identical to filterDataNodesAtPath() except that
// in addition to creating the list of filtered matches, it also creates
// a list of those input data element IDs which were filtered out
// (not matched). The function returns an object of the form:
// {
//     matches: <array of matches (same as returned by filterDataNodesAtPath())>
//     removed: <array of matches in input 'elementIds' not matched> 
// }
// The two vectors returned by this function are disjoint and their union is
// the input set of elements.

InternalQCMIndexer.prototype.filterDataNodesAtPathWithDiff = 
	internalQCMIndexerFilterDataNodesAtPathWithDiff;

function internalQCMIndexerFilterDataNodesAtPathWithDiff(pathId, elementIds,
                                                         ignorePendingAdded,
                                                         ignorePendingRemoved)
{
    var pathNode = this.pathNodesById[pathId];

    if(!pathNode)
        return [];

    var filtered = [];
    var removed = [];
    var nodes = pathNode.nodes;
    var addedNodes = ignorePendingAdded ? undefined : pathNode.addedNodes;
    var removedNodes = ignorePendingRemoved ? undefined : pathNode.removedNodes;
    
    
    if(removedNodes === undefined && addedNodes === undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;
            if(nodes.has(elementId))
                filtered.push(elementId);
            else
                removed.push(elementId);
        }
    } else if(removedNodes !== undefined && addedNodes === undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;
            if(nodes.has(elementId) || removedNodes.has(elementId))
                filtered.push(elementId);
            else
                removed.push(elementId);
        }
    } else if(removedNodes === undefined && addedNodes !== undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;
            if(nodes.has(elementId) && !addedNodes.has(elementId))
                filtered.push(elementId);
            else
                removed.push(elementId);
        }
    } else
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;
            if((nodes.has(elementId) && !addedNodes.has(elementId)) ||
               removedNodes.has(elementId))
                filtered.push(elementId);
            else
                removed.push(elementId);
        }
    
    return { matches: filtered, removed: removed };
}

// Given the ID of a path and an array of element IDs 'elementIds',
// this function returns an array with the positions in the input
// array of the subset of the element IDs in 'elementIds' which are
// currently in the 'nodes' list of the path node and are not pending
// for addition or are in the list of nodes pending for removal.

InternalQCMIndexer.prototype.filterDataNodesAtPathPositions = 
	internalQCMIndexerFilterDataNodesAtPathPositions;

function internalQCMIndexerFilterDataNodesAtPathPositions(pathId, elementIds)
{
    var pathNode = this.pathNodesById[pathId];

    if(!pathNode)
        return [];

    var positions = [];
    var nodes = pathNode.nodes;

    if(pathNode.removedNodes === undefined &&
       pathNode.addedNodes === undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];            
            if(elementId !== undefined && nodes.has(elementId))
                positions.push(i);
        }
    } else if(pathNode.removedNodes !== undefined &&
              pathNode.addedNodes === undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId !== undefined &&
               (nodes.has(elementId) || pathNode.removedNodes.has(elementId)))
                positions.push(i);
        }
    } else if(pathNode.removedNodes === undefined &&
              pathNode.addedNodes !== undefined) {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId !== undefined &&
               nodes.has(elementId) && !pathNode.addedNodes.has(elementId))
                positions.push(i);
        }
    } else
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;
            if((nodes.has(elementId) && !pathNode.addedNodes.has(elementId)) ||
               pathNode.removedNodes.has(elementId))
                positions.push(i);
        }
    
    return positions;
}

// This function returns the dataElements object of the indexer (which holds
// all data elements encountered by the indexer).

InternalQCMIndexer.prototype.getDataElements = 
	internalQCMIndexerGetDataElements;

function internalQCMIndexerGetDataElements()
{
	return this.dataElements;
}

// This function returns an array with all the direct child data elements
// at path 'pathId' of data element 'elementId'. This means that the
// returned element IDs are all of data elements defined at 'pathId'
// and that they are direct children of 'elementId' (no intermediate data
// elements).
// This function returns undefined if no such children exist.

InternalQCMIndexer.prototype.getDirectChildDataElements =
    internalQCMIndexerGetDirectChildDataElements;

function internalQCMIndexerGetDirectChildDataElements(elementId, pathId)
{
    return this.dataElements.getDirectChildDataElements(elementId, pathId);
}

// This is identical to 'getDirectChildDataElements()' except that
// 'getDirectChildDataElements()' returns an array of data element IDs
// while this function returns the set of child element IDs as
// a Map object (whose keys are the child element IDs). The calling
// function is not allowed to modify the returned Map object.

InternalQCMIndexer.prototype.getDirectChildDataElementsAsObj = 
	internalQCMIndexerGetDirectChildDataElementsAsObj;

function internalQCMIndexerGetDirectChildDataElementsAsObj(elementId, pathId)
{
    return this.dataElements.getDirectChildDataElementsAsObj(elementId, pathId);
}

// Given a path ID and a data element ID, this function checks whether
// this data element has direct data element children at this path
// and returns true if it does and false if it doesn't. 
// These must be direct children of this node, so if there are any 
// intermediate children at higher paths this function will return nothing.
// Specifically, even if 'elementId' defined a node at the immeidate
// prefix path of 'childPathId' but is an operator, this function will 
// return false.

InternalQCMIndexer.prototype.hasDirectChildDataElements = 
	internalQCMIndexerHasDirectChildDataElements;

function internalQCMIndexerHasDirectChildDataElements(elementId, childPathId)
{
    return this.dataElements.hasDirectChildDataElements(elementId, childPathId);
}

// Given a data element ID, this function returns all data elements dominated 
// by it, in a depth-first ordering. The result is returned in an array.
// 'elementId' is not included in the returned array.
// If a 'result' array is provided as argument, the function appends 
// the dominated data elements to the 'result' array and returns that array.
// Otherwise,the function creates a new array and returns it (the array
// may be empty).

InternalQCMIndexer.prototype.getAllDominatedDataElements = 
	internalQCMIndexerGetAllDominatedDataElements;

function internalQCMIndexerGetAllDominatedDataElements(elementId, result)
{
    return this.dataElements.getAllDominatedDataElements(elementId, result);
}

// This function returns the data element IDs of all nodes which are
// operands of the node at 'pathId' and 'elementId'. This function
// operates under the assumption that it is called only if the data
// node given by 'pathId' and 'elementId' is indeed an operator.
// The operand data elements are then (by definition) all data
// elements which are direct children of 'elementId' at path
// 'pathId'.  The list of these data elements is returned (a Map
// object whose keys are the data element IDs). The
// original entry from the DataElements table is returned, so it
// should not be modified. If this object cannot be found, 'undefined'
// is returned (the children may not have been created yet or the
// operation may indeed be empty).

InternalQCMIndexer.prototype.getOperandDataElements = 
	internalQCMIndexerGetOperandDataElements;

function internalQCMIndexerGetOperandDataElements(elementId, pathId)
{
    return this.dataElements.getDirectChildDataElementsAsObj(elementId, pathId);
}

// Given a set (array) of element IDs 'elementIds' at path with ID
// 'pathId', this function returns the operands which are direct
// operands of the operators in the list 'elementIds'. Not all elements
// in 'elementIds' must be operators. The function returns an array
// where each position in the array holds an array with the set of operands
// which are directly dominated by the element ID at the corresponding
// position in the input array. Where there are no such node, an undefined
// appears in the array. The returned array may be shorter than the input
// array if it has a suffix of undefined entries.
// If none of the input elements has operands, undefined is returned by
// this function.

InternalQCMIndexer.prototype.getAllDirectOperands = 
	internalQCMIndexerGetAllDirectOperands;

function internalQCMIndexerGetAllDirectOperands(elementIds, pathId)
{
    if(!this.pathHasOperands(pathId))
        return undefined;
    
    var allOperandIds = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        var entry;

        var operandIds =
            this.dataElements.getDirectChildDataElements(elementId, pathId);
        if(operandIds === undefined)
            continue;

        allOperandIds[i] = operandIds;
    }

    if(allOperandIds.length == 0)
        return undefined;

    return allOperandIds;
}

// Given a set (array) of element IDs 'elementIds' at path with ID
// 'pathId', this function returns the operands which are direct
// operands of the operators in the list 'elementIds'. Not all elements
// in 'elementIds' must be operators.
// This function is similar to getAllDirectOperands() except that the output
// array is not aligned with the input array and therefore there is also
// no need to have array entries inside the array. Instead, the returned
// array is simply an array of data element IDs of all operands directly
// dominated by one of he input data element IDs.
// undefined is returned if there are no such operands.

InternalQCMIndexer.prototype.getAllDirectOperandsFlat = 
	internalQCMIndexerGetAllDirectOperandsFlat;

function internalQCMIndexerGetAllDirectOperandsFlat(elementIds, pathId)
{
    if(!this.pathHasOperands(pathId))
        return undefined;
    
    var operandIds = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];

        if(elementId === undefined)
            continue;
        
        var operandsAsObj = this.dataElements.
            getDirectChildDataElementsAsObj(elementId, pathId);

        if(operandsAsObj === undefined)
            continue;

        operandsAsObj.forEach(function(t, operandId) {
            operandIds.push(operandId);
        });
    }

    if(operandIds.length == 0)
        return undefined;

    return operandIds;
}

// This function returns the number of nodes which are
// operands of the node at 'pathId' and 'elementId'. This function
// operates under the assumption that it is called only if the data
// node given by 'pathId' and 'elementId' is indeed defined at this
// path node (or was just now removed).
// The operand data elements are then (by definition) all data
// elements which are direct children of 'elementId' at path
// 'pathId'. The number of these nodes is returned.

InternalQCMIndexer.prototype.numOperandDataElements = 
	internalQCMIndexerNumOperandDataElements;

function internalQCMIndexerNumOperandDataElements(elementId, pathId)
{
    return this.dataElements.getNumDirectChildDataElements(elementId, pathId);
}

// This function returns true if the given node is an operator with 
// operands in this indexer (that is, it is not an empty operator).
// This is done by checking that the given node has child data elements
// at the same path.

InternalQCMIndexer.prototype.isNonEmptyOperator = 
	internalQCMIndexerIsNonEmptyOperator;

function internalQCMIndexerIsNonEmptyOperator(elementId, pathId)
{
    return this.dataElements.hasDirectChildDataElements(elementId, pathId);
}

// Returns true if the given data element is an operand at the given path.

InternalQCMIndexer.prototype.isOperand = 
	internalQCMIndexerIsOperand;

function internalQCMIndexerIsOperand(dataElementId, pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(!pathNode.operandCount)
        return false;

    var elementEntry = this.dataElements.getEntry(dataElementId);
    return (elementEntry.pathId == pathId &&
            elementEntry.parent !== undefined &&
            pathNode.nodes.has(elementEntry.parent));
}

/////////////////
// Range Nodes //
/////////////////

// A node is inactive if one of three things hold:
// 1. It is (directly) dominated by an active range node which is 
//    not empty.
// 2. It is a range node with an inactive RangeKey (meaning that types
//    are conflicting or cannot be ordered).
// 3. It is an empty range node dominating operands (which must, therfore,
//    be empty range nodes).
// This function returns true if neither of these three situations holds.

InternalQCMIndexer.prototype.isActive = 
	internalQCMIndexerIsActive;

function internalQCMIndexerIsActive(pathNode, elementId, nodeEntry)
{
    if(this.isRangeKey(nodeEntry.key)) {
        if(!nodeEntry.key.isActive())
            return false;
        if(nodeEntry.key.isEmpty() && 
           this.numOperandDataElements(elementId, pathNode.pathId) > 0)
            return false;
    }


    if(!nodeEntry.rangeNodeId)
        return true;

    // get the range key of the dominating range node.
    var rangeKey = pathNode.nodes.get(nodeEntry.rangeNodeId).key;
    return rangeKey.isEmpty() || !rangeKey.isActive();
}

// This function is used to deactivate a range node or a node under an
// active range node which was active until now.  This is called
// during the key update step. An inactive node is one which is invisible
// to queries registered to the path node and to sub-tree monitoring.
// To make sure this node is not added to any query, the node is set on
// the 'removedNodes' list (or removed from the 'addedNodes' list if it
// is stilled queued for addition) and removed from the indexes.
// 'type', 'key' and 'hasAttrs' are the type, key and 'hasAttrs'
// properties of the deactivated node.
// Since a deactivated node looks like a removed node to queries and
// monitors, we store this value (temporarily) so that queries and
// monitors can access this value in the process of receiving the update. 

InternalQCMIndexer.prototype.deactivateNode = 
	internalQCMIndexerDeactivateNode;

function internalQCMIndexerDeactivateNode(pathNode, elementId, type, key,
                                          hasAttrs)
{
    if(!pathNode.nodes.has(elementId))
        return;

    var nodeEntry = pathNode.nodes.get(elementId);
    
    if(this.isRangeKey(nodeEntry.key) && nodeEntry.key.isEmpty() &&
       pathNode.operandCount) {
        var operandIds;
        if(operandIds = 
           this.getOperandDataElements(elementId, pathNode.pathId)){
            // this is an empty range embedding inside it empty ranges.
            // It is the lower nodes, rather than this node, which need
            // to be deactivated
            var _self = this;
            operandIds.forEach(function(t,operandId){

                var operandEntry = pathNode.nodes.get(operandId);
                if(operandEntry === undefined)
                    return;
                
                _self.deactivateNode(pathNode, operandId, operandEntry.type,
                                     operandEntry.key, operandEntry.hasAttrs);
            });
            return;
        }
    }

    // update the addedNodes/removedNodes lists. This removes this
    // node from non-indexed queries.
    if(pathNode.addedNodes !== undefined && pathNode.addedNodes.has(elementId))
        // still queued to be added, remove from the queue
        pathNode.addedNodes.delete(elementId);
    else if(pathNode.nonIndexedQueryCalcs !== undefined &&
       pathNode.nonIndexedQueryCalcs.size > 0) {
        if(pathNode.removedNodes === undefined)
            pathNode.removedNodes = new Map();
        pathNode.removedNodes.set(elementId, true);
    }

    // if some queries requested key updates, store this as the previous
    // key value
    if(pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0)
        this.preservePreviousKey(pathNode, elementId, type, key, hasAttrs);
    
    // if this node was already indexed, remove it from the indexer 
    if(pathNode.subIndexes !== undefined && type !== undefined)
        this.removeFromSubIndex(pathNode, elementId, type, key);
    // update retrieved sub-trees, as needed
    if(this.inSubTree(nodeEntry))
		this.removeSubTreeNode(nodeEntry, pathNode, elementId);
}

// This function is used to activate a range or a node under a range
// node which was inactive until now. This function only takes care of
// the activation of this node and not of that of sub-nodes (this is
// taken care of by the function activateRangeNode() which may have
// called this function). This is called during the key update step of
// the update epilogue of 'pathNode'.  An inactive node is one which
// is invisible to queries registered to the path node and to sub-tree
// monitoring. To make this node visible for queries registered to
// this path node, the node is put on the 'addedNodes' queue (or
// removed from the 'removedNode' queue in case it is queued for
// removal) and added to the index for the relevant type.

InternalQCMIndexer.prototype.activateNode = 
	internalQCMIndexerActivateNode;

function internalQCMIndexerActivateNode(pathNode, elementId, nodeEntry)
{
    if(this.isRangeKey(nodeEntry.key) && nodeEntry.key.isEmpty() &&
       pathNode.operandCount) {
        var operandIds;
        if(operandIds = 
           this.getOperandDataElements(elementId, pathNode.pathId)) {
            // this is an empty range embedding inside it empty ranges.
            // It is the lower nodes, rather than this node, which need
            // to be activated
            var _self = this;
            operandIds.forEach(function(t,operandId){

                var operandEntry = pathNode.nodes.get(operandId);
                if(operandEntry === undefined)
                    return;
                
                _self.activateNode(pathNode, operandId, operandEntry);
            });
            return;
        }
    }

    // update the addedNodes/removedNodes lists. This adds this
    // node to non-indexed queries.
    if(pathNode.removedNodes !== undefined &&
       pathNode.removedNodes.has(elementId))
        // still queued to be removed, remove from the queue
        pathNode.removedNodes.delete(elementId);
    else if(pathNode.nonIndexedQueryCalcs !== undefined &&
            pathNode.nonIndexedQueryCalcs.size > 0) {
        if(pathNode.addedNodes === undefined)
            pathNode.addedNodes = new Map();
        pathNode.addedNodes.set(elementId, true);
    }

    // index this node
    if(pathNode.subIndexes !== undefined && nodeEntry.type !== undefined)
        this.addToSubIndex(pathNode, elementId, nodeEntry.type, 
                           nodeEntry.type, undefined);
    // set dominating sub-tree roots, if any
    if(pathNode.subTree ||
       (pathNode.parent !== undefined && pathNode.parent.subTree)) {
        // this node may have to be monitored. First determine the
        // immediate parent
        var elementEntry = this.dataElements.getEntry(elementId);
        var parentId = (elementEntry.pathId === pathNode.pathId) ?
            elementEntry.parent : elementId;
            
	    this.setNewNodeSubTreeRoots(pathNode, nodeEntry, elementId, 
                                    parentId);
        // update retrieved sub-trees, as needed
        if(this.inSubTree(nodeEntry))
		    this.updateSubTrees(pathNode.pathId, elementId, nodeEntry);
    }
}

// This function is called when a range node which previously was active
// has become inactive as a result of adding keys to the range 
// (a range node cannot become inactive as a result of removing keys 
// from it). It is assumed that this is called after any dominating
// range node has been updated. Therefore, since this node was active 
// until now, it is not dominated by an active range node. This means
// that the operands of this range node need to be activated.
// 'prevKey' is a constant copy of the range key of this node as it was
// before this update.

InternalQCMIndexer.prototype.deactivateRangeNode = 
	internalQCMIndexerDeactivateRangeNode;

function internalQCMIndexerDeactivateRangeNode(pathNode, elementId, nodeEntry,
                                               prevType, prevKey, prevHasAttrs)
{
    nodeEntry.type = nodeEntry.key.getType();
    // deactivate this node
    this.deactivateNode(pathNode, elementId, prevType, prevKey, prevHasAttrs);
    
    var operandIds;
    if(pathNode.operandCount && 
       (operandIds = this.getOperandDataElements(elementId, pathNode.pathId))){
        
        // activate the sub-nodes

        var _self = this;
        operandIds.forEach(function(t,operandId){

            var operandEntry = pathNode.nodes.get(operandId);
            if(operandEntry === undefined)
                return;

            _self.activateNode(pathNode, operandId, operandEntry);
        });

        if(pathNode.subTree && this.inSubTree(nodeEntry))
            this.extendSubTreesToOperandChildren(pathNode, nodeEntry, 
                                                 elementId);
    }
}

// This function is called when a range node which previously was inactive
// has become active as a result of changes to the keys stored in it.
// It is assumed that this update took place after any dominating
// range node has been updated. Therefore, since this node is now active
// but was not before the key update (but after the update of the 
// dominating node) the operand nodes of this node must have been 
// active and need to be deactivated. 

InternalQCMIndexer.prototype.activateRangeNode = 
	internalQCMIndexerActivateRangeNode;

function internalQCMIndexerActivateRangeNode(pathNode, elementId, nodeEntry)
{
    
    nodeEntry.type = nodeEntry.key.getType();
    // activate this node
    this.activateNode(pathNode, elementId, nodeEntry);
    
    var operandIds;
    if(pathNode.operandCount && 
       (operandIds = this.getOperandDataElements(elementId, pathNode.pathId))){
        
        // deactivate the sub-nodes

        var _self = this;
        operandIds.forEach(function(t,operandId){
            
            var operandEntry = pathNode.nodes.get(operandId);
            if(operandEntry === undefined)
                return;

            if(pathNode.subTree) // if needed, clear sub-trees from the operand
                _self.clearSubTrees(pathNode, operandId, operandEntry);

            _self.deactivateNode(pathNode, operandId, operandEntry.type,
                                 operandEntry.key, operandEntry.hasAttrs);
        });
    }
}

//////////////////////////////////////////
// Access to Dominating/Dominated Nodes //
//////////////////////////////////////////

// Given a path ID, this function returns the path Ids of all direct children
// of this path which are defined in the indexer. If there is no path node
// with the ID 'pathId', undefined is returned. Otherwise, an array is
// returned, containing the following objects:
// {
//    childPathId: <path ID>,
//    attr: <string>
// }
// where each object describes one child path of 'pathId'. The field
// 'childPathId' in each entry is the path ID of the child path and
// 'attr' is the attribute of the child path under 'pathId'.
// The array returned may be empty (if 'pathId' exists but there are not
// child paths ).

InternalQCMIndexer.prototype.getChildPaths = 
	internalQCMIndexerGetChildPaths;

function internalQCMIndexerGetChildPaths(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return undefined;

    var childPaths = {};
    
    for(var attr in pathNode.children) {
        childPaths.push({ childPathId: pathNode.children[attr].pathId,
                          attr: attr });
    }

    return childPaths;
}

// This function returns true if the path with the given ID has any operand
// nodes (nodes direclt dominated by an operator).

InternalQCMIndexer.prototype.pathHasOperands = 
	internalQCMIndexerPathHasOperands;

function internalQCMIndexerPathHasOperands(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    return (pathNode !== undefined && pathNode.operandCount > 0);
}

// This function returns true if the path with the given ID has any operand
// nodes (nodes direclt dominated by an operator).

InternalQCMIndexer.prototype.pathHasDataElements = 
	internalQCMIndexerPathHasDataElements;

function internalQCMIndexerPathHasDataElements(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    return (pathNode !== undefined && pathNode.hasDataElements);
}

// Given an element ID which is a node at the given path ID, 
// this function checks whether this node is directly dominated by operators
// at the same path. If it is, this function returns the highest dominating
// operator at this path (and, otherwise, the original node ID is returned).

InternalQCMIndexer.prototype.raiseToOperator =
    internalQCMIndexerRaiseToOperator;

function internalQCMIndexerRaiseToOperator(elementId, pathId)
{
    var pathNode = this.pathNodesById[pathId];
    if(pathNode === undefined || !pathNode.operandCount)
        return elementId;

    var operatorId = this.dataElements.getParentId(elementId);
    
    while(operatorId !== undefined && pathNode.nodes.has(operatorId)) {
        elementId = operatorId;
        operatorId = this.dataElements.getParentId(elementId);
    }

    return elementId;
}

// This function takes the element IDs in the array 'elementIds' and checks
// whether they can be raised to a directly dominating operator.
// The function returns an object with two arrays:
// {
//     pos: [<positions in the original array where raising took place>],
//     operators: [<operators at corresponding positions>]
// }
// returns undefined if no raising took place.

InternalQCMIndexer.prototype.raiseElementsToDirectOperators =
    internalQCMIndexerRaiseElementsToDirectOperators;

function internalQCMIndexerRaiseElementsToDirectOperators(elementIds, pathId)
{
    var pathNode = this.pathNodesById[pathId];
    if(pathNode === undefined || !pathNode.operandCount)
        return undefined;

    var pos = [];
    var operators = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var operatorId = this.dataElements.getParentId(elementId[i]);

        if(operatorId !== undefined && pathNode.nodes.has(operatorId)) {
            pos.push(i);
            operators.push(operatorid);
        }
    }

    return pos.length == 0 ? undefined : { pos: pos, operators: operators };
}

// This function is simialr to raiseToOperator(), except that it performs the
// operation on an array of input element IDs. If multiple element IDs
// are raised to the same operator, the operator only appears in the returned
// array once.

InternalQCMIndexer.prototype.raiseElementsToOperators =
    internalQCMIndexerRaiseElementsToOperators;

function internalQCMIndexerRaiseElementsToOperators(elementIds, pathId)
{
    var pathNode = this.pathNodesById[pathId];
    if(pathNode === undefined || !pathNode.operandCount)
        return elementIds;

    var raised = [];
    var operators = new Map(); // to avoid raising multiple  

    for(var i = 0, l = elementIds.length ; i < l ; ++i) { 

        var elementId = elementIds[i];
        var operatorId = elementId; 
        var parentId = this.dataElements.getParentId(operatorId);
    
        while(parentId !== undefined && pathNode.nodes.has(parentId)) {
            operatorId = parentId;
            parentId = this.dataElements.getParentId(operatorId);
        }

        if(operatorId !== elementId) {
            if(operators.has(operatorId))
                continue; // already added
            operators.set(operatorId, true);
        }
        
        raised.push(operatorId);

    }

    return raised;
}


// Given is element ID which is a node at the given path ID, 
// this function checks whether this node is directly dominated by operators
// at the same path. If it is, this function returns an array with all
// operators at this path which dominate the given node. The operators
// are returned bottom up (from dominated to dominating). If the given node
// is not an operand, undefined is returned.

InternalQCMIndexer.prototype.raiseToAllOperators =
    internalQCMIndexerRaiseToAllOperators;

function internalQCMIndexerRaiseToAllOperators(elementId, pathId)
{
    var pathNode = this.pathNodesById[pathId];
    if(pathNode === undefined || !pathNode.operandCount)
        return undefined;

    var operatorIds = [];
    var operatorId = this.dataElements.getParentId(elementId);
    
    while(operatorId !== undefined && pathNode.nodes.has(operatorId)) {
        operatorIds.push(operatorId);
        operatorId = this.dataElements.getParentId(operatorId);
    }

    return operatorIds.length === 0 ? undefined : operatorIds;
}

// This function takes an element ID which is defined at a path which extends
// the path 'pathId'.
// This function then raises this element ID to its lowest parent
// data element ID which is at 'pathId' (this means that if there are
// operators at path 'pathId', element ID will be raised to the operand,
// but will not continue to be raised to the operator, which is defined at
// the same path).

InternalQCMIndexer.prototype.raiseToPath = internalQCMIndexerRaiseToPath;

function internalQCMIndexerRaiseToPath(elementId, pathId)
{
    return this.dataElements.raiseToPath(elementId, pathId);
}

// This function takes an array of element ID which are defined at 'fromPathId'
// and a path ID 'toPathId' which is a prefix of this path and raises each
// of them to its lowest parent data element ID which is at 'toPathId'
// (this means that if there are operators at path 'pathId', element ID
// will be raised to the operand, but will not continue to be raised to
// the operator, which is defined at the same path).
// The raised element IDs are returned in an array


InternalQCMIndexer.prototype.raiseAllToPath = internalQCMIndexerRaiseAllToPath;

function internalQCMIndexerRaiseAllToPath(elementIds, toPathId, fromPathId)
{
    if(!this.hasLowerDataElements(fromPathId, toPathId))
        return elementIds; // no raising can take place

    return this.dataElements.raiseAllToPath(elementIds, toPathId);
}

// Given a child path ID 'childPathId' and one or more data element
// IDs 'elementIds' (an array of data element IDs) this function returns
// an array of the data element IDs
// of all data elements which are lowest data elements on the given
// child path and are dominated by the given data element(s).
// One must provide a path 'minPathId' at which all the data element IDs
// in 'elementIds' are lowest data elements (that is, there is no data
// element dominated by these data elements whose path is a prefix of
// 'minPathId'). This allows the search to begin at this path.
// If any of the given data element is lower than the given child path, 
// it is returned.
// The search is performed by first creating the list of prefix paths
// of 'childPathId' which also extend 'minPathId' (or the path of the single
// data element in 'elementIds').
// We then loop over these prefixes in increasing order (short prefixes
// first) collecting all child nodes of the given data elements at 
// the given prefix. Once such children are found, the original 
// data elements are removed from the search and the search continue on
// the children. When no more new children can be found, the remaining 
// search list is the result of the function.
// If 'nodeMustExist' is set to true, this function checks that a node
// actually exists at the path 'childPathId' for each data element ID which
// is returned. Otherwise, a data element ID is returned if it is lowest 
// at the child path node even if no node under that data element ID 
// actually exists at the child path (but such a node could be added).
// Note: the fact that a data element ID is returned in this list does not 
// indicate that there actually is a node at the given child path node
// under this data element ID. It only indicates that if there is a
// node at this path node, dominated by any of the input data elements
// then its data element ID will be in the returned list.

InternalQCMIndexer.prototype.getChildDataElements = 
	internalQCMIndexerGetChildDataElements;

function internalQCMIndexerGetChildDataElements(childPathId, elementIds, 
                                                minPathId, nodeMustExist)
{
    var childNodes;
    
    if(nodeMustExist) {
        var childPathNode = this.pathNodesById[childPathId];
        if(!childPathNode || childPathNode.nodes.size == 0)
            return []; // no nodes
        childNodes = childPathNode.nodes;
    }
    
    var childIds =
        this.dataElements.getChildDataElements(childPathId, elementIds, 
                                               minPathId);

    if(!nodeMustExist)
        return childIds;
    
    // filter out data elements which do not have a node at the required path.

    var existingChildIds = [];
    for(var i = 0, l = childIds.length ; i < l ; ++i) {
        var childId = childIds[i];
        if(childNodes.has(childId))
            existingChildIds.push(childId);
    }
    
    return existingChildIds;
}

// This function receives a list of data element IDs which are lowest at
// a path 'minPathId' and a child path node which extends 'minPathId'.
// The function then returns the nodes at path 'childPathId' which
// are dominated by the data elements in 'elementIds'. In case there are
// operators with operands at the child path node, only the operands
// are returned here.

InternalQCMIndexer.prototype.getDominatedNodes = 
	internalQCMIndexerGetDominatedNodes;

function internalQCMIndexerGetDominatedNodes(childPathId, elementIds, minPathId)
{
    return this.getChildDataElements(childPathId, elementIds, minPathId, true);
}

// 'elementIds' is an array of element IDs at the direct prefix path
// of 'pathId'. The function returns an array with the direct children
// at path 'pathId' of each of the elements in 'elementIds'. Direct children
// means that there may not be an additional data element between
// the element in 'elementIds' and the children returned for it (except
// for the children themselves).
//
// If there are some updates still pending at this path node (added/removed
// nodes still waiting to be pushed to query calculation nodes) and the
// flag 'ignorePending' is not set, the child nodes returned by this
// function are as seen by query calculation nodes registered to this
// path node, that is, including nodes which are no longer in the
// 'nodes' table but whose removal notifications are still pending
// and excluding nodes which were just added and whose notification
// as added is still pending.
//
// The children are returned in an array where the children in each position
// of the returned array are the children of the element ID at the
// corresponding position in 'elementIds'. If the path has no data elements,
// each element in 'elementIds' may have at most one child node at 'pathId'
// (and it must have the same data element ID) so each position in
// the returned array contains either undefined (if not child was found) or
// a single data element ID. If the path does have data elements, there
// may be multiple children for a single element in 'elementIds'. Therefore,
// in this case, each entry in the array returned is either undefined
// (no child found) or an array of element IDs (even if tis array is of
// length 1). To indicate which of the two it is, this function returns
// an object of the form:
// {
//    hasDataElements: true|false,
//    childIds: <array of elements IDs or array of arrays of element IDs>
// }
// If no children are found, this function returns undefined.
// The array under 'childIds' may be shorter than the input 'elementIds'
// (this means that beyond a certain position, no children were found). 

InternalQCMIndexer.prototype.getAllDirectChildren =
    internalQCMIndexerGetAllDirectChildren;

function internalQCMIndexerGetAllDirectChildren(elementIds, pathId,
                                                ignorePending)
{
    var pathNode = this.pathNodesById[pathId];
    if(pathNode === undefined)
        return undefined;

    if(!pathNode.hasDataElements)
        return this.getAllDirectChildrenNoDataElements(elementIds, pathNode,
                                                       ignorePending, false);
    else
        return this.getAllDirectChildrenWithDataElements(elementIds, pathNode,
                                                         ignorePending, false);
}

// This function returns the same element IDs as the function
// getAllDirectChildren(), but in a different format.
// 'elementIds' is an array of element IDs at the direct prefix path of
// 'pathId'. The function returns an array with the direct children
// at path 'pathId' of each of the elements in 'elementIds'. Direct children
// means that there may not be an additional data element between
// the element in 'elementIds' and the children returned for it (except
// for the children themselves). For the use of the 'ignorePending'
// argument, see the documentation of getAllDirectChildren(). The returned
// array is always 'flat', without alignment with the input array of elements
// and with each entry in the output array being a single data element ID
// (no 'undefined' entries).
// The function returns undefined if there are no children found.

InternalQCMIndexer.prototype.getAllDirectChildrenFlat =
    internalQCMIndexerGetAllDirectChildrenFlat;

function internalQCMIndexerGetAllDirectChildrenFlat(elementIds, pathId,
                                                    ignorePending)
{
    var pathNode = this.pathNodesById[pathId];
    if(pathNode === undefined)
        return undefined;

     if(!pathNode.hasDataElements)
        return this.getAllDirectChildrenNoDataElements(elementIds, pathNode,
                                                       ignorePending, true);
    else
        return this.getAllDirectChildrenWithDataElements(elementIds, pathNode,
                                                         ignorePending, true);
}

// This function implements getAllDirectChildren() and
// getAllDirectChildrenFlat() for the case that it has been determined that
// there are no data elements at the path node. The flag 'returnFlat'
// indicates whether the retur format should be that of
// getAllDirectChildren() or of getAllDirectChildrenFlat().
// Because the loop here can be very tight, we also distinguish between
// the case where we need to check for pending updates and the case where
// this is not needed. This results in 4 different loops (flat/not falt
// return value and check pending / don't check pending).

InternalQCMIndexer.prototype.getAllDirectChildrenNoDataElements =
    internalQCMIndexerGetAllDirectChildrenNoDataElements;

function internalQCMIndexerGetAllDirectChildrenNoDataElements(elementIds,
                                                              pathNode,
                                                              ignorePending,
                                                              returnFlat)
{
    var nodes = pathNode.nodes;
    var removedNodes = pathNode.removedNodes;
    var numRemoved = (!ignorePending && removedNodes !== undefined) ?
        removedNodes.size : 0;
    var addedNodes = pathNode.addedNodes;
    var numAdded = (!ignorePending && addedNodes !== undefined) ?
        addedNodes.size : 0;
    
    // are there any nodes at this path?
    if(nodes.size + numRemoved - numAdded === 0)
        return undefined; // no data nodes at this path

    var allChildIds = [];
    
    if(numRemoved === 0 && numAdded === 0) {
        // no pending updates (or can ignore them), just need to check
        // whether the element ID appear in the node table.
        if(!returnFlat) {
            for(var i = 0, l = elementIds.length ; i < l ; ++i) {
                var elementId = elementIds[i];
                if(elementId !== undefined && nodes.has(elementId))
                    allChildIds[i] = elementId;
            }
        } else {
            for(var i = 0, l = elementIds.length ; i < l ; ++i) {
                var elementId = elementIds[i];
                if(elementId !== undefined && nodes.has(elementId))
                    allChildIds.push(elementId);
            }
        }
    } else {
        // need to check for pending updates. Instead of duplicating this
        // loop, the test for 'returnFlat' takes place inside the loop.
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var elementId = elementIds[i];
            if(elementId === undefined)
                continue;
            if((numRemoved > 0 && removedNodes.has(elementId)) ||
               (nodes.has(elementId) &&
                (numAdded === 0 || !addedNodes.has(elementId)))) {
                if(!returnFlat)
                    allChildIds[i] = elementId;
                else
                    allChildIds.push(elementId);
            }
        }
    }

    if(allChildIds.length === 0)
        return undefined;
    
    return returnFlat ? allChildIds : { hasDataElements: false,
                                        childIds: allChildIds };
}

// This function implements getAllDirectChildren() and
// getAllDirectChildrenFlat() for the case that it has been determined that
// there are data elements at the path node. The flag 'returnFlat'
// indicates whether the retur format should be that of
// getAllDirectChildren() or of getAllDirectChildrenFlat().

InternalQCMIndexer.prototype.getAllDirectChildrenWithDataElements =
    internalQCMIndexerGetAllDirectChildrenWithDataElements;

function internalQCMIndexerGetAllDirectChildrenWithDataElements(elementIds,
                                                                pathNode,
                                                                ignorePending,
                                                                returnFlat)
{
    var nodes = pathNode.nodes;
    var removedNodes = pathNode.removedNodes;
    var numRemoved = (!ignorePending && removedNodes !== undefined) ?
        removedNodes.size : 0;
    var addedNodes = pathNode.addedNodes;
    var numAdded = (!ignorePending && addedNodes !== undefined) ?
        addedNodes.size : 0;
    
    // are there any nodes at this path?
    if(nodes.size + numRemoved - numAdded === 0)
        return undefined; // no data nodes at this path
    
    var allChildIds = [];
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(elementId === undefined)
            continue;
        
        if((numRemoved > 0 && removedNodes.has(elementId)) ||
           (nodes.has(elementId) &&
            (numAdded === 0 || !addedNodes.has(elementId)))) {
            if(!returnFlat)
                allChildIds[i] = [elementId];
            else
                allChildIds.push(elementId);
            continue;
        }
        
        // check for child data elements
        
        var childIds =
            this.dataElements.getDirectChildDataElements(elementId,
                                                         pathNode.pathId);
        
        if(childIds !== undefined && numAdded > 0) {
            // filter out children which are still pending
            var pos = 0;
            for(var j = 0, m = childIds.length ; j < m ; ++j) {
                if(!addedNodes.has(childIds[j])) {
                    if(pos !== j)
                        childIds[pos] = childIds[j];
                    pos++;
                }
            }
            if(pos < childIds.length)
                childIds.length = pos;
        }
        
        if(childIds !== undefined && childIds.length > 0) {
            if(!returnFlat)
                allChildIds[i] = childIds;
            else
                allChildIds = cconcat(allChildIds, childIds);
        }
    }

    if(allChildIds.length == 0)
        return undefined; // no child found
    
    return returnFlat ? allChildIds : { hasDataElements: true,
                                        childIds: allChildIds };
}

// This function receives two path IDs, where 'prefixPathId' must be
// a prefix (not necessarily an immediate prefix) of 'pathId'.
// This function then determines whether this indexer stores data elements
// defined at path 'pathId' or at any of its prefix paths which have
// 'prefixPathId' as a proper prefix (that is, this ignores data
// elements defined at 'prefixPathId'). If such data elements exist, this
// function returns true and otherwise false.
//

InternalQCMIndexer.prototype.hasLowerDataElements = 
	internalQCMIndexerHasLowerDataElements;

function internalQCMIndexerHasLowerDataElements(pathId, prefixPathId)
{
    if(pathId == prefixPathId)
        return false;
    
    var pathNode = this.pathNodesById[pathId];
    if(pathNode === undefined)
        return false;

    while(pathNode.pathId != prefixPathId) {
        if(pathNode.hasDataElements)
            return true;
        pathNode = pathNode.parent;
        if(pathNode === undefined)
            return false;
    }

    return false;
}

// This function receives an array of element IDs which are at or above
// some prefix path P and a list (array) of path IDs ('pathIds') which all
// have this prefix path P as a prefix. The function attempts to lower the
// given data elements to the given paths, that is, it tries to find all
// children of the given data elements at the given paths. The function
// assumes two things:
// 1. for every path x which appears in the list 'pathIds', if there 
//    are data elements at path x and these have a parent at path y which is 
//    not a prefix of P then y is also included in 'pathIds'. 
// 2. The element IDs in 'elementIds' are already lowered to P, that is,
//    for each element d in 'elementIds', if d has a child, then this
//    child has a path which extends P. 
// These two assumptions mean that, for each data element, this function
// only checks whether it has children at the paths in 'pathIds'. When
// such children are found, they are added to the list and the test is
// applied to them too.
// The lowered data elements are appended to the list and the function 
// returns this list.

InternalQCMIndexer.prototype.lowerDataElementsTo = 
	internalQCMIndexerLowerDataElementsTo;

function internalQCMIndexerLowerDataElementsTo(elementIds, pathIds)
{
    return this.dataElements.lowerDataElementsTo(elementIds, pathIds);
}

// Returns the ID of the data element which is the direct parent of the
// given data element. This may return undefined if the data element
// is not found in the dataElements table or if it has no parent 
// (iff its path is the root path).

InternalQCMIndexer.prototype.getParentDataElement = 
	internalQCMIndexerGetParentDataElement;

function internalQCMIndexerGetParentDataElement(elementId)
{
    return this.dataElements.getParentId(elementId);
}

// Returns the path ID of the given data element. Returns undefined if
// the data element is not found.

InternalQCMIndexer.prototype.getDataElementPathId = 
	internalQCMIndexerGetDataElementPathId;

function internalQCMIndexerGetDataElementPathId(elementId)
{
    return this.dataElements.getPathId(elementId);
}

// Returns an array which is an ordered subset of the element IDs in
// 'elementIds' whose path ID is larger than the given path ID.
// Under the assumption that all 'elementIds' are IDs of nodes at a
// path which extends 'prefixPathId' this returns the subset for which
// the data element is defined at a path extending 'prefixPathId'.

InternalQCMIndexer.prototype.filterDataElementsUnderPathId = 
	internalQCMIndexerFilterDataElementsUnderPathId;

function internalQCMIndexerFilterDataElementsUnderPathId(elementIds,
                                                         prefixPathId)
{
    return this.dataElements.filterDataElementsUnderPathId(elementIds,
                                                           prefixPathId);
}

// This function return an object which contains 'type' and 'key' fields
// describing the key value of the data node defined by the given
// path node and element ID before the start of the latest update
// cycle (that is, the key at the end of the previous call to the
// path node epilogue). This function will always return the correct value
// only if some query calculation node registered to receive key updates
// from this path node. The key value returned here would then be the previous
// key value that the query calculation node was updated with.

InternalQCMIndexer.prototype.getPrevKey = internalQCMIndexerGetPrevKey;

function internalQCMIndexerGetPrevKey(pathNode, elementId)
{
    if(pathNode.prevKeys !== undefined && pathNode.prevKeys.has(elementId))
        return pathNode.prevKeys.get(elementId);

    return pathNode.nodes.get(elementId);
}

// This function is similar to 'getPrevKey()' except that it first checks
// whether the addition of 'elementId' is still pending on this
// path node (that is, it was already added, but this addition is still
// queued for notification). In this case, this function returns
// undefined (because the node does not yet exist as far as the caller
// of this function is concerned).
// All together, this function returns the value of the key as it is
// known through the notifications received by QueryCalcs which are
// registered to this indexer.

InternalQCMIndexer.prototype.getKnownKey = internalQCMIndexerGetKnownKey;

function internalQCMIndexerGetKnownKey(pathNode, elementId)
{
    if(pathNode.addedNodes !== undefined &&
       pathNode.addedNodes.has(elementId))
        return undefined; // the node has not yet been announced as added
    if(pathNode.prevKeys !== undefined && pathNode.prevKeys.has(elementId))
        return pathNode.prevKeys.get(elementId);

    return pathNode.nodes.get(elementId);
}

// This function takes a path ID and array of element IDs as input.
// It returns an object storing the values of the nodes at the given
// path with the given element IDs.  The function returns an object
// with the following structure:
// {
//     keys: <array>,
//     types: <array>,
//     hasAttrs: <array>
// }
// where each position in each of the arrays in the returned object
// corresponds to the element ID in the corresponding position in the
// input array. The first array provides the current key of the given
// element ID at the path, the second array provides the type and
// the third array provides a boolean which indicates whether the node
// has attributes under it or not.
// For element IDs which are not found at the path, an undefined
// entry is returned in each of the arrays.

InternalQCMIndexer.prototype.getNodeValues = internalQCMIndexerGetNodeValues;

function internalQCMIndexerGetNodeValues(pathId, elementIds)
{
    var values = { keys: [], types: [], hasAttrs: [] };
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return values; // undefined values

    var nodes = pathNode.nodes;
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        if(elementId === undefined || !nodes.has(elementId))
            continue;

        var entry = nodes.get(elementId);

        values.keys[i] = entry.key;
        values.types[i] = entry.type;
        values.hasAttrs[i] = entry.hasAttrs;
    }

    return values;
}

// This function is similar to getNodeValues() except that for each element
// ID it does not return the value currently stored in the 'nodes'
// table, but returns the value which is returned by the 'getKnownKey()'
// function (see the documentation of that function for more details).

InternalQCMIndexer.prototype.getKnownNodeValues =
    internalQCMIndexerGetKnownNodeValues;

function internalQCMIndexerGetKnownNodeValues(pathId, elementIds)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return { keys: [], types: [], hasAttrs: [] }; // undefined values

    if(pathNode.addedNodes === undefined && pathNode.prevKeys === undefined)
        // no pending or old values
        return this.getNodeValues(pathId, elementIds);

    var values = { keys: [], types: [], hasAttrs: [] };

    var nodes = pathNode.nodes;
    var addedNodes = pathNode.addedNodes;
    var prevKeys = pathNode.prevKeys;
    var entry;
    var elementId;
    
    if(addedNodes === undefined) { // prevKeys must exist
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {

            if((elementId = elementIds[i]) === undefined)
                continue;
            
            if(prevKeys.has(elementId))
                entry = prevKeys.get(elementId);
            else if(!nodes.has(elementId))
                continue;
            else
                entry = nodes.get(elementId);
            
            values.keys[i] = entry.key;
            values.types[i] = entry.type;
            values.hasAttrs[i] = entry.hasAttrs;
        }
    } else if(prevKeys === undefined) { // addedNodes must exist
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        
            if((elementId = elementIds[i]) === undefined ||
               addedNodes.has(elementId) || !nodes.has(elementId))
                continue;
            
            entry = nodes.get(elementId);
            
            values.keys[i] = entry.key;
            values.types[i] = entry.type;
            values.hasAttrs[i] = entry.hasAttrs;
        }
    } else { // need to check both
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {

            if((elementId = elementIds[i]) === undefined ||
               addedNodes.has(elementId))
                continue;
            
            if(prevKeys.has(elementId))
                entry = prevKeys.get(elementId);
            else if(!nodes.has(elementId))
                continue;
            else
                entry = nodes.get(elementId);
            
            values.keys[i] = entry.key;
            values.types[i] = entry.type;
            values.hasAttrs[i] = entry.hasAttrs;
        }
    }

    return values;
}

// This function fetches the non-attributes of the nodes whose
// IDs are in the array 'elementIds' and whose path is 'pathId'. This function
// returns an array of Map objects, each Map object storing the non-attributes
// of the node in the corresponding position in the 'elementIds' array.
// 'undefined' will appear in the returned array if the corresponding
// node has no non-attributes. The returned array may be shorter than the
// input array if all remaining entries are undefined.

InternalQCMIndexer.prototype.getNodeNonAttrs =
    internalQCMIndexerGetNodeNonAttrs;

function internalQCMIndexerGetNodeNonAttrs(pathId, elementIds)
{
    var nonAttrs = [];
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return nonAttrs;

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(elementId === undefined)
            continue;
        var nodeEntry = pathNode.nodes.get(elementId);
        if(nodeEntry.nonAttrs !== undefined)
            nonAttrs[i] = nodeEntry.nonAttrs;
    }

    return nonAttrs;
}

/////////////////////
// Update Epilogue //
/////////////////////

// Actual update epilogue function. This function actually implements the update
// epilog. The update epilogue is where various 
// changes queued by the notifications are processed:
// 1. Nodes added and removed from the path node are reported to the
//    'non-indexed' queries.
// 2. Selection query matches changes which were queued for update are
//    delivered to the selection queries.
// 3. Data elements whose reference count reached zero are removed here.
// 4. key updates are sent.
//
// Selection queries are updated after node addition updates are sent
// to projection queries but before node removal updates are sent to
// projection queries. This is because a selection query registered here
// may be composed after a projection query registered here and may
// assume that the projection query (which may, for example, update
// comparison keys) covers at least as many nodes as the selection
// (this is not a problem for two projections, as if both projections
// are registered here, one must be a trivial projection and requires
// no updates).

InternalQCMIndexer.prototype.updateEpilogForPathNode = 
      internalQCMIndexerUpdateEpilogForPathNode;

function internalQCMIndexerUpdateEpilogForPathNode(pathNode)
{
	debugStartTimer("query", "path node update epilog");

    // update registered projections
    if(pathNode.addedNodes !== undefined) {
        this.addMatchesToNoIndexQueries(pathNode, pathNode.addedNodes);
        pathNode.addedNodes = undefined;
    }
    
    // update selection queries (which depend on key values)
    this.updateQueryMatches(pathNode);

    if(pathNode.removedNodes !== undefined) {
        // remove removed nodes as matches for 'any' queries
        this.removeMatchesFromNoIndexQueries(pathNode, pathNode.removedNodes);
        pathNode.removedNodes = undefined;
    }
    
    if(pathNode.removedSubTrees !== undefined) {
        for(var removedId in pathNode.removedSubTrees)
            pathNode.removedSubTrees[removedId].destroy();
        pathNode.removedSubTrees = undefined;
    }

    // Push key updates to query calcs (if updates were requested).
    this.forwardKeyUpdates(pathNode);

    if(pathNode.subTree)
        this.subTreeUpdateEpilog(pathNode);

    pathNode.prevKeys = undefined; // clear the list of previous keys
    
	debugStopTimer("path node update epilog");
}

// When the sub-tree update epilogue is called, it means that updates
// took place on path nodes below the path for which this sub-tree epilogue
// was called. This function then completes any related calculations (e.g.
// completion of the compression value calculation) and forwards the list
// of updated element IDs to the modules which registered a callback 
// object for sub-tree updates on this path node.

InternalQCMIndexer.prototype.subTreeUpdateEpilog =
      internalQCMIndexerSubTreeUpdateEpilog;

function internalQCMIndexerSubTreeUpdateEpilog(pathNode) 
{
    if(!pathNode.subTreeRootUpdateIds && !pathNode.subTreeMonitorUpdateIds)
        return;

    // sub-tree roots for which the update was completed.
    var completedUpdates;

    // update monitors with the sub-tree roots for which the monitor
    // added a registration recently (since this function was last called)

    if(pathNode.subTreeMonitorUpdateIds) {

        for(var monitorId in pathNode.subTreeMonitorUpdateIds) {
            var elementIds = [];
            if(!completedUpdates)
                completedUpdates = {};
            for(var elementId in pathNode.subTreeMonitorUpdateIds[monitorId]) {
                if(!(elementId in completedUpdates)) {
                    completedUpdates[elementId] = true;
                    var entry = pathNode.nodes.get(elementId);
                    if(entry && entry.subTree)
                        entry.subTree.completeUpdate(monitorId);
                }
                elementIds.push(elementId);
            }
            var monitor = pathNode.subTreeMonitors[monitorId];
            monitor.subTreeUpdate(pathNode.pathId, elementIds, monitorId);
        }

        pathNode.subTreeMonitorUpdateIds = {};
    }

    // complete the update of any sub-trees which have recently changed
    // (since the last call to this function) if they were not already 
    // updated above.

    var updateIds = pathNode.subTreeRootUpdateIds ? 
        Object.keys(pathNode.subTreeRootUpdateIds) : [];

    for(var i = 0, l = updateIds.length ; i < l ; ++i) {
        var elementId = updateIds[i];
        if(!completedUpdates || !(elementId in completedUpdates)) {
            var entry = pathNode.nodes.get(elementId);
            if(entry && entry.subTree)
                entry.subTree.completeUpdate();
        }
    }

    // update all monitors on this path with recently (since the last call
    // to this function) changed sub-trees 

    for(var monitorId in pathNode.subTreeMonitors) {
        var monitor = pathNode.subTreeMonitors[monitorId];
        monitor.subTreeUpdate(pathNode.pathId, updateIds, monitorId);
    }

    pathNode.subTreeRootUpdateIds = {};
}

//////////////////
// Match Points //
//////////////////

// For a given path node, the match points of that path node is
// the list of dominating path nodes (including the node itself)
// which have any data elements defined on them (that is, which are
// the a path for some data element). Whether a path
// node carries any data elements can be easily checked by looking at the
// hasDataElements field.
// The match points of a path node are needed by the terminal query
// calculation nodes associated with that path node. These query 
// calculation nodes therefore also get updated when the data element 
// count of a path node dominating their path node changes between zero 
// and non-zero. This is implemented by the functions below. 


// Given a path node ID, this function returns an array whose entries
// are the path node IDs of all path nodes dominating this node
// (including this node) which carry data elements (that is, some data
// element has that path as its path). The path nodes
// are given in decreasing order (that is, from 'fromPathId' to the
// root of the path tree). The given query calculation node is also
// registered to all path nodes dominating the given path node
// (including the given path node itself) so that if this property
// changes on any of these nodes, the query calculation node would be
// notified.

InternalQCMIndexer.prototype.getMatchPoints = 
	internalQCMIndexerGetMatchPoints;

function internalQCMIndexerGetMatchPoints(queryCalc, fromPathId)
{
	var matchPoints = [];

	var pathNode = this.pathNodesById[fromPathId];
	var queryCalcId = queryCalc.getId();

	while(pathNode) {
		if(pathNode.hasDataElements)
			matchPoints.push(pathNode.pathId);
		// indicate that the query calc node should be notified if this
		// property changed
		if(!pathNode.notifyWithElements)
			pathNode.notifyWithElements = {};
		pathNode.notifyWithElements[queryCalcId] = queryCalc;
		pathNode = pathNode.parent;
	}

	return matchPoints;
}

// This function is called by the DataElements table when data elements
// are added at path 'pathId' where previously there were no data elements
// on this path.
// This function updates the 'hasDataElements' property of the path node
// and sends notifications to query calculation nodes which have
// registered to receive such notifications.

InternalQCMIndexer.prototype.notifyPathHasDataElements = 
	internalQCMIndexerNotifyPathHasDataElements;

function internalQCMIndexerNotifyPathHasDataElements(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode.hasDataElements)
        return; // did not change, nothing to do
    
    pathNode.hasDataElements = true;

    if(pathNode.notifyWithElements !== undefined)
        for(var id in pathNode.notifyWithElements)
		    pathNode.notifyWithElements[id].addToMatchPoints(pathId, this);
}

// This function is called by the DataElements table when data elements
// are removed at path 'pathId' and after this removal there are no more
// data elements at this path.
// This function updates the 'hasDataElements' property of the path node
// and sends notifications to query calculation nodes which have
// registered to receive such notifications.

InternalQCMIndexer.prototype.notifyPathHasNoDataElements = 
	internalQCMIndexerNotifyPathHasNoDataElements;

function internalQCMIndexerNotifyPathHasNoDataElements(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return; // path node may have already been destroyed.
    
    if(!pathNode.hasDataElements)
        return; // did not change, nothing to do
    
    pathNode.hasDataElements = false;

    if(pathNode.notifyWithElements !== undefined)
        for(var id in pathNode.notifyWithElements)
			pathNode.notifyWithElements[id].removeFromMatchPoints(pathId, this);
}

// Remove this query calculation node from the 'notifyWithElements'
// list of the given path node and continue removing it recursively
// up the path node chain.

InternalQCMIndexer.prototype.removeMatchPointsNotifications = 
	internalQCMIndexerRemoveMatchPointsNotifications;

function internalQCMIndexerRemoveMatchPointsNotifications(pathNode, 
														  queryCalcId)
{
    if(!pathNode.notifyWithElements)
        return; // none registered

	while(pathNode && pathNode.notifyWithElements[queryCalcId]) {
		delete pathNode.notifyWithElements[queryCalcId];
		pathNode = pathNode.parent;
	}
}

/////////////////////////////////////
// Key Addition/Removal from Nodes //
/////////////////////////////////////

// This function updates the key given by 'type' and 'key' on the node
// defined by 'pathNode' and 'elementId'. In addition to updating
// the key on the node, the key may also be added to the queue in 
// 'keyUpdateQueue' which will be forwarded to query calculation nodes
// which requested key updates during the update epilogue. The key is added
// to the update queue under two conditions:
// 1. There is some query calculation node which requested key updates
//    (a query calculation node must pull all key values updated before
//    the request for key updates was received).
// 2. The key is not for a node just created. The 'isNewNode' flag indicates
//    whether the node is new or not. If it is new, the owner of 
//    the query calculation node is expected to pull the key value when it
//    receives a notification that the node was added.
// The actual queuing of the key update on the 'keyUpdateQueue' is not
// performed by this function, but by some lower function, since some
// updates, such as an update to a value inside a range are not forwarded
// as such, but rather as an update to the range value as a whole.

InternalQCMIndexer.prototype.setKeyValue = internalQCMIndexerSetKeyValue;

function internalQCMIndexerSetKeyValue(pathNode, elementId, type, key, 
                                       isNewNode)
{
    this.updateKeyOnNode(pathNode, elementId, type, key, isNewNode);
}

// This function pushes an <elementId, type, key> update onto the
// path node's key update queue (these are key updates sent to query
// calculation nodes which request a key update).

InternalQCMIndexer.prototype.pushOnKeyUpdateQueue =
    internalQCMIndexerPushOnKeyUpdateQueue;

function internalQCMIndexerPushOnKeyUpdateQueue(pathNode, elementId, type, key,
                                                prevType, prevKey)
{
    var keyUpdateQueue;
    
	if(!(keyUpdateQueue = pathNode.keyUpdateQueue))
		keyUpdateQueue = pathNode.keyUpdateQueue = { elementIds:[], 
                                                     types: [], 
                                                     keys: [],
                                                     prevTypes: [],
                                                     prevKeys: []
                                                   };

	keyUpdateQueue.elementIds.push(elementId);
	keyUpdateQueue.types.push(type);
	keyUpdateQueue.keys.push(key);
    keyUpdateQueue.prevTypes.push(prevType);
    keyUpdateQueue.prevKeys.push(prevKey);

    if(!pathNode.scheduled)
        this.qcm.schedulePathNode(pathNode);
}

// This function is called when a key is being replaced or removed
// (including in the case where a node is removed) to store the
// previous value of the key temporarily (until the next time the
// path node epilogue is called). The key to be stored is given
// by the arguments of the function (which include not only the type and
// key, but also the hasAttrs property). It is stored in the 'prevKeys'
// table of the path node. If a previous key is already stored
// on this path node for the given element ID, it is not replaced
// (this means there were multiple key changes for this node since the
// last call to the path node epilogue, but since the path node epilogue
// was not called, no query calculation nodes were notified of these
// changes, so the first previous key is the one the query calculation nodes
// used in their last update).

InternalQCMIndexer.prototype.preservePreviousKey =
    internalQCMIndexerPreservePreviousKey;

function internalQCMIndexerPreservePreviousKey(pathNode, elementId, type, key,
                                               hasAttrs)
{
    if(pathNode.prevKeys === undefined)
        pathNode.prevKeys = new Map();
    else if(pathNode.prevKeys.has(elementId))
        return; // already stored an even earlier value

    if(typeof(key) == "object") // range key
        key = key.simpleCopy(); // store a constant copy of the key
    
    pathNode.prevKeys.set(elementId, { type: type, key: key,
                                       hasAttrs: hasAttrs });
}

// This function provides access to the 'prevKeys' object of the given
// path node. This may be used by external modules which need these
// previous keys. If this function is called when there is no 'prevKeys'
// object on the given path node, that object is created (in this
// way, the calling module gets access to the previous values of keys
// even if these are only added after this function was called).

InternalQCMIndexer.prototype.getPrevKeyObj = internalQCMIndexerGetPrevKeyObj;

function internalQCMIndexerGetPrevKeyObj(pathNode)
{
    if(pathNode.prevKeys === undefined)
        pathNode.prevKeys = new Map();
    
    return pathNode.prevKeys;
}
    

// This function is called when a node is removed. The function is
// given the path node and data element ID defining the node and the
// entry of the node. This function then removes the key of this entry. 
// The removal takes place only if the node is not inactive,
// that is, is not dominated by an active range node. Whether the
// removed node is active is tested at the beginning of the function. 
// If the node (inactive or not) is a sub-node of a range node, we
// also need to remove its key(s) from the dominating
// range node (there may be several range nodes nested inside
// each-other). If the removed node is
// nested under multiple range nodes, it is enough to perform the
// removal on the lowest of these range nodes, as the removal from
// this node will then propagate to the higher nodes. The key removed
// from the range must be in the
// format of a range key removal update, that is, an array of
// data element IDs identifying the keys to be removed. 
// The key is removed from the sub-indexer for the node which is actually 
// active. If this is the node which was just removed here, this removal 
// was already carried out separately by this function. If this should happen 
// for a higher node, this will take place in the call for the removal 
// from the range node.

InternalQCMIndexer.prototype.removeKeysOfRemovedNodes = 
    internalQCMIndexerRemoveKeysOfRemovedNodes;

function internalQCMIndexerRemoveKeysOfRemovedNodes(pathNode, 
                                                    dataElementId, entry)
{
    var isActive = this.isActive(pathNode, dataElementId, entry);
	
    if(entry.rangeNodeId) {
        // remove from the dominating range node(s)
        var updateKey = (typeof(entry.key) == "object") ?
            entry.key.getKeyUpdate(true) : [dataElementId];
        this.removeKeysFromRangeNode(pathNode, entry.rangeNodeId, entry.type,
                                     updateKey);
    }
    if(isActive) // remove the key
        this.removeKeyFromNode(pathNode, dataElementId, entry.type, entry.key,
                               entry.hasAttrs, true);
}

// This function receives, for a specific path node a value type, a
// data element ID and a key, which is either a RangeKey object or an array
// (for a range node) or a simple value (for all other nodes): string, number,
// boolean or undefined. This function then adds or removes the given
// key for the data node defined by the data element and path.  This
// function then updates the node entry of the given data element (in
// the 'nodes' table of the path node). It also
// updates the sub-indexes, if indexing is turned on for the path
// node. The sub-index then reports which query matches were
// added/removed for this data element as a result in these changes to
// the key. These changes in query matches are stored to the 'queryMatchList'
// of the path node.
// In addition, the function (or the functions called by it) stores
// (temporarily, until the path node epilogue is called) the
// previous value of the node in case there are any queries which registered
// for key updates (this way, these queries don't need to keep track of the
// previous value themselves). This function (or the functions it calls)
// also queue the new and previous values to be reported to queries
// which registered for key updates. Only key values of active nodes
// which were not just added or activated are put on this queue.
// The argument 'isNewNode' indicates whether the node is new or not.
//
// If sub-tree retrieval needs to be applied at this node (or this node
// is part of a sub-tree which needs to be retrieved) the sub-tree retrieval 
// is also updated by this function.
// A positive value of the element ID indicates addition of the key
// while a negative value in of the element ID indicates removal 
// of the key. The element ID for which the removal should take place
// is then the additive inverse of the element ID given (that is, element ID 
// -98 indicates that the key of element ID 98 should be removed). This is
// mainly useful for removing in two cases: when wanting to remove
// just one out of several non-attributes and when the removal takes
// place after the data node has been cleared, so in order to 
// clear the sub-index we need to know the type of the key that needs 
// to be removed (this is only used internally by the base indexer).  
// An undefined type (with positive data element ID) removes the current 
// simple key and type of the data node. A type "nonAttribute" with 
// an undefined key (and positive data element ID) removes all non-attributes. 
// A new simple key (for all types except "attribute") overwrites 
// the existing simple key. Keys of "nonAttribute" type do not affect 
// any key except for the one being added or removed (except in the case of 
// an undefined key, mentioned before). The keys of "nonAttribute" type
// are stored in the 'nonAttrs' table of the node entry and not under 'key'.
// Keys of "attribute" typ should either have a true or false value.
// This is use to toggle the 'hasAttrs()' property of the node. 
// When the keys are added to or removed from a range node or a node
// under a range node, some additional processing needs to take place,
// which is described in the functions which perform these operations.

InternalQCMIndexer.prototype.updateKeyOnNode = 
	internalQCMIndexerUpdateKeyOnNode;

function internalQCMIndexerUpdateKeyOnNode(pathNode, elementId, type, key,
                                           isNewNode)
{
    if(type == "attribute") {
        this.updateHasAttrOnNode(pathNode, elementId, key);
        if(!isNewNode && pathNode.keyUpdateQueryCalcs !== undefined &&
           pathNode.keyUpdateQueryCalcs.size > 0)
            this.pushOnKeyUpdateQueue(pathNode, elementId, "attribute", key);
        return;
    } else if(type == "nonAttribute") {
        this.updateNonAttrOnNode(pathNode, elementId, key);
        if(!isNewNode && pathNode.keyUpdateQueryCalcs !== undefined &&
           pathNode.keyUpdateQueryCalcs.size > 0)
            this.pushOnKeyUpdateQueue(pathNode, elementId, "nonAttribute", key);
        return;
    }

    if(elementId < 0) { // removal of the given key
        this.removeKeyFromNode(pathNode, -elementId, type, key, undefined,
                               false);
        return;
    }

    // add the given key
    this.addKeyToNode(pathNode, elementId, type, key, isNewNode);
}

// This function implements 'updateKeyOnNode' for the case where
// the data element ID is positive and the type is not "attribute".
// This therefore modifies the simple key of the node and not the
// attributes of the node. It adds the key given in 'key'.
// If the given key is an object (RangeKey or an array) this is a range key 
// update and is handled by a separate function (see details there).
// Otherwise, this is a simple key update. This update can have an
// undefined type or key which then deletes any existing key under the
// 'key' field of the node entry (a simple key or a range key).
// This does not remove the attributes of the node.
// When keys are removed and added, the retrieved sub-trees and index
// are updated (as needed, depending on the requirements 
// on the node). If a simple key replaces a RangeKey key,
// the node ceases to be a range node (any node entries created for lower
// nodes must be removed by the derived class). 
// 'isNewNode' indicates whether the node is a new node which was just created
// (in this case there is no need to queue the key to be sent to query
// calculation nodes, as these queries will pull it, if it is interested in it).

InternalQCMIndexer.prototype.addKeyToNode = 
	internalQCMIndexerAddKeyToNode;

function internalQCMIndexerAddKeyToNode(pathNode, elementId, type, key,
                                        isNewNode)
{
    if(type == "range") {
        this.setNodeAsRangeNode(pathNode, elementId, key);
        return;
    }
    
    if(type === undefined) {
        this.removeKeyFromNode(pathNode, elementId, type, key, undefined,
                               false);
        return;
    }

    if(typeof(key) == "object") {
        this.addKeysToRangeNode(pathNode, elementId, type, key, false);
        return;
    }

    if(!pathNode.nodes.has(elementId))
        return; // node was destroy after key update was queued.

    var nodeEntry = pathNode.nodes.get(elementId);
    
    if(type == nodeEntry.type && key == nodeEntry.key)
        return; // nothing changed

    // if some queries requested key updates, store this as the previous
    // key value
    if(!isNewNode && pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0)
        this.preservePreviousKey(pathNode, elementId, nodeEntry.type,
                                 nodeEntry.key, nodeEntry.hasAttrs);
    
    // store the previous type and update
    var prevType = nodeEntry.type;
    var prevKey = nodeEntry.key;
    nodeEntry.type = type;
    nodeEntry.key = key;

    if(nodeEntry.rangeNodeId) {
        // node is embedded in a range, update the keys of the range
        this.addKeysToRangeNode(pathNode, nodeEntry.rangeNodeId,
                                type, [elementId, key], true);
        // this may have changed the active/inactive status of the node
        if(!this.isActive(pathNode, elementId, nodeEntry))
            return; // this node is not active, nothing more to do
    }

    // if queries requested key updates (and the node is not new) add to the
    // key to the update queue
    if(!isNewNode && pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0)
        this.pushOnKeyUpdateQueue(pathNode, elementId, type, key, prevType,
                                  prevKey);
    
    if(pathNode.subIndexes !== undefined) {
        // update the sub-index
        if(type !== prevType && prevType) {
            // new and old entries not of same type, so not stored in the same
            // sub-index: remove and add in separate operations
            this.removeFromSubIndex(pathNode, elementId, prevType, prevKey);
            this.addToSubIndex(pathNode, elementId, type, key, undefined);
        } else
            // add the new value (will remove the old key of the same type)
            this.addToSubIndex(pathNode, elementId, type, key, prevKey);
    }
    
    // update retrieved sub-trees, as needed
    if(this.inSubTree(nodeEntry)) {
        if(this.isOperatorType(type) && !this.isOperatorType(prevType))
            this.extendSubTreesToOperandChildren(pathNode, nodeEntry, 
                                                 elementId);
		this.updateSubTrees(pathNode.pathId, elementId, nodeEntry);
    }
}

// This function removes the key of the data node given by 'pathNode'
// and 'elementId'. This function may either remove the key of a node
// which was already removed (in which case 'wasRemoved' should be true)
// or of a node which has not been removed. When the node was removed,
// 'type', 'key' and 'hasAttrs' should be the type, key and 'hasAttrs' property
// of the node that was removed.
// The following operations are carried out by this function whether the
// node was alreayd removed or not:
// 1. Remove the key from the sub-index for the given type. 
// 2. Store the key in the temporary list of previous keys on the path node
//    (this is done only if there are some queries which expect key updates
//    on this path node and allows these queries access to the previous
//    value without having to store it themselves).
// If the node still exists, the additional following operations take place:
// 1. clear the key from the data node's entry.
// 2. Removes the key from the retrieved sub-trees (if the node is part
//    of such a sub-tree). In this case, only the key actually stored on the 
//    entry is removed from the retrieved sub-trees.
// 3. If this node is inside a range node, this also removes the key(s) 
//    from the dominating range nodes. If this causes the interpretation
//    of the range node to change from an ordered set interpretation 
//    to a convex hull interpretation (the other way around is not possible
//    when a key is deleted), the ordered set nodes need to 
//    be deactivated (and their keys removed from the sub-index)
//    and the data node of the range node needs to be activated (adding the 
//    keys to the index under its own data element ID).
//    (in case the node was removed, this operation should have taken place
//    when the node was removed).

InternalQCMIndexer.prototype.removeKeyFromNode = 
	internalQCMIndexerRemoveKeyFromNode;

function internalQCMIndexerRemoveKeyFromNode(pathNode, elementId, type, key,
                                             hasAttrs, wasRemoved)
{
    if(!wasRemoved) {

        if(typeof(key) == "object") {
            this.removeKeysFromRangeNode(pathNode, elementId, type, key);
            return;
        }
        
        var nodeEntry = pathNode.nodes.get(elementId);

        if(nodeEntry.key === undefined)
            return; // no key, nothing to do

        // use the key and type as stored on the node entry
        key = nodeEntry.key;
        type = nodeEntry.type;
        hasAttrs = nodeEntry.hasAttrs;
        if(typeof(key) == "object") {
            this.removeKeysFromRangeNode(pathNode, elementId, type, key);
            return;
        }

        var isActive = this.isActive(pathNode, elementId, nodeEntry);

        nodeEntry.key = undefined;
        nodeEntry.type = undefined;
            
        // update the retrieved sub-trees
        if(isActive && this.inSubTree(nodeEntry))
		    this.updateSubTrees(pathNode.pathId, elementId, nodeEntry);

        if(nodeEntry.rangeNodeId) {
            // this is a node under a range node, so need to notify the
            // range node that a key was removed.
            this.removeKeysFromRangeNode(pathNode, nodeEntry.rangeNodeId, 
                                         type, [elementId]);
            // a node under a range node and without a key must be inactive
            if(isActive)
                this.deactivateNode(pathNode, elementId, type, key, hasAttrs);
            return;
        }
    }

    // if some queries requested key updates, store this as the previous
    // key value
    if(pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0)
        this.preservePreviousKey(pathNode, elementId, type, key, hasAttrs);
        
    // remove this key from the sub-index (even if there is no node entry
    // anymore)
    if(pathNode.subIndexes !== undefined && key !== undefined)
        this.removeFromSubIndex(pathNode, elementId, type, key);
}

// This function is called on a node (during a key update) when
// it is updated by a "range" type key update. This update identifies
// this node as a range node and specifies the open/closed properties
// of lower and upper end of the range. If the node was not previously
// a range node, it is destroyed and replaced with a new empty range.
// If the node is already a range node, this update simply updates
// its open/closed properties.
// When this was not previously a range node, the function then checks
// whether this operator already has known operands. If it does, these
// operands are used to update the range.
// The functions called here take care of updating the range node and
// any range node dominating it, activating and deactivating nodes, as
// needed, and updating the index and the sub-tree monitors. 

InternalQCMIndexer.prototype.setNodeAsRangeNode = 
    internalQCMIndexerSetNodeAsRangeNode;

function internalQCMIndexerSetNodeAsRangeNode(pathNode, elementId, 
                                              openMinMax)
{
    if(!pathNode.nodes.has(elementId))
        return; // node was destroy after key update was queued.

    var nodeEntry = pathNode.nodes.get(elementId);
    
    if(openMinMax === undefined)
        openMinMax = [false, false]; // default is closed on both sides
    
    if(this.isRangeKey(nodeEntry.key)) {

        // alreadya range key, only update the open/closed properties
        
        if(nodeEntry.key.getMinOpen() == openMinMax[0] &&
           nodeEntry.key.getMaxOpen() == openMinMax[1])
            return; // nothing changed
        // update open/closed
        var prevKey, prevType; // undefined if key not active
        if(nodeEntry.key.isActive()) {
            prevKey = nodeEntry.key.simpleCopy();
            prevType = nodeEntry.type;
        }
        nodeEntry.key.setMinOpen(openMinMax[0]);
        nodeEntry.key.setMaxOpen(openMinMax[1]);
        if(!nodeEntry.key.isEmpty() &&
           this.isActive(pathNode, elementId, nodeEntry)) {
            this.refreshRangeNodeAfterUpdate(pathNode, elementId, nodeEntry,
                                             true, prevType, prevKey,
                                             nodeEntry.hasAttrs);
        }

        return;
    }

    // not a range node, destroy any existing key and create a range
    // node with the appropriate open/close properties
    if(nodeEntry.key !== undefined)
        // remove an existing simple key
        this.removeKeyFromNode(pathNode, elementId, nodeEntry.type,
                               nodeEntry.key, nodeEntry.hasAttrs, false);
    nodeEntry.key = new RangeKey(openMinMax[0], openMinMax[1]);
    nodeEntry.type = "range";                     
    
    var operandIds;

    if(!pathNode.operandCount || 
       !(operandIds = this.getOperandDataElements(elementId, 
                                                  pathNode.pathId)))
        return; // nothing more to do

    // add the operands found to this range.
    this.addOperandsToRange(pathNode, elementId, nodeEntry, operandIds);
}

// This function is used to add the operands whose IDs appear (as keys)
// in 'operandIds' to the range node at the node with ID 'elementId'.
// The function marks the range node as the range node for these nodes 
// and adds their keys to the range node key. This function 
// calls 'addKeysToRangeNode(...)' which performs all update actions
// which follow from this update (such as activating/deactivating nodes).

InternalQCMIndexer.prototype.addOperandsToRange = 
    internalQCMIndexerAddOperandsToRange;

function internalQCMIndexerAddOperandsToRange(pathNode, elementId, nodeEntry,
                                              operandIds)
{
    
    // collect keys (of the same type) from the operands and write them to 
    // the range node (it is assued that usually the keys are of the same
    // type).

    var keys = [];
    var type = undefined;
    var operandNodeEntries = [];

    var _self = this;
    operandIds.forEach(function(t,operandId){

        var operandNodeEntry = pathNode.nodes.get(operandId);
        if(!operandNodeEntry)
            return;

        operandNodeEntries.push(operandId, operandNodeEntry);

        // set the ID of the range node on the operand node
        operandNodeEntry.rangeNodeId = elementId;
        
        if(operandNodeEntry.type === undefined)
            return;
        
        // add the keys of the operator nodes to this range node
        if(_self.isRangeKey(operandNodeEntry.key)) {
            if(operandNodeEntry.key.isEmpty())
                return;
            _self.addKeysToRangeNode(pathNode, elementId,
                                     operandNodeEntry.type, 
                                     operandNodeEntry.key, true);
        } else {
            if(type === undefined || operandNodeEntry.type != type) {
                if(keys.length) {
                    _self.addKeysToRangeNode(pathNode, elementId, type, 
                                             keys, true);
                    keys.length = 0;
                }
                type = operandNodeEntry.type;
            }
            keys.push(operandId, operandNodeEntry.key);
        }
    });
    
    this.addKeysToRangeNode(pathNode, elementId, type, keys, true);

    if(nodeEntry.key.isActive()) {
        // the operands must be deactivated
        for(var i = 0, l = operandNodeEntries.length ; i < l ; i += 2) {
            this.deactivateNode(pathNode, operandNodeEntries[i], 
                                operandNodeEntries[i+1].type,
                                operandNodeEntries[i+1].key,
                                operandNodeEntries[i+1].hasAttrs);
        }
    }
}

// This function adds the keys in 'key' to the node defined by pathNode
// and elementId. 'key' can take one of two forms. It may be a 
// RangeKey object, in which case 'type' should be the type returned by
// the getType() function of the RangeKey (this may be undefined if 
// the RangeKey does not have a single type) or 'key' could 
// be an array [<data element ID 1>, <key value 1>,....,
// <data element ID n>, <key value n>], where the data element IDs identify 
// the different keys in the range which are updated and each such 
// identifier is followed by the new value for that key. In case 'key' is 
// an array, the type of the keys in 'key' is given by 'type' (they must 
// all have the same type).
// If the flag 'fromLowerNode' is set, then this update was not directly
// queued for this range node but was received as a result of an update
// to a node nested inside the range node. If 'fromLowerNode' is set,
// this update will only modify the keys mentioned in the update
// and will not change other keys. On the other hand, if the key 
// update was received for this node (and not from a lower node)
// it will not modify keys not mentioned in the update only if they
// are of the same type as the type of the update (the 'type' argument).
// When the types are not the same, all old keys are removed and
// the new ones are added instead.
// It is assumed that when the 'fromLowerNode' flag is not set, 
// the range node is always active (that is, all keys are of the same
// type and therefore a convex-hull interpretation is possible).
// If the data node being updated is not a range node but already has a 
// simple key defined, that key is removed.
// If this range node is embedded inside another range node, this function
// first propagates the update to the dominating range node. This
// can then result in activation or deactivation of some dominating
// range node. This may then have consequences for this node.
// The non-incremental part of the update (clearing old keys) is handled 
// in the body of this function while for the incremental part of the 
// function, other functions are called. The documentation of 
// the incremental part of the update appears in those functions.

InternalQCMIndexer.prototype.addKeysToRangeNode = 
	internalQCMIndexerAddKeysToRangeNode;

function internalQCMIndexerAddKeysToRangeNode(pathNode, elementId, type, 
                                              key, fromLowerNode) 
{
    var nodeEntry;
    var i, l;
    if(!(nodeEntry = pathNode.nodes.get(elementId)))
        return; // entry destroyed after key update

    // Remove keys because of conflicting type and initialize range key
    // (performs also index and sub-tree retrieval clean-up).
    var prevType = nodeEntry.type;
    var prevKey = nodeEntry.key;
    if(typeof(nodeEntry.key) != "object") {
        // not yet a range node
        if(nodeEntry.key !== undefined)
            // remove an existing simple key
            this.removeKeyFromNode(pathNode, elementId, nodeEntry.type,
                                   nodeEntry.key, nodeEntry.hasAttrs, false);
        
        nodeEntry.key = new RangeKey();
        // will be updated below
        nodeEntry.type = "range";
    } else {

        if(nodeEntry.key.isActive() && !nodeEntry.key.isEmpty())
            prevKey = nodeEntry.key.simpleCopy();
        else {
            prevType = undefined;
            prevKey = undefined;
        }
        
        if(!fromLowerNode && nodeEntry.key.getType() != type) {
            // only the convex-hull interpretation is possible, all keys are of 
            // the same type and the type changed, so remove all existing keys
            if(nodeEntry.rangeNodeId)
                // node is dominated by another range, propagate the removal
                this.removeKeysFromRangeNode(pathNode, nodeEntry.rangeNodeId, 
                                             type, key);
            nodeEntry.key = new RangeKey(); // clear this node
            nodeEntry.type = "range"; // will be updated below
        }
    }

    if(nodeEntry.rangeNodeId) // first update the range the node is embedded in
        this.addKeysToRangeNode(pathNode, nodeEntry.rangeNodeId,
                                type, key, true); 

    // calculate the 'isActive' property before the update
    var isActive = this.isActive(pathNode, elementId, nodeEntry);
        
    // add the new keys (may replace existing keys)
    if(isArray(key)) { // the key is a list of data element IDs and values
        if(key.length == 0)
            return; // nothing more to do
        for(i = 0, l = key.length ; i < l ; i += 2)
            nodeEntry.key.add(type, key[i], key[i+1]);
    } else if(fromLowerNode) {
        // a RangeKey object from a lower node, add its range
        if(key.isEmpty())
            return; // nothing more to do
        nodeEntry.key.addFromRangeKey(key);
    } else {
        // a RangeKey object update for this node, update the keys and
        // open/closed properties of the ends. If the previous key is
        // not empty, we simply discard the old key and create a new one 
        if(!nodeEntry.key.isEmpty())
            this.removeKeysFromRangeNode(pathNode, elementId, nodeEntry.type, 
                                         nodeEntry.key);
        // set the open/closed properties
        nodeEntry.key.setMinOpen(key.getMinOpen());
        nodeEntry.key.setMaxOpen(key.getMaxOpen());
        if(key.isEmpty())
            return; // nothing more to do, as key remains empty
    }
    
    // update index and retrieved sub-trees and activate/deactivate node 
    this.refreshRangeNodeAfterUpdate(pathNode, elementId, nodeEntry, 
                                     isActive, prevType, prevKey,
                                     nodeEntry.hasAttrs); 
}

// This function implements 'removeKeyFromNode()' for the special case
// where 'key' is a range node key update, that is, a RangeKey object 
// or an array holding a list of identifiers: [<data element ID>, ...]. 
// If the current value of the node is not a range value, this function
// does not do anything.
// It is assumed this function is called only if the range node was not
// removed already (if the node was removed, this function does nothing).
// The function removes the key(s) from the range node entry (if
// exists) and propagates this removal to a possible dominating range
// node (if the entry of this node exists). If the node is active,
// this updates the retrieved sub-nodes in which this node is contained. If 
// the node is active or the node entry does not exist (was deleted) the
// keys are removed from the index (if indexing is activated). In case
// the node was already removed, this depends on the format of 'key':
// if it is a RangeKey node, the key can be removed from the index, 
// otherwise (if the key is an array of key identifiers) no key is removed
// from the index. This should be used to indicate to this function
// whether key removal from the index is required or not.
// If the node entry is inactive (and the node entry still exists),
// this operation may make the node active.  If this node is dominated
// by another range node, the key removal is propagated to that range
// node (actually, this propagation takes place first, as it may
// affect the activation of this node).

InternalQCMIndexer.prototype.removeKeysFromRangeNode = 
	internalQCMIndexerRemoveKeysFromRangeNode;

function internalQCMIndexerRemoveKeysFromRangeNode(pathNode, elementId, type, 
                                                   key)
{
    // get the range node entry (if not yet deleted)

    var nodeEntry = pathNode.nodes.get(elementId);
    if(!nodeEntry)
        return;
    
    if(typeof(nodeEntry.key) != "object")
        return; // the current key is simple, cannot be removed here

    var isActive = this.isActive(pathNode, elementId, nodeEntry);

    if(isActive && pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0)
        this.preservePreviousKey(pathNode, elementId, nodeEntry.type,
                                 nodeEntry.key, nodeEntry.hasAttrs);
    
    if(nodeEntry.rangeNodeId)
        // node is dominated by another range node, propagate the removal
        this.removeKeysFromRangeNode(pathNode, nodeEntry.rangeNodeId, 
                                     type, key);
    
    // update the key object
    // copy of range end-points, for removal from retrieved sub-trees 
    // and index
    var prevKey, prevType;
    if(isActive) {
        prevType = nodeEntry.type;
        prevKey = nodeEntry.key.simpleCopy();
    }
    if(isArray(key)) // the key is a list of data element IDs
        for(var i = 0, l = key.length ; i < l ; ++i)
            nodeEntry.key.remove(key[i]);
    else // a RangeKey object
        nodeEntry.key.removeByRangeKey(key);
    
    // refresh retrieved sub-trees and index and possibly (de)activate 
    // the node
    this.refreshRangeNodeAfterUpdate(pathNode, elementId, nodeEntry, 
                                     isActive, prevType, prevKey,
                                     nodeEntry.hasAttrs);
}

// This function is called on a range node after its key was updated.
// The node is the one defined by pathNode and elementId. 'nodeEntry'
// is the entry of the node in the 'nodes' table.
// 'isActive' indicates whether the node was active before the update
// (but after the update of any dominating range node).
// 'prevKey' is the previous key (before the update) of the node
// and, if it is a range, it is a ConstRangeKey object (which may be empty).
// 'prevType' is its type (this is undefined if the node did not have a
// key before this operation or the node was an inactive range).
// 'prevHasAttrs' is the 'hasAttrs' property of the node (both before and
// after the update).
// This function activates or deactivates the node as needed after 
// this update. If this node is embedded inside another range node, 
// it is assumed the higher range node was already updated (and therefore
// it was already determined whether it should be active or not).
// In addtion, this function updates the index and retrieved sub-trees this
// node is contained in. 

InternalQCMIndexer.prototype.refreshRangeNodeAfterUpdate = 
    internalQCMIndexerRefreshRangeNodeAfterUpdate;

function internalQCMIndexerRefreshRangeNodeAfterUpdate(pathNode, elementId, 
                                                       nodeEntry, wasActive,
                                                       prevType, prevKey,
                                                       prevHasAttrs)
{
    // if some queries requested key updates, store this as the previous
    // key value
    if(wasActive && prevKey !== undefined &&
       pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0)
        this.preservePreviousKey(pathNode, elementId, prevType, prevKey,
                                 prevHasAttrs);
    
    var isActive = this.isActive(pathNode, elementId, nodeEntry);
    
    if(!wasActive) {
        if(!isActive)
            return; // remains inactive
        // activate the node
        this.activateRangeNode(pathNode, elementId, nodeEntry);
        return;
    }

    if(!this.isActive(pathNode, elementId, nodeEntry)) {
        this.deactivateRangeNode(pathNode, elementId, nodeEntry, prevType,
                                 prevKey, prevHasAttrs);
        return;
    }

    // node was and remains active (type may have changed)

    if(pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0) {
        // The update for this range node needs to be propagated to
        // query calculation nodes. Add the updated key to the key queue.
        this.pushOnKeyUpdateQueue(pathNode, elementId,
                                  nodeEntry.key.getType(), 
                                  nodeEntry.key.simpleCopy(),
                                  prevType, prevKey);
    }
    
    nodeEntry.type = nodeEntry.key.getType();
    
    if((pathNode.subIndexes !== undefined || pathNode.subTree) &&
       (prevType != nodeEntry.type || typeof(prevKey) != "object" ||
        prevKey.getMinKey() != nodeEntry.key.getMinKey() ||
        prevKey.getMaxKey() != nodeEntry.key.getMaxKey() ||
        prevKey.getMinOpen() != nodeEntry.key.getMinOpen() ||
        prevKey.getMaxOpen() != nodeEntry.key.getMaxOpen())) {
        // was active and remains active and the range changed, need to 
        // update retrieved sub-trees and the index 
        if(this.inSubTree(nodeEntry))
		    this.updateSubTrees(pathNode.pathId, elementId, nodeEntry);
        if(pathNode.subIndexes !== undefined) {
            if(prevType !== undefined && prevType !== nodeEntry.type) {
                this.removeFromSubIndex(pathNode, elementId, prevType, prevKey);
                this.addToSubIndex(pathNode, elementId, nodeEntry.type, 
                                   nodeEntry.key, undefined);
            } if(nodeEntry.type !== undefined)
                this.addToSubIndex(pathNode, elementId, nodeEntry.type, 
                                   nodeEntry.key, prevKey);
        }
    }
    
    return true;
}

// This function implements 'updateKeyOnNode' for the case where the
// key type beign added or removed is "attribute". In this case, the key 
// is either 'true' or 'false' indicating whether the node has attributes
// or not. After checking whether this update actually changed this property
// on the node (and setting the new vlue of the property) this function 
// checks whether the node is part of a monitored sub-tree. If it is
// the sub-tree needs to be extended to the dominated noded (if the 
// 'has attributes' property was turned on), or detached from the 
// dominated nodes (if the 'has attributes' property was turned off).

InternalQCMIndexer.prototype.updateHasAttrOnNode = 
	internalQCMIndexerUpdateHasAttrOnNode;

function internalQCMIndexerUpdateHasAttrOnNode(pathNode, elementId, hasAttrs)
{
	var nodeEntry = pathNode.nodes.get(elementId);

    if(!nodeEntry)
        return; // perhaps the node was already removed
    
    if(hasAttrs === false) { // node has not attributes
        if(!nodeEntry.hasAttrs)
            return;
        nodeEntry.hasAttrs = false;
        // remove as sub-tree root from all nodes dominated by this node.
        if(pathNode.subTree && this.inSubTree(nodeEntry)) {
            for(var attr in pathNode.children) {
                if(nodeEntry.nonAttrs !== undefined &&
                   nodeEntry.nonAttrs.has(attr))
                    continue;
                this.detachSubTreesFromChild(pathNode.children[attr], 
                                             elementId, nodeEntry);
            }
            this.inSubTreeWithAttrDeactivated(pathNode, elementId);
        }
        if(pathNode.keyUpdateQueryCalcs !== undefined &&
           pathNode.keyUpdateQueryCalcs.size > 0)
            this.preservePreviousKey(pathNode, elementId, nodeEntry.type,
                                     nodeEntry.key, true);
	    return;
    }

    // node has attributes

    if(nodeEntry.hasAttrs)
        return; // nothing changed
    nodeEntry.hasAttrs = true;
    // add as sub-tree root to all nodes dominated by this node.
    if(pathNode.subTree && this.inSubTree(nodeEntry)) {
        for(var attr in pathNode.children) {
            if(nodeEntry.nonAttrs !== undefined && nodeEntry.nonAttrs.has(attr))
                continue;
            this.extendSubTreesToChild(pathNode.children[attr], elementId, 
                                       nodeEntry);
        }
        this.inSubTreeWithAttrActivated(pathNode, elementId);
    }

    if(pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0)
        this.preservePreviousKey(pathNode, elementId, nodeEntry.type,
                                 nodeEntry.key, false);
}

// This function implements 'updateKeyOnNode' for the case where the 
// key being added or removed is a non-attribute (that is, the type is 
// "nonAttribute"). These are not keys in the usual sense. They are stored and
// handled differently. The non-attributes are stored under the 'nonAttrs' table
// of the node entry and not under 'key' and there may be multiple 
// nonAttributes to the same data node. Non-attributes are also not indexed.
// They are used, however, in sub-tree retrieval, where we need to find all 
// data nodes which are part of a retrieved sub-tree (defined by its root).
// This function updates the 'nonAttrs' entry of the data node. In
// addition, if this data node is a retrieved sub-tree root or is part of
// a higher retrieved sub-tree, it has to add itself and/or its sub-tree roots
// as sub-tree roots for the node under any nonAttribute which is removed and 
// remove it from the sub-tree roots of any node under an nonAttribute which 
// is added.

InternalQCMIndexer.prototype.updateNonAttrOnNode = 
	internalQCMIndexerUpdateNonAttrOnNode;

function internalQCMIndexerUpdateNonAttrOnNode(pathNode, elementId, attr)
{
    var nodeEntry;
	if(elementId < 0) { // removal of the given attr
		elementId = -elementId;
		// node entry may be missing if the attribute is removed as a result of
        // the whole node having been removed
		if((nodeEntry = pathNode.nodes.get(elementId)) !== undefined &&
           nodeEntry.nonAttrs !== undefined && nodeEntry.nonAttrs.has(attr)) {
            if(nodeEntry.nonAttrs.size == 1)
                nodeEntry.nonAttrs = undefined;
            else
                nodeEntry.nonAttrs.delete(attr);
            // extend all sub-trees this node belongs to to the child 
            // node under this attribute.
            if(attr in pathNode.children)
                this.extendSubTreesToChild(pathNode.children[attr], 
                                           elementId, nodeEntry);
        }
		return;
	}

	nodeEntry = pathNode.nodes.get(elementId);

    if(!nodeEntry)
        return; // perhaps the node was already removed

    if(attr === undefined) { // remove all non-attributes
        if(nodeEntry.nonAttrs === undefined)
            return;
        // add as sub-tree root to all nodes under these attributes
        if(pathNode.subTree && this.inSubTree(nodeEntry)) {
            var _self = this;
            nodeEntry.nonAttrs.forEach(function(t,remAttr) {
                if(remAttr in pathNode.children)
                    this.extendSubTreesToChild(pathNode.children[remAttr], 
                                               elementId, nodeEntry);
            });
        }
        nodeEntry.nonAttrs = undefined;
	    return;
    }

    // add the non-attribute
    if(nodeEntry.nonAttrs === undefined) {
        nodeEntry.nonAttrs = new Map();
        nodeEntry.nonAttrs.set(attr, true);
    } else if(!nodeEntry.nonAttrs.has(attr)) {
        nodeEntry.nonAttrs.set(attr, true);
    } else
        return; // nothing new to add

    // if this path node is in sub-tree mode and the data node is inside
    // a retrieved sub-tree, remove the node under this attribute from
    // the sub-trees which this node belongs to.
    if(pathNode.subTree && this.inSubTree(nodeEntry)) {
        if(attr in pathNode.children)
            this.detachSubTreesFromChild(pathNode.children[attr], 
                                         elementId, nodeEntry);
    }
}

// Returns true iff the given node has attributes. This simply returns
// the value of this poperty as stored on the node entry.

InternalQCMIndexer.prototype.hasAttrs = internalQCMIndexerHasAttrs; 

function internalQCMIndexerHasAttrs(nodeEntry)
{
    return !!nodeEntry.hasAttrs;
}

// For each query calculation node appearing in the queryMatchList of the given
// path node, the query calculation node is updated with the match count 
// changes in this list. The query match list is then cleared.

InternalQCMIndexer.prototype.updateQueryMatches = 
	internalQCMIndexerUpdateQueryMatches;

function internalQCMIndexerUpdateQueryMatches(pathNode) 
{
    if(pathNode.queryMatchList !== undefined) {
        pathNode.queryMatchList.forEach(function(matches, queryId) {
		    pathNode.queryCalcs.get(queryId).updateMatchCount(matches);
        });
    }

    pathNode.queryMatchList = new IntHashMap();
}

// this forwards key updates (for existing nodes) from the previous update
// cycle to queries which requested such updates.

InternalQCMIndexer.prototype.forwardKeyUpdates =
      internalQCMIndexerForwardKeyUpdates;

function internalQCMIndexerForwardKeyUpdates(pathNode)
{
    var queue;
    if((queue = pathNode.keyUpdateQueue) === undefined ||
       queue.elementIds.length == 0)
        return;

    if(pathNode.keyUpdateQueryCalcs !== undefined &&
       pathNode.keyUpdateQueryCalcs.size > 0) {
        pathNode.keyUpdateQueryCalcs.forEach(function(queryCalc, queryId) {
		    queryCalc.updateKeys(queue.elementIds, queue.types, queue.keys,
                                 queue.prevTypes, queue.prevKeys);
        });
    }

    pathNode.keyUpdateQueue = undefined;
}

/////////////////
// Sub-Indexes //
/////////////////

// This function returns true if the values of the given 'type' indexed at
// the path with ID 'pathId' contain range values. If the values of
// the given type are not indexed (because no indexing has
// been turned on on this path or for some other reason) this function
// returns false. To determine whether range values exist, this function
// consults the subIndex object for the given type. Often, once a range
// value is stored in a sub-index, the sub-index continues to indicate
// that it contains range values even if all the range values have already
// been removed. This function therefore only provides an approximation
// to the answer to the question whether there are range values:
// it will always return 'true' if there are such values but may also return
// true if there are no such values (but there previously were).

InternalQCMIndexer.prototype.hasRangeValues = internalQCMIndexerHasRangeValues;

function internalQCMIndexerHasRangeValues(pathId, type)
{
    var pathNode = this.pathNodesById[pathId];

    var subIndex = this.getSubIndex(pathNode, type, false);

    if(!subIndex)
        return false;

    return subIndex.hasRangeValues();
}

// Given an string representing a type (of a value stored inside a content
// node) this function returns the sub-index which is used to store
// keys generated from content nodes of that type at the query path given by
// pathNode. If the sub-index does not exist and the 'create' flag is set,
// it is created and stored on the pathNode.
// The function consults the list of types for which a discrete sub-index
// should be created. If the type appears in this list, a discrete
// sub-index is created for it. Otherwise, a linear sub-index is created.

InternalQCMIndexer.prototype.getSubIndex = internalQCMIndexerGetSubIndex;

function internalQCMIndexerGetSubIndex(pathNode, type, create)
{
    if(type == "strMatch")
        type = "string"; // xxxxxxxxxxxx temporary hack!

    var subIndex = pathNode.subIndexes ? pathNode.subIndexes[type] : undefined;

    if(subIndex || !create)
        return subIndex;
    
    // need to create a new sub-index for this type

    if(this.discreteSubIndexTypes(pathNode, type))
        return pathNode.subIndexes[type] = new DiscreteSubIndex();

    // check for unsupported types
    if(this.isUnindexedType(type))
        return undefined;
    
    // need to create a range sub-index
    
    subIndex = pathNode.subIndexes[type] = 
        new LinearSubIndex((type in this.alphabeticTypes) ? 
                           LinearSubIndex.stringCompare : undefined);
    
    return subIndex;
}

// This function returns true if the given type should be indexed
// discretely for the given query path and false otherwise. Currently,
// the boolean type is always discrete and string values/attribute are
// disrete if the 'alphabeticRanges' property is false (for the given path).

InternalQCMIndexer.prototype.discreteSubIndexTypes = 
	internalQCMIndexerDiscreteSubIndexTypes;

function internalQCMIndexerDiscreteSubIndexTypes(pathNode, type)
{
    return (type == "boolean" || this.isElementReferenceType(type) ||
            (!pathNode.alphabeticRanges && (type in this.alphabeticTypes)));
}

// This function is called to add the key of a given data node to the
// relevant sub-indexer. The function is given the path node, the
// element ID and the type and key which should be added. This key
// should either be a simple value (number, string, boolean) or it
// should be an object representing a range (ConstRangeKey or
// RangeKey) The function also removes any previous key stored for the
// same element ID, if that key was of the same type as the key being
// added. If the same node previously had a different value of the same type,
// this key should be provided in 'prevKey' so that it can be properly
// removed from the index (if the key had a different type, it is removed
// by the calling function and this function should be called with
// prevKey equal to undefined).
// The function updates the 'queryMatchList' table of the path
// node with the queries for which match counts changed as a result of
// this operation.

InternalQCMIndexer.prototype.addToSubIndex = 
	internalQCMIndexerAddToSubIndex;

function internalQCMIndexerAddToSubIndex(pathNode, elementId, type, key,
                                         prevKey)
{
    var subIndex, i, l;

    if(!(subIndex = this.getSubIndex(pathNode, type, true)))
        return;

    var matchUpdates;
    var prevLowKey;
    var prevHighKey;
    var prevLowOpen;
    var prevHighOpen;
    
    if(prevKey !== undefined) {
        if(typeof(key) == "object") {
            prevLowKey = prevKey.getMinKey();
            prevHighKey = prevKey.getMaxKey();
            prevLowOpen = prevKey.getMinOpen();
            prevHighOpen = prevKey.getMaxOpen();
        } else // all other prev values remain undefined
            prevLowKey = prevKey; 
    }

    if(typeof(key) == "object") { // range object
        if(!subIndex.supportsIntervals()) {
            // this must be an alphabetic type, upgrade the sub-index 
            // from a discrete sub-index to a linear sub-index
            var linearSubIndex = pathNode.subIndexes[type] =
                new LinearSubIndex(LinearSubIndex.stringCompare);
            // load the linear index from the discrete index
            linearSubIndex.loadFromDiscrete(subIndex);
        }
        matchUpdates = subIndex.addValue(elementId, key.getMinKey(),
                                         prevLowKey, key.getMaxKey(),
                                         prevHighKey, key.getMinOpen(),
                                         prevLowOpen, key.getMaxOpen(),
                                         prevHighOpen);
    } else
        matchUpdates = subIndex.addValue(elementId, key, prevLowKey, undefined,
                                         prevHighKey, undefined, prevLowOpen,
                                         undefined, prevHighOpen);
  
    var added;
    if((added = matchUpdates.added) !== undefined && added.length != 0) {
        for(i = 0, l = added.length ; i < l ; ++i)
		    this.updateQueryMatchList(pathNode, added[i], elementId, 1);
        if(!pathNode.scheduled)
            this.qcm.schedulePathNode(pathNode);
    }
    var removed;
    if((removed = matchUpdates.removed) !== undefined && removed.length != 0) {
        for(i = 0, l = removed.length ; i < l ; ++i)
		    this.updateQueryMatchList(pathNode, removed[i], elementId, -1);
        if(!pathNode.scheduled)
            this.qcm.schedulePathNode(pathNode);
    }
}

// This function is called to remove the key of a given data node from
// the relevant sub-indexer. The function is given the path node, the
// element ID and the type and key which should be removed.  The function
// updates the 'queryMatchList' table of the path node with the
// queries for which match count decreased as a result of this
// operation.

InternalQCMIndexer.prototype.removeFromSubIndex = 
	internalQCMIndexerRemoveFromSubIndex;

function internalQCMIndexerRemoveFromSubIndex(pathNode, elementId, type, key)
{
    var subIndex;

    if(!(subIndex = this.getSubIndex(pathNode, type)))
        return;

    var valueIds = (typeof(key) == "object") ?
        subIndex.removeValue(elementId, key.getMinKey(), key.getMaxKey(),
                             key.getMinOpen(), key.getMaxOpen()) :
        subIndex.removeValue(elementId, key);

    if(valueIds !== undefined && valueIds.length != 0) {
	    for(var i = 0, l = valueIds.length ; i < l ; ++i)
		    this.updateQueryMatchList(pathNode, valueIds[i], elementId, -1);
        if(!pathNode.scheduled)
            this.qcm.schedulePathNode(pathNode);
    }
}

// The following function is an auxiliary function for managing the
// update of matches per query calculation node when values in the
// index change. Thi updates the 'queryMatchList' table of the path
// nodes. This table has an entries for selection queries registered
// to this path node (and whose match has been updated). Each such
// entry holds a list of data element IDs, each with a count assigned
// to it. The count under each element ID is the match count
// difference for this element ID due to the updates recorded in this
// object. This count may be positive (if matches were added) or
// negative (if matches were removed). Because the same query
// calculation node may register several selection values under
// different value IDs, this count can be larger than 1 or smaller
// than -1. After recording all updates on this object, the section
// for each query calculation node is used to updated that node.
// This function receives a selection value ID ('valueId') and an
// element ID 'elementId' whose match for the query owning the given
// selection value ID is updated.  'countDiff' should be the change in
// count for the given element ID as a match for the given selection
// value ID (1 if it just became a match and -1 if it just stopped
// being a match).  This function then finds the query ID to which the
// value ID belongs and adds the 'countDiff' to the entry of
// 'elementId' under that query ID.

InternalQCMIndexer.prototype.updateQueryMatchList = 
	internalQCMIndexerUpdateQueryMatchList;

function internalQCMIndexerUpdateQueryMatchList(pathNode, valueId, elementId, 
												countDiff)
{
    var queryId = pathNode.queryValueIds[valueId];

    var entry;

    if((entry = pathNode.queryMatchList.get(queryId)) === undefined) {
	    entry = new IntHashMap();
        pathNode.queryMatchList.set(queryId, entry);
    }
    
    if(!entry.has(elementId))
        entry.set(elementId, countDiff);
    else
        entry.set(elementId, entry.get(elementId) + countDiff);
}

/////////////////////////////////
// Query Calculation Interface //
///////////////////////////////// 

// This function should be called with a terminal query calculation
// node.  The function then assigns the query calculation node to the
// path node of the path ID set on the 'pathId' field of the query
// calcualtion node (but does not update its query yet). The function
// performs the following actions:
//
// 1. If the query calculation node is not yet registered to the path node,
//    it notifies the query calculation node of the match points
//    of the path node and adds the query calculation node to the list
//    of nodes which need to be notified when this changes.
// 2. It registers the query calculation node into the queryCalcs table
//    and determines whether it has to appear in the nonIndexedQueryCalcs
//    table and/or in the keyUpdateQueryCalcs table.
// This function returns the pathNode object to which the query was registered.
// Note: this function is not responsible for the clean-up of any previous
// registration due to this query calculation node. This should have
// taken place before the query calculation node values were refreshed 
// (because the clean-up usually needs the previous values of the 
// query calculation node) and is the responsibility of the query 
// calcualtion node refresh process.

InternalQCMIndexer.prototype.addQueryCalcToPathNode = 
	internalQCMIndexerAddQueryCalcToPathNode;

function internalQCMIndexerAddQueryCalcToPathNode(queryCalc)
{
    debugStartTimer("query", "adding query calc to path node");

    var shouldTrace = !queryCalc.noPathNodeTracing; 
    var shouldIndex = this.shouldIndexForQueryCalc(queryCalc);
    var pathId = queryCalc.pathId;
    // get the path node if it exists (and create it if it doesn't)
    var pathNode = this.addPath(pathId);

    if(shouldTrace)
        this.incPathNodeTracing(pathNode);

    if(shouldIndex)
        this.incPathNodeIndexing(pathNode);    

	var queryId = queryCalc.getId();
	var exists =
        (pathNode.queryCalcs !== undefined && pathNode.queryCalcs.has(queryId));

	if(!exists) {
		if(pathNode.queryCalcs === undefined)
			pathNode.queryCalcs = new IntHashMap();
		pathNode.queryCalcs.set(queryId, queryCalc);
        if(queryCalc.setMatchPoints)
		    queryCalc.setMatchPoints(this.getMatchPoints(queryCalc, pathId));
	}

	if(!queryCalc.isSelection()) {
		if(pathNode.nonIndexedQueryCalcs === undefined)
			pathNode.nonIndexedQueryCalcs = new IntHashMap();
		pathNode.nonIndexedQueryCalcs.set(queryId, queryCalc);
	} else {
        if(!pathNode.queryValueIds)
            pathNode.queryValueIds = {};
        if(pathNode.nonIndexedQueryCalcs !== undefined && 
		   pathNode.nonIndexedQueryCalcs.has(queryId))
		    pathNode.nonIndexedQueryCalcs.delete(queryId);
        if(!pathNode.queryMatchList)
            pathNode.queryMatchList = new IntHashMap();
    }

    debugStopTimer("adding query calc to path node");

    return pathNode;
}

// Does the given query calculation node require indexing?

InternalQCMIndexer.prototype.shouldIndexForQueryCalc = 
	internalQCMIndexerShouldIndexForQueryCalc;

function internalQCMIndexerShouldIndexForQueryCalc(queryCalc)
{
    return (!queryCalc.doNotIndex && !queryCalc.noPathNodeTracing && 
            !!queryCalc.isSelection && queryCalc.isSelection());
}

// This function should be called to request that the given query calculation
// node (which should already be registered to the indexer) will be notified
// when key values on he path it is registered to change. This function then
// adds this query to the 'keyUpdateQueryCalcs' table of the path node.

InternalQCMIndexer.prototype.needKeyUpdateForQuery = 
	internalQCMIndexerNeedKeyUpdateForQuery;

function internalQCMIndexerNeedKeyUpdateForQuery(queryCalc)
{
    var pathNode = this.pathNodesById[queryCalc.pathId];
    var queryId = queryCalc.getId();

    if(pathNode.keyUpdateQueryCalcs === undefined)
        pathNode.keyUpdateQueryCalcs = new IntHashMap();
    pathNode.keyUpdateQueryCalcs.set(queryId, queryCalc);
}

// This function should be called to request that the given query calculation
// node (which should be registered to the indexer) should no longer be notified
// when key values on he path it is registered to change. This function then
// removes this query from the 'keyUpdateQueryCalcs' table of the path node.

InternalQCMIndexer.prototype.stopKeyUpdateForQuery = 
	internalQCMIndexerStopKeyUpdateForQuery;

function internalQCMIndexerStopKeyUpdateForQuery(queryCalc)
{
    var pathNode = this.pathNodesById[queryCalc.pathId]; 
    var queryId = queryCalc.getId();

    if(pathNode.keyUpdateQueryCalcs === undefined)
        return; // nothing to do

    pathNode.keyUpdateQueryCalcs.delete(queryId);
    if(pathNode.keyUpdateQueryCalcs.size === 0)
        pathNode.keyUpdateQueryCalcs = undefined;
}

// This function updates one selection value of a simple query calculation 
// node in the indexer. It is assumed here that the query calculation node is
// already assigned to some path node (see addQueryCalcToPathNode()).
// The calling function must provide in 'valueId' the ID of the selection
// value being updated, in 'type' and 'key' the new type and key of this 
// selection value and in 'prevKey' the previous key of this selection
// value, if it was already registered and if it was of the same type
// (otherwise, 'prevKey' should be undefined). If the previous value of
// the value with this value ID had a different type, that should have already
// been removed separately (from a different sub-index) by a call to
// unregisterQueryValue(). 'prevKey' is required for proper modification of
// lookup value in the sub-index, since this is not stored in the sub-index.

InternalQCMIndexer.prototype.updateSimpleQuery = 
	internalQCMIndexerUpdateSimpleQuery;

function internalQCMIndexerUpdateSimpleQuery(queryCalc, valueId, type, key, 
                                             prevKey)
{
	var pathId = queryCalc.pathId;
	var pathNode = this.pathNodesById[pathId];
	var queryId = queryCalc.getId();

    if(!(valueId in pathNode.queryValueIds))
        pathNode.queryValueIds[valueId] = queryId;

    // the key must be a simple value: if it is an object, it must be a range
    var isRange = (typeof(key) == "object");
    
    var subIndex;

    // if the previous key is given, it should be passed on to the
    // sub-index, to generate the proper incremental update

    var prevLowKey;
    var prevHighKey;
    var prevLowOpen;
    var prevHighOpen;
    
    if(prevKey !== undefined) {
        if(typeof(prevKey) == "object") {
            prevLowKey = prevKey.getMinKey();
            prevHighKey = prevKey.getMaxKey();
            prevLowOpen = prevKey.getMinOpen();
            prevHighOpen = prevKey.getMaxOpen();
        } else // all other prev values remain undefined
            prevLowKey = prevKey; 
    }

    // get the sub-index for the new type, creating it, if necessary.
    // Make sure it supports ranges if we are adding a range.

    subIndex = this.getSubIndex(pathNode, type, true);

    // no sub-index for this data type, so no possible matching data
    if (!subIndex)
        return;

    if(isRange && subIndex && !subIndex.supportsIntervals()) {
		// this must be an alphabetic type and the path node does not support
		// alphabetic ranges. Upgrade to support alphabetic ranges (this is
		// a somewhat expensive operation, but is probably very rare).
		this.setAlphabeticRanges(pathNode);
		subIndex = this.getSubIndex(pathNode, type, true);
	}

    // register into the sub-index. The returned object is the list of
	// data element IDs for which a match was added or removed.
    // (in case of a previous value of the same type, this removes the
    // registration for the previous value).
	var matches = isRange ?
        subIndex.addLookup(valueId, key.getMinKey(), prevLowKey,
                           key.getMaxKey(), prevHighKey, key.getMinOpen(),
                           prevLowOpen, key.getMaxOpen(), prevHighOpen) :
        subIndex.addLookup(valueId, key, prevLowKey, undefined, prevHighKey,
                           undefined, prevLowOpen, undefined, prevHighOpen);

	// update the data elements matched by this query
	if(matches) {

        if(matches.removed !== undefined && matches.removed.length)
            queryCalc.removeMatches(matches.removed, this);
        if(matches.added !== undefined && matches.added.length)
            queryCalc.addMatches(matches.added, this);
	}
}

// Given a value ID, the type and key of the value, and a query calculation
// node, this function returns all matches for the given value stored in the
// index for the given type and the path of the query calculation node.
// The value ID should have already been registered as a lookup to the
// index at the query calculation node's path. 

InternalQCMIndexer.prototype.getSimpleQueryValueMatches = 
	internalQCMIndexerGetSimpleQueryValueMatches;

function internalQCMIndexerGetSimpleQueryValueMatches(queryCalc, valueId, type,
                                                      key)
{
	var pathId = queryCalc.pathId;
	var pathNode = this.pathNodesById[pathId];

    // get the sub-index for the type (if it does not yet exist, it is not
    // created).
    var subIndex = this.getSubIndex(pathNode, type, false);

    // no sub-index for this data type, so no possible matching data
    if (!subIndex)
        return [];
    
    return (typeof(key) == "object" ?
            subIndex.getMatches(valueId, key.getMinKey(), key.getMaxKey(),
                                key.getMinOpen(), key.getMaxOpen()) :
            subIndex.getMatches(valueId, key, key, false, false));
}

// This function returns the list of math count updates currently queued for
// the given query calculation object. The returned object is a Map object
// whose keys are the element IDs for which the match count has changed and
// the values are the change in the match count (positive or negative).

InternalQCMIndexer.prototype.getSimpleQueryQueuedUpdates = 
	internalQCMIndexerGetSimpleQueryQueuedUpdates;

function internalQCMIndexerGetSimpleQueryQueuedUpdates(queryCalc)
{
    var pathNode = this.pathNodesById[queryCalc.pathId];
    var queryId = queryCalc.getId();
    
    return pathNode.queryMatchList.get(queryId); // may be undefined
}

// This function removes the given query calculation node from the list
// of query calculation nodes registered to the path node with the
// path ID of the query calculation node. If this is an indexed selection, 
// this will also remove the registration of this query from the sub-index.

InternalQCMIndexer.prototype.removeQueryCalcFromPathNode = 
	internalQCMIndexerRemoveQueryCalcFromPathNode;

function internalQCMIndexerRemoveQueryCalcFromPathNode(queryCalc)
{
    var pathId = queryCalc.pathId;
	var pathNode = this.pathNodesById[pathId];

	if(!pathNode)
		return;

	var queryId = queryCalc.getId();

	if(pathNode.queryCalcs === undefined || !pathNode.queryCalcs.has(queryId))
		return; // queryCalc not registered to this path node
	
	// remove from the list of query calculation nodes which are notified
	// on changes to the match points of this path node.
	this.removeMatchPointsNotifications(pathNode, queryId);

    pathNode.queryCalcs.delete(queryId);

    this.stopKeyUpdateForQuery(queryCalc);

	if(pathNode.nonIndexedQueryCalcs !== undefined &&
       pathNode.nonIndexedQueryCalcs.has(queryId))
		pathNode.nonIndexedQueryCalcs.delete(queryId);
	else
		this.unregisterQuery(pathNode, queryCalc);

    var shouldTrace = !queryCalc.noPathNodeTracing; 
    var shouldIndex = this.shouldIndexForQueryCalc(queryCalc);

    if(shouldIndex)
        this.decPathNodeIndexing(pathNode);

    if(shouldTrace)
        this.decPathNodeTracing(pathNode);
}

// This function is called when a selection query calcualtion node is 
// unregistered from the indexer. It removes all selection values of 
// the given query calculation node from the sub-indexes and from the 
// 'queryValueIds' table of the path node. It also removes any pending
// notifications for match updates for this query. This function does not notify
// the query calculation node of the matches which were removed as
// a result of this operation, as it is assumed that the query calculation
// node is about to be destroyed.  

InternalQCMIndexer.prototype.unregisterQuery = 
	internalQCMIndexerUnregisterQuery;

function internalQCMIndexerUnregisterQuery(pathNode, queryCalc)
{
    if(queryCalc.doNotIndex)
        return; // nothing to do, as nothing was indexed

    // remove all value IDs of this query calculation node
    var valueIds = queryCalc.getDisjointValueIds();

    for(var i = 0, l = valueIds.length ; i < l ; ++i) {

        var value = valueIds[i];
        var subIndex = this.getSubIndex(pathNode, value.type, false);

        var lowKey;
        var highKey;
        var lowOpen;
        var highOpen;
    
        if(typeof(value.key) == "object") {
            lowKey = value.key.getMinKey();
            highKey = value.key.getMaxKey();
            lowOpen = value.key.getMinOpen();
            highOpen = value.key.getMaxOpen();
        } else // all other prev values remain undefined
            lowKey = value.key; 

        
	    if(subIndex)
	        subIndex.removeLookup(value.id, lowKey, highKey, lowOpen, highOpen);
        delete pathNode.queryValueIds[value.id];
    }

    // if there are any pending match notifications for this query,
    // remove them from the queue.
    var queryId = queryCalc.getId();
    pathNode.queryMatchList.delete(queryId);
}

// This function removes the selection value with the given value ID
// ('valueId') for the given query calcualtion node from the path node 
// whose path is given by the query node's 'pathId'.
// 'type' should be the type of the value which was previously registered
// under this ID and 'key' should be its simple key.
// The given value ID must belong to the given query calculation node. 
// The given value ID is removed from the path node and the query
// calculation node is notified with the matches which were removed.

InternalQCMIndexer.prototype.unregisterQueryValue = 
	internalQCMIndexerUnregisterQueryValue;

function internalQCMIndexerUnregisterQueryValue(queryCalc, valueId, type, key)
{
	// get the node with the path ID
	var pathNode = this.pathNodesById[queryCalc.pathId];

    var subIndex = this.getSubIndex(pathNode, type, false);
        
	if(subIndex) {

        var lowKey;
        var highKey;
        var lowOpen;
        var highOpen;
    
        if(typeof(key) == "object") {
            lowKey = key.getMinKey();
            highKey = key.getMaxKey();
            lowOpen = key.getMinOpen();
            highOpen = key.getMaxOpen();
        } else // all other prev values remain undefined
            lowKey = key; 
        
	    var matches = subIndex.removeLookup(valueId, lowKey, highKey, lowOpen,
                                            highOpen);
        queryCalc.removeMatches(matches);
    }

    delete pathNode.queryValueIds[valueId];
}

///////////////////////
// Query Calculation //
///////////////////////

// This function adds the given 'matches' (a Map object with element IDs
// as keys) as matches for all 'non-indexed' simple queries
// registered to the given path node. 'non-indexed' queries are
// queries which match all nodes, regardless of their value (e.g. the
// selection implied by a projection query).

InternalQCMIndexer.prototype.addMatchesToNoIndexQueries =
	internalQCMIndexerAddMatchesToNoIndexQueries;

function internalQCMIndexerAddMatchesToNoIndexQueries(pathNode, matches)
{
	if(pathNode.nonIndexedQueryCalcs === undefined ||
       pathNode.nonIndexedQueryCalcs.size === 0)
		return; // no non-indexed queries

	var nonIndexedQueryCalcs = pathNode.nonIndexedQueryCalcs;
    var elementIds = [];

    matches.forEach(function(entry, elementId) {
        elementIds.push(elementId);
    });

    if(elementIds.length) {
        var _self = this;
	    nonIndexedQueryCalcs.forEach(function(queryCalc, queryId) {
            pathNode.currentlyUpdatedQueryCalc = queryId;
		    queryCalc.addMatches(elementIds, _self);
            pathNode.currentlyUpdatedQueryCalc = undefined;
        });
    }
}

// This function should be called only by projection query calculation
// nodes from inside their 'addMatches()' function (which is called
// by the 'addMatchesToNoIndexQueries()' function above). 'pathId' should
// be the path ID of the projection. This function then filters the
// list of element IDs in 'elementIds' and returns an array with a subset of
// the element IDs in the input array which are currently being added.
// This function should be used from inside the call to 'addMatches()'
// when 'elementIds' is much shorter than the list of element IDs being
// updated.

InternalQCMIndexer.prototype.filterNodesJustBeingAdded =
	internalQCMIndexerFilterNodesJustBeingAdded;

function internalQCMIndexerFilterNodesJustBeingAdded(pathId, elementIds)
{
    var pathNode = this.pathNodesById[pathId];

    var filtered = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(pathNode.addedNodes.has(elementId))
            filtered.push(elementId);
    }

    return filtered;
}

// This function removes the given 'matches' (a Map object whose keys
// are element IDs) as matches for all 'non-indexed' simple queries
// registered to the given path node. 'non-indexed' queries are
// queries which match all nodes, regardless of their value (e.g. the
// selection implied by a projection query).

InternalQCMIndexer.prototype.removeMatchesFromNoIndexQueries =
	internalQCMIndexerRemoveMatchesFromNoIndexQueries;

function internalQCMIndexerRemoveMatchesFromNoIndexQueries(pathNode, matches)
{
	if(pathNode.nonIndexedQueryCalcs === undefined ||
       pathNode.nonIndexedQueryCalcs.size === 0)
		return; // no non-indexed queries

	var nonIndexedQueryCalcs = pathNode.nonIndexedQueryCalcs;

    var elementIds = [];

    matches.forEach(function(entry, elementId) {
        elementIds.push(elementId);
    });
    
    if(elementIds.length) {
        var _self = this;
        nonIndexedQueryCalcs.forEach(function(queryCalc, queryId) {
            pathNode.currentlyUpdatedQueryCalc = -queryId;
		    queryCalc.removeMatches(elementIds, _self);
            pathNode.currentlyUpdatedQueryCalc = undefined;
        });
    }
}

// This function should be called only by projection query calculation
// nodes from inside their 'removeMatches()' function (which is called
// by the 'removeMatchesFromNoIndexQueries()' function above). 'pathId' should
// be the path ID of the projection. This function then filters the
// list of element IDs in 'elementIds' and returns an array with a subset of
// the element IDs in the input array which are currently being removed.
// This function should be used from inside the call to 'removeMatches()'
// when 'elementIds' is much shorter than the list of element IDs being
// updated.

InternalQCMIndexer.prototype.filterNodesJustBeingRemoved =
	internalQCMIndexerFilterNodesJustBeingRemoved;

function internalQCMIndexerFilterNodesJustBeingRemoved(pathId, elementIds)
{
    var pathNode = this.pathNodesById[pathId];

    var filtered = [];

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(pathNode.removedNodes.has(elementId))
            filtered.push(elementId);
    }

    return filtered;
}

///////////////////////////////////
// Access to Matches for Queries //
///////////////////////////////////

// This function returns the list (array) of all 'matches' on the given
// path node. These are, essentially, the element IDs of all data nodes
// in the 'nodes' table of the path node. However, if there are some pending
// updates in the 'addedNodes' and 'removedNodes' lists of the path node,
// these are already incorporated into the 'nodes' table but still need to
// be sent as incremental updates (to query calculation nodes, for example).
// This function corrects for such pending updates so that when these 
// updates are sent, they will be strictly incremental. Therefore, all
// element IDs appearing in the path node's 'addedNodes' table are not
// included in the list of matches returned (these will later be incrementally
// added) and all element IDs appearing in 'removedNodes' are added 
// to the returned list of matches (since they will soon be removed by 
// an incremental update).

InternalQCMIndexer.prototype.getAllMatches =
	internalQCMIndexerGetAllMatches;

function internalQCMIndexerGetAllMatches(pathId)
{
    var pathNode = this.pathNodesById[pathId];
    
    var matches = [];

    if(pathNode === undefined)
        return matches;
    
    if(pathNode.removedNodes !== undefined) {
        // add those nodes which are about to be removed (so that they
        // can correctly be removed later)
        pathNode.removedNodes.forEach(function(entry, elementId) {
            matches.push(elementId);
        });
    }

    if(pathNode.operandCount > 0) {
        var _self = this;
        // may hold range nodes, so need to check for inactive nodes
        if(pathNode.addedNodes !== undefined) {
            // only need to add those nodes which will not be added later
            pathNode.nodes.forEach(function(entry, elementId) {
                if(!pathNode.addedNodes.has(elementId) && 
                   _self.isActive(pathNode, elementId, entry))
                    matches.push(elementId);
            });
        } else {
            pathNode.nodes.forEach(function(entry, elementId) {
                if(_self.isActive(pathNode, elementId, entry))
                    matches.push(elementId);
            });
        }
    } else if(pathNode.addedNodes !== undefined) {
        // add to matches only those nodes which are not in 'addedNodes'
        // (these will be added later)
        pathNode.nodes.forEach(function(entry, elementId) {
            if(!pathNode.addedNodes.has(elementId))
                matches.push(elementId);
        });
    } else {
        pathNode.nodes.forEach(function(entry, elementId) {
            matches.push(elementId);
        });
    }
    
    return matches;
}

// This function is identical to getAllMatches() except that it returns
// its result not as an array of element IDs but as a Map object whose
// keys are element IDs. In the simplest case, this returns the 
// 'nodes' table of the path node, so the calling function is not allowed
// to change this object. 

InternalQCMIndexer.prototype.getAllMatchesAsObj =
	internalQCMIndexerGetAllMatchesAsObj;

function internalQCMIndexerGetAllMatchesAsObj(pathId)
{
    var pathNode = this.pathNodesById[pathId];
    
    if(pathNode.removedNodes === undefined && pathNode.addedNodes === undefined)
        return pathNode.nodes;

    var matches = new IntHashMap(pathNode.nodes.size +
                                 (pathNode.removedNodes ?
                                  pathNode.removedNodes.size : 0));

    if(pathNode.removedNodes !== undefined) {
        // add those nodes which are about to be removed (so that they
        // can correctly be removed later)
        pathNode.removedNodes.forEach(function(entry, elementId) {
            matches.set(elementId, true);
        });
    }

    if(pathNode.addedNodes !== undefined) {
        // add to matches only those nodes which are not in 'addedNodes'
        // (these will be added later)
        pathNode.nodes.forEach(function(entry, elementId) {
            if(!pathNode.addedNodes.has(elementId))
                matches.set(elementId, true);
        });
    } else {
        pathNode.nodes.forEach(function(entry, elementId) {
            matches.set(elementId, true)
        });
    }
    
    return matches;
}

// This function returns true if there are pending additions of nodes
// on the path node with the given path ID and for the query calculation
// node with the given ID. Pending additions are nodes
// which are already in the 'nodes' table but for whose addition no
// update has yet been sent to the given query. It is assumed that
// the given query ID is in the 'nonIndexedQueryCalcs' list of the path.
// (otherwise, false is returned).

InternalQCMIndexer.prototype.pathHasAdditionsPending =
	internalQCMIndexerPathHasAdditionsPending;

function internalQCMIndexerPathHasAdditionsPending(pathId, queryId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined || pathNode.addedNodes === undefined ||
       pathNode.addedNodes.size === 0)
        return false;

    var queryPos = pathNode.nonIndexedQueryCalcs ?
        pathNode.nonIndexedQueryCalcs.getPos(queryId) : undefined;

    if(queryPos === undefined)
        return false; // not in the 'non indexed' query list

    if(pathNode.currentlyUpdatedQueryCalc === undefined)
        return true; // not added yet to any query calculation node

    // matches currently being removed from this query calculation node
    var currentQueryId = pathNode.currentlyUpdatedQueryCalc;

    return (pathNode.nonIndexedQueryCalcs.getPos(currentQueryId) <
            queryPos);
}

// This function returns true if there are pending removals of nodes
// on the path node with the given path ID and for the query calculation
// node with the given ID. Pending removals are nodes which were already
// removed from the 'nodes' table but for whose removal no
// update has yet been sent to the given query. It is asumed that
// the given query ID is in the 'nonIndexedQueryCalcs' list of the path
// (otherwise, false is returned).

InternalQCMIndexer.prototype.pathHasRemovalsPending =
	internalQCMIndexerPathHasRemovalsPending;

function internalQCMIndexerPathHasRemovalsPending(pathId, queryId)
{
    var pathNode = this.pathNodesById[pathId];

//    return (pathNode !== undefined && pathNode.removedNodes !== undefined &&
//            pathNode.removedNodes.size > 0); // xxxxxxxxxxxxxxxxx
    
    if(pathNode === undefined)
        return false;
    
    var queryPos = pathNode.nonIndexedQueryCalcs ?
        pathNode.nonIndexedQueryCalcs.getPos(queryId) : undefined;

    if(queryPos === undefined)
        return false; // not in the 'non indexed' query list
    
    if(pathNode.currentlyUpdatedQueryCalc === 0)
        return true; // all nodes about to be removed

    // is there an explicit set of removals? (rather than clearing all matches)
    var pendingRemovals = (pathNode.removedNodes !== undefined &&
                           pathNode.removedNodes.size > 0);

    if(pathNode.currentlyUpdatedQueryCalc > 0 ||
       pathNode.currentlyUpdatedQueryCalc === undefined)
        return pendingRemovals; // removals pending, but none took place yet

    // matches currently being removed from this query calculation node
    var currentQueryId = -pathNode.currentlyUpdatedQueryCalc;
    if(pendingRemovals)
        // removal only from the 'no index' query calculation nodes
        return (pathNode.nonIndexedQueryCalcs.getPos(currentQueryId) <
                queryPos);

    // complete removal from the path node
    return (pathNode.queryCalcs.getPos(currentQueryId) <
            pathNode.queryCalcs.getPos(queryId));
}

////////////////////////
// Sub-Tree Retrieval //
////////////////////////

// Given a node entry (an entry from the 'nodes' table of a path node)
// this function checks whether it is the root of some retrieved sub-tree.
// This is indicated by the existence of the 'subTree' field on the node
// entry.

InternalQCMIndexer.prototype.isSubTreeRoot = 
		internalQCMIndexerIsSubTreeRoot;

function internalQCMIndexerIsSubTreeRoot(nodeEntry)
{
    return !!nodeEntry.subTree;
}

// This function returns true iff this node entry is part of a sub-tree
// being retrieved. This means that either this node is the root of 
// a retrieved sub-node (in which case the 'subTree' field must be defined)
// or that this node is part of a retrieved sub-tree whose root is higher
// (in which case numSubTreeRoots is not zero). 

InternalQCMIndexer.prototype.inSubTree = internalQCMIndexerInSubTree;

function internalQCMIndexerInSubTree(nodeEntry)
{
	return (!!nodeEntry.subTree || nodeEntry.numSubTreeRoots > 0);
}

// This function returns true iff this node entry is the root of a sub-tree
// but is not part of any sub-tree rooted at a higher (dominating) node.
// To detect this, the function first checks that this node entry carries
// a 'subTree' object. If it does (meaning that it is the root of a 
// monitored sub-tree) we then need to check whether it is inside any other
// sub-tree. If it is, then this sub-tree would have to be registered in the
// subTreeRoots list of the node entry. Moreover, in this case, the 
// sub-tree rooted at this node entry would also have to be registered in 
// this list. Therefore, numSubTreeRoots, which is the length of this 
// list would be at least two.

InternalQCMIndexer.prototype.inSubTreeOnlyAsRoot = 
    internalQCMIndexerInSubTreeOnlyAsRoot;

function internalQCMIndexerInSubTreeOnlyAsRoot(nodeEntry)
{
	return (nodeEntry.subTree && nodeEntry.numSubTreeRoots <= 1);
}

// Indicate that the sub-tree whose root is given by pathNode and 
// elementId has been modified. This should be called by any function
// which updates the sub-tree value because of value change (including the
// addition or removal of a node in the sub-tree or the addition of 
// an attribute which makes an already existing node part of a sub-tree).
// If, however, the update added an existing value to a new sub-tree 
// being retrieved, there is no need to call this function. Instead,
// addToSubTreeMonitorUpdates() should be called for the whole sub-tree.

InternalQCMIndexer.prototype.addToSubTreeRootUpdates =
      internalQCMIndexerAddToSubTreeRootUpdates;

function internalQCMIndexerAddToSubTreeRootUpdates(pathNode, elementId) 
{
    if(!pathNode.scheduled)
        this.qcm.schedulePathNode(pathNode);
    pathNode.subTreeRootUpdateIds[elementId] = true;
}

// This function should be called when the monitor with ID 'monitorId'
// adds a sub-tree retrieval registration for the sub-tree whose root
// is at 'pathNode' under data element 'elementId'. This function stores 
// it in the subTreeMonitorUpdateIds list, which is provided to the 
// given monitor when the sub-tree epilogue for this path is called.
// In this way, the monitor can postpone its completion of the handling of 
// the sub-tree retireval registration until the sub-tree epilogue is called,
// allowing the indexer to update the sub-tree before that happens. 

InternalQCMIndexer.prototype.addToSubTreeMonitorUpdates =
      internalQCMIndexerAddToSubTreeMonitorUpdates;

function internalQCMIndexerAddToSubTreeMonitorUpdates(pathNode, elementId, 
                                                      monitorId) 
{
    if(!pathNode.scheduled)
        this.qcm.schedulePathNode(pathNode);

    var entry;
    if(!(entry = pathNode.subTreeMonitorUpdateIds[monitorId]))
        entry = pathNode.subTreeMonitorUpdateIds[monitorId] = {};
    entry[elementId] = true;
}

//////////////////////////////////
// Sub-Tree Retrieval Interface //
//////////////////////////////////

// The functions in this section provide the interface for external modules
// which request various sub-tree retrieval services, such as compression
// or the registration of a sub-tree processing object (such as the query 
// compilation object).

//

// This function adds an object to the list of sub-tree monitor objects which 
// need to be notified when sub-trees rooted at the given path change.
// This function does not request the retrieval of any specific sub-tree.
// This should be done through specific requests for specific data nodes
// at this path (e.g. use registerCompressionOnNode() to request compression
// or registerSubTreeRetrievalOnNode() for other sub-tree monitoring).
// Multiple such requests can be made for a single monitor object. Such 
// a monitor would have to be registered only once through addSubTreeMonitor().
// This function returns a unique ID for the monitor object. 'monitor' is
// an object which should implement at least the following functions
// (where <monitor ID> is the ID returned by the addSubTreeMonitor() function):
// 
// subTreeUpdate(<path ID>, <array of element IDs>, <monitor ID>): 
//     this receive the list <array of element IDs> of element IDs which 
//     are the root (at path <path ID>) of a retrieved sub-tree which has 
//     just changed.

var globalSubTreeMonitorId = 0;

InternalQCMIndexer.prototype.addSubTreeMonitor =
      internalQCMIndexerAddSubTreeMonitor;

function internalQCMIndexerAddSubTreeMonitor(pathId, monitor)
{
	var pathNode = this.pathNodesById[pathId];
    var monitorId = ++globalSubTreeMonitorId;

	var subTreeMonitors = pathNode.subTreeMonitors;
	if(subTreeMonitors === undefined) {
		subTreeMonitors = pathNode.subTreeMonitors = {};
        pathNode.numSubTreeMonitors = 0;
        pathNode.subTreeRootUpdateIds = {};
        pathNode.subTreeMonitorUpdateIds = {};
    }
    pathNode.numSubTreeMonitors++;
	subTreeMonitors[monitorId] = monitor;

    // increase the sub-tree mode counter. This will create the sub-tree 
    // content module, if not already created.
    this.increaseSubTreeModeCount(pathNode);

    return monitorId;
}

// This function unregisters a sub-tree monitor, and cleans up
// the sub-tree updates if it was the last one.

InternalQCMIndexer.prototype.removeSubTreeMonitor =
      internalQCMIndexerRemoveSubTreeMonitor;

function internalQCMIndexerRemoveSubTreeMonitor(pathId, monitorId)
{
	var pathNode = this.pathNodesById[pathId];
	var subTreeMonitors = pathNode.subTreeMonitors;

	if(subTreeMonitors === undefined)
		return;
    var monitor;

    if((monitor = subTreeMonitors[monitorId]) === undefined)
        return;

    // decrease the sub-tree mode count. This will destroy the sub-tree 
    // content module if no longer needed.
    this.decreaseSubTreeModeCount(pathNode);

	delete subTreeMonitors[monitorId];
	if(--pathNode.numSubTreeMonitors === 0) {
		pathNode.subTreeMonitors = undefined;
        pathNode.subTreeRootUpdateIds = undefined;
        pathNode.subTreeMonitorUpdateIds = undefined;
    } else if(monitorId in pathNode.subTreeMonitorUpdateIds)
        delete pathNode.subTreeMonitorUpdateIds[monitorId];
}

//
// Compression
//

// This function is given a path node and a data element ID which 
// is the ID of a lowest data element on the path represented by the
// path node. Together, these represent a data node. In addition, this
// function receives the ID of a sub-tree monitor which must previously
// have been registered through addSubTreeMonitor() on the given
// path. This function requests compression on the sub-tree rooted at 
// this node. This  is done by requesting sub-tree retrieval on this the 
// node as the root of the sub-tree and providing this request with an undefined
// sub-tree monitor. The sub-tree retrieval object which is then created
// (if it did not previously exist) then knows it has to calculate
// the compression (it may already be calculated because of another
// request).

InternalQCMIndexer.prototype.registerCompressionOnNode = 
		internalQCMIndexerRegisterCompressionOnNode;

function internalQCMIndexerRegisterCompressionOnNode(pathId, dataElementId,
                                                     monitorId)
{
    this.registerSubTreeRetrievalOnNode(pathId, dataElementId, monitorId, 
                                        undefined);
}

// This function takes a path ID and a list (array) of lowest element IDs
// at this path as input and the ID of a sub-tree monitor which must previously
// have been registered through addSubTreeMonitor() on the given
// path. The function then activates compression on the data nodes at this 
// path ID and under the given element IDs (compression is applied to each 
// of these data nodes separately). 

InternalQCMIndexer.prototype.registerCompressionOnNodes = 
		internalQCMIndexerRegisterCompressionOnNodes;

function internalQCMIndexerRegisterCompressionOnNodes(pathId, elementIds, 
                                                      monitorId)
{
    for(var i = 0, l = elementIds.length ; i < l ; ++i)
        this.registerCompressionOnNode(pathId, elementIds[i], monitorId);
}

// This function removes the compression request for sub-tree monitor
// with ID 'monitor ID' on the sub-tree whose root is at the node given by 
// 'pathId' and 'dataElementId'. This function first uses the general 
// sub-tree retrieval request unregistration function to remove 
// the registration. In addition, this function removes any simple
// compression value stored at this node (as part of the sub-tree compression
// value) in case this node is no longer (after this removal) part of
// any retrieved sub-tree. 

InternalQCMIndexer.prototype.unregisterCompressionOnNode = 
	internalQCMIndexerUnregisterCompressionOnNode;

function internalQCMIndexerUnregisterCompressionOnNode(pathId, dataElementId,
                                                       monitorId)
{
    this.unregisterSubTreeRetrievalOnNode(pathId, dataElementId, monitorId);

    var pathNode = this.pathNodesById[pathId];
	var nodeEntry = pathNode.nodes.get(dataElementId);

    if (nodeEntry === undefined)
        return;
    
    // If the node entry is no longer inside any retrieved tree, we 
    // clear the simple compression value on this node (if any). Otherwise,
    // this value will be cleared only with the next value update (which may
    // or may not create a new simple compression value, depending on
    // whether compression requests are still registered.
    if(nodeEntry.simpleCompressedValue && !this.inSubTree(nodeEntry)) {
		// release the compressed value
		this.qcm.compression.
            releaseSimpleCompressed(nodeEntry.simpleCompressedValue);
        delete nodeEntry.simpleCompressedValue;
	}
}

/////////////////////////////////////
// Sub-Tree Retrieval Registration //
/////////////////////////////////////

// This function is used to request sub-tree retrieval for the sub-tree
// monitor given in 'subTreeMonitor' with ID 'subTreeMonitorId' on 
// the sub-tree whose root is given by 'pathId' and 'dataElementId'. 
// 'subTreeMonitor' is an object (such as the 'Query' compilation object) 
// which can receive terminal value updates for the leaves of the sub-tree. 
// If 'subTreeMonitor' is omitted, this retrieval request is interpreted as 
// a compression request (multiple compression requests on the same sub-tree 
// may be registered, but compression will take place only once). Even when
// 'subTreeMonitor' is omitted, 'subTreeMonitorId' must be provided.
// If a retrieved sub-tree object is already defined at this data node,
// all this function does is increase the sub-tree retrieval counter and
// add the sub-tree monitor (if defined) and its ID to the sub-tree retrieval 
// object. Otherwise, this function creates a sub-tree retrieval object 
// (InternalSubTree) and assigns it to the entry of the data node.
// The function may also be provided with an InternalSubTree object
// 'suspendedSubTree' which stores sub-tree monitors and compression
// requests but was not assigned to any node so far. If the data node 
// does not have any sub-tree object assigned to it, this supended sub-tree
// object is assigned to the data node. The 'subTreeMonitorId' and 
// 'subTreeMonitor' are ignored in this case (it is assume that the suspended 
// sub-tree object already carries the sub-tree monitors). If a sub-tree 
// object was assigned to the data node (whether a new one was created or 
// a suspended one) the function then performs initializations required to 
// ensure that the sub-tree is fully retrieved. First, if this is the first time
// this node was inside a retrieved sub-tree (not as its root) this
// function sets attribute tracing for this node (to ensure the 
// lower nodes in the tree are traced by the indexer).
// If this node has already any attributes, this function also registers
// this node as the sub-tree retrieval root for lower nodes. This ensures
// that the tree is properly retrieved. These lower nodes (if exist) 
// will then add themselves to the sub-tree.
// This function function schedules the sub-tree epilogue for
// this path node. It is inside this epilogue that the sub-tree monitoring
// initialization will be completed (hopefully after the indexer has retrieved
// the nodes of the sub-tree). The monitor ID and the sub-tree root data 
// element ID are also registered to the subTreeMonitorUpdateIds table,
// to ensure the monitor gets a chance to complete the initialization 
// when the sub-tree epilogue is called. 

InternalQCMIndexer.prototype.registerSubTreeRetrievalOnNode = 
		internalQCMIndexerRegisterSubTreeRetrievalOnNode;

function internalQCMIndexerRegisterSubTreeRetrievalOnNode(pathId, dataElementId,
                                                          subTreeMonitorId,
                                                          subTreeMonitor,
                                                          suspendedSubTree)
{
	var pathNode = this.pathNodesById[pathId];
	var nodeEntry = pathNode.nodes.get(dataElementId);

    if (nodeEntry === undefined)
        return;

    // schedule the completion of this registration (if there is a suspended
    // sub-tree, for each of the monitors registered to it).
    if(!nodeEntry.subTree && suspendedSubTree) {
        for(var monitorId in suspendedSubTree)
            this.addToSubTreeMonitorUpdates(pathNode, dataElementId, 
                                            monitorId); 
    } else
        this.addToSubTreeMonitorUpdates(pathNode, dataElementId, 
                                        subTreeMonitorId);

    if (!nodeEntry.numSubTreeRequests)
        nodeEntry.numSubTreeRequests = 1;
    else {
        nodeEntry.numSubTreeRequests++;
        nodeEntry.subTree.addMonitor(subTreeMonitorId, subTreeMonitor);
        return; // sub-tree retrieval already activated
    }

    // create a sub-tree object for this root node and update it with
    // the simple value of this data node.
    if(suspendedSubTree)
        nodeEntry.subTree = suspendedSubTree;
    else
        nodeEntry.subTree = new InternalSubTree(this, pathId, dataElementId, 
                                                subTreeMonitorId, 
                                                subTreeMonitor);
    if(nodeEntry.key !== undefined)
        this.setTerminalValueOnSubTree(nodeEntry, pathId, dataElementId, 
                                       nodeEntry);

	if(!nodeEntry.subTreeRoots) {
        nodeEntry.numSubTreeRoots = 0;
		// not part of any retrieved sub-tree so far, notify the derived
        // class that this node has just become part of such a sub-tree
        this.inSubTreeActivated(pathNode, dataElementId);
	} else {
		// add this node's path to the list of sub-tree roots
		if(!nodeEntry.subTreeRoots[pathId])
			nodeEntry.numSubTreeRoots++;
		nodeEntry.subTreeRoots[pathId] = dataElementId;
	}

    // if this node has any attributes or is an operator, there are
    // lower nodes in this sub-tree, so add this node as a retrieved
    // sub-tree root to all lower nodes which are already in the
    // indexer.
    if(nodeEntry.hasAttrs || this.isOperatorType(nodeEntry.type)) {
        // a list of sub-tree roots containing this new root only
        var subTreeRoots = {};
        subTreeRoots[pathNode.pathId] = dataElementId;
        // add this node as a sub-tree root for lower nodes
        this.addSubTreeRootsToChildren(pathNode, dataElementId, subTreeRoots,
                                       true);
    }
}

// This function is called to remove one registration for monitoring
// the sub-tree whose root is given by 'pathId' and 'dataElementId'.
// 'subTreeMonitorId' is the monitor ID used in registering the sub-tree
// retrieval request.
// This function decreases the sub-tree request counter on the data node,
// and if this drops to zero, removes the sub-tree object from this 
// data node. Otherwise, only the sub-tree monitor given by 'subTreeMonitorId'
// is removed from the sub-tree object.
// If the sub-tree object was destroyed, the function removes its 
// registration with lower nodes which are part of the sub-tree it retrieves.
// In addition, the sub-tree mode counter on the path node is decreased by 1. 
// Finally, if this node is no longer part of any sub-tree being retrieved,
// attribute tracing on this node can be unregistered. 

InternalQCMIndexer.prototype.unregisterSubTreeRetrievalOnNode = 
		internalQCMIndexerUnRegisterSubTreeRetrievalOnNode;

function internalQCMIndexerUnRegisterSubTreeRetrievalOnNode(pathId, 
                                                            dataElementId,
                                                            subTreeMonitorId)
{
    var pathNode = this.pathNodesById[pathId];
	var nodeEntry = pathNode.nodes.get(dataElementId);

    if (nodeEntry === undefined)
        return;

    // schedule the completion of this removal (the monitor will be notified 
    // after the completion of the removal).
    this.addToSubTreeMonitorUpdates(pathNode, dataElementId, 
                                    subTreeMonitorId);

    if(--nodeEntry.numSubTreeRequests > 0) {
        // this was not the last sub-tree retrieval request on this node
        // as sub-tree root, just remove the sub-tree monitor from 
        // the sub-tree retrieval object.
        nodeEntry.subTree.removeMonitor(subTreeMonitorId);
        return;
    }

    // no sub-tree retrieval with this node as root, remove the sub-tree
    // retrieval object

    // remove as sub-tree root from child nodes
    if(nodeEntry.hasAttrs || this.isOperatorType(nodeEntry.type)) {
        var subTreeRoots = {};
        subTreeRoots[pathId] = dataElementId;
        this.removeSubTreeRootsFromChildren(pathNode, dataElementId, 
                                            subTreeRoots, false);
    }

    nodeEntry.subTree.destroy();
    nodeEntry.subTree = undefined;

    // if there is a dominating sub-tree root list, this node was also included
    // in it. Remove it.
    if(nodeEntry.numSubTreeRoots > 0) {
        delete nodeEntry.subTreeRoots[pathId];
        nodeEntry.numSubTreeRoots--;
    }

    if(nodeEntry.numSubTreeRoots == 0)
        // this node is no longer inside any retrieved sub-tree,
        // notify the derived class
        this.inSubTreeDeactivated(pathNode, dataElementId, true);
}

////////////////////////////
// Sub-Tree Root Addition //
////////////////////////////

// Given is a path node and a node entry for a new data node just added 
// under this path node (in the 'nodes' table). In addition, this function
// gets as arguments the data element IDs of this node ('elementId') and of 
// the the lowest data element above this node which is not the node itself 
// ('parentElementId'), that is, if the node whose entry is given by 
// 'nodeEntry' is itself a data element then 'parentElementId' must be 
// the parent data element). This function then checks whether this node 
// is part of the sub-tree rooted at the parent (iff the parent is a operator 
// node or has the attribute leading to this node in its 'attrs'
// table). If it is, all retrieved sub-trees dominating the parent node
// (including the parent node itself) are registered to this node entry.
// If any sub-tree roots were found, attribute tracing is turned on for
// this node (to check whether the sub-trees extend further below this node).
// It is assumed here that this node is new and has not (yet) itself
// been set as the root of a retrieved sub-tree. It is also assumed that 
// the node is new and therefore no value has yet been set on it.
// This means that the update of the sub-tree with the simple value of
// this node (if any) will take place later, when the simple value
// is set on this node.
// This function should be called from inside the 'addNonDataElementNode()'
// or the 'addDataElementNode()' functions.
// Since this happens inside the function adding the node, we do not
// notify the derived class that the node became part of a monitored
// sub-tree. It is the responsibility of the derived class to do so
// when the function returns.

InternalQCMIndexer.prototype.setNewNodeSubTreeRoots = 
		internalQCMIndexerSetNewNodeSubTreeRoots;

function internalQCMIndexerSetNewNodeSubTreeRoots(pathNode, nodeEntry, 
												  dataElementId,
                                                  parentElementId)
{
    // find the parent node and check whether it is part of a
    // retrieved sub-tree. If the parent is at a higher path (this is
    // always the case except when the parent is an operator node) we
    // require that the attribute connecting this node to its parent
    // not be in the parent's non-attribute list.
    var parentNodeEntry;
    var parentPathId;
    if(parentElementId !== undefined && dataElementId !== parentElementId &&
       (parentNodeEntry = pathNode.nodes.get(parentElementId))) {
        // dominated by an operator node (parent data element ID, but same path)
        if(!this.inSubTree(parentNodeEntry) || 
           (this.isRangeKey(parentNodeEntry.key) && 
            parentNodeEntry.key.isActive()))
            return; // not in sub-tree or parent is active range (a terminal)
        parentPathId = pathNode.pathId;
    } else if(!pathNode.parent || !pathNode.parent.subTree || 
              !parentElementId || 
              !(parentNodeEntry = pathNode.parent.nodes.get(parentElementId)) ||
              !this.inSubTree(parentNodeEntry) || 
              (parentNodeEntry.nonAttrs !== undefined &&
               parentNodeEntry.nonAttrs.has(pathNode.parentAttr)))
		return;
    else
        parentPathId = pathNode.parent.pathId;

    nodeEntry.subTreeRoots = {};
    if(parentNodeEntry.numSubTreeRoots) { 
        // copy the sub-tree roots stored on the parent (this includes
        // the parent itself, if it is a sub-tree root).
        nodeEntry.numSubTreeRoots = parentNodeEntry.numSubTreeRoots;
        this.addParentSubTreeCount(pathNode, nodeEntry.numSubTreeRoots);
        for(var pathId in parentNodeEntry.subTreeRoots) {
            nodeEntry.subTreeRoots[pathId] = 
                parentNodeEntry.subTreeRoots[pathId];
        }
    } else if(parentNodeEntry.subTree) {
        // the parent node is the only dominating root of a retrieved sub-tree 
        nodeEntry.numSubTreeRoots = 1;
        this.addParentSubTreeCount(pathNode, 1);
        nodeEntry.subTreeRoots[parentPathId] = parentElementId;
    }
}

// This function should be called when the node at the parent path node
// of childPathNode and under data element ID 'elementId'
// requires sub-tree retrieval for the nodes it dominates at 
// childPathNode (this is usually because the node becomes marked as 
// having attributes or the attribute leading to this child is no longer marked
// as a non-attribute). The node entry for this node is given in 
// 'parentNodeEntry'.
// The function first checks whether the parent data node is part of 
// any retrieved sub-tree. If it is, the node(s) at this child path and 
// under the given data element ID (and all nodes under it) need to be 
// added to these sub-trees.

InternalQCMIndexer.prototype.extendSubTreesToChild = 
	internalQCMIndexerExtendSubTreesToChild;

function internalQCMIndexerExtendSubTreesToChild(childPathNode, 
                                                 elementId, parentNodeEntry)
{
    if(!this.inSubTree(parentNodeEntry))
        return;

    // add this node's sub-tree roots as sub-tree roots of the 
    // child nodes under the given attribute

    var subTreeRoots; 
    if(parentNodeEntry.numSubTreeRoots > 0) 
        // this list of sub-tree roots includes this node, if it is a root
        subTreeRoots = parentNodeEntry.subTreeRoots;
    else {
        subTreeRoots = {};
        subTreeRoots[pathNode.parent.pathId] = elementId;
    }
    this.addSubTreeRootsToChild(childPathNode, elementId, subTreeRoots, false);
}

// This function is called when a node which is in a retrieved tree becomes
// an operator node. This implies that its operand sub-nodes also need to 
// be part of these retrieved trees.

InternalQCMIndexer.prototype.extendSubTreesToOperandChildren = 
	internalQCMIndexerExtendSubTreesToOperandChildren;

function internalQCMIndexerExtendSubTreesToOperandChildren(pathNode, nodeEntry, 
                                                           elementId)
{
    var subTreeRoots; 
    if(nodeEntry.numSubTreeRoots > 0) 
        // this list of sub-tree roots includes this node, if it 
        // is a root
        subTreeRoots = nodeEntry.subTreeRoots;
    else {
        subTreeRoots = {};
        subTreeRoots[pathNode.pathId] = elementId;
    }
    this.addSubTreeRootsToChildren(pathNode, elementId, subTreeRoots, false);
}

// This function adds the sub-tree roots listed in 'newSubTreeRoots' 
// (an object whose attributes are path IDs and whose values are data element
// IDs under those paths in the same format as <node entry>.subTreeRoots)
// as sub-tree roots for the children of the data node defined by 
// 'dataElementId' and 'pathNode'. There are two cases.
// The first is when the given node is an operator node. In this case,
// its children are at the same path node. The sub-tree roots are
// added to them all.
// The second case is of child nodes under paths extending the path of
// this node. It is then required that these paths begin with one of the 
// attributes in the data node's 'attrs' table. In other words, those 
// data nodes dominated by the data node X at pathNode and dataElementId 
// and such that there is an attribute path leading from X to those nodes. 
// There is an attribute key path from X to Y if for the path [p1,...,pn] 
// from X to Y the data node which is the parent of Y at path [p1,...,pi] 
// from X has an attribute pi+1.
// In the second case, this function loops over all the attributes of 
// the given node X and finds all data nodes under the paths defined 
// by these attributes.
// In either case, the function adds the given sub-tree roots to the 
// child data nodes, which also calls this function recursively on those 
// data nodes (with the same sub-tree roots).
// 'areSubTreesNew' indicates whether the sub-tree roots were just added now
// or whether they were already added previously but only now this node became
// part of the sub-tree (this is needed to determine which notifications
// should be scheduled).

InternalQCMIndexer.prototype.addSubTreeRootsToChildren = 
		internalQCMIndexerAddSubTreeRootsToChildren;

function internalQCMIndexerAddSubTreeRootsToChildren(pathNode, dataElementId,
                                                     newSubTreeRoots, 
                                                     areSubTreesNew)
{
	var nodeEntry = pathNode.nodes.get(dataElementId);

    if(nodeEntry === undefined)
        return;

    if(this.isOperatorType(nodeEntry.type)) {
        
        if(!pathNode.operandCount)
            return; // no operands at this path

        // find the operands (children of the operator node) and add 
        // the sub-tree roots to them
        var operandIds = this.getOperandDataElements(dataElementId, 
                                                     pathNode.pathId);
        if(operandIds) {
            var _self = this;
            operandIds.forEach(function(t,operandId){
                _self.addParentSubTreeRoots(pathNode, operandId, 
                                            newSubTreeRoots, areSubTreesNew);
            });
        }
        return;
    }

    // from here on, the standard, non-operator, case, where the children
    // must be under one of the attributes in the parents 'attrs' list.

    if(!nodeEntry.hasAttrs)
        return; // no children

	// continue down the child paths
    // all child path nodes are considered, except those whose attribute
    // appears in the non-attribute list of the node

    if(nodeEntry.nonAttrs !== undefined) {
        for(var attr in pathNode.children) {
            if(nodeEntry.nonAttrs.has(attr))
                continue;
            this.addSubTreeRootsToChild(pathNode.children[attr], 
                                        dataElementId, newSubTreeRoots,
                                        areSubTreesNew);
        }
    } else {
        for(var attr in pathNode.children) {
            this.addSubTreeRootsToChild(pathNode.children[attr], 
                                        dataElementId, newSubTreeRoots,
                                        areSubTreesNew);
        }
    }
}

// This function adds the sub-tree roots listed in 'newSubTreeRoots' 
// (an object whose attributes are path IDs and whose values are data element
// IDs under those paths in the same format as <node entry>.subTreeRoots)
// as sub-tree roots for the data nodes dominated by the given
// data element ID and at path 'childPathNode' and (recursively) at paths 
// extending this path. It is assumed that 'dataElementId' is
// the ID of a node at the parent path which is not an operand and,
// therefore, any dominated node at the child path would either have 
// the same element ID or a direct child data element ID.
// 'areSubTreesNew' indicates whether the sub-tree roots were just added now
// or whether they were already added previously but only now this node became
// part of the sub-tree (this is needed to determine which notifications
// should be scheduled).

InternalQCMIndexer.prototype.addSubTreeRootsToChild = 
		internalQCMIndexerAddSubTreeRootsToChild;

function internalQCMIndexerAddSubTreeRootsToChild(childPathNode, dataElementId,
                                                  newSubTreeRoots, 
                                                  areSubTreesNew)
{
    var numSubTreeRoots = Object.keys(newSubTreeRoots).length;
    
    if(childPathNode.nodes.has(dataElementId)) {
        // increase the count of the number of higher sub-tree roots which 
        // have the child path node in their sub-tree.
        this.addParentSubTreeCount(childPathNode, numSubTreeRoots);
        this.addParentSubTreeRoots(childPathNode, dataElementId, 
                                   newSubTreeRoots, areSubTreesNew);
    } else {
	    var subElements = 
		    this.getDirectChildDataElementsAsObj(dataElementId,
                                                 childPathNode.pathId);
        if(subElements) {
            // increase the count of the number of higher sub-tree roots which 
            // have the child path node in their sub-tree.
            this.addParentSubTreeCount(childPathNode,
                                       numSubTreeRoots * subElements.size);

            var _self = this;
            subElements.forEach(function(t,childId) {
			    _self.addParentSubTreeRoots(childPathNode, childId, 
                                            newSubTreeRoots, areSubTreesNew);
		    });
        }
    }
}

// This function adds the sub-tree roots listed in 'newSubTreeRoots' 
// (an object whose attributes are path IDs and whose values are data element
// IDs under those paths in the same format as <nodeEntry>.subTreeRoots)
// as sub-tree roots for the data node X at pathNode and dataElementId.
// These added sub-tree roots cannot contain the node X itself (even if it is
// the root of a sub-tree). That is, they all must also be sub-tree root
// for the parent node of X.
// It then continues to add these sub-tree roots to all child nodes of X
// which are in the sub-tree rooted at X (and therefore also in the all
// the sub-trees which X is contained in). These are the children of X
// which can be reached through one of the attributes listed in the attribute
// list of X.
// 'areSubTreesNew' indicates whether the sub-tree roots were just added now
// or whether they were already added previously but only now this node became
// part of the sub-tree (this is needed to determine which notifications
// should be scheduled).

InternalQCMIndexer.prototype.addParentSubTreeRoots = 
		internalQCMIndexerAddParentSubTreeRoots;

function internalQCMIndexerAddParentSubTreeRoots(pathNode, dataElementId, 
                                                 newSubTreeRoots, 
                                                 areSubTreesNew)
{
    var nodeEntry = pathNode.nodes.get(dataElementId);

	if(!nodeEntry)
		return;

    var subTreeRoots;

    if(!this.inSubTree(nodeEntry)) {
		// node had no sub-tree retrieval before, notify the derived class
        // that it is now inside a monitored sub-tree.
        this.inSubTreeActivated(pathNode, dataElementId);
        subTreeRoots = nodeEntry.subTreeRoots = {};
        nodeEntry.numSubTreeRoots = 0;
	} else if(!nodeEntry.numSubTreeRoots) {
        // this node is currently its only sub-tree root, add it to the list
        subTreeRoots = nodeEntry.subTreeRoots = {};
        nodeEntry.numSubTreeRoots = 1;
        subTreeRoots[pathNode.pathId] = dataElementId;
    } else {
        subTreeRoots = nodeEntry.subTreeRoots;
    }

    // add the sub-tree roots to the node

    for(var rootPathId in newSubTreeRoots) {
        if(subTreeRoots[rootPathId])
            // sub-trees already added. This happens, for example, when
            // an operator node is added to dominate already existing
            // nodes.
            return;
        subTreeRoots[rootPathId] = newSubTreeRoots[rootPathId];
        if(++nodeEntry.numSubTreeRoots == 2 && nodeEntry.subTree)
            // notify that this node is no longer only inside a tree
            // whih it is its root.
            this.inSubTreeOnlyAsRootDeactivated(pathNode, dataElementId);
    }

    // add the value of this data node to the new sub-trees assigned
    // to it
    if(nodeEntry.key !== undefined)
        this.setTerminalValueOnSubTrees(pathNode.pathId, dataElementId, 
                                        nodeEntry, newSubTreeRoots, 
                                        areSubTreesNew);

    // add the sub-tree roots to the children (if any)
    this.addSubTreeRootsToChildren(pathNode, dataElementId, newSubTreeRoots,
                                   areSubTreesNew);
}

// For the given path node, this function increases by 'count' the count 
// of the number of higher sub-tree roots (that is, not at this path) which 
// have data nodes at this path node in their sub-tree. If this count 
// just increased from zero, this function increases by 1 the sub-tree
// mode count on this path (this mode count counts the number of 
// data nodes at this path which are roots of retrieved sub-trees + 1
// in case any node at this path is part of a retrieved sub-tree with
// a root at a prefix path).

InternalQCMIndexer.prototype.addParentSubTreeCount =
      internalQCMIndexerAddParentSubTreeCount;

function internalQCMIndexerAddParentSubTreeCount(pathNode, count)
{
    if(!count)
        return;

    if (pathNode.parentSubTreeCount) {
        pathNode.parentSubTreeCount += count;
    } else {
        pathNode.parentSubTreeCount = count;
        this.increaseSubTreeModeCount(pathNode);
    }
}

// This function increases the count for the 'sub-tree' mode on the
// given path node. This count is the total number of sub-tree
// monitors registered to this path node plus 1 if parentSubTreeCount
// is not zero, that is, if there is any data node at this path which
// is part of a retrieved sub-tree whose root is at a proper prefix
// path.
// When the sub-tree mode count is not zero, the path node is in 
// sub-tree mode.
// This function increases the sub-tree mode count by 1. If it was zero
// before this operation, this function creates the sub-tree content module
// of this path node.

InternalQCMIndexer.prototype.increaseSubTreeModeCount =
      internalQCMIndexerIncreaseSubTreeModeCount;

function internalQCMIndexerIncreaseSubTreeModeCount(pathNode)
{
    if (pathNode.subTree) { // sub-tree mode already on, just increase the count
        pathNode.subTree++;
        return;
    }

    // initialize sub-tree mode
    pathNode.subTree = 1;
    this.activateSubTreeMonitoringOnPath(pathNode);
}

// This function should be called every time the 'subTree' count on the
// path node increases from 0 to 1. This indicates that sub-tree monitoring
// now applies to some nodes at this path (this is either because 
// sub-tree monitoring was registered on one of the nodes at this path
// or because a monitored node at the prefix path has an attribute leading
// to this path node).
// This function notifies the derived class that sub-tree monitoring was
// turned on.

InternalQCMIndexer.prototype.activateSubTreeMonitoringOnPath = 
	InternalQCMIndexerActivateSubTreeMonitoringOnPath;

function InternalQCMIndexerActivateSubTreeMonitoringOnPath(pathNode)
{
    if(!pathNode.trace) { // path just became active
        this.pathNodeActivated(pathNode); // notify the derived class
        this.notifyPathActivated(pathNode); // notify other modules
    } else // notify the derived class that also monitoring was activated
        this.subTreeMonitoringActivated(pathNode);
}

///////////////////////////
// Sub-Tree Node Removal //
///////////////////////////

// This function is called when a data node is removed or deactivated
// and this data node was part of retrieved sub-trees. This function 
// takes care of all the cleanup required by this operation. If there
// is a InternalSubTree object attached to the data node entry, this
// object is cleared of all the sub-tree data added to it (that is, 
// the retrieved sub-tree data) but the sub-tree retrieval requests
// registered to it are not cleared. These remain stored in the object
// as long as the data node is only queued for removal. Only when the
// data node is finally removed is the InternalSubTree object completely
// destroyed (it may happen that a data node is removed and immediately
// added back within the same update cycle, in which case the module
// which registered the request for the retrieval of the sub-tree would
// not be notified of this change and would not be able to re-register
// the request for sub-tree retrieval). 

InternalQCMIndexer.prototype.removeSubTreeNode = 
	internalQCMIndexerRemoveSubTreeNode;

function internalQCMIndexerRemoveSubTreeNode(nodeEntry, pathNode, 
											 dataElementId)
{
    // count the number of retrieved sub-tree roots which this data node
    // is part of.

    var numRoots = nodeEntry.numSubTreeRoots ? nodeEntry.numSubTreeRoots :
        (nodeEntry.subTree ? 1 : 0);

    if(!numRoots)
        return; // not part of any retrieved sub-tree

    // notify the roots of sub-trees (other than this node) which this
    // node was part of that this node was removed.
	this.removeFromSubTreeRoots(pathNode.pathId, dataElementId, nodeEntry);

    // remove this sub-tree from all dominated nodes (this is only
    // needed for the sub-tree with the root at this node)
    var removedSubTreeRoots = {};
    removedSubTreeRoots[pathNode.pathId] = dataElementId;
    this.removeSubTreeRootsFromChildren(pathNode, dataElementId, 
                                        removedSubTreeRoots, false);

    // clear all sub-tree retrieval related fields on this node entry
    this.clearSubTrees(pathNode, dataElementId, nodeEntry);
}

// This function is called with a path ID, a data element ID and the 
// node entry for the node defined by the path ID and data element ID.
// This function is called when this data node is removed or deactivated.
// This function then removes the simple value of this node from all retrieved 
// sub-trees the node was part of. There is no need to do this for the
// sub-tree which is rooted at this data node (if any) because, as this data
// node is removed, the whole tree rooted at it will be cleared. 
 
InternalQCMIndexer.prototype.removeFromSubTreeRoots =
	InternalQCMIndexerRemoveFromSubTreeRoots;

function InternalQCMIndexerRemoveFromSubTreeRoots(pathId, elementId, nodeEntry)
{
    if(!nodeEntry.numSubTreeRoots)
        return; // nothing to do: only possible sub-tree root is the node itself

	var roots;

	for(var rootPathId in nodeEntry.subTreeRoots) {
        var rootElementId = nodeEntry.subTreeRoots[rootPathId];
		if(rootPathId == pathId && rootElementId == elementId)
            // no need to remove from the sub-tree rooted at the node itself
			continue;
        var rootPathNode = this.pathNodesById[rootPathId];
		var root = rootPathNode.nodes.get(rootElementId);
        root.subTree.removeSimpleElement(pathId, elementId);
        this.addToSubTreeRootUpdates(rootPathNode, rootElementId);
	}
}

// This function clears all sub-tree retrieval fields on this given
// data node. This function is called when the node is removed or 
// deactivated. This function then performs the required clean-up.
// This function is not responsible for updating the retrieved sub-tree
// of its removal, it is only responsible for updating its own 
// fields and the fields of the path node it belongs to. 
// It is assumed that if this node was removed or deactivated, the node
// was already queued for removal and its 'subTree' object (if any)
// was already stored on the removal queue. This function therefore
// only clears the 'subTree' object of the sub-tree data (but not 
// of the monitor registrations, as the node may be revived) and removes
// it from the node entry. In addition to clearing the 'subTree' object, 
// this function does the following: 
// 1. If there are any sub-tree retrieval requests registered on this node 
//    as root: remove the contribution (1) of this node to the sub-tree mode
//    counter of this path.
// 2. releases the simple compressed value cached on this node (if any).
// 3. unregisters attribute tracing for this node. 
// 4. clears the list of subtree roots dominating this node and all other
//    sub-tree counters.
// 5. If this is the root of a retrieved sub-tree: remove this node from 
//    the sub-tree retrieval 'pending updates' list for existing sub-tree 
//    updates (subTreeRootUpdateIds) and new registrations
//    (subTreeMonitorUpdateIds).

InternalQCMIndexer.prototype.clearSubTrees = 
	internalQCMIndexerClearSubTrees;

function internalQCMIndexerClearSubTrees(pathNode, dataElementId, nodeEntry)
{
	if(!this.inSubTree(nodeEntry))
		return;

    // this property is needed below to notify the derived class
    var inSubTreeOnlyAsRoot = this.inSubTreeOnlyAsRoot(nodeEntry);

    delete nodeEntry.subTreeRoots;
    if(nodeEntry.numSubTreeRoots) {
        var numParentSubTreeCount = nodeEntry.numSubTreeRoots;
        if(nodeEntry.subTree) // included in the count
            numParentSubTreeCount--;
        this.removeParentSubTreeCount(pathNode, numParentSubTreeCount);
        nodeEntry.numSubTreeRoots = 0;
    }
    
    if(nodeEntry.numSubTreeRequests > 0) {

        // this was a root of a retrieved sub-tree

        if(pathNode.subTreeRootUpdateIds !== undefined &&
           (dataElementId in pathNode.subTreeRootUpdateIds))
            delete pathNode.subTreeRootUpdateIds[dataElementId];
        if(pathNode.subTreeMonitorUpdateIds !== undefined) {
            for(var monitorId in nodeEntry.subTree.getMonitorIds()) {
                if(monitorId in pathNode.subTreeMonitorUpdateIds) {
                    delete pathNode.
                        subTreeMonitorUpdateIds[monitorId][dataElementId]
                }
            }
        }
        nodeEntry.subTree.clear();
        nodeEntry.subTree = undefined;
        this.addToSubTreeRootUpdates(pathNode, dataElementId);
    }

	// release the simple compressed value, if any
	if(nodeEntry.simpleCompressedValue) {
		this.qcm.compression.
            releaseSimpleCompressed(nodeEntry.simpleCompressedValue);
        delete nodeEntry.simpleCompressedValue;
	}

    nodeEntry.numSubTreeRequests = 0;
}

/////////////////////////////////////
// Retrieved Sub-Tree Root Removal //
/////////////////////////////////////

// This function should be called when the node at the parent path node
// of childPathNode and under data element ID 'elementId' no longer
// requires sub-tree retrieval for the nodes it dominates at 
// childPathNode (this is usually because the node is marked as no longer
// having attributes or the attribute leading to this child being marked
// as a non-attribute). The node entry for this node is given in 
// 'parentNodeEntry'.
// The function first checks whether the parent data node is part of
// any retrieved sub-tree. If it is, the node at this child path and
// under the given data element ID (and all nodes under it) need to be
// removed from these sub-trees.

InternalQCMIndexer.prototype.detachSubTreesFromChild = 
		internalQCMIndexerDetachSubTreesFromChild;

function internalQCMIndexerDetachSubTreesFromChild(childPathNode, elementId,
                                                   parentNodeEntry)
{
    if(!this.inSubTree(parentNodeEntry))
        return;

    // remove all sub-tree roots which the parent node is part of their tree
    // as sub-tree roots for the child nodes at teh child path node.
    var removedSubTreeRoots; 
    if(parentNodeEntry.subTreeRoots) 
        // if this exists, this includes this node itself, if it is a
        // sub-tree root.
        removedSubTreeRoots = parentNodeEntry.subTreeRoots;
    else {
        removedSubTreeRoots = {};
        removedSubTreeRoots[childPathNode.parent.pathId] = elementId;
    }
    this.removeSubTreeRootsFromChild(childPathNode, elementId,
                                     removedSubTreeRoots, true);
}

// This function removes the sub-tree roots listed in 'removedSubTreeRoots' 
// (an object whose attributes are path IDs)
// as retrieved sub-tree roots for the data nodes inside the sub-tree rooted
// at data node X at pathNode and dataElementId (but the removed sub-tree
// roots are not removed from X itself).
// If the flag 'updateSubTrees' is set, this function should update the
// given sub-trees with the terminal values removed from them as a result
// of this removal. This should be used in cases where the removed
// roots remain retrieved sub-trees but the nodes under X are no longer part
// of these sub-trees, probably because one of the attributes leading from 
// these roots to X has been removed.
// If the flag 'updateSubTrees' is not set, there is no need to perform
// this update (it is assume that the removed sub-trees are simply
// destroyed).

InternalQCMIndexer.prototype.removeSubTreeRootsFromChildren = 
		internalQCMIndexerRemoveSubTreeRootsFromChildren;

function internalQCMIndexerRemoveSubTreeRootsFromChildren(pathNode, 
                                                          dataElementId,
                                                          removedSubTreeRoots, 
                                                          updateSubTrees)
{
	var nodeEntry = pathNode.nodes.get(dataElementId);

    if(nodeEntry === undefined)
        return;

    // is this an operator node which dominates operands? Remove
    // the sub-tree roots from each of the operands
    if(pathNode.operandCount) {
        var operandIds;
        if(operandIds = this.getOperandDataElements(dataElementId, 
                                                    pathNode.pathId)) {
            var _self = this;
            operandIds.forEach(function(t,operandId){
                _self.removeParentSubTreeRoots(pathNode, operandId,
                                               removedSubTreeRoots,
                                               updateSubTrees);
            });
        }
        return;
    }
    
    if(!nodeEntry.hasAttrs)
        return; // no more children

	// continue down the child paths. 
    // all child path nodes are considered, except those whose attribute
    // appears in the non-attribute list of the node

    if(nodeEntry.nonAttrs !== undefined) {
        for(var attr in pathNode.children) {
            if(nodeEntry.nonAttrs.has(attr))
                continue;
            this.removeSubTreeRootsFromChild(pathNode.children[attr], 
                                             dataElementId, removedSubTreeRoots,
                                             updateSubTrees);
        }
    } else {
        for(var attr in pathNode.children) {
            this.removeSubTreeRootsFromChild(pathNode.children[attr], 
                                             dataElementId, removedSubTreeRoots,
                                             updateSubTrees);
        }
    }
}

// This function removes the sub-tree roots listed in 'removedSubTreeRoots' 
// (an object whose attributes are path IDs)
// as retrieved sub-tree roots for the data nodes dominated by the given
// data element ID and at path 'childPathNode' and (recursively) at paths 
// extending this path. It is assumed that 'dataElementId' is
// the ID of a node at the parent function which is not an operand and,
// therefore, any dominated node at the child path would either have 
// the same element ID or a direct child data element ID.
// If the flag 'updateSubTrees' is set, this function should update the
// given sub-trees with the terminal values removed from them as a result
// of this removal. This should be used in cases where the removed
// roots remain retrieved sub-trees. 
// If the flag 'updateSubTrees' is not set, there is no need to perform
// this update (it is assume that the removed sub-trees are simply
// destroyed).

InternalQCMIndexer.prototype.removeSubTreeRootsFromChild = 
		internalQCMIndexerRemoveSubTreeRootsFromChild;

function internalQCMIndexerRemoveSubTreeRootsFromChild(childPathNode, 
                                                       dataElementId,
                                                       removedSubTreeRoots,
                                                       updateSubTrees)
{
    if(childPathNode.nodes.has(dataElementId)) {
        this.removeParentSubTreeRoots(childPathNode, dataElementId,
                                      removedSubTreeRoots,
                                      updateSubTrees);
    } else {
	    var subElements = 
		    this.getDirectChildDataElementsAsObj(dataElementId,
                                                 childPathNode.pathId);
	    if(subElements) {
            var _self = this;
            subElements.forEach(function(t,childId) {
			    _self.removeParentSubTreeRoots(childPathNode, childId,
                                              removedSubTreeRoots,
                                              updateSubTrees);
		    });
        }
    }
}

// This function removes the retrieved sub-tree roots listed in
// 'removedSubTreeRoots' (an object whose attributes are path IDs) as
// sub-tree roots for the data node X at pathNode and dataElementId.
// These roots cannot contain the node X itself.
// It then continues to remove these sub-tree root from all node which
// are in the sub-tree rooted at X.
// If the flag 'updateSubTrees' is set, this function should remove
// the simple value of X and of all nodes in the sub-tree rooted at X
// from the sub-tree registered on the sub-tree roots in 
// 'removedSubTreeRoots'. This should be used in cases where the sub-tree roots
// remain sub-tree roots but node X is no longer part of their sub-tree
// (usually, as a result of the removal of an attribute from a node 
// without the removal of the node under it).
// If the flag 'updateSubTrees' is not set, there is no need to perform
// this update (it is assumed that all sub-tree monitoring for these
// sub-tree roots is being removed).

InternalQCMIndexer.prototype.removeParentSubTreeRoots = 
		internalQCMIndexerRemoveParentSubTreeRoots;

function internalQCMIndexerRemoveParentSubTreeRoots(pathNode, dataElementId,
                                                    removedSubTreeRoots, 
                                                    updateSubTrees)
{
    var nodeEntry = pathNode.nodes.get(dataElementId);

	if(!nodeEntry)
		return;

    var subTreeRoots;
	if(!(subTreeRoots = nodeEntry.subTreeRoots))
        return; // no higher sub-tree roots registered on this node

    // remove the sub-tree roots from the children under attributes
    this.removeSubTreeRootsFromChildren(pathNode, dataElementId, 
                                        removedSubTreeRoots, updateSubTrees);

    if(nodeEntry.key === undefined)
        updateSubTrees = false; // no value to update

    var numRemoved = 0;
    
    for(var rootPathId in removedSubTreeRoots) {
	    if(subTreeRoots[rootPathId]) {
            if(updateSubTrees) {
                var rootPathNode = this.pathNodesById[rootPathId];
                var rootElementId = subTreeRoots[rootPathId];
                var root = rootPathNode.nodes.get(rootElementId);
                
                root.subTree.removeSimpleElement(pathNode.pathId, 
                                                 dataElementId);
                this.addToSubTreeRootUpdates(rootPathNode, rootElementId);
            }
		    delete subTreeRoots[rootPathId];
            if(--nodeEntry.numSubTreeRoots == 1 && nodeEntry.subTree)
                // notify that this node is now only part of a retrieved
                // sub-tree which has it as its root.
                this.inSubTreeOnlyAsRootActivated(pathNode, dataElementId);
            numRemoved++;
	    }
    }

    // decrease the count of the number of higher sub-tree roots which 
    // dominate this child path node.
    this.removeParentSubTreeCount(pathNode, numRemoved);
    
    if(!this.inSubTree(nodeEntry)) { // not part of any sub-tree anymore
        // release the simple compressed value, if any
	    if(nodeEntry.simpleCompressedValue) {
		    this.qcm.compression.
                releaseSimpleCompressed(nodeEntry.simpleCompressedValue);
            delete nodeEntry.simpleCompressedValue;
	    }
        // notify the derived class that this is no longer inside 
        // a monitored sub-tree
        this.inSubTreeDeactivated(pathNode, dataElementId, false);
    }
}

// For the given path node, this function decreases by 'count' the count 
// of the number of higher sub-tree roots (that is, not at this path) which 
// have data nodes at this path node in their sub-tree. 

InternalQCMIndexer.prototype.removeParentSubTreeCount =
      internalQCMIndexerRemoveParentSubTreeCount;

function internalQCMIndexerRemoveParentSubTreeCount(pathNode, count)
{
    if(!count)
        return;

    if((pathNode.parentSubTreeCount -= count) == 0)
         this.decreaseSubTreeModeCount(pathNode);
}

// This function decreases the count for the 'sub-tree' mode on the
// given path node. This count is the total number of data nodes at
// this path which are roots of a retrieved sub-tree plus 1 if 
// parentSubTreeCount is not zero, that is, if there is any data node at
// this path which is part of a retrieved sub-tree whose root is at
// a proper prefix path.
// When the sub-tree mode count is not zero, the path node is in 
// sub-tree mode.
// This function decreases the sub-tree mode count by 1. If it becomes zero
// as a result of this operation, this function destroys the sub-tree 
// content module of this path node.

InternalQCMIndexer.prototype.decreaseSubTreeModeCount =
      internalQCMIndexerDecreaseSubTreeModeCount;

function internalQCMIndexerDecreaseSubTreeModeCount(pathNode)
{
    assert(pathNode.subTree > 0);
    pathNode.subTree--;
    if (pathNode.subTree > 0)
        return;

    this.deactivateSubTreeMonitoringOnPath(pathNode);
}

// This function should be called every time the 'subTree' count on the
// path node drops from 1 to 0. This indicates that sub-tree monitoring
// no longer applies to nodes at this path. This function then notifies
// the derived class of this fact.

// This function is called when the subTree counter of the given
// path node just dropped from > 0 to 0. It is assumed the counter has
// already been set to zero when this function is called. This function
// then checks whether as a result of this the path node has become inactive
// (if there is no tracing). In this case, modules requesting notifications
// when this path node becomes inactive are notified and the path node
// may be destroyed.


InternalQCMIndexer.prototype.deactivateSubTreeMonitoringOnPath = 
	InternalQCMIndexerDeactivateSubTreeMonitoringOnPath;

function InternalQCMIndexerDeactivateSubTreeMonitoringOnPath(pathNode)
{
    if(pathNode.trace) {
        // path node still active, only notify the derived class that
        // monitoring has been turned off
        this.subTreeMonitoringDeactivated(pathNode);
    } else { // path became inactive
        if(pathNode.keepActive) {
            pathNode.deactivateBlocked = true;
            return;
        }
        this.pathNodeDeactivated(pathNode); // notify the derived class
        this.notifyPathDeactivated(pathNode); // notify other module
    }
}

///////////////////////////////
// Retrieved Sub-Tree Update //
///////////////////////////////

// This function is called to set the current value of the data node
// given by 'pathId' and 'dataElementId' and whose entry in the path
// node's 'nodes' table is 'nodeEntry' on the sub-trees whose roots
// are given in 'subTreeRoots' (an object whose attributes are the
// paths of these roots an whose values are the element IDs of those
// roots). If 'subTreeRoots' is undefined, 'pathId' is taken as the
// path of the sub-tree root. 'areSubTreesNew' indicates whether the
// retrieval of these sub-trees was just requested now or not. This
// determines what sort of update needs to be scheduled for the
// monitors of these sub-trees (if the sub-trees are new, the updates
// were already queued).  This function also updates the cached value
// of the simple compressed value for this data node, if
// necessary. This does not release any previous simple compression
// value. It assumes that if the value changed, the old simple
// compression has already been cleared. Therefore, if there is a
// compressed value available, it must be up to date.

InternalQCMIndexer.prototype.setTerminalValueOnSubTrees = 
    internalQCMIndexerSetTerminalValueOnSubTrees;

function internalQCMIndexerSetTerminalValueOnSubTrees(pathId, dataElementId, 
                                                      nodeEntry, subTreeRoots,
                                                      areSubTreesNew)
{
    if(subTreeRoots === undefined) {
        var pathNode = this.pathNodesById[pathId];

        if(!areSubTreesNew)
            // as theis is not a new root, we must add this root to the list
            // of updated sub-trees.
            this.addToSubTreeRootUpdates(pathNode, dataElementId);

        if(nodeEntry.key === undefined)
            nodeEntry.subTree.removeSimpleElement(pathId, dataElementId);
        else
            this.setTerminalValueOnSubTree(nodeEntry, pathId, dataElementId, 
                                           nodeEntry);
        return;
    }
        
    for(var rootPathId in subTreeRoots) {
        var rootPathNode = this.pathNodesById[rootPathId];
        var rootElementId = subTreeRoots[rootPathId];
		var root = rootPathNode.nodes.get(rootElementId);

        if(!areSubTreesNew)
            // as these are not new roots, we must add this root to the list
            // of updated sub-trees.
            this.addToSubTreeRootUpdates(rootPathNode, rootElementId);

        if(nodeEntry.key === undefined) {
            root.subTree.removeSimpleElement(pathId, dataElementId);
            continue;
        }

        this.setTerminalValueOnSubTree(root, pathId, dataElementId, nodeEntry);
    }
}

// This function sets the current value of the data node 
// given by 'pathId' and 'dataElementId' and whose entry in the 
// path node's 'nodes' table is 'nodeEntry' on the sub-trees whose
// root is the data node whose entry (in the path node's 'nodes' 
// table) is 'terminalNodeEntry'. This function does not check that the
// given data node entries indeed fulfill these requirements, but assumes
// the calling function has checked this. This function updates the 
// sub-tree object of the rootNodeEntry and, if necessary, also the 
// simple compressed value of that node entry. 

InternalQCMIndexer.prototype.setTerminalValueOnSubTree = 
    internalQCMIndexerSetTerminalValueOnSubTree;

function internalQCMIndexerSetTerminalValueOnSubTree(rootNodeEntry, 
                                                     pathId, dataElementId,
                                                     terminalNodeEntry)
{
    var simpleCompression = rootNodeEntry.subTree.
        updateSimpleElement(pathId, dataElementId, terminalNodeEntry.type, 
                            terminalNodeEntry.key, 
                            terminalNodeEntry.simpleCompressedValue);

    if(simpleCompression && !terminalNodeEntry.simpleCompressedValue) {
        // simple compression value was calculated by the sub-tree
        // object, cache it here (after reallocating it, that is, increasing
        // its reference count).
        this.qcm.compression.reallocateSimple(simpleCompression);
        terminalNodeEntry.simpleCompressedValue = simpleCompression;
    }
}

// This function is called when the simple value of a data node inside 
// a retrieved sub-tree is updated. The data node is given by 
// 'pathId', 'elementId' (and whose entry is 'nodeEntry'). If the node entry 
// stores a simple compressed value (belonging to the old value) this simple
// compressed value is released. Afterwards, the new value (which may
// be undefined) is updated to the retrieved sub-trees this data node
// belongs to.

InternalQCMIndexer.prototype.updateSubTrees = 
	internalQCMIndexerUpdateSubTrees;

function internalQCMIndexerUpdateSubTrees(pathId, elementId, nodeEntry)
{
	// release the previous compressed value (if existed)
    if(nodeEntry.simpleCompressedValue) {
	    this.qcm.compression.
            releaseSimpleCompressed(nodeEntry.simpleCompressedValue);
        nodeEntry.simpleCompressedValue = undefined;
    }

    this.setTerminalValueOnSubTrees(pathId, elementId, nodeEntry,
                                    nodeEntry.subTreeRoots, false);
}

///////////////////////////
// Compression Interface //
///////////////////////////

// The indexer provides an interface for retrieving compressed values
// for those nodes for which a compression request was registered.
// This interface is implemented is the InternalSubTree object
// and the indexer functions only need to find the appropriate 
// InternalSubTree object and forward the request to this object
// (see more details there).

// This function retrieves the compressed value for the data node
// at the given path under the givan data element. It retruns undefined
// if the data node does not exist or no compression has been requested
// for it.
// If the data node exists and compression has been requested for it, this
// function returns an array of length 2, with the following fields:
// [<quick compression>, <full compression>]
// If the compressed value is simple, both fields are defined and both
// are a number.
// If the compressed value is not simple, the <quick compression> field
// is a string. If full compression has been set, <full compression> is
// a number and otherwise, undefined. If the quick compression of 
// two elements is equal and a string, full compression needs to be
// requested for these two elements to determine whether they are 
// equal or not.

InternalQCMIndexer.prototype.getCompression =
    internalQCMIndexerGetCompression;

function internalQCMIndexerGetCompression(pathId, dataElementId) 
{
    var pathNode;
    
    if((pathNode = this.pathNodesById[pathId]) === undefined)
        return undefined;

    var nodeEntry;

    if((nodeEntry = pathNode.nodes.get(dataElementId)) === undefined)
        return undefined;

    if(nodeEntry.subTree === undefined)
        return undefined;

    return nodeEntry.subTree.getCompression();
}

// This function returns the full compression value for the given element.
// This is the same as the second element in the aray returned by 
// getCompression().

InternalQCMIndexer.prototype.getFullCompression =
    internalQCMIndexerGetFullCompression;

function internalQCMIndexerGetFullCompression(pathId, dataElementId)
{
    var pathNode;
    
    if((pathNode = this.pathNodesById[pathId]) === undefined)
        return undefined;

    var nodeEntry;

    if((nodeEntry = pathNode.nodes.get(dataElementId)) === undefined)
        return undefined;

    if(nodeEntry.subTree === undefined)
        return undefined;

    return nodeEntry.subTree.getFullCompression();
}

// This function is used to request full compression on the data node 
// at the given path under the given data element. If the data node 
// does not exist or no compression has been requested for it, this 
// function does nothing. Otherwise, this function passes the request
// on to the relevant InternalSubTree object.
// From this point on, full compression is calculated until full 
// compression is stopped (by calling unsetFullCompression(), see below)
// or the node is removed.
// 'subTreeMonitorId' is the ID of the sub-tree monitor which requested
// the full compression. Since multiple compression monitors may 
// request compression, this is used to ensure proper cancellation of
// these requestes.
// If the data node exists and compression has been requested for it,
// this function returns the compressed value (including the full
// compression value) in the same format as 'getCompression()' above.
// Otherwise, this function returns undefined.

InternalQCMIndexer.prototype.setFullCompression =
    internalQCMIndexerSetFullCompression;

function internalQCMIndexerSetFullCompression(pathId, dataElementId, 
                                              subTreeMonitorId) 
{
    var pathNode;
    
    if((pathNode = this.pathNodesById[pathId]) === undefined)
        return undefined;

    var nodeEntry;

    if((nodeEntry = pathNode.nodes.get(dataElementId)) === undefined)
        return undefined;

    if(nodeEntry.subTree === undefined)
        return undefined;

    return nodeEntry.subTree.setFullCompression(subTreeMonitorId);
}

// This function is used to stop the calculation of full compression
// on the data node at the given path under the given data element.
// This cancels the full-compression request for the sub-tree monitor 
// with the given ID. If the data node does not exist or no compression 
// has been requested for it or no full compression was requested by
// the given sub-tree monitor, this function does nothing.
// Otherwise, the function decreases the number of registered full-compression
// requests. If this drops to zero, the calculation of the full compression
// is stopped.
// This function does not return any value, but from this point on, 
// if the full compression was stopped, the full compression value returned 
// for non-simple sub-trees will be undefined.

InternalQCMIndexer.prototype.unsetFullCompression =
    internalQCMIndexerUnsetFullCompression;

function internalQCMIndexerUnsetFullCompression(pathId, dataElementId, 
                                                subTreeMonitorId) 
{
    var pathNode;
    
    if((pathNode = this.pathNodesById[pathId]) === undefined)
        return;

    var nodeEntry;

    if((nodeEntry = pathNode.nodes.get(dataElementId)) === undefined)
        return;

    if(nodeEntry.subTree === undefined)
        return;

    nodeEntry.subTree.unsetFullCompression(subTreeMonitorId);
}

///////////////////////////////
// Active Path Notifications //
///////////////////////////////

// This function provides an interface for the registration of the objects
// which wish to be notified when a path becomes active or when it 
// becomes inactive (a path is active when either its 'trace' or its
// 'subTree' flag is set, that is, either tracing is turned on or at least
// one of the nodes at that path is inside a monitored sub-tree).
// The given object 'obj' should have an ID allocated from the ID pool of
// the InternalQCM for this indexer. This ID should be accessible
// through a function obj.getId(). In addition, 'obj' should have 
// a function 'pathActivated(<path ID>)' and 'pathDeactivated(<path ID>)'. 
// 'pathId' is the ID for which the object wishes to receive notifications
// when the active status of the path changes.

InternalQCMIndexer.prototype.registerPathActiveNotifications = 
    internalQCMIndexerRegisterPathActiveNotifications;

function internalQCMIndexerRegisterPathActiveNotifications(pathId, obj)
{
    var id = obj.getId();

    if(!this.pathActiveNotify)
        this.pathActiveNotify = {};

    var pathEntry = this.pathActiveNotify[pathId];

    if(!pathEntry) {
        pathEntry = this.pathActiveNotify[pathId] = {
            numToNotify: 1,
            toNotify: {} 
        }
        
    } else if(!(id in pathEntry.toNotify))
        pathEntry.numToNotify++;

    pathEntry.toNotify[id] = obj;
}

// This function is to be used to remove a registration made by 
// registerPathActiveNotifications(). The removal of the registration is
// performed based on the ID of the registered object ('objId') and 
// the ID of the path. This function simply removes the object from the list
// of objects to be notified when the active status of the path changes.

InternalQCMIndexer.prototype.unregisterPathActiveNotifications = 
    internalQCMIndexerUnregisterPathActiveNotifications;

function internalQCMIndexerUnregisterPathActiveNotifications(pathId, objId)
{
    var pathEntry;

    if(!this.pathActiveNotify || !(pathEntry = this.pathActiveNotify[pathId]) ||
       !(objId in pathEntry.toNotify))
        return; // not registered

    if(!--pathEntry.numToNotify)
        delete this.pathActiveNotify[pathId];
    else
        delete pathEntry.toNotify[objId];
}

// This function should be called when a path node becomes active 
// (either the 'trace' or the 'subTree' becomes set). It then notifies
// all registered object of this change.

InternalQCMIndexer.prototype.notifyPathActivated = 
    internalQCMIndexerNotifyPathActivated;

function internalQCMIndexerNotifyPathActivated(pathNode)
{
    var pathId = pathNode.pathId;

    var pathEntry;

    if(!this.pathActiveNotify || !(pathEntry = this.pathActiveNotify[pathId]))
        return;

    for(var id in pathEntry.toNotify)
        pathEntry.toNotify[id].pathActivated(pathId);
}

// This function should be called when a path node becomes inactive 
// (both the 'trace' and the 'subTree' becomes unset). It then notifies
// all registered object of this change.

InternalQCMIndexer.prototype.notifyPathDeactivated = 
    internalQCMIndexerNotifyPathDeactivated;

function internalQCMIndexerNotifyPathDeactivated(pathNode)
{
    var pathId = pathNode.pathId;
    
    var pathEntry;
    
    if(!this.pathActiveNotify || !(pathEntry = this.pathActiveNotify[pathId]))
        return;
    
    for(var id in pathEntry.toNotify)
        pathEntry.toNotify[id].pathDeactivated(pathId);
}

///////////////
// Debugging //
///////////////

// This function returns a DebugInternalTo object representing the node
// structure stored in the indexer under the given path and the data 
// element IDs in 'elementIds' (an array of element IDs). The element IDs
// should all be lowest data element IDs at the given path.
// If 'elementIds' is undefined, this returns with the structure under all
// nodes at the given path node. If pathId is undefined, the root path ID is
// assumed.

InternalQCMIndexer.prototype.debugGetDataUnder = 
    internalQCMIndexerDebugGetDataUnder;

function internalQCMIndexerDebugGetDataUnder(elementIds, pathId)
{
    var debugObj = new DebugInternalTo(this.qcm);
    debugObj.setDataElementTable(this.getDataElements(), pathId);

    if(pathId == undefined)
        pathId = this.rootPathNodeId;
    
    if(elementIds === undefined) {
        var pathNode = this.pathNodesById[pathId];
        if(!pathNode)
            return debugObj;

        elementIds = [];
        pathNode.nodes.forEach(function(entry, elementId) {
            elementIds.push(elementId);
        });
    }
        

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        
        var elementId = elementIds[i];

        this.debugAddDataFromPathNode(this.pathNodesById[pathId], 
                                      elementId, debugObj, pathId);
    }

    return debugObj;
}

// this is an auxiliary function to implement the recursive part of
// debugGetDataUnder(). It adds to debugObj (a DebugInternalTo object)
// the terminal values stored at 'pathNode' and all its children under
// the element ID 'elementId' and its children. The path with which each 
// value is added to debugObj is the suffix path of 'pathNode' relative 
// to the prefix path 'prefixPathId'. 

InternalQCMIndexer.prototype.debugAddDataFromPathNode = 
    internalQCMIndexerDebugAddDataFromPathNode;

function internalQCMIndexerDebugAddDataFromPathNode(pathNode, elementId, 
                                                    debugObj, prefixPathId)
{
    var entry = pathNode.nodes.get(elementId);

    if(entry === undefined || this.isOperatorType(entry.type)) {
        // check whether there are children of the given data element ID
        // at this path.
        var elementEntry = this.dataElements.getEntry(elementId);
        if(!elementEntry || !elementEntry.children || 
           !elementEntry.children.has(pathNode.pathId))
            return;
        var _self = this;
        elementEntry.children.get(pathNode.pathId).ids.
            forEach(function(t,childId){
                _self.debugAddDataFromPathNode(pathNode, childId, debugObj, 
                                               prefixPathId);
            });
        if(entry === undefined)
            return;
    }

    if(entry.key !== undefined)
        debugObj.addValue(entry.key, entry.type, elementId, 
                          this.qcm.diffPathId(pathNode.pathId, prefixPathId));

    for(var childId in pathNode.children) {
        this.debugAddDataFromPathNode(pathNode.children[childId], elementId, 
                                      debugObj, prefixPathId);
    }
}
