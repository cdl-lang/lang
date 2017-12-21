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

// This is a derived class of the internalQCMIndexer. This derived
// class allows various function applications to inject their result
// into this indexer (so that for the consumer of this indexer's
// services it would seem as if the result of that function
// application is part of the data in this indexer). Where multiple
// such mappings overlap (map to the same place) the data is merged
// (based on priorities and identities). Not all of the data must
// necessarily be copied into this indexer. This depends on the needs
// of the modules making use of the services of this indexer.
//
// There are several ways to update the indexer data:
// 1. Through an 'extracting function': such a function extracts its
//    result from an indexer (any indexer, possibly this indexer itself).
//    The result of such a function is defined by one or more
//    'projections', each defining a source indexer, a path in that 
//    indexer and a set of data element IDs at that path. When several
//    projections belong to the same function application, they should
//    all have the same source indexer and may provide additional information
//    to allow the merge indexer to combine the different projections
//    properly. 
// 2. Through a 'constructive function': such a function needs to construct
//    its result (e.g. a 'plus' function needs to construct the result,
//    as it is usually not equal to any of its input). Such a function
//    must describe its result fully. A full description would consist
//    of a data element table and a set of terminal updates (terminal value +
//    path ID + data element ID). In case all data elements are at the 
//    root path, the data element table is not required. In case the
//    result is simply a single terminal (at the root path) also the path ID
//    and data element ID is not required.
//
// Every such function application must register into the indexer (in case of
// a multi-projection, each projection must be registered separately). It must 
// indicate he mapping between the path(s) in the source indexer and the 
// path in the target indexer (the merge indexer) and (if it does not place 
// the result under the root path) a way to determine the dominating data 
// nodes under which to place the result. Each such mapping must also have 
// a priority, to allow solving conflicts in case multiple values are mapped 
// to the same target node.
//
// An extracting function may indicate more than just one source path and one
// target path, but indicate a mapping also to (some of) its prefix paths.
// This allows (in a way which will be explained below) for several 
// functions extracting from the same indexer to combine their extractions
// into one coherent result, consistent with the structure of the source.
// This is mainly used in multi-projection queries. In addition, this allows
// multiple nodes from the source indexer which have the same identity to
// be collected under a single node with that identity in the target
// indexer.
//
// Since data is added to the indexer, we must know under which data elements
// to store this data. There are several possibilities:
// 1. Specify mappings for all prefix paths of the target path, up to 
//    the root path. In this case (as will be explained below) the data 
//    elements at the root path dominating the result will be constructed 
//    based on the source indexer from which the extracting function 
//    extracts its result.
// 2. Specify the identity of the nodes under which the result needs to
//    be inserted. This identity may or may not depend on the parent 
//    (in the source indexer) of the source node being mapped.
//    This identity is then compared with the identity of nodes in the 
//    the target indexer at the prefix path of the path at which the
//    result is inserted (for more details, see below). In some cases,
//    these identities may be explicit data element IDs (if these are
//    known to the mapping).
// 
// It should be noted that the identities are often simply the data 
// element IDs. In such cases, the dominating nodes can be located
// directly, without going through the identity tables. 
// 
// Extractive Function Interface
// =============================
//
// This indexer receives notifications either from the result node or 
// the generating projection nodes (in case of a projection) of data 
// elements added or removed from the function result. The indexer must 
// then incorporate this data into its own data. Since the data is 
// extracted from an indexer (possibly this indexer itself) this is based on 
// a translation of the paths and data elements of the indexer 
// from which the result was extracted into paths and data elements
// in the target indexer (this indexer). Below we will refer to these as 
// the 'source indexer' (the indexer from which the result 
// was extracted) and the 'target indexer' (the indexer into which the result 
// is written - the functionality implemented here).
//
// Once a translation of paths and data elements is constructed, 
// the target indexer can support the requirements of the indexer base class
// (e.g. determining the terminal values under each path and data element)
// by reading the corresponding information from the source indexer.
// 
// Path Translation (Extractive Functions)
// =======================================
//
// The path translation is determined by the extracting function. Sometimes, 
// several extracting functions are actually part of one function application,
// for example, in the case of multi-projections where each terminal 
// projection is registered here as a separate extracting function. We will 
// refer to these as projections inside a single function application. In these
// cases, the mappings are determined for these projections
// together, as these mappings allow their results to be combined correctly.
// This translation is registered for each projection separately and is
// registered to the target indexer via a 'mapping' array which has the
// following format:
// [<target path ID 1>, <source path ID 1>,...., 
//                              <target path ID n>, <source path ID n>]
// where each source path ID i is a proper (but not necessarily immediate) 
// prefix of source path ID i+1 while every target path ID i is the immediate
// prefix of target path ID i+1. <target path ID i> is the path (in the 
// target indexer) to which source path i should be mapped to. 
// The path <target path ID 1> may, but does not 
// need to, be the root (empty) path. If it is the root path, the data 
// element IDs under which the result is to be placed do not need to 
// be specified. These data element IDs are then generated based on the data
// extracted from the source indexer.
//
// We will refer to the paths with ID <source path ID i> as the explicit source 
// paths of the mapping (usually denoting them by s1,...,sn) and to the 
// paths with ID <target path ID i> as the explicit target paths of 
// the mapping (usually denoting them by t1,...,tn). s1 is the minimal 
// explicit source path and sn is the maximal explicit source path. We will 
// usually refer to these as the minimal and maximal source paths. Similarly, 
// t1 and tn are the minimal and maximal target paths.
// 
// Paths which extend the maximal source path sn will be referred to as 
// 'extending source paths' and paths extending the maximal target path
// tn will be referred to as 'extending target paths'. The mapping
// maps each sn.p (the concatenation of path p to path sn) to tn.p.
//
// Often we do not need to distinguish between explicit and extending 
// source and target paths and will therefore simply refer to 
// source paths and target paths. However, the minimal and maximal 
// source and target paths always refer to the explicit source and 
// target paths. 

// There are no requirements on the relation between the mappings of 
// different extracting functions. This means that two paths in 
// the same source indexer can be mapped by different extracting functions 
// to the same path in the target indexer or that two extracting functions
// map the same path in the same source indexer to two different
// paths in the target indexer. In these situations, some extra data element
// allocation is required to keep the mappings apart (see more below).
//
// Identities
// ==========
//
// See IdnetityIndexer.js for a general introduction to identities.
//
// A mapping function defines the base identities of the data elements
// it maps. These are the identities which will be stored in the
// target indexer as base identities. The mapping function may provide
// (upon registration) an identificationId which provides an
// identification of the data elements mapped by this mapping from the
// source indexer (this usually defines an explicit identity for nodes
// at the one path, possibly the minimal source path of the mapping or
// its prefix and falls back to the base identity of the source
// indexer for other data elements).
//
// Finding Dominating Nodes by Identity
// ------------------------------------
//
// Given an identity and a path in the indexer, one can request the data nodes
// in the indexer under the given path whose data element ID has a given
// identity and which can dominate lower nodes (there may be multiple 
// such nodes, or none, but, most typically, exactly one). When adding nodes,
// this allows us to determine the node dominating them not by specifying
// a data element ID, but by specifying their identity. This identity may
// be just the data element ID, but may also be the data element ID of 
// their parent (in case of singleton ordered sets) or some completely other 
// identification. The requirement that the nodes 'can dominate lower nodes' 
// allows nodes to define themselves as terminal nodes which do not allow 
// adding dominated nodes under them based on identification (it is still 
// possible to add nodes under them based on explicit data element ID). 
// Typically, adding dominated nodes based on the identity of the parent node
// will be used for merging (see below) so this allows blocking of merging
// of a lower priority tree structure under a higher priority parent node
// while still allowing for the high priority structure under this 
// node to be preserved (this implements the Atomic() directive).
//
// A special case is where the nodes in the target indexer represent
// not the mapping of specific nodes in the source indexer but
// nodes representing an identity (see 'identity groups' below).
// In this case, the node created for a certain identity is merged
// under a node whose identity is determined by the nodes inserted under it
// (see more below).
//
// To allow dominating nodes to be located based on their path and the
// base identity of their data element ID, each path node holds a 
// PathNonTerminals object, which stores the non-terminal nodes at that path
// indexed by their domianting node ID (unless they are at the root path)
// and their identity. Non-terminals are stores both under their base 
// identity (in the target indexer) and any additional identities 
// defined for them by the target identification of the relevant mappings
// (that is, mappings which may insert nodes under these non-terminals).
// See pathNonTerminals.js for more details.
//
// Operator nodes (which are also non-terminals) are stored in a separate
// PathNonTerminals table than other non-terminals. This is because 
// the nodes merged under them are nodes at the same path as the 
// operator node and not at a child path (as is the case with standard
// non-terminals).
//
// Merging
// =======
//
// Each mapping has a priority. When multiple mappings map nodes under 
// the same parent node, the mapping takes their priorities into account
// in order to determine which nodes should be inserted under the common 
// parent. Only the mappings of the highest priority (under a specific node)
// add their values under that node. If there are multiple mappings with 
// maximal priority, all their values must be mapped and this requires 
// the creation of data elements to distinguish between the values (this is 
// even if the source node is not a data element node).
//
// We will say that a source node was merged under a dominating node if 
// the mapping required it to be mapped under that domianting node, whether
// a node with a higher priority blocked that mapping or not. We will
// say that the node was mapped (under a certain dominating node) if a
// target node has been created for it (meaning that there was no conflicting
// node with a higher priority) and will say that it is unmapped if
// a conflicting node with a higher priority blocked its mapping. 
//
// The lower priority source node, which were merged as unmapped, are stored 
// in a table (under the path node) indexed by parent base identity and 
// then sorted by priority. When the higher priority nodes are removed 
// from under a node with a given identity, the next level priority nodes 
// are mapped under that node.
//
// When a mapping maps a data node, we first check whether the parent node
// (at the source) was also mapped. If it was, we insert the child node
// under the node(s) the parent was mapped to. If it wasn't, we try to add 
// the child node under parent nodes with the same identity as its parent node.
// If its parent was not mapped (whether because it is not at a path which 
// is mapped or because its priority was lower than some other mapped node
// with the same target parent node) then we look for a target parent node
// based on the identity of the parent (in a way which may depend of the
// definition of the mapping).
//
// Note that even if the source parent node was mapped, the child node is
// not guaranteed to be the highest priority node mapped under it (e.g.
// a write operation may generate a higher priority value under the parent 
// node at the path of the child).
// Therefore, it is always required to check whether the node is of the 
// highest priority mapped under a given parent.
//
// Mapping Nodes (extracting Functions)
// ====================================
//
// Mapping Groups
// --------------
//
// When a node is mapped from a source indexer to the target indexer,
// we must determine which parent node(s) to insert it under and
// whether there are any other nodes mapped to the same path under the
// same parent(s) (whether by the same mapping or another mapping). If
// there are such nodes and they have a lower priority, they become
// 'unmapped' while if they have a higher priority, this node is
// merged as 'unmapped' (and not added as a node to the target
// indexer). If there are such additional nodes with the same priority
// (either mapped by the same mapping - in case of an ordered set
// being mapped, or mapped by another mapping with the same priority)
// and this priority is maximal among these mapped nodes, data element
// must be created for this child node, to allow all nodes of equal
// priority to store their values side by side.
//
// It may happen that two mappings define exactly the same mapping
// (e.g. in a projection o({ a: _, b: _ }, { a:_, c:_ }) there are two
// mappings created for the projection 'a: _' but these perform an identical
// mapping, though not necessarily of the same set of nodes). To avoid 
// multiple nodes being created in such cases, we collect such identical
// mappings into groups. Each node mapped by any of the mappings in a group
// is mapped only once by the group (no matter how many of the group's 
// mappings mapped the node). If a mapping maps more than one explicit source
// path, it will belong to several such groups (one for each target path).
// 
// A mapping group is identified by the following parameters:
//
// For all groups this depends on:
// 1. The explicit source path
// 2. The explicit target path
// 3. Whether the target path is the maximal target path for this mapping
//
// For the the minimal target path this also depends on:
// 1. The source indexer
// 2. The priority of the mapping
// 3. The parent identification defined by the mapping (this 
//    consists of two IDs: the source identification ID and the 
//    target identification ID, see 'Identifying the Dominating Parent(s)'
//    below).
// 4. Whether the group is an identity group or not.
//
// For the groups of a non-minimal target path:
// 1. The group of the previous explicit target path in the mapping
//
// Source paths of a group:
//
// Every group maps nodes from its explicit source path. If, however,
// the explicit source path of the group is the maximal source path of
// the mappings, the group is also responsible for mapping nodes from
// all extension source paths (paths extending the maximal source
// path).
//
// Target paths of a group:
//
// A group maps nodes from its explicit source path to its target source
// path. In case the explicit source path is the maximal source path,
// each extension source path is mapped to the corresponding extension 
// target path (if sn and tn are the maximal source and target paths,
// sn.p is mapped to tn.p). It is possible to specify certain paths in
// the target indexer as 'non-extension' paths, in which case
// this extension process does not take place for these paths. This means
// that if the path tn.p is marked as a non-extension path, a mapping
// which maps sn to tn is not extended to map sn.p to tn.p. To map
// sn.p to tn.p one needs to explicitly add such a mapping.
//
// The Mapped Nodes
// ----------------
//
// Each mapping function notifies when it adds or removes nodes ('matches')
// at the maximal source path. By the node domination in the source
// indexer, this defines the set of nodes mapped by the mapping function
// also at other source paths: for shorter source paths these are the 
// nodes at those paths which dominate the nodes added by the mapping
// (or, in the case of an identity group - the identity of the nodes
// being mapped) and for extension paths these are the nodes at the extension
// paths which are dominated by the nodes added by the mapping.
//
// When nodes are added from the maximal source path, the nodes dominating
// them at shorter source paths are also added immediately (this is needed,
// as we need to hang the nodes under some dominating node at the 
// corresponding shorter target paths). Nodes from the extension paths
// are mapped only when path tracing is requested on the target extension
// path or the mapping of the nodes is inside a retrieved sub-tree in the
// target indexer (more on this below).
//
// Identifying the Dominating Parent(s)
// ------------------------------------
//
// Assume that we have determined that a node d in the source indexer
// needs to be mapped by a certain mapping. This node d could either
// have been added by the mapping at the maximal source path of the mapping
// or is at an extension source path and is dominated by a node mapped
// by the mapping at the maximal source path. 
//
// For nodes at extension paths we usually check whether there is any
// need to map them (whether the target node would be traced in the
// target indexer).  This is an optimization (to avoid unnecessary
// mapping) but is not required for the correctness of the
// algorithm. Therefore, we ignore this issue here (it will be discussed
// further below).
//
// We need to map this node d and all nodes at shorter source paths
// (if any) which dominate it. Some of these may have already been
// mapped. Each of these nodes has a data element ID in the source
// indexer (though only some or none of these nodes need actually be
// data elements). This produces a sequence of data element IDs
// d1,...,dn=d which need to be mapped at the source paths s1,....,sn to
// target paths t1,....,tn (paths ordered in increasing order).  Some
// (or all) of the data element IDs d1,...,dn may be the same.
// Note: we do not assume here that sn and tn are the maximal source
// and target paths: these may also be extension source and target paths.
//
// The processing of the update begins by looking up the nodes
// dominating the added node at each of the source paths (this is done
// by cycling up the data element chain and setting each data element
// ID as the source element ID at source paths which are
// dominated by that data element ID but not by any of its children
// (Note: for operator nodes, whose handling is described below, this
// ensures that when mapping an operand node, not the operator node dominating
// it, but the operand node itself will appear in this list).
//
// The nodes are then mapped from highest to lowest (that is, from d1 to dn).
// When adding each di, we need a set of dominating nodes Di which identifies
// the parent nodes under which di should be merged. Since di is mapped to
// the path ti Di should be a subset of nodes at p(ti), the immediate prefix 
// of the path ti.
//
// The only exception to this rule is if t1 is the root node. In this case,
// ther is no need to specify the parent node under which d1 is to be inserted.
//
// Every mapping may optionally provide two identification IDs: one is 
// an additional identification in the source indexer and the other is 
// an additional identification in the target indexer. Each of these
// may define an identity to a subset of data elements in the source
// or target indexer (respectively). The identity by the mapping of a 
// data element in the source indexer is then its identity by the additional
// identification defined for the source indexer, if deifned, and the base 
// identity (in the source indexer) if not. The identity by the mapping of a 
// data element in the target indexer is defined similarly.
//
// These idnetities are used in determining the sets Di.
//
// To determine D1 (in case t1 is not the root path) we look at the
// immediate parent of the source node d1 and get its identity by the
// mapping (as defined above). This is identity c. If d1 has no
// immediate parent (because it is at the root path) we expect the
// additional identification to be defined for the mapping an to
// return an identity for the 0 data element ID.
// We then look at the prefix path of the minimal target path for non-terminal 
// nodes (nodes which allow merging under them) which have identity c by 
// the mapping (this is now calculated in the target indexer). These nodes 
// are the dominating nodes under which d1 needs to be mapped.
//
// Note that this set of dominating nodes may change dynamically. Therefore,
// we record the fact that node d1 needs to be inserted under identity c and
// when nodes with the appropriate identity are added at 
// the apropriate prefix path (or the identity of existing nodes changes)
// the process described below will be applied to merge the source nodes
// d1,...,dn under those nodes too.
//
// For i > 1 the set of dominating nodes Di is determined by the mapping of
// di-1. The set Di includes every node di-1 was mapped to (that is, there
// was no conflicting higher priority node) at the target path ti-1.
// In addition, for every dominating node e in Di-1
// such that di-1 was unmapped under e (there was a higher priority conflicting
// node) the set Di includes the nodes at the target path ti-1 which 
// are non-terminals and have the same identity by the mapping as di-1.
//
// Having identified the parent node(s) under which to insert the node
// being mapped, we need to check whether other nodes are inserted at
// the path ti under each of the parent nodes. After
// retrieving the nodes at this path dominated by each parent, we
// check which group mapped them and the priority of that group (it is
// enough to check only one node, as all these nodes must be mapped by
// groups of the same priority).
//
// If the already mapped nodes belongs to a group with a higher priority
// than the current group, the node di is stored as an unmapped
// node (when the higher priority nodes are removed, it may become
// active).
//
// If the already mapped nodes belong to a group with a lower priority
// than the current group, these nodes are made unmapped. The node di can 
// then be mapped to the path ti.
//
// Finally, if there are no other child nodes of the parent or the already 
// mapped children have the same priority as the current group, di is mapped.
// In case there are addition nodes mapped under the parent, we must 
// create data elements to make sure these nodes can be placed side by side.
// This is described below.
//
// The set Di+1 is implicitly available for each node di merged, whether added 
// as a mapped or unmapped node. In this way, when additional children of di
// are added, the process can begin at Di+1 and the child of di. 
//
// This means that when we receive a node dn to be added, we may not
// need to perform the full process described above, beginning with
// d1, as some of the nodes in d1,...,dn may have already been
// added. We start by constructing the domination chain backwards:
// dn-1, dn-2, .... until we find a node di which was already
// mapped. The stored entry for that node provides us with the set
// Di+1 generated when adding the node. We then can perform the
// process described above beginning with Di+1 and di+1,...,dn.
//
// Mapping a Node
// --------------
//
// Assume that in the process described above it has been determined that
// source node di should be mapped to target path ti under parent node e
// (in p(ti) - the immediate prefix of ti). We then need to determine
// the data element ID to assign to the mapped node. This assignment must
// be made such that (in decreasing order of importance):
// 1. There is no conflict with other nodes.
// 2. The allocation does not need to be changed later (e.g. first creating
//    a non-data-element and then having to upgrade it to a data element
//    when siblings have to be added).
// 3. Not too many unnecessary data element nodes are created in the target
//    indexer.
// 4. To the extent possible, the target data element ID is equal to di
//    (the source data element ID). If this can be made to hold for
//    all nodes mapped by a certain mapping (and often it can) this saves
//    the need to perform data element ID translation. This is a weak 
//    requirement.
//
// We first check whether the node was already mapped by the same group.
// If it was, its mapped node already exists and there is nothing more to do.
// 
// If the node was not yet mapped, we check whether there are other nodes
// (with the same priority) already stored under the parent node (this needs
// to be checked at the path ti). If there
// are, a data element needs to be created for the newly mapped nodes.
// If the already existing node is not a data element (it must then be
// a single node) it must be replaced with a data element.
// The data element is created at the path ti.
//
// Even if there are no other nodes under the same path and parent, we 
// may want to create a data element in cases where it is likely that there
// soon will be added another node under the same path and parent.
// This is only an optimization, as an extra data element where it is not 
// needed is not incorrect, just wasteful, and a non-data-element can always
// be upgraded to a data element when needed (though this is a slightly
// expensive operation). The following two criteria are considered
// an indication that it may be beneficial to create a data element:
// 1. There are multiple groups with the same priority mapping to this
//    path (the target path ti). This criterion is determined in
//    advance for the groups (as it does not actually depend on the
//    nodes being mapped). Such groups will be referred to as
//    'obligatory data element groups'. All nodes mapped by such a
//    group are mapped to data elements.
// 2. The identity of the source node, as determined by the mapping,
//    is not the same as the identity of the dominating target node.
//    This implies that the source node behaves like a data element
//    (only a data element along a domination path can change the 
//    identity). While it is possible to give a data element and its 
//    parent data element the same identity, this is very unlikely to happen
//    except for the case where the child data element has no siblings.
//    Therefore, this is a good indication that multiple nodes may have
//    to be mapped here under the same domainting node.
//    Moreover, when the identities differ, we need to allocate a new
//    data element for the dominated node so that its base identity 
//    in the target indexer can be made to be the same as its source
//    identity.
//
// If it is decided not to map a node to a data element, it is simply
// inserted under the data element ID of its parent. 
//
// If the node is to be mapped to a data element, we first check whether we can 
// use the same data element ID as the source node (if all nodes are such, this
// saves us the need for looking up the ID translation). If the data element ID
// has not yet been used in the target indexer, it can be used. Otherwise,
// a new data element ID needs to be allocated. If a new data element is 
// allocated, we record the mapping for this mapping group, and
// source data element ID to this new data element. In case the node is
// added under multiple dominating parents, there will be multiple mappings
// for the same group and source data element ID.
//
// The base identity of the new data element is the identity induced
// on the source data element ID by the mapping (that is, either the
// identity assigned to it by the identificationId, if provided, or
// the base identity in the source indexer).
// 
// Handling Operator Nodes
// -----------------------
//
// Operators (such as negation, n(...))  are represented as data nodes
// (either data elements or not) which dominate data elements (the
// operands under the operator) at the same path as the operator node. A
// mapping which maps an operator node is also required to map the
// operand data elements directly under that operator node (all these nodes
// are at the same path). Also, a mapping mapping an operand data element 
// node automatically also maps the operator node dominating it.
//
// This means, for example, that a mapping cannot extract the object
// { a: 1 } from the object { x: n({ a: 1 }) }, since mapping the node
// { a: 1 } automatically implies the mapping of n({ a: 1 }). However, 
// projecting the node 1 out of that same object will not project the negation.
// This is because { a: 1 } and n({ a: 1 }) occupy the same path and 
// therefore cannot be separated while n({ a: 1 }) and 1 do not occupy
// the same path and therefore can be separated by a projection. 
//
// When the process described above comes to map a node, it first
// checks whether it is an operand node. This is done by first
// checking whether the source path carries any operand nodes (this is
// a property of the source path node) and if it does, whether the
// source node being mapped is a data element (at the source path). If
// it is, we then can check whether it is directly dominated by an
// operator node (by getting the parent data element ID and checking
// whether it has a node at the same path). Having determined that the
// added node is an operand node, the operator node has to be mapped
// first. After mapping the operator node (to the same target path),
// the operand it dominates can be mapped under it. This takes place
// only where the operator node is successfully mapped. Where it is
// merged as unmapped, the operands dominated by it are not merged, as
// the operand nodes may only be dominated by the operator node (we do
// not allow the separation of the operator node from the operand
// nodes, see above).
//
// Note that operand nodes (at the source) can never be unmapped. This 
// is because they are mapped with the same priority and to the same
// target path as the operator node dominating them. This means that if 
// there is a node with higher priority at that path, the operator node
// will already be unmapped and the operands will not be merged. 
// While it may be that nodes from another mapping are mapped as operands
// under the mapping of the operator node, these must have a lower priority
// than the operator node (otherwise they will be either merged next to
// the operator, if they have equal priority, or will cause it to be
// unmapped). Therefore, these nodes cannot block the mapping of the 
// original operands of the operator.  
//
// When processing the list d1,...,dn of source nodes, there is one
// source node in the list for every source path of the mapping. Since
// the operator node and operand nodes have the same path, they cannot
// both appear in the list. As a rule, only the operand data element
// will appear here (and when it is mapped, the operator node will be
// mapped with it, as described above). The only exception is when the
// operator node is the lowest node being added by the mapping, that
// is, dn. In this case the operand node dominated by it is not part
// of the update and the operator node is added as a normal node
// (later, operand nodes it dominates may be mapped and the node will
// be added again as part of that operation).
// 
// Merging with Operand Nodes
// --------------------------
//
// While a mapping is not allowed to separate an operator from its
// operands in the source, an operator is considered a non-terminal
// node dominating its own path. Lower priority groups can then merge
// their nodes under the operator, thus becoming the operands of this
// operator. For this to succeed, operator must be empty in
// the higher priority group from which it is mapped since otherwise
// the original operands will block merging of the nodes from the 
// lower priority group. 
//
// For example:
//
// { x: n() } (high priority) and { x: o(1,2,3) } (low priority)
//
// will be merged into:
//
// { x: n(1,2,3) }
//
// but
//
// { x: n(9) } (high priority) and { x: o(1,2,3) } (low priority)
//
// will be merged into:
//
// { x: n(9) } (as the high priority 9 conflicts with 1, 2, 3).
//
// Technically, in order to be merged under an operator, the lower
// priority node must have the data element ID of the operator
// in the list of dominating nodes under which it should be merged. 
// Often, this data element ID belongs to a data element allocated at 
// a higher node (in cases where no new data element is created for 
// the operator node). However, in cases where the operator node is 
// a data element, the functions which determine the list of dominating 
// nodes under which the lower priority nodes need to be inserted need to 
// be able to find the data element ID of the operator based on the identity
// of the lower priority node and the merging of its parent node.
// For this purpose, we store all operator nodes which are data elements 
// in special 'non-terminal' tables. These tables have exactly 
// the same structure as those for standard non-terminals, but they 
// are stored on the path node where the operands are to be inserted 
// rather than on the prefix path node.
//
// When a node is added as unmapped due to a conflict, it uses its
// identity and dominating node (under which it should have been inserted)
// to retrieve a set of non-terminal nodes at the path node where it was
// unmapped under which its children will be inserted. In case the path
// node has data element non-terminal operators, this process also applies 
// to this table of data-element non-terminal operators. However, 
// if dominating nodes are found in this table, they do not apply to 
// the children of the unmapped nodes, but to the unmapped node itself, 
// which is now inserted under those dominating nodes. The process then 
// continues (to the children of the unmapped node) both under the operators 
// and under the non-operator dominating nodes found based on the identity 
// of the unmapped node. In case it is not possible to merge the unmapped 
// node under the operator node, the unmapped node becomes unmapped also 
// under the operator node. It is then stored in the same unmappedNodes
// table as its original unmapped instance, but under a different
// dominating node (the operator node in this case).
//
// Identity Groups
// ---------------
//
// When registering a mapping, one may request the minimal group of the
// mapping to be an 'identity group'. In that case, there are two
// possibilities: either the identity group is also the maximal group
// or the identity group has the same source path as the next group
// and its target path is the prefix of the target path of the next group.
// The minimal group does not map nodes from its source path but, instead,
// generates nodes with the same identity as the nodes mapped by the group
// of the next explicit target path (which has the same source path).
//
// An identity group receives as input source nodes, but then converts
// them into virtual source nodes, which will be referred to as identity
// nodes. All source nodes with the same identity (and in case the target
// path of the identity group is not the root path, also the same parent
// identity) are mapped to a single identity node. Once this mapping took
// place, these identity nodes are merges to the target indexer, instead
// of the original identity nodes. In this way, multiple source nodes
// with the same identity are collapsed under a single node (and identity
// nodes are created for exactly those nodes which appear in the source
// of the mapping).
//
// The target nodes to which the identity nodes are mapped are non-terminal
// nodes which can take one of two value:
// 1. If the identity they represent is the compression of a simple value,
//    this simple value is the value of the target node.
// 2. Otherwise, the value of the target node is an attribute-value. 
// If the identity group is the maximal group, the mapping does not
// extend to extension paths (one can, however, merge nodes from other
// mappings under the mapping fo the identity nodes, since they are
// non-terminals).
// If the identity group is not the maximal group, the next group
// must have the same source path (and therefore maps the same
// source nodes) and the target path of the identity group must be the prefix  
// of the target path of the next group.
//
// When both the source path and the target path of the identity group
// are not the root path, the dominating nodes under which the
// identity nodes need to be merged is determined by the identity of the
// parent of the source nodes which are mapped to each identity node.
// This means that each identity node now represents two identities:
// that of the source node and that of the parent of the source node.
// The identity of the parent source node determines under which nodes
// to merge the identity node and the identity of the source node
// determines the identity of the target node of the identity node.
//
// Path Tracing and Sub-Tree Tracing
// =================================
//
// Below we will refer to path nodes which either have path tracing
// turned on or have sub-tree mode turned on as 'active' path nodes.
// A path node has path tracing turned on if some query calculation
// node is registered to it. A path node P has sub-tree mode turned
// on if either one of the data nodes at the path node P is the root
// of a monitored sub-tree or if there is a node at the prefix path node
// of P which is in a monitored sub-tree and has an attribute which leads
// to the path node P.
//
// A mapping should be added to the merge indexer only when its shortest
// target path (the target path of its minimal group) is active.
//
// When a mapping is registered, groups are created for it (those
// groups which do not already exist). If new, a group then registers
// itself to all its explicit target paths. If maximal, it then
// continues to register itself to extension target paths which are active.
// If an extension target path later becomes active, the group will be
// registered to it.
//
// Path Tracing 
// ------------
//
// Mapping query calculation nodes registered to the source indexer of
// a group are created to update target path nodes of a group with
// changes in the source indexer. Each query calculation node is 
// created for a specific source path of a specific mapping group.
// It is registered as a query calculation node to the source path,
// providing the target indexer with node and key updates.
// Since the mapping itself updates the target indexer when nodes are 
// added or removed from the mapping, only extension target path need 
// their mapping query calculation node to update them with nodes
// added and removed. The maximal target path needs the mapping 
// query calculation node only to receive key updates. Therefore, all 
// other paths do not have mapping query calculation nodes created for them.
//
// Such query calculation nodes are only needed if the target path which 
// they update has path tracing turned on.
// As path tracing is turned on and off, the mapping query calculation
// nodes may be created and destroyed.
//
// Sub-Tree Tracing
// ----------------
//
// When target nodes are inside retrieved sub-trees (in the target indexer)
// we must register sub-tree monitoring on their source nodes so as to 
// receive updates for the sub-tree under the source node. We will refer
// to this as a mapping sub-tree monitor (or just 'mapping monitor' for 
// short). This works in a similar way to the mapping query calculation 
// node, by providing the target indexer with updates for relevant changes 
// at the source.
//
// Mapping sub-tree monitors only need to be registered at the maximal
// source path or at an extension source path (the mapping of nodes at
// non-maximal explicit source paths is derived from the mapping at
// the maximal source path). When one sub-tree is a sub-tree of
// another sub-tree (that is, its root is an internal node of the
// other sub-tree) there is, of course, no need to monitor both trees
// (as the larger tree will also retrieve the nodes of the smaller
// sub-tree).
//
// Mapping sub-tree monitors need to be registered on the source nodes of 
// mapped target nodes, as follows: 
// 1. When a target node at the maximal target path of its group
//    is inside a monitored sub-tree, we register a mapping sub-tree monitor
//    on the source node at the source path of the mapping. 
// 2. When a target node at an extension target path of its group is 
//    at the root of a monitored sub-tree and this is the only monitored
//    sub-tree it belongs to, we register a mapping sub-tree monitor
//    on the source node at the source path of the mapping. The condition
//    here excludes cases where the node is inside a monitored sub-tree
//    rooted at a higher node because in such a case the source node
//    would already be inside a mapping sub-tree monitor (registered for
//    the higher sub-tree root).
// To decrease the number of unnecessary sub-tree monitors and the 
// number of superfluous notifications they generate, we do not register
// a sub-tree monitor if the monitored target node does not have attributes
// and the path has tracing (in this case, the path tracing will provide
// all information needed). This means, however, that the merge indexer
// needs to track the addition of attributes under nodes which are part
// of a monitored sub-tree. This is provided by a base indexer notification.
//     
// Mapping sub-tree monitors must also be registered on unmapped nodes
// (at the maximal target path and extension target paths)
// if those have the same identity as non-terminal target nodes at 
// the same path node which are inside a monitored sub-tree. This 
// is because the children of such unmapped nodes need to be added to 
// the target indexer as candidates for merging under the non-terminals
// with the same identity.
//
// Attribute Tracing
// -----------------
//
// Nodes inside a monitored sub-tree must have their attributes updated,
// as the nodes to be included in the monitored sub-tree are determined
// by these attributes.
//
// For node mapped to explicit target paths, the attribute from the dominating
// target node to the mapped node is always added (regardless of sub-tree
// monitoring) as this is determined by the mapping structure and not 
// by the source data. However, the attributes under the target nodes at the 
// maximal target path and the extension target paths are mapped
// from the attributes of the source nodes. These are needed only in case
// of sub-tree monitoring. Therefore, they are added only for nodes
// received through a mapping sub-tree monitor. 
//
// Mapping Registration
// ====================
//
// To register a mapping, one needs to call the function:
//
// <merge indexer>.addMapping(<function result node>, <projection ID>, 
//                            <source indexer>, <path mapping array>, 
//                            <priority>, <source identification ID>, 
//                            <target identification ID>, <is identity>,
//                            <identity only>)
//
// The arguments to this function are:
// <function result node>: this is function result node which performs the
//     mapping. It should have an ID (which is referred to here as the
//     result ID) This ID together with the <projection ID>
//     should uniquely identify the mapping.
// <projection ID>: this is an ID which, together with the function 
//     result ID uniquely identifies the mapping. A single function 
//     result may register multiple mappings to the merge indexer.
//     For example, a multi-projection registers each terminal projection
//     as a separate mapping. The projection ID allows these mappings
//     to be separated.
//     It is possible to have several different function results
//     which make use of the same projection ID. In fact, function results
//     which do no have multiple projection will typically use a 
//     projection ID of 0. This has no consequences for the merge indexer,
//     as the projection ID is never used separately from the function 
//     result ID.
// <source indexer>: this is the indexer from which the mapping extracts
//     its result. This is allowed to be the same indexer as the target
//     (merge) indexer.
// <path mapping array>: this is an array (as described in the section
//     'Path Translation' above) of the form:
//     [<target path ID 1>, <source path ID 1>,...., 
//                              <target path ID n>, <source path ID n>]
//     where each source path ID i is a proper (but not necessarily 
//     immediate) prefix of source path ID i+1, while each target path ID i 
//     is the immediate prefix of target path ID i+1. <target path ID i> is 
//     the path (in the target indexer) to which source path i should 
//     be mapped to. The path <target path ID 1> may, but does not 
//     need to, be the root (empty) path.
//     Calling this function with an empty <path mapping array> will remove
//     this mapping from the merge indexer.
// <priority>: this is the priority of the mapping. This should be a number.
//     Nodes mapped to the same target path with the same priority
//     will be placed next to each other. Therefore, a multi-projection
//     should assign all its terminal projections the same priority.
// <source identification ID>: this is an optional argument.
//     This ID is the ID of an additional identification (see above)
//     in the source indexer. This is applied to the parent of a source 
//     node when the source node needs to be merged under another node
//     which is not the mapping of its parent source node. This happens
//     in several situations:
//     1. When the shortest source pathe of the mapping is not the 
//        root path. In this case, the parent source nodes are not
//        mapped and we need to determine under which node to insert
//        each mapped node.
//     2. When the parent node of a source node is unmapped. In this case,
//        we want ot merge the child node under a dominating node
//        (in the target indexer) which has the same identity as the
//        node's unmapped parent. 
// <target identification ID>: this is an optional argument.
//     This ID is the ID of an additional identification (see above)
//     in the target indexer. In cases where nodes mapped 
//     by the mapping need to be merged under a domianting node 
//     based on identity (see <source identification ID> to see when this
//     happens) this is the identification applied to the potential 
//     dominating nodes to determine whether the source node should
//     be mapped under them. The source identitifcation of the 
//     source node must then agree with the target identification of
//     the dominating node to allow the source node to be merged 
//     under the target node.
//     If this argument is omitted, the base identity in the target 
//     (merge) indexer is used.
// <is identity>: when this flag is true, the miminal group of this mapping
//     should be an identity group (see above). If <identity only> is
//     not true or when the mapping array has a length greater than two
//     (more than one group) the identity group is prefixed to the
//     mapping before the first pair of target and source paths. The
//     source path of the identity group is the same as that of the
//     first mapping in the mapping array and the target path is the
//     prefix of the first target path in the mapping array
//     (therefore, in this case one must make sure the first target
//     path in the array is not the root path).
//     If <identity only> is true and the mapping array has length 2,
//     no extra group is added and the only group specified by the
//     mapping array is made into an identity group.
// <identity only>: this influences the choice of the identity group
//     in case the mapping array specifies only one group (has length 2).
//     See <is identity> for more details.
//
// When this function is called, the merge indexer creates the appropriate
// groups for this mapping (some of these groups may already exist).
// If the same <function result ID, projection ID> pair is already 
// registered to the target indexer, the mapping is removed from the 
// mapping groups it no longer belongs to (and this may result in the
// destruction of these groups if they do not contain any other mapping).
// This function does not update any matches. It is assumed that:
// 1. If this mapping was already registered before and any of its properties
//    (paths, priority or identifications) have changed, then all its
//    matches were removed before this function is called.
// 2. That all existing matches of these mappings are added after this 
//    function is called.
//
// Reference Counting
// ==================
//
// Since multiple mappings may map the the same source node to the 
// same target node, the target nodes must have a reference count.
// Nodes mapped from extension paths always have a reference count of 1
// because they are mapped only once for all mappings in the group, no 
// matter how many mappings mapped their dominating node. These nodes
// remain in the target indexer until they either disappear from the
// source indexer or until their dominating node mapped from the 
// maximal source path is removed. Therefore, reference counting on 
// these nodes is not really required (but we store a reference count of 1
// so as not to have to check for each node whether it has a reference
// count or not).
//
// For nodes mapped to the target path of a non-maximal group,
// the reference count is equal to the number of nodes they dominate
// mapped by mappings in the group mapping this node. Note that nodes
// merged under this node by mappings from other groups do not increase
// the reference count. This is because these nodes do not force the 
// existence of this node: they are inserted under the node only if it
// exists as a result of a mapping in its own group.
//
// For nodes mapped to the target path of a maximal group, the
// reference count is equal to the number of mappings in the group
// which mapped this node.
//
// When the same source node is merged under different dominating nodes,
// the full reference count is stored on each of these nodes.
// When a merged node is stored as unmapped, we store its reference count
// in the unmapped nodes table. If this node was not mapped from the
// maximal source path node or if it is an operator and was mapped as
// a result of mapping an operand under it, the unmapped nodes table
// also stores all the nodes mapped from the maximal source path which 
// resulted in mapping this unmapped node. For each of these nodes,
// its reference count is stored (and incremented or decremented as needed).
//
// When a node is unmapped, its chidlren are also stored in a table, to allow
// them to be merged under nodes of a different table. Here, too, as in the
// case of unmapped nodes, the reference count is stored and, as in 
// the case of unmapped nodes, if the nodes are mapped by a non-maximal 
// group, this table stores all the nodes mapped from the maximal source 
// path which resulted in the mapping of this node. For each of these nodes,
// its reference count is stored.
//
// Implementation
// ==============
//
// This class adds several tables to the base indexer class at the 
// class object level. In addition, this class requires the addition 
// of certain fields to the 'dataEements' structure of the indexer,
// the 'pathNode' object and the individual node entries (in the 
// 'nodes' table of the path nodes). These additions are listed 
// here below.
//
// Tables added to the class object:
// 
// {
//     nonExtensionPathIds: {
//        <path ID>: true
//        ......
//     },
//     mappings: <Map>{
//        <function ID>: <Map>{
//            <proj ID>: {
//                 groups: <the 'groups' array of the maximal group (taken
//                          from its entry in the 'groupById' table below)>
//                 matchesAdded: false|true
//            }
//            .......
//        }
//    }
//    numProjs: <number>
//
//    // groups 
//
//    groupIdByDesc: {
//        <group description string>: <number>
//        .....
//    },
//
//    groupById: {
//         <group ID (number)>: <MergeGroup>
//         .......
//    }
//
//    identityGroupByIdentification: <Map>{
//        <identification ID>: <Map>{
//            <group ID>: <MergeGroup>,
//            .....
//        }
//        .....
//    }
//    groupBySourceIdentification: <Map> {
//        <identification ID>: <Map>{
//            <group ID>: <MergeGroup>,
//            .....
//        }
//        .....
//    }
//    unmappedByIdentification: <Map> {
//        <identification ID>: <Map>{
//            <target path ID>: <count>
//            .....
//        }
//    }
//
//    identifiedByTarget: <Map>{
//        <target ID>: <Map>{
//               <target path ID>: true
//               ......
//            }
//        }
//    }
// }
//
// nonExtensionPathIds: this is a list of path IDs such that the
//    corresponding path node, when created will have its 
//    'nonExtensionPath' property set to true (see the 'nonExtensionPath'
//    property of the path node object for more information).
//    A path ID needs to be added to this list before the corresponding
//    path node is created. The path IDs stored in this table are
//    allocated when added to the table and released when removed from this
//    table (or when the indexer is destroyed).
//    To add paths to this list, use 'addNonExtensionPathId()' (there is
//    no function to remove paths from this list, as, once created,
//    a path will preserve its 'non-extension path' property even if
//    it is removed from this list.
// mappings: this table lists all mappings registered to this merge indexer.
//    Each mapping is stored under the function result ID and
//    projection ID which identify it. It is possible to have several 
//    mappings with the same function result ID and different 
//    projection IDs (for example, in the case of a multi-projection query).
//    The entry for each such mapping holds the following information:
//      groups: an array of the MergeGroup objects for the groups this
//         mapping belongs to. This array is ordered in descending order
//         of source path (that is, from the longest source path to the
//         shortest). In other words, the first entry in this array is
//         the maximal group (the group for the maximal source path) and
//         each subsequent entry is for the prefix group of the previous one.
//         This array is taken from the 'groupSequence' field of
//         the MergeGroup object of the maximal group.
//      matchesAdded: this is a falg which indicates whether any matches
//         were already added by this projection. This is set to false
//         when the projection is first registered and set to true once
//         matches are first added from the projection. Once this flag is set
//         to true, fetching the matches form the projection returns the
//         matches which were added by the projection to the merge indexer
//         (immediately after registration this is not necessarily true).
// numProjs: this is the number of projections stored in 'mappings' (this
//     may be larger than mappings.size, as there may be multiple projections
//     under the same function result).
//
// groupIdByDesc: the attributes in this table are strings which are 
//    group descriptions and the value under each attribute is the group ID
//    (positive integer) assigned to the path partition group with that
//    description. This string is constructed to hold the information
//    described in the section 'Mapping Groups' above. See the 
//    implementation of 'addMappingToGroup()' (below) for the actual 
//    construction of this string.
// groupById:
//    This table stores a MergeGroup entry for each mapping group. See
//    the documentation of MergeGroup for more information.
// identityGroupByIdentification: this is a Map object which stores under
//    each identification ID a list of identity groups which have this
//    identification ID as their source identification.
//    The base identity is stored here under identification ID 0.
// groupBySourceIdentification: this is a Map object which stores under
//    each identification ID a list of non-identity groups which have this
//    identification ID as their source identification.
//    The base identity is stored here under identification ID 0.
// unmappedByIdentification: for each source identification ID, this lists
//    the target path IDs where there are unmapped nodes which may be mapped
//    by a group with the given identification ID. This is updated when
//    a group is added/removed from the target path and there are unmapped
//    nodes stored on the target path or when unmapped nodes are first added
//    to the target path or when the last unmapped node is removed from
//    a target path.
//    The count under every path ID is the number of groups with the
//    given source identification ID.
//
// identifiedByTarget: this table stores the node in the target indexer
//    whose target identity is used in merging. These are non-terminals,
//    both standard non-terminals and data element operators. For each
//    such node, its target ID is registered in the table. Since
//    the same target ID may be used in multiple paths, this also records
//    for each target ID which paths have a non-terminal with this ID.
//    As the target ID + path defines a single node, there is no need to
//    have a reference count here.
//    This table is updated when non-terminals are added and removed. 
//    It is used when the identity of a data element in the table changes.
//
// Additional Fields in the Data Element Table:
// --------------------------------------------
//
// dataElements: {
//     <data element ID>: { // only the additional fields are listed
//         sourceId: <data element ID>
//         groupId: <group ID>
//     }
//     ......
// }
//
// For each data element in the merge indexer this indicates which group 
// performed the mapping whose target this node is and which source
// element ID (in the source indexer) was mapped to this data element.
// These two fields may be undefined for nodes not created as a result
// of a mapping.
// 
// Additional Tables in the Path Node Object:
// ------------------------------------------
//
// Path Node (only additional fields are listed):
// {
//    composedOrderStar: <Map>{
//        <result ID>: <DataResult>,
//        ......
//    }
//    nonExtensionPath: <true|undefined>
//    mappingGroups: <Map>{
//        // for non-maximal groups
//        <group ID>: true
//        // for maximal groups on target paths without path tracing
//        // (but with sub-tree tracing)
//        <group ID>: {
//            sourcePathId: <ID of source path in the source indexer>
//            isExtension: true|false
//        }
//        // for maximal groups on target paths with path tracing
//        <group ID>: <MappingQueryCalc>,
//        ......
//    }
//    dominatedMinGroups: <number>
//    minGroupPriority: <priority>
//    maxGroupPriority: <priority>
//
//    dominatedPriorities: <Map>{
//        <dominating element ID>: <priority>
//        ......
//    }
//    priority: <number>
//
//    // unmapped source node tables
//    unmappedNodes: <UnmappedNodes or UnmappedNodesAtRoot>
//
//    // insertion under non-terminals
//
//    nonTerminals: <PathNonTerminals object>
//    childrenByIdentity: <ChildrenByIdentity>
//
//    // insertion under operators
//
//    numOperators: <number of operators below>
//    operators: undefined || {
//        <data element Id>: true,
//        ......
//    }
//    dataElementOperators: undefined|<PathNonTerminals object>
// }
//
// composedOrderStar: list of DataResult objects registered to this
//   path node which are order* (these make the mapping projections
//   to this path also order*).
// nonExtensionPath: when set to 'true' this field indicates that mappings
//   with a target path at the parent path of this path may not be extended
//   to a target path at this path. This property must be set upon
//   construction of the path node. This is done by the addPath() function
//   when called to add the path for the first time (this property may not
//   be modified after the path node was created). This function looks
//   the path ID up in the 'nonExtensionPathIds' table of this merge indexer.
//   If the path for which 'addPath' was called appears in this list,
//   the 'nonExtensionPath' property of this path node is set to true.
//   One must add a path to 'nonExtensionPathIds' before the path node
//   for that path is created for this property to take effect.
//
//   Example: this property can be used when mapping paths to their
//   'shorthand' paths. For example, we may want to map each path
//   context.x to path x. The can be done by creating a mapping from
//   context to the root path. However, if the path x is a reserved
//   section name (such as 'content') we do not want it to be mapped
//   (because the path 'content' is not a shorthand of the path
//   context.content. In this case, one can define the path 'content'
//   as a non-extension path.
//
// mappingGroups:
//   The group IDs in this Map table are the group IDs of the groups
//   which have this path as an explicit target path or (in case of a maximal
//   group) as an extension target path. In this way, this provides, for
//   each target path the list of groups it is a target path of.

//   For each such group ID, if the group is not a maximal group, only
//   the group ID is stored.
//
//   For maximal groups this table stores an object which stores
//   the source path node for this mapping and this target path node.
//   It also stores a flag indicating whether this is an extension path
//   or not.
//   This is used to get the source path node as a function of the 
//   target path node and the group (since the same maximal group is 
//   used for the maximal target path and the all extension paths, this
//   infromation is not available in the group itself). 
//
//   This object may take two forms. If there is no path tracing on
//   the target path node, this is a simple object, only storing the
//   required information:
//   {
//       sourcePathId: <the ID of the source path>,
//       isExtension: true|false
//       .....
//   }
//   If path tracing is activated on the target path node, this object
//   is a MappingQueryCalc object which is registered to the source
//   indexer at the source path node. This object stores the
//   'sourcePathId' and 'isExtension' information, but, in addition,
//   also provides the target indexer with updates from the source
//   indexer. If the target path is an extension target path, this
//   MappingQueryCalc object is registered as a simple projection
//   query calculation node to the source path node in the source
//   indexer. It then receives updates when nodes are added and
//   removed from the source indexer at that path node.  It also
//   receives key updates when key values change.  If this path is the
//   maximal target path for this group, this MappingQueryCalc
//   is registered as a simple selection without a selection value: in
//   this way key value updates are received, but no matches are added
//   or removed (as added and removed nodes are notified by the
//   mapping (though addProjMatches() and removeProjMatches()).
//
//   The MappingQueryCalc nodes serve to update both the list of
//   data nodes ('matches') and the keys assigned to data nodes (except in
//   the case where the source path is the maximal source path, in which 
//   case only keys are updated).
//
// dominatedMinGroups: this is the number of minimal groups whose explicit
//    target is a child path of this path (this means that nodes at the
//    current path are dominating nodes for those groups and merging is
//    by identity and therefore the list of non-terminal nodes need to
//    be maintained).
// minGroupPriority: minimal priority of group which maps to this target path
//    (groups with higher priority must add the nodes they map to the list
//    of non-terminals).
// maxGroupPriority: maximal priority of group which maps to this target path
//    (comparing with minGroupPriority allows to determine whether there
//    are groups of different priorities mapping to this path).
//
// nodes: the 'nodes' table is identical to base class nodes table.
//
// unmappedNodes: this field hold the list of nodes (source element IDs)
//    which are unmapped at this node (that is, were merged but conflicted
//    with higher priority nodes). When this path node is the root path node,
//    the unmapped nodes are stored in a UnmappedNodesAtRoot table (which 
//    does not store information about the dominating node) and otherwise 
//    they are stored in an UnmappedNodes table (which does store
//    the dominating node). See unmappedNodes.js for more information.
//
// dominatedPriorities: this table holds the priority of the nodes
//    at this path which are dominated by a given dominating node.
//    All nodes dominated by the same node must have the same priority.
//    The keys in this table are the IDs of the dominating nodes
//    and the values are the priorities.
//    This table only stores the priorities for dominating nodes which
//    dominate data elements at this path (otherwise, the dominating
//    node has the same element ID as the dominated nodes and therefore
//    they have the same priority, which can be read directly from the
//    data element table). This means that this table also stores 
//    operators mapped to this target path (if those operators allow
//    merging under them).
//    This field is not used on the root path node unless there are
//    operators on the root path node (for all other nodes, 'priority' is used
//    instead, as there is only one priority).
// priority: on a root path node, this is the priority of the elements
//    mapped to this path node (with the exclusion of the nodes which
//    are mapped under an operator at the same target path path). This is
//    the highest priority of a group which actually merged elements to
//    this path node.
//
// nonTerminals: this is a PathNonTerminals object (see pathNonTerminals.js)
//    which stores the non-terminals (not including operators, which are
//    stored under 'operators') at this path node. These are stored indexed
//    by their identity and dominating node (except at the root node, where
//    there is no dominating node).
// childrenByIdentity: this is a ChildrenByIdentity table which stores
//    child nodes (at child paths of this path node) which need to be 
//    merged under non-terminal nodes at this path node, based on their
//    identity and possibly their dominating IDs. A node is added to this
//    table when it is being merged is from the minimal source path of 
//    the mapping so its dominating nodes are determined by identity.
//    Nodes are retrieved from this table when a non-terminal node is
//    added at this path (and the nodes retrieved are to be merged
//    under it).
//    This table does not necessarily appear on a path node. It is created
//    only when needed (but will not be destroyed when it becomes empty).
//
// numOperators: this is the umber of operators in the 'operators' table
//    below.
// operators: this is a table which stores all non-terminal operator nodes
//    at this node. When this table is empty, it is set to 'undefined'.
// dataElementOperators: this is a PathNonTerminals object which
//    stores the non-terminal operators at this node which are also
//    data elements (at this path).  The operators are stored indexed
//    by their identity and dominating node (except at the root node,
//    where there is no dominating node). This allows lower prioity
//    nodes to be inserted under these nodes based on their
//    identity. Operator nodes which are not data elements do not need
//    to be included here because the insertion under these nodes is
//    based on the identity of the dominating node and takes place
//    directly through the standard merge mechanism.

// %%include%%: <scripts/utils/arrayUtils.js>
// %%include%%: "mergeGroup.js"
// %%include%%: "identityIndexer.js"
// %%include%%: "mappingQueryCalc.js"
// %%include%%: "mappingMonitor.js"
// %%include%%: "pathNonTerminals.js"
// %%include%%: "childrenByIdentity.js"
// %%include%%: "unmappedNodes.js"

inherit(MergeIndexer, IdentityIndexer);

var debugAllMergeIndexers; // initialized, if needed, by InternalQCM

/////////////////
// Constructor //
/////////////////

// To construct the merge indexer, all we need is the internal QCM 
// for which it is being constructed.

function MergeIndexer(internalQCM)
{
    // call the base class constructor
    this.IdentityIndexer(internalQCM);

    // initialize tables

    this.nonExtensionPathIds = {};
    this.mappings = new Map();
    this.numProjs = 0;
    this.groupIdByDesc = {};
    this.groupById = {};
    this.identityGroupByIdentification = new Map();
    this.groupBySourceIdentification = new Map();
    this.identifiedByTarget = new Map();

    if(debugAllMergeIndexers !== undefined)
        debugAllMergeIndexers[this.id] = this;
}

// create the data element table for this object (may be modified by
// derived classes

MergeIndexer.prototype.createDataElements = mergeIndexerCreateDataElements;

function mergeIndexerCreateDataElements()
{
    return new MergeDataElements(this);
}


// Destructor.

// There is not much to do here. If the registrations of mappings to this
// indexer were removed before the indexer is destroyed (as they should be)
// then all groups created should also have been destroyed. However, just
// in case this was not done, this function destroys all remaining groups
// (this removes registrations made for them on the source indexer).
// Similarly, it is assumed all query calculation nodes registered to
// this indexer were removed already. This means that the path nodes will
// be garbage collected (if this did not yet happen).
// In addition, this function calls the base class destructor. 

MergeIndexer.prototype.destroy = mergeIndexerDestroy;

function mergeIndexerDestroy()
{
    // destroy all merge groups (this removes the registrations these
    // groups made on the source indexer).
    for(var groupId in this.groupById)
        this.destroyGroup(this.groupById[groupId]);
    
    this.IdentityIndexer_destroy();

    if(debugAllMergeIndexers !== undefined)
        delete debugAllMergeIndexers[this.id];
}

// This function overrides the base class implementation of this 
// function, which is called to create a new path node object.
// The base class function is called first and, then, when it is done,
// this function adds the tables of the path node which belong to the
// merge indexer.

MergeIndexer.prototype.createPathNode = 
    mergeIndexerCreatePathNode;

function mergeIndexerCreatePathNode(pathId)
{
    if(pathId === undefined) {
        assert(false, "creating path with an undefined path ID");
        return undefined;
    }
    
    if(pathId in this.pathNodesById)
        return this.pathNodesById[pathId]; // already exists
    
    // create the path node object
    var pathNode = this.IdentityIndexer_createPathNode(pathId);

    pathNode.mappingGroups = new Map();
    pathNode.dominatedMinGroups = 0;
    pathNode.minGroupPriority = Infinity;
    pathNode.maxGroupPriority = -Infinity;

    pathNode.unmappedNodes = undefined; //  created on demand
    pathNode.nonTerminals = undefined; // created on demand
    pathNode.childrenByIdentity = undefined; // created on demand
    
    pathNode.numOperators = 0;
    pathNode.operators = undefined;
    pathNode.dataElementOperators = undefined;
    
    if(pathId == this.qcm.getRootPathId())
        pathNode.priority = -Infinity;
    pathNode.dominatedPriorities = new Map();

    return pathNode;
}

// Create a new object to store a data element in the data element table

MergeIndexer.prototype.newDataElementEntry =
    mergeIndexerNewDataElementEntry;

function mergeIndexerNewDataElementEntry(pathId, parentId, groupId, sourceId)
{
    return {
        pathId: pathId,
        parent: parentId,
        identity: undefined,
        groupId: groupId,
        sourceId: sourceId,
        refCount: 1,
        children: undefined
    };
}

// This function overrides the base class implementation of this function,
// which is used to add a path to the indexer.
// Most of the work is still performed by the base class implementation of
// this function. However, this wrapper performs the following additional
// actions:
// 1. If the path node has not yet been created and if the path ID appears
//    in the 'nonExtensionPathIds' table, the new path node being created
//    is marked as a non-extension path (a path such that a mapping to
//    its prefix path is not extended to this path or any path extending it).

MergeIndexer.prototype.addPath = mergeIndexerAddPath;

function mergeIndexerAddPath(pathId)
{
    if((pathId in this.nonExtensionPathIds) &&
       !(pathId in this.pathNodesById)) {
        var pathNode = this.IdentityIndexer_addPath(pathId);
        pathNode.nonExtensionPath = true;
        return pathNode;
    } else
        return this.IdentityIndexer_addPath(pathId);
}

/////////////////////////////////
// Non-Extension Path Property //
/////////////////////////////////

// This function adds the path defined by 'prefixId' and 'attrs'
// (explained below) as a non-extension path (mappings defined on
// prefixes of the path are not extended to this path and paths which
// extend it). Thsi function must be called for a given path ID before
// the path node for that path ID is created. Therefore, it is
// recommended to call this function as soon as possible after the
// indexer is constructed.
//
// The function receives two arguments, the ID of a path 'prefixId' and
// an array of attributes (string), 'attrs'. Together, these define
// a path (the result of extending the path with ID 'prefixId' by
// the attributes in 'attrs'). 'attrs' may be an empty array (in which
// case the path is simply 'prefixId') and prefixId is allowed to be undefined
// (in which case the path is simply that given by 'attrs').
// The path ID generated for this path is allocated here and will be released
// when the 'nonExtensionPathIds' table is destroyed.

MergeIndexer.prototype.addNonExtensionPathId =
    mergeIndexerAddNonExtensionPathId;

function mergeIndexerAddNonExtensionPathId(prefixId, attrs)
{
    var pathId = this.qcm.allocatePathIdFromPath(prefixId, attrs);
    if(pathId in this.nonExtensionPathIds)
        this.qcm.releasePathId(pathId); // the function above allocated the ID
    else
        this.nonExtensionPathIds[pathId] = true;
}

/////////////////////////////////////////////
// Adding, Removing and Modifying Mappings //
/////////////////////////////////////////////

// See documentation of this function in the 'Mapping Registration'
// section of the introduction to this file.

MergeIndexer.prototype.addMapping = mergeIndexerAddMapping;

function mergeIndexerAddMapping(funcResult, projId, sourceIndexer,
                                mapping, priority, sourceIdentificationId, 
                                targetIdentificationId, isIdentity,
                                identityOnly)
{
    var resultId = funcResult.getId();
    var removeMapping = (!mapping || !mapping.length);

    if(!removeMapping && isIdentity) {
        // if this mapping should be mapped under dominating identity nodes,
        // add the paths for the mapping of the identity nodes: the minimal
        // source path and the prefix of the minimal target path
        if(mapping.length > 2 || !identityOnly) {
            var prefixTargetPathId = this.qcm.getPrefix(mapping[0]);
            mapping.unshift(prefixTargetPathId, mapping[1]);
        }
    }

    var funcEntry;
    if(!this.mappings.has(resultId)) {
        if(removeMapping)
            return; // empty mapping and no previously registered
        funcEntry = new Map();
        this.mappings.set(resultId, funcEntry);
    } else
        funcEntry = this.mappings.get(resultId);

    var projEntry;
    
    if(funcEntry.size > 0 && funcEntry.has(projId)) {
        projEntry = funcEntry.get(projId);
        var oldGroups = projEntry.groups;
        // remove the mapping from existing groups it belongs to.
        for(var i = 0, l = oldGroups.length ; i < l ; ++i) {
            if(oldGroups[i].removeMapping(resultId, projId))
                // this was the last mapping on the group 
                this.destroyGroup(oldGroups[i]);
        }

        if(removeMapping) {
            if(funcEntry.size == 1)
                this.mappings.delete(resultId);
            else
                funcEntry.delete(projId);
            this.numProjs--;
            return;
        }

    } else {
        if(removeMapping)
            return; // empty mapping and not previously registered
        projEntry = {
            groups: undefined,
            matchesAdded: false
        };
        funcEntry.set(projId, projEntry);
        this.numProjs++;
    }

    // calculate the groups for this mapping and add this mapping to 
    // these groups (creating these groups, if needed).

    var groupEntry; // the last group entry created
    for(var i = 0, l = mapping.length ; i < l ; i += 2) {
        var sourcePathId = mapping[i+1];
        var targetPathId = mapping[i];
        groupEntry = this.addMappingToGroup(funcResult, projId,
                                            sourceIndexer, groupEntry,
                                            (i == l-2), isIdentity && (i == 0),
                                            sourcePathId, targetPathId, 
                                            priority, sourceIdentificationId, 
                                            targetIdentificationId);
    }

    // store the group sequence
    projEntry.groups = groupEntry.groupSequence;
}

// Remove the given mapping by calling addMapping with an undefine path mapping
// array. If projId is undefined, all mappings with the given function ID are
// removed.

MergeIndexer.prototype.removeMapping = mergeIndexerRemoveMapping;

function mergeIndexerRemoveMapping(funcResult, projId)
{
    var resultId = funcResult.getId();
    
    if(!this.mappings.has(resultId))
        return undefined;

    if(projId === undefined) {
        var _self = this;
        this.mappings.get(resultId).forEach(function(entry, projId) {
            _self.addMapping(funcResult, projId);
        });
    } else
        this.addMapping(funcResult, projId);
}

// This function removes all mappings registered to the merge indexer.
// It is assumed that all data nodes were already cleared in the indexer
// before this step.
// This function simply destroys all groups and clears the 'mappings' 
// table.

MergeIndexer.prototype.removeAllMappings = mergeIndexerRemoveAllMappings;

function mergeIndexerRemoveAllMappings()
{
    for(var groupId in this.groupById)
        this.destroyGroup(this.groupById[groupId]);
    
    this.mappings = new Map();
    this.numProjs = 0;
}

// This function may be called when the source indexer and source paths
// of a mapping change but the mapping effectively remains the same,
// because the one source indexer is actually a mapping from the other
// (this, for example, is used when an result indexer is created or
// removed in one of the queries which are part of the chain which
// resulted in this mapping). The calling function must verify that the
// nodes mapped by the new and the old mapping have the exact same
// element IDs and that these nodes as well as all nodes they dominate in the
// new source indexer have exactly the same element IDs and keys
// as in the original indexer. Moreover, if merging of the mapped nodes
// takes place based on the identities of their parent nodes, those too
// should be the same in the new and old mappings. Finally, all other
// non-source properties of the mappings, such as whether they are an
// identity mapping or the target identification ID should be the same
// in the old and new mapping.
// The 'resultId' is the ID of the function result whose
// source indexer has changed. This must be the same before and after
// the change. This function checks that this is the only function result
// in the groups to which it belongs. If some of these groups belong to
// additional function results, the operation cannot be performed and
// the function returns false (because the groups would have to be split).
// Similarly, if any of the groups which need to be created for the new
// mapping already exist, the operation cannot be performed and the function
// returns false (because the groups would have to be merged).
// In these cases, the calling function must remove the original mapping and
// add the new mapping. In all other cases, this function returns true.
// The argument 'projMappings' should be a Map object whose keys
// are the projection IDs of the new mapping and under each projection ID,
// the 'mapping' vector (as provided to the 'addMapping()' function) of
// this projection. The new projections do not need to have the same IDs
// as the old projections but the number of projections must be the same
// and it must be possible to pair the new and old projections such that
// the target paths of the mappings of each pair are the same and such that
// the removing the prefix 'prevPrefixPathId' from the source path IDs
// in the mappings of the old projections and adding the prefix 'prefixPathId'
// generates the source paths of the new projections.
// Finally, the caller must provide the new source indexer of the mapping
// and the source identification ID. It is assumed that even if the source
// identification ID changed, the actual identification did not change.
// Other properties of the mapping (such as the target identification ID
// or the priority) are assumed to hve remained unchanged.
// This functio first verifies that the operation can be carried out.
// In this process the new source path IDs and the description strings
// of the groups are calculated. If it turns out that the operation can
// be carried out, the old projections are removed from the groups, the
// source of the groups is modified and then the new projections
// are added using the standard 'addMapping' function (since the groups
// already exist, this doe snot do much).
// This function updates the groups with the new properties (but the group ID
// remains the same and no data nodes or element ID are changed) and changes
// the registration of the mappingQueryCalc and mappingMonitor to the new
// source indexer and source paths.

MergeIndexer.prototype.replaceFuncSource =
    mergeIndexerReplaceFuncSource;

function mergeIndexerReplaceFuncSource(funcResult,
                                       projMappings,
                                       prevPrefixPathId, prefixPathId,
                                       sourceIndexer,
                                       sourceIdentificationId)
{
    var resultId = funcResult.getId();
    
    var funcEntry = this.mappings.get(resultId);
    if(funcEntry === undefined)
        return false;
    
    // check that this function result does not share its groups with
    // any other function result and that after modifying the groups
    // they do not overlap with existing groups (in both cases, the function
    // cannot perform the replacement).

    // stores under each group ID its new source path and description string
    var newGroups = new Map();
    var isIdentity = false; // may be changed to true below
    var identityOnly = false; // may be changed to true below
    var targetIdentificationId = undefined; // may be changed below
    var priority;
    // were matches already added for this function result (this is the
    // same for all projections of the same function results)
    var matchesAdded = false;

    var _self = this;
    var failed = false;
    
    funcEntry.forEach(function(projEntry, projId) {
        if(failed) // failed in a previous iteration
            return;
        var groups = projEntry.groups;
        if(projEntry.matchesAdded)
            matchesAdded = true; // same for all projections of same result
        for(var i = 0, l = groups.length ; i < l ; ++i) {
            var groupEntry = groups[i];
            if(groupEntry.mappings.size > 1) {
                failed = true; // multiple function results
                return;
            }
            var groupSourcePathId = groupEntry.sourcePathId;
            var suffixPathId =
                _self.qcm.getPathSuffix(groupSourcePathId, prevPrefixPathId);
            var newSourcePathId = _self.qcm.allocateConcatPathId(prefixPathId,
                                                                 suffixPathId);
            // no need to allocate here, the path is already allocated in the
            // source indexer path node
            _self.qcm.releasePathId(newSourcePathId);
            // create the new description string
            var desc = MergeGroup.
                makeGroupDesc(sourceIndexer, groupEntry.prefixGroup,
                              groupEntry.isMaxGroup,
                              groupEntry.isIdentityGroup, newSourcePathId,
                              groupEntry.targetPathNode.pathId,
                              groupEntry.priority, sourceIdentificationId, 
                              groupEntry.targetIdentificationId);
            if(desc !== groupEntry.description &&
               (desc in _self.groupIdByDesc)){
                failed = true;// a group with the new description already exists
                return;
            }
            newGroups.set(groupEntry.groupId,
                          { description: desc, sourcePathId: newSourcePathId });
            // properties of the group for adding the new projections below
            if(groupEntry.isIdentityGroup) {
                isIdentity = true;
                if(groupEntry.isMaxGroup)
                    identityOnly = true; 
            }
            if(groupEntry.targetIdentificationId !== undefined)
                targetIdentificationId = groupEntry.targetIdentificationId;
            priority = groupEntry.priority; // same for all groups
        }
    });

    if(failed)
        return false;
    
    // remove the old projections (the groups are not destroyed even if the
    // number of registered projections drops to zero, as this is temporary).
    funcEntry.forEach(function(projEntry, projId) {
        var groups = projEntry.groups;
        for(var i = 0, l = groups.length ; i < l ; ++i)
            groups[i].removeMapping(resultId, projId);
        funcEntry.delete(projId);
        _self.numProjs--;
    });
    
    // go over the groups and modify their source properties (each group once)
    newGroups.forEach(function(entry, groupId) {
        // place the new group under the new description
        var groupEntry = _self.groupById[groupId];
        delete _self.groupIdByDesc[groupEntry.description];
        _self.groupIdByDesc[entry.description] = groupEntry.groupId;
        // refresh the group object
        groupEntry.changeGroupSource(entry.sourcePathId, sourceIndexer,
                                     sourceIdentificationId);
    });

    // add the new projections (the groups already exist, so this only registers
    // the projections to the appropriate groups).
    var _self = this;
    projMappings.forEach(function(mapping, projId) {
        _self.addMapping(funcResult, projId, sourceIndexer,
                         mapping, priority, sourceIdentificationId, 
                         targetIdentificationId, isIdentity,
                         identityOnly);
    });

    // if 'matchesAdded' was true before this update, it is also true after
    // this update (by assumption, the replacement of the source does not
    // change the matches).
    if(matchesAdded) {
        funcEntry = this.mappings.get(resultId);
        funcEntry.forEach(function(projEntry, projId) {
            projEntry.matchesAdded = true;
        });
    }
    
    return true;
}

// Given a function result ID, this function returns the list of projections
// registered to this indexer for this function. The list is returned
// as a Map object whose keys are the projection IDs. If the list
// is empty, undefined is returned. The list returned should not be modified
// by the calling function. 

MergeIndexer.prototype.getRegisteredFuncProjections = 
    mergeIndexerGetRegisteredFuncProjections;

function mergeIndexerGetRegisteredFuncProjections(resultId)
{
    if(!this.mappings.has(resultId))
        return undefined;

    return this.mappings.get(resultId);
}

// Given a function result ID and a projection ID, returns the entry
// for the given projection in the 'mappings' table.

MergeIndexer.prototype.getProjEntry = 
    mergeIndexerGetProjEntry;

function mergeIndexerGetProjEntry(resultId, projId)
{
    var resultEntry = this.mappings.get(resultId);
    if(resultEntry === undefined)
        return undefined;

    return resultEntry.get(projId);
}

// Given a function result ID and a projection ID, return the sequence
// of groups for that projection (the sequence is an array ordered from the
// maximal group to the minimal group).

MergeIndexer.prototype.getProjGroupSequence = 
    mergeIndexerGetProjGroupSequence;

function mergeIndexerGetProjGroupSequence(resultId, projId)
{
    var resultEntry = this.mappings.get(resultId);
    if(resultEntry === undefined)
        return undefined;

    var projEntry = resultEntry.get(projId);
    if(projEntry === undefined)
        return undefined;

    return projEntry.groups;
}

// Given a function result ID and a projection ID, return the maximal
// group (MergeGroup object) for that projection.

MergeIndexer.prototype.getProjMaxGroup = 
    mergeIndexerGetProjMaxGroup;

function mergeIndexerGetProjMaxGroup(resultId, projId)
{
    var resultEntry = this.mappings.get(resultId);
    if(resultEntry === undefined)
        return undefined;

    var projEntry = resultEntry.get(projId);
    if(projEntry === undefined)
        return undefined;

    return projEntry.groups[0]; // maximal group is the first in the sequence
}

// Given a function result ID and a projection ID, returns true if any
// matches were already added by this projection and false otherwise.

MergeIndexer.prototype.projAlreadyAddedMatches = 
    mergeIndexerProjAlreadyAddedMatches;

function mergeIndexerProjAlreadyAddedMatches(resultId, projId)
{
    var resultEntry = this.mappings.get(resultId);
    if(resultEntry === undefined)
        return false;

    var projEntry = resultEntry.get(projId);
    if(projEntry === undefined)
        return false;

    return projEntry.matchesAdded;
}

// This function returns true if there is exactly one function result
// mapping to this merge indexer (there may be multiple projections
// of the same function result) and false in all other cases.

MergeIndexer.prototype.isSingleMappingResult =
    mergeIndexerIsSingleMappingResult;

function mergeIndexerIsSingleMappingResult()
{
    return this.mappings.size == 1;
}

////////////
// Groups //
////////////

// This function receives the properties of a mapping identified by
// resultId + projId and finds the group for a single 
// source path and target path pair for this mapping. It then creates
// the group if needed and adds this mapping to the group. It returns
// the entry of this group.
// The function receives the source path 'sourcePathId' and the target 
// path 'targetPathId'. If the group is an identity group, 'sourcePathId'
// is the source path ID of the next group in the 'mapping' array and
// the flag 'isIdentity' should be set to true (otherwise, it is false).
// In addition, other properties of the mapping which are required for
// identifying the group are provided:
// the source indexer 'sourceIndexer', the 'priority' of the mapping
// and the source and target identification IDs for this mapping
// ('sourceIdentificationId' and 'targetIdentificationId'). If the source
// and target paths are not the minimal source and target path of the mapping,
// this function also receives the entry 'prefixGroupEntry' of the
// group to which the prefix source and target path pair of this 
// mapping belong. Finally, if these are the maximal source and target paths,
// 'isMaximal' should be true (and otherwise false).
// This function returns the entry of the group. 

MergeIndexer.prototype.addMappingToGroup = 
    mergeIndexerAddMappingToGroup;

function mergeIndexerAddMappingToGroup(funcResult, projId, 
                                       sourceIndexer, prefixGroupEntry, 
                                       isMaximal, isIdentity,
                                       sourcePathId, targetPathId, priority,
                                       sourceIdentificationId, 
                                       targetIdentificationId)
{
    // create the group description based on these parameters

    var desc =
        MergeGroup.makeGroupDesc(sourceIndexer, prefixGroupEntry, isMaximal,
                                 isIdentity, sourcePathId, targetPathId,
                                 priority, sourceIdentificationId, 
                                 targetIdentificationId);

    // create the group object (if it exists, the existing object is used)
    var groupEntry = this.createGroup(desc, sourceIndexer, prefixGroupEntry,
                                      isMaximal, isIdentity, sourcePathId,
                                      targetPathId, priority,
                                      sourceIdentificationId,
                                      targetIdentificationId);

    // add this mapping to the group
    groupEntry.addMapping(funcResult, projId);

    return groupEntry;
}

// This function creates a group entry for a new group with the description
// string 'desc' and the properties defined by the other arguments.
// If the group with the given description ('desc') string already exists,
// the existing group object is returned. The creation of the group
// object also initializes various registrations of the group to the
// source indexer (e.g. registration of the mappingQueryCalc objects)
// target indexer and the prefix group.
// This function returns the group object.

MergeIndexer.prototype.createGroup = mergeIndexerCreateGroup;

function mergeIndexerCreateGroup(desc, sourceIndexer, prefixGroupEntry, 
                                 isMaximal, isIdentity, sourcePathId,
                                 targetPathId, priority,
                                 sourceIdentificationId, targetIdentificationId)
{
    if(desc in this.groupIdByDesc)
        return this.groupById[this.groupIdByDesc[desc]];
    
    var group =
        new MergeGroup(this, desc, sourceIndexer, prefixGroupEntry, 
                       isMaximal, isIdentity, sourcePathId, targetPathId,
                       priority, sourceIdentificationId,
                       targetIdentificationId);
    this.groupIdByDesc[desc] = group.groupId;
    this.groupById[group.groupId] = group;    

    return group;
}

// This function should be called to destroy the group whose entry is
// given. It is assumed that this is called when there are no more 
// mappings in this group. It is also assumed that all target nodes
// created for this group were already removed.
// The destruction of the group takes care of deregistering the various
// registrations to the target and source indexer of the group.

MergeIndexer.prototype.destroyGroup = 
    mergeIndexerDestroyGroup;

function mergeIndexerDestroyGroup(groupEntry)
{
    // remove the group entry
    delete this.groupIdByDesc[groupEntry.description];
    delete this.groupById[groupEntry.groupId];
    
    groupEntry.destroy();
}

// This function adds the given identity group ('groupEntry') to
// the list of identity groups indexed by their source identification.

MergeIndexer.prototype.addIdentityGroupByIdentification =
    mergeIndexerAddIdentityGroupByIdentification;

function mergeIndexerAddIdentityGroupByIdentification(groupEntry)
{
    if(this.identityGroupByIdentification === undefined)
        this.identityGroupByIdentification = new Map();

    var identificationId = groupEntry.sourceIdentificationId;

    if(identificationId === undefined)
        identificationId = 0;

    var idEntry;

    if(this.identityGroupByIdentification.has(identificationId))
        idEntry = this.identityGroupByIdentification.get(identificationId);
    else {
        idEntry = new Map();
        this.identityGroupByIdentification.set(identificationId, idEntry);
    }

    idEntry.set(groupEntry.groupId, groupEntry);
}

// This function removes the given identity group ('groupEntry') from
// the list of identity groups indexed by their source identification.

MergeIndexer.prototype.removeIdentityGroupByIdentification =
    mergeIndexerRemoveIdentityGroupByIdentification;

function mergeIndexerRemoveIdentityGroupByIdentification(groupEntry)
{
    var identificationId = groupEntry.sourceIdentificationId;

    if(identificationId === undefined)
        identificationId = 0;

    var idEntry = this.identityGroupByIdentification.get(identificationId);

    if(idEntry === undefined)
        return;

    idEntry.delete(groupEntry.groupId);
    if(idEntry.size == 0)
        this.identityGroupByIdentification.delete(identificationId);
}

///////////////////////////////
// Path and Sub-tree Tracing //
///////////////////////////////

// This function is called when the given path node is first activated,
// either as a result of tracing being activated or as a result of
// monitoring being activated. This function checks which of the two it is
// and then applies the relevant function.

MergeIndexer.prototype.pathNodeActivated = 
    mergeIndexerPathNodeActivated;

function mergeIndexerPathNodeActivated(pathNode)
{
    if(pathNode.trace)
        this.pathNodeTracingActivated(pathNode);

    if(pathNode.subTree)
        this.subTreeMonitoringActivated(pathNode);
}

// This function is called when path node tracing is activated for 
// the given path node (of the target indexer). This function then has 
// two tasks: creating mapping query calculation nodes for maximal groups
// mapping to this path and merging those nodes which were not yet merged
// (these are all node mapped by the group except for nodes in monitored 
// sub-trees which were already merged).
// The function handles groups for which this is an explicit target path
// and groups for which this is an extension target path separately.
//
// For groups which have an explicit target path at this path node, the group
// entry in the 'mappingGroups' table of the path node already exists
// (it is created when the mapping is added). For maximal groups for which 
// this path node is a target path (the longest target path) 
// this entry in the 'mappingGroups' table must, however, be upgraded
// to a mapping query calculation node.
// In addition to this (for any group, not only the maximal) we must here 
// also merge those nodes of the mapping which were not merged while
// path tracing was turned off. This includes all nodes except those
// whose target node is inside a monitored sub-tree. This is determined
// by the target dominating node: the merged node is in a monitored
// sub-tree iff its dominating node is in a monitored sub-tree
// (a node at a non-traced path cannot be the root of a monitored sub-tree
// unless it is inside a larger sub-tree because otherwise it would
// not be visible for the registration of the monitoring). 
//  
// For groups which have this path as an extension target path, there
// may be no entry yet in the 'mappingGroups' table, but there
// must be an entry in the 'mappingGroups' table of the prefix path
// (when tracing is turned on for this path node, it must have already
// have been turned on for the prefix path). Moreover, such an entry
// in the 'mappingGroups' table of the prefix path node must be compound:
// either another extension path or the value maximal target path.
// After identifying this path node as an extension target path for
// a certain group, we add an entry for this group to pathNode's
// 'mappingGroups' table and merge those source nodes whih were not
// merged yet. We first find all source nodes which should be merged
// by finding all source nodes mapped from the maximal source path
// and finding all source nodes at the extension source path dominated
// by these nodes. We then merge these nodes, by finding the dominating
// nodes under which they need to be inserted (the prefix path node
// must have already had tracing activated). We skip those dominating
// nodes which are inside a monitored sub-tree (as the nodes under them
// were already merged).

MergeIndexer.prototype.pathNodeTracingActivated = 
    mergeIndexerPathNodeTracingActivated;

function mergeIndexerPathNodeTracingActivated(pathNode)
{
    // find those groups for which this is a target path 
    if(pathNode.mappingGroups.size > 0) {
        var _self = this;
        pathNode.mappingGroups.forEach(function(entry, groupId) {
            var groupEntry = _self.groupById[groupId];
            if(groupEntry.isMaxGroup) {
                if(pathNode != groupEntry.targetPathNode)
                    // extension path for this group, will be handled elsewhere
                    return;
                // create mapping query calc on value target path
                groupEntry.addMappingGroupToPath(pathNode, true);
            }

            // merge the nodes (which are not monitored already)
            _self.mergeNonMonitoredAtExplicit(groupEntry, pathNode);
        });
    }

    // find groups for which this is an extension target path
    // (unless this path in a non-extension path).

    var parent;
    if(!pathNode.nonExtensionPath && (parent = pathNode.parent) &&
       parent.mappingGroups.size > 0) {
        var _self = this;
        parent.mappingGroups.forEach(function(entry, groupId) {
            if(entry === true)
                return; // not a maximal group, so no extension path
            var groupEntry = _self.groupById[groupId];
            if(groupEntry.isIdentityGroup) // no extension path
                return;
            
            var mappingEntry =
                groupEntry.addMappingGroupToPath(pathNode, false);

            // merge nodes at this path which were not previously under
            // a monitored sub-tree and therefore were not merged.
            _self.mergeNonMonitoredAtExtension(groupEntry, 
                                               mappingEntry.sourcePathId,
                                               pathNode);
        });
    }

    // for nodes without attributes inside monitored sub-trees we no
    // longer need to have a mapping monitor registered as path tracing
    // now provides all the required information.
    if(pathNode.subTree)
        this.removeMappingMonitorAtTracePath(pathNode);
}

// This function receives a target path node and the entry of a group
// which has this target path node as an explicit element target path.
// The function then merges all nodes mapped by this group
// whose target is not inside a monitored sub-tree. This is under the
// assumption that this function is called when the mapping already added
// these nodes but they were not merged because the target path node
// did not have tracing activated. Now, as path tracing has been activated,
// these nodes need to be merged, but those nodes which are inside a monitored
// sub-tree are already merged and therefore can be skipped.
// The function first retrieves from the group all source nodes added by
// the group and all their source dominating nodes.  
// in this group (these are stored in the group's 'sourceNodes' table)
// The function then calculates the dominating target nodes for the
// merging of these source nodes based on their dominating source nodes.
// Dominating target nodes with sub-tree monitoring are filtered out
// as the nodes merged under them would have already been merged. 

MergeIndexer.prototype.mergeNonMonitoredAtExplicit = 
    mergeIndexerMergeNonMonitoredAtExplicit

function mergeIndexerMergeNonMonitoredAtExplicit(groupEntry, targetPathNode)
{
    // get the source nodes mapped by this group
    var sourceIds = groupEntry.getAllSourceNodes();
    var toMerge = // returns an array containing two arrays
        groupEntry.getSourceElements(sourceIds, targetPathNode.parent, false);

    if(targetPathNode.parent !== undefined) {
        if(groupEntry.prefixGroup === undefined) // minimal group
            // find the dominating nodes based on the identities of the
            // dominating source nodes.
            toMerge[1] = this.getDominatingByGroup(groupEntry, toMerge[1]);
        else
            // replace the domianting source nodes by the target nodes they
            // were merged to
            toMerge[1] = this.getAllDominatingByMerged(groupEntry,
                                                       targetPathNode.parent,
                                                       toMerge[1]);
        // filter out those source IDs whose dominating IDs are monitored
        var filtered = 
            this.filterSourceByMonitoredDominating(toMerge[0], toMerge[1],
                                                   targetPathNode.parent,
                                                   false);
        toMerge[0] = filtered.sourceIds;
        toMerge[1] = filtered.allDominatingIds;

    }
    
    this.addMergedNodes(groupEntry, targetPathNode, toMerge[0], toMerge[1]);
}

// This function receives a maximal group (which is not an identity group)
// and an extension source path for this group and the corresponding
// extension target path for the group. This function finds all source nodes
// at the source path which are dominated by source nodes mapped (at the
// maximal path) by one of the mappings in the maximal group.
// The function then merges all these source nodes, skipping those 
// whose dominating target node is in a monitored sub-trees.
// This is under the assumption that this function is called when the
// mapping already added the nodes at the maximal explicit path but
// the nodes dominated by them at the extension path were not merged
// because the target path node did not have tracing activated. Now,
// as path tracing has been activated, these nodes need to be merged,
// but those nodes which are inside a monitored sub-tree are already
// merged and therefore can be skipped.

MergeIndexer.prototype.mergeNonMonitoredAtExtension = 
    mergeIndexerMergeNonMonitoredAtExtension

function mergeIndexerMergeNonMonitoredAtExtension(groupEntry, sourcePathId, 
                                                  targetPathNode)
{
    // find those source nodes whose parent source nodes were already
    // mapped and merge them here.

    // get the source nodes mapped by this group 
    var dominatingSourceIds = groupEntry.getAllSourceNodes();
        
    // find the source nodes dominated by these nodes at the 
    // extension source path
    var sourceIds = groupEntry.sourceIndexer.
        getDominatedNodes(sourcePathId, dominatingSourceIds, 
                          groupEntry.sourcePathId);
            
    // merge these nodes (the 'true' before last argument indicates
    // that the parents wre already merged, as tracing is activated
    // first for shorter paths. The 'false' last argument indicates there is
    // no need to merge under sub-tree-monitored dominating nodes). 
    this.mergeAtExtensionPath(groupEntry, targetPathNode, sourceIds, true,
                              false);
}

// This function is called (by the base class) when the path node is
// deactivated, which means that neither tracing nor monitoring is active
// on the path node. This function may also be called when a group is
// removed or a child path node is removed, in which case, if 'pathNode'
// is not active (this is first checked here) it may be removed if
// now allowed (this removal may have previously been blocked by a group
// which has it as a target path or by child path nodes which could not
// be removed yet).
// If the path is not active, this function either destroys or clears the
// path node, depending on whether the path node is allowed to be destroyed.
// The path may not be destroyed if one of the following holds:
// 1. the path node is an explicit target path node of some group
// 2. some child path nodes have not been destroyed yet.
// When a path node is only cleared because a minimal group has this
// path as its explicit target path, this function notifies the group
// that it (and all groups which have it as a prefix) may clear their
// data (as the projections belonging to the group have become inactive
// as a result of the target path becoming inactive).

MergeIndexer.prototype.pathNodeDeactivated = 
    mergeIndexerPathNodeDeactivated;

function mergeIndexerPathNodeDeactivated(pathNode)
{
    if(this.isPathActive(pathNode.pathId))
        return; // still active, even though called
    
    // destroy any mapping query calculation nodes registered to
    // source indexers for mapping to this target path node
    var explicitGroups = this.destroyPathNodeMapping(pathNode);

    if(explicitGroups.length == 0 && pathNode.children === undefined) {

        var parent = pathNode.parent;
        
        // can remove the path node (this is a base class function)
        this.removePathNode(pathNode);

        if(parent !== undefined && parent.children === undefined &&
           !this.isPathActive(parent.pathId)) {
            // deactivate the parent path (this will either clear it (again)
            // or remove it completely, if allowed).
            this.pathNodeDeactivated(parent);
        }

        return;
        
    }

    // cannot destroy, so only clear the node.

    if(this.numTranslatingGroups(pathNode) > 0) {
        // must first remove data element translations
        var elementIds = [];
        pathNode.nodes.forEach(function(entry, elementId) {
            elementIds.push(elementId);
        });
        this.removeDataElementIdsFromGroup(elementIds, pathNode);
    }
    
    this.clearPathNode(pathNode);
    
    // if this is the target path of a minimal group, can clear this
    // group and all groups which have this group as a prefix.

    for(var i = 0, l = explicitGroups.length ; i < l ; ++i) {

        var group = this.groupById[explicitGroups[i]];
        if(group.prefixGroup !== undefined)
            continue; // not a minimal group

        group.clearAllSourceElements();
    }
}

// This function is called when there is no more tracing on the given
// target path node. This function then goes over all entries in the
// path node's mappingGroups table and destroys an MappingQueryCalcs
// stored there (the destruction de-registers them from the source indexer).
// Since there is no more tracing on the target path, there is no need to
// continue to monitor the source paths. 
// The function returns an array containing the IDs of groups which
// have this target path node as an explicit target path (this information
// is read from the 'mappingGroups' table).

MergeIndexer.prototype.destroyPathNodeMapping = 
    mergeIndexerDestroyPathNodeMapping;

function mergeIndexerDestroyPathNodeMapping(targetPathNode)
{
    // IDs of groups for which this is the explicit target path node
    var explicitGroups = [];

    targetPathNode.mappingGroups.forEach(function(entry, groupId) {
        if(entry === true) {
            // non-maximal group
            explicitGroups.push(groupId);
            return;
        }
        
        targetPathNode.mappingGroups.
            set(groupId,
                { 
                    sourcePathId: entry.sourcePathId,
                    isExtension: entry.isExtension
                });
        if(!entry.isExtension)
            explicitGroups.push(groupId);
        
        if(entry.destroy !== undefined)
            entry.destroy();
    });

    return explicitGroups;
}

// This function extends the base class function. It first clears those
// fields which are unique to the merge indexer path nodes and then
// calls the base class function.
// This function should only clear node related information but not
// group related information (as groups may continue to be registered
// to the path, even if it is not active).

MergeIndexer.prototype.clearPathNode = 
    mergeIndexerClearPathNode;

function mergeIndexerClearPathNode(targetPathNode)
{
    targetPathNode.unmappedNodes = undefined;
    targetPathNode.nonTerminals = undefined;
    targetPathNode.childrenByIdentity = undefined;
    targetPathNode.numOperators = 0;
    targetPathNode.operators = undefined;
    targetPathNode.dataElementOperators = undefined;

    targetPathNode.dominatedPriorities = new Map();
    if(targetPathNode.pathId == this.qcm.getRootPathId())
        targetPathNode.priority = -Infinity;
    
    this.InternalQCMIndexer_clearPathNode(targetPathNode);
}

// This function is called when path tracing on the given path node is
// deactivated. This function then de-registers all mapping query calculation
// nodes for maximal groups which have this path as an extension target path or
// as the explicit target path 
// This function then goes on to delete all nodes merged to this target path
// by groups which have this path as an extension target path or as an explicit
// target path. Both mapped and unmapped nodes are removed. Only nodes
// inside monitored sub-trees are not removed. 

MergeIndexer.prototype.pathNodeTracingDeactivated = 
    mergeIndexerPathNodeTracingDeactivated;

function mergeIndexerPathNodeTracingDeactivated(pathNode)
{
    if(pathNode.mappingGroups.size === 0)
        return;

    // destroy mapping query calculation entries (replace by a simple object)
    this.destroyPathNodeMapping(pathNode);

    // remove target nodes (mapped and unmapped) which are not monitored
    this.removeNonMonitoredNodes(pathNode);

    if(pathNode.subTree)
        this.addMappingMonitorAtNoTracePath(pathNode);
}

// This function goes over all mapped and unmapped nodes at the given target 
// path node and removes those which are not part of a monitored 
// sub-tree.
// Whether a target node is inside a monitored sub-tree is easy to check,
// as this is recorded directly on the node entry. For unmapped nodes, this
// is determined by the dominating nodes.

MergeIndexer.prototype.removeNonMonitoredNodes = 
    mergeIndexerRemoveNonMonitoredNodes;

function mergeIndexerRemoveNonMonitoredNodes(targetPathNode)
{
    // remove unmapped nodes

    if(pathNode.unmappedNodes !== undefined &&
       pathNode.unmappedNodes.getNum() > 0) {
        if(targetPathNode.parent === undefined)
            pathNode.unmappedNodes = undefined; // all unmapped nodes
        else {
            // get the dominating IDs which ar enot monitored and with unmapped
            // nodes under them.
            var dominatingIds = pathNode.unmappedNodes.getAllDominatingIds();
            dominatingIds = this.filterMonitoredDominating(dominatingIds,
                                                           pathNode.parent,
                                                           false);
            this.removeUnmappedNodesByDominating(pathNode, dominatingIds);
        }
    }
    
    // remove mapped nodes

    var targetIds = [];

    if(!targetPathNode.subTree)
        targetPathNode.nodes.forEach(function(nodeEntry, targetId) {
            targetIds.push(targetId);
        });
    else {

        var _self = this;
        
        targetPathNode.nodes.forEach(function(nodeEntry, targetId) {
            if(_self.inSubTree(nodeEntry))
                return; // is monitored
            targetIds.push(targetId);
        });
    }

    // remove the target nodes
    this.removeTargetNodes(targetPathNode, targetIds);
}

// This function is called by the base class when sub-tree monitoring 
// becomes needed on the given path node. This can happen either
// because sub-tree monitoring was registered on one of the nodes
// at this path or because an attribute pointing at this path node
// was added to a data node at the prefix path node which is inside
// a monitored sub-tree.
// Currently, this function does not need to do anything.

MergeIndexer.prototype.subTreeMonitoringActivated = 
    mergeIndexerSubTreeMonitoringActivated;

function mergeIndexerSubTreeMonitoringActivated(pathNode)
{
}

// This function is called by the base class when sub-tree monitoring 
// is no longer needed at the given path node. This allows the merge 
// indexer to perform some clean-up.
// Currently, this function does not need to do anything.

MergeIndexer.prototype.subTreeMonitoringDeactivated = 
    mergeIndexerSubTreeMonitoringDeactivated;

function mergeIndexerSubTreeMonitoringDeactivated(pathNode)
{
}

// This function is called when a target node becomes part of a monitored
// sub-tree for the first time. This function is called only if this 
// happens after the node was constructed (if the node was constructed
// already inside a monitored sub-tree, the function which requested
// its creation must check whether it is in a monitored sub-tree).
// If the target path is an extension path or the target path of a maximal
// mapping group, this function then checks whether this node 
// has attributes (whether it has attributes is always updated). If it does,
// this function then updates it with the attributes as retrieved from
// the source node.
// This function then checks whether a mapping sub-tree monitor needs
// to be registered to the source of this node or to the source of
// unmapped nodes which have the same identity and dominating node as
// this node. This decision depends on the group which merged these
// nodes.
// Finally, if the node was mapped by a maximal group, the function fetches
// all the direct children of the source node and merges them under the
// node as well as finding all unmapped nodes whose identity matches
// this node's identity (if it is a non-terminal) and merges all
// children of these unmapped nodes too.
// Some of these node may already be in the target indexer (if they are
// at traced paths). Adding them again causes no harm (only a little 
// extra work).

MergeIndexer.prototype.inSubTreeActivated = mergeIndexerInSubTreeActivated;

function mergeIndexerInSubTreeActivated(pathNode, elementId)
{
    var elementEntry = this.dataElements.getEntry(elementId);
    var groupId = elementEntry.groupId;
    // default source ID equal to target element ID
    var sourceId = elementEntry.sourceId === undefined ?
        elementId : elementEntry.sourceId;
    
    if(groupId === undefined)
        return; // not mapped
    
    var groupEntry = this.groupById[groupId];
    var nodeEntry = pathNode.nodes.get(elementId);
    var hasAttrs = !!nodeEntry.hasAttrs;
    
    if(groupEntry.isMaxGroup && !groupEntry.isIdentityGroup && hasAttrs) {
        // copy the non-attribute list of the source node
        var nonAttrs = groupEntry.getSourceNonAttrs(pathNode,[sourceId]);
        if(nonAttrs !== undefined && nonAttrs[0] !== undefined) {
            // source node has a non-attribute list, set it on the target node
            this.setKeyValue(pathNode, elementId, "nonAttribute", undefined);
            var _self = this;
            nonAttrs[0].forEach(function(t, nonAttr) {
                _self.setKeyValue(pathNode, elementId, "nonAttribute", nonAttr);
            });
        }
    }

    // check whether there is need to register a mapping sub-tree
    // monitor for this target node
    this.addMappingMonitorForMappedNode(pathNode, groupEntry, sourceId,
                                        elementId, nodeEntry, hasAttrs); 

    if(groupEntry.isMaxGroup) {

        // need to merge the child nodes under this node. Some of these
        // may have aready been merged because of path tracing, but
        // since we do not know which nodes these are, we simply add
        // all children again.

        var dominatingId = this.getDominatingId(elementId, pathNode.pathId);
        var identity = groupEntry.getSourceIdentity(sourceId);

        if(!groupEntry.isIdentityGroup) {
            // merge the children of the source node of this node
            var dominatingIds = this.isSingleMappingResult() ?
                [dominatingId] : [[dominatingId]];
            this.mergeChildrenUnderMerged(groupEntry, pathNode,
                                          [sourceId], dominatingIds, true);
        }

        if(pathNode.nonTerminals !== undefined && hasAttrs) {
            // this is a non-terminal node, merge children of unmapped nodes
            // with matching identity
            var additionalIdentities = 
                pathNode.nonTerminals.getAdditionalIdentities(elementId);
            this.mergeUnderNode(dominatingId, pathNode, elementId, 
                                identity, false, additionalIdentities);
        } else if(this.isOperatorType(nodeEntry.type) && 
                  dominatingId != elementId) {
            // this is a data element operator, which unmapped nodes
            // of other groups may be merged under
            var additionalIdentities = pathNode.dataElementOperators.
                getAdditionalIdentities(elementId);
            this.mergeUnderNode(dominatingId, pathNode, elementId, identity,
                                true, additionalIdentities);
        }
    }
}

// This function is called when the given node, which previously was 
// inside several monitored sub-trees, has become part of only one
// monitored sub-tree, which is rooted at this node. In this case,
// if the path is an extension path of the group which mapped the node,
// we may need to register a mapping monitor to the source node of
// this node. Whether this is the case or not is determined inside
// the function addMappingMonitorForMappedNode() called by this function. 

MergeIndexer.prototype.inSubTreeOnlyAsRootActivated = 
    mergeIndexerInSubTreeOnlyAsRootActivated;

function mergeIndexerInSubTreeOnlyAsRootActivated(pathNode, elementId)
{
    var elementEntry = this.dataElements.getEntry(elementId);
    var groupEntry = this.groupById[elementEntry.groupId];
    // default source ID equal to target element ID
    var sourceId = elementEntry.sourceId === undefined ?
        elementId : elementEntry.sourceId;

    // check that this is an extension path of a maximal group
    if(!groupEntry.isMaxGroup || groupEntry.isIdentityGroup ||
       groupEntry.targetPathNode != pathNode)
        // not an extension path, if a mapping monitor is required, it
        // has already been registered.
        return;

    var nodeEntry = pathNode.nodes.get(elementId);
    
    // check whether there is need to register a mapping sub-tree
    // monitor for this target node
    this.addMappingMonitorForMappedNode(pathNode, groupEntry, sourceId,
                                        elementId, nodeEntry, 
                                        !!nodeEntry.hasAttrs);
}

// This function is called (by the base class) if this is a node in 
// a monitored sub-tree which previously did not have attributes but now does. 
// If the path node is traced, this means that previously no mapping monitor
// was registered to the source node (because without attributes all 
// required information was provided at the traced path). Therefore, we 
// now need to register a mapping monitor on the source of this node. 

MergeIndexer.prototype.inSubTreeWithAttrActivated = 
    mergeIndexerInSubTreeWithAttrActivated;

function mergeIndexerInSubTreeWithAttrActivated(pathNode, elementId)
{
    if(!pathNode.trace)
        return; // no tracing, so monitor already registered

    var elementEntry = this.dataElements.getEntry(elementId);

    if(elementEntry.groupId === undefined)
        return;

    var groupEntry = this.groupById[elementEntry.groupId];
    // default source ID equal to target element ID
    var sourceId = elementEntry.sourceId === undefined ?
        elementId : elementEntry.sourceId;
    var nodeEntry = pathNode.nodes.get(elementId);
    
    this.addMappingMonitorForMappedNode(pathNode, groupEntry, sourceId, 
                                        elementId, nodeEntry, true);
}

// This function is called when a node which was inside a monitored
// sub-tree is no longer inside any such tree. The 'onlyAsRoot' flag
// indicates whether just before the sub-tree monitoring was removed
// this node was only part of a sub-tree rooted at this node (onlyAsRoot is
// true) or not (the node was part of a sub-tree rooted at a dominating 
// node).
// This function then determines whether there are any mapping monitors
// which need to be removed. This possibly includes two types of monitors:
// those registered on the source of this node and those registered on
// unmapped nodes which have the same dominating node and identity as
// this node. In each case there a various conditions to be checked 
// to determine whether a monitor was actually registered.
// 1. Monitoring of the source of this node:
//    a. The path has no tracing or the node has attributes.
//    b. The group mapping this node is maximal and this either is 
//       the explicit target path of the group or it is an extension target 
//       path of the group and 'onlyAsRoot' is true.
// 2. Monitoring of the unmapped node with same dominating node and 
//    identity: only if this node is a non-terminal.

MergeIndexer.prototype.inSubTreeDeactivated = mergeIndexerInSubTreeDeactivated;

function mergeIndexerInSubTreeDeactivated(pathNode, elementId, onlyAsRoot)
{
    var elementEntry = this.dataElements.getEntry(elementId);
    var groupEntry = this.groupById[elementEntry.groupId];
    // default source ID equal to target element ID
    var sourceId = elementEntry.sourceId === undefined ?
        elementId : elementEntry.sourceId;
    var nodeEntry = pathNode.nodes.get(elementId);

    // check whether a mapping monitor needs to be removed from the source
    // of this node.
    this.removeMappingMonitorForMappedNode(pathNode, groupEntry, sourceId, 
                                           elementId, nodeEntry, 
                                           nodeEntry.hasAttrs, 
                                           onlyAsRoot, pathNode.trace);

    // if this is a non-terminal, check for unmapped nodes with the 
    // same identity and dominating node. Deactivate mapping monitors
    // on these nodes if mapped by a maximal group.
    this.removeMappingMonitorUnderNonTerminal(pathNode, elementId,
                                              nodeEntry);

    if(!pathNode.trace) {
        // remove the node itself 
        this.removeTargetNodes(pathNode, [elementId]);

        var dominatingId = this.getDominatingId(elementId, pathNode.pathId);
        // if this is the last child of the dominating node, should
        // also remove the unmapped nodes under this dominating node
        // (until the last child is remove we still need it, as that 
        // child may be monitored)
        if(elementId == dominatingId || 
           !this.hasDirectChildDataElements(dominatingId, pathNode.pathId))
           this.removeUnmappedNodesByDominating(pathNode, [dominatingId]);
    }
}

// This function is called when this node was previously only inside
// a sub-tree which has this node as its root and is now is part of
// one or more sub-trees which are not rooted at this node. This function
// is not called if this node is no longer inside a monitored sub-tree.
// This property has an effect on the registration of a mapping monitor
// to the source of this node in case the path is an extension target
// path of the group which mapped this node (the group must then be maximal). 
// If this is indeed the case, no mapping monitor needs to be
// registered for this node. This function then calls
// removeMappingMonitorForMappedNode() which checks whether such a
// monitor should have been registered for this node before this
// change. If it was, that function then removes the registration for
// that mapping monitor.

MergeIndexer.prototype.inSubTreeOnlyAsRootDeactivated = 
    mergeIndexerInSubTreeOnlyAsRootDeactivated;

function mergeIndexerInSubTreeOnlyAsRootDeactivated(pathNode, elementId)
{
    var elementEntry = this.dataElements.getEntry(elementId);
    var groupEntry = this.groupById[elementEntry.groupId];
    // default source ID equal to target element ID
    var sourceId = elementEntry.sourceId === undefined ?
        elementId : elementEntry.sourceId;

    if(!groupEntry.isMaxGroup || grouoEntry.isIdentityGroup ||
       groupEntry.targetPathNode == pathNode)
        return; // not an extension target path

    var nodeEntry = pathNode.nodes.get(elementId);
    this.removeMappingMonitorForMappedNode(pathNode, groupEntry, sourceId,
                                           elementId,
                                           nodeEntry, nodeEntry.hasAttrs,
                                           true, pathNode.trace);
}

// This function is called when this node, which is inside a monitored
// sub-tree previously had attributes and now has no attributes anymore
// (see definition in internalQCMINdexer.js). In this case, if the 
// path node had path tracing, we previously had to monitor the node's 
// source (to get the nodes under these attributes) while once the 
// attributes are gone, this is no longer needed. Therefore, if 
// path tracing is on for this path node, this function calles
// removeMappingMonitorForMappedNode() to check whether previously
// a mapping monitor was registered for this target node and, if yes, remove
// that registration.

MergeIndexer.prototype.inSubTreeWithAttrDeactivated = 
    mergeIndexerInSubTreeWithAttrDeactivated;

function mergeIndexerInSubTreeWithAttrDeactivated(pathNode, elementId)
{
    
    if(!pathNode.trace)
        return;

    var elementEntry = this.dataElements.getEntry(elementId);
    var groupEntry = this.groupById[elementEntry.groupId];
    // default source ID equal to target element ID
    var sourceId = elementEntry.sourceId === undefined ?
        elementId : elementEntry.sourceId;
    
    var nodeEntry = pathNode.nodes.get(elementId);
    this.removeMappingMonitorForMappedNode(pathNode, groupEntry, sourceId,
                                           elementId, nodeEntry, true,
                                           this.inSubTreeOnlyAsRoot(nodeEntry),
                                           pathNode.trace);
}

/////////////////////////
// Sub-Tree Monitoring //
/////////////////////////

// This function should be called when a mapped target node is detected
// to be inside a monitored sub-tree or the conditions of this monitoring
// has changed (one of the conditions tested below). The calling function 
// must check that previous to the change which triggered this call, 
// the conditions for registering a mapping monitor on the source of this
// node were not fulfilled. This function then checks whether such a 
// mapping monitor should now be registered.
// This function is given the mapped target node (given by its path
// and data element ID and providing its entry 'nodeEntry' in the path
// node's 'nodes' table), the group which mapped the node and the source ID
// of the node mapped to this taret node. The
// function assumes that the node is part of a monitored sub-tree and
// does not check this again. 'hasAttrs' indicates whether the node
// has any attributes. This function may be called before
// these attributes are actually registered on the node. The function then
// checks whether a mapping sub-tree monitor should be registered on
// the source of this node. If the node is at a traced path and does
// not have any attributes, there is no need to register a mapping
// monitor on the source node (the mapping query calculation node
// provides all needed information). Otherwise, we need to check
// whether a mapping monitor is required for this node. This is always
// required if the path is the target path of a maximal
// group. If the path is an extension path, this is required only if
// the target node is the root of the monitored sub-tree and is not
// part of a monitored sub-tree rooted at a higher node.
//
// If the group is a (maximal) identity group, this function returns without
// creating a mapping monitor. Identity nodes are always terminal nodes,
// even though their target nodes are non-terminal, and their value is
// fixed to their identity. Therefore, monitoring them makes no sense. 
//
// For more details, seee the introduction to the file.

MergeIndexer.prototype.addMappingMonitorForMappedNode = 
    mergeIndexerAddMappingMonitorForMappedNode;

function mergeIndexerAddMappingMonitorForMappedNode(pathNode, groupEntry,
                                                    sourceId, 
                                                    targetId, nodeEntry, 
                                                    hasAttrs)
{
    if(groupEntry.isIdentityGroup)
        return; // no monitoring of the sources of identity nodes
    
    if(pathNode.trace && !hasAttrs)
        return;

    var mappingEntry;
    if((mappingEntry = pathNode.mappingGroups.get(groupEntry.groupId)) === true)
        return; // not an extension or value target path

    if(!mappingEntry.isExtension || this.inSubTreeOnlyAsRoot(nodeEntry)) { 
        // maximal group and either value target path of maximal group
        // or extension path and in sub tree only as root
        // need to create a mapping monitor.
        this.addMappingMonitor(groupEntry, pathNode, sourceId, 1);
    }
}

// This function should be called in two situations:
// 1. when unmapped nodes are (re-)merged under non-terminal operator nodes.
//    In this case, 'allNonTerminals' is an array where each position is
//    an array with the list of operators the corresponding node was merged
//    under.
// 2. When new unmapped nodes are added and 'allNonTerminals' is an array where
//    each position stores an array with the list of non-terminals each
//    unmapped node's children could be inserted under.
// This function should not be called when the children of existing 
// unmapped nodes are merged under new non-terminals with a matching 
// identity. In this case, the monitoring, if needed is added by the 
// function which adds the children.
// 'groupEntry' should be the group which merged the umapped nodes, 
// 'targetPathNode' is the path to which they were merged and 'unmappedIds'
// are the unmapped element IDs.

MergeIndexer.prototype.addMappingMonitorUnderNonTerminals = 
    mergeIndexerAddMappingMonitorUnderNonTerminals;

function mergeIndexerAddMappingMonitorUnderNonTerminals(groupEntry, 
                                                        targetPathNode,
                                                        unmappedIds, 
                                                        allNonTerminals)
{
    if(!targetPathNode.subTree || !groupEntry.isMaxGroup ||
       groupEntry.isIdentityGroup)
        return; // no monitoring required

    for(var i = 0, l = allNonTerminals.length ; i < l ; ++i) {
        var unmappedId = unmappedIds[i];
        if(unmappedId === undefined)
            continue;
        var nonTerminals = allNonTerminals[i];
        if(nonTerminals === undefined || nonTerminals.length === 0)
            continue;
        // count the number of monitored nodes among the non-terminals
        var numMonitored = 0;
        for(var j = 0, m = nonTerminals.length ; j < m ; ++j) {
            if(this.inSubTree(targetPathNode.nodes.get(nonTerminals[j])))
                numMonitored++;
        }
        if(numMonitored !== 0)
            this.addMappingMonitor(groupEntry, targetPathNode, unmappedId, 
                                   numMonitored);
    }
}

// This function is called when the calling function has detected a 
// change which implies that the source of the given target node 
// should no longer have a mapping monitor registered to it. The calling
// function does not need to check whether the conditions for 
// registering such a mapping monitor existed before this change,
// but needs to provide this function with the information to do so.
// In addition to the group entry, the source node ID and the node entry
// for the target node it also needs to provide the flag 'hasAttrs' indicating
// whether the target node had attributes before the change,
// 'monitoeredOnlyAsRoot' indicating whether before the change this node was
// only part of a monitored sub-tree which had its root at the node and
// 'pathNodeTrace', indicating whether before the change the path node had
// path node tracing.
// This function then checks whether a mapping monitor should have
// been registered on this node based on these values. If yes, it
// removed this registration.

MergeIndexer.prototype.removeMappingMonitorForMappedNode = 
    mergeIndexerRemoveMappingMonitorForMappedNode;

function mergeIndexerRemoveMappingMonitorForMappedNode(pathNode, groupEntry, 
                                                       sourceId,
                                                       elementId, nodeEntry,
                                                       hasAttrs,
                                                       monitoredOnlyAsRoot,
                                                       pathNodeTrace)
{
    if(groupEntry.isIdentityGroup)
        return; // was not monitored
        
    if(pathNodeTrace && !hasAttrs)
        return; // was not monitored

    var mappingEntry;
    if((mappingEntry = pathNode.mappingGroups.get(groupEntry.groupId)) === true)
        return; // not an extension or target path of a maximal group

    if(!mappingEntry.isExtension || monitoredOnlyAsRoot) { 
        // either value target path of maximal group or extension path 
        // and was only in a sub-tree which had its root at this node.
        // Need to remove a mapping monitor registration
        this.removeMappingMonitor(groupEntry, pathNode, sourceId, 1);
    }
}

// This function is called when path tracing is turned off on the given
// path node. This function then checks whether there are any nodes 
// at this path which are in a monitored sub-tree and previously
// no mapping monitor was registered for them because path tracing 
// was on. This applies to nodes without attributes. This function
// therefore requests a mapping monitor to be create for node at this
// path which is inside a monitor but does not have attributes.
// The function addMappingMonitorForMappedNode() which is called
// to actually register the mapping monitor may still decide that
// no monitoring is required (based on the group of each node).

MergeIndexer.prototype.addMappingMonitorAtNoTracePath = 
    mergeIndexerAddMappingMonitorAtNoTracePath;

function mergeIndexerAddMappingMonitorAtNoTracePath(pathNode)
{
    var _self = this;
    pathNode.nodes.forEach(function(nodeEntry, elementId) {

        if(!_self.inSubTree(nodeEntry) || nodeEntry.hasAttrs)
            return; // nothing changed as a result of stopping path tracing

        var elementEntry = _self.dataElements.getEntry(elementId);
        var groupId = elementEntry.groupId;
        // default source ID equal to target element ID
        var sourceId = elementEntry.sourceId === undefined ?
            elementId : elementEntry.sourceId;
        
        _self.addMappingMonitorForMappedNode(pathNode, _self.groupById[groupId],
                                            sourceId,
                                            elementId, nodeEntry, false);
    });
}

// This function is called when path tracing is turned on on the given
// path node. This function then checks whether there are any nodes 
// at this path which are in a monitored sub-tree and do not have
// attributes. If previously a mapping monitor was registered for these
// nodes, it can now be removed (because the path tracing provides
// all the information needed for the monitoring of these target node).
// This function then calls removeMappingMonitorForMappedNode(),
// provding it with information about this node before this change.
// That function then determines whether the node required a mapping monitor
// to be registered before the change, and, if yes, removes it.

MergeIndexer.prototype.removeMappingMonitorAtTracePath = 
    mergeIndexerRemoveMappingMonitorAtTracePath;

function mergeIndexerRemoveMappingMonitorAtTracePath(pathNode)
{
    var _self = this;
    pathNode.nodes.forEach(function(nodeEntry, elementId) {
        if(_self.inSubTree(nodeEntry) && !nodeEntry.hasAttrs) {
            // there is a change as a result of activating path tracing
            var elementEntry = _self.dataElements.getEntry(elementId);
            var groupEntry = _self.groupById[elementEntry.groupId];
            // default source ID equal to target element ID
            var sourceId = elementEntry.sourceId === undefined ?
                elementId : elementEntry.sourceId;
            var inSubTreeOnlyAsRoot = _self.inSubTreeOnlyAsRoot(nodeEntry);
            _self.removeMappingMonitorForMappedNode(pathNode, groupEntry,
                                                    sourceId,
                                                    elementId, nodeEntry, false,
                                                    inSubTreeOnlyAsRoot, false);
        }
    });
}

// This function receives a target path node and a group which has
// this path as a target path (explicit or extension) and a dominating
// ID at the prefix path of the target path. The function also
// receives an object 'unmappedNodes' whose attribute are the (source)
// element IDs of unmapped nodes at 'pathNode' which are dominated by
// the node with ID 'dominatingId'. All these unmapped nodes are about
// to be removed and we need to check whether there are any mapping
// monitors for these unmapped nodes which need to be unregistered.
// Such mapping monitors will only exist if the group is a non-identity maximal
// group.  Since the same node may be unmapped under several
// dominating nodes, it may be that only some requests for the mapping
// monitor can be removed while other remain (thus not allowing the
// mapping monitor to be destroyed). Therefore, we here need to
// determine by how much the reference count for the relevant mapping
// monitor can be reduce.  This reduction is equal to the number of
// non-terminal nodes at pathNode which have the same dominating node
// and identity as the unmapped node and are inside a monitored
// sub-tree.

MergeIndexer.prototype.removeUnmappedMappingMonitorByDominating = 
    mergeIndexerRemoveUnmappedMappingMonitorByDominating;

function mergeIndexerRemoveUnmappedMappingMonitorByDominating(pathNode, 
                                                              groupEntry,
                                                              dominatingId,
                                                              unmappedNodes)
{
    if(!groupEntry.isMaxGroup || groupEntry.isIdentityGroup || 
       !this.hasMappingMonitor(groupEntry, pathNode) ||
       pathNode.nonTerminals === undefined ||
        pathNode.nonTerminals.getNum() == 0)
        return; // nothing to remove

    // loop over the unmapped nodes
    for(var sourceId in unmappedNodes) {
        
        var sourceIdentity = groupEntry.getSourceIdentity(sourceId);
        var nonTerminals = pathNode.nonTerminals.
            getNonTerminals([dominatingId], sourceIdentity, 
                            groupEntry.targetIdentificationId);
        if(!nonTerminals || nonTerminals.length == 0)
            continue; // no matching non-terminals found

        // count how many of these non-terminals are inside a monitored
        // sub-tree.
        
        var monitoredNonTerminalNum = 0;

        for(var i = 0, l = nonTerminals.length ; i < l ; ++i) {
            if(this.inSubTree(pathNode.nodes.get(nonTerminals[i])))
                monitoredNonTerminalNum++;
        }

        if(monitoredNonTerminalNum > 0)
            this.removeMappingMonitor(groupEntry, pathNode, sourceId, 
                                      monitoredNonTerminalNum);
    }
}

// This function is called when monitoring is deactivated on the node
// given by 'pathNode' and 'elementId' (with 'nodeEntry' its entry in
// the nodes table).
// The function first checks whether this is a node under which an unmapped
// node or the children of an unmapped node can be merged (this is iff
//it is a data element non-terminal operator or a standard non-terminal).
// If yes, this function then checks whether there are unmapped nodes with 
// the same domanating node and identity as this node. Such unmapped nodes
// or their children could have been merged under this node and become
// part of the monitored sub-tree. Therefore a mapping monitor may have
// been registered on these unmapped nodes and this function unregisters
// it.

MergeIndexer.prototype.removeMappingMonitorUnderNonTerminal = 
    mergeIndexerRemoveMappingMonitorUnderNonTerminal;

function mergeIndexerRemoveMappingMonitorUnderNonTerminal(pathNode, elementId,
                                                          nodeEntry)
{
    var isDataElementOperator = this.isNonTerminalOperator(pathNode, elementId);
    if(!isDataElementOperator && 
       !this.isNonTerminal(pathNode, elementId, nodeEntry))
        return; // cannot dominate unmapped nodes or their children

    if(!pathNode.unmappedNodes || !pathNode.unmappedNodes.getNum())
        return; // no unmapped nodes

    // get the dominating ID and check whether there are unmapped nodes 
    // under it
    var dominatingId = this.getDominatingId(elementId, pathNode.pathId);

    if(isDataElementOperator && (dominatingId == elementId))
        return; // not a data element, cannot dominating unmapped nodes

    if(!pathNode.unmappedNodes.getByDominating(dominatingId))
        return; // no unmapped nodes under this dominating node

    // determine the identities under which we need to look for the 
    // unmapped nodes
    
    var identity = this.dataElements.getBaseIdentity(elementId);
    
    var nonTerminals = isDataElementOperator ?
        pathNode.dataElementOperators : pathNode.nonTerminals;
    var additionalIdentities = nonTerminals.getAdditionalIdentities(elementId);

    this.removeUnmappedMappingMonitor(pathNode, dominatingId, identity,
                                      additionalIdentities);
}

// This function is called for a target node which just stopped being 
// a non-terminal node (either standard non-terminal or an data element 
// operator). This can be either as a result of a change in the
// sub-tree monitoring or a change in the status of the node as a
// non-terminal. The ID of the dominating node of this non-terminal is
// provided (this may be 0 or undefined if the node is at the
// root). The base identity of this node is provided in 'identity' and
// additional identities (as stored in the nonTerminals table of this
// path) are provided in the array 'additionalIdentities' which has
// the following format:
// [ { identity: <identity>, identification: <identification ID> },....]
// where the 'identity' field specifies the identity of this node
// under the identification with the ID in the field 'identification'.
// This function then looks up all unmapped nodes which have the same
// dominating node and identity (the identification ID must match
// the target identification of the group which merged the unmapped node).
// If the given node was a standard non-terminal the children of these 
// unmapped nodes may have been merged under the non-terminal
// an if the given node was a data element operator the unmapped
// nodes themselves may have been merged under the opwrator. 
// These nodes may therefore have been part of a monitored sub-tree when 
// the non-terminal is inside such a sub-tree and a mapping monitor
// would have been registered for the unmapped node. Therefore, if the group 
// mapping the unmapped node is maximal, a mapping sub-tree monitor 
// is derigistered here from the source of the unmapped node.

MergeIndexer.prototype.removeUnmappedMappingMonitor = 
    mergeIndexerRemoveUnmappedMappingMonitor;

function mergeIndexerRemoveUnmappedMappingMonitor(pathNode, dominatingId,
                                                  identity,
                                                  additionalIdentities)
{
    // get unmapped nodes by each of these identities (and under the 
    // dominating node). For each unmapped node, need to check whether
    // the identification used is indeed the target identification of 
    // its group (otherwise, this does not apply).

    if(additionalIdentities)
        for(var i = 0, l = additionalIdentities.length ; i < l ; ++i) {
            var additionalIdentity = additionalIdentities[i].identity;
            var identificationId = additionalIdentities[i].identification;
            this.removeUnmappedMappingMonitorByIdentity(pathNode, 
                                                        dominatingId,
                                                        additionalIdentity, 
                                                        identificationId);
        }

    // do the same for the base identity (undefined identification ID)
    this.removeUnmappedMappingMonitorByIdentity(pathNode, dominatingId,
                                                identity, undefined);
}

// This function is called for a target node which just stopped being 
// a non-terminal node (either a data-element operator or a standard
// non-terminal). This can be either as a result of a change in the
// sub-tree monitoring or a change in the status of the node as a
// non-terminal. The ID of the domianting node
// of this non-terminal is provided (this may be 0 or undefined if the node 
// is at the root). In addition, an identity of this node (under one
// of the target identifications used at this path node) is provided.
// 'identificationId' indicates which additional identification is used.
// If 'identificationId' is undefined, this is the base identity.
// This function then looks up all unmapped nodes which have the same
// dominating node and identity (the identification ID must match
// the target identification of the group which merged the unmapped node).
// If the given node was a standard non-terminal the children of these 
// unmapped nodes may have been merged under the non-terminal
// an if the given node was a data element operator the unmapped
// nodes themselves may have been merged under the opwrator. 
// These nodes may therefore have been part of a monitored sub-tree when 
// the non-terminal is inside such a sub-tree and a mapping monitor
// would have been registered for the unmapped node. Therefore, if the group 
// mapping the unmapped node is maximal, a mapping sub-tree monitor 
// is derigistered here from the source of the unmapped node.

MergeIndexer.prototype.removeUnmappedMappingMonitorByIdentity = 
    mergeIndexerRemoveUnmappedMappingMonitorByIdentity;

function mergeIndexerRemoveUnmappedMappingMonitorByIdentity(pathNode, 
                                                            dominatingId,
                                                            identity, 
                                                            identificationId)
{
    if(!pathNode.unmappedNodes)
        return;

    if(dominatingId === undefined)
        dominatingId = 0;
    
    var byGroup = pathNode.unmappedNodes.getByIdentity(identity, dominatingId);
    if(!byGroup) // no matching unmapped nodes
        return;
    for(var groupId in byGroup.groups) {
        // check that this group is a maximal group and that it 
        // uses this identification.
        var groupEntry = this.groupById[groupId];
        if(!groupEntry.isMaxGroup || groupEntry.isIdentityGroup ||
           groupEntry.targetIdentificationId != identificationId)
            continue;
        // remove a mapping sub-tree monitor for these unmapped nodes
        for(var sourceId in byGroup.groups[groupId].nodes)
            this.removeMappingMonitor(groupEntry, pathNode, sourceId, 1);
    }
}

// This function is called for a source node merged to the given target
// path node by the given group (which should always be a maximal group).
// The node may be mapped or unmapped. The target path may be either 
// an explicit target path of the group or an extension target path
// of the group. This function then finds the source path for the given
// group and target path and registers a mapping sub-tree monitor on the
// source node at that path.
// 'refCount' indicates the number of sub-tree monitoring requests 
// at the target indexer which required this monitoring. This reference
// count is later required to properly remove the monitoring. 

MergeIndexer.prototype.addMappingMonitor = 
    mergeIndexerAddMappingMonitor;

function mergeIndexerAddMappingMonitor(groupEntry, targetPathNode, 
                                       sourceElementId, refCount)
{
    if(groupEntry.isIdentityGroup)
        // the nodes mapped by an identity group are virtual and cannot
        // be monitored at the source
        return;
        
    // get the monitor object (there is one for all nodes merged by this
    // group and source path). If no such object exists, it is created.
    if(!groupEntry.subTreeMonitors) {
        groupEntry.subTreeMonitors = {};
        groupEntry.sourcePathMapping = {};
    }
    
    var monitor = groupEntry.subTreeMonitors[targetPathNode.pathId];

    if(!monitor) {
        // create a new monitor (this also registers it to the source indexer
        // at the source path.
        var targetPathId = targetPathNode.pathId;
        var sourcePathId = this.getSourcePathId(groupEntry, targetPathId);
        groupEntry.subTreeMonitors[targetPathId] =
            new MappingMonitor(this, groupEntry, sourcePathId);
        groupEntry.sourcePathMapping[sourcePathId] = targetPathId; 
    }

    // register this monitor on the specific source element ID
    monitor.registerOn(sourceElementId, refCount);
}


// an undefined refCount means 'remove completely'.

MergeIndexer.prototype.removeMappingMonitor = 
    mergeIndexerRemoveMappingMonitor;

function mergeIndexerRemoveMappingMonitor(groupEntry, targetPathNode, 
                                          sourceElementId, refCount)
{
    if(groupEntry.isIdentityGroup)
        // the nodes mapped by an identity group are virtual and cannot
        // be monitored at the source
        return;
    
    // get the monitor object
    var monitor;
    if(!groupEntry.subTreeMonitors || 
       !(monitor = groupEntry.subTreeMonitors[targetPathNode.pathId]))
        return; // nothing to remove
    
    monitor.unregisterFrom(sourceElementId, refCount);
    if(monitor.getNumMonitored() == 0) {
        monitor.destroy();
        delete groupEntry.subTreeMonitors[targetPathNode.pathId];
    }
}

// This function returns true if the given group has a mapping monitor
// for the nodes at the given target path.

MergeIndexer.prototype.hasMappingMonitor = 
    mergeIndexerHasMappingMonitor;

function mergeIndexerHasMappingMonitor(groupEntry, targetPathNode)
{
    return (groupEntry.subTreeMonitors !== undefined && 
            (targetPathNode.pathId in groupEntry.subTreeMonitors));
}

// given is a group entry and a source path ID which is either the source
// path of the group or (if the group is maximal) an extension of the
// source path. If the path is the source path of the group, the function
// simply returns the target path of the group (which must have been
// created when the group was created). If the source path ID is an extension
// path, this function first checks whether it already appears in the 
// 'sourcePathMapping' table of the group. If not, the corresponding 
// target path ID is calculated and stored in this table. Having found
// the target path ID, this function looks for the target path node.
// If it does not exist, it is created. The function returns the target path
// node.
// If the target path calculated exists and is marked as a non-extension
// path, this function returns 'undefined' (the given group is blocked
// from being extended to this path).
// This function is especially useful for paths which are monitored
// (under some nodes) but do not have path tracing. In this case, it is
// possible that the corresponding target path node does not exist. 

MergeIndexer.prototype.getMonitoredTargetPath = 
    mergeIndexerGetMonitoredTargetPath;

function mergeIndexerGetMonitoredTargetPath(groupEntry, sourcePathId)
{
    var targetPathId;
    var targetPathNode;

    if(sourcePathId == groupEntry.sourcePathId)
        return groupEntry.targetPathNode;

    if(!(targetPathId = groupEntry.sourcePathMapping[sourcePathId])) {
        // calculate the path mapping and store in the table for
        // future use
        var pathDiff =
            this.qcm.diffPathId(sourcePathId, groupEntry.sourcePathId);
        targetPathId = 
            this.qcm.allocateConcatPathId(groupEntry.targetPathNode.pathId,
                                          pathDiff);
        // cache this calculation
        groupEntry.sourcePathMapping[sourcePathId] = targetPathId;
        if(!(targetPathNode = this.pathNodesById[targetPathId]))
            // create the path node
            targetPathNode = this.addPath(targetPathId);
        if(targetPathNode.nonExtensionPath)
            return undefined; // group cannot be extended to this target path
        // register the group to the path
        groupEntry.addMappingGroupToPath(targetPathNode, false);
        // need to release this allocated path ID (it is now stored
        // in the path node.
        this.qcm.releasePathId(targetPathId);
    } else
        targetPathNode = this.pathNodesById[targetPathId];

    return targetPathNode;
}

// This function receives an update from a mapping monitor registered
// by the group with the given ID. The 'updates' are an array of entries
// of the form:
//    {
//        sourcePathId: <source path of the update>,
//        elementId: <element ID identifying the node at the source path
//                    where the update occured>,
//        type: <the type of the node after the update (undefined for removal)>,
//        key: <the simple key value (undefined if removal)>
//    }
// The updates should be handled in the order in which they appear in 
// the array, as a later entry for the same source node may override
// an earlier change.
// Because of the way the source indexer updates the monitors (in the 
// path node update epilog) it is likely (though should not be assumed)
// that updates are grouped in the array by their source ID.
// This function makes use of this fact.
// This function may receive an update for an extension source path of
// the group such that the corresponding extension target path node
// was not yet created. In this case, it creates the path node.

MergeIndexer.prototype.mappingMonitorUpdate = 
    mergeIndexerMappingMonitorUpdate;

function mergeIndexerMappingMonitorUpdate(groupId, updates)
{
    var groupEntry = this.groupById[groupId];
    var sourcePathId;
    var targetPathNode;
    

    for(var i = 0, l = updates.length ; i < l ; ++i) {
        
        var update = updates[i];

        if(sourcePathId != update.sourcePathId) {
            sourcePathId = update.sourcePathId;
            targetPathNode = this.getMonitoredTargetPath(groupEntry, 
                                                         sourcePathId);
        }

        if(targetPathNode === undefined)
            // this group cannot be extended to map from this source path
            // (because the corresponding target path is marked as a
            // non-extension path). Ignore this update
            continue;
        
        if(targetPathNode == groupEntry.targetPathNode)
            // just add add the key, the node should already be there
            this.setKeyValue(targetPathNode, update.elementId, update.type, 
                             update.key);
        else if(update.type !== undefined)
            // add this node
            this.mergeAtExtensionPath(groupEntry, targetPathNode,
                                      [update.elementId], false, true);
        else // remove this node
            this.removeAtExtensionPath(groupEntry, sourcePathId,
                                       targetPathNode, [update.elementId]);
    }
}

////////////////////////////////////
// Match and Key Update Functions //
////////////////////////////////////

// This function is called by a mapping to add nodes being mapped by it.
// This mapping must have previously been registered to the merge indexer
// under 'resultId' and 'projId'. This function then 
// looks up the mapping entry defined by these two IDs and finds
// the 'groups' array of this mapping (this is the array defining the
// mapping groups to which this mapping belongs). This function then
// merges the source nodes given in 'matches' based on the information
// stored in the group entries for the groups this mapping belongs to.
// In addition, for nodes in 'matches' which dominate data nodes in 
// the source indexer, those dominated nodes are also mapped if the 
// corresponding (extension) target path nodes require tracing.

MergeIndexer.prototype.addProjMatches = mergeIndexerAddProjMatches;

function mergeIndexerAddProjMatches(matches, resultId, projId)
{
    // get the 'groups' array for this function result and 
    // projection ID.

    var projEntry = this.getProjEntry(resultId, projId);

    if(projEntry === undefined)
        return;
    
    projEntry.matchesAdded = true; // about to add matches
    var groups = projEntry.groups;

    var mergeResult = this.mergeAtMaximalPath(groups, matches, resultId,
                                              projId);
    // subset of 'matches' which were merged (in case of multiple projections
    // in the group, some of 'matches' may have been merged already). 
    var matchesMerged = mergeResult[0];
    // dominating target nodes for the children of the nodes merged
    var allDominatingIds = mergeResult[1]; 

    var maximalGroup = groups[0];
    
    // no extension paths under a maximal identity group
    if(allDominatingIds === undefined || maximalGroup.isIdentityGroup)
        return;

    // continue to merge the children of the nodes added
    this.mergeChildrenUnderMerged(maximalGroup, maximalGroup.targetPathNode,
                                  matchesMerged, allDominatingIds); 
}

// This function is called by a mapping query calculation node
// (given as the argument 'mappingQueryCalc'). It is called when
// 'matches' (an array of element IDs) are nodes added at the source path
// to which the mapping query calculation is registered, which must be
// an extension path for the group to which the mapping query calculation
// node belongs.
// The matches are not necessarily dominated by matches of the projection
// (at the explicit maximal path) so this function first filters only
// those matches dominated by the elements projected by the group
// at the explicit path. It then adds those matches.

MergeIndexer.prototype.addExtensionMatches = mergeIndexerAddExtensionMatches;

function mergeIndexerAddExtensionMatches(matches, mappingQueryCalc)
{
    // get the group entry
    var groupEntry = this.groupById[mappingQueryCalc.groupId];
    var sourcePathId = mappingQueryCalc.getSourcePathId();
    var targetPathNode = mappingQueryCalc.targetPathNode;
    
    // filter only nodes which are dominated by the source nodes
    // mapped by the group to the explicit target path

    var sourceIds = groupEntry.getSourceNodesDominatedBy(matches,
                                                         sourcePathId);

    if(sourceIds.length === 0)
        return;
    
    // add these nodes (we can assume that the dominating nodes were
    // already merged, as paths are updated at increasing length)
    this.mergeAtExtensionPath(groupEntry, targetPathNode, sourceIds,
                              true, undefined);
}

// This function is called by a mapping to remove nodes being mapped by it.
// This mapping must have previously been registered to the merge indexer
// under 'resultId' and 'projId'. This function then 
// looks up the mapping entry defined by these two IDs and finds
// the 'groups' array of this mapping (this is the array defining the
// mapping groups to which this mapping belongs). This function then
// decreases the reference count for each source node in 'matches'
// and source nodes dominating it on the target path nodes to
// which they are mapped by this mapping. The nodes which reach 
// a reference count of 0 are then removed (bottom up). When a node
// is removed, all nodes it dominates are also removed.

MergeIndexer.prototype.removeProjMatches = mergeIndexerRemoveProjMatches;

function mergeIndexerRemoveProjMatches(matches, resultId, projId)
{
    // get the 'groups' array for this function result and 
    // projection ID.
    var groups = this.getProjGroupSequence(resultId, projId);
    this.removeAtMaximalPath(groups, matches, resultId, projId);
}

// This function is called by a mapping query calculation node
// (given as the argument 'mappingQueryCalc'). It is called when
// 'matches' (an array of element IDs) are nodes just removed at the source path
// to which the mapping query calculation is registered, which must be
// an extension path for the group to which the mapping query calculation
// node belongs.
// This function fetches the group and path information from the
// mapping query calculation node and calls 'removeAtExtensionPath()'
// which does all the rest of the work.

MergeIndexer.prototype.removeExtensionMatches =
    mergeIndexerRemoveExtensionMatches;

function mergeIndexerRemoveExtensionMatches(matches, mappingQueryCalc)
{
    // get the group entry
    var groupEntry = this.groupById[mappingQueryCalc.groupId];
    var sourcePathId = mappingQueryCalc.getSourcePathId();
    var targetPathNode = mappingQueryCalc.targetPathNode;

    this.removeAtExtensionPath(groupEntry, sourcePathId, targetPathNode,
                               matches);
}

//////////////////////////////
// Merge Addition Functions //
//////////////////////////////

// This function is to be called for a set (array) of source element IDs
// added by a mapping (through a call to the 'addProjMatches()' function).
// 'sourceElementIds' are the source data element IDs of the nodes added by the 
// mapping through the 'addProjMatches()' function and 'groups' is the
// array of group objects for this mapping (ordered by decreasing 
// source path length). 'sourceElementIds' are nodes mapped by the 
// maximal group in 'groups'. 'resultId' and 'projId' identify the
// projection which added the matches.
// This function first notifies the MergeGroup of the maximal group
// (and through it, recurively, also the MergeGroup objects of the
// other groups) that these source element IDs were added. The merge
// group object then take care of reference counting (if needed) of
// conversion to identity node IDs (in an identity group) and returns
// an array of arrays which describes the nodes to be merged in the
// different groups (for the exact description of this object, see the
// documentation of MergeGroup). These arrays indicate which nodes needed
// to be mapped and contains additional information to determine the
// dominating nodes under which they need to be mapped (if such information
// is needed). Specifically, if the target path of the minimal group is
// not the root path, the parent element IDs of the nodes mapped by the
// minimal group are provided in the last of the arrays returned.
// This function then finds the dominating nodes (for each of the
// positions in the array) whose identity is the same as the identity
// of the nodes provided in this 'parent' array.
// The function then adds the nodes for all the groups and
// returns an array of two arrays:
// 1. The first array is a subset of the array 'sourceElementIds'
//    and contains those element Ids in the original array which were not
///   added before (they may have been added only if there are multiple
//    projection in the maximal group).
// 2. The second array contains, at each position corresponding to an
//    element ID in the original array, an array of dominating target
//    element IDs (or a single ddominating element ID in case there is
//    a single result function mapping to the indexer) under which
//    the children of the corresponding source
//    element can be merged. I case of arrays of dominating nodes, Some
//    of these arrays may be empty.

MergeIndexer.prototype.mergeAtMaximalPath = 
    mergeIndexerMergeAtMaximalPath;

function mergeIndexerMergeAtMaximalPath(groups, sourceElementIds, resultId,
                                        projId)
{
    // returns an array of arrays with each array indicating the
    // source IDs which should be added for the coresponding group in 'groups'
    // The last array are the source nodes which determine the dominating
    // nodes if the minimal target path is not the root path.
    var nodesToMerge = groups[0].addSourceElements(sourceElementIds,
                                                   resultId, projId);
    var lastGroup = groups.length - 1;

    // if the target path node is not the root path, replace the last
    // array with the dominating nodes based on the identities of
    // its elements
    if(groups[lastGroup].targetPathNode.parent !== undefined) {
        nodesToMerge[lastGroup+1] =
            this.getDominatingByGroup(groups[lastGroup],
                                      nodesToMerge[lastGroup+1]);
    }

    // should the last array be merged, or does it only provide information
    // about the merging of the previous array?
    var mergeLastArray = groups.length == nodesToMerge.length;
    
    // merge the nodes and return the nodes merged by the max group and the
    // dominating target nodes under which they should be mapped.
    return [nodesToMerge[0], this.mergeDominationSequence(groups, nodesToMerge,
                                                          mergeLastArray)];
}

// This function merges a set of nodes mapped by a projection, together
// with some of their dominating source nodes. 'groups' is an array
// holding the sequence of groups (MergeGroup objects) for the projection
// which mapped the elements (the lit of groups begins with the maximal group
// and ends with the minimal group). 'nodesToMerge' is an array of arrays,
// each array being a list of source elements to be merged by the
// group at the corresponding position in 'groups'. 'nodesToMerge' may be
// shorter than 'groups', of equal length or longer by 1. The last array
// does not contain source IDs, but each entry stores an array of target
// dominating nodes (or a single target dominating node, in case there is
// a single function result mapping to the indexer) to merge the source
// element in the previous array under.
// The only exception is when the minimal group's target path is the root
// path, in which case the next array in the list (the one following
// the array for the minimal group) is either omitted or contains
// 'undefined' and defined values which simply indicate whether the
// elements in the corresponding position in the minimal group's array
// are newly merged or were merged already.
// The function proceeds to merge each array of source elements, beginning
// at the end of 'nodesToMerge'. 'mergeLastArray' indicates whether the
// last array contains nodes to merge or whether it merely provides
// information for the merging of the nodes in the previous array.
// After merging the nodes for each group, a set of dominating nodes
// is created for the merging of he children of these nodes (the next
// array to be merged or, in the case of the last array merged, for the
// children of the source nodes which may be merged by some other function).
// The function returns the array of dominating node arrays produced by the
// merging of the source nodes for the maximal group (the last merge which
// takes place).
// When merging takes place to a target path which does not have tracing,
// only nodes under monitored dominating nodes are merged. In this case,
// the input 'nodesToMerge' arrays are filtered and replaced by the
// filtered arrays. The original arrays remain unchanged (though they
// are not stored in the 'nodesToMerge' array anymore) so the calling function
// may sore them in advance if it so wishes to do.

MergeIndexer.prototype.mergeDominationSequence = 
    mergeIndexerMergeDominationSequence;

function mergeIndexerMergeDominationSequence(groups, nodesToMerge,
                                             mergeLastArray) 
{    
    var lastToMerge = nodesToMerge.length - (mergeLastArray ? 1 : 2);
    // the dominating 
    var childDominatingIds = nodesToMerge[lastToMerge+1]; // may be undefined
    // true when only nodes dominated by monitored dominating nodes
    // are merged
    var monitoredOnly = false;
    // positions in the original arrays which are dominated by monitored
    // dominating IDs (only if there is no tracing on some node)
    var filteredPos;
    
    // loop along the nodes to merge for each group, from the shortest
    // path group to the maximal group
    for(var i = lastToMerge; i >= 0 ; i--) {
        var targetPathNode = groups[i].targetPathNode;
        var sourceIds = nodesToMerge[i];
        
        if(monitoredOnly) {
            if(filteredPos !== undefined && filteredPos !== true &&
               filteredPos.length < sourceIds.size) {
                var filteredSourceIds = [];
                for(var j = 0, m = filteredPos.length ; j < m ; ++j)
                    filteredSourceIds.push(sourceIds[filteredPos[j]]);
                sourceIds = filteredSourceIds;
            }
        } else if(!targetPathNode.trace) {
            var parentPathNode = targetPathNode.parent;
            if(childDominatingIds !== undefined &&
               parentPathNode !== undefined) {
                // filter only nodes dominated by monitored dominating nodes
                // (since there is no tracing, all other nodes do not need
                // to be mapped).
                var filtered =
                    this.filterSourceByMonitoredDominating(sourceIds,
                                                           childDominatingIds,
                                                           parentPathNode,
                                                           true, i > 0);
                childDominatingIds = filtered.allDominatingIds;
                sourceIds = filtered.sourceIds;
                filteredPos = filtered.filteredPos;
            } else {
                // root path not yet activated, so don't map any nodes yet
                // (will be mapped when the path node is later activated
                childDominatingIds = [];
                sourceIds = [];
                filteredPos = [];
            }
            monitoredOnly = true;
        }

        nodesToMerge[i] = sourceIds;
        
        childDominatingIds = this.addMergedNodes(groups[i], targetPathNode,
                                                 sourceIds, childDominatingIds);
    }

    return childDominatingIds;
}

// This function is given the group entry for a maximal group together 
// with an extension target path. The function also receives a list of
// source element ID for nodes at the corresponding source path node.
// The function then tries to merge these source nodes (and returns an
// array with the target IDs under which to merge their children).
// If 'dominatingMerged' is true, this function may assume that the
// dominating source nodes at the parent source path were already
// merged. Otherwise, the function tries to merge those first.
// If 'mergeUnderMonitored' is true, this function only merges under
// dominating nodes which are monitored. If it is false, it only merges
// under dominating nodes which are not monitored. If it is undefined,
// the function merges under both. If there is no tracing on the target path,
// it is as if 'mergeUnderMonitored' is true.

MergeIndexer.prototype.mergeAtExtensionPath = 
    mergeIndexerMergeAtExtensionPath;

function mergeIndexerMergeAtExtensionPath(groupEntry, targetPathNode, sourceIds,
                                          dominatingMerged, mergeUnderMonitored)
{
    var parentPath = targetPathNode.parent;
    
    // get the dominating nodes at the prefix source path
    var sourceDominatingIds =
        groupEntry.getDominatingSourceNodes(targetPathNode, sourceIds);

    var dominatingIds;
    
    if(!dominatingMerged && parentPath !== groupEntry.targetPathNode) {
        // the dominating nodes may not have been merged yet. Merge
        // them first.
        dominatingIds = this.mergeAtExtensionPath(groupEntry, parentPath,
                                                  sourceDominatingIds, false,
                                                  mergeUnderMonitored);
    } else
        // Find the target dominating IDs to merge under based on the source
        // dominating IDs
        dominatingIds = this.getAllDominatingByMerged(groupEntry, parentPath,
                                                      sourceDominatingIds);

    // filter first so as to only merge under monitored/not monitored

    if(!targetPathNode.trace)
        mergeUnderMonitored = true;

    if(mergeUnderMonitored === undefined) // no filtering by yes/no monitored
        return this.addMergedNodes(groupEntry, targetPathNode, sourceIds,
                                   dominatingIds);
    
    var filtered = 
        this.filterSourceByMonitoredDominating(sourceIds, dominatingIds,
                                               parentPath, mergeUnderMonitored);
    
    return this.addMergedNodes(groupEntry, targetPathNode, filtered.sourceIds,
                               filtered.allDominatingIds);
}

////////////////////////////
// Node Merging Functions //
////////////////////////////

// Remark: in the functions below, we often use an array of arrays
// to define the list of dominating nodes under which each source node
// needs to be merged. If there is a single function result defined in the
// indexer, there can only be one dominating node, so instead of using
// an array of arrays, the relevant functions use an array of dominating IDs.

// The following function is to be called to merge the nodes whose source
// IDs are given by the array 'sourceIds' (an array of source element IDs)
// mapped by the group whose MergeGroup entry is 'groupEntry'. The source
// nodes are those the merge group decided should be added, so any reference
// counting or conversion to identity node IDs ha already taken place.
// The target path node is given 'tagetPathNode' (which is either the explicit
// target path of the group or, in case of a maximal group, may also be
// an extension path).
// 'allDominatingIds' is an array where each position in the array indicates
// the target element IDs under which the source ID at the corresponding
// position in the 'sourceIds' array is to be merged. This array may be
// undefined if the target path node is the root path node. In this case
// the dominating element ID array may also be defined in case merging
// takes place under dominating operators (also at the root path).
// When there is only one function result mapping to the merge indexer
// (that is, this.isSingleMappingResult() true) every node may only be merged
// under a single domination element and therefore the array 'allDominatingIds'
// is an array of element IDs. In other cases, where a node may be
// meged under multiple dominating node (in case of merging by identity
// between diferent groups of different function results) 'allDominatingIds'
// is an array of arrays (where each position in 'allDominatingIds'
// carries an array of dominating nodes for the source ID in the corresponding
// position in the array 'sourceIds'). Some of the positions in
// 'allDominatingIds' may be undefined of an empty array (in which case
// there are no dominating nodes to merge under).

MergeIndexer.prototype.addMergedNodes =
    mergeIndexerAddMergedNodes;

function mergeIndexerAddMergedNodes(groupEntry, targetPathNode,
                                    sourceIds, allDominatingIds)
{
    if(!groupEntry.isMaxGroup) {
        // if raising to operators is needed, perform the merging of those
        // operators here (if not needed, this returns immediately returning
        // the input 'allDominatingIds'
        allDominatingIds =
            this.addMergedOperatorNodes(groupEntry, targetPathNode,
                                        sourceIds, allDominatingIds);
    }

    return this.addMergedNodesWithoutRaising(groupEntry, targetPathNode,
                                             sourceIds, allDominatingIds);
}

// This function performs a single step in the merging of the source
// nodes in the array 'sourceIds' mapped by the group 'groupEntry'
// to the target path 'targetPathNode' under the dominating nodes
// 'allDominatingIds' (where each entry in the array 'allDominatingIds'
// holds a dominating node ID or an array of dominating node IDs (depending
// on whether the number of function results mapping to the merge indexer
// is one or more) for the source node in the
// corresponding position in the array 'sourceIds').
// This function handles the case where some of the nodes in
// 'sourceIds' are operands and their operators must still be merged.
// This can happen only for non-maximal groups since maximal groups
// map the merged nodes from the operator down to the operands.
// In case this function is called (for a non-maximal group) and some
// source IDs are operands, the operators dominating them
// must first be merged. This function goes over 'sourceIds'
// and checks which of the elements are operands and then merges their
// dominating operators. The function then returns a new array of
// dominating elements (to replace 'allDominatingIds') such that in case
// of operands, the new dominating ID is based on the merging of the
// operator (this determines the dominating ID for the corresponding
// elements in 'sourceIds').
// Where 'allDominatingIds' has an undefined entry, the corresponding
// source ID has already been merged, so this function skips it.
// If the target path node is the root target path, 'allDominatingIds'
// does not hold dominating nodes (as there is no prefix target path)
// but, instead, the element ID of the highest operator dominating
// the source ID which was not yet merged (this may be equal to the source ID
// if the operator above it was already merged). At other target paths,
// the 'allDominatingIds' holds the dominating node(s).
// Since there may be several stacked operators, this function may
// call itself recursively.
// In case there are no operands at the source (or none of 'sourceIds'
// are operands), this function returns the input 'allDominatingIds' array.

MergeIndexer.prototype.addMergedOperatorNodes =
    mergeIndexerAddMergedOperatorNodes;

function mergeIndexerAddMergedOperatorNodes(groupEntry, targetPathNode,
                                            sourceIds, allDominatingIds)
{
    if(groupEntry.isMaxGroup || !groupEntry.sourcePathHasOperands())
        return allDominatingIds; // no operands to raise

    // raise all source nodes to the directly dominating operators

    var raised = groupEntry.getDirectDominatingOperators(sourceIds);

    if(raised === undefined)
        return allDominatingIds; // no operands to raise

    // call this function recursively on the list of operators, in case
    // they need to be raised again (but first, remove nodes which do not
    // need to be merged).
    var pos = [];
    var operators = []; 
    var raisedAllDominatingIds = [];
    
    for(var i = 0, l = raised.pos.length ; i < l ; ++i) {
        var iPos = raised.pos[i];
        if(allDominatingIds[iPos] === undefined)
            continue; // node was already merged
        pos.push(iPos);
        operators.push(raised.operators[i]);
        raisedAllDominatingIds.push(allDominatingIds[iPos]);
    }

    if(pos.length == 0)
        return allDominatingIds; // no raising of nodes to be merged
    
    raisedAllDominatingIds = 
        this.addMergedOperatorNodes(groupEntry, targetPathNode, operators,
                                    raisedAllDominatingIds);

    // use standard merging for the operators and the dominating IDs
    // returned (which already provide direct dominating target nodes).

    var operatorDominatingIds =
        this.addMergedNodesWithoutRaising(groupEntry, targetPathNode,
                                          operators, raisedAllDominatingIds);

    // create the new dominating ID list (replacing the original with those
    // returned above for operators).
    
    var newAllDominatingIds = [].concat(allDominatingIds);
    for(var i = 0, l = pos.length ; i < l ; ++i) {
        var iPos = pos[i];
        newAllDominatingIds[iPos] = operatorDominatingIds[iPos];
    }

    return newAllDominatingIds;
}

// This function merges the source nodes 'sourceIds' (an array of element IDs)
// which are mapped by the group 'groupEntry' to target path 'tagetPathNode'.
// Each element in 'sourceIds' is merged under the dominating IDs
// which appear under the corresponding poition in the array
// 'allDominatingIds' (an array element IDs or of arrays of element IDs, as
// explained in 'addMergedNodes'). This function is called
// when it is known that there is no need to merge any operators
// directly dominating the nodes in 'sourceIds'. For source nodes which
// are operands, the mapping of their dominating operator should have
// already taken place and the dominating IDs are based on the mapping of
// those operators (that is, the domianting ID may be at the target path
// rather than its prefix).
// This function can be called either after applying 'addMergedOperatorNodes()'
// (in case operators dominating the source IDs still need to be mapped)
// or directly if it is known that this is not the case (for example,
// for a maximal group or when the source path does not have operands).

MergeIndexer.prototype.addMergedNodesWithoutRaising =
    mergeIndexerAddMergedNodesWithoutRaising;

function mergeIndexerAddMergedNodesWithoutRaising(groupEntry, targetPathNode,
                                                  sourceIds, allDominatingIds)
{
    var childDominatingIds;
    
    if(this.numProjs == 1 && !groupEntry.hasIdentityPrefixGroup()) {
        // simplest case: a single projection to the indexer, so source
        // nodes are mapped under their original source ID and
        // there are no conflicts.
        childDominatingIds = 
            this.addMergedNodesWithSingleProj(groupEntry, targetPathNode,
                                              sourceIds, allDominatingIds);
    } else if(this.isSingleMappingResult()) {
        // a single function result but multiple projection, so there are
        // no conflicts with other groups or merging by identity, but
        // if two groups map the same element ID, there may be need to
        // map source element IDs to new target element IDs.
        childDominatingIds =
            this.addMergedNodesWithSingleResult(groupEntry, targetPathNode,
                                                sourceIds, allDominatingIds);
    } else if(targetPathNode.minGroupPriority ==
              targetPathNode.maxGroupPriority) {
        // single priority, so there can be no conflicts
        childDominatingIds =
            this.addMergedNodesWithoutConflicts(groupEntry, targetPathNode,
                                                sourceIds, allDominatingIds);
    } else {
        // remaining general case
        childDominatingIds =
            this.addMergedNodesWithConflicts(groupEntry, targetPathNode,
                                             sourceIds, allDominatingIds);
    }

    if(targetPathNode.parent === undefined &&
       targetPathNode.priority === -Infinity && targetPathNode.nodes.size > 0)
        // just in case this wasn't set by any of the function above
        targetPathNode.priority = groupEntry.priority;
    
    return childDominatingIds;
}


// This function merges the source nodes 'sourceIds' (an array of element IDs)
// which are mapped by the group 'groupEntry' to target path 'tagetPathNode'.
// Each element in 'sourceIds' is merged under the dominating ID
// which appears under the corresponding poition in the array
// 'allDominatingIds' (an array of element IDs). This function is called
// when it is known that there is a single projection mapping to the target
// indexer, so source nodes are mapped under their original source ID and
// there can be no conflicts. This function is also called after any operators
// dominating the nodes in 'sourceIds' have already been merged.
// When the dominating node in 'allDominatingIds' is undefined, this
// means that the corresponding element was already mapped, so there is
// no need to map it again (this can happen if raising takes place).
// The function returns the list of dominating IDs under which to
// map the children of these nodes, which is simple the input array
// 'sourceIds'.

MergeIndexer.prototype.addMergedNodesWithSingleProj =
    mergeIndexerAddMergedNodesWithSingleProj;

function mergeIndexerAddMergedNodesWithSingleProj(groupEntry, targetPathNode,
                                                  sourceIds, allDominatingIds)
{        
    if(allDominatingIds === undefined || groupEntry.isIdentityGroup) {
        // add as data elements, target IDs equal to source IDs
        this.addNodesAndValues(groupEntry, targetPathNode, sourceIds,
                               sourceIds, allDominatingIds, true);
        return sourceIds;
    }

    if(!groupEntry.hasSourceDataElements(targetPathNode)) {
        // add as non-data elements (target IDs equal to source IDs)
        this.addNodesAndValues(groupEntry, targetPathNode, sourceIds,
                               sourceIds, allDominatingIds, false);
        return sourceIds;
    }
    
    // some of the source IDs may be data elements, so split into
    // two lists: data elements 'd' and non-data elements 'nd'. We can
    // identify them by being different from their dominating ID.
    
    var catSourceIds = { d: [], nd: [] };
    var catDominatingIds = { d: [], nd: [] };
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var sourceId = sourceIds[i];
        var dominatingId = allDominatingIds[i];
        if(sourceId === undefined || dominatingId === undefined)
            continue; // no need to map
        if(sourceId === dominatingId) { // not data elements
            catSourceIds.nd.push(sourceId);
            catDominatingIds.nd.push(dominatingId);
        } else { // data elements
            catSourceIds.d.push(sourceId);
            catDominatingIds.d.push(dominatingId);
        }
    }
    if(catSourceIds.d.length > 0)
        this.addNodesAndValues(groupEntry, targetPathNode, catSourceIds.d,
                               catSourceIds.d, catDominatingIds.d, true);

    if(catSourceIds.nd.length > 0)
        this.addNodesAndValues(groupEntry, targetPathNode, catSourceIds.nd,
                               catSourceIds.nd, catDominatingIds.nd, false);
    
    return sourceIds; // the dominating nodes for the next step
}

// This function merges the source nodes 'sourceIds' (an array of element IDs)
// which are mapped by the group 'groupEntry' to target path 'tagetPathNode'.
// Each element in 'sourceIds' is merged under the dominating ID
// which appears under the corresponding position in the array
// 'allDominatingIds' (an array of element IDs). This function is called
// when it is known that there is a single function result mapping to
// the target indexer, but multiple projections (otherwise the function
// addMergedNodesWithSingleProj() is called). This means that all groups have
// the same priority and, therefore, all nodes are mapped and there is
// no merging by identities (and, in other words, the dominating node
// for each source node has been mapped by the same group or by the
// prefix group). This also means that each node is merged under
// a single dominating node. However, it may happen that multiple groups
// map nodes to the same target path and under the same dominating node
// and therefore the mapped elements must be assigned new data element IDs.
// It is also possible that the same path in the source indexer is
// mapped to more than one target path. If that path carries data elements,
// these must be mapped to new data elements (as we cannot have a data element
// with the same ID at two different paths). The first case (multiple
// groups mapping to the same target path) is covered by the group's
// 'obligatoryDataElements' property, which is set when there are two
// groups with the same prefix group and same priority. When this property
// is set, this function assigns new target element IDs to the mapped
// nodes. In addition, if the dominating element IDs are larger than the
// mapped element IDs, this means that the dominating IDs were already
// translated (if they were not, they would have been mapped from a dominating
// node in the source indexer and therefore would have had a smaller or
// equal element ID). The mapped nodes are then either equal to the dominating
// IDs (if the dominating IDs were mapped from the same source IDs)
// or assigned new element IDs. This covers both the case where two
// groups map to the same target path but have different prefix groups
// (the element ID translation then takes place in the prefix groups and
// this results in higher dominating ID) and the case where the same
// path is mapped to two different target paths (at the common prefix of
// these two target paths there must be two groups mapping to that path
// and therefore new target element IDs will already be assigned there,
// resulting in higher dominating node IDs).

// xxxxxxxxxxxxxx what shall we do with the existing group when the
// 'obligatoryDataElements' property is set on on it? This requires
// the nodes to be remapped. This can be done by a removeTargetNodes()
// and then a call to 'addMergedNodes()' followed by
// 'mergeChildrenUnderMerged()' (does this also apply to non-max groups?)
// need  to implement a 're-merge' function. xxxxxxxxxxxx

MergeIndexer.prototype.addMergedNodesWithSingleResult =
    mergeIndexerAddMergedNodesWithSingleResult;

function mergeIndexerAddMergedNodesWithSingleResult(groupEntry, targetPathNode,
                                                    sourceIds,
                                                    allDominatingIds)
{
    var targetIds;
    var sourceIdentities;
    
    if(groupEntry.obligatoryDataElements) {
        
        // translate the source IDs to data element target IDs (under
        // the corresponding dominating IDs, if any).
        targetIds = groupEntry.translateSourceIds(targetPathNode.pathId,
                                                  sourceIds,
                                                  allDominatingIds,
                                                  false);

        this.addNodesAndValues(groupEntry, targetPathNode, sourceIds,
                               targetIds, allDominatingIds, true);

        return targetIds;
    }

    if(allDominatingIds === undefined)
        // can use the same source IDs (as merging is at the root path)
        // Use the same function as when there is a single projection
        return this.addMergedNodesWithSingleProj(groupEntry, targetPathNode,
                                                 sourceIds, allDominatingIds);
    
    // general case: split into four categories: data elements ('d') and
    // non-data-elements ('nd') and translated ('t') and non-translated
    // ('nt').
    
    var sourceHasOperands = groupEntry.hasSourceOperands(targetPathNode);
    // source, target and dominating IDs after being categorized 
    var catSourceIds = { dnt: [], ndnt: [], dt: [], ndt: [] };
    var catTargetIds = { dnt: [], ndnt: [], dt: [], ndt: [] };
    var catDominatingIds = { dnt: [], ndnt: [], dt: [], ndt: [] };
    // all target IDs (returned by the function
    var targetIds = new Array(sourceIds.length);
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        
        var sourceId = sourceIds[i];
        if(sourceId === undefined)
            continue;
        var dominatingId = allDominatingIds[i];
        if(dominatingId === undefined)
            continue;
        
        if(sourceId === dominatingId) {
            // dominating ID not translated, so target ID equal source ID
            catSourceIds.ndnt.push(sourceId);
            catTargetIds.ndnt.push(sourceId);
            catDominatingIds.ndnt.push(dominatingId);
            targetIds[i] = sourceId;
            continue;
        }
        
        if(dominatingId < sourceId) {
            // dominating ID not translated, the source ID must be
            // mapped as a data element (not translated)
            catSourceIds.dnt.push(sourceId);
            catTargetIds.dnt.push(sourceId);
            catDominatingIds.dnt.push(dominatingId);
            targetIds[i] = sourceId;
            continue;
        }
        
        // the dominating node was translated. Check whether it
        // was translated from the source ID.
        if(this.dataElements.getSourceId(dominatingId) !== sourceId) {
            // must translate as data element
            catSourceIds.dt.push(sourceId);
            catDominatingIds.dt.push(dominatingId);
        } else {
            // can translate in the same way as dominating ID
            catSourceIds.ndt.push(sourceId);
            catTargetIds.ndt.push(dominatingId);
            catDominatingIds.ndt.push(dominatingId);
            targetIds[i] = dominatingId;
        }
    }

    //translate, where needed,  set the nodes and keys
     
    if(catSourceIds.dt.length > 0) {
        catTargetIds.dt = groupEntry.translateSourceIds(targetPathNode.pathId,
                                                        catSourceIds.dt,
                                                        catDominatingIds.dt,
                                                        false);
        this.addNodesAndValues(groupEntry, targetPathNode, catSourceIds.dt,
                               catTargetIds.dt, catDominatingIds.dt, true);
        // merge the target IDs into the full target ID list
        alignArrays(sourceIds, catSourceIds.dt, catDominatingIds.dt, targetIds);
    }
    if(catSourceIds.ndt.length > 0) {
        // no need to handle the returned target IDs, they are already set
        groupEntry.translateSourceIds(targetPathNode.pathId, catSourceIds.ndt,
                                      catDominatingIds.ndt, false);
        this.addNodesAndValues(groupEntry, targetPathNode, catSourceIds.ndt,
                               catTargetIds.ndt, catDominatingIds.ndt, false);
    }
    if(catSourceIds.dnt.length > 0)
        this.addNodesAndValues(groupEntry, targetPathNode, catSourceIds.dnt,
                               catTargetIds.dnt, catDominatingIds.dnt, true);
    
    if(catSourceIds.ndnt.length > 0)
        this.addNodesAndValues(groupEntry, targetPathNode, catSourceIds.ndnt,
                               catTargetIds.ndnt, catDominatingIds.ndnt, false);
    
    return targetIds;
}

// This function implements addMergedNodes() in cases where it is known that
// there may be no conflicts (this group is the only group mapping nodes to
// this path or all groups mapping to this path have the same priority) but
// a source node may be mapped under any number of dominating
// nodes (including zero or more than one).
// If there are no dominating IDs (which means that merging is to the root
// target path), this is the same as the simple case handled in
// addMergedNodesWithSingleProj() except that if there is more than one
// mapping function result registered to the merge indexer, subsequent
// functions expect this function to return an array of arrays of
// IDs (the dominating IDs for the children).
// In all other cases this function is similar to
// addMergedNodesWithSingleResult() except that 'allDominatingIds' may contain
// multiple dominating IDs for each source ID and that the returned value
// must also be n array of arrays.
// We therefore use the functions addMergedNodesWithSingleProj() and
// addMergedNodesWithSingleResult() and convert the input and output
// arrays to the required format.

MergeIndexer.prototype.addMergedNodesWithoutConflicts =
    mergeIndexerAddMergedNodesWithoutConflicts;

function mergeIndexerAddMergedNodesWithoutConflicts(groupEntry, targetPathNode,
                                                    sourceIds, allDominatingIds)
{
    if(allDominatingIds === undefined) {
        var targetIds =
            this.addMergedNodesWithSingleProj(groupEntry, targetPathNode,
                                              sourceIds, allDominatingIds);
        // convert array of element IDs to array of arrays of element IDs
        return this.convertToMultiResultFormat(targetIds);
    }

    // flatten the arrays
    var flatSourceIds = [];
    var flatDominatingIds = [];

    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var sourceId = sourceIds[i];
        var dominatingIds = allDominatingIds[i];
        if(sourceId === undefined || dominatingIds === undefined ||
           dominatingIds.length === 0)
            continue;
        for(var j = 0, m = dominatingIds.length ; j < m ; ++j) {
            flatSourceIds.push(sourceId);
            flatDominatingIds.push(dominatingIds[j]);
        }
    }

    var targetIds =
        this.addMergedNodesWithSingleResult(groupEntry, targetPathNode,
                                            flatSourceIds, flatDominatingIds);

    // convert back to array aligned with original array

    var allTargetIds = new Array(sourceIds.length);
    var pos = 0;
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var sourceId = sourceIds[i];
        var dominatingIds = allDominatingIds[i];
        var targets = allTargetIds[i] = [];
        if(sourceId === undefined || dominatingIds === undefined ||
           dominatingIds.length === 0)
            continue; // no dominating nodes
        
        for(var j = 0, m = dominatingIds.length ; j < m ; ++j) {
            targets.push(targetIds[pos]);
            pos++;
        }
    }

    return allTargetIds;
}

// This function implements addMergedNodes() for the most general case,
// where multiple groups map to the same target path and there are
// multiple result functions mapping to the merge indexer. As a result,
// conflicts may occur and nodes may be mapped as unmapped or cause
// previously mapped nodes to become unmapped.
// The special case where 'allDomiantingIds' is undefined (the nodes
// are merged as top data elements and therefore there is no need to take
// dominating nodes into account) is simpler and handled by a special function.
// In all other cases, the function first checks which of the nodes
// in 'sourceIds' need to be merged as mapped and which need to be merged
// as unmapped. When nodes are mapped, the function also constructs a list
// of dominating nodes such that the previously mapped nodes under
// these dominating nodes need to be made unmapped (as a result of a conflict
// with the currently merged node).
// After constructing these lists, the function first makes into unmapped
// the nodes previously mapped which hav enow become unmapped and then
// add the merged nodes as mapped and unmapped. The resulting lists of
// dominating nodes for the children of the merged nodes are merged
// with each other (there is one list for the noded mapped and another for
// the nodes which were unmapped). This combined list is then returned.

MergeIndexer.prototype.addMergedNodesWithConflicts =
    mergeIndexerAddMergedNodesWithConflicts;

function mergeIndexerAddMergedNodesWithConflicts(groupEntry, targetPathNode,
                                                 sourceIds, allDominatingIds)
{
    var priority = groupEntry.priority;
    
    if(allDominatingIds === undefined)
        return this.addMergedNodesUndominatedWithConflicts(groupEntry,
                                                           targetPathNode,
                                                           sourceIds);
    
    // loop over the source IDs and split into groups by priority of
    // conflicting nodes under same dominating node

    var catDominatingIds = { map: [], unmap: [] };
    var catSourceIds = { map: [], unmap: [] };
    // dominating IDs where existing children should be unmapped
    var unmapExisting = [];
    
    var domPriorities = targetPathNode.dominatedPriorities;
    var conflictingGroupEntry;
    var conflictingGroupId;
    var pos = 0; // position in flattened array
    var wasFlattened = false; // was there any change in position
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {

        var sourceId = sourceIds[i];

        if(sourceId === undefined)
            continue;
        
        var dominatingIds = allDominatingIds[i];

        if(dominatingIds === undefined || dominatingIds.length === 0)
            continue;
        
        for(var j = 0, m = dominatingIds.length ; j < m ; ++j, ++pos) {

            if(pos !== i)
                wasFlattened = true;
            
            var dominatingId = dominatingIds[j];
            var existingPriority;
            if(domPriorities.size > 0 && domPriorities.has(dominatingId))
                existingPriority = domPriorities.get(dominatingId);
            else if(!targetPathNode.nodes.has(dominatingId))
                existingPriority = -Infinity;
            else if(targetPathNode.operators !== undefined &&
                    targetPathNode.operators.has(dominatingId))
                // operator node, so can merge under (no conflicts, otherwise
                // it would have been in the dominatedPriorities table)
                existingPriority = -Infinity;
            else { // element with same element ID as dominating at this path
                var groupId = this.dataElements.getGroupId(dominatingId);
                if(conflictingGroupId !== groupId)
                    conflictingGroupEntry = this.groupById[groupId];
                existingPriority = conflictingGroupEntry.priority;
            }

            if(existingPriority > priority) {
                // merge as unmapped
                catSourceIds.unmap[pos] = sourceId;
                catDominatingIds.unmap[pos] = dominatingId; 
            } else {
                // map the merged nodes
                catSourceIds.map[pos] = sourceId;
                catDominatingIds.map[pos] = dominatingId; 
                if(existingPriority < priority && existingPriority > -Infinity)
                    // unmapped the existing nodes under the dominating node
                    unmapExisting.push(dominatingId);
            }
        }
    }

    if(unmapExisting.length > 0)
        // find all children at this path of the given dominating IDs
        // and make them unmapped.
        this.makeNodesUnderDominatingUnmapped(targetPathNode, unmapExisting);

    var mappedTargetIds;
    
    if(catSourceIds.map.length > 0) {
        // add these nodes as mapped (now there are no conflicts, can use the
        // non-conflict merge function).
        mappedTargetIds =
            this.addMergedNodesWithSingleResult(groupEntry, targetPathNode,
                                                catSourceIds.map,
                                                catDominatingIds.map);
    }

    var nonTerminalIds;
    
    if(catSourceIds.unmap.length > 0)
        // Non-terminals with same dominating and identity as unmapped nodes.
        // Can serve as dominating for the children of the unmapped nodes.
        nonTerminalIds = this.mergeNodesAsUnmapped(groupEntry, targetPathNode,
                                                   catSourceIds.unmap,
                                                   catDominatingIds.unmap);

    // merge the two arrays

    mappedTargetIds = mergeArraysOfArrays(mappedTargetIds, nonTerminalIds);

    if(mappedTargetIds === undefined)
        return [];

    return wasFlattened ?
        this.unflattenTargetArray(sourceIds, allDominatingIds,
                                  mappedTargetIds) : mappedTargetIds;
}

// This function implements addMergedNodesWithConflicts() for the case where
// 'allDominatingIds' is undefined, which means that the nodes need to
// be merged to the root target path, without dominating nodes (that is,
// without merging under operators). Since there are no dominating nodes,
// the decision whether to add the nodes as mapped or unmapped and whether
// existing target nodes should be unmapped applies to all nodes.
// After making the decision, the function performs the required
// operation on all nodes.

MergeIndexer.prototype.addMergedNodesUndominatedWithConflicts =
    mergeIndexerAddMergedNodesUndominatedWithConflicts;

function mergeIndexerAddMergedNodesUndominatedWithConflicts(groupEntry,
                                                            targetPathNode,
                                                            sourceIds)
{
    var priority = groupEntry.priority;
    
    // merging at the root target path, just compare the priority of
    // the group with the priority of nodes actually mapped
    
    if(targetPathNode.priority > priority)
        // add as unmapped nodes and return
        return this.mergeNodesAsUnmapped(groupEntry, targetPathNode,
                                         sourceIds);
    
    if(targetPathNode.priority < priority) {
        // make the existing nodes unmapped (these are all nodes
        // currently mapped to the node).
        var targetIds = [];
        targetPathNode.nodes.forEach(function(entry, targetId) {
            targetIds.push(targetId);
        });
        this.makeNodesUnmapped(targetPathNode, targetIds, undefined);
    }
        
    // map all nodes in 'sourceIds'.
    // This is like the single result case except for the need to
    // convert the result format (from an array of element IDs to an
    // array of arrays of element IDs).
    var targetIds =
        this.addMergedNodesWithSingleResult(groupEntry, targetPathNode,
                                            sourceIds, undefined);
    targetPathNode.priority = priority;
    return this.convertToMultiResultFormat(targetIds);
}


// Auxiliary function.
// This function converts an array of element IDs into an array of
// arrays of element IDs (where each element ID is replaced by an
// array containing the element ID and undefined is replaced by an empty
// array). The conversion is performed in-place in the input array
// which is also the array returned by this function.

MergeIndexer.prototype.convertToMultiResultFormat =
    mergeIndexerConvertToMultiResultFormat;

function mergeIndexerConvertToMultiResultFormat(elementIds)
{
    // convert array of element IDs into array of arrays
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = tagetIds[i];
            if(elementId === undefined)
                elementIds[i] = [];
            else
                elementIds[i] = [elementId];
        }

    return elementIds;
}

// This function repacks the result of applying mapping to a flattened
// source ID array back to an array aligned with the original source ID
// array. It is assumed that 'sourceIds' is an array of source IDs and
// 'domiantingIds' an array aligned with it such that each position in
// 'domiantingIds' holds an array of dominating IDs for the corresponding
// source ID. It is assumed that these arrays were then flattened so
// that in the flattened source array each position holds a single source ID
// (not undefined) and each position in the dominating ID array holds
// a single dominating ID (not undefined). This means that all positions
// where either the source ID or the dominating IDs are undefined or the
// list of dominating IDs is empty are skips. At the same time, positions
// which store multiple dominating IDs for the same source ID are
// copied to multiple positions in the flattened array so that each position
// stores a single dominating ID (which means that the source ID is
// duplicated). It is assumed that an operation was then applied to these
// flattened arrays which resulted in an array of arrays of target IDs
// (with each position aligned with the corresponding position in the
// flattened source/dominating ID arrays). This function then performs
// the inverse operation, taking all arrays in the 'targetIds' array and
// concatenating them into the original position of the corresponding
// source ID (before flattening). The resulting array is returned.

MergeIndexer.prototype.unflattenTargetArray =
    mergeIndexerUnflattenTargetArray;

function mergeIndexerUnflattenTargetArray(sourceIds, allDominatingIds,
                                          allTargetIds)
{
    var unflattenedIds = [];

    var pos = 0; // position in flattened array
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {

        var sourceId = sourceIds[i];
        if(sourceId === undefined)
            continue;
        
        var dominatingIds = allDominatingIds[i];
        if(dominatingIds === undefined || dominatingIds.length === 0)
            continue;
        
        for(var j = 0, m = dominatingIds.length ; j < m ; ++j, ++pos) {
            var targetIds = allTargetIds[pos];
            if(targetIds === undefined || targetIds.length === 0)
                continue;
            var ids = unflattenedIds[i];
            if(ids === undefined)
                unflattenedIds[i] = targetIds;
            else
                unflattenedIds[i] = cconcat(ids, targetIds);
        }
    }

    return unflattenedIds;
}

///////////////////////////
// Node Update Functions //
///////////////////////////

// This function sets target nodes and assigns them values (tpe + key +
// hasAttrs) for target nodes mapped by the given group to the given
// target path. The target IDs are given by the array 'targetIds' and
// the source nodes from which they were mapped are given by the array
// 'sourceIds' (the arrays are aligned). 'dominatingIds' is an array
// (aligned with the two others) of the dominating target IDs under which
// the target IDs should be mapped. This may be undefined if mapping to
// the root path node. 'addAsDataElements' indicates whether the target IDs
// which be added as data elements or not. Itis up to the calling function
// to make sure that this option applies  equally to all target IDs
// and that the target IDs are properly assigned (different from the dominating
// if data elements and same as dominating if not data elements).
// This function is responsible for getting the source identities of the
// source nodes (if adding as data elements) and getting the values of
// the source nodes and setting them on the target nodes.

MergeIndexer.prototype.addNodesAndValues =
    mergeIndexerAddNodesAndValues;

function mergeIndexerAddNodesAndValues(groupEntry, targetPathNode, sourceIds,
                                       targetIds, dominatingIds,
                                       addAsDataElements)
{
    if(groupEntry.isIdentityGroup || dominatingIds === undefined)
        addAsDataElements = true; // by definition
    
    var sourceIdentities;
    if(addAsDataElements)
        sourceIdentities = groupEntry.getSourceIdentities(sourceIds);
    
    // get the source values (type + key + hasAttrs) of the source nodes
    var sourceValues = groupEntry.isIdentityGroup ?
        groupEntry.getSourceKeysByIdentity(sourceIdentities) :
        groupEntry.getSourceValues(targetPathNode, sourceIds);
    
    // add the target nodes for the source IDs.
    this.addNodeEntries(groupEntry, targetPathNode, sourceIds, targetIds,
                        dominatingIds, sourceIdentities);

    // set the key values on the nodes
    this.setNodeValues(groupEntry, targetPathNode, targetIds,
                       sourceValues, dominatingIds, sourceIdentities);
}

// This function adds a set of nodes to the indexer at the path
// 'targetPathNode'. When this function is called, it has already been
// determined which nodes need to be added and the function merely needs
// to add them. However, the function may add each node either as
// a data element node or as a non-data element node. The function also
// sets the merge indexer properties (group ID, priority and source ID)
// on the node entries.
// 'groupEntry' is the group which mapped these nodes. 'sourceIds'
// is an array holding the source IDs from which the nodes were mapped
// while 'targetIds' is an array with the target IDs to which these
// nodes need to be mapped. 'dominatingIds' is an optional array of the
// target nodes under which each target ID needs to be placed. As opposed
// to other functions, here we have a single dominating ID for each
// position in the array since the same source node mapped under different
// dominating IDs must get different target IDs, so there is anyway need
// for the same source ID to appear several times in the 'sourceIds' array
// in such a case case. 'dominatingIds' may be undefined if the nodes
// are merged at the root path and there are no dominating IDs (the nodes
// will al be added as data elements in this case). 'sourceIdentities'
// is an array of the source identities (as defined for the group)
// of the source IDs in 'sourceIds'. The source identity is only required
// for source IDs mapped to target nodes which are data elements at the
// target path. By providing an undefined 'sourceIdentities' array, the
// calling function indicates that none of the target nodes needs to be
// a data element. Otherwise, it is the responsibility of the calling function
// to provide the source identitiy at least for those target nodes which are
// data elements (this is not considered an indication that these nodes
// are data elements, so the callign function may provide the identity
// also when no data element needs to be created).

MergeIndexer.prototype.addNodeEntries =
    mergeIndexerAddNodeEntries;

function mergeIndexerAddNodeEntries(groupEntry, targetPathNode, sourceIds,
                                    targetIds, dominatingIds, sourceIdentities)
{
    var groupId = groupEntry.groupId;
    var priority = groupEntry.priority;

    // whether we add data element nodes or non-data-element nodes,
    // the total number of nodes about to be added is the same, so we
    // reserve enough space for it.
    this.expectAdditionalNodeNum(targetPathNode, targetIds.length);
    
    if(dominatingIds === undefined) { // all target nodes are data elements

        this.expectAdditionalDataElementNum(targetIds.length);
        
        for(var i = 0, l = targetIds.length ; i < l ; ++i) {
            var targetId = targetIds[i];
            if(targetId === undefined)
                continue;
            
            this.addDataElementNode(targetPathNode, targetId, undefined,
                                    sourceIdentities[i], groupId,
                                    sourceIds[i]);
        }
    } else if(!targetPathNode.parent) {
        // at root path, so all target nodes are data elements, but no all
        // are necessarily mapped
        this.expectAdditionalDataElementNum(targetIds.length);
        for(var i = 0, l = targetIds.length ; i < l ; ++i) {
            var targetId = targetIds[i];
            if(targetId === undefined)
                continue;
            var dominatingId = dominatingIds[i];
            if(dominatingId === undefined)
                continue;
            // a dominating ID with the same ID as the target ID at the
            // root path indicates simply that the node should be merged
            this.addDataElementNode(targetPathNode, targetId,
                                    dominatingId === targetId ?
                                    undefined : dominatingId,
                                    sourceIdentities[i], groupId,
                                    sourceIds[i]);
        }
    } else if(sourceIdentities === undefined) {
        // all target nodes are not data elements (and therefore there is
        // no need for their source identities)
        this.addNonDataElementNodes(targetPathNode, targetIds);
    } else {
        for(var i = 0, l = targetIds.length ; i < l ; ++i) {
            var targetId = targetIds[i];
            if(targetId === undefined)
                continue;
        
            var dominatingId = dominatingIds[i];

            if(dominatingId === targetId) {
                this.addNonDataElementNode(targetPathNode, targetId);
            } else if(dominatingId === undefined)
                continue;
            else {
                this.addDataElementNode(targetPathNode, targetId,
                                        dominatingId,
                                        sourceIdentities[i], groupId,
                                        sourceIds[i]);
                if(dominatingId !== undefined)
                    targetPathNode.dominatedPriorities.set(dominatingId,
                                                           priority);
            }
        }
    }
}

// This function sets the values (type + key + hasAttrs) on the target nodes
// given by the target element IDs in the array 'targetIds' and the target
// path node 'targetPathNode'. 'groupEntry' is the entry of the group
// which mapped the nodes. 'sourceValues' is an object of the form:
// {
//    types: <array of type strings>
//    keys: <array of keys>
//    hasAttrs; <array of Booleans>
// }
// Each position in these arrays defines the value (type + key + hasAttrs)
// which sould be set on the node with the target ID at the corresponding
// position in the array 'targetIds'.
// When the array 'dominatingIds' is provided, it is used to determine
// whether there is need to add the key for the node. If the dominating ID
// for the node at the position corresponding to that of a target ID is
// undefined, the key of the target node does not need to be set.
// If no 'dominatingIds' array is provided, the keys are set for all
// defined target IDs.
// 'sourceIdentities' is optional. It holds the source identities with
// which the nodes were mapped. The source identities, which are also
// the base target identities of the target nodes are needed for non-terminal
// nodes in case there is need to register them to the path's non-terminals
// table. If 'sourceIdentities' is not provided and there is need to register
// a non-terminal, the identity is fetched (this means that 'sourceIdentities'
// should be provided only if the calling function already calculated this
// array anyway).

MergeIndexer.prototype.setNodeValues =
    mergeIndexerSetNodeValues;

function mergeIndexerSetNodeValues(groupEntry, targetPathNode, targetIds,
                                   sourceValues, dominatingIds,
                                   sourceIdentities)
{
    var isNonTerminal;
    var addNonTerminals = (targetPathNode.nonTerminals !== undefined);
    
    for(var i = 0, l = targetIds.length ; i < l ; ++i) {
        
        // set the key value of the node
        
        var targetId = targetIds[i];
        if(targetId === undefined ||
           (dominatingIds !== undefined && dominatingIds[i] === undefined))
            continue;
        
        if(isNonTerminal =
           (groupEntry.isIdentityGroup || sourceValues.hasAttrs[i]))
            // identity nodes always allow merging under them
            this.setKeyValue(targetPathNode, targetId, "attribute", true);
        
        this.setKeyValue(targetPathNode, targetId, sourceValues.types[i],
                         sourceValues.keys[i], true);

        var isOperator =
            !isNonTerminal && this.isOperatorType(sourceValues.types[i]);

        if(isOperator || (isNonTerminal && addNonTerminals)) {
            var dominatingId =
                dominatingIds === undefined ? undefined : dominatingIds[i];
            var identity = sourceIdentities ? sourceIdentities[i] :
                this.dataElements.getBaseIdentity(targetId);
            if(isOperator)
                this.addNonTerminalOperator(targetPathNode, dominatingId,
                                            targetId, identity);
            else
                this.addNonTerminal(targetPathNode, dominatingId, targetId,
                                    identity);
        }
    }
}

// This function is called by a mapping query calculation node when 
// there are key updates for the nodes of the source path it is registered
// to. This source path may either be an extension source path or
// the maximal source path.
// For each node, this function must first check whether it was mapped
// to the target path (for unmapped nodes there is no need to update
// the key value). After finding the target nodes to which the source node
// was mapped (if any) the key value us queued for update on these nodes.

// xxxxxxxxxxxxxx when keys are modified, this may result in a change 
// to the 'non-terminal' property of a node. This must be handled here
// but also in 'addMergedNode' in case the value of an existing 
// node is changed by the operation. xxxxxxxxxxxxxxxxx
// remark: if 'non-terminal' is associated with the 'hasAttrs' property,
// this is linked to updates of the 'attribute' type. xxxxxxxxxxxxxxx
// In addition, the 'isAtomic' property may influence this xxxxxxxxxxxx

MergeIndexer.prototype.updateKeys = 
    mergeIndexerUpdateKeys;

function mergeIndexerUpdateKeys(mappingQueryCalc, elementIds, types, keys)
{
    var targetPathNode = mappingQueryCalc.targetPathNode;
    var groupId = mappingQueryCalc.groupId;
    var groupEntry = this.groupById[groupId];

    var allTargetIds = this.getAllTargetNodes(groupEntry, targetPathNode,
                                              elementIds);

    if(this.isSingleMappingResult()) { // => single target
        for(var i = 0, l = elementIds.length ; i < l ; ++i)
            this.setKeyValue(targetPathNode, allTargetIds[i], types[i],
                             keys[i]);
    } else {
        for(var i = 0, l = elementIds.length ; i < l ; ++i) {
            var targetIds = allTargetIds[i];
            if(targetIds !== undefined && targetIds.length > 0)
                for(var j = 0, m = targetIds.length ; j < m ; ++j)
            this.setKeyValue(targetPathNode, targetIds[j], types[i], keys[i]);
        }
    }
}

////////////////////////////
// Merging of Child Nodes //
////////////////////////////

// This function may be called on a maximal group 'groupEntry' and a
// target path 'targetPathNode' which this group maps to (this can
// either be the explicit target path of the group or an extension
// target path). 'sourceIds' is an array of source node IDs which
// were merged already by the group to this target path.
// 'allDominatingIds' is an array of the target nodes under which the
// children of 'sourceIds' shoudl be merged (this means that for each source
// element ID in 'sourceId' the corresponding position in the array
// 'allDominatingIds' defines the target elements (at targetPathNode)
// under which to map the children. If there is only one function result
// mapping to this merge indexer, each entry in 'allDominatingIds' is a
// single element ID (or undefined) and otherwise each such entry is
// an array of target element IDs (or undefined).
// 'monitored' indicates whether the target nodes in 'allDominatingIds'
// are monitored or not. If this flag is undefined, the set of nodes
// is first split to monitored and non-monitored and then this function
// is called for each set separately.
// When 'monitored' is false, this function finds all direct children of
// 'sourceIds' which are at source paths which map to traced
// target paths. When monitored is true, the function finds all direct
// children of 'sourceIds', regardless of whether the source path is
// mapped to a traced target path or not. After finding the child source
// nodes to merge, these children are merged. The process then continues
// recursively, to merge the children of these children.

MergeIndexer.prototype.mergeChildrenUnderMerged = 
    mergeIndexerMergeChildrenUnderMerged;

function mergeIndexerMergeChildrenUnderMerged(groupEntry, targetPathNode,
                                              sourceIds, allDominatingIds,
                                              monitored)
{
    if(groupEntry.isIdentityGroup)
        return; // identity nodes have no source children
    
    if(!allDominatingIds || allDominatingIds.length == 0)
        return; // no dominating nodes to merge under
    
    if(monitored === undefined) {
        monitored = false;
        while(targetPathNode.subTree) {
            var filtered = 
                this.filterSourceByMonitoredDominating(sourceIds,
                                                       allDominatingIds,
                                                       targetPathNode,
                                                       monitored);
            this.mergeChildrenUnderMerged(groupEntry, targetPathNode,
                                          filtered.sourceIds,
                                          filtered.allDominatingIds, monitored);
            if(!(monitored = !monitored))
                return; // both false and true handled
        }
    }

    // get the children of the source nodes, including operand children
    // (at the same path).
    var children = groupEntry.getSourceChildren(sourceIds, targetPathNode,
                                                monitored);

    if(children === undefined || children.length == 0)
        return; // no children to merge
    
    for(var i = 0, l = children.length ; i < l ; ++i) {

        var pathEntry = children[i];
        var childTargetPath = this.pathNodesById[pathEntry.targetPathId];
        if(childTargetPath === undefined) { // add this path as a monitored path
            childTargetPath =
                this.getMonitoredTargetPath(groupEntry,
                                            pathEntry.targetPathId);
        }

        var allChildIds = pathEntry.sourceChildIds;
        var toAddChildIds;
        var toAddAllDominatingIds;
        if(pathEntry.hasDataElements) {
            // children are given as array for each parent source ID, so
            // flatten this array of arrays (before calling next function).
            toAddAllDominatingIds = [];
            toAddChildIds = [];
            for(var j = 0, m = allChildIds.length ; j < m ; ++j) {
                var childIds = allChildIds[j];
                if(childIds === undefined)
                    continue;
                for(var k = 0, n = childIds.length ; k < n ; ++k) {
                    toAddChildIds.push(childIds[k]);
                    toAddAllDominatingIds.push(allDominatingIds[j]);
                }
            }
        } else {
            toAddAllDominatingIds = allDominatingIds;
            toAddChildIds = allChildIds;
        }
        
        var allChildDominatingIds = 
            this.addMergedNodes(groupEntry, childTargetPath,
                                toAddChildIds, toAddAllDominatingIds);

        // call function recursively ('monitored' flag remains the same)
        this.mergeChildrenUnderMerged(groupEntry, childTargetPath,
                                      toAddChildIds, allChildDominatingIds,
                                      monitored);
    }
}

// This function is used to merge the source node 'sourceElementId'
// mapped by the group with entry (in the 'groupById' table)
// 'groupEntry' to the target path 'targetPathNode' under the
// dominating nodes whose IDs appear in the array 'dominatingIds'.  
// 'targetPathNode' can either be an extension path or an explicit
// target path. If targetPathNode is an explicit target path, this
// function first checks whether this node was not mapped as a result
// of mapping lower source nodes (this happens if this source node is
// an operator or is mapped by a non-maximal group). When this
// happens, the whole chain of dominating source nodes, from the node
// actually added by the mapping up to the node given here is mapped.
// If, as a result of merging this node, dominating nodes become available
// for the children of this node, this function attempts to merge these
// children too (if needed).

// this function and the functions it uses need to be converted to apply
// to a set of source IDs (current problem: the function which returns
// the maximal source nodes in 'mergeChildOfNonMaxGroup()'). xxxxxxxxxx

MergeIndexer.prototype.mergeChildNode = mergeIndexerMergeChildNode;

function mergeIndexerMergeChildNode(sourceElementId, groupEntry, 
                                    targetPathNode, dominatingIds)
{
    // get the nodes actually mapped under this node (this may simply be
    // the sourceElementId itself)
    
    var maxSourceNodes;

    if(groupEntry.isMaxGroup) {
        
        if(targetPathNode != groupEntry.targetPathNode) {
            // added at an extension path
            this.mergeChildrenUnderMerged(groupEntry, targetPathNode, 
                                          [sourceElementId], [dominatingIds]);
        } else  { // just merge the source node
            this.mergeExplicitChildNode(sourceElementId, groupEntry, 
                                        targetPathNode, dominatingIds);
        }
    } else
        this.mergeChildOfNonMaxGroup(sourceElementId, groupEntry, 
                                     targetPathNode, dominatingIds, false);
}

//
// Merging of Child Nodes Of Non-Maximal Group
//

// This function should be called only when the group 'groupEntry' is 
// not a maximal group.
// This function is used either to merge the source node 'sourceElementId'
// mapped by the group with entry (in the 'groupById' table)
// 'groupEntry' to the target path 'targetPathNode' or to merge its children
// under that path. To indicate which of the two it is, the calling function
// should use the flag 'underTargetPath' (if true, merging will stop just
// before reaching the target path).
// 'dominatingIds' are the nodes under which the merging should take place.
// If merging should include targetPathNode ('underTargetPath' is false)
// the dominating IDs should be of nodes at the prefix path (or operators
// at the path itself). If the children of the node are to be merged 
// ('underTargetPath' is true), the dominating IDs should be of nodes
// at targetPathNode. This function first finds the source nodes at 
// the maximal source paths actually added by the mappings which resulted
// in the mapping of the given source node. These nodes are then merged.
// If, as a result of merging a node, dominating nodes became available
// for the children of this node, this function attempts to merge these
// children too (if needed).

MergeIndexer.prototype.mergeChildOfNonMaxGroup = 
    mergeIndexerMergeChildOfNonMaxGroup;

function mergeIndexerMergeChildOfNonMaxGroup(sourceElementId, groupEntry, 
                                             targetPathNode, dominatingIds,
                                             underTargetPath)
{
    // get the nodes actually mapped under this node (this may simply be
    // the sourceElementId itself)
    
    var maxSourceNodes = groupEntry.getMaxSourceNodes([sourceElementId]);

    for(var i = 0, l = maxSourceNodes.length ; i < l ; ++i) {
        var groupMaxNodes = maxSourceNodes[i];
        var maxGroup = groupMaxNodes.group;
        var maxIds = groupMaxNodes.maxSourceIds;
        for(var j = 0, m = maxIds.length ; j < m ; ++j) {
            this.mergeExplicitChildNode(maxIds[j], maxGroup, 
                                        targetPathNode, dominatingIds, 
                                        underTargetPath);
        }
    }
}

// This function is used to merge a node mapped from an explicit
// source path (that is, not an extension source path) under a given
// dominating node. A sequence of dominating source nodes may be
// merged in case the dominating node dominates the target path of a
// non-maximal group.  This function merges the source node given by
// 'sourceElementId', which must be from the maximal source path and
// is mapped by a mapping belonging to the maximal group whose entry
// (in the groupById table) is 'maxGroupEntry'. It merges this node
// and all dominating source nodes, up to the source
// node which is mapped to the target path 'targetPathNode' (this must
// be the explicit target path of one of the groups to which the
// mappings of the given maximal group belong). Whether the node mapped
// to 'targetPathNode' is also merged here depends on the flag 
// 'underTargetPath'. If it is false, the merging includes 
// 'targetPathNode' and otherwise not.
// The nodes are merged under the dominating nodes whose data element
// IDs appear in the array 'dominatingIds'. All these domianting nodes
// must represent nodes at the same path, which is either the prefix 
// path of 'targetPathNode' (if 'underTargetPath' is false) or
// 'targetPathNode' itself (if 'underTargetPath' is true).
// The function first finds the sequence of nodes (at the various
// source paths, up to the one mapped to 'targetPathNode') that needs
// to be merged and merges it. If this resulted in a list of domination
// nodes for the child nodes of 'sourceElementId', this function also
// attempts to merge the children of this node.
// 'underTargetPath' may only be true if the given group has a prefix
// group.

MergeIndexer.prototype.mergeExplicitChildNode = 
    mergeIndexerMergeExplicitChildNode;

function mergeIndexerMergeExplicitChildNode(sourceElementId, maxGroupEntry, 
                                            targetPathNode, dominatingIds, 
                                            underTargetPath)
{
    var childDominatingIds;

    var groups = maxGroupEntry.groupSequence;

    // get the sequence of nodes to merge
    var nodesToMerge =
        maxGroupEntry.getSourceElements([sourceElementId], targetPathNode, 
                                        underTargetPath);
    nodesToMerge.push(dominatingIds);
    
    var allChildDominatingIds =
        this.mergeDominationSequence(groups, nodesToMerge, false);
    var matchesMerged = nodesToMerge[0]; // source nodes merged at maximal path
    
    // merge children, if there are any dominating nodes to merge under

    if(allChildDominatingIds === undefined)
        return;
    
    // mapped children of this node at extension paths
    this.mergeChildrenUnderMerged(maxGroupEntry, maxGroupEntry.targetPathNode,
                                  matchesMerged, allChildDominatingIds);
}

/////////////////////////////
// Merge Removal Functions //
/////////////////////////////

// This function receives a list (array) of source elements 'sourceElementIds'
// which was removed by a projection (identified by 'resultId' and 'projId').
// The function also receives the 'groups' array of that mapping (that is,
// the array containing the group entries for the groups to which this mapping
// belongs).
// The function first passes the list of removed source elements to
// the maximal group's MergeGroup object (and from there, recursively,
// to the prefix groups) which then update their reference counts (if needed)
// and return the list of source elements which need to be removed
// at each group (those whose mapping reference count dropped to zero).
// The group returns a list of arrays, one for each group this projection
// belongs to (from the maximal group to the minimal group). The elements in
// these arrays are aligned (that is, the source element at a certain position
// in an array is dominated by the source element in the corresponding
// position in the prefix group's array).
// This function then goes over these returned arrays and removes the nodes.
// It begins with the array for the minimal group. When a source node is
// removed at one group, there is no need to separately remove it from
// the next groups, as the removal of the higher node also removes the
// dominated nodes.

MergeIndexer.prototype.removeAtMaximalPath = mergeIndexerRemoveAtMaximalPath;

function mergeIndexerRemoveAtMaximalPath(groups, sourceElementIds, resultId,
                                         projId)
{
    var nodesToRemove =
        groups[0].removeSourceElements(sourceElementIds, resultId, projId);

    var alreadyRemoved = undefined;
    
    for(var i = nodesToRemove.length - 1 ; i >= 0 ; --i) {
        var groupEntry = groups[i];
        var targetPathNode = groupEntry.targetPathNode;
        var removalCandidates = nodesToRemove[i];
        var toRemove = [];
        
        if(alreadyRemoved && alreadyRemoved.length > 0) {
            // create vector of nodes to remove
            for(var j = 0, m = removalCandidates.length ; j < m ; ++j) {
                var sourceId = removalCandidates[j];
                if(sourceId !== undefined && alreadyRemoved[j] === undefined)
                    toRemove.push(sourceId);
            }
        } else
            toRemove = removalCandidates;

        this.removeSourceNodes(groupEntry, targetPathNode, toRemove);
        alreadyRemoved = nodesToRemove[i];
    }
}

// This function removes all instances of the merging of the given 
// source nodes (the array 'sourceIds' which is an array of element IDs)
// by the given group at the given target path, which must be
// an extension target path of the group. This includes the merging of
// this node as mapped, as unmapped or as a child to be inserted by identity
// under the nodes of the parent path node.
// The function calling this function is allowed to call it with 
// a source node which was never merged. This typically happens when
// this function is called by a mapping query calculation node notifying
// of nodes removed at the source path node. The mapping query calculation
// node notifies of all removed nodes, whether mapped by the mapping or
// not. Therefore, this function first checks whether the dominating 
// source node (of the given source node) at the maximal source path
// of the group has been merged. If not, there is nothing more to de here.

MergeIndexer.prototype.removeAtExtensionPath = 
    mergeIndexerRemoveAtExtensionPath;

function mergeIndexerRemoveAtExtensionPath(groupEntry, sourcePathId,
                                           targetPathNode, sourceIds)
{
    // check if dominated by a source node mapped by this group
    // at the maximal path node
    sourceIds = groupEntry.filterDominatedByProj(sourceIds, sourcePathId);
    if(sourceIds.length == 0)
        return; // not dominated

    // actually remove all instances of the merging of this node.
    this.removeSourceNodes(groupEntry, targetPathNode, sourceIds);
}

// This function receives a list (array) of source nodes which were mapped
// by the given group to the given target path node (which may be either
// an explicit or an extension target path node for the group) and removes
// instances of the mapping of these source nodes: as mapped target nodes and 
// as unmapped nodes.

MergeIndexer.prototype.removeSourceNodes = mergeIndexerRemoveSourceNodes;

function mergeIndexerRemoveSourceNodes(groupEntry, targetPathNode, sourceIds)
{
    // remove any target nodes mapped from this node. If this removed
    // the last node under a dominating node with unmapped nodes, this 
    // also makes the highest priority unmapped nodes into mapped nodes.
    this.removeTargetNodesBySource(groupEntry, targetPathNode, sourceIds);

    // remove this node from the list of unmapped nodes for this group's
    // target path.
    this.removeUnmappedNodesBySource(groupEntry, targetPathNode, sourceIds); 
}

//////////////////////
// Dominating Nodes //
//////////////////////

// Returns an array of arrays of IDs of the dominating target nodes
// defined for the minimal mapping group. Each entry in the array returned
// is an array of dominating target node Ids for the source element ID
// in the corresponding position in the input array 'sourceElementIds'.
// This function should not be called if the target path of the minimal
// group is the root path (if it is called in this case, the function
// returns undefined).
// The dominating nodes depend on the identity (as defined by the group) of
// the source element IDs in the array 'sourceElementIds'. These should
// be source element IDs directly dominating the source node to be merged.
// This will be 0 if the source path is the root path. In this case,
// the source identification function of the group must be defined and must
// define an identity for data element ID 0. This source identity is then
// used to retrieve the non-terminal nodes at the prefix target path of
// the group (that is, the immediate prefix of the shortest target path
// of the group) which have the required identity. The identity of these
// non-terminal nodes is calculated based on the target identification
// of the group. No dominating node restrictions apply here (since this
// is the top mapped node), so we retrieve all non-terminal nodes with
// the required identity, regardless of the dominating node.
// Where there is an 'undefined' entry in the input array, there is also
// an undefined entry in the output array. All other entries in the output
// array are arrays, some of which may be empty.

MergeIndexer.prototype.getDominatingByGroup = 
    mergeIndexerGetDominatingByGroup;

function mergeIndexerGetDominatingByGroup(groupEntry, sourceElementIds)
{
    // the prefix path of the target path (this is undefined
    // if the target path is the root path).
    var prefixPath = groupEntry.targetPathNode.parent;

    // in case the target is the root node, we can only have 'undefined'
    // as dominating.
    if(prefixPath === undefined)
        return undefined;

    var identificationId = groupEntry.targetIdentificationId;
    var allDominatingIds = new Array(sourceElementIds.length);

    if(groupEntry.isIdentityGroup && groupEntry.isDominated()) {

        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
            var sourceId = sourceElementIds[i];
            if(sourceId === undefined)
                continue;
            var identity = groupEntry.getParentIdentity(sourceId);
            var dominating = prefixPath.nonTerminals.
                getNonTerminals(undefined, identity, identificationId);
            allDominatingIds[i] = (dominating === undefined) ? [] : dominating;
        }
    } else {

        for(var i = 0, l = sourceElementIds.length ; i < l ; ++i) {
            var sourceId = sourceElementIds[i];
            if(sourceId === undefined)
                continue;
            var identity = groupEntry.getSourceIdentity(sourceId);
            var dominating = prefixPath.nonTerminals.
                getNonTerminals(undefined, identity, identificationId);
            allDominatingIds = (dominating === undefined) ? [] : dominating;
        }
    }
    return allDominatingIds;
}

// This function returns the target nodes under which to insert the children
// of a source node which was already merged. The function receives as input
// the source data element ID of the node which was already merged and 
// the group entry of the group for which the node was merged.
// 'targetPathNode' is the path of the already merged node 
// (which is also the pth of the dominating nodes returned by the function).
// The function returns an array where each position in the returned array
// stores the taret nodes coresponding to the source ID in the input
// array. If there is a single function result defined in the merge indexer,
// there can be only one dominating node for each source node, so the
// returned array stores a single target ID at each position. Otherwise,
// each position in the result array stores an array of target IDs.
// This function first checks some trivial cases which allow for quick
// processing (see body of function). It then checks whether there are
// unmapped nodes and non-terminals at the target path. If there aren't,
// this function simply returns as dominating IDs the set of target nodes
// to which each source node in the input array was mapped. Otherwise,
// there is also need to check whether each source node was also
// merged as unmapped, in which case non-terminals with the same
// identity at the target path are also dominating IDs.

MergeIndexer.prototype.getAllDominatingByMerged = 
    mergeIndexerGetAllDominatingByMerged;

function mergeIndexerGetAllDominatingByMerged(groupEntry, targetPathNode, 
                                              sourceIds)
{
    if(this.numProjs == 1)
        return sourceIds; // each source ID mapped to itself

    // first, get the target nodes to which each source ID was mapped
    var targetIds =
        this.getAllTargetNodes(groupEntry, targetPathNode, sourceIds);

    if(this.isSingleMappingResult() || // single function, so no unmapped nodes
       (targetPathNode.unmappedNodes === undefined ||
        targetPathNode.unmappedNodes.unmappedNum()== 0 ||
        targetPathNode.nonTerminals === undefined ||
        targetPathNode.nonTerminals.getNum() == 0))
        // no unmapped nodes with non-terminals of the same identity,
        // so the mapped target IDs are all possible dominating for children
        return targetIds;

    // loop over the nodes and see whether any are unmapped and whether
    // there are non-terminals with the same identity.
    
    var targetIsRoot = (targetPathNode.parent === undefined);
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {

        var sourceId = sourceIds[i];
        var dominatingIds; // remains undefined if this is the root path
        
        if(!targetIsRoot) {
            var unmappedDominating = targetPathNode.unmappedNodes.
                getDominating(sourceId, groupEntry.groupId);
            if(unmappedDominating === undefined)
                continue; // no dominating, so is not unmapped
            dominatingIds = Object.keys(unmappedDominating);
        } else if(!targetPathNode.unmappedNodes.isUnmapped(sourceId))
            continue;

        // This node was also merged as unmapped (that is, conflicted with
        // a higher priority merged node). We get the nodes at the
        // target path which have the same identity as the source node and
        // are dominated by the same node as those which the source node
        // was merged under.

        var identity = groupEntry.getSourceIdentity(sourceId);
        var nonTerminals = targetPathNode.nonTerminals.
            getNonTerminals(dominatingIds, identity, 
                            groupEntry.targetIdentificationId);

        if(nonTerminals) {
            if(targetIds[i].length)
                targetIds[i] = cconcat(targetIds[i], nonTerminals);
            else
                targetIds[i] = nonTerminals;
        }
    }

    return targetIds;
}

// This function receives two arrays: 'elementIds' and 'allDominatingIds'.
// The array 'elementIds' contains element IDs while the array
// 'allDominatingIds' contains either element IDs (if there is a single
// function result mapping to this merge indexer) or arrays of element IDs.
// All elements in 'allDominatingIds' must be nodes at the target path
// 'pathNode'. This function then filters the elements in 'allDominatingIds'
// based on whether they are monitored node at 'pathNode' or not.
// 'if 'keepMonitored' is true, only monitored nodes are kept and if it
// is false, only non-monitored nodes are kept. The function returns an
// object of the form:
// {
//    sourceIds: <array>
//    allDominatingIds: <array>
//    filteredPos: <array>
// }
// where 'allDominatingIds' contains a subset of the elements in the input
// 'allDomiantingIds' and only positions which have at least one dominating
// element filtered appear in the returned array.
// 'sourceIds' is a subset of the input 'sourceIds' array which preserves
// only the positions preserved in 'allDominatingIds'.
// 'filteredPos' is optional and is only guaranteed to be returned when
// the argument 'returnFilteredPos' is true. In this case, 'filteredPos'
// is an array with all positions in the input array 'sourceIds' which
// are returned in the returned object's 'sourceIds' field. This field may
// be 'true' if all source IDs are returned.

MergeIndexer.prototype.filterSourceByMonitoredDominating = 
    mergeIndexerFilterSourceByMonitoredDominating;

function mergeIndexerFilterSourceByMonitoredDominating(sourceIds,
                                                       allDominatingIds,
                                                       pathNode, keepMonitored,
                                                       returnFilteredPos)
{
    if(!pathNode.subTree) // no monitoring at pathNode
        return (keepMonitored ? { sourceIds: [], allDominatingIds: [],
                                  filteredPos: [] } :
                { sourceIds: sourceIds, allDominatingIds: allDominatingIds,
                  filteredPos: true });
    
    var nodes = pathNode.nodes;
    var filteredAllDominatingIds = [];
    var filteredSourceIds = [];
    var filteredPos;

    if(returnFilteredPos)
        filteredPos = [];
        
    keepMonitored = !!keepMonitored; // make sure this is a boolean

    if(this.isSingleMappingResult()) {
        // single result function, so single dominating IDs
        for(var i = 0, l = allDominatingIds.length ; i < l ; ++i) {
            var dominatingId = allDominatingIds[i];
            if(dominatingId === undefined)
                continue;
            if(nodes.has(dominatingId) && 
               (keepMonitored === this.inSubTree(nodes.get(dominatingId)))) {
                filteredAllDominatingIds.push(dominatingId);
                filteredSourceIds.push(sourceIds[i]);
                if(filteredPos !== undefined)
                    filteredPos.push(i);
            }
        }
        return { sourceIds: filteredSourceIds,
                 allDominatingIds: filteredAllDominatingIds,
                 filteredPos: filteredPos };
    }

    // possibly multiple dominating IDs for each source ID 
    
    for(var i = 0, l = allDominatingIds.length ; i < l ; ++i) {

        var dominatingIds = allDominatingIds[i];
        if(dominatingIds === undefined)
            continue;

        var filtered = [];
        for(var j = 0, m = dominatingIds.length ; j < m ; ++j) {
            var dominatingId = dominatingIds[j];
            if(nodes.has(dominatingId) && 
               (keepMonitored === this.inSubTree(nodes.get(dominatingId))))
                filtered.push(dominatingId);
        }

        if(filtered.length > 0) {
            filteredAllDominatingIds.push(filtered);
            filteredSourceIds.push(sourceIds[i]);
            if(filteredPos !== undefined)
                filteredPos.push(i);

        }
    }

    return { sourceIds: filteredSourceIds,
             allDominatingIds: filteredAllDominatingIds,
             filteredPos: filteredPos };
}

// This function takes an array 'dominatingIds' of element IDs at the path
// 'pathNode' and returned an array holding a subset of the input array.
// The returned array contains either those nodes in 'dominatingIds'
// which are monitored at the path (if 'keepMonitored' is true)
// or those nodes which are not monitored at the path (if 'keepMonitored' is
// false).

MergeIndexer.prototype.filterMonitoredDominating = 
    mergeIndexerFilterMonitoredDominating;

function mergeIndexerFilterMonitoredDominating(dominatingIds, pathNode,
                                               keepMonitored)
{
    if(!pathNode.subTree) // no monitoring at pathNode
        return keepMonitored ? [] : dominatingIds;
    
    var nodes = pathNode.nodes;
    var filtered = [];
        
    keepMonitored = !!keepMonitored; // make sure this is a boolean

    for(var i = 0, l = dominatingIds.length ; i < l ; ++i) {
        var dominatingId = allDominatingIds[i];
        if(!dominatingId) // undefined or 0
            continue;
        
        if(nodes.has(dominatingId) && 
           (keepMonitored === this.inSubTree(nodes.get(dominatingId))))
            filtered.push(dominatingId);
    }

    return filtered;
}

// This function receives a group entry whose prefix group is an identity
// group and a source node ID mapped by this group (if there are operators
// mapped by the group, this would be the highest operator in the chain,
// whose identity determines the identity node which dominates it).
// This function then first checks whether the parent of the source node
// should also be used in determining the embedding. If yes (iff the
// target path of the prefix group, which is the identity group, is not
// the root path) we first use the parent identity to determine the identity
// of the dominatign nodes at the prefix path of the target path of
// the identity group. When then use the identity of the source node
// to dtermine the dominating nodes for the source node (possbily restricting
// this set to those nodes with the matching identity which are
// dominated by the nodes determined by the parent identity). 
// This function then returns this set of nodes (as an array of
// element IDs). While often these returned nodes would be target nodes
// of mapped identity nodes, they may also be nodes mapped by other
// groups (or inserted into the index in some other way).

MergeIndexer.prototype.getDominatingUnderIdentityNode = 
    mergeIndexerGetDominatingUnderIdentityNode;

function mergeIndexerGetDominatingUnderIdentityNode(groupEntry, sourceElementId)
{
    // get the prefix group (this is the identity group)
    var identityGroup = groupEntry.prefixGroup;
    var targetPath = identityGroup.targetPathNode;
    var parentTargetPath = targetPath.parent;
    var parentDominatingIds;

    if(!targetPath.nonTerminals)
        return []; // no non-terminals to isert under

    if(parentTargetPath !== undefined) {
        // get the parent source ID (may be zero if the source path of the
        // identity group is the root path) and its source identity
        var parentId = identityGroup.isDominated() ?
            identityGroup.getParentSourceId(sourceElementId) : 0;
        if(parentTargetPath.nonTerminals) {
            var sourceParentIdentity = groupEntry.getSourceIdentity(parentId);
            parentDominatingIds = parentTargetPath.nonTerminals.
                getNonTerminals(undefined, sourceParentIdentity, 
                                groupEntry.targetIdentificationId);
        } else
            return []; // no dominating nodes
    }

    // get the source identity of the source node (don't use the identity
    // group for this, as it provides the identity for identity nodes).
    var sourceIdentity = groupEntry.getSourceIdentity(sourceElementId);
    
    return targetPath.nonTerminals.
        getNonTerminals(parentDominatingIds, sourceIdentity, 
                        groupEntry.targetIdentificationId);
}

///////////////////
// Non-Terminals //
///////////////////

// This function is called when a table to store non-terminals at the
// given target path node may be required. Such a table is required
// only if some group may merge nodes under non-terminals of another
// group. This may happen in two cases: either there are groups with
// different priorities merging to the same target path (in which case
// the children of the lower priority groups may be merged under the
// non-terminals mapped by the higher priority group) or when there
// is a minimal group whose explicit target path isa child path on this
// target path node.
// This function first checks whether there is need to construct
// such a table. If there is, it then goes over all target nodes at this
// path and stores the non-terminals among them in the non-terminals
// table. There is no need to check whether any nodes could be merged
// under these non-terminal because it is assumed that when this function
// is called the need for such merging was first created (by a group
// registration) and that the actual nodes to be merged have not yet been
// merged.

MergeIndexer.prototype.initNonTerminals = mergeIndexerInitNonTerminals;

function mergeIndexerInitNonTerminals(targetPathNode)
{
    if(targetPathNode.nonTerminals !== undefined)
        return; // already exists, nothing to do

    if(targetPathNode.dominatedMinGroups == 0 &&
       targetPathNode.maxGroupPriority <= targetPathNode.minGroupPriority)
        return; // no merging under non-teminals
    
    var nonTerminals = targetPathNode.nonTerminals =
        new PathNonTerminals(this, !!targetPathNode.parent);
    var targetPathId = targetPathNode.pathId;
    var _self = this;
    
    targetPathNode.nodes.forEach(function(nodeEntry, elementId) {

        if(!nodeEntry.hasAttrs)
            return; // not a non-terminal
        
        _self.addToIdentifiedByTarget(elementId, targetPathId);

        // get dominating node and base identity
        var elementEntry = _self.dataElements.getEntry(elementId);
        var dominatingElementId = elementEntry.pathId === targetPathId ?
            elementEntry.parent : elementId;  
        
        nonTerminals.addNonTerminal(dominatingElementId, 
                                    elementId,
                                    // default identity is the element ID
                                    elementEntry.identity === undefined ?
                                    elementId : elementEntry.identity);
    });
}

// This function checks whether the non-terminals table at the given
// path node is still needed (see initNonTerminals() for the criteria).
// If it is not needed, it is removed.

MergeIndexer.prototype.destroyNonTerminals = mergeIndexerDestroyNonTerminals;

function mergeIndexerDestroyNonTerminals(targetPathNode)
{
    if(targetPathNode.nonTerminals === undefined)
        return; // already removed

    if(targetPathNode.dominatedMinGroups > 0 ||
       targetPathNode.maxGroupPriority > targetPathNode.minGroupPriority)
        return; // non-terminals still needed

    targetPathNode.nonTerminals = undefined;
}

// This function is called to add the node given by targetPathNode
// and targetElementId as a non-terminal at this path. dominatingElementId
// is the ID of the dominating node (may be undefined if this is at the
// root path node) and identity is the base identity of this node.
// This function adds this node to the nonTerminals table of this path node.
// It then checks whether there are any nodes (mapped by other groups) 
// which can be merged under this non-terminal node based on its dominating
// node and identity.

MergeIndexer.prototype.addNonTerminal = mergeIndexerAddNonTerminal;

function mergeIndexerAddNonTerminal(targetPathNode, dominatingElementId,
                                    targetElementId, identity)
{
    this.addToIdentifiedByTarget(targetElementId, targetPathNode.pathId);

    // standard non-terminal (children are at lower path)
    var additionalIdentities = 
        targetPathNode.nonTerminals.addNonTerminal(dominatingElementId, 
                                                    targetElementId,
                                                    identity);

    // Check whether there are already existing children
    // which can be merged under this node
    this.mergeUnderNode(dominatingElementId, targetPathNode, targetElementId, 
                        identity, false, additionalIdentities);
}

// This function is called to remove the given nodes (in the array
// 'elementIds) as non-terminals.
// This may be called either when the nodes are removed or when they stop
// being non-terminals. This may be called on any nodes being removed,
// as this function checks for each node whether it is a non-terminal (if
// the node stopped being a non-terminal, this function must be called
// before its non-terminal value is set). 
// This function clears this node from the non-terminal table of the 
// path node and, if the node was inside a monitored sub-tree, removes
// the mapping monitors which were registered for unmapped node with
// the same identity and dominating ID as the on-terminal.

// remark: if this is called not a a result of the non-terminal 
// being removed but as a result of it not being a non-terminal
// anymore, this function must also remove children merged under it
// based on identity (a function to do this must already exist
// to handle the case the node changes its identity) xxxxxxxxxxxxxxxxx

MergeIndexer.prototype.removeNonTerminals = mergeIndexerRemoveNonTerminals;

function mergeIndexerRemoveNonTerminals(pathNode, elementIds)
{
    if(pathNode.nonTerminals === undefined ||
       pathNode.nonTerminals.getNum() == 0)
        return; // no non-terminals at this path

    var hasUnmapped = (pathNode.unmappedNodes !== undefined &&
                       pathNode.unmappedNodes.unmappedNum() > 0);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        if(elementId === undefined)
            continue;
        
        var nodeEntry = pathNode.nodes.get(elementId);

        if(!this.isNonTerminal(pathNode, elementId, nodeEntry))
            continue;
    
        this.removeFromIdentifiedByTarget(elementId, pathNode.pathId);

        var dataElementEntry = this.dataElements.getEntry(elementId);
        // default identity is the element ID
        var identity = dataElementEntry.identity === undefined ?
            elementId : dataElementEntry.identity;
        var dominatingId = (dataElementEntry.pathId == pathNode.pathId) ?
            dataElementEntry.parent : elementId;
        
        var additionalIdentities =
            pathNode.nonTerminals.removeNonTerminal(dominatingId, elementId, 
                                                    identity);

        if(hasUnmapped)
            // if in a sub-tree, remove mapping monitors for unmapped nodes
            // with the same dominating node and identities.
            if(this.inSubTree(nodeEntry))
                this.removeUnmappedMappingMonitor(pathNode, dominatingId, 
                                                  identity,
                                                  additionalIdentities);
    }
}

/////////////////////////
// Auxiliary Functions //
/////////////////////////

// This function returns true if the given node (whose entry at
// targetPathNode.nodes is nodeEntry) is a standard non-terminal.
// At the moment, this holds iff it has attributes (note that 
// a node may 'have attributes' but still have zero such attributes
// listed in its 'attrs' table.

// xxxxxxxxxxxx remove this function ?

MergeIndexer.prototype.isNonTerminal = mergeIndexerIsNonTerminal;

function mergeIndexerIsNonTerminal(targetPathNode, targetElementId,
                                   nodeEntry)
{
    return this.hasAttrs(nodeEntry);
}

// Given an identity, this function detemines whether it is the identity
// which is the result of the compression of a simple value (it must
// be a negative number then) and returns the corresponding simple value
// in an object of the form:
// {
//    type: <string> // type of the simple value
//    roundedValue: <simple value or ConstrRangeKey>
// }

MergeIndexer.prototype.getSimpleValueByIdentity =
    mergeIndexerGetSimpleValueByIdentity;

function mergeIndexerGetSimpleValueByIdentity(identity)
{
    if(typeof(identity) !== "number" || identity > 0)
        return undefined;

    // if this is an identity which is the result of the compression
    // of a simple value, the identity is additive inverse of the
    // simple compression value 
    return this.qcm.compression.getSimpleValue(-identity);
}

// The given group ID and target path ID define a source path in a source
// indexer.  The target path must either be the explicit target path of
// the group or, in case the group is the maximal group for the
// mapping, an extension target path. Together with the group, the
// target path defines a source indexer and a source path. This
// function return the path ID for that source path.

MergeIndexer.prototype.getSourcePathId = mergeIndexerGetSourcePathId;

function mergeIndexerGetSourcePathId(groupId, targetPathId)
{
    var mapping;
    if((mapping = 
        this.pathNodesById[targetPathId].mappingGroups.get(groupId)) !== true)
        // maximal group, the source path ID is stored in the mappingGroups
        // entry
        return mapping.sourcePathId;

    // otherwise, the source path is simply the source path of the group
    return this.groupById[groupId].sourcePathId;
}

// Given a target node in the indexer, this function returns its
// dominating node. This is the ID of the directly dominating node.
// If this node is a data element, this is the ID of its parent data element 
// and otherwise this is the same ID as that of the given target node.
// Note that in case of an operand, this returns the ID of its 
// directly dominating operator.

MergeIndexer.prototype.getDominatingId = mergeIndexerGetDominatingId;

function mergeIndexerGetDominatingId(targetElementId, pathId)
{
    var entry = this.dataElements.getEntry(targetElementId);
    return (entry.pathId == pathId ? entry.parent : targetElementId);
}

//////////////////
// Target Nodes //
//////////////////

// Given a group and a target path to which the group maps and an array
// of source IDs which the group merged, this function returns an
// array with the target IDs to which these source Ids were mapped.
// If there is a single function result registered to the merge indexer,
// there must be exactly one target node for each source node, so this
// function returns an array of element IDs. Otherwise, there may be
// multiple target IDs for each source ID. If 'returnFlat' is not set,
// the function returns an array of arrays (the array in each position in
// the returned array is the list of target IDs for the source ID at the
// correpsonding position in the input array). Some of these arrays may
// be empty. If 'returnFlat' is set, the function returns all target IDs
// in one array (each entry is a target element ID) and the alignment
// with the original source IDs is lost.

MergeIndexer.prototype.getAllTargetNodes = 
    mergeIndexerGetAllTargetNodes;

function mergeIndexerGetAllTargetNodes(groupEntry, targetPathNode, 
                                       sourceIds, returnFlat)
{
    // are there source nodes which were mapped to a different ID?
    var hasTranslation = groupEntry.hasSourceIdTranslation();

    var targetIds = [];
    
    if(this.numProjs == 1 || this.isSingleMappingResult()) {
        // single function result, so all source nodes are mapped to exactly
        // one ID
        if(!hasTranslation) // mapped to their original ID
            return sourceIds;

        return groupEntry.getAllTargetIdsAtPath(sourceIds,
                                                targetPathNode.pathId, true,
                                                true);
    }

    // first get the translated IDs (does not include the source IDs)
    // returns an empty array or an array of empty arrays if there is no
    // translation.
    targetIds = groupEntry.getAllTargetIdsAtPath(sourceIds,
                                                 targetPathNode.pathId, false,
                                                 returnFlat);

    // check for source IDs mapped to themselves.
    
    var targetNodes = targetPathNode.nodes;
    var groupId = groupEntry.groupId;

    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {

        var sourceId = sourceIds[i];
        
        if(targetNodes.has(sourceId)) {
            if(returnFlat)
                targetIds.push(sourceId);
            else
                targetIds[i].push(sourceId);
        }
    }

    return targetIds;
}

    
// Given a source node 'sourceId' merged by the group 'groupEntry'
// at target path 'targetPathNode', this function returns the target node
// dominated by 'dominatingId' and mapped by this group from this source 
// node at the given target path. This returns undefined if no such
// target node ID is found.

MergeIndexer.prototype.getTargetNodeWithDominating = 
    mergeIndexerGetTargetNodeWithDominating;

function mergeIndexerGetTargetNodeWithDominating(groupEntry, targetPathNode, 
                                                 sourceId, dominatingId)
{
    var targetNodes = targetPathNode.nodes;
    
    // check for a target node with the same element ID as the source

    if(targetNodes.has(sourceId)) {
        // check whether this node is dominated by the given dominating ID
        if(sourceId == dominatingId)
            return sourceId;
        else {
            var elementEntry = this.dataElements.getEntry(sourceId);
            if(elementEntry.pathId == targetPathNode.pathId && 
               elementEntry.parent == dominatingId)
                return sourceId;
        }
    }

    // check for target element IDs with translated element IDs
    if(!groupEntry.hasSourceIdTranslation())
        return undefined;

    return groupEntry.getTargetId(sourceId, targetPathNode.pathId,
                                  dominatingId);
}

/////////////////////////////////////////////
// Source -> Traget Element ID Translation //
/////////////////////////////////////////////

// This function receives a set (array) of target element IDs and a path
// node in the target indexer which together define nodes about to be removed.
// The function then checks whether there are any groups which have this
// path as a target path (explicit or extension) and also have a
// source ID translation table (meaning that the original source IDs
// were translated to new target IDs before being merged). If there is
// such a group, the function then checks for each target ID in the
// list whether the target ID differs from its source ID. If it does, it
// is removed from the 'sourceDataElements' table of the mapping group.

MergeIndexer.prototype.removeDataElementIdsFromGroup = 
    mergeIndexerRemoveDataElementIdsFromGroup;

function mergeIndexerRemoveDataElementIdsFromGroup(elementIds, pathNode)
{
    // check whether there are groups with this target path which translated
    // source IDs
    if(this.numTranslatingGroups(pathNode) == 0)
        return; // no source IDs were translated.

    var nodes = pathNode.nodes;
    var hasDataElements = pathNode.hasDataElements;
    var groupId;
    var groupEntry;
    var sourceDataElements;
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var elementId = elementIds[i];
        if(elementId === undefined)
            continue;
        
        var elementEntry = this.dataElements.getEntry(elementId);
        
        if(elementEntry.sourceId === undefined || // default source ID
           elementEntry.sourceId == elementId)
            continue; // same ID, not stored in the table.

        if(elementEntry.groupId !== groupId) {
            groupId = elementEntry.groupId;
            groupEntry = this.groupById[groupId];
            sourceDataElements = groupEntry.sourceDataElements;
        }
        
        if(!hasDataElements) {
            if(!sourceDataElements.removeTargetId(elementEntry.sourceId,
                                                  pathNode.pathId,
                                                  elementId))
                groupEntry.sourceDataElements = undefined; // last one removed
        } else {
            var dominatingId = (elementEntry.pathId == pathNode.pathId) ?
                elementEntry.parent : elementId;
            if(!sourceDataElements.removeTargetId(elementEntry.sourceId,
                                                  pathNode.pathId,
                                                  dominatingId))
                groupEntry.sourceDataElements = undefined; // last one removed
        }
    }
}

// This function returns the number of groups which perform some translation
// of source IDs to target IDs which have the given path as one of their
// target paths. Tge function returns a number which is the number of
// such groups.

MergeIndexer.prototype.numTranslatingGroups = 
    mergeIndexerNumTranslatingGroups;

function mergeIndexerNumTranslatingGroups(pathNode)
{
    var numGroups = 0;

    var _self = this;
    pathNode.mappingGroups.forEach(function(entry, groupId) {
        var groupEntry = _self.groupById[groupId];
        if(groupEntry.sourceDataElements !== undefined &&
           !groupEntry.sourceDataElements.isEmpty())
            numGroups++;
    });

    return numGroups;
}

//////////////////
// Source Nodes //
//////////////////

// Given a source node with ID 'sourceId' merged by the group whose 
// entry is 'groupEntry', which is not a maximal group, this function
// returns a list with the nodes at the child paths of the source path
// of this node which were mapped by some mapping in the given group.
// The returned children must be directly dominated by the node 
// 'sourceId' at the source path of the group and must be at child
// paths of the source path of the group. This means that if the node
// 'sourceId' is an operator at the source path of the group, this 
// function will return nothing (because the directly dominated nodes
// are operands at the same path).
// The result is returned in an array with entries of the form:
// {
//    groupEntry: <the group which mapped the children>,
//    sourceIds: <array of child source IDs at the source path of this group>
// }
// groupEntry always stores a group which has 'groupEntry' as its prefix.
//
// This function is mainly used for the removal of nodes under an unmapped
// node. It is not used for addition, as addition of nodes always starts
// at the nodes mapped at the maximal source paths (and in case of 
// operators, the lowest such nodes).

MergeIndexer.prototype.getSourceChildrenOfNonMax = 
    mergeIndexerGetSourceChildrenOfNonMax;

function mergeIndexerGetSourceChildrenOfNonMax(sourceId, groupEntry)
{
    var nextGroups = groupEntry.nextGroups;
    
    if(nextGroups === undefined)
        return []; // this is a maximal group

    var sourceIds = [sourceId];
    
    if(groupEntry.isIdentityGroup)
        // the source ID are identity node IDs. We need to first convert them
        // into the original source IDs
        sourceIds = this.getSourceNodesOfIdentities(sourceIds);

    
    // check whether sourceIds are operators dominating some operands
    sourceIds = groupEntry.filterOutOperators(sourceIds);
    
    var sourceChildren = [];
    
    for(var i = 0, l = nextGroups.length ; i < l ; ++i) {

        var nextGroup = nextGroups[i];
        var children =
            nextGroup.getSourceNodesDominatedBy(sourceIds,
                                                groupEntry.sourcePathId);
        if(children.length > 0)
            sourceChildren.push({ groupEntry: nextGroup, sourceIds: children });
    }

    return sourceChildren;
}

////////////////////
// Unmapped Nodes //
////////////////////

// This function is called when the given source nodes ('sourceIds' array)
// are merged under the dominating nodes given by 'dominatingIds'
// (a flat array, so ource IDs may have to be repeated in 'sourceIds')
// and they should be made unmapped. In addition to adding these
// nodes to the 'unmappedNodes' table, this function also needs to check
// whether these unmapped nodes can be merged under operator nodes at this
// path (based on their indentities). Those that can are merged by
// this function. Such merging can only take place under operator nodes
// which are data elements (otherwise merging should have already taken place
// before this node became unmapped, see introduction).
// This function then needs to return an array with the dominating nodes
// under which the children of the given source nodes can be merged.
// For those nodes which could be merged under operators, these are simply
// the target nodes of these source nodes. For other source nodes, these
// are the non-terminals at the target path which have a matching identity.
// Since it is possible that multiple non-terminals have the same
// identity, there may be more than one domianting node for the children
// of a source node under a given dominating node.
// The function then returns an array which is alligned with 'sourceIds'
// with each entry holding an array of target element IDs under which
// the children of the corresponding source ID may be merged.

MergeIndexer.prototype.mergeNodesAsUnmapped = mergeIndexerMergeNodesAsUnmapped;

function mergeIndexerMergeNodesAsUnmapped(groupEntry, targetPathNode, 
                                          sourceIds, dominatingIds) 
{
    var sourceIdentities = groupEntry.getSourceIdentities(sourceIds);
    this.addUnmappedNodes(groupEntry, targetPathNode, sourceIds, 
                          dominatingIds, sourceIdentities);

    var opChildDominatingIds;
    
    if(targetPathNode.dataElementOperators !== undefined) {
        childDominatingIds =
            this.mergeUnmappedUnderOperators(groupEntry, targetPathNode,
                                             sourceIds, dominatingIds,
                                             sourceIdentities);
    }

    // get the non-terminals whose target identity matches the source
    // identity of the unmapped nodes. These are the dominating nodes for
    // the children of the unmapped nodes.
    
    var childDominatingIds;

    if(targetPathNode.nonTerminals === undefined)
        return opChildDominatingIds ? opChildDominatingIds : [];

    childDominatingIds = targetPathNode.nonTerminals.
        getAllNonTerminals(dominatingIds, sourceIdentities, 
                           groupEntry.targetIdentificationId);
    if(childDominatingIds === undefined || childDominatingIds.length === 0)
        return opChildDominatingIds ? opChildDominatingIds : [];

    // add mapping monitors on the unmapped node, if needed
    this.addMappingMonitorUnderNonTerminals(groupEntry, targetPathNode,
                                            sourceIds, childDominatingIds);

    if(opChildDominatingIds === undefined || opChildDominatingIds.length === 0)
        return childDominatingIds;

    // need to merge the two arrays of child dominating IDs (and return this
    // combined list)
    return mergeArraysOfArrays(opChildDominatingIds, childDominatingIds);    
}

// This function receives as input a set of unmapped nodes with their
// dominating IDs (the list of dominating IDs is flat, so an unmapped ID
// may appear more than once, if merged under multiple dominating IDs).
// The function also receives the group entry for the group which merged
// the nodes, the target path to which they were merged and an array with
// their source identities. This function checks whether there are any
// operators at this path which are data elements and whose target identity
// (for the given group) matches the source identity of the unmapped nodes.
// When this happens, the unmapped nodes may be merged under the operator(s).
// Such merging is only applied under operators which are data elements
// (for non-data-element operators, merging should have already taken place
// before this node became unmapped, see introduction).
// For those unmapped IDs which were merged under operators, this merging
// produces the dominating nodes for the merging of the children of the
// unmapped IDs. This function therefore returns an array aligned with
// 'unmappedIds' such that every position where an unmapped node was merged
// under an operator holds an array with the target IDs which are dominating
// for the children of the source nodes. Where no merging took place,
// undefined or an empty array is placed. The returned array may be shorter
// than the input 'unmappedIds' array (all missing positions are considered
// to store undefined).

MergeIndexer.prototype.mergeUnmappedUnderOperators =
    mergeINdexerMergeUnmappedUnderOperators;

function mergeINdexerMergeUnmappedUnderOperators(groupEntry, targetPathNode,
                                                 unmappedIds, dominatingIds,
                                                 sourceIdentities)
{
    if(targetPathNode.dataElementOperators === undefined)
        return [];

    // create the list of dominating nodes under which the unmapped nodes
    // may be merged.
    var domOperatorIds = targetPathNode.dataElementOperators.
        getAllNonTerminals(dominatingIds, sourceIdentities, 
                           groupEntry.targetIdentificationId);

    if(domOperatorIds === undefined || domOperatorIds.length === 0)
        return [];

    // add mapping monitors on the unmapped node, if needed
    this.addMappingMonitorUnderNonTerminals(groupEntry, targetPathNode,
                                            unmappedIds, domOperatorIds);
    
    // merge under these nodes (and return the resulting list of child
    // dominating nodes)

    return this.addMergedNodes(groupEntry, targetPathNode, unmappedIds,
                               domOperatorIds);
}

// This function is called when the target nodes at path
// 'targetPathNode' and under element IDs 'targetIds' (an array of element IDs),
// which were previously mapped, become unmapped (which means that a
// conflicting node mapped by a group with a higher priority is about to be
// added). 'dominatingIds' are the dominating nodes dominating 'targetIds'.
// 'dominatingIds' may be undefined.
// The function needs to do two things: find the source ID of each target ID
// and the group that merged it (so that the node can be added to the
// 'unmappedNodes' table) and remove the target IDs. The function looks up
// the source and group ID before removing the target ID (to make sure the
// information is available) and then removed the target IDs and finally
// adds the source IDs to the unmapped node table. The nodes are added
// to the unmapped node table after splitting them into separate lists,
// by the group which merged them. There is a special case where it is
// known in advance that there can be no more than one group which merged all
// nodes (and therefore there is no need to duplicate the arrays).
// This function does not need to check whether the children of these
// unmapped nodes can be merged under non-terminals with the same identity
// (as the unmapped nodes) because these non-terminals have not been added
// yet (but are only about to be added).

MergeIndexer.prototype.makeNodesUnmapped = mergeIndexerMakeNodesUnmapped;

function mergeIndexerMakeNodesUnmapped(targetPathNode, 
                                       targetIds, dominatingIds)
{
    if(targetPathNode.mappingGroups.size <= 2) {
        // special case: all unmapped groups must be from one group, so there
        // is no need to split into separate arrays of source/dominating nodes.
        var sourceIds = new Array(targetIds.length);
        var groupEntry;
        for(var i = 0, l = targetIds.length ; i < l ; ++i) {
            var targetId = targetIds[i];
            if(targetId === undefined)
                continue;
            var elementEntry = this.dataElements.getEntry(targetId);
            if(groupEntry === undefined)
                groupEntry = this.groupById[elementEntry.groupId];
            // default source ID is equal to target ID
            sourceIds[i] = elementEntry.sourceId === undefined ?
                targetId  : elementEntry.sourceId;
        }

        // remove the target nodes and make the source nodes unmapped
        this.removeTargetNodes(targetIds, targetPathNode);
        if(groupEntry !== undefined) {
            var sourceIdentities = groupEntry.getSourceIdentities(sourceIds);
            this.addUnmappedNodes(groupEntry, targetPathNode, sourceIds,
                                  dominatingIds, sourceIdentities);
        }
        return;
    }

    // May need to unmap nodes merged by more than one group. Find the source
    // nodes of the target mapped nodes and split them by the group which
    // mapped them.
    
    var byGroup = new Map();
    var groupId;
    var unmappedForGroup; 
    
    for(var i = 0, l = targetIds.length ; i < l ; ++i) {
        var targetId = targetIds[i];
        if(targetId === undefined)
            continue;
        var elementEntry = this.dataElements.getEntry(targetId);
        if(elementEntry.groupId !== groupId) {
            groupId = elementEntry.groupId;
            if(byGroup.has(groupId))
                unmappedForGroup = byGroup.get(groupId);
            else {
                unmappedForGroup = {
                    sourceIds: [],
                    dominatingIds: dominatingIds ? [] : undefined,
                    groupEntry: this.groupById[groupId]
                };
                byGroup.set(groupId, unmappedForGroup);
            }
        }

        // default source ID is the target ID
        unmappedForGroup.sourceIds.push(elementEntry.sourceId === undefined ?
                                        targetId : elementEntry.sourceId);
        if(dominatingIds !== undefined)
            unmappedForGroup.dominatingIds.push(dominatingIds[i]);
    }

    // remove the target nodes (including all nodes domianted by them)
    this.removeTargetNodes(targetIds, targetPathNode);

    // add these source nodes to the list of unmapped nodes at this target
    // path node (this need to be done separately for each group).
    var _self = this;
    byGroup.forEach(function(unmappedForGroup, groupId) {
        var groupEntry = unmappedForGroup.groupEntry;
        var sourceIdentities = groupEntry.getSourceIdentities(sourceIds);
        _self.addUnmappedNodes(groupEntry, targetPathNode,
                               unmappedForGroup.sourceIds,
                               unmappedForGroup.dominatingIds,
                               sourceIdentities);
    });
}

// This function finds all target nodes at the given target path which
// are dominated by the given dominating IDs (an array of target element IDs)
// and makes all these nodes unmapped.

MergeIndexer.prototype.makeNodesUnderDominatingUnmapped =
    mergeIndexerMakeNodesUnderDominatingUnmapped;

function mergeIndexerMakeNodesUnderDominatingUnmapped(targetPathNode, 
                                                      dominatingIds)
{
    // find the children of the given domianting nodes at the given target path.

    var targetIds = [];
    var flatDominatingIds = [];
    var nodes = targetPathNode.nodes;
    var targetPathId = targetPathNode.pathId;
    
    for(var i = 0, l = dominatingIds.length ; i < l ; ++i) {

        var dominatingId = dominatingIds[i];
        if(dominatingId === undefined)
            continue;
        
        if(nodes.has(dominatingId)) {
            flatDominatingIds.push(dominatingId);
            targetIds.push(dominatingId);
        } else {
            var childIds = this.getDirectChildDataElements(dominatingId,
                                                           targetPathId);
            for(var j = 0, m = childIds.length ; j < m ; ++j) {
                flatDominatingIds.push(dominatingId);
                targetIds.push(childIds[j]);
            }
        }
    }

    this.makeNodesUnmapped(targetPathNode, targetIds, flatDominatingIds);
}
    
// This function adds the nodes with IDs 'sourceIds' mapped by
// the group whose entry is 'groupEntry' as unmapped nodes at
// the target path 'targetPathNode'. This function adds these nodes to
// the unmappedNodes table of 'targetPathNode'. 'dominatingIds' are the
// data element IDs of the target nodes dominating these unmapped nodes
// (this array may be undefined if all unmapped nodes were merged to the
// root path node (and not under operators)). 'sourceIdentities' is an
// array with the source identities (under the given group) of the source IDs.

MergeIndexer.prototype.addUnmappedNodes = mergeIndexerAddUnmappedNodes;

function mergeIndexerAddUnmappedNodes(groupEntry, targetPathNode, sourceIds, 
                                      dominatingIds, sourceIdentities)
{
    if(!targetPathNode.unmappedNodes)
        targetPathNode.unmappedNodes = new UnmappedNodes();
    var unmapped = targetPathNode.unmappedNodes;

    if(unmapped.unmappedNum() == 0)
        // was empty until now, record for identification updates
        this.addToUnmappedByIdentification(targetPathNode);
    
    var sourceIdentities = groupEntry.getSourceIdentities(sourceIds);
    var groupId = groupEntry.groupId;
    var priority = groupEntry.priority;
    
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
        var sourceId = sourceIds[i];
        if(sourceId === undefined)
            continue;
        var dominatingId =
            dominatingIds === undefined ? undefined : dominatingIds[i];
        unmapped.addNode(sourceId, groupId, dominatingId, priority,
                         sourceIdentities[i]);
    }
}

/////////////////////////
// Target Node Removal //
/////////////////////////

// This function removes the target node at 'targetPathNode' which 
// has its source at the given source data element and group and
// is mapped under the given dominating node. Note that there is
// at most one such target node.
// When a target node is removed, all nodes it dominates (mapped
// or unmapped) are also removes.
// If the path node has unmapped nodes, we must check whether 
// the removal of the target node allows for unmapped nodes to 
// become mapped. This happens in case the node removed was the last
// mapped node under its dominating node and there are unmapped nodes
// under that dominating node.
// This function returns true if the required target node was found 
// (and removed) and false if no such target node was found.

MergeIndexer.prototype.removeDominatedTargetNodeBySource = 
    mergeIndexerRemoveDominatedTargetNodeBySource;

function mergeIndexerRemoveDominatedTargetNodeBySource(sourceElementId, 
                                                       groupEntry, 
                                                       targetPathNode, 
                                                       dominatingId)
{
    var targetId = 
        this.getTargetNodeWithDominating(groupEntry, targetPathNode, 
                                         sourceElementId, dominatingId);
    if(targetId === undefined)
        return false;

    this.removeTargetNodes(targetPathNode, [targetId]);
    
    if(targetPathNode.unmappedNodes && 
       targetPathNode.unmappedNodes.unmappedNum() > 0)
        this.makeUnmappedIntoMapped(targetPathNode, targetId, dominatingId);

    return true;
}

// This function removes all target nodes at 'targetPathNode' which 
// have their sources at the given source elements (the array 'sourceIds')
// and group.
// When a target node is removed, all nodes it dominates (mapped
// or unmapped) are also removes.
// If the path node has unmapped nodes, we must check whether 
// the removal of the target nodes allows for unmapped nodes to 
// become mapped. This happens in case a node removed was the last
// mapped node under its dominating node and there are unmapped nodes
// under that dominating node.

MergeIndexer.prototype.removeTargetNodesBySource = 
    mergeIndexerRemoveTargetNodesBySource;

function mergeIndexerRemoveTargetNodesBySource(groupEntry, targetPathNode,
                                               sourceIds)
{
    var allTargetIds = this.getAllTargetNodes(groupEntry, targetPathNode, 
                                              sourceIds, true);

    if(this.isSingleMappingResult()) {
        // only one function result, single target node per source node
        // (and there cannot be any unmapped nodes)
        this.removeTargetNodes(targetPathNode, allTargetIds);
        return;
    }

    // multiple function results, may have conflicts and unmapped nodes
    
    // are there unmapped nodes at this path node?
    var hasUnmapped = (!!targetPathNode.unmappedNodes && 
                       targetPathNode.unmappedNodes.unmappedNum() > 0);

    if(!hasUnmapped)
        this.removeTargetNodes(targetPathNode, allTargetIds);
    else {
        
        // need to find the dominating nodes of the nodes being removed,
        // as their removal may allow unmapped nodes under the same dominating
        // nodes to become mapped. If the target path is the root path,
        // the dominating ID is 'undefined'

        var dominatingIds;
        var prefixPathId = this.qcm.getPrefix(targetPathNode.pathId);
        if(prefixPathId !== undefined) { 
            dominatingIds = 
                this.raiseAllToPath(allTargetIds, prefixPathId,
                                    targetPathNode.pathId);
        }

        this.removeTargetNodes(targetPathNode, allTargetIds);

        if(dominatingIds === undefined) // target path is root path
            this.makeUnmappedIntoMapped(targetPathNode, undefined, undefined);
        else {
            for(var i = 0, l = allTargetIds.length ; i < l ; ++i) {
                // check whether this removed the last node under the dominating
                // node and if there are unmapped nodes under the domainting
                // node, make the highest priority of them into mapped nodes.
                this.makeUnmappedIntoMapped(targetPathNode, allTargetIds[i],
                                            dominatingIds[i]);
            }
        }
    }
}

// This function is called after the target node with data element ID
// 'removedId' is removed from path node 'targetPathNode'. 'dominatingId'
// is the ID of the dominating node. It is assumed this function is
// called only if targetPathNode has a non-empty unmapped nodes list.
// This function then checks whether the node removed was the last node
// under the given dominating node and whether there are unmapped nodes
// under that dominating node (all at the given path). If this is indeed 
// the case, this function makes the highest priority unmapped nodes
// into mapped nodes.
// In case targetPathNode is the root path, 'dominatingId' and 'removedId'
// may both be undefined.

MergeIndexer.prototype.makeUnmappedIntoMapped = 
    mergeIndexerMakeUnmappedIntoMapped;

function mergeIndexerMakeUnmappedIntoMapped(targetPathNode, removedId, 
                                            dominatingId)
{
    if(!targetPathNode.unmappedNodes.hasUnmapped(dominatingId))
        return; // no unmapped nodes under the given dominating node

    // check whether this was the last node under the dominating node.
    // If the removed node has the same ID as the dominating node,
    // it is immediate that it was the last node. If the dominating node
    // is 'undefined', the target path is the root path and we need to
    // check whether all nodes have been removed at the root.
    if((dominatingId === undefined && targetPathNode.nodes.size == 0) ||
       (removedId != dominatingId &&
        this.dataElements.hasDirectChildDataElements(dominatingId,
                                                     targetPathNode.pathId)))
        return; // still have other children under the dominating node

    // get the highest priority unmapped nodes under the given dominating
    // node (this also removes these nodes from the unmapped node list).
    
    var highestPriority = 
        targetPathNode.unmappedNodes.getHighestPriority(dominatingId);

    if(!highestPriority)
        return; // no unmapped nodes
    
    // map the nodes
    for(var groupId in highestPriority) {
        var groupEntry = this.groupById[groupId];
        for(var sourceId in highestPriority[groupId].nodes)
            this.mergeChildNode(sourceId, groupEntry, targetPathNode, 
                                [dominatingId]);
    }
}

// This function removes the given target nodes (the element IDs in the array
// 'elementIds'), and all nodes they dominate (both mapped and unmapped).
// This includes removal of registrations to the various unmapped, children
// by identity, operator and operand tables.
// Note that this function only removes these nodes (and all nodes under them)
// but does not check whether there are any unmapped nodes at this
// target path which could be now become mapped. This is the responsibility
// of the function that called this function.

MergeIndexer.prototype.removeTargetNodes = mergeIndexerRemoveTargetNodes;

function mergeIndexerRemoveTargetNodes(targetPathNode, elementIds)
{
    // first, remove all children
    this.removeChildrenUnderMappedNodes(targetPathNode, elementIds);
    
    // next, remove the nodes themselves
    this.removeMappedNodeEntries(targetPathNode, elementIds);
}

// This function removes all target nodes under the nodes given by
// (target) pathNode and (target) elementIds (an array of element IDs at
// the given path node). This function
// removes both mapped and unmapped nodes dominated by these nodes.
// 'pathNode' and 'elementIds' indicate the nodes at which the removal
// process is at this moment. This is a recursive process, so these are not
// necessarily the nodes from which the removal process started.

MergeIndexer.prototype.removeChildrenUnderMappedNodes = 
    mergeIndexerRemoveChildrenUnderMappedNodes;

function mergeIndexerRemoveChildrenUnderMappedNodes(pathNode, elementIds)
{
    // for those nodes which are operators, get their direct operand children

    var operandIds = this.getAllDirectOperandsFlat(elementIds, pathNode.pathId);

    if(operandIds !== undefined) {
        // remove the children of these operands
        this.removeTargetNodes(pathNode, operandIds);
        // since there are some operators among 'elementIds' it is possible
        // that there are some unmapped nodes at this path under these nodes
        // as dominating nodes (for those elements which are not operators
        // this will not do anything since there cannot be an unmapped node
        // at a path P and dominated by an element ID if that element ID
        // appear on the path P unless that element is an operator). 
        this.removeUnmappedNodesByDominating(pathNode, elementIds);
    }
        
    for(var attr in pathNode.children) {
        
        var childPathNode = pathNode.children[attr];

        // get target child nodes, so the child relation does not need to
        // take the projection update into account (which is why the third
        // argument below is true).
        var childIds = this.getAllDirectChildrenFlat(elementIds,
                                                     childPathNode.pathId,
                                                     true);

        if(childIds === undefined)
            continue;

        this.removeTargetNodes(childPathNode, childIds);
        this.removeUnmappedNodesByDominating(childPathNode, elementIds);
    }
}

// This function is called to remove the entry for a list (array) of
// mapped node in the merge indexer. 'elementIds' is an array of
// element data IDs for nodes at the target path 'pathNode'.
// The function removes the nodes from the non-terminals tables,
// if needed, (both the standard non-terminals and the operator 
// non-terminals), clears their entries from the 'sourceDataElements' table
// of the group (if needed) and removes the node entries (from the path
// node's 'nodes' table) for these nodes. This 
// function does not recursively remove the nodes under these nodes.
// To do so, one should call removeChildrenUnderMappedNodes().

MergeIndexer.prototype.removeMappedNodeEntries = 
    mergeIndexerRemoveMappedNodeEntries;

function mergeIndexerRemoveMappedNodeEntries(pathNode, elementIds)
{
    // if there is need, remove the entry in the group's 'sourceDataElements'
    // table for this group.
    this.removeDataElementIdsFromGroup(elementIds, pathNode);

    // check whether this is a non-terminal and if it is, remove it
    this.removeNonTerminals(pathNode, elementIds);

    // check whether this is an operator and if it is, remove it
    this.removeNonTerminalOperators(pathNode, elementIds);

    // remove the nodes
    this.removeNodes(pathNode, elementIds);

    if(pathNode.parent === undefined && pathNode.nodes.size == 0)
        pathNode.priority = -Infinity; // no nodes merged here
    
    // if the 'dominatedPriorities' table is not empty, clear relevant entries
    if(pathNode.dominatedPriorities === undefined ||
       pathNode.dominatedPriorities.size == 0)
        return; // nothing more to do

    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(elementId === undefined)
            continue;
        var dataElementEntry = this.dataElements.getEntry(elementId);
        if(dataElementEntry.pathId != pathNode.pathId)
            // removed element is not a data element, so was not included here
            continue;
        var dominatingId = dataElementEntry.parent;
        if(dominatingId !== undefined && 
           !this.hasDirectChildDataElements(dominatingId, pathNode.pathId))
            pathNode.dominatedPriorities.delete(dominatingId);
    }
}

// This function removes all unmapped nodes in the 'unmappedNodes' table
// of the given target path node which have their source at the given source
// nodes (the array 'sourceIds') and mapping group. This clears the entries
// of these nodes from the 'unmappedNodes' table. In addition, the function
// removes the children of these unmapped nodes which were merged under 
// non-terminals of other groups.
// If a mapping monitor was created for the given group and source node,
// it is destroyed.

MergeIndexer.prototype.removeUnmappedNodesBySource = 
    mergeIndexerRemoveUnmappedNodesBySource;

function mergeIndexerRemoveUnmappedNodesBySource(groupEntry, targetPathNode,
                                                 sourceIds)
{
    // remove from the unmapped nodes table and get the identity and 
    // domianting IDs under which this node was unmapped

    if(targetPathNode.unmappedNodes === undefined ||
       targetPathNode.unmappedNodes.getNum() == 0)
        return; // no unmapped nodes

    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {

        var sourceId = sourceIds[i];
        var unmapped = targetPathNode.unmappedNodes.
            removeBySource(sourceId, groupEntry.groupId, groupEntry.priority);
        if(unmapped === undefined)
            continue; // no unmapped nodes for this source node
    
        // remove children of the unmapped node which are mapped under 
        // non-terminals from other groups.
        this.removeChildrenOfUnmappedUnderAll(targetPathNode, groupEntry,
                                              sourceId, unmapped.dominatingIds, 
                                              unmapped.identity);

        // if a mapping monitor was registered for this group and source node,
        // destroy it (last argument undefined indicates this).
        this.removeMappingMonitor(groupEntry, targetPathNode, sourceId,
                                  undefined);

        if(targetPathNode.unmappedNodes.getNum() == 0) {
            this.removeFromUnmappedByIdentification(targetPathNode);
            break; // no more unmapped nodes
        }
    }
}

// This function is called to remove all unmapped nodes at path
// 'pathNode' dominated by the nodes with IDs 'dominatingIds'. This
// clears the entries of these nodes from the 'unmappedNodes' table.
// If pathNode is the root path node, 'dominatingIds' should be [undefined]
// and this will clear all unmapped nodes.
// This function is not required to remove the children of these unmapped
// nodes which were merged under non-terminal node of other groups.
// This is because this function is assumed to be called only when all
// nodes under the dominating nodes (and probably also the dominating nodes
// tehmselves) are removed. Therefore, the non-terminals under which children
// of the unmapped nodes were merged will also be removed, and those children
// with them.

MergeIndexer.prototype.removeUnmappedNodesByDominating = 
    mergeIndexerRemoveUnmappedNodesByDominating;

function mergeIndexerRemoveUnmappedNodesByDominating(pathNode, dominatingIds)
{
    var dominatedUnmapped;

    if(pathNode.unmappedNodes === undefined ||
       pathNode.unmappedNodes.getNum() == 0)
        return; // no unmapped nodes

    for(var i = 0, l = dominatingIds.length ; i < l ; ++i) {

        var dominatingId = dominatingIds[i];

        if(dominatingId === undefined)
            continue;
        
        if(!pathNode.unmappedNodes.hasUnmapped(dominatingId) ||
           !(dominatedUnmapped = 
             pathNode.unmappedNodes.getByDominating(dominatingId)))
            continue; // no unmapped nodes dominated by the given node

        // remove all these unmapped nodes from the table (the entry in 
        // 'dominatedUnmapped' remains intact)
        pathNode.unmappedNodes.removeByDominating(dominatingId);
        
        if(pathNode.unmappedNodes.getNum() == 0) { // no more unmapped nodes
            this.removeFromUnmappedByIdentification(pathNode);
            // force termination of the loop (but first perform operation below)
            i = l - 1;
        }

        if(!pathNode.subTree)
            continue;
        
        // check whether any mapping monitors need to be removed for
        // these unmapped nodes. Go over the unmapped nodes, removing their
        // monitors

        for(var j = 0, m = dominatedUnmapped.byPriority ; j < m ; ++j) {

            var priorityEntry = dominatedUnmapped.byPriority[j];
            
            for(var groupId in priorityEntry.groups) {
                
                var groupNodes = priorityEntry.groups[groupId].nodes;
                var groupEntry = this.groupById[groupId];
                this.removeUnmappedMappingMonitorByDominating(pathNode, 
                                                              groupEntry,
                                                              dominatingId,
                                                              groupNodes);
            }
        }
    }
}

// This function receives a non-terminal node given by the path 
// 'targetPathNode' and the data element ID 'nonTerminalId' dominated
// by the node with element ID 'dominatingId'. A target identity
// of the non-terminal (which may have just changed) is also given by
// 'identity' and 'identificationId'. In case 'identificationId' is
// undefined (base identification) 'additional' is and object 
// whose attributes are additional identification IDs to which this 
// removal should apply (typically, these will be identifications 
// which do not explicitly provide an identity for this non-terminal
// and therefore the change in the base identity also implies a change
// in these identities).
// The function then goes over all unmapped nodes whose children were
// inserted under the non-terminal as a result of matching this identity.
// The children of these unmapped nodes are then removed from under the
// non-terminal.

MergeIndexer.prototype.removeChildrenOfUnmappedByIdentity = 
    mergeIndexerRemoveChildrenOfUnmappedByIdentity;

function mergeIndexerRemoveChildrenOfUnmappedByIdentity(targetPathNode,
                                                        nonTerminalId,
                                                        dominatingId,
                                                        identity,
                                                        identificationId,
                                                        additional)
{
    if(targetPathNode.unmappedNodes === undefined)
        return;

    var byGroup = targetPathNode.unmappedNodes.getByIdentity(identity, 
                                                             dominatingId);
    if(!byGroup)
        return;

    for(var groupId in byGroup.groups) {
        // check that this group's target identification matches that 
        // of the non-terminal.
        var groupEntry = this.groupById[groupId];
        if(groupEntry.targetIdentificationId != identificationId &&
           (!additional || 
            !(groupEntry.targetIdentificationId in additional)))
            continue;
        
        for(var unmappedId in byGroup.groups[groupId].nodes)
            this.removeChildrenOfUnmapped(targetPathNode, groupEntry, 
                                          unmappedId, [nonTerminalId]);
    }
    
}

// Given an unmapped node, defined by its source ID 'unmappedId', the group
// which mapped it 'groupEntry', its target path node 'targetPathNode',
// and an array of node IDs 'dominatingIds' dominating it, this function
// removes all the children of this unmapped node which were mapped under 
// non-terminals (of other groups). To do this, the function also needs
// to have the unmapped node's source identity as defined by the group.
// This should be provided by the calling function in 'unmappedIdentity'.
// This should be the identity as retrieved from the unmappedNodes
// table and not retrieved directly from the source indexer, as this is
// the identity which was used to merge the children.
// The function first finds all non-terminals matching the indentity and
// then calls 'removeChildrenOfUnmapped(...)' to actually perform
// the removal.

MergeIndexer.prototype.removeChildrenOfUnmappedUnderAll = 
    mergeIndexerRemoveChildrenOfUnmappedUnderAll;

function mergeIndexerRemoveChildrenOfUnmappedUnderAll(targetPathNode, 
                                                      groupEntry, 
                                                      unmappedId, dominatingIds,
                                                      unmappedIdentity)
{
    // find the non-terminals which dominate the children of this 
    var nonTerminals = targetPathNode.nonTerminals.
        getNonTerminals(dominatingIds, unmappedIdentity, 
                        groupEntry.targetIdentificationId);

    if(!nonTerminals)
        return;

    this.removeChildrenOfUnmapped(targetPathNode, groupEntry, unmappedId, 
                                  nonTerminals);
}

// Given an unmapped node, defined by its source ID 'unmappedId', the group
// which mapped it 'groupEntry', its target path node 'targetPathNode',
// and an array 'nonTerminals' of the IDs of non-terminals where the
// children of the unmapped node may have been merged under, this function
// removes those children from under the non-terminals. 
// There are two different implementations to this function: one in case
// 'groupEntry' is not a maximal group and one when it is. 

MergeIndexer.prototype.removeChildrenOfUnmapped = 
    mergeIndexerRemoveChildrenOfUnmapped;

function mergeIndexerRemoveChildrenOfUnmapped(targetPathNode, groupEntry, 
                                              unmappedId, nonTerminals)
{
    if(!groupEntry.isMaxGroup)
        this.removeChildrenOfUnmappedAtNonMax(targetPathNode, groupEntry, 
                                              unmappedId, nonTerminals);
    else
        this.removeChildrenOfUnmappedAtMax(targetPathNode, groupEntry, 
                                           unmappedId, nonTerminals);
}

// This function implements 'removeChildrenOfUnmapped()' for the case
// that 'groupEntry' is not a maximal group (all arguments to this function
// are the same as those of 'removeChildrenOfUnmapped()', so see their
// description there).
// This function finds the source nodes which are the children of the
// unmapped node which were actually mapped to the target indexer
// (that not all children found in the source indexer are to be mapped
// here is a consequence of the fact that the group is not
// maximal). Having found these children, the children are removed
// from under the given non-terminal nodes.

MergeIndexer.prototype.removeChildrenOfUnmappedAtNonMax = 
    mergeIndexerRemoveChildrenOfUnmappedAtNonMax;

function mergeIndexerRemoveChildrenOfUnmappedAtNonMax(targetPathNode, 
                                                      groupEntry, 
                                                      unmappedId, nonTerminals)
{
    // find the direct children of the unmapped node which were actually
    // mapped. Only children at child paths are considered. Therefore,
    // if the unmapped node is an operator (its direct children are at
    // the same path) nothing is returned here. Operand children are
    // indeed not merged under non-terminals of other groups.
    var sourceChildren = this.getSourceChildrenOfNonMax(unmappedId, groupEntry);

    if(!sourceChildren.length)
        return;

    for(var i = 0, l = sourceChildren.length ; i < l ; ++i) {

        var groupSources = sourceChildren[i];
        var childGroup = groupSources.groupEntry; 
        var childPath = childGroup.targetPathNode;

        for(var j = 0, m = groupSources.sourceIds.length ; j < m ; ++j) { 

            var childId = groupSources.sourceIds[j];

            for(var k = 0, n = nonTerminals.length ; k < n ; ++k) { 
                var nonTerminal = nonTerminals[k];
                
                this.removeDominatedTargetNodeBySource(childId, childGroup, 
                                                       childPath,
                                                       nonTerminals[k]);
            }
        }
    }
}

// This function implements 'removeChildrenOfUnmapped()' for the case
// that 'groupEntry' is a maximal group (all arguments to this function
// are the same as those of 'removeChildrenOfUnmapped()', so see their
// description there).
// The function finds the source nodes which are the children of the
// unmapped node which were merged under the given
// non-terminals. These children are at extension paths of the
// group. There are two possibilities here: if the non-terminal is not
// in a monitored sub-tree, only child nodes mapped to traced paths
// need to be considered, but if the non-terminal is inside a
// monitored sub-tree, all children at the source must be
// considered. To avoid having to fetch these source children again
// for each non-terminal, this function holds two versions of the
// children (all children and only those mapped to trced paths) where
// each is initialized when it is first being used. Having found the
// children (for each non-terminal) the children are removed from
// under the non-terminal node.
//
// When looping over the non-terminals, if a non-terminal is found to 
// be in a monitored sub-tree, we decrease the mapping monitor count for 
// the unmapped node. This is unde the assumption that this function is
// called because the children of the unmapped node no longer can be 
// merged under this non-terminal and therefore no longer need to be 
// monitored (this is just a reference count, so if they still need
// to be monitored for another dominating node, they will continue to 
// do so). 

MergeIndexer.prototype.removeChildrenOfUnmappedAtMax = 
    mergeIndexerRemoveChildrenOfUnmappedAtMax;

function mergeIndexerRemoveChildrenOfUnmappedAtMax(targetPathNode, 
                                                   groupEntry, 
                                                   unmappedId, nonTerminals)
{
    // 'sourceChildren' switches between 'tracedSourceChildren' and
    // 'monitoredSourceChildren' depending on whether the non-terminal
    // requires monitoring or not.
    var tracedSourceChildren = false;
    var monitoredSourceChildren = false;
    var sourceChildren;

    for(var i = 0, l = nonTerminals.length ; i < l ; ++i) {
                
        var nonTerminalId = nonTerminals[i];
        
        if(targetPathNode.subTree && 
           this.inSubTree(targetPathNode.nodes.get(nonTerminalId))) {
            if(monitoredSourceChildren === undefined) {
                monitoredSourceChildren = 
                    groupEntry.getSourceChildren([unmappedId], targetPathNode,
                                                 true);
                if(!monitoredSourceChildren.length)
                    return; // unmapped node has no children
            }
            sourceChildren = monitoredSourceChildren;

            // decrease the mapping monitor count for this unmapped node 
            // (if needed)
            this.removeMappingMonitor(groupEntry, targetPathNode, unmappedId, 
                                      1);

        } else {
            if(tracedSourceChildren === undefined) {
                tracedSourceChildren = 
                    groupEntry.getSourceChildren(unmappedId, targetPathNode,
                                                 false);
                if(!targetPathNode.subTree)
                    return; // no traced children and there is no monitoring
            }
            if(tracedSourceChildren.length == 0)
                // need to continue the loop in case there are monitored nodes
                continue;
            sourceChildren = tracedSourceChildren;
        }

        for(var j = 0, m = sourceChildren.length ; j < m ; ++j) {

            var pathEntry = sourceChildren[j];
            var targetPathNode = this.pathNodesById[pathEntry.targetPathId];

            for(var k = 0, n = pathEntry.sourceChildIds.length ; k < n ; ++k) {

                var childId = pathEntry.sourceChildIds[k];
                this.removeDominatedTargetNodeBySource(childId, groupEntry, 
                                                       targetPathNode,
                                                       nonTerminalId);
            }
        }
    }
}

// This function receives a data-element non-terminal operator given by 
// the path 'targetPathNode' and the data element ID 'operatorId' and dominated
// by the node with element ID 'dominatingId'. A target identity
// of the operator (which may have just changed) is also given by
// 'identity' and 'identificationId'. In case 'identificationId' is
// undefined (base identification) 'additional' is and object 
// whose attributes are additional identification IDs to which this 
// removal should apply (typically, these will be identifications 
// which do not explicitly provide an identity for this operator
// and therefore the change in the base identity also implies a change
// in these identities).
// The function then goes over all unmapped nodes whose target identification
// matches the given identification (and domination). These unmapped nodes
// may have been merged under the operator as operands. These merged nodes
// are removed here (they may be either mapped or again unmapped under the 
// operator).

MergeIndexer.prototype.removeUnmappedOperandsByIdentity = 
    mergeIndexerRemoveUnmappedOperandsByIdentity;

function mergeIndexerRemoveUnmappedOperandsByIdentity(targetPathNode,
                                                      operatorId,
                                                      dominatingId,
                                                      identity,
                                                      identificationId,
                                                      additional)
{
    if(targetPathNode.unmappedNodes === undefined)
        return;

    var byGroup = targetPathNode.unmappedNodes.getByIdentity(identity, 
                                                             dominatingId);
    if(!byGroup)
        return;

    var inSubTree = this.inSubTree(targetPathNode.nodes.get(operatorId));
    
    for(var groupId in byGroup.groups) {
        // check that this group's target identification matches that 
        // of the non-terminal.
        var groupEntry = this.groupById[groupId];
        if(groupEntry.targetIdentificationId != identificationId &&
           (!additional || 
            !(groupEntry.targetIdentificationId in additional)))
            continue;
        
        for(var unmappedId in byGroup.groups[groupId].nodes) {
            // removed is mapped as operand
            if(!this.removeDominatedTargetNodeBySource(unmappedId, groupEntry, 
                                                       targetPathNode, 
                                                       operatorId)) {
                // not mapped, remove as unmapped under the operand
                targetPathNode.unmappedNodes.
                    removeSingleEntry(operatorId, unmappedId, 
                                      groupEntry.groupId, groupEntry.priority);
            }

            if(inSubTree && groupEntry.isMaxGroup)
                this.removeMappingMonitor(groupEntry, targetPathNode, 
                                          unmappedId, 1);
        }
    }
}

///////////////////////////////
// Merging Nodes by Identity //
///////////////////////////////

// This function is called with a target path node and a target data
// element ID which together define a node which was mapped just now
// to this indexer. Moreover, it is assumed that this function is
// called only if this node allows merging nodes from other groups
// under it.  The function also receives the base identity 'identity'
// of this node and the data element ID 'dominatingElementId' of the
// node dominating it.  'dominatingElementId' may be equal to
// 'targetElementId' or be undefined.  
// The node provided here may be either a standard non-terminal, which can
// have children at paths extending its path merged under it, or it
// can be an operator node, which allows children (operands) at its own
// path to be merged under it. The flag 'isOperator' indicates which of 
// the two cases this is. This affects the table from which the list
// of candidates for merging are read and the paths at which they are
// added.
// The indentity used for merging under this node may depend on the
// group the child nodes to be inserted under this node belong to. If
// these groups have a target identification, we need to use that
// identification (for those nodes).  In case additional identities
// are used at this path (that is, by groups mapping to children of
// this path) the argument 'additionIdentities' is provided. This is
// an array of the form: [{ identity: <identity>, identification:
// <identification ID> }, .... ] which holds the identity value calculated 
// for the non-terminal node for each of the identification IDs which 
// may be used by children merged under the node. Theses are all the additional
// identities under which child nodes can be inserted (this is in
// addition to the base identity provided in 'identity').
// If this array is provided, the function also looks for children under the
// identities given in this array. In this case, only children which belong
// to the appropriate group (that is, which have the given identification ID
// as their target identification ID) may be inserted under this identity
// (note that the actual identity values in this table may be the same for 
// several identifications).
// The function checks whether there are any nodes listed for merging
// under nodes with the specified identity and dominating node.
// For standard non-terminals these nodes are listed in the 'childrenByIdentity'
// or can be fetched from the source based on their dominating unmapped nodes 
// which can be found in the 'unmappedNodes' table. Also for operators 
// these children are the unmapped nodes listed in the 'unmappedNodes' 
// table.

// dominating ID and identity (after checking for the identification ID
// if necessary) these nodes are merged under the non-terminal node.
// It is also possible that there are nodes which may be merged under
// any node with the required identity, regrdless of the ID of the 
// node dominating the nodes with that identity. These nodes too are merged
// here under the non-terminal node. This typically happens when the
// newly added node is at the root path node or when the child nodes
// are mapped at the minimal target path of the mapping and their 
// dominating nodes are defined by the mapping group based solely on identities
// and without reference to the node dominating the dominating nodes
// with the given identity.

MergeIndexer.prototype.mergeUnderNode = 
    mergeIndexerMergeUnderNode;

function mergeIndexerMergeUnderNode(dominatingElementId, targetPathNode, 
                                    targetElementId, identity, isOperator,
                                    additionalIdentities)
{
    if(!dominatingElementId)
        dominatingElementId = 0;

    if(additionalIdentities)
        for(var i = 0, l = additionalIdentities.length ; i < l ; ++i) {
            var entry = additionalIdentities[i];
            this.mergeUnderIdentity(dominatingElementId, targetPathNode,
                                    targetElementId, isOperator,
                                    entry.identity, entry.identificationId);
        }

    // also need to merge under the base identity
    this.mergeUnderIdentity(dominatingElementId, targetPathNode, 
                            targetElementId, isOperator, identity, undefined);
}

// This function implements 'mergeUnderNode()' for one specific
// identity, 'identity'. 'identificationId' indicates which additional
// identification was use to calculate this identity. For the base identity,
// 'identificationId' is undefined.
// This function may be used both to merge under an operator node
// (in which case the child merged is an unmapped node from the path)
// or to merge under a standard non-terminal. Each of these merges
// are implemented separately (see details at the function implementing
// each case).

MergeIndexer.prototype.mergeUnderIdentity = 
    mergeIndexerMergeUnderIdentity;

function mergeIndexerMergeUnderIdentity(dominatingElementId, targetPathNode, 
                                        targetElementId, isOperator,
                                        identity, identificationId)
{
    if(isOperator)
        this.mergeOperandsUnderIdentity(dominatingElementId, targetPathNode, 
                                        targetElementId, identity, 
                                        identificationId);
    else
        this.mergeChildrenUnderIdentity(dominatingElementId, targetPathNode, 
                                        targetElementId, identity, 
                                        identificationId)
}

// This function merges operands under the operator node given by
// 'targetPathNode' and 'targetElementId' (with a dominating node
// 'dominatingElementId'). The merging is by identity: unmapped nodes
// at the same target path which have a matching identity will be merged.
// 'identity' is the operator's identity under the target identification 
// 'identificationId'. For the base identity, 'identificationId' is
// undefined. 

MergeIndexer.prototype.mergeOperandsUnderIdentity = 
    mergeIndexerMergeOperandsUnderIdentity;

function mergeIndexerMergeOperandsUnderIdentity(dominatingElementId, 
                                                targetPathNode, targetElementId,
                                                identity, identificationId)
{
    var underIdentity;

    if(!targetPathNode.unmappedNodes ||
       !(underIdentity = 
         targetPathNode.unmappedNodes.getByIdentity(identity, 
                                                    dominatingElementId)))
        return; // no unmapped to merge under the operator

    // loop over the groups which merged unmapped nodes at this path
    for(var groupId in underIdentity.groups) {
        var groupEntry = this.groupById[groupId];

        if(identificationId != groupEntry.targetIdentificationId)
            continue; // this identification does not apply to this group

        // is there need to monitor the unmapped nodes?
        var needMonitoring = 
            (!!targetPathNode.subTree && groupEntry.isMaxGroup && 
             this.inSubTree(targetPathNode.nodes.get(targetElementId)));

        var nodes = underIdentity.groups[groupId].nodes;
        for(var sourceElementId in nodes) {
            
            this.mergeChildNode(sourceElementId, groupEntry, targetPathNode, 
                                [targetElementId]);

            if(needMonitoring)
                this.addMappingMonitor(groupEntry, targetPathNode,
                                       sourceElementId, 1);
        }
    }
}

// This function is given a target node 'targetElementId' at 
// 'targetPathNode' dominated by 'dominatingId' (which may be 0 if the
// target path is the root path). The identity of this node is 
// 'identity' under the target identification with ID 'identificationId'.
// 'identificationId' should be undefined if the base identity
// (in the target indexer) is used.
// This node is assumed to be a standard non-terminal node 
// (not an operator) and therefore allows the merging of nodes from
// other groups under it, based on identity. This function implements
// The merging of these children under this node base on identity.
// There are two types of children that may be merged: 
// 1. nodes mapped to a child path of targetPathNode from the minimal 
//    source path of a mapping. In this case, this node is merged under
//    nodes at 'targetPathNode' based on its identity. The relevant
//    nodes are stored in the 'childrenByIdentity' table of the 
//    target path node.
// 2. Children of unmapped nodes merged to targetPathNode which have
//    a matching identity.
// This function handles the merging of both types of child nodes.

MergeIndexer.prototype.mergeChildrenUnderIdentity = 
    mergeIndexerMergeChildrenUnderIdentity;

function mergeIndexerMergeChildrenUnderIdentity(dominatingElementId, 
                                                targetPathNode, targetElementId,
                                                identity, identificationId)
{
    // merge nodes which were merged from the minimal source path of 
    // a mapping to child paths of the target path with a matching identity
    this.mergeChildrenFromMinSourcePath(targetPathNode, targetElementId,
                                        identity, identificationId);

    // merge children of unmapped nodes with matching identity
    this.mergeChildrenOfMatchingUnmapped(dominatingElementId, targetPathNode, 
                                         targetElementId, identity, 
                                         identificationId);
}

// This function is given a non-terminal target node 'targetElementId'
// at 'targetPathNode'. The identity of this node is 'identity' under
// the target identification with ID 'identificationId'. This function
// then finds all source nodes merged from the minimal source path of
// their mapping to a child path of the target path such that the groups
// mapping those nodes have the target identification 'identificationId'
// and the source node has identity 'identity' under the source identification
// of the group. These nodes could be merged under the given node.
// The nodes are actually merged only if this is needed: either if
// the target path to which those nodes are merged is being traced or
// because the given target node (under which the merging should take 
// place) is inside a monitored sub-tree. The property 'inSubTree'
// indicates whether this is indeed the case. 

MergeIndexer.prototype.mergeChildrenFromMinSourcePath = 
    mergeIndexerMergeChildrenFromMinSourcePath;

function mergeIndexerMergeChildrenFromMinSourcePath(targetPathNode, 
                                                    targetElementId, identity, 
                                                    identificationId)
{
    // are the children merged inside a monitored sub-tree?
    var inSubTree = this.inSubTree(targetPathNode.nodes.get(targetElementId));
    var underIdentity;
    
    if(!targetPathNode.childrenByIdentity || 
       !(underIdentity = 
         targetPathNode.childrenByIdentity.getChildren(identity)))
        return;

    for(var groupId in underIdentity.groups) {
        
        var groupEntry = this.groupById[groupId];
        
        if(groupEntry.targetIdentificationId != identificationId)
            continue;

        if(!groupEntry.targetPathNode.trace && !inSubTree)
                continue;

        for(var sourceId in underIdentity.groups[groupId].nodes) {
            this.mergeChildNode(sourceId, groupEntry, 
                                groupEntry.targetPathNode, [targetElementId]);
        }
    }
}

// This function is given a target node 'targetElementId' at 
// 'targetPathNode' dominated by 'dominatingId' (which may be 0 if the
// target path is the root path). The identity of this node is 
// 'identity' under the target identification with ID 'identificationId'.
// 'identificationId' should be undefined if the base identity
// (in the target indexer) is used. This function finds all unmapped
// nodes merged to this target path which have a matching source 
// identity. Only unmapped node merged by groups which have a target 
// identification with ID 'identificationId' are considered here.
// This function then merges all the children of the unmapped node which 
// need to be merged under the given target node. These children are required
// to be at a path extending the path of the unmapped node. If the unmapped
// node is an operator, no children will be merged here.

MergeIndexer.prototype.mergeChildrenOfMatchingUnmapped = 
    mergeIndexerMergeChildrenOfMatchingUnmapped;

function mergeIndexerMergeChildrenOfMatchingUnmapped(dominatingElementId, 
                                                     targetPathNode, 
                                                     targetElementId,
                                                     identity, 
                                                     identificationId)
{
    var children;
    var underIdentity;
    var unmapped;

    if(!targetPathNode.unmappedNodes || 
       !(unmapped = 
         targetPathNode.unmappedNodes.getByIdentity(identity,
                                                    dominatingElementId)))
        return; // nothing more to do

    // loop over the groups (of the unmapped nodes)
    for(var groupId in unmapped.groups) {
        
        var groupEntry = this.groupById[groupId];
        if(groupEntry.targetIdentificationId != identificationId)
            continue; // skip groups whose target idnetification doesn't match

        // loop over the IDs of the unmapped nodes mapped by this group
        for(var unmappedId in unmapped.groups[groupId].nodes)
            this.mergeChildrenOfUnmapped(groupEntry, targetPathNode,
                                         unmappedId, [targetElementId]);
    }
}

// This function is given a source node ID 'unmappedId' which is merged
// as unmapped by the group 'groupEntry' to the target path 'targetPathNode'.
// This function then merges the children of the given unmapped node under
// the non-terminal nodes whose IDs are stored in the array 'nonTerminalsIds'.
// It is assumed that the calling function already determined that
// the source identity of the unmapped node matches the target identity
// of these non-terminals. 
// The main thing this function does, before calling the function which 
// actually performs the merge, is determine how many of the non-terminals
// are inside monitored sub-trees. If multiple non-terminals
// are provided, some of them may be inside a monitored sub-tree while
// others not. If there are some non-terminals in monitored sub-trees,
// the unmapped (source) node must also be monitored, to ensure all its
// children are available for merging. This monitoring is added with
// a reference count which depends on the number of non-terminals which
// are monitored.

MergeIndexer.prototype.mergeChildrenOfUnmapped = 
    mergeIndexerMergeChildrenOfUnmapped;

function mergeIndexerMergeChildrenOfUnmapped(groupEntry, targetPathNode, 
                                             unmappedId, nonTerminalIds)
{
    if(!groupEntry.isMaxGroup) {
        this.mergeChildOfNonMaxGroup(unmappedId, groupEntry, 
                                     targetPathNode, nonTerminalIds, true);
        return;
    }

    // unmapped node is at the maximal group (children at extension paths)

    if(targetPathNode.subTree) {
        // there may be some monitored non-terminals. For each such
        // non-terminal, we need to increase by one the reference count for
        // the source monitor on the unmapped node
        var nodes = targetPathNode.nodes;
        var numInSubTree = 0;
        for(var i = 0, l = nonTerminalIds.length ; i < l ; ++i)
            if(this.inSubTree(nodes.get(nonTerminalIds[i])))
                numInSubTree++;
        if(numInSubTree > 0)
            this.addMappingMonitor(groupEntry, targetPathNode, unmappedId,
                                   numInSubTree);
    }

    // map the children of the unmapped node
    
    this.mergeChildrenUnderMerged(groupEntry, targetPathNode,
                                  [unmappedId], [nonTerminalIds]); 
}

///////////////
// Operators //
///////////////

// This function returns true if the node given by the path node and 
// data element ID is an operator node stored in the 'operators' table
// of that path node (meaning that it is an operator which allows 
// other groups to merge nodes under it).

MergeIndexer.prototype.isNonTerminalOperator = 
    mergeIndexerIsNonTerminalOperator;

function mergeIndexerIsNonTerminalOperator(pathNode, elementId)
{
    return (pathNode.operators !== undefined && pathNode.operators.size > 0 &&
            pathNode.operators.has(elementId));
}

// This function adds the given node as a non-terminal operator at the given 
// path. It is assumed that this node was not previously a non-terminal
// operator. If the operator is a data element (its element ID and dominating
// element ID are not the same) this operator is also stored in the 
// dataElementOperators table. For this reason, the source identity 
// 'identity' of the node is required.
// If the node was added to the dataElementOperators table, the function
// which adds it to that table also checks whether any existing nodes
// can be merged as operands under this node.
// 'dominatingId' can be undefined if pathNode is the root path.

MergeIndexer.prototype.addNonTerminalOperator = 
    mergeIndexerAddNonTerminalOperator;

function mergeIndexerAddNonTerminalOperator(pathNode, dominatingId, elementId,
                                            identity)
{
    if(pathNode.operators === undefined) {
        pathNode.operators = new Map();
    } else if(pathNode.operators.has(elementId))
        return;

    pathNode.operators.set(elementId, true);

    if(elementId == dominatingId)
        return; // not a data element, nothing more to do

    this.addDataElementOperator(pathNode, dominatingId, elementId,
                                identity);
}

// This function checks whether the given node is a a non-terminal 
// operator and if it is, removes it as an operator. If the operator 
// is a data element (its element ID and dominating
// element ID are not the same) this node is also removed as 
// a data element operator.
// 'dominatingId' can be undefined if pathNode is the root path.

MergeIndexer.prototype.removeNonTerminalOperators = 
    mergeIndexerRemoveNonTerminalOperators;

function mergeIndexerRemoveNonTerminalOperators(pathNode, elementIds)
{
    if(pathNode.operators === undefined || pathNode.operators.size == 0)
        return; // no non-terminal operators

    var operators = pathNode.operators;
    var hasDataElementOperators =
        (pathNode.dataElementOperators !== undefined &&
         pathNode.dataElementOperators.getNum() > 0);
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        var elementId = elementIds[i];
        if(elementId === undefined)
            continue;
        if(!operators.has(elementId))
            continue; // not an operator

        if(hasDataElementOperators) {
            var dataElementEntry = this.dataElements.getEntry(elementId);
            if(dataElementEntry.pathId == pathNode.pathId) {
                this.removeDataElementOperator(pathNode,
                                               dataElementEntry.parent,
                                               elementId);
            }
        }

        operators.delete(elementId);
    }
}

// This function adds the given node as a data element operator at this path.
// It is assume that the calling function already verified that this is
// indeed a data element and a non-terminal operator.
// This function adds this node to the 'dataElementOperators' table.
// After adding the operator to the data-element-operator table, this
// function checks whether there are any nodes in the unmappedNodes
// table which should be inserted under this operator node (and if there are,
// inserts them).

MergeIndexer.prototype.addDataElementOperator = 
    mergeIndexerAddDataElementOperator;

function mergeIndexerAddDataElementOperator(pathNode, dominatingId, elementId,
                                            identity)
{
    this.addToIdentifiedByTarget(elementId, pathNode.pathId);

    if(!pathNode.dataElementOperators) {
        pathNode.dataElementOperators = 
            new PathNonTerminals(this, !pathNode.parent);
        // go over the groups at this path and add the additional 
        // identifications used by these groups for target identification.
        var _self = this;
        pathNode.mappingGroups.forEach(function(entry, groupId) {
            var identificationId =
                _self.groupById[groupId].targetIdentificationId;
            if(identificationId !== undefined) {
                pathNode.dataElementOperators.
                    addAdditionalIdentification(identificationId);
            }
        });
    }

    // add this operator to the data element operator table
    var additionalIdentities = 
        pathNode.dataElementOperators.addNonTerminal(dominatingId, elementId,
                                                     identity);
    
    // merge any existing operands which can be merged under this node
    this.mergeUnderNode(dominatingId, pathNode, elementId, identity,
                        true, additionalIdentities);
}

// This function removes the given node as a data element operator at this path.
// It is assume that the calling function already verified that this is
// indeed a data element and a non-terminal operator.
// This function removes this node to the 'dataElementOperators' table.
// If the operator had sub-tree monitoring, this function also 
// checks whether there are any unmapped nodes merged under it for which 
// monitoring needs to be removed.

MergeIndexer.prototype.removeDataElementOperator = 
    mergeIndexerRemoveDataElementOperator;

function mergeIndexerRemoveDataElementOperator(pathNode, dominatingId, 
                                               elementId)
{
    this.removeFromIdentifiedByTarget(elementId, pathNode.pathId);

    var identity = this.dataElements.getBaseIdentity(elementId);
    var additionalIdentities = pathNode.dataElementOperators.
        removeNonTerminal(dominatingId, elementId, identity);

    if(pathNode.dataElementOperators.getNum() == 0)
        pathNode.dataElementOperators = undefined;

    if(!pathNode.unmappedNodes || !pathNode.unmappedNodes.unmappedNum())
        return; // nothing more to de below

    var nodeEntry = pathNode.nodes.get(elementId);
    if(this.inSubTree(nodeEntry))
        this.removeUnmappedMappingMonitor(pathNode, dominatingId, 
                                          identity, additionalIdentities);
}

////////////////////////////
// Source Identity Update //
////////////////////////////

// add this non-identity group to the groupBySourceIdentification table.

MergeIndexer.prototype.addGroupToGroupBySourceIdentification = 
        mergeIndexerAddGroupToGroupBySourceIdentification;

function mergeIndexerAddGroupToGroupBySourceIdentification(groupEntry)
{
    if(this.groupBySourceIdentification === undefined)
        this.groupBySourceIdentification = new Map();
    
    var identificationId = groupEntry.sourceIdentificationId;

    if(identificationId === undefined)
        identificationId = 0;

    var idEntry;

    if(this.groupBySourceIdentification.has(identificationId))
        idEntry = this.groupBySourceIdentification.get(identificationId);
    else {
        idEntry = new Map();
        this.groupBySourceIdentification.set(identificationId, idEntry);
    }

    idEntry.set(groupEntry.groupId, groupEntry);
}

// remove this non-identity group from the groupBySourceIdentification table.

MergeIndexer.prototype.removeGroupFromGroupBySourceIdentification = 
        mergeIndexerRemoveGroupFromGroupBySourceIdentification;

function mergeIndexerRemoveGroupFromGroupBySourceIdentification(groupEntry)
{
    var identificationId = groupEntry.sourceIdentificationId;
    
    if(identificationId === undefined)
        identificationId = 0;
    
    var idEntry = this.groupBySourceIdentification.get(identificationId);
    
    if(idEntry === undefined)
        return;
    
    idEntry.delete(groupEntry.groupId);
    if(idEntry.size == 0)
        this.groupBySourceIdentification.delete(identificationId);
}

// This function is called to increase the reference count of the
// source identification ID of the group 'groupEntry' and the target path ID
// of 'targetPathNode' in the 'unmappedByIdentification' table. This is called
// when the group is added as a mapping group to the target path and the
// path holds unmapped nodes. It may also be called when the first unmapped
// node is added to the target path. In that case, 'groupEntry' is undefined
// and the function goes over all groups registered as mapping on the path.

MergeIndexer.prototype.addToUnmappedByIdentification = 
        mergeIndexerAddToUnmappedByIdentification;

function mergeIndexerAddToUnmappedByIdentification(targetPathNode, groupEntry)
{
    if(this.unmappedByIdentification === undefined)
        this.unmappedByIdentification = new Map();

    var pathId = targetPathNode.pathId;
    
    if(groupEntry !== undefined) {
        var identificationId = groupEntry.sourceIdentificationId;
        if(identificationId === undefined)
            identificationId = 0;
        var idEntry;
        if(this.unmappedByIdentification.has(identificationId)) {
            idEntry = this.unmappedByIdentification.get(identificationId);
        } else {
            idEntry = new Map();
            this.unmappedByIdentification.set(identificationId, idEntry);
        }

        if(idEntry.has(pathId))
            idEntry.set(pathId, idEntry.get(pathId) + 1);
        else
            idEntry.set(pathId, 1);

        return;
    }

    // first unmapped node added at this path. Add the identifications of
    // the groups at the path.
    var _self = this;
    pathNode.mappingGroups.forEach(function(entry, groupId) {
        _self.addToUnmappedByIdentification(targetPathNode,
                                            _self.groupById[groupId]);
    });
}

// This function is called to decrease the reference count of the
// source identification ID of the group 'groupEntry' and the target path ID
// of 'targetPathNode' in the 'unmappedByIdentification' table. This is called
// when the group is removed as a mapping group from the target path and the
// path holds unmapped nodes. It may also be called when the last unmapped
// node is removed from the target path. In that case, 'groupEntry' is undefined
// and the function goes over all groups registered as mapping on the path.

MergeIndexer.prototype.removeFromUnmappedByIdentification = 
        mergeIndexerRemoveFromUnmappedByIdentification;

function mergeIndexerRemoveFromUnmappedByIdentification(targetPathNode,
                                                        groupEntry)
{
    var pathId = targetPathNode.pathId;
    
    if(groupEntry !== undefined) {
        var identificationId = groupEntry.sourceIdentificationId;
        if(identificationId === undefined)
            identificationId = 0;
        var idEntry = this.unmappedByIdentification.get(identificationId);
        var count = idEntry.get(pathId) - 1;
        if(count == 0) {
            if(idEntry.size == 1) // last path
                this.unmappedByIdentification.delete(identificationId);
            else
                idEntry.delete(pathId);
        } else
            idEntry.set(pathId, count);
        return;
    }

    // last unmapped node removed from this path. Remove the identifications of
    // the groups at the path.
    var _self = this;
    pathNode.mappingGroups.forEach(function(entry, groupId) {
        _self.removeFromUnmappedByIdentification(targetPathNode,
                                                 _self.groupById[groupId]);
    });
}

// This function is called when the source identification ID of the group
// 'groupEntry' changed from 'oldIdentificationId' to 'newIdentificationId'.
// It then updates the 'unmappedByIdentification' table for this change.

MergeIndexer.prototype.changeUnmappedByIdentification = 
        mergeIndexerChangeUnmappedByIdentification;

function mergeIndexerChangeUnmappedByIdentification(groupEntry,
                                                    oldIdentificationId,
                                                    newIdentificationId)
{
    if(oldIdentificationId === newIdentificationId)
        return;

    if(this.unmappedByIdentification === undefined ||
       !this.unmappedByIdentification.has(oldIdentificationId))
        return;

    var oldPaths = this.unmappedByIdentification.get(oldIdentificationId);
    var newPaths;
    
    oldPaths.forEach(function(count, pathId) {
        var pathNode = this.pathNodesById[pathId];
        if(!pathNode.mappingGroups.has(groupEntry.groupId))
            return;

        if(--count == 0)
            oldPaths.delete(pathId);
        else
            oldPaths.set(pathId, count);
        
        if(newPaths === undefined) {
            if(this.unmappedByIdentification.has(newIdentificationId)) {
                newPaths =
                    this.unmappedByIdentification.get(newIdentificationId);
            } else {
                newPaths = new Map();
                this.unmappedByIdentification.get(newIdentificationId,
                                                  newPaths);
            }
        }

        if(newPaths.has(pathId))
            newPaths.set(pathId, newPaths.get(pathId)+1);
        else
            newPaths.set(pathId, 1);
    });

    if(oldPaths.size == 0)
        this.unmappedByIdentification.delete(oldIdentificationId);
}

// This function is called with a list of identity updates received from
// the source indexer 'sourceIndexer'. The updates are for identification
// with ID 'identificationId' (which may be 0 for the base identity).
// The update is given as an array of element IDs and an array of identities,
// where each identity is the new identity of the element ID at the
// corresponding position in the element IDs array.
// When this function is called, the function getIdentity() on 'sourceIndexer'
// still returns the old identity, before the update.
// These updates are then applied to three types of nodes which may be affected
// by such an identity update:
// 1. identity nodes (identity nodes which are the result of mapping of
//    source nodes by an identity group). When the identity changes,
//    the source nodes are mapped to a different identity node and
//    this may result in identity nodes being added and removed.
// 2. unmapped nodes: the merging of the children of unmapped nodes is
//    based on the identity of the unmapped nodes, so a change in identity
//    may result in a change in the merging of those children.
// 3. Children of this source nodes merged from the minimal source path 
//    of a group with a matching source identification. All these are listed 
//    in the 'childrenByIdentity' table. The identities stored in 
//    that table for the source node (and the relevant groups) are refreshed
//    and the nodes are remerged (this merging applies only under standard
//    non-terminals and not under operators).

MergeIndexer.prototype.updateSourceIdentity = mergeIndexerUpdateSourceIdentity;

function mergeIndexerUpdateSourceIdentity(sourceIndexer, elementIds, identities,
                                          identificationId) 
{
    // update mapped nodes whose identity has to be updated.
    this.updateMappedTargetIdentity(sourceIndexer, elementIds, identities,
                                    identificationId);

    // update the relevant identity groups
    this.updateIdentityNodeIdentity(sourceIndexer, elementIds, identities,
                                    identificationId);

    // update unmapped nodes
    this.updateUnmappedSourceIdentity(sourceIndexer, elementIds,
                                      identities, identificationId);

    // perform the update for children of these nodes which merged from the
    // minimal source path of the mapping
    this.updateUndominatedSourceIdentity(sourceIndexer, elementIds,
                                         identities, identificationId);
}

// This function is called by 'updateSourceIdentity()' to update the 
// base identity of nodes mapped from a source indexer when the source
// identities in that indexer change. 'sourceIndexer' is the indexer 
// from which the identity updates were received and 'elementIds'
// and 'identities' are arrays holding (at corresponidng positions)
// the element IDs to which the update applies and the new identity
// for each element. 'identificationId' is the ID of the identification
// to which the update applies.
// When this function is called, the function getIdentity() on 'sourceIndexer'
// still returns the old identity, before the update.
// This function first updates nodes whose source ID and target ID are
// the same.  The function goes over the updates. For each source ID,
// it checks whether there is an element in the data element table
// with the same ID. If there is and if its group maps from the given
// source indexer and uses the given source identification, the base
// identity of the target data element is updated.
// This function then calls updateMappedIdTargetIdentity() to update the
// identity of nodes whose source ID and target ID are not the same.

MergeIndexer.prototype.updateMappedTargetIdentity = 
    mergeIndexerUpdateMappedTargetIdentity;

function mergeIndexerUpdateMappedTargetIdentity(sourceIndexer, elementIds,
                                                identities, identificationId)
{
    var groupId;
    var groupEntry;
    var skipGroup = false;
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {

        var sourceId = elementIds[i];

        if(!this.dataElements.hasEntry(sourceId))
            continue;

        var newIdentity = identities[i];
        
        var elementEntry = this.dataElements.getEntry(sourceId);
        // default identity is the source ID
        var identity = elementEntry.identity === undefined ?
            sourceId : elementEntry.identity;
        if(identity == newIdentity)
            continue; // nothing can change

        if(groupId !== elementEntry.groupId) {
            groupId = elementEntry.groupId;
            groupEntry = this.groupById[groupId];
            skipGroup = sourceIndexer != groupEntry.sourceIndexer ||
                identificationId != groupEntry.sourceIdentificationId;
        }

        if(skipGroup)
            continue; // update does not apply to this group

        // update the identity
        this.setBaseIdentityForExistingNode(sourceId, newIdentity);
    }

    this.updateMappedIdTargetIdentity(sourceIndexer, elementIds,
                                      identities, identificationId);
}

// This function is called by 'updateMappedTargetIdentity()' to update the 
// base identity of nodes mapped from a source indexer when the source
// identities in that indexer change. This function handles those nodes
// whose target ID is different from their source ID (nodes where the
// source and target ID is the same are handled by the calling
// function, updateMappedTargetIdentity()).

// 'sourceIndexer' is the indexer from which the identity updates were
// received and 'elementIds' and 'identities' are arrays holding
// (at corresponding positions) the element IDs to which the update applies
// and the new identity for each element. 'identificationId' is the ID of
// the identification to which the update applies.
// When this function is called, the function getIdentity() on 'sourceIndexer'
// still returns the old identity, before the update.
// This function first constructs the list of group which have this indexer
// as a source indexer, the given identification ID as the source
// identification and which have a sourceDataElements table (meaning
// that a source data element may be mapped to a target node with an ID
// different from the source ID). If there are no such groups, the 
// function exits.
// Otherwise, the function then goes over the updates. For each source ID, 
// the function checks whether any of the groups which have a 
// sourceDataElements object have this source node in their sourceDataElements
// table. If yes, the base identities of the relevant target nodes are updated.

MergeIndexer.prototype.updateMappedIdTargetIdentity = 
    mergeIndexerUpdateMappedIdTargetIdentity;

function mergeIndexerUpdateMappedIdTargetIdentity(sourceIndexer, elementIds,
                                                  identities, identificationId)
{
    // create an array with the group entries of groups having this 
    // source indexer and identification as source identification and
    // which have a sourceDataElements table (which means data element IDs
    // are being translated).
    var groupList = [];
    if(this.groupBySourceIdentification === undefined ||
       !this.groupBySourceIdentification.has(identificationId))
        return;
    var groups = this.groupBySourceIdentification.get(identificationId);
    groups.forEach(function(groupEntry, groupId) {
        if(groupEntry.sourceDataElements !== undefined &&
           groupEntry.sourceIndexer == sourceIndexer)
            groupList.push(groupEntry);
    });
    
    if(groupList.length == 0)
        return;

    for(var i = 0, l = groupList.length ; i < l ; ++i) {
    
        var groupEntry = groupList[i];
        
        for(var j = 0, m = elementIds.length ; j < m ; ++j) {
        
            var sourceId = elementIds[j];
            var targetIds = 
                groupEntry.sourceDataElements.getAllocatedTargetIds(sourceId);
            var newIdentity = identities[j];

            for(var k = 0, n = targetIds.length ; k < n ; ++k)
                this.setBaseIdentityForExistingNode(targetIds[k], newIdentity);
        }
    }
}

// This function updates the identity groups when the identity of the elements
// in 'elementIds' under identification 'identificationId' changes.
// 'sourceIndexer' is the source indexer of the elements and 'identities'
// is an array holding the new identities of the elements in 'elementIds'.
// This function loops over all identity groups which have the given indexer
// as source indexer and the given identification as source identification.
// For each group, it updates the group with the new identities. This
// may result in new identity nodes being created and old identity nodes
// being removed. The function then merges the new source identity nodes
// and removes the merging of the removed source identity nodes.

MergeIndexer.prototype.updateIdentityNodeIdentity =
    mergeIndexerUpdateIdentityNodeIdentity;

function mergeIndexerUpdateIdentityNodeIdentity(sourceIndexer, elementIds,
                                                identities, identificationId)
{
    // loop over the identity groups which have this identification as their
    // source identification (and this source indexer as source)

    if(this.identityGroupByIdentification === undefined ||
       !this.identityGroupByIdentification.has(identificationId))
        return; // no such groups

    var groups = this.identityGroupByIdentification.get(identificationId);

    var _self = this;
    groups.forEach(function(groupEntry, groupId) {

        if(groupEntry.sourceIndexer !== sourceIndexer)
            return; // not the same source indexer (probably rare)

        // update the merge group
        var update = groupEntry.updateIdentity(elementIds, identities);

        // add and remove the identity nodes which were added or removed
        // as a result of this update

        var targetPathNode = groupEntry.targetPathNode;
        
        if(update.added && update.added.length > 0) {
            // this update resulted in new identity nodes being created
            if(targetPathNode.parent === undefined) { // no dominating node
                var dominatingIds = [undefined];
                for(var i = 0, l = update.added.length ; i < l ; ++i) {
                    var idNodeId = update.added[i].idNodeId;
                    _self.mergeChildNode(idNodeId, groupEntry,
                                         targetPathNode,
                                         _self.mappings.size == 1 ?
                                         undefined : [undefined]);
                }
            } else if(targetPathNode.parent.nonTerminals.getNum() > 0) {
                
                var dominatingIds;
                var parentPath = targetPathNode.parent;
                
                for(var i = 0, l = update.added.length ; i < l ; ++i) {
                    var addedNode = update.added[i];
                    dominatingNodeIds = parentPath.nonTerminals.
                        getNonTerminals(undefined, addedNode.parentIdentity,
                                        groupEntry.targetIdentificationId);
                    _self.mergeChildNode(addedNode.idNodeId, groupEntry,
                                         targetPathNode, dominatingNodeIds);
                }
            }
        }

        if(update.removed && update.removed.length > 0)
            _self.removeSourceNodes(groupEntry, targetPathNode, update.removed);
    });
}

// This function applies a source identity update to unmapped nodes.
// 'sourceIds' is an array of source element IDs from the indexer
// 'sourceIndexer' whose identity under identification 'identificationId'
// has changed to 'idnetities' (an array of the new identities of the
// corresponding elements in 'sourceIds'). This function first finds
// which target path nodes have unmapped nodes which may have been merged
// by a group whose source is 'sourceIndexer' with source identification
// 'identificationId'. For each path it then goes over all source nodes
// in 'sourceId' and checks whether they are among the unmapped nodes
// of the path and were indeed merged from the given indexer under the
// given identification. If yes, the identity is updated.

MergeIndexer.prototype.updateUnmappedSourceIdentity = 
        mergeIndexerUpdateUnmappedSourceIdentity;

function mergeIndexerUpdateUnmappedSourceIdentity(sourceIndexer, sourceIds,
                                                  identities, identificationId)
{
    // find target paths where there may be unmapped nodes with source
    // identification equal to this

    if(this.unmappedByIdentification === undefined ||
       !this.unmappedByIdentification.has(identificationId))
        return; // no relevant unmapped nodes
    
    var paths = this.unmappedByIdentification.get(identificationId);
    var _self = this;
    
    paths.forEach(function(count, pathId) {
        var pathNode = _self.pathNodesById[pathId];
        var hasNonTerminals =
            (!!pathNode.nonTerminals && pathNode.nonTerminals.getNum() > 0);
        var hasOperators = !!pathNode.dataElementOperators;

        // update the nodes, one by one
        
        for(var i = 0, l = sourceIds.length ; i < l ; ++i) {
            _self.updateUnmappedSourceIdentityAtPath(pathNode, sourceIndexer,
                                                     sourceIds[i],
                                                     identities[i],
                                                     identificationId,
                                                     hasNonTerminals,
                                                     hasOperators);
        }
    });
}

// This function performs the identity update for a single source element
// and the unmapped nodes at the target path 'targetPathNode'.
// The source node is 'sourceId' which was mapped from 'sourceIndexer'
// and its identity under identification 'identificationId' has
// changed to 'newIdentity'. 'hasNonTerminals' and 'hasOperators'
// indicate whether 'targetPathNode' has non-terminal to merge under
// and whether it has operators to merge under.
// The function first updates the new identity of the source node in the
// unmapped nodes table of the target path. It may very well be that the
// node is not unmapped or that it is unmapped for a group which uses
// a different idetification. In that case, the update of the unmapped
// nodes does nothing and the function returns. Otherwise, if there
// are non-terminals or operators at the target nodes, this function checks
// whether as a result of the identity change, the children of the unmapped
// node can now be merged under different non-terminals or operators.

MergeIndexer.prototype.updateUnmappedSourceIdentityAtPath = 
    mergeIndexerUpdateUnmappedSourceIdentityAtPath;

function mergeIndexerUpdateUnmappedSourceIdentityAtPath(targetPathNode,
                                                        sourceIndexer,
                                                        sourceId,
                                                        newIdentity,
                                                        identificationId,
                                                        hasNonTerminals,
                                                        hasOperators)
{
    var updates = targetPathNode.unmappedNodes.
        updateIdentity(sourceId, newIdentity, this.groupById, sourceIndexer, 
                       identificationId);

    if(updates === undefined || updates.length == 0)
        return; // no matching unmapped nodes found

    if(!hasNonTerminals && !hasOperators)
        return;

    for(var i = 0, l = updates.length ; i < l ; ++i) {
        
        var update = updates[i];
        var groupEntry = this.groupById[update.groupId];

        if(hasNonTerminals) {
            // remove the children of the unmapped node from under the 
            // non-terminals they were mapped under by the old identity
            // (update.dominatingIds is undefined if pathNode is the
            // root node).
            this.removeChildrenOfUnmappedUnderAll(pathNode, groupEntry,
                                                  sourceId,
                                                  update.dominatingIds, 
                                                  update.oldIdentity);

            // add the children of the unmapped node under the non-terminals
            // matching the new identity

            var newNonTerminals = pathNode.nonTerminals.
                getNonTerminals(update.dominatingIds, newIdentity, 
                                groupEntry.targetIdentificationId);
            
            this.mergeChildrenOfUnmapped(groupEntry, pathNode, sourceId,
                                         newNonTerminals);
        }
            
        if(hasOperators)
            // check whether this node was merged under an operator
            // based on its identity and re-merge if needed.
            this.remergeAsOperandAfterIdentityChange(pathNode, sourceId, 
                                                     update.dominatingIds, 
                                                     update.oldIdentity, 
                                                     newIdentity, groupEntry);
    }
}
    
// Given is a source node 'unmappedId' merged as unmapped by 'groupEntry' 
// to path 'targetPathNode' under dominating node 'dominatingIds'
// (an array of IDs) whose identity has just changed from 'oldIdentity'
// to 'newIdentity'. This function checks whether there are any operators
// at this target path which allow merging of unmapped nodes under them.
// If such nodes exist, this function removes the merging of the unmapped
// node under operators with the old identity and merges it under operators
// with the new identity. 

MergeIndexer.prototype.remergeAsOperandAfterIdentityChange = 
        mergeIndexerRemergeAsOperandAfterIdentityChange;

function mergeIndexerRemergeAsOperandAfterIdentityChange(targetPathNode,
                                                         unmappedId,
                                                         dominatingIds,
                                                         oldIdentity, 
                                                         newIdentity, 
                                                         groupEntry)
{
    if(!targetPathNode.dataElementOperators)
        return; // no operators to merge under

    var oldOperators = targetPathNode.dataElementOperators.
        getNonTerminals(dominatingIds, oldIdentity, 
                        groupEntry.targetIdentificationId);

    // remove merging under these operators
    for(var i = 0, l = oldOperators.length ; i < l ; ++i) {
        // remove a mapped merge
        if(!this.removeDominatedTargetNodeBySource(unmappedId, groupEntry, 
                                                   targetPathNode, 
                                                   oldOperators[i])) {
            // remove an unmapped merge
            targetPathNode.unmappedNodes.
                removeSingleEntry(oldOperators[i], unmappedId, 
                                  groupEntry.groupId,
                                  groupEntry.priority);
        }
    }
    
    
    // if needed, remove monitoring of the unmapped node
    if(targetPathNode.subTree && groupEntry.isMaxGroup) {
        // count the number of monitored nodes among oldOperators
        var numMonitored = 0;
        for(var i = 0, l = oldOperators.length ; i < l ; ++i)
            if(this.inSubTree(targetPathNode.nodes.get(oldOperators[i])))
                numMonitored++;
        if(numMonitored)
            this.removeMappingMonitor(groupEntry, targetPathNode, unmappedId, 
                                      numMonitored);
    }

    var newOperators = targetPathNode.dataElementOperators.
        getNonTerminals(dominatingIds, newIdentity,
                        groupEntry.targetIdentificationId);

    // add merging under these operators

    this.mergeChildNode(unmappedId, groupEntry, targetPathNode, 
                        newOperators);

    // if needed, add monitoring of the unmapped node
    this.addMappingMonitorUnderNonTerminals(groupEntry, targetPathNode,
                                            [unmappedId], [newOperators]);
}

// This function updates the 'childrenByIdentity' objects and the merging
// implied by them when the identification 'identificationId' on the
// indexer 'sourceIndexer' of the source nodes in the array 'sourceIds'
// has changed to 'identities' (and array of identities). The function
// first finds all 'childrenByIdentity' objects which may be affected
// by this identity update and then updates each of these objects.

MergeIndexer.prototype.updateUndominatedSourceIdentity = 
        mergeIndexerUpdateUndominatedSourceIdentity;

function mergeIndexerUpdateUndominatedSourceIdentity(sourceIndexer, sourceIds,
                                                     identities,
                                                     identificationId)
{
    // find path nodes which have 'childrenByIdentity' and are a prefix path
    // of the target path of groups with the given source indexer and
    // source identification (both identity and non-identity groups)

    var targetPathNodes = [];
    
    var candidates = [];
    if(this.identityGroupByIdentification !== undefined &&
       this.identityGroupByIdentification.has(identificationId))
        candidates.push(this.identityGroupByIdentification.
                        get(identificationId));
    if(this.groupBySourceIdentification !== undefined &&
       this.groupBySourceIdentification.has(identificationId))
        candidates.push(this.groupBySourceIdentification.get(identificationId));

    for(var i = 0 ; i < candidates.length ; ++i) {

        candidates[i].forEach(function(group, groupId) {
            if(group.prefixGroup !== undefined ||
               group.sourceIndexer !== sourceIndexer ||
               group.sourceIdentificationId !== identificationId ||
               group.targetPathNode.parent === undefined ||
               group.targetPathNode.parent.childrenByIdentity === undefined)
                return;
            targetPathNodes.push(group.targetPathNode.parent);
        });
    }

    // update the identities in the chldrenByIdentity objects of the
    // target path nodes which may be affected by the identity change.
    
    for(var i = 0, l = targetPathNodes.length ; i < l ; ++i)
        this.updateUndominatedSourceIdentityAtPath(targetPathNodes[i],
                                                   sourceIndexer, sourceIds,
                                                   identities,
                                                   identificationId);
}

// This function is called to update the identities for nodes in the
// 'childrenByIdentity' object of the target path node 'pathNode' when
// the identity under identification 'identificationId' of the source nodes
// 'sourceIds' mapped from the indexer 'sourceIndexer' have changed
// to the values in the array 'identities'. For each source node in the list,
// this function then checks whether there are any children of this source node
// which were merged from the minimal source path of their group to one
// of the child paths of 'pathNode' such that the group has 'identificationId'
// as its source identification. Such a merge would take place based
// on the identity of 'sourceId' (which has just changed). This list of
// children can be looked up in the 'childrenByIdentity' table of 'pathNode'.
// After retrieving these children from this table (and updating the 
// identity stored in this table) the previous merging of these nodes 
// (under the old identity) is removed and they are merged again based
// on the new identity. 

MergeIndexer.prototype.updateUndominatedSourceIdentityAtPath = 
        mergeIndexerUpdateUndominatedSourceIdentityAtPath;

function mergeIndexerUpdateUndominatedSourceIdentityAtPath(pathNode,
                                                           sourceIndexer,
                                                           sourceIds,
                                                           identities,
                                                           identificationId)
{
    for(var i = 0, l = sourceIds.length ; i < l ; ++i) {

        var sourceId = sourceIds[i];
        var newIdentity = identities[i];
        
        var updates = pathNode.childrenByIdentity.
            updateIdentity(sourceId, newIdentity, this.groupById,
                           sourceIndexer, identificationId);

        if(updates.length == 0)
            return;

        // re-merge the child nodes provided in 'updates' 

        var newNonTerminalsByGroup = {};

        for(var j = 0, m = updates.length ; j < m ; ++j) {
            var update = updates[j];
            var groupEntry = this.groupById[update.groupId];

            var newNonTerminals;
            if(update.groupId in newNonTerminalsByGroup)
                newNonTerminals = newNonTerminalsByGroup[update.groupId];
            else if(groupEntry.prefixGroup !== undefined) {
                // not a minimal group, so this must be a group whose prefix
                // is an identity group. 
                newNonTerminals =
                    this.getDominatingUnderIdentityNode(groupEntry, sourceId);
                if(!groupEntry.prefixGroup.isDominated())
                    // dominating nodes depend only on identity of source node
                    // (not on parent) so this will be the same for all nodes
                    // of this group in this loop
                    newNonTerminalsByGroup[update.groupId] = newNonTerminals;
            } else {
                newNonTerminals = newNonTerminalsByGroup[update.groupId] =
                    pathNode.nonTerminals.
                    getNonTerminals(undefined, newIdentity, 
                                    groupEntry.targetIdentificationId);
            }

            // remove all merges of this node, both mapped and unmapped: 
            // since the identity changed, none of the existing dominations
            // continues to hold.
            this.removeSourceNodes(groupEntry, groupEntry.targetPathNode,
                                   [update.childId]);

            // merge again (under the new identity)
            if(newNonTerminals !== undefined && newNonTerminals.length)
                this.mergeChildNode(update.childId, groupEntry, 
                                    groupEntry.targetPathNode, newNonTerminals);
        }
    }
}

////////////////////////////
// Target Identity Update //
////////////////////////////

// This function adds the given node ('targetElementId' + 'targetPathId') to the
// list of nodes whose target identity may be used in merging. This list
// includes non-terminal nodes, both standard non-terminals and 
// data element operators, under which nodes from other groups may be
// merged by their identity.

MergeIndexer.prototype.addToIdentifiedByTarget = 
        mergeIndexerAddToIdentifiedByTarget;

function mergeIndexerAddToIdentifiedByTarget(targetElementId, targetPathId)
{
    var targetEntry;
    
    if(!this.identifiedByTarget.has(targetElementId)) {
        targetEntry = new Map();
        this.identifiedByTarget.set(targetElementId, targetEntry);
    } else
        targetEntry = this.identifiedByTarget.get(targetElementId);

    targetEntry.set(targetPathId, true);
}

// This function removes the entry for the given node 
// ('targetElementId' + 'targetPathId') from the identifiedByTarget table.

MergeIndexer.prototype.removeFromIdentifiedByTarget = 
        mergeIndexerRemoveFromIdentifiedByTarget;

function mergeIndexerRemoveFromIdentifiedByTarget(targetElementId, targetPathId)
{
    var targetEntry;
    
    if(!(targetEntry = this.identifiedByTarget.get(targetElementId)))
        return;

    if(!targetEntry.has(targetPathId))
        return;

    if(targetEntry.size == 1) // last entry
        this.identifiedByTarget.delete(targetElementId);
    else
        targetEntry.delete(targetPathId);
}

// This function indicates whether target identification updates are required
// here for the given identification. Currently, this only checks whether
// the identifiedByTarget tale is empty or not (this could be refined in
// the future).

MergeIndexer.prototype.requiresTargetIdentification =
    mergeIndexerRequiresTargetIdentification;

function mergeIndexerRequiresTargetIdentification(pathId, identificationId)
{
    return this.identifiedByTarget.size > 0;
}

// This function is called when the identities for the identification
// 'identificationId' on this indexer has changes for the elements in
// the array 'elementIds'. The new identities are given in 'identities'
// while in this function, the 'getIdentity()' function returns the
// old identity, that is, the identity from before the update.

MergeIndexer.prototype.updateTargetIdentities =
    mergeIndexerUpdateTargetIdentities;

function mergeIndexerUpdateTargetIdentities(elementIds, identities,
                                            identificationId)
{
    if(this.identifiedByTarget.size == 0)
        return; // nothing to update
    
    for(var i = 0, l = elementIds.length ; i < l ; ++i) {
        
        var elementId = elementIds[i];
        
        if(!this.identifiedByTarget.has(elementId))
            continue;

        this.updateTargetIdentity(elementId, identities[i], identificationId);
    }
}

// This function is called with an identity update for an identity
// defined on this indexer. This update is given by specifying the
// data element ID, the identification ID to which the change applies
// and the new identity (the old identity can be fetched directly). 
// The function then looks this node up in the 'identifiedByTarget' table.
// This table provides it with the nodes which may be effected by this 
// change. 
// For each of these nodes (element ID + path) this function first checks 
// whether merging by the given identification applies at this path 
// node (this depends on the groups which map nodes to this path and
// to its children). If the identification applies, the function then 
// removes all nodes under the given node which were merged under it 
// based on the given old identity. It then also updates the identity stored
// in the relevant non-terminal table. Finally, the function 
// merges nodes which should be merged under this non-terminal based
// on the new identity.
// This function applies both to operator non-terminals (where insertion
// under the node is at the same path) and standard non-terminals (where
// the insertion is at a child path).

MergeIndexer.prototype.updateTargetIdentity = mergeIndexerUpdateTargetIdentity;

function mergeIndexerUpdateTargetIdentity(targetId, newIdentity,
                                          identificationId)
{
    var targetEntry = this.identifiedByTarget.get(targetId);

    if(targetEntry === undefined)
        return;

    var _self = this;
    
    targetEntry.forEach(function(t, pathId){

        var pathNode = _self.pathNodesById[pathId];
        var identifications;

        if(identificationId !== undefined &&
           (pathNode.nonTerminals === undefined ||
            !(identifications =
              pathNode.nonTerminals.getAdditionalIdentifications()) ||
            !identifications.has(identificationId)))
            return; // identification not used at this path node
        
        // is this an operator or a standard non-terminal ?
        var isOperator = _self.isNonTerminalOperator(targetId);

        if(isOperator && !pathNode.dataElementOperators)
            return; // only a data element operator can dominate by identity

        var dominatingId = _self.getDominatingId(targetId, pathId);
        // the old identity is currently still stored
        var oldIdentity = this.getIdentity(targetId, identificationId);
        
        // update the identity in the non-terminal tables
        if(isOperator) {
            pathNode.dataElementOperators.
                updateIdentity(targetId, dominatingId, oldIdentity,
                               newIdentity, identificationId);
            _self.removeUnmappedOperandsByIdentity(pathNode, targetId, 
                                                   dominatingId, oldIdentity,
                                                   identificationId,
                                                   additional);
        } else {
            
            pathNode.nonTerminals.updateIdentity(targetId, dominatingId, 
                                                 oldIdentity, newIdentity, 
                                                 identificationId);
            
            _self.removeChildrenOfUnmappedByIdentity(pathNode, targetId, 
                                                     dominatingId, oldIdentity, 
                                                     identificationId, 
                                                     additional);

        }
        
        // merge nodes which need to be merged under this node based
        // on its new identity.
        _self.mergeUnderIdentity(dominatingId, pathNode, targetId,  isOperator,
                                 newIdentity, identificationId);
    });
}

////////////////
// Comparison //
////////////////

// This function is used to get the comparison information object
// (CompInfo) for the ordering of the nodes mapped to the given path of
// the merge indexer. This ordering is inherited from the mapping which
// mapped them to the merge indexer. When nodes are merged from multiple
// mappings, the ordering has to be combined from the ordering of the
// different mappings, but this has not yet been defined or implemented.

MergeIndexer.prototype.getDominatedComparisonAtPath =
    mergeIndexerGetDominatedComparisonAtPath;

function mergeIndexerGetDominatedComparisonAtPath(pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return undefined;

    // find the groups which map to this path.
    var groups = pathNode.mappingGroups;

    if(groups === undefined || groups.size === 0)
        return undefined;

    var groupIds = [];

    groups.forEach(function(entry, groupId) {
        groupIds.push(groupId);
    });

    // If multiple group map to the same path, we need to combine their
    // comparisons. Currently, this arbitrarily uses the comparison
    // of the first (smallest ID) group. To do: this needs to be extended
    // to support the combination of the ordering defined by multiple groups.
    groupIds.sort();
    
    for(var i = 0, l = groupIds.length ; i < l ; ++i) {

        var group = this.groupById[groupIds[i]];
        var compInfo = group.getDominatedComparison();

        if(compInfo === undefined)
            return undefined;

        if(!group.isIdentityGroup) {
            // check whether a translation (target ID -> source ID) is required.
            // If yes, set the translation on the comprison info object.
            // (with identity groups, the target identities are used for
            // sorting)
            var translation = this.getElementTranslation();
        }

        if(translation !== undefined)
            compInfo.unshiftTranslation(translation);
        
        return compInfo;
    }
}

// This function is called when the given composedFunc (which is a DataResult
// object registered to this merge indexer at the given path ID) becomes
// order*. This function then registers composedFunc as composed order*
// with the function result which is the source of the elements at the given
// path. If there are multiple mappings to the same path, this is propagated
// to all these mappings.

MergeIndexer.prototype.addOrderStarFuncAtPath =
    mergeIndexerAddOrderStarFuncAtPath;

function mergeIndexerAddOrderStarFuncAtPath(composedFunc, pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return undefined;

    if(pathNode.composedOrderStar === undefined)
        pathNode.composedOrderStar = new Map();
    if(pathNode.composedOrderStar.has(composedFunc.getId()))
       return; // already registered

    pathNode.composedOrderStar.set(composedFunc.getId(), composedFunc);
    
    // find the groups which map to this path.
    var groups = pathNode.mappingGroups;

    if(groups === undefined || groups.size === 0)
        return undefined;

    var _self = this;
    groups.forEach(function(entry, groupId) {
        var group = _self.groupById[groupId];
        if(group !== undefined)
            group.addOrderStarFunc(composedFunc);
    });
}

// This function is called when the composed function with the given ID
// (which is a DataResult object registered to this merge indexer at
// the given path ID) stops being order*. This function then unregisters
// this composed function as composed order* with the function result which
// is the source of the elements at the given path. If there are multiple
// mappings to the same path, this is propagated to all these mappings.

MergeIndexer.prototype.removeOrderStarFuncAtPath =
    mergeIndexerRemoveOrderStarFuncAtPath;

function mergeIndexerRemoveOrderStarFuncAtPath(composedFuncId, pathId)
{
    var pathNode = this.pathNodesById[pathId];

    if(pathNode === undefined)
        return undefined;

    if(pathNode.composedOrderStar === undefined ||
       !pathNode.composedOrderStar.has(composedFuncId))
        return;
    
    pathNode.composedOrderStar.delete(composedFuncId);
    
    // find the groups which map to this path.
    var groups = pathNode.mappingGroups;

    if(groups === undefined || groups.size === 0)
        return undefined;
    
    var _self = this;
    groups.forEach(function(entry, groupId) {
        var group = _self.groupById[groupId];
        if(group !== undefined)
            group.removeOrderStarFunc(composedFuncId);
    });
}

////////////////////////////
// Element ID Translation //
////////////////////////////

// This function determines whether any element ID translations have taken
// place in this indexer (that is, elements whose target ID is not equal
// to their source ID). If such translation took place, this function
// returns a MergeIndexerElementIdTranslation object which performs the
// inverse translation (from the target ID to the source ID). Otherwise
// (if no translation is needed) this function returns undefined.
// Since it is not always easy to determine whether any translations
// actually took place (and even if they took place, it is not always
// clear whether they are relevant to the elements which the caller of
// this function is interested in, this function is allowed to return
// a MergeIndexerElementIdTranslation even if such a translation object
// is not really needed (this object will then simply translate each
// ID to itself).

MergeIndexer.prototype.getElementTranslation =
    mergeIndexerGetElementTranslation;

function mergeIndexerGetElementTranslation()
{
    // translation is needed if one of the groups has a 'sourceDataElements'
    // object (this is the object which stores the translations)
    var needsTranslation = false;
    for(var groupId in this.groupById) {
        var groupEntry = this.groupById[groupId];
        if(groupEntry.sourceDataElements !== undefined) {
            needsTranslation = true;
            break;
        }
    }

    return needsTranslation ?
        new MergeIndexerElementIdTranslation(this) : undefined;
}

//////////////////////////////////
// Auxiliary Translation Object //
//////////////////////////////////

// This object is used to translate element IDs allocated in this
// merge indexer to their source element IDs. Currently, only the source
// element ID is returned.

function MergeIndexerElementIdTranslation(mergeIndexer)
{
    this.mergeIndexer = mergeIndexer;
    this.dataElements = mergeIndexer.dataElements;
}

// Given a target element ID, this function returns its source data element. 

MergeIndexerElementIdTranslation.prototype.get =
    mergeIndexerElementIdTranslationGet;

function mergeIndexerElementIdTranslationGet(targetElementId)
{
    var entry = this.dataElements.getEntry(targetElementId);

    if(entry === undefined || entry.sourceId === undefined)
        return targetElementId;
    
    return entry.sourceId;
}
